import type { DrillType } from "@/lib/drills/meta";

/** Characters per line on a 375px phone: (375 − 40 − 24)px of 9px-wide 15px Source Code Pro. */
export const MOBILE_CH = 34;

/**
 * Phones (< 680px): the most lines the facts block and the ask + hint block take, per drill type and difficulty
 * (index 0 = EASY). Reserved as min-heights so the answer line stays put between questions. Derived by
 * `_scripts/line-budget.ts` (400 seeds per cell); re-run it when generator text changes.
 */
export const MOBILE_LINES: Record<DrillType, [facts: number, ask: number][]> = {
  countOuts: [[5, 3], [5, 5], [5, 5]],
  outsToEquity: [[3, 7], [3, 3], [3, 3]],
  potOdds: [[2, 4], [2, 2], [2, 2]],
  callEv: [[3, 6], [3, 4], [3, 4]],
  speedCallFold: [[3, 3], [3, 1], [3, 1]],
  comboCount: [[3, 3], [3, 3], [4, 3]],
  equityEstimate: [[3, 3], [4, 5], [4, 5]],
  mdf: [[2, 6], [2, 5], [2, 5]],
};
