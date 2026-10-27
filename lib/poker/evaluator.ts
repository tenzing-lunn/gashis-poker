// 5/6/7-card hand evaluator: additive rank key + perfect hash for non-flush hands,
// a 13-bit rank-mask table for flushes. See README.md for the full design.
//
// Value scale: 1..7462, higher = stronger, equal = exact tie (7462 = number of distinct 5-card hands).

import { assertDistinct, formatCard, type Card } from "./cards";

export type HandCategory =
  | "high card"
  | "pair"
  | "two pair"
  | "trips"
  | "straight"
  | "flush"
  | "full house"
  | "quads"
  | "straight flush";

export const HAND_CATEGORIES: readonly HandCategory[] = [
  "high card",
  "pair",
  "two pair",
  "trips",
  "straight",
  "flush",
  "full house",
  "quads",
  "straight flush",
];

export const HAND_VALUE_COUNT = 7462;

// ---------------------------------------------------------------------------
// Per-card tables (exported for hot loops in equity.ts; treat as read-only).

/** 5^rank. Counts per rank are <= 4, so a sum of these is the base-5 digit string of the rank multiset. */
export const CARD_KEY = new Int32Array(52);
/** One 4-bit counter per suit: 1 << (4 * suit). */
export const CARD_SUIT = new Int32Array(52);
/** Rank bit in the 13-bit mask of its suit, packed two suits per int32: clubs/diamonds in LO, hearts/spades in HI. */
export const CARD_LO = new Int32Array(52);
export const CARD_HI = new Int32Array(52);

for (let c = 0; c < 52; c++) {
  const rank = c >> 2;
  const suit = c & 3;
  CARD_KEY[c] = 5 ** rank;
  CARD_SUIT[c] = 1 << (4 * suit);
  const bit = (1 << rank) << ((suit & 1) * 16);
  if (suit < 2) CARD_LO[c] = bit;
  else CARD_HI[c] = bit;
}

// ---------------------------------------------------------------------------
// Reference scoring used only to build the tables.
// A "raw score" is category * 13^5 + kickers in base 13, so integer order = poker order.

const B13 = [28561, 2197, 169, 13, 1]; // 13^4 .. 13^0

function raw(category: number, kickers: number[]): number {
  let s = category * 371293; // 13^5
  for (let i = 0; i < kickers.length; i++) s += kickers[i] * B13[i];
  return s;
}

/** Top rank of the best straight in a 13-bit rank mask, or -1. The wheel A-2-3-4-5 has top rank 3 (the five). */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    const run = 0x1f << (top - 4);
    if ((mask & run) === run) return top;
  }
  return (mask & 0x100f) === 0x100f ? 3 : -1;
}

function topBits(mask: number, n: number, exclude: number[] = []): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) {
    if (mask & (1 << r) && !exclude.includes(r)) out.push(r);
  }
  return out;
}

/** Best non-flush 5-card raw score of a rank multiset (counts[r] in 0..4, total 5..7). */
function scoreCounts(counts: number[]): number {
  let present = 0;
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] >= 1) present |= 1 << r;
    if (counts[r] >= 4) quads.push(r);
    if (counts[r] >= 3) trips.push(r);
    if (counts[r] >= 2) pairs.push(r);
  }
  if (quads.length) return raw(7, [quads[0], ...topBits(present, 1, [quads[0]])]);
  if (trips.length) {
    const pair = pairs.find((r) => r !== trips[0]);
    if (pair !== undefined) return raw(6, [trips[0], pair]);
  }
  const st = straightTop(present);
  if (st >= 0) return raw(4, [st]);
  if (trips.length) return raw(3, [trips[0], ...topBits(present, 2, [trips[0]])]);
  if (pairs.length >= 2) return raw(2, [pairs[0], pairs[1], ...topBits(present, 1, [pairs[0], pairs[1]])]);
  if (pairs.length === 1) return raw(1, [pairs[0], ...topBits(present, 3, [pairs[0]])]);
  return raw(0, topBits(present, 5));
}

/** Best flush/straight-flush raw score of a suited rank mask with >= 5 bits. */
function scoreFlushMask(mask: number): number {
  const st = straightTop(mask);
  return st >= 0 ? raw(8, [st]) : raw(5, topBits(mask, 5));
}

const popcount = (x: number): number => {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
};

// ---------------------------------------------------------------------------
// Table construction (runs once at module load).

// Perfect hash for the 73,775 non-flush rank multisets of size 5, 6 or 7 (6,175 + 18,395 + 49,205).
// "Hash and displace": mix the key, multiply by an odd constant (a bijection on uint32, so distinct
// keys never collide completely); low bits pick a bucket, high bits a slot; each bucket stores a
// displacement d (0..255; the largest needed is 39) that is XORed into its slots so every key lands alone.
const SLOT_BITS = 17;
const BUCKET_BITS = 15;
const HASH_MUL = 0x9e3779b1;

export const NONFLUSH_TABLE = new Uint16Array(1 << SLOT_BITS);
export const DISPLACEMENT = new Uint8Array(1 << BUCKET_BITS);
export const FLUSH_TABLE = new Uint16Array(1 << 13);
/** CATEGORY_START[i] = smallest hand value in category i. */
export const CATEGORY_START = new Uint16Array(9);

function hashProduct(key: number): number {
  return Math.imul(key ^ (key >>> 15), HASH_MUL) >>> 0;
}

function buildTables(): void {
  // 1. Every distinct 5-card hand class, sorted weakest -> strongest, gives the dense value scale.
  const classScores: number[] = [];
  const nonflushKeys: number[] = [];
  const nonflushScores: number[] = [];
  const counts = new Array<number>(13).fill(0);
  const walk = (rank: number, size: number, key: number): void => {
    if (rank === 13) {
      if (size >= 5) {
        const s = scoreCounts(counts);
        nonflushKeys.push(key);
        nonflushScores.push(s);
        if (size === 5) classScores.push(s);
      }
      return;
    }
    for (let c = 0; c <= 4 && size + c <= 7; c++) {
      counts[rank] = c;
      walk(rank + 1, size + c, key + c * 5 ** rank);
    }
    counts[rank] = 0;
  };
  walk(0, 0, 0);
  for (let mask = 0; mask < 1 << 13; mask++) if (popcount(mask) === 5) classScores.push(scoreFlushMask(mask));

  const sorted = Array.from(new Set(classScores)).sort((a, b) => a - b);
  if (sorted.length !== HAND_VALUE_COUNT) throw new Error(`expected 7462 hand classes, got ${sorted.length}`);
  const dense = new Map<number, number>();
  sorted.forEach((s, i) => dense.set(s, i + 1));
  for (let i = sorted.length - 1; i >= 0; i--) CATEGORY_START[Math.floor(sorted[i] / 371293)] = i + 1;

  // 2. Flush table: any mask with >= 5 suited cards.
  for (let mask = 0; mask < 1 << 13; mask++) {
    if (popcount(mask) >= 5) FLUSH_TABLE[mask] = dense.get(scoreFlushMask(mask))!;
  }

  // 3. Perfect hash for non-flush keys. Place the biggest buckets first (they are hardest to fit).
  const buckets: number[][] = Array.from({ length: 1 << BUCKET_BITS }, () => []);
  for (let i = 0; i < nonflushKeys.length; i++) {
    buckets[hashProduct(nonflushKeys[i]) & ((1 << BUCKET_BITS) - 1)].push(i);
  }
  const order = buckets.map((_, b) => b).filter((b) => buckets[b].length > 0);
  order.sort((x, y) => buckets[y].length - buckets[x].length || x - y);
  const used = new Uint8Array(1 << SLOT_BITS);
  for (const b of order) {
    const items = buckets[b];
    const base = items.map((i) => hashProduct(nonflushKeys[i]) >>> (32 - SLOT_BITS));
    let d = 0;
    for (; d < 256; d++) {
      let ok = true;
      for (let j = 0; j < base.length && ok; j++) if (used[base[j] ^ d]) ok = false;
      if (ok) break;
    }
    if (d === 256) throw new Error("perfect hash construction failed");
    DISPLACEMENT[b] = d;
    for (let j = 0; j < items.length; j++) {
      used[base[j] ^ d] = 1;
      NONFLUSH_TABLE[base[j] ^ d] = dense.get(nonflushScores[items[j]])!;
    }
  }
}

buildTables();

// ---------------------------------------------------------------------------
// Evaluation.

/**
 * Evaluates a hand from its accumulated state: key = sum of CARD_KEY, suits = sum of CARD_SUIT,
 * lo/hi = OR of CARD_LO/CARD_HI. All four are additive/OR-able, so a board's state can be computed
 * once and hole cards added on top (incremental evaluation).
 */
export function evaluateState(key: number, suits: number, lo: number, hi: number): number {
  // Adding 3 to each 4-bit suit counter sets its top bit iff that suit has >= 5 cards.
  const flush = (suits + 0x3333) & 0x8888;
  if (flush !== 0) {
    const suit = (31 - Math.clz32(flush)) >> 2;
    const word = suit < 2 ? lo : hi;
    return FLUSH_TABLE[(word >>> ((suit & 1) << 4)) & 0x1fff];
  }
  const p = Math.imul(key ^ (key >>> 15), HASH_MUL) >>> 0;
  return NONFLUSH_TABLE[(p >>> (32 - SLOT_BITS)) ^ DISPLACEMENT[p & ((1 << BUCKET_BITS) - 1)]];
}

// A flush with 7 cards can never coexist with quads or a full house (that needs 3+ cards
// outside the flush suit), so when the flush test fires, the flush table's answer is the best hand.

export function evaluate5(a: Card, b: Card, c: Card, d: Card, e: Card): number {
  return evaluateState(
    CARD_KEY[a] + CARD_KEY[b] + CARD_KEY[c] + CARD_KEY[d] + CARD_KEY[e],
    CARD_SUIT[a] + CARD_SUIT[b] + CARD_SUIT[c] + CARD_SUIT[d] + CARD_SUIT[e],
    CARD_LO[a] | CARD_LO[b] | CARD_LO[c] | CARD_LO[d] | CARD_LO[e],
    CARD_HI[a] | CARD_HI[b] | CARD_HI[c] | CARD_HI[d] | CARD_HI[e],
  );
}

export function evaluate6(a: Card, b: Card, c: Card, d: Card, e: Card, f: Card): number {
  return evaluateState(
    CARD_KEY[a] + CARD_KEY[b] + CARD_KEY[c] + CARD_KEY[d] + CARD_KEY[e] + CARD_KEY[f],
    CARD_SUIT[a] + CARD_SUIT[b] + CARD_SUIT[c] + CARD_SUIT[d] + CARD_SUIT[e] + CARD_SUIT[f],
    CARD_LO[a] | CARD_LO[b] | CARD_LO[c] | CARD_LO[d] | CARD_LO[e] | CARD_LO[f],
    CARD_HI[a] | CARD_HI[b] | CARD_HI[c] | CARD_HI[d] | CARD_HI[e] | CARD_HI[f],
  );
}

export function evaluate7(a: Card, b: Card, c: Card, d: Card, e: Card, f: Card, g: Card): number {
  const suits =
    CARD_SUIT[a] + CARD_SUIT[b] + CARD_SUIT[c] + CARD_SUIT[d] + CARD_SUIT[e] + CARD_SUIT[f] + CARD_SUIT[g];
  const key = CARD_KEY[a] + CARD_KEY[b] + CARD_KEY[c] + CARD_KEY[d] + CARD_KEY[e] + CARD_KEY[f] + CARD_KEY[g];
  if (((suits + 0x3333) & 0x8888) === 0) {
    const p = Math.imul(key ^ (key >>> 15), HASH_MUL) >>> 0;
    return NONFLUSH_TABLE[(p >>> (32 - SLOT_BITS)) ^ DISPLACEMENT[p & ((1 << BUCKET_BITS) - 1)]];
  }
  return evaluateState(
    key,
    suits,
    CARD_LO[a] | CARD_LO[b] | CARD_LO[c] | CARD_LO[d] | CARD_LO[e] | CARD_LO[f] | CARD_LO[g],
    CARD_HI[a] | CARD_HI[b] | CARD_HI[c] | CARD_HI[d] | CARD_HI[e] | CARD_HI[f] | CARD_HI[g],
  );
}

/**
 * Evaluates 5, 6 or 7 distinct cards. Validates its input (throws on a bad count, an invalid id or
 * a duplicate); the positional evaluate5/6/7 and evaluateState skip all checks for speed.
 */
export function evaluate(cards: readonly Card[]): number {
  if (cards.length < 5 || cards.length > 7) throw new Error(`evaluate needs 5-7 cards, got ${cards.length}`);
  const s = handState(cards);
  return evaluateState(s.key, s.suits, s.lo, s.hi);
}

/** Accumulated state of a partial hand (e.g. a board), for incremental evaluation. */
export interface HandState {
  key: number;
  suits: number;
  lo: number;
  hi: number;
}

/** State of up to 7 distinct cards (throws on an invalid id, a duplicate, or more than 7 cards). */
export function handState(cards: readonly Card[]): HandState {
  if (cards.length > 7) throw new Error(`A hand has at most 7 cards, got ${cards.length}`);
  assertDistinct(cards);
  let key = 0, suits = 0, lo = 0, hi = 0;
  for (const c of cards) {
    key += CARD_KEY[c];
    suits += CARD_SUIT[c];
    lo |= CARD_LO[c];
    hi |= CARD_HI[c];
  }
  return { key, suits, lo, hi };
}

/**
 * Value of a state plus extra cards (typically board state + two hole cards). The lo/hi masks record
 * exactly which cards the state holds, so this can check that the extra cards are valid, not already
 * in the state, and that the total is 5-7 cards.
 */
export function evaluateWith(state: HandState, ...cards: Card[]): number {
  assertDistinct(cards);
  let { key, suits, lo, hi } = state;
  for (const c of cards) {
    if ((lo & CARD_LO[c]) | (hi & CARD_HI[c])) throw new Error(`Duplicate card ${formatCard(c)}`);
    key += CARD_KEY[c];
    suits += CARD_SUIT[c];
    lo |= CARD_LO[c];
    hi |= CARD_HI[c];
  }
  const total = popcount(lo) + popcount(hi);
  if (total < 5 || total > 7) throw new Error(`evaluateWith needs 5-7 cards in total, got ${total}`);
  return evaluateState(key, suits, lo, hi);
}

export function handCategoryIndex(value: number): number {
  if (value < 1 || value > HAND_VALUE_COUNT) throw new Error(`Invalid hand value ${value}`);
  let i = 8;
  while (value < CATEGORY_START[i]) i--;
  return i;
}

export const handCategory = (value: number): HandCategory => HAND_CATEGORIES[handCategoryIndex(value)];
