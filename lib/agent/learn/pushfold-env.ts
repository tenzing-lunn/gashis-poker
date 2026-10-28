// The push/fold environment: the same game as lib/gto/pushfold.ts, played one random deal at a time.
//
// Game (units: big blinds). SB posts 0.5, BB posts 1; both start with S bb including the blind. SB folds
// (SB nets -0.5) or shoves all-in. Facing the shove BB folds (SB nets +1) or calls; then a real board is
// dealt and the showdown decides: SB nets +S on a win, 0 on a tie, -S on a loss. BB nets the negative.
//
// One EPISODE = one deal: 4 hole cards from a seeded shuffle, at most two decisions, one REWARD at the end.
// Unlike the solver, which works with the average equity E_ij of class i against class j, an episode's reward
// is the realised result of five random board cards, so a learner sees what a player sees: AA can lose 20 bb.
// The average of that reward over deals is exactly the solver's value (see the test), so the two measure the
// same game. An optional "expected" mode replaces the showdown by its class-level mean S (2 E_ij - 1), to
// show how much of the learning time the card variance costs.
//
// Observation. Each player sees only its own hand class and the stack, turned into a few numbers (features):
// high rank, low rank, suited, pair, gap (high minus low rank), log stack. Every class gets its own vector, so
// per-class probabilities are well defined, and a net reading them can generalise from AKo to AQo and from
// 10 bb to 11 bb. The gap is a linear function of the ranks, so in principle redundant, but handing it to
// the net directly helped it see connectors (it lowered the expected-reward floor from 0.010 to 0.008 bb).

import { HAND_CLASSES } from "../../poker/combinatorics";
import type { Rng } from "../../poker/cards";
import { evaluate7 } from "../../poker/evaluator";
import { CLASS_COUNT, preflopMatrix } from "../../gto/preflop-matrix";

/** high rank, low rank, suited, pair, gap, log stack */
export const FEATURE_COUNT = 6;

/** Stack depths the learner trains on (bb, including the blind). */
export const STACK_MIN = 2;
export const STACK_MAX = 25;

export type RewardMode = "showdown" | "expected";

/** HAND_CLASSES index of two hole cards (card id = 4 * rank + suit). Row-major 13x13 grid, AA = 0, 22 = 168. */
export function classIndexOf(c1: number, c2: number): number {
  const r1 = c1 >> 2, r2 = c2 >> 2;
  const hi = r1 > r2 ? r1 : r2, lo = r1 > r2 ? r2 : r1;
  if (hi === lo) return (12 - hi) * 14;
  // Suited classes sit above the diagonal (row = high rank), offsuit below it (row = low rank).
  return (c1 & 3) === (c2 & 3) ? (12 - hi) * 13 + (12 - lo) : (12 - lo) * 13 + (12 - hi);
}

/** Writes the observation for hand class `cls` at stack `stack` into out[0..5]. */
export function writeFeatures(cls: number, stack: number, out: Float64Array): Float64Array {
  const h = HAND_CLASSES[cls];
  out[0] = (h.hi - 6) / 6; // ranks 0 (deuce) .. 12 (ace) mapped to -1 .. 1
  out[1] = (h.lo - 6) / 6;
  out[2] = h.kind === "suited" ? 1 : 0;
  out[3] = h.kind === "pair" ? 1 : 0;
  out[4] = (h.hi - h.lo) / 12;
  out[5] = Math.log(stack / 7); // about -1.25 at 2 bb and +1.27 at 25 bb
  return out;
}

/** SB's net result in bb. sbShare = SB's share of the pot at showdown (1, 0.5 or 0; or its expectation). */
export function sbResult(stack: number, shove: boolean, call: boolean, sbShare: number): number {
  if (!shove) return -0.5;
  if (!call) return 1;
  return stack * (2 * sbShare - 1);
}

/** Deals hole cards and, on request, a board, from one reusable deck. Partial Fisher-Yates: uniform and cheap. */
export interface Dealer {
  /** deck[0], deck[1] = SB's cards; deck[2], deck[3] = BB's cards. */
  readonly deck: Int32Array;
  dealHoles(): void;
  /** Deals five board cards (deck[4..8]) and returns SB's share of the pot: 1, 0.5 or 0. */
  showdown(): number;
}

export function createDealer(rng: Rng): Dealer {
  const deck = new Int32Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;
  // Swapping position i with a uniform position in [i, 52) for i = 0..k-1 makes deck[0..k-1] a uniform random
  // ordered draw of k cards, whatever order the deck was left in by the previous deal.
  const draw = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const j = i + rng.int(52 - i);
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
  };
  return {
    deck,
    dealHoles: () => draw(0, 4),
    showdown() {
      draw(4, 9);
      const d = deck;
      const sb = evaluate7(d[0], d[1], d[4], d[5], d[6], d[7], d[8]);
      const bb = evaluate7(d[2], d[3], d[4], d[5], d[6], d[7], d[8]);
      return sb > bb ? 1 : sb === bb ? 0.5 : 0;
    },
  };
}

/** SB's expected share of the pot for class i against class j (the solver's E_ij), for "expected" mode. */
export function classEquity(sbClass: number, bbClass: number): number {
  return preflopMatrix().equity[sbClass * CLASS_COUNT + bbClass];
}
