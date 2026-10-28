// Measuring situation frequencies by simulation: the personas' "truth" and the population prior.
// Shared by scripts/measure.ts (which writes population.ts) and the drift test. See README.md.
//
// The frequencies depend on the table, so the setup is fixed and named:
// - "hu": heads-up, the subject persona in seat 0 against TAG in seat 1, 100 bb stacks reset every
//   hand, the button alternating. This is the primary setup: the truth for calibration and the prior
//   for every situation that occurs there.
// - "6max": one of each persona at a 6-max table, reseated at random every hand. Used only for the
//   prior of situations that heads-up play never produces for some persona (early position and the
//   small blind do not exist heads-up, and TAG never limps, so nobody faces a limp in the big blind).

import { PERSONA_IDS, PERSONAS, TAG, type PersonaId } from "../../bots/personas";
import { simulate } from "../../bots/simulate";
import { classifyEvents, SITUATIONS } from "./situations";

/** counts[situation][outcome]. */
export type SituationCounts = number[][];

export const emptySituationCounts = (): SituationCounts => SITUATIONS.map((s) => new Array<number>(s.outcomes.length).fill(0));

/** Situation counts of the subject persona in the heads-up setup (seat 0 vs TAG). */
export function measureHeadsUp(subject: PersonaId, hands: number, seed: number): SituationCounts {
  const counts = emptySituationCounts();
  simulate({ personas: [PERSONAS[subject], TAG], hands, seed }, (state) => {
    for (const o of classifyEvents(2, state.button, state.events, state.board)) if (o.seat === 0) counts[o.situation][o.outcome]++;
  });
  return counts;
}

/** Situation counts of every persona at a 6-max table with one of each, reseated every hand. */
export function measureSixMax(hands: number, seed: number): Record<PersonaId, SituationCounts> {
  const out = Object.fromEntries(PERSONA_IDS.map((id) => [id, emptySituationCounts()])) as Record<PersonaId, SituationCounts>;
  simulate({ personas: PERSONA_IDS.map((id) => PERSONAS[id]), hands, seed, shuffleSeats: true }, (state, personas) => {
    for (const o of classifyEvents(6, state.button, state.events, state.board)) out[personas[o.seat].id][o.situation][o.outcome]++;
  });
  return out;
}

/** Frequencies from counts (null when the situation was never seen). */
export const frequencies = (counts: readonly number[]): number[] | null => {
  const n = counts.reduce((a, b) => a + b, 0);
  return n === 0 ? null : counts.map((x) => x / n);
};

/** A situation's prior comes from the heads-up setup only if every persona met it at least this often there. */
export const MIN_PRIOR_SAMPLE = 200;

/**
 * The population prior mean of every situation: the plain average over the six personas of their
 * outcome frequencies, from the heads-up setup when every persona met the situation there at least
 * MIN_PRIOR_SAMPLE times, else from the 6-max setup.
 */
export function priorMeans(hu: Record<PersonaId, SituationCounts>, sixMax: Record<PersonaId, SituationCounts>): { mean: number[]; setup: "hu" | "6max" }[] {
  return SITUATIONS.map((sit, i) => {
    const total = (c: SituationCounts) => c[i].reduce((a, b) => a + b, 0);
    const setup = PERSONA_IDS.every((id) => total(hu[id]) >= MIN_PRIOR_SAMPLE) ? "hu" : "6max";
    const source = setup === "hu" ? hu : sixMax;
    const mean = new Array<number>(sit.outcomes.length).fill(0);
    for (const id of PERSONA_IDS) {
      const f = frequencies(source[id][i]);
      if (f === null) throw new Error(`${id} never met ${sit.id} in the ${setup} setup`);
      f.forEach((x, j) => (mean[j] += x / PERSONA_IDS.length));
    }
    return { mean, setup };
  });
}
