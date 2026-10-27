// Equity: exact enumeration over every possible runout, and seeded Monte Carlo for ranges.
//
// Fractions, not percentages: win/tie/equity are in [0, 1].
//   win    = share of runouts the player wins outright
//   tie    = share of runouts the player splits (with any number of others)
//   equity = win + sum over split runouts of 1/(players splitting)   -- the pot share
// Players' equities sum to 1.

import { assertDistinct, createRng, parseCards, type Card } from "./cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO } from "./combinatorics";
import { CARD_HI, CARD_KEY, CARD_LO, CARD_SUIT, evaluateState, handState } from "./evaluator";
import { parseRange, removeDeadCards, type Range } from "./range";

// Bundlers (Vite/Vitest, Turbopack) compile imports into property reads on a module object, which
// V8 can't optimize as well inside hot loops; local aliases avoid a large slowdown there.
const KEY = CARD_KEY, SUIT = CARD_SUIT, LO = CARD_LO, HI = CARD_HI, C_HI = COMBO_HI, C_LO = COMBO_LO;
const evalState = evaluateState;

export interface PlayerEquity {
  win: number;
  tie: number;
  equity: number;
  /** Monte Carlo only: standard error of `equity` (same units). 0 for exact results. */
  stdErr: number;
}

export interface EquityResult {
  players: PlayerEquity[];
  /** Exact: number of runouts enumerated. Monte Carlo: number of trials. */
  samples: number;
  exact: boolean;
}

type CardsInput = readonly Card[] | string;
const toCards = (x: CardsInput): Card[] => (typeof x === "string" ? parseCards(x) : [...x]);

// ---------------------------------------------------------------------------
// Exact enumeration

/**
 * Exact equity of 2-10 known hands. Enumerates every completion of the board from the unseen
 * cards: C(48,5) = 1,712,304 runouts heads-up preflop, 990 on a heads-up flop, 44 on the turn.
 */
export function exactEquity(hands: readonly CardsInput[], board: CardsInput = [], dead: CardsInput = []): EquityResult {
  const holes = hands.map(toCards);
  const boardCards = toCards(board);
  const deadCards = toCards(dead);
  const n = holes.length;
  if (n < 2 || n > 10) throw new Error(`exactEquity needs 2-10 hands, got ${n}`);
  if (holes.some((h) => h.length !== 2)) throw new Error("Each hand must be exactly 2 cards");
  if (boardCards.length > 5) throw new Error("Board has more than 5 cards");
  assertDistinct([...holes.flat(), ...boardCards, ...deadCards]);

  const used = new Uint8Array(52);
  for (const c of [...holes.flat(), ...boardCards, ...deadCards]) used[c] = 1;
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
  const toDeal = 5 - boardCards.length;
  if (deck.length < toDeal) throw new Error("Not enough cards left to complete the board");

  // Hole-card contributions to the additive evaluator state, precomputed once per player.
  const hk = new Int32Array(n), hs = new Int32Array(n), hl = new Int32Array(n), hh = new Int32Array(n);
  holes.forEach(([a, b], p) => {
    hk[p] = KEY[a] + KEY[b];
    hs[p] = SUIT[a] + SUIT[b];
    hl[p] = LO[a] | LO[b];
    hh[p] = HI[a] | HI[b];
  });

  const wins = new Float64Array(n);
  // splits[p * (n + 1) + k] = runouts where p split the pot k ways. Integer counts keep the result exact.
  const splits = new Float64Array(n * (n + 1));
  const values = new Int32Array(n);
  let total = 0;

  const leaf = (key: number, suits: number, lo: number, hi: number): void => {
    let best = 0, count = 0;
    for (let p = 0; p < n; p++) {
      const v = evalState(key + hk[p], suits + hs[p], lo | hl[p], hi | hh[p]);
      values[p] = v;
      if (v > best) {
        best = v;
        count = 1;
      } else if (v === best) count++;
    }
    total++;
    if (count === 1) {
      for (let p = 0; p < n; p++) if (values[p] === best) wins[p]++;
    } else {
      for (let p = 0; p < n; p++) if (values[p] === best) splits[p * (n + 1) + count]++;
    }
  };

  // Depth-first over combinations of `toDeal` cards, carrying the board's evaluator state down.
  const m = deck.length;
  const recurse = (start: number, left: number, key: number, suits: number, lo: number, hi: number): void => {
    if (left === 0) return leaf(key, suits, lo, hi);
    for (let i = start; i <= m - left; i++) {
      const c = deck[i];
      recurse(i + 1, left - 1, key + KEY[c], suits + SUIT[c], lo | LO[c], hi | HI[c]);
    }
  };
  const b = handState(boardCards);
  recurse(0, toDeal, b.key, b.suits, b.lo, b.hi);

  const players: PlayerEquity[] = [];
  for (let p = 0; p < n; p++) {
    let tieCount = 0, tieShare = 0;
    for (let k = 2; k <= n; k++) {
      tieCount += splits[p * (n + 1) + k];
      tieShare += splits[p * (n + 1) + k] / k;
    }
    players.push({ win: wins[p] / total, tie: tieCount / total, equity: (wins[p] + tieShare) / total, stdErr: 0 });
  }
  return { players, samples: total, exact: true };
}

// ---------------------------------------------------------------------------
// Monte Carlo

export interface MonteCarloOptions {
  board?: CardsInput;
  dead?: CardsInput;
  /** Default 200,000: worst-case standard error sqrt(0.25 / n) = 0.11 percentage points. */
  trials?: number;
  seed?: number;
}

export const DEFAULT_TRIALS = 200_000;

/**
 * Monte Carlo equity for 2-10 players, each a range (combo array or range text such as "AsKs",
 * "QQ+, AKs"). Combo arrays are treated as sets (duplicates dropped); `trials` must be a positive integer. Each trial draws one combo per player uniformly from their range; if any cards
 * collide the whole draw is rejected and redrawn, so every compatible combination of hands is
 * equally likely (the same weighting exact range-vs-range enumeration uses). Then the board is
 * completed uniformly from the remaining cards.
 */
export function monteCarloEquity(ranges: readonly (Range | string)[], options: MonteCarloOptions = {}): EquityResult {
  const boardCards = toCards(options.board ?? []);
  const deadCards = toCards(options.dead ?? []);
  const trials = options.trials ?? DEFAULT_TRIALS;
  const rng = createRng(options.seed ?? 1);
  const n = ranges.length;
  if (n < 2 || n > 10) throw new Error(`monteCarloEquity needs 2-10 players, got ${n}`);
  if (boardCards.length > 5) throw new Error("Board has more than 5 cards");
  if (!Number.isInteger(trials) || trials < 1) throw new Error(`trials must be a positive integer, got ${trials}`);
  assertDistinct([...boardCards, ...deadCards]);

  const blocked = [...boardCards, ...deadCards];
  const combos = ranges.map((r, p) => {
    if (typeof r !== "string") {
      for (const c of r) {
        if (!Number.isInteger(c) || c < 0 || c >= COMBO_COUNT) throw new Error(`Player ${p + 1}: invalid combo index ${c}`);
      }
    }
    // A range is a set: duplicate combos in an array are dropped, not treated as extra weight.
    const unique = typeof r === "string" ? parseRange(r) : Array.from(new Set(r));
    const live = removeDeadCards(unique, blocked);
    if (live.length === 0) throw new Error(`Player ${p + 1}'s range is empty after card removal`);
    return Int32Array.from(live);
  });

  const base = new Uint8Array(52);
  for (const c of blocked) base[c] = 1;
  const stamp = new Int32Array(52); // stamp[c] === round  <=>  c is taken in the current draw
  let round = 0;

  const { key: bk, suits: bs, lo: bl, hi: bh } = handState(boardCards);
  const toDeal = 5 - boardCards.length;
  if (52 - blocked.length - 2 * n < toDeal) throw new Error("Not enough cards left to complete the board");

  const holeA = new Int32Array(n), holeB = new Int32Array(n), values = new Int32Array(n);
  const wins = new Float64Array(n), ties = new Float64Array(n), share = new Float64Array(n), shareSq = new Float64Array(n);
  let rejected = 0;

  for (let t = 0; t < trials; t++) {
    // Draw hands until they are mutually compatible.
    for (;;) {
      round++;
      let ok = true;
      for (let p = 0; p < n && ok; p++) {
        const r = combos[p];
        const combo = r[rng.int(r.length)];
        const a = C_HI[combo], b = C_LO[combo];
        if (stamp[a] === round || stamp[b] === round) ok = false;
        else {
          stamp[a] = stamp[b] = round;
          holeA[p] = a;
          holeB[p] = b;
        }
      }
      if (ok) break;
      // Give up if under ~0.1% of draws are compatible (e.g. two players who both hold exactly AsAh).
      if (++rejected > 10_000 + 1000 * t) throw new Error("Ranges are (nearly) incompatible: too many rejected draws");
    }

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

    let best = 0, count = 0;
    for (let p = 0; p < n; p++) {
      const a = holeA[p], b = holeB[p];
      const v = evalState(
        key + KEY[a] + KEY[b],
        suits + SUIT[a] + SUIT[b],
        lo | LO[a] | LO[b],
        hi | HI[a] | HI[b],
      );
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

  const players: PlayerEquity[] = [];
  for (let p = 0; p < n; p++) {
    const mean = share[p] / trials;
    const variance = trials > 1 ? Math.max(0, (shareSq[p] - trials * mean * mean) / (trials - 1)) : 0;
    players.push({ win: wins[p] / trials, tie: ties[p] / trials, equity: mean, stdErr: Math.sqrt(variance / trials) });
  }
  return { players, samples: trials, exact: false };
}
