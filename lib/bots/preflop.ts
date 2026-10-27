// Preflop hand ranking shared by every persona. See README.md.
//
// The 169 classes are ordered by hand-built tiers written in range notation (strongest first), and by
// the Chen formula inside a tier. A class's percentile is the share of all 1,326 combos ranked above it
// plus half its own, so "the top 15%" is every combo with percentile below 0.15. Personas describe their
// preflop ranges as widths on this one scale (open the top 15% from UTG, 3-bet the top 4.5%, ...).

import { COMBO_COUNT, HAND_CLASSES, combosOfClass, type HandClass } from "../poker/combinatorics";
import { comboClassName, formatRange, parseRange } from "../poker/range";

/** Strongest first. Classes not listed form a last tier. */
export const PREFLOP_TIERS: readonly string[] = [
  "AA, KK, QQ, AKs",
  "JJ, AKo, AQs",
  "TT, AJs, KQs, AQo",
  "99, ATs, KJs, QJs, KTs, AJo, KQo",
  "88, 77, A9s, A8s, A5s, QTs, JTs, ATo, KJo",
  "66, 55, A7s, A6s, A4s, A3s, A2s, K9s, Q9s, J9s, T9s, 98s, QJo, KTo",
  "44, 33, 22, K8s, T8s, 97s, 87s, 76s, 65s, 54s, A9o, QTo, JTo",
  "K7s, K6s, K5s, Q8s, J8s, 86s, 75s, 64s, A8o, A7o, A5o, K9o, Q9o, J9o, T9o",
  "K4s, K3s, K2s, Q7s, Q6s, J7s, T7s, 96s, 85s, 74s, 53s, 43s, A6o, A4o, A3o, A2o, K8o, Q8o, J8o, T8o, 98o",
  "Q5s, Q4s, Q3s, Q2s, J6s, J5s, T6s, 95s, 84s, 63s, 52s, 42s, 32s, K7o, K6o, Q7o, J7o, T7o, 97o, 87o, 76o, 65o",
];

/** Suited hands that 3-bet as bluffs (blockers and playability) at a persona's bluff frequency. */
export const THREE_BET_BLUFFS = "A5s-A2s, K9s-K8s, Q9s, J9s, T8s, 97s, 86s, 76s, 65s, 54s";

/** Chen formula (Bill Chen's quick preflop score), used only to order classes inside a tier. */
export function chenScore(c: { hi: number; lo: number; kind: HandClass["kind"] }): number {
  const points = (r: number) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  if (c.kind === "pair") return Math.max(5, 2 * points(c.hi));
  const gap = c.hi - c.lo - 1;
  let s = points(c.hi) + (c.kind === "suited" ? 2 : 0) - [0, 1, 2, 4][Math.min(gap, 3)] - (gap >= 4 ? 1 : 0);
  if (gap <= 1 && c.hi < 10) s += 1;
  return s;
}

const KIND_ORDER = { pair: 0, suited: 1, offsuit: 2 } as const;

/** The 169 class names, strongest first. */
export const PREFLOP_ORDER: readonly string[] = (() => {
  const tierOf = new Map<string, number>();
  PREFLOP_TIERS.forEach((tier, t) => {
    for (const combo of parseRange(tier)) {
      const name = comboClassName(combo);
      const seen = tierOf.get(name);
      if (seen !== undefined && seen !== t) throw new Error(`${name} is in preflop tiers ${seen} and ${t}`);
      tierOf.set(name, t);
    }
  });
  const classes = HAND_CLASSES.slice();
  const key = (c: HandClass) => tierOf.get(c.name) ?? PREFLOP_TIERS.length;
  classes.sort(
    (a, b) =>
      key(a) - key(b) ||
      chenScore(b) - chenScore(a) ||
      b.hi - a.hi ||
      b.lo - a.lo ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
  return classes.map((c) => c.name);
})();

/** Percentile (0 = best) of every combo on the preflop ranking. */
export const PREFLOP_PCT: Float64Array = (() => {
  const pct = new Float64Array(COMBO_COUNT);
  const byName = new Map(HAND_CLASSES.map((c) => [c.name, c]));
  let above = 0;
  for (const name of PREFLOP_ORDER) {
    const c = byName.get(name)!;
    const mid = (above + c.combos / 2) / COMBO_COUNT;
    for (const combo of combosOfClass(c.hi, c.lo, c.kind)) pct[combo] = mid;
    above += c.combos;
  }
  return pct;
})();

/** 1 for combos in THREE_BET_BLUFFS. */
export const IS_THREE_BET_BLUFF: Uint8Array = (() => {
  const out = new Uint8Array(COMBO_COUNT);
  for (const c of parseRange(THREE_BET_BLUFFS)) out[c] = 1;
  return out;
})();

/** The combos in the top `width` (a fraction of all combos), written in range notation. */
export function topRange(width: number): string {
  const combos: number[] = [];
  for (let c = 0; c < COMBO_COUNT; c++) if (PREFLOP_PCT[c] < width) combos.push(c);
  return formatRange(combos);
}
