// Drill generators and checkers. generate(type, seed, difficulty) is deterministic: same inputs, same question.

import { createRng, type Rng } from "../poker/cards";
import { genComboCount } from "./combos";
import { genEquityEstimate } from "./estimate";
import { genCallEv, genMdf, genOutsToEquity, genPotOdds, genSpeedCallFold } from "./odds";
import { genCountOuts } from "./outs";
import type { Difficulty, DrillType, Question } from "./types";

export type { Answer, CheckResult, Difficulty, DrillType, Fact, Mistake, Question, Unit } from "./types";
export { check, formatAnswer, parseInput } from "./check";
export { ROUND_MS, summarize, type RoundAnswer, type RoundSummary } from "./round";
export { DIFFICULTY_LABELS, DRILL_INFO, DRILL_LABELS, DRILL_TYPES, START_HERE, parseDrillType } from "./meta";

const GENERATORS: Record<DrillType, (rng: Rng, difficulty: Difficulty) => Omit<Question, "type" | "id">> = {
  countOuts: genCountOuts,
  outsToEquity: genOutsToEquity,
  potOdds: genPotOdds,
  mdf: genMdf,
  comboCount: genComboCount,
  callEv: genCallEv,
  equityEstimate: genEquityEstimate,
  speedCallFold: genSpeedCallFold,
};

export function generate(type: DrillType, seed: number, difficulty: Difficulty = 1): Question {
  const gen = GENERATORS[type];
  if (!gen) throw new Error(`Unknown drill type "${type}"`);
  return { type, id: `${type}:${seed}`, ...gen(createRng(seed), difficulty) };
}
