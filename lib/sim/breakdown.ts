// Summaries of a weighted range for the heat map and the "what does the bot have" text.
//
// classShares: weight share of each of the 169 classes (sums to 1). classFrequencies: how much of each
// class is in the range relative to its most likely combo (the heat-map colour). handBuckets: what the
// range holds on this board, in mutually exclusive buckets. topCombos: the heaviest single combos.
//
// handBuckets decides each combo's bucket in this order (R1 > R2 > ... are the board's distinct ranks):
//   1. By the evaluator category of the best five of hole + board: straight flush, quads, full house,
//      flush, straight. A board that already makes one (e.g. five suited cards) puts every combo there.
//   2. Below a straight, only pairs the hole cards make count; the board's own pairs/trips are ignored:
//      set      pocket pair matching a board rank
//      trips    one hole card matching a rank the board has twice
//      two pair both hole cards (different ranks) pair the board
//      overpair pocket pair above R1
//      top pair a hole card pairs R1
//      middle pair  a hole card pairs R2, or a pocket pair between R1 and R2 — only with 3+ distinct
//               board ranks; on a two-rank board (7-7-2) those count as weak pair
//      weak pair any other pair of the hole cards (lower board rank, or a pocket pair below R2)
//      So on 7-7-2, K2 is a weak pair, 99 an overpair, A7 trips, and AK no pair.
//   3. No pair of its own: flush draw (four to a flush with a hole card, including combo draws),
//      straight draw (two or more ranks complete a straight the board doesn't make), gutshot (one rank),
//      overcards (both hole ranks above R1), else air. Draws come from lib/bots/features (none on the river).
// `draws` is the share holding any flush or straight draw (gutshots included), whatever the made hand.

import { formatCard, type Card } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO, HAND_CLASSES, combosOfClass } from "../poker/combinatorics";
import { CARD_HI, CARD_KEY, CARD_LO, CARD_SUIT, evaluateState, handCategoryIndex, handState } from "../poker/evaluator";
import { boardInfo, drawOf } from "../bots/features";
import { liveWeights, type Weights } from "./weighted-equity";

const KEY = CARD_KEY, SUIT = CARD_SUIT, LO = CARD_LO, HI = CARD_HI, C_HI = COMBO_HI, C_LO = COMBO_LO;

export const CLASS_COUNT = 169;

/** HAND_CLASSES index (13x13 row-major from AA) of every combo. */
export const COMBO_CLASS: Uint8Array = (() => {
  const out = new Uint8Array(COMBO_COUNT);
  HAND_CLASSES.forEach((k, i) => {
    for (const c of combosOfClass(k.hi, k.lo, k.kind)) out[c] = i;
  });
  return out;
})();

/** Weight share per HAND_CLASSES index (169, 13x13 row-major from AA, same as lib/poker/combinatorics); sums to 1. */
export function classShares(weights: Weights): Float64Array {
  const w = liveWeights(weights, []);
  const out = new Float64Array(CLASS_COUNT);
  for (let c = 0; c < COMBO_COUNT; c++) out[COMBO_CLASS[c]] += w[c];
  return out;
}

/** Relative frequency per class for a heat map: mean over the class's live combos of w_c / max_c w_c (0..1).
 *  Live = uses no `blocked` card (pass board + hero); blocked combos are left out of the mean, not counted
 *  as 0, and a class with no live combo gets 0. Throws if no live combo has weight. */
export function classFrequencies(weights: Weights, blocked: readonly Card[] = []): Float64Array {
  const w = liveWeights(weights, blocked);
  const dead = new Uint8Array(52);
  for (const c of blocked) dead[c] = 1;
  let max = 0;
  for (let c = 0; c < COMBO_COUNT; c++) if (w[c] > max) max = w[c];
  const sum = new Float64Array(CLASS_COUNT), count = new Float64Array(CLASS_COUNT);
  for (let c = 0; c < COMBO_COUNT; c++) {
    if (dead[C_HI[c]] || dead[C_LO[c]]) continue;
    sum[COMBO_CLASS[c]] += w[c] / max;
    count[COMBO_CLASS[c]]++;
  }
  for (let i = 0; i < CLASS_COUNT; i++) sum[i] = count[i] > 0 ? sum[i] / count[i] : 0;
  return sum;
}

export type Bucket =
  | "straight flush" | "quads" | "full house" | "flush" | "straight" | "set" | "trips" | "two pair"
  | "overpair" | "top pair" | "middle pair" | "weak pair" | "flush draw" | "straight draw" | "gutshot"
  | "overcards" | "air";

/** Strongest first; also the tie-break order of handBuckets. */
export const BUCKETS: readonly Bucket[] = [
  "straight flush", "quads", "full house", "flush", "straight", "set", "trips", "two pair",
  "overpair", "top pair", "middle pair", "weak pair", "flush draw", "straight draw", "gutshot",
  "overcards", "air",
];

// handCategoryIndex: 4 = straight .. 8 = straight flush.
const CATEGORY_BUCKET: Partial<Record<number, Bucket>> = { 8: "straight flush", 7: "quads", 6: "full house", 5: "flush", 4: "straight" };

/** Postflop: mutually exclusive buckets (made hand first; draws only for hands without a pair or better), shares sum to 1,
 *  sorted descending. Also `draws`: total share holding a flush/straight draw regardless of made hand.
 *  Weights are card-removed against the board and renormalized; buckets with zero share are omitted. */
export function handBuckets(weights: Weights, board: readonly Card[]): { buckets: { bucket: Bucket; share: number }[]; draws: number } {
  if (board.length < 3 || board.length > 5) throw new Error(`handBuckets needs a 3-5 card board, got ${board.length}`);
  const w = liveWeights(weights, board);
  const info = boardInfo(board);
  const st = handState(board);
  const cnt = new Int32Array(13);
  for (const c of board) cnt[c >> 2]++;
  const ranks: number[] = [];
  for (let r = 12; r >= 0; r--) if (cnt[r] > 0) ranks.push(r);
  const r1 = ranks[0], r2 = ranks.length >= 3 ? ranks[1] : -1; // r2 = -1: no "middle" on a two-rank board

  const pairOf = (rank: number): Bucket => (rank === r1 ? "top pair" : rank === r2 ? "middle pair" : "weak pair");
  const share = new Float64Array(BUCKETS.length);
  let draws = 0;

  for (let c = 0; c < COMBO_COUNT; c++) {
    if (w[c] === 0) continue;
    const a = C_HI[c], b = C_LO[c];
    const v = evaluateState(st.key + KEY[a] + KEY[b], st.suits + SUIT[a] + SUIT[b], st.lo | LO[a] | LO[b], st.hi | HI[a] | HI[b]);
    const draw = drawOf(info, c);
    if (draw !== "none") draws += w[c];
    const ha = a >> 2, hb = b >> 2; // ha >= hb
    let bucket = CATEGORY_BUCKET[handCategoryIndex(v)];
    if (!bucket) {
      if (ha === hb) {
        if (cnt[ha] === 1) bucket = "set";
        else if (ha > r1) bucket = "overpair";
        else if (ha > r2 && r2 >= 0) bucket = "middle pair";
        else bucket = "weak pair";
      } else if (cnt[ha] >= 2 || cnt[hb] >= 2) bucket = "trips";
      else if (cnt[ha] === 1 && cnt[hb] === 1) bucket = "two pair";
      else if (cnt[ha] === 1) bucket = pairOf(ha);
      else if (cnt[hb] === 1) bucket = pairOf(hb);
      else if (draw === "flush" || draw === "combo") bucket = "flush draw";
      else if (draw === "straight") bucket = "straight draw";
      else if (draw === "gutshot") bucket = "gutshot";
      else if (hb > r1) bucket = "overcards";
      else bucket = "air";
    }
    share[BUCKETS.indexOf(bucket)] += w[c];
  }

  const buckets = BUCKETS.map((bucket, i) => ({ bucket, share: share[i], i }))
    .filter((x) => x.share > 0)
    .sort((x, y) => y.share - x.share || x.i - y.i)
    .map(({ bucket, share }) => ({ bucket, share }));
  return { buckets, draws };
}

/** The `n` heaviest combos (weight > 0), share = normalized weight; label like "AsKd" (higher card first).
 *  Ties: higher combo index first. */
export function topCombos(weights: Weights, n: number): { combo: number; label: string; share: number }[] {
  const w = liveWeights(weights, []);
  const order: number[] = [];
  for (let c = 0; c < COMBO_COUNT; c++) if (w[c] > 0) order.push(c);
  order.sort((x, y) => w[y] - w[x] || y - x);
  return order.slice(0, Math.max(0, n)).map((c) => ({ combo: c, label: formatCard(C_HI[c]) + formatCard(C_LO[c]), share: w[c] }));
}
