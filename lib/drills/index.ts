// Drill generators and checkers. generate(type, seed, difficulty) is deterministic: same inputs, same question.

import { createRng, type Rng } from "../poker/cards";
import { genComboCount } from "./combos";
import { genEquityEstimate } from "./estimate";
import { genCallEv, genMdf, genOutsToEquity, genPotOdds, genSpeedCallFold } from "./odds";
import { genCountOuts } from "./outs";
import type { Difficulty, DrillType, Question } from "./types";

export type { Answer, CheckResult, Difficulty, DrillType, Question, Unit } from "./types";
export { check, formatAnswer, parseInput } from "./check";

export const DRILL_TYPES: readonly DrillType[] = [
  "countOuts",
  "outsToEquity",
  "potOdds",
  "mdf",
  "comboCount",
  "callEv",
  "equityEstimate",
  "speedCallFold",
];

export const DRILL_LABELS: Record<DrillType, string> = {
  countOuts: "Count outs",
  outsToEquity: "Outs → equity",
  potOdds: "Pot odds",
  mdf: "MDF & bluff break-even",
  comboCount: "Combos after card removal",
  callEv: "EV of a call",
  equityEstimate: "Equity estimate",
  speedCallFold: "Speed call / fold",
};

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
