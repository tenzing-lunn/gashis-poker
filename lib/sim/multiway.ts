// Hero vs 1..8 weighted ranges: joint rejection sampling plus a uniform runout (Monte Carlo, seeded).
//
// The bots' likelihoods factorize (each one's actions depend only on its own cards and the public
// history), so the joint posterior over their holdings is
//   P(c_1..c_m) ∝ Π_k w_k(c_k) · 1[all disjoint and none uses a hero / board / dead card].
// Drawing each c_k independently from its card-removed range w_k and rejecting the whole draw on any
// collision samples exactly that distribution. The board then completes uniformly from the unseen cards
// and each player's pot share (1 to a sole winner, 1/k to each of k splitters) is recorded, so the
// players' equities sum to 1 per trial and in the means.
//
// Folded players' unknown cards are ignored, not treated as removed (same convention as inferRange):
// pass only the live opponents' ranges, and put a card in `dead` only if it is actually known.

import { createRng, type Card } from "../poker/cards";
import { COMBO_HI, COMBO_LO } from "../poker/combinatorics";
import { CARD_HI, CARD_KEY, CARD_LO, CARD_SUIT, evaluateState, handState } from "../poker/evaluator";
import { comboSampler, knownCards, liveWeights, type ComboSampler, type Weights } from "./weighted-equity";

// Local aliases: imported bindings are property reads under Vitest/Turbopack (see lib/poker/README.md).
const KEY = CARD_KEY, SUIT = CARD_SUIT, LO = CARD_LO, HI = CARD_HI, C_HI = COMBO_HI, C_LO = COMBO_LO;
const evalState = evaluateState;

export const DEFAULT_MULTIWAY_TRIALS = 100_000;
export const MAX_OPPONENTS = 8;

export interface MultiwayEquity {
  /** players[0] = hero, players[k] = opponent k (same order as the weights list) */
  players: { equity: number; win: number; tie: number; stdErr: number }[];
  samples: number;
  exact: false;
  /** accepted / attempted joint draws */
  acceptance: number;
}

export interface MultiwayRun {
  /** Runs at most `units` more trials; true once all trials are done. */
  step(units: number): boolean;
  /** Unbiased running estimate, valid at any time (NaN before the first trial). */
  result(): MultiwayEquity;
  readonly done: boolean;
}

export interface MultiwayOptions {
  dead?: readonly Card[];
  /** Default DEFAULT_MULTIWAY_TRIALS. */
  trials?: number;
  seed?: number;
}

/** Joint rejection sampler over the opponents' holdings; throws once acceptance is below ~0.1%. */
function jointDrawer(ranges: readonly Weights[], blocked: readonly Card[], seed: number) {
  const m = ranges.length;
  if (m < 1 || m > MAX_OPPONENTS) throw new Error(`Need 1-${MAX_OPPONENTS} ranges, got ${m}`);
  const samplers: ComboSampler[] = ranges.map((w) => comboSampler(liveWeights(w, blocked)));
  const rng = createRng(seed);
  const stamp = new Int32Array(52); // stamp[c] === round  <=>  c is held in the current draw
  const drawn = new Int32Array(m);
  let round = 0, accepted = 0, attempts = 0;

  /** Fills `drawn` with one joint holding; its cards are stamped with the returned round number. */
  const draw = (): number => {
    for (;;) {
      round++;
      attempts++;
      let ok = true;
      for (let k = 0; k < m && ok; k++) {
        const s = samplers[k];
        const i = rng.int(s.combos.length);
        const combo = rng.next() < s.prob[i] ? s.combos[i] : s.combos[s.alias[i]];
        const a = C_HI[combo], b = C_LO[combo];
        if (stamp[a] === round || stamp[b] === round) ok = false;
        else {
          stamp[a] = stamp[b] = round;
          drawn[k] = combo;
        }
      }
      if (ok) {
        accepted++;
        return round;
      }
      if (attempts - accepted > 10_000 + 1000 * accepted) {
        throw new Error("Ranges are (nearly) incompatible: too many rejected draws");
      }
    }
  };
  // Runout draws share the stamp array, so they are told the round to stamp with.
  return { rng, stamp, drawn, draw, acceptance: () => accepted / attempts };
}

/** Hero vs 1..8 weighted ranges by joint rejection sampling + uniform runout. Default 100k trials.
 *  Throws if the ranges are (nearly) incompatible (acceptance < ~0.1%). */
export function multiwayEquity(
  hero: readonly [Card, Card],
  ranges: readonly Weights[],
  board: readonly Card[],
  options: MultiwayOptions = {},
): MultiwayEquity {
  const run = startMultiwayEquity(hero, ranges, board, options);
  run.step(Infinity);
  return run.result();
}

/** Incremental multiwayEquity: same inputs and seed give the same result for any split of the work. */
export function startMultiwayEquity(
  hero: readonly [Card, Card],
  ranges: readonly Weights[],
  board: readonly Card[],
  options: MultiwayOptions = {},
): MultiwayRun {
  const known = knownCards(hero, board, options.dead);
  const trials = options.trials ?? DEFAULT_MULTIWAY_TRIALS;
  if (!Number.isInteger(trials) || trials < 1) throw new Error(`trials must be a positive integer, got ${trials}`);
  const m = ranges.length;
  const toDeal = 5 - board.length;
  if (52 - known.length - 2 * m < toDeal) throw new Error("Not enough cards left to complete the board");
  const j = jointDrawer(ranges, known, options.seed ?? 1);
  const { rng, stamp, drawn } = j;

  const base = new Uint8Array(52);
  for (const c of known) base[c] = 1;
  const st = handState(board);
  const bk = st.key, bs = st.suits, bl = st.lo, bh = st.hi;
  const [h0, h1] = hero;
  const hk = KEY[h0] + KEY[h1], hs = SUIT[h0] + SUIT[h1], hl = LO[h0] | LO[h1], hh = HI[h0] | HI[h1];
  const n = m + 1;
  const values = new Int32Array(n);
  const wins = new Float64Array(n), ties = new Float64Array(n), share = new Float64Array(n), shareSq = new Float64Array(n);
  let t = 0;

  const step = (units: number): boolean => {
    const end = Math.min(trials, t + Math.max(0, Math.floor(units)));
    for (; t < end; t++) {
      const round = j.draw();
      let key = bk, suits = bs, lo = bl, hi = bh;
      for (let k = 0; k < toDeal; k++) {
        let c: number;
        do c = rng.int(52);
        while (base[c] || stamp[c] === round);
        stamp[c] = round;
        key += KEY[c];
        suits += SUIT[c];
        lo |= LO[c];
        hi |= HI[c];
      }
      let best = evalState(key + hk, suits + hs, lo | hl, hi | hh), count = 1;
      values[0] = best;
      for (let p = 1; p < n; p++) {
        const combo = drawn[p - 1];
        const a = C_HI[combo], b = C_LO[combo];
        const v = evalState(key + KEY[a] + KEY[b], suits + SUIT[a] + SUIT[b], lo | LO[a] | LO[b], hi | HI[a] | HI[b]);
        values[p] = v;
        if (v > best) {
          best = v;
          count = 1;
        } else if (v === best) count++;
      }
      const s = 1 / count;
      for (let p = 0; p < n; p++) {
        if (values[p] !== best) continue;
        if (count === 1) wins[p]++;
        else ties[p]++;
        share[p] += s;
        shareSq[p] += s * s;
      }
    }
    return t >= trials;
  };

  return {
    step,
    get done() {
      return t >= trials;
    },
    result(): MultiwayEquity {
      const players = [];
      for (let p = 0; p < n; p++) {
        const mean = share[p] / t;
        const variance = t > 1 ? Math.max(0, (shareSq[p] - t * mean * mean) / (t - 1)) : 0;
        players.push({ equity: mean, win: wins[p] / t, tie: ties[p] / t, stdErr: Math.sqrt(variance / t) });
      }
      return { players, samples: t, exact: false, acceptance: j.acceptance() };
    },
  };
}

/** Draws `count` joint holdings from the joint posterior (for grading's particle model): combos[k][i] is
 *  opponent k's combo in draw i. `blocked` = every known card (hero, board, dead). Seeded. Acceptance is
 *  accepted / attempted joint draws (NaN when count is 0); throws below ~0.1% like multiwayEquity. */
export function sampleJoint(
  ranges: readonly Weights[],
  blocked: readonly Card[],
  count: number,
  seed: number,
): { combos: Int16Array[]; acceptance: number } {
  if (!Number.isInteger(count) || count < 0) throw new Error(`count must be a non-negative integer, got ${count}`);
  const j = jointDrawer(ranges, blocked, seed);
  const combos = ranges.map(() => new Int16Array(count));
  for (let i = 0; i < count; i++) {
    j.draw();
    for (let k = 0; k < ranges.length; k++) combos[k][i] = j.drawn[k];
  }
  return { combos, acceptance: j.acceptance() };
}
