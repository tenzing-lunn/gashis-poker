// Seeded simulation of poker results under the normal approximation used in module 9:
// each block of 100 hands is an independent draw from a normal distribution with mean = win rate
// (bb/100) and standard deviation = SD (bb/100).

import { createRng, type Rng } from "../../../lib/poker/cards";

export interface VarianceInput {
  winRate: number; // bb/100
  sd: number; // bb/100
  hands: number;
  bankroll: number; // bb; 0 = no bankroll check
  runs: number;
  seed: number;
}

export interface VarianceResult {
  blocks: number;
  /** Results (bb) after each block for the first `drawn` runs, sampled at `sampleAt` block counts. */
  paths: number[][];
  sampleAt: number[];
  finals: Float64Array;
  belowZero: number; // share of runs that finish below 0
  ruined: number; // share of runs whose running total ever reaches -bankroll
}

/** Standard normal draw (Box-Muller). */
export function normal(rng: Rng): number {
  let u = rng.next();
  while (u === 0) u = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

export function simulate(input: VarianceInput, drawn = 20, points = 120): VarianceResult {
  const blocks = Math.max(1, Math.round(input.hands / 100));
  const step = Math.max(1, Math.ceil(blocks / points));
  const sampleAt: number[] = [0];
  for (let k = step; k < blocks; k += step) sampleAt.push(k);
  sampleAt.push(blocks);

  const rng = createRng(input.seed);
  const finals = new Float64Array(input.runs);
  const paths: number[][] = [];
  let below = 0, ruined = 0;
  for (let r = 0; r < input.runs; r++) {
    const keep = r < drawn;
    const path: number[] = keep ? [0] : [];
    let total = 0, broke = false, next = 1;
    for (let k = 1; k <= blocks; k++) {
      total += input.winRate + input.sd * normal(rng);
      if (input.bankroll > 0 && total <= -input.bankroll) broke = true;
      if (keep && k === sampleAt[next]) {
        path.push(total);
        next++;
      }
    }
    finals[r] = total;
    if (total < 0) below++;
    if (broke) ruined++;
    if (keep) paths.push(path);
  }
  return { blocks, paths, sampleAt, finals, belowZero: below / input.runs, ruined: ruined / input.runs };
}

/** Standard normal cumulative distribution (Abramowitz-Stegun 7.1.26 erf, error below 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Risk of ruin, normal approximation with no time limit: exp(-2 w B / sd^2), all per 100 hands. */
export const riskOfRuin = (winRate: number, sd: number, bankroll: number): number =>
  winRate <= 0 ? 1 : Math.exp((-2 * winRate * bankroll) / (sd * sd));
