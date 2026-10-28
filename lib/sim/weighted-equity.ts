// Hero (two known cards) vs ONE weighted range: exact enumeration postflop, seeded Monte Carlo preflop.
//
// A range is a weight per combo (Float64Array(1326), any non-negative scale; inferRange gives one).
// Card removal first: combos that use a hero, board or dead card get weight 0 and the rest are
// normalized, so P(villain holds c) = w_c. The board then completes uniformly from the cards nobody holds.
// Every live combo leaves the same number R of runouts (C(45,2) = 990 on a flop with no dead cards,
// 44 on the turn, 1 on the river), so the joint P(c, runout) = w_c / R and hero's pot share is
//   E = Σ_c w_c · (win_c + tie_c / 2) / R          (heads-up, a tie splits the pot 2 ways)
// with win_c / tie_c the integer counts of runouts hero wins / splits against c. Exact paths keep those
// counts as integers per combo and weight them once at the end.
//
// Flop fast path: the outer loop is the C(47,2) = 1,081 (turn, river) pairs, so hero's hand is evaluated
// once per runout; the inner loop walks the live combos that use neither card (one incremental lookup
// each, about 1.1M for a full range). Turn: 46 river cards outside. River: one pass.
//
// Preflop: equityVsRange draws a combo ∝ w (alias table, O(1)), then a uniform 5-card board from the
// remaining cards; comboEquities runs `trialsPerCombo` boards for every live combo instead. Both report
// the standard error of the mean of the per-trial pot share.

import { assertDistinct, createRng, type Card, type Rng } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO, choose } from "../poker/combinatorics";
import { CARD_HI, CARD_KEY, CARD_LO, CARD_SUIT, evaluateState, handState } from "../poker/evaluator";

// Local aliases: imported bindings are property reads under Vitest/Turbopack (see lib/poker/README.md).
const KEY = CARD_KEY, SUIT = CARD_SUIT, LO = CARD_LO, HI = CARD_HI, C_HI = COMBO_HI, C_LO = COMBO_LO;
const evalState = evaluateState;

/** Weight per combo, length 1326, non-negative, any scale. */
export type Weights = Float64Array;

/** Preflop equityVsRange trials: worst-case stdErr sqrt(0.25 / 200k) ≈ 0.0011. */
export const DEFAULT_TRIALS = 200_000;
/** Preflop comboEquities boards per combo: per-combo stdErr up to ≈ 0.035. */
export const DEFAULT_TRIALS_PER_COMBO = 200;

export interface RangeEquityOptions {
  /** Cards known to be out of play (removed from the range and from the runouts). */
  dead?: readonly Card[];
  /** Preflop Monte Carlo trials (default DEFAULT_TRIALS). Ignored postflop, which is exact. */
  trials?: number;
  seed?: number;
}

/** Zeroes combos blocked by `blocked` cards, normalizes to sum 1. Throws if empty. */
export function liveWeights(weights: Weights, blocked: readonly Card[]): Float64Array {
  if (weights.length !== COMBO_COUNT) throw new Error(`Weights need ${COMBO_COUNT} entries, got ${weights.length}`);
  const dead = new Uint8Array(52);
  for (const c of blocked) {
    if (!Number.isInteger(c) || c < 0 || c > 51) throw new Error(`Invalid card id ${c}`);
    dead[c] = 1;
  }
  const out = new Float64Array(COMBO_COUNT);
  let total = 0;
  for (let c = 0; c < COMBO_COUNT; c++) {
    const w = weights[c];
    if (!(w >= 0) || w === Infinity) throw new Error(`Invalid weight ${w} for combo ${c}`);
    if (w === 0 || dead[C_HI[c]] || dead[C_LO[c]]) continue;
    out[c] = w;
    total += w;
  }
  if (total === 0) throw new Error("Range is empty after card removal");
  for (let c = 0; c < COMBO_COUNT; c++) out[c] /= total;
  return out;
}

/** Combos with positive weight, ascending. */
function positive(w: Float64Array): Int32Array {
  let n = 0;
  for (let c = 0; c < COMBO_COUNT; c++) if (w[c] > 0) n++;
  const out = new Int32Array(n);
  for (let c = 0, i = 0; c < COMBO_COUNT; c++) if (w[c] > 0) out[i++] = c;
  return out;
}

/**
 * Validates hero / board / dead (2 hero cards, a board of 0 or 3-5 cards, all distinct) and returns
 * every known card: the cards a range must not use. Shared with multiway.ts.
 */
export function knownCards(hero: readonly [Card, Card], board: readonly Card[], dead: readonly Card[] = []): Card[] {
  if (hero.length !== 2) throw new Error(`Hero needs exactly 2 cards, got ${hero.length}`);
  if (board.length > 5 || board.length === 1 || board.length === 2) {
    throw new Error(`Board must have 0 or 3-5 cards, got ${board.length}`);
  }
  const known = [...hero, ...board, ...dead];
  assertDistinct(known);
  return known;
}

// ---------------------------------------------------------------------------
// Alias table (Walker / Vose): O(1) draws from a discrete distribution over combos.

/** Draws combos ∝ weight: `combos[i]` with prob `prob[i]`, else `combos[alias[i]]`, for uniform i. */
export interface ComboSampler {
  /** Combos with positive weight, ascending. */
  combos: Int32Array;
  prob: Float64Array;
  alias: Int32Array;
}

/** Builds an alias table over the combos with positive weight (weights need not be normalized). */
export function comboSampler(weights: Float64Array): ComboSampler {
  const combos = positive(weights);
  const n = combos.length;
  if (n === 0) throw new Error("Range is empty");
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[combos[i]];
  const scaled = new Float64Array(n), prob = new Float64Array(n), alias = new Int32Array(n);
  const small: number[] = [], large: number[] = [];
  for (let i = 0; i < n; i++) {
    scaled[i] = (weights[combos[i]] * n) / total;
    (scaled[i] < 1 ? small : large).push(i);
  }
  while (small.length > 0 && large.length > 0) {
    const s = small.pop()!, l = large.pop()!;
    prob[s] = scaled[s];
    alias[s] = l;
    scaled[l] = scaled[l] + scaled[s] - 1;
    (scaled[l] < 1 ? small : large).push(l);
  }
  // Leftovers are 1 up to rounding.
  for (const i of [...large, ...small]) {
    prob[i] = 1;
    alias[i] = i;
  }
  return { combos, prob, alias };
}

/** One draw from a sampler (two rng calls). */
export function drawCombo(s: ComboSampler, rng: Rng): number {
  const i = rng.int(s.combos.length);
  return rng.next() < s.prob[i] ? s.combos[i] : s.combos[s.alias[i]];
}

// ---------------------------------------------------------------------------
// Exact enumeration core: integer win/tie counts per live combo, one outer runout per work unit.

interface ExactCounts {
  /** Live combos (index i below refers to live[i]). */
  live: Int32Array;
  win: Int32Array;
  tie: Int32Array;
  /** Runouts each live combo sees. */
  perCombo: number;
  step(units: number): boolean;
  readonly done: boolean;
}

function exactCounts(hero: readonly [Card, Card], board: readonly Card[], known: readonly Card[], live: Int32Array): ExactCounts {
  const used = new Uint8Array(52);
  for (const c of known) used[c] = 1;
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
  const toDeal = 5 - board.length;
  const m = deck.length;
  if (m - 2 < toDeal) throw new Error("Not enough cards left to complete the board");

  // Outer runouts: (turn, river) pairs on the flop, river cards on the turn, one empty runout on the river.
  const total = toDeal === 2 ? (m * (m - 1)) / 2 : toDeal === 1 ? m : 1;
  const runA = new Int32Array(total).fill(-1), runB = new Int32Array(total).fill(-1);
  if (toDeal === 2) {
    for (let i = 0, u = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++, u++) {
        runA[u] = deck[i];
        runB[u] = deck[j];
      }
    }
  } else if (toDeal === 1) {
    for (let i = 0; i < m; i++) runA[i] = deck[i];
  }

  const n = live.length;
  const ca = new Int32Array(n), cb = new Int32Array(n);
  const ck = new Int32Array(n), cs = new Int32Array(n), cl = new Int32Array(n), ch = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const a = C_HI[live[i]], b = C_LO[live[i]];
    ca[i] = a;
    cb[i] = b;
    ck[i] = KEY[a] + KEY[b];
    cs[i] = SUIT[a] + SUIT[b];
    cl[i] = LO[a] | LO[b];
    ch[i] = HI[a] | HI[b];
  }
  const st = handState(board);
  const bk = st.key, bs = st.suits, bl = st.lo, bh = st.hi;
  const [h0, h1] = hero;
  const hk = KEY[h0] + KEY[h1], hs = SUIT[h0] + SUIT[h1], hl = LO[h0] | LO[h1], hh = HI[h0] | HI[h1];
  const win = new Int32Array(n), tie = new Int32Array(n);
  let next = 0;

  const step = (units: number): boolean => {
    const end = Math.min(total, next + Math.max(0, Math.floor(units)));
    for (let u = next; u < end; u++) {
      const t = runA[u], r = runB[u];
      let key = bk, suits = bs, lo = bl, hi = bh;
      if (t >= 0) {
        key += KEY[t];
        suits += SUIT[t];
        lo |= LO[t];
        hi |= HI[t];
      }
      if (r >= 0) {
        key += KEY[r];
        suits += SUIT[r];
        lo |= LO[r];
        hi |= HI[r];
      }
      const hv = evalState(key + hk, suits + hs, lo | hl, hi | hh);
      for (let i = 0; i < n; i++) {
        const a = ca[i], b = cb[i];
        if (a === t || a === r || b === t || b === r) continue;
        const v = evalState(key + ck[i], suits + cs[i], lo | cl[i], hi | ch[i]);
        if (hv > v) win[i]++;
        else if (hv === v) tie[i]++;
      }
    }
    next = end;
    return next >= total;
  };

  return {
    live,
    win,
    tie,
    perCombo: choose(m - 2, toDeal),
    step,
    get done() {
      return next >= total;
    },
  };
}

// ---------------------------------------------------------------------------
// Per-combo equities

/** Hero's pot share vs every combo. Exact when board has 3–5 cards (enumerate all runouts per combo).
 *  Preflop: per-combo Monte Carlo with `trialsPerCombo` boards (default 200), seeded; stdErr per combo given. */
export interface ComboEquities {
  /** hero equity vs combo c, NaN where weight is 0 / combo is blocked */
  equity: Float64Array;
  /** P(hero strictly best) / P(split) vs combo c, NaN like `equity` */
  win: Float64Array;
  tie: Float64Array;
  /** per-combo standard error (all 0 when exact; 0 for blocked / zero-weight combos) */
  stdErr: Float64Array;
  exact: boolean;
  samplesPerCombo: number;
}

export function comboEquities(
  hero: readonly [Card, Card],
  board: readonly Card[],
  weights: Weights,
  options: { dead?: readonly Card[]; trialsPerCombo?: number; seed?: number } = {},
): ComboEquities {
  const known = knownCards(hero, board, options.dead);
  const live = positive(liveWeights(weights, known));
  const equity = new Float64Array(COMBO_COUNT).fill(NaN);
  const win = new Float64Array(COMBO_COUNT).fill(NaN);
  const tie = new Float64Array(COMBO_COUNT).fill(NaN);
  const stdErr = new Float64Array(COMBO_COUNT);

  if (board.length >= 3) {
    const ex = exactCounts(hero, board, known, live);
    ex.step(Infinity);
    const R = ex.perCombo;
    for (let i = 0; i < live.length; i++) {
      const c = live[i];
      win[c] = ex.win[i] / R;
      tie[c] = ex.tie[i] / R;
      equity[c] = (2 * ex.win[i] + ex.tie[i]) / (2 * R);
    }
    return { equity, win, tie, stdErr, exact: true, samplesPerCombo: R };
  }

  const trials = options.trialsPerCombo ?? DEFAULT_TRIALS_PER_COMBO;
  if (!Number.isInteger(trials) || trials < 1) throw new Error(`trialsPerCombo must be a positive integer, got ${trials}`);
  const rng = createRng(options.seed ?? 1);
  const base = new Uint8Array(52);
  for (const c of known) base[c] = 1;
  const stamp = new Int32Array(52);
  let round = 0;
  const [h0, h1] = hero;
  const hk = KEY[h0] + KEY[h1], hs = SUIT[h0] + SUIT[h1], hl = LO[h0] | LO[h1], hh = HI[h0] | HI[h1];

  for (let i = 0; i < live.length; i++) {
    const combo = live[i];
    const a = C_HI[combo], b = C_LO[combo];
    const vk = KEY[a] + KEY[b], vs = SUIT[a] + SUIT[b], vl = LO[a] | LO[b], vh = HI[a] | HI[b];
    let wins = 0, ties = 0;
    for (let t = 0; t < trials; t++) {
      round++;
      stamp[a] = stamp[b] = round;
      let key = 0, suits = 0, lo = 0, hi = 0;
      for (let k = 0; k < 5; k++) {
        let c: number;
        do c = rng.int(52);
        while (base[c] || stamp[c] === round);
        stamp[c] = round;
        key += KEY[c];
        suits += SUIT[c];
        lo |= LO[c];
        hi |= HI[c];
      }
      const hv = evalState(key + hk, suits + hs, lo | hl, hi | hh);
      const v = evalState(key + vk, suits + vs, lo | vl, hi | vh);
      if (hv > v) wins++;
      else if (hv === v) ties++;
    }
    // Per-trial share is 1, 1/2 or 0: sum = wins + ties/2, sum of squares = wins + ties/4.
    const mean = (wins + ties / 2) / trials;
    const variance = trials > 1 ? Math.max(0, (wins + ties / 4 - trials * mean * mean) / (trials - 1)) : 0;
    win[combo] = wins / trials;
    tie[combo] = ties / trials;
    equity[combo] = mean;
    stdErr[combo] = Math.sqrt(variance / trials);
  }
  return { equity, win, tie, stdErr, exact: false, samplesPerCombo: trials };
}

// ---------------------------------------------------------------------------
// Hero vs the whole range

export interface WeightedEquity {
  equity: number;
  win: number;
  tie: number;
  stdErr: number;
  exact: boolean;
  /** exact: runouts per combo (990 flop, 44 turn, 1 river); MC: trials */
  samples: number;
  /** live combos with weight > 0 after removal */
  combos: number;
}

/** Incremental run: call step(units) until it returns true (each call does at most `units` work: outer
 *  runouts for exact, trials for MC). result() is valid at any time for MC (unbiased running estimate;
 *  NaN before the first trial) and only once done for exact (throws before). */
export interface EquityRun {
  step(units: number): boolean;
  result(): WeightedEquity;
  readonly done: boolean;
}

/** Hero vs a weighted range. Postflop: exact (Σ w_c·eq_c over live combos). Preflop: weighted Monte Carlo
 *  (draw combo ∝ w, then a uniform 5-card board), default 200k trials. */
export function equityVsRange(
  hero: readonly [Card, Card],
  weights: Weights,
  board: readonly Card[],
  options: RangeEquityOptions = {},
): WeightedEquity {
  const run = startEquityVsRange(hero, weights, board, options);
  run.step(Infinity);
  return run.result();
}

/** Incremental equityVsRange: same inputs, same result once done (any split of the work). */
export function startEquityVsRange(
  hero: readonly [Card, Card],
  weights: Weights,
  board: readonly Card[],
  options: RangeEquityOptions = {},
): EquityRun {
  const known = knownCards(hero, board, options.dead);
  const w = liveWeights(weights, known);

  if (board.length >= 3) {
    const ex = exactCounts(hero, board, known, positive(w));
    return {
      step: ex.step,
      get done() {
        return ex.done;
      },
      result(): WeightedEquity {
        if (!ex.done) throw new Error("Exact equity is only available once the run is done");
        let sw = 0, st = 0;
        for (let i = 0; i < ex.live.length; i++) {
          const wc = w[ex.live[i]];
          sw += wc * ex.win[i];
          st += wc * ex.tie[i];
        }
        const R = ex.perCombo;
        return { equity: (2 * sw + st) / (2 * R), win: sw / R, tie: st / R, stdErr: 0, exact: true, samples: R, combos: ex.live.length };
      },
    };
  }

  const trials = options.trials ?? DEFAULT_TRIALS;
  if (!Number.isInteger(trials) || trials < 1) throw new Error(`trials must be a positive integer, got ${trials}`);
  const rng = createRng(options.seed ?? 1);
  const { combos, prob, alias } = comboSampler(w);
  const n = combos.length;
  const base = new Uint8Array(52);
  for (const c of known) base[c] = 1;
  const stamp = new Int32Array(52);
  const [h0, h1] = hero;
  const hk = KEY[h0] + KEY[h1], hs = SUIT[h0] + SUIT[h1], hl = LO[h0] | LO[h1], hh = HI[h0] | HI[h1];
  let t = 0, wins = 0, ties = 0;

  const step = (units: number): boolean => {
    const end = Math.min(trials, t + Math.max(0, Math.floor(units)));
    for (; t < end; t++) {
      const i = rng.int(n);
      const combo = rng.next() < prob[i] ? combos[i] : combos[alias[i]];
      const a = C_HI[combo], b = C_LO[combo];
      const round = t + 1;
      stamp[a] = stamp[b] = round;
      let key = 0, suits = 0, lo = 0, hi = 0;
      for (let k = 0; k < 5; k++) {
        let c: number;
        do c = rng.int(52);
        while (base[c] || stamp[c] === round);
        stamp[c] = round;
        key += KEY[c];
        suits += SUIT[c];
        lo |= LO[c];
        hi |= HI[c];
      }
      const hv = evalState(key + hk, suits + hs, lo | hl, hi | hh);
      const v = evalState(key + KEY[a] + KEY[b], suits + SUIT[a] + SUIT[b], lo | LO[a] | LO[b], hi | HI[a] | HI[b]);
      if (hv > v) wins++;
      else if (hv === v) ties++;
    }
    return t >= trials;
  };

  return {
    step,
    get done() {
      return t >= trials;
    },
    result(): WeightedEquity {
      const mean = (wins + ties / 2) / t;
      const variance = t > 1 ? Math.max(0, (wins + ties / 4 - t * mean * mean) / (t - 1)) : 0;
      return { equity: mean, win: wins / t, tie: ties / t, stdErr: Math.sqrt(variance / t), exact: false, samples: t, combos: n };
    },
  };
}
