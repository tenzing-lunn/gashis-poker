// gradeDecision: the EV of every hero option vs the bots at a decision. See ev.ts for the math.
//
// This file only builds the showdown model from lib/sim:
//   heads-up (one live bot): particles = every combo with posterior weight > 0, shares =
//     comboEquities (exact on the flop, turn and river; per-combo Monte Carlo preflop);
//   multiway: particles = sampleJoint draws from the joint posterior (weight 1/N), shares =
//     particleModel (exact on the turn and river, sampled runouts on the flop and preflop).

import { comboEquities } from "../sim/weighted-equity";
import { sampleJoint } from "../sim/multiway";
import { gradeWithModel, headsUpModel, particleModel, type ModelRequest } from "./ev";
import type { GradeInput, GradeResult, ShowdownModel } from "./types";

/** The showdown model gradeDecision uses (exposed for the worker and tests). */
export function buildShowdownModel(req: ModelRequest): ShowdownModel {
  const { heroCards, board, seats, ranges, options } = req;
  if (seats.length === 1) {
    const eq = comboEquities(heroCards, board, ranges[0], { trialsPerCombo: options.trialsPerCombo, seed: options.seed });
    return headsUpModel(seats[0], ranges[0], eq);
  }
  const { combos } = sampleJoint(ranges, [...heroCards, ...board], options.particles, options.seed);
  return particleModel(heroCards, board, seats, combos, { seed: options.seed });
}

/** Grades the hero's options (and `input.chosen`) at the decision after `input.history`. */
export function gradeDecision(input: GradeInput): GradeResult {
  return gradeWithModel(input, buildShowdownModel);
}
