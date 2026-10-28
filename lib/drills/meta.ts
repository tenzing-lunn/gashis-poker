// Drill metadata: names, order, difficulty labels and lesson links. No generators, so client components
// (lesson widgets, the picker) can import it without pulling in the question code.

import type { Difficulty, DrillType } from "./types";

export type { Difficulty, DrillType };

/** Curriculum order. */
export const DRILL_TYPES: readonly DrillType[] = [
  "countOuts",
  "outsToEquity",
  "potOdds",
  "callEv",
  "speedCallFold",
  "comboCount",
  "equityEstimate",
  "mdf",
];

export const START_HERE: DrillType = "countOuts";

export const DRILL_LABELS: Record<DrillType, string> = {
  countOuts: "Count outs",
  outsToEquity: "Outs → equity",
  potOdds: "Pot odds",
  mdf: "MDF & bluff break-even",
  comboCount: "Combos left in a range",
  callEv: "EV of a call",
  equityEstimate: "Equity estimate",
  speedCallFold: "Speed call / fold",
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = { 1: "Easy", 2: "Medium", 3: "Hard" };

/** Per type: what you practice, the lesson it comes from, and what each difficulty changes. */
export const DRILL_INFO: Record<
  DrillType,
  { blurb: string; lesson: { slug: string; module: number }; levels: [string, string, string] }
> = {
  countOuts: {
    blurb: "Cards that would put you ahead",
    lesson: { slug: "outs", module: 2 },
    levels: ["Clean outs, on the flop", "Adds dirty outs", "Dirty outs too, flop or turn"],
  },
  outsToEquity: {
    blurb: "Turn outs into a win %",
    lesson: { slug: "outs", module: 2 },
    levels: ["2–9 outs, formula shown", "1–15 outs, no formula, turn-only spots", "1–20 outs, no formula"],
  },
  potOdds: {
    blurb: "The win % a call needs",
    lesson: { slug: "pot-odds", module: 3 },
    levels: ["Round numbers, formula shown", "Any sizes, no formula", "Half-bb sizes, no formula"],
  },
  callEv: {
    blurb: "What a call wins or loses on average",
    lesson: { slug: "pot-odds", module: 3 },
    levels: ["Round numbers, formula shown", "Any sizes and equity, no formula", "Half-bb sizes, no formula"],
  },
  speedCallFold: {
    blurb: "Pot odds vs equity, fast",
    lesson: { slug: "pot-odds", module: 3 },
    levels: ["Clear spots (10+ pts), formula shown", "Closer spots (6+ pts), any sizes", "Close spots (3+ pts), half-bb sizes"],
  },
  comboCount: {
    blurb: "Hands in a range once cards are seen",
    lesson: { slug: "combinatorics", module: 1 },
    levels: ["1–2 hands; your cards are dead", "2–3 hands, with +; the flop is dead", "2–4 hands, with runs; hand + board"],
  },
  equityEstimate: {
    blurb: "Guess your win % in a matchup",
    lesson: { slug: "equity", module: 4 },
    levels: ["Hand vs hand, preflop or flop", "Hand or range, on the flop", "Mostly ranges, preflop to turn"],
  },
  mdf: {
    blurb: "How often to defend; when bluffs pay",
    lesson: { slug: "game-theory", module: 5 },
    levels: ["Round numbers, formula shown", "Any sizes, no formula", "Half-bb sizes, no formula"],
  },
};

/** The drill type with exactly this id, or null. */
export function parseDrillType(s: string | null | undefined): DrillType | null {
  return s != null && (DRILL_TYPES as readonly string[]).includes(s) ? (s as DrillType) : null;
}
