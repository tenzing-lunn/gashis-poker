// Calibration of the situation reads: do the 90% intervals contain the truth 90% of the time?
// Shared by scripts/calibrate.ts (the full run) and reader.test.ts (a reduced run). See README.md.
//
// A session is `hands` heads-up hands of one persona (seat 0) against TAG, from its own seed. At each
// checkpoint the Reader's counts for the persona so far give one interval per statement, and a
// statement is covered when lo ≤ truth ≤ hi, the truth being the persona's frequency measured on
// 200,000 hands (population.ts, independent seeds). A statement is one outcome of a situation the
// persona met at least once by then; a two-outcome situation counts once (its second outcome's interval
// is the mirror image of the first), a three-outcome situation three times.

import { PERSONA_IDS, PERSONAS, TAG, type PersonaId } from "../../bots/personas";
import { simulate } from "../../bots/simulate";
import { betaQuantile } from "./beta";
import { DEFAULT_LEVEL, PRIOR, readOutcome } from "./reads";
import { observe } from "./hand";
import { HU_COUNTS } from "./population";
import { addHand, createReader, playerModel } from "./reader";
import { classifyEvents } from "./situations";
import { DEFAULT_EPSILON, stylePosterior } from "./style";
import { emptySituationCounts, frequencies, type SituationCounts } from "./truth";

/** Each persona's true outcome frequencies heads-up vs TAG (null where it never meets the situation). */
export const TRUTH_HU = Object.fromEntries(Object.entries(HU_COUNTS).map(([id, c]) => [id, c.map(frequencies)])) as Record<
  PersonaId,
  (number[] | null)[]
>;

/** The subject's situation counts at each checkpoint (hands seen) of one seeded heads-up session vs TAG. */
export function sessionSnapshots(persona: PersonaId, checkpoints: readonly number[], seed: number): SituationCounts[] {
  const counts = emptySituationCounts();
  const out: SituationCounts[] = [];
  let hands = 0;
  simulate({ personas: [PERSONAS[persona], TAG], hands: Math.max(...checkpoints), seed }, (state) => {
    for (const o of classifyEvents(2, state.button, state.events, state.board)) if (o.seat === 0) counts[o.situation][o.outcome]++;
    hands++;
    if (checkpoints.includes(hands)) out.push(counts.map((c) => c.slice()));
  });
  return out;
}

/** Seed of session `s` for a persona: disjoint from the measurement seeds in population.ts. */
export const sessionSeed = (persona: PersonaId, s: number): number => 1_000_000 + 100_000 * PERSONA_IDS.indexOf(persona) + s;

export interface Coverage {
  covered: number;
  total: number;
}

const rate = (c: Coverage): number => (c.total > 0 ? c.covered / c.total : NaN);
export { rate as coverageRate };

/**
 * Coverage of the statements in a set of snapshots (all the same checkpoint) for one persona, by
 * situation. `strict` uses the equal-tailed interval everywhere (no boundary rule).
 */
export function coverage(
  persona: PersonaId,
  snapshots: readonly SituationCounts[],
  options: { k: number; level?: number; strict?: boolean },
): Coverage[] {
  const level = options.level ?? DEFAULT_LEVEL;
  const truth = TRUTH_HU[persona];
  const out: Coverage[] = PRIOR.map(() => ({ covered: 0, total: 0 }));
  for (const counts of snapshots) {
    counts.forEach((c, situation) => {
      const n = c.reduce((a, b) => a + b, 0);
      const t = truth[situation];
      if (n === 0 || t === null) return;
      const outcomes = c.length === 2 ? 1 : c.length;
      for (let outcome = 0; outcome < outcomes; outcome++) {
        let lo: number, hi: number;
        if (options.strict) {
          const a = options.k * PRIOR[situation].mean[outcome] + c[outcome];
          const b = options.k * (1 - PRIOR[situation].mean[outcome]) + n - c[outcome];
          lo = betaQuantile((1 - level) / 2, a, b);
          hi = betaQuantile((1 + level) / 2, a, b);
        } else ({ lo, hi } = readOutcome(c, situation, outcome, { k: options.k, level }));
        out[situation].total++;
        if (lo <= t[outcome] && t[outcome] <= hi) out[situation].covered++;
      }
    });
  }
  return out;
}

/** Sums coverage counts. */
export const pool = (list: readonly Coverage[]): Coverage =>
  list.reduce((acc, c) => ({ covered: acc.covered + c.covered, total: acc.total + c.total }), { covered: 0, total: 0 });

/**
 * Learning speed: one seeded heads-up session of the persona (seat 0) vs TAG, watched by the TAG seat
 * (which knows its own hole cards). Returns the style posterior of seat 0 at each checkpoint, in
 * PERSONA_IDS order.
 */
export function styleSession(persona: PersonaId, checkpoints: readonly number[], seed: number, epsilon = DEFAULT_EPSILON): number[][] {
  let reader = createReader({ epsilon });
  const out: number[][] = [];
  let hands = 0;
  simulate({ personas: [PERSONAS[persona], TAG], hands: Math.max(...checkpoints), seed }, (state) => {
    reader = addHand(reader, observe(state, ["subject", null], 1));
    hands++;
    if (checkpoints.includes(hands)) {
      const posterior = stylePosterior(playerModel(reader, "subject").styleLogLik);
      out.push(PERSONA_IDS.map((id) => posterior[id]));
    }
  });
  return out;
}
