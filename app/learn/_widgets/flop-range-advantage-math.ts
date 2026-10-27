// Exact range-vs-range equity on a flop, plus each combo's own equity against the other range.
//
// Weighting matches lib/poker's monteCarloEquity: every pair of non-overlapping combos counts once,
// and every turn+river from the remaining cards is equally likely. We loop over all turn+river
// pairs (C(49,2) = 1,176 of them). For each runout we evaluate every live combo once, sort one
// range's hand values, and count, for each combo of the other range, how many opposing combos it
// beats or ties. Card overlap is handled by inclusion-exclusion with per-card sorted lists.

import type { Card } from "../../../lib/poker/cards";
import { COMBO_HI, COMBO_LO } from "../../../lib/poker/combinatorics";
import { CARD_HI, CARD_KEY, CARD_LO, CARD_SUIT, evaluateState, handState } from "../../../lib/poker/evaluator";
import { removeDeadCards, type Range } from "../../../lib/poker/range";

export interface SideResult {
  /** Combos left after removing the flop cards. */
  combos: number;
  /** The range's equity against the other range (fraction). */
  equity: number;
  /** Each live combo's equity against the other range, aligned with `liveCombos`. */
  perCombo: Float64Array;
  liveCombos: number[];
}

export interface FlopMatchup {
  a: SideResult;
  b: SideResult;
  runouts: number;
}

/** Count of values strictly below v and at most v in sorted arr[start, end). */
function below(arr: Int32Array, start: number, end: number, v: number): number {
  let lo = start, hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo - start;
}
function atMost(arr: Int32Array, start: number, end: number, v: number): number {
  let lo = start, hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo - start;
}

/**
 * Accumulates, for each combo of `hero`, wins + ties/2 and the number of compatible opposing combos,
 * summed over all runouts. Returns nothing; writes into score/count.
 */
function accumulate(
  heroVals: Int32Array, heroLive: Uint8Array, hero: number[],
  villVals: Int32Array, villLive: Uint8Array, vill: number[],
  isVillCombo: Uint8Array, score: Float64Array, count: Float64Array,
  sorted: Int32Array, perCard: Int32Array, offsets: Int32Array, fill: Int32Array,
): void {
  // Sorted values of all live villain combos, and per-card sorted lists.
  let n = 0;
  offsets.fill(0);
  for (let j = 0; j < vill.length; j++) {
    if (!villLive[j]) continue;
    sorted[n++] = villVals[j];
    offsets[COMBO_HI[vill[j]] + 1]++;
    offsets[COMBO_LO[vill[j]] + 1]++;
  }
  for (let c = 0; c < 52; c++) offsets[c + 1] += offsets[c];
  fill.set(offsets.subarray(0, 52));
  for (let j = 0; j < vill.length; j++) {
    if (!villLive[j]) continue;
    perCard[fill[COMBO_HI[vill[j]]]++] = villVals[j];
    perCard[fill[COMBO_LO[vill[j]]]++] = villVals[j];
  }
  sorted.subarray(0, n).sort();
  for (let c = 0; c < 52; c++) perCard.subarray(offsets[c], offsets[c + 1]).sort();

  for (let i = 0; i < hero.length; i++) {
    if (!heroLive[i]) continue;
    const v = heroVals[i];
    const h = COMBO_HI[hero[i]], l = COMBO_LO[hero[i]];
    const same = isVillCombo[hero[i]] ? 1 : 0; // the identical combo shares both cards (and ties)
    const lt = below(sorted, 0, n, v) - below(perCard, offsets[h], offsets[h + 1], v) - below(perCard, offsets[l], offsets[l + 1], v);
    const le =
      atMost(sorted, 0, n, v) - atMost(perCard, offsets[h], offsets[h + 1], v) - atMost(perCard, offsets[l], offsets[l + 1], v) + same;
    const total = n - (offsets[h + 1] - offsets[h]) - (offsets[l + 1] - offsets[l]) + same;
    score[i] += lt + (le - lt) / 2;
    count[i] += total;
  }
}

/** Exact equity of range A vs range B on a three-card flop. Throws if either range is empty after card removal. */
export function flopMatchup(rangeA: Range, rangeB: Range, flop: readonly Card[]): FlopMatchup {
  if (flop.length !== 3) throw new Error("The flop must be exactly 3 cards");
  const fs = handState(flop);
  const A = removeDeadCards(rangeA, flop);
  const B = removeDeadCards(rangeB, flop);
  if (A.length === 0 || B.length === 0) throw new Error("A range is empty after removing the flop cards");

  const inA = new Uint8Array(1326), inB = new Uint8Array(1326);
  for (const c of A) inA[c] = 1;
  for (const c of B) inB[c] = 1;

  const valsA = new Int32Array(A.length), valsB = new Int32Array(B.length);
  const liveA = new Uint8Array(A.length), liveB = new Uint8Array(B.length);
  const scoreA = new Float64Array(A.length), countA = new Float64Array(A.length);
  const scoreB = new Float64Array(B.length), countB = new Float64Array(B.length);
  const maxN = Math.max(A.length, B.length);
  const sorted = new Int32Array(maxN), perCard = new Int32Array(2 * maxN);
  const offsets = new Int32Array(53), fill = new Int32Array(52);

  const onFlop = new Uint8Array(52);
  for (const c of flop) onFlop[c] = 1;
  const rest: number[] = [];
  for (let c = 0; c < 52; c++) if (!onFlop[c]) rest.push(c);

  let runouts = 0;
  for (let x = 0; x < rest.length; x++) {
    for (let y = x + 1; y < rest.length; y++) {
      const t = rest[x], r = rest[y];
      runouts++;
      const key = fs.key + CARD_KEY[t] + CARD_KEY[r];
      const suits = fs.suits + CARD_SUIT[t] + CARD_SUIT[r];
      const lo = fs.lo | CARD_LO[t] | CARD_LO[r];
      const hi = fs.hi | CARD_HI[t] | CARD_HI[r];
      for (let i = 0; i < A.length; i++) {
        const a = COMBO_HI[A[i]], b = COMBO_LO[A[i]];
        liveA[i] = a !== t && a !== r && b !== t && b !== r ? 1 : 0;
        if (liveA[i]) valsA[i] = evaluateState(key + CARD_KEY[a] + CARD_KEY[b], suits + CARD_SUIT[a] + CARD_SUIT[b], lo | CARD_LO[a] | CARD_LO[b], hi | CARD_HI[a] | CARD_HI[b]);
      }
      for (let i = 0; i < B.length; i++) {
        const a = COMBO_HI[B[i]], b = COMBO_LO[B[i]];
        liveB[i] = a !== t && a !== r && b !== t && b !== r ? 1 : 0;
        if (liveB[i]) valsB[i] = evaluateState(key + CARD_KEY[a] + CARD_KEY[b], suits + CARD_SUIT[a] + CARD_SUIT[b], lo | CARD_LO[a] | CARD_LO[b], hi | CARD_HI[a] | CARD_HI[b]);
      }
      accumulate(valsA, liveA, A, valsB, liveB, B, inB, scoreA, countA, sorted, perCard, offsets, fill);
      accumulate(valsB, liveB, B, valsA, liveA, A, inA, scoreB, countB, sorted, perCard, offsets, fill);
    }
  }

  const side = (combos: number[], score: Float64Array, count: Float64Array): SideResult => {
    let s = 0, n = 0;
    const perCombo = new Float64Array(combos.length);
    for (let i = 0; i < combos.length; i++) {
      s += score[i];
      n += count[i];
      perCombo[i] = count[i] > 0 ? score[i] / count[i] : 0;
    }
    if (n === 0) throw new Error("The two ranges share no compatible hands on this flop");
    return { combos: combos.length, equity: s / n, perCombo, liveCombos: combos };
  };
  return { a: side(A, scoreA, countA), b: side(B, scoreB, countB), runouts };
}

/** Share of a side's combos whose own equity is at least `cut` (e.g. 0.8 for "strong"). */
export function shareAtLeast(side: SideResult, cut: number): number {
  let k = 0;
  for (const e of side.perCombo) if (e >= cut) k++;
  return k / side.combos;
}
