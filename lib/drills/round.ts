// Timed rounds: a fixed-length sprint, and the end-of-round summary.

import type { Difficulty, DrillType, Fact } from "./types";

export const ROUND_MS = 120_000;

export interface RoundAnswer {
  id: string;
  seed: number;
  type: DrillType;
  difficulty: Difficulty;
  correct: boolean;
  ms: number;
  given: string;
  expected: string;
  /** The question's facts and ask, kept so the summary can show a miss without regenerating it. */
  facts: Fact[];
  ask: string;
}

export interface RoundSummary {
  attempted: number;
  correct: number;
  /** 0–100, 0 when none. */
  accuracy: number;
  /** null when none. */
  medianMs: number | null;
  misses: RoundAnswer[];
}

export function summarize(answers: RoundAnswer[]): RoundSummary {
  const attempted = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const ms = answers.map((a) => a.ms).sort((a, b) => a - b);
  const mid = attempted >> 1;
  const medianMs = attempted === 0 ? null : attempted % 2 ? ms[mid] : (ms[mid - 1] + ms[mid]) / 2;
  return {
    attempted,
    correct,
    accuracy: attempted ? (100 * correct) / attempted : 0,
    medianMs,
    misses: answers.filter((a) => !a.correct),
  };
}
