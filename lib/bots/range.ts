// A bot's range given its actions so far, by Bayes' rule. See README.md.
//
// Start uniform over the combos that use no known card, multiply each combo's weight by the probability
// that the persona takes the observed action with that combo at each of the seat's decisions, and
// normalize. The probabilities come from the same comboDistribution the bot sampled from, recomputed
// from the public views alone, so the result is exactly the posterior over the bot's hole cards.

import type { Card } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO } from "../poker/combinatorics";
import type { Persona } from "./personas";
import { ACTION_COUNT, analyzeSpot, comboDistribution, sameAction } from "./policy";
import { replay, type PublicHistory } from "./view";

export interface InferOptions {
  /** Use only the first `upTo` actions of the history (the range at that moment). Default: all. */
  upTo?: number;
  /** Extra cards known not to be in the bot's hand, e.g. the grader's own hole cards. */
  dead?: readonly Card[];
}

/**
 * Posterior weight of every combo (sums to 1; 0 for combos using a board or dead card, or that would
 * never have taken the observed actions). Throws if an action of `seat` is one the persona never takes.
 */
export function inferRange(persona: Persona, history: PublicHistory, seat: number, options: InferOptions = {}): Float64Array {
  const { decisions, board } = replay(history, options.upTo);
  const isDead = new Uint8Array(52);
  for (const c of board) isDead[c] = 1;
  for (const c of options.dead ?? []) isDead[c] = 1;
  const weight = new Float64Array(COMBO_COUNT);
  for (let c = 0; c < COMBO_COUNT; c++) if (!isDead[COMBO_HI[c]] && !isDead[COMBO_LO[c]]) weight[c] = 1;

  for (const d of decisions) {
    if (d.seat !== seat) continue;
    const spot = analyzeSpot(persona, d.view);
    const matching: number[] = [];
    for (let a = 0; a < ACTION_COUNT; a++) {
      const concrete = spot.concrete[a];
      if (concrete && sameAction(concrete, d.action)) matching.push(a);
    }
    if (matching.length === 0) {
      throw new Error(`Seat ${seat} took ${JSON.stringify(d.action)}, which ${persona.name} never does in that spot`);
    }
    for (let c = 0; c < COMBO_COUNT; c++) {
      if (weight[c] === 0) continue;
      const dist = comboDistribution(spot, c);
      let p = 0;
      for (const a of matching) p += dist[a];
      weight[c] *= p;
    }
  }

  let total = 0;
  for (let c = 0; c < COMBO_COUNT; c++) total += weight[c];
  if (total === 0) throw new Error(`No combo is consistent with seat ${seat}'s actions for ${persona.name}`);
  for (let c = 0; c < COMBO_COUNT; c++) weight[c] /= total;
  return weight;
}
