import { RANK_CHARS, makeCard, type Card } from "./cards";

// n choose k, exact for the sizes poker needs (C(52,7) = 133,784,560 fits in a double).
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

// ---------------------------------------------------------------------------
// Two-card combos. A combo is an index 0..1325: for cards x > y, index = x(x-1)/2 + y
// (the position of {x, y} in colexicographic order), so 1326 = C(52, 2) indices with no gaps.

export const COMBO_COUNT = 1326;
export const COMBO_HI = new Uint8Array(COMBO_COUNT);
export const COMBO_LO = new Uint8Array(COMBO_COUNT);
for (let x = 1; x < 52; x++) {
  for (let y = 0; y < x; y++) {
    const i = (x * (x - 1)) / 2 + y;
    COMBO_HI[i] = x;
    COMBO_LO[i] = y;
  }
}

export function comboIndex(a: Card, b: Card): number {
  if (a === b) throw new Error("A combo needs two different cards");
  return a > b ? (a * (a - 1)) / 2 + b : (b * (b - 1)) / 2 + a;
}

/** The two cards of a combo, higher card id first. */
export const comboCards = (combo: number): [Card, Card] => [COMBO_HI[combo], COMBO_LO[combo]];

// ---------------------------------------------------------------------------
// The 169 starting-hand classes: 13 pairs (6 combos each), 78 suited (4), 78 offsuit (12).
// 13*6 + 78*4 + 78*12 = 78 + 312 + 936 = 1326.

export type HandClassKind = "pair" | "suited" | "offsuit";

export interface HandClass {
  /** e.g. "AA", "AKs", "T9o" */
  name: string;
  /** Higher rank (0 = deuce .. 12 = ace). */
  hi: number;
  /** Lower rank (equal to hi for pairs). */
  lo: number;
  kind: HandClassKind;
  /** Number of combos: 6, 4 or 12. */
  combos: number;
}

export const classComboCount = (kind: HandClassKind): number => (kind === "pair" ? 6 : kind === "suited" ? 4 : 12);

export function handClassName(hi: number, lo: number, kind: HandClassKind): string {
  if (kind === "pair") return RANK_CHARS[hi] + RANK_CHARS[hi];
  return RANK_CHARS[hi] + RANK_CHARS[lo] + (kind === "suited" ? "s" : "o");
}

/**
 * All 169 classes in the usual 13x13 grid order, row-major from the top-left (AA):
 * row i / column j use ranks 12-i / 12-j; the diagonal is pairs, above it suited, below it offsuit.
 */
export const HAND_CLASSES: readonly HandClass[] = (() => {
  const out: HandClass[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const r1 = 12 - i, r2 = 12 - j;
      const kind: HandClassKind = i === j ? "pair" : j > i ? "suited" : "offsuit";
      const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
      out.push({ name: handClassName(hi, lo, kind), hi, lo, kind, combos: classComboCount(kind) });
    }
  }
  return out;
})();

/** The concrete combos of a class, e.g. "AKs" -> its 4 suited combos. */
export function combosOfClass(hi: number, lo: number, kind: HandClassKind): number[] {
  const out: number[] = [];
  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      if (kind === "pair" ? s2 <= s1 : kind === "suited" ? s1 !== s2 : s1 === s2) continue;
      out.push(comboIndex(makeCard(hi, s1), makeCard(lo, s2)));
    }
  }
  return out;
}

/** Class of a combo, e.g. comboIndex(As, Kh) -> { hi: 12, lo: 11, kind: "offsuit" }. */
export function classOfCombo(combo: number): { hi: number; lo: number; kind: HandClassKind } {
  const a = COMBO_HI[combo], b = COMBO_LO[combo];
  const hi = a >> 2, lo = b >> 2; // a > b, so rank(a) >= rank(b)
  const kind: HandClassKind = hi === lo ? "pair" : (a & 3) === (b & 3) ? "suited" : "offsuit";
  return { hi, lo, kind };
}
