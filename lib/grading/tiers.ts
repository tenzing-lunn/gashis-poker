// Verdicts from EV loss.
//
// loss = best EV - option EV (chips), judged as a share of the pot before the decision. When EVs are
// sampled we don't call noise a mistake: the loss is first shrunk by two standard errors of the difference,
// max(0, loss - 2 * sqrt(se_best^2 + se_option^2)) (conservative: it ignores the positive correlation that
// common particles give). The argmax option is always "best".

import type { Tier } from "./types";

/** Upper bounds (inclusive) of each tier's loss, as a fraction of the pot before the decision. */
export const TIER_THRESHOLDS = { best: 0.005, correct: 0.03, inaccuracy: 0.08, mistake: 0.2 } as const;

/** The tier for a loss given as a fraction of the pot. */
export function tierOf(lossShare: number): Tier {
  if (lossShare <= TIER_THRESHOLDS.best) return "best";
  if (lossShare <= TIER_THRESHOLDS.correct) return "correct";
  if (lossShare <= TIER_THRESHOLDS.inaccuracy) return "inaccuracy";
  if (lossShare <= TIER_THRESHOLDS.mistake) return "mistake";
  return "blunder";
}

export interface Graded {
  /** Index of the max-EV option (the first one on an exact tie). */
  best: number;
  loss: number[];
  /** loss / pot. */
  lossPct: number[];
  tier: Tier[];
}

/** Grades options by EV against the best one. `pot` is the pot before the decision (> 0). */
export function gradeOptions(options: readonly { ev: number; stdErr: number }[], pot: number): Graded {
  if (options.length === 0) throw new Error("No options to grade");
  let best = 0;
  for (let i = 1; i < options.length; i++) if (options[i].ev > options[best].ev) best = i;
  const seBest = options[best].stdErr;
  const loss = options.map((o) => Math.max(0, options[best].ev - o.ev));
  const tier = options.map((o, i) => {
    if (i === best) return "best" as const;
    const noise = 2 * Math.sqrt(seBest * seBest + o.stdErr * o.stdErr);
    return tierOf(Math.max(0, loss[i] - noise) / pot);
  });
  return { best, loss, lossPct: loss.map((l) => l / pot), tier };
}
