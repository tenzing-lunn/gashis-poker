// Situation reads: Dirichlet–multinomial posteriors, credible intervals and plain-English sentences.
// See README.md.
//
// Each situation has outcomes 1..m with unknown frequencies p = (p_1..p_m) for this player. The prior is
// Dirichlet(k·μ), where μ is the population mean (the average of the six personas' true frequencies,
// population.ts) and k is the prior's weight in pseudo-observations. After seeing counts x, the posterior
// is Dirichlet(α) with α_i = k·μ_i + x_i, and each p_i alone is Beta(α_i, α_0 − α_i), α_0 = Σ α_i.
// From that marginal:
// - best guess: the posterior mean α_i / α_0;
// - a credible interval at `level` (default 90%) from exact Beta quantiles (beta.ts): equal-tailed,
//   [q((1−level)/2), q((1+level)/2)], except at the boundary. If the outcome has never been seen in
//   n ≥ 1 tries the interval is [0, q(level)] ("at most"), and if it was seen every time, [q(1−level), 1]
//   ("at least"). Both still hold `level` of the posterior mass. The reason: some personas never take
//   some actions (a nit never limps), and an equal-tailed interval never contains 0, so it would be
//   wrong every single time about a true zero; this is the boundary rule Brown, Cai and DasGupta (2001)
//   recommend for the Jeffreys interval, with the open end's quantile moved so the mass stays `level`.
// - P(p_i > t) = 1 − I_t(α_i, α_0 − α_i).
// - "More often than a typical player" is P(p_i > μ_i), μ_i the population mean. Until the situation
//   has been seen k times the sentence says there are too few spots to compare yet (`tooFew`): with
//   little data the skewed prior alone would sway P(p_i > μ_i).
//
// DEFAULT_K = 4 is chosen by calibration (scripts/calibrate.ts, results in README.md): against the six
// personas heads-up, the 90% intervals cover the true frequency 90-91% of the time at 25, 100 and 400
// hands. With k ≤ 2 the prior is too weak to steady the small-count intervals of rare outcomes
// (coverage falls to 80-86% by 400 hands); with k ≥ 8 it overrules the data on players far from
// average early on (84-88% at 25 hands). k = 3 to 5 all land within 87-93%.

import { betaCdf, betaQuantile } from "./beta";
import { HU_COUNTS, SIX_MAX_COUNTS } from "./population";
import { SITUATIONS } from "./situations";
import { priorMeans, type SituationCounts } from "./truth";

export const DEFAULT_K = 4;
export const DEFAULT_LEVEL = 0.9;

/** The population prior mean of each situation (and which setup it was measured in). */
export const PRIOR = priorMeans(HU_COUNTS, SIX_MAX_COUNTS);

export interface ReadOptions {
  /** Prior weight in pseudo-observations. Default DEFAULT_K. */
  k?: number;
  /** Credible level. Default DEFAULT_LEVEL (90%). */
  level?: number;
}

export type IntervalShape = "between" | "atMost" | "atLeast";

export interface OutcomeRead {
  situation: number;
  outcome: number;
  /** Times the player met the situation, and took this outcome. */
  n: number;
  count: number;
  /** The marginal posterior of the rate: Beta(a, b). */
  a: number;
  b: number;
  /** Posterior mean. */
  mean: number;
  /** Credible interval [lo, hi] at `level`. */
  lo: number;
  hi: number;
  level: number;
  shape: IntervalShape;
  /** A typical player's rate: the population mean μ (the prior mean). */
  typical: number;
  /** Posterior probability that this player's rate is above `typical`. */
  pAboveTypical: number;
  /** The prior weight k: also the number of spots needed before comparing with a typical player. */
  k: number;
  /** Seen fewer than k times (n < k): too few spots to compare with a typical player yet. */
  tooFew: boolean;
}

/** P(rate > t) for a Beta(a, b) posterior. */
export const probAbove = (t: number, a: number, b: number): number => 1 - betaCdf(t, a, b);

/** P(rate > t) for a read: "how sure am I that Bob folds to c-bets more than 60% of the time?" */
export const readProbAbove = (read: OutcomeRead, t: number): number => probAbove(t, read.a, read.b);

/** The credible interval of a Beta(a, b) posterior at `level` with the given shape (see the header). */
export function credibleInterval(a: number, b: number, level: number, shape: IntervalShape): [number, number] {
  if (shape === "atMost") return [0, betaQuantile(level, a, b)];
  if (shape === "atLeast") return [betaQuantile(1 - level, a, b), 1];
  return [betaQuantile((1 - level) / 2, a, b), betaQuantile((1 + level) / 2, a, b)];
}

/** The read of one outcome of one situation from that situation's counts. */
export function readOutcome(counts: readonly number[], situation: number, outcome: number, options: ReadOptions = {}): OutcomeRead {
  const k = options.k ?? DEFAULT_K;
  const level = options.level ?? DEFAULT_LEVEL;
  const prior = PRIOR[situation].mean;
  const n = counts.reduce((a, b) => a + b, 0);
  const count = counts[outcome];
  const a = k * prior[outcome] + count;
  const b = k * (1 - prior[outcome]) + (n - count);
  const shape: IntervalShape = n > 0 && count === 0 ? "atMost" : n > 0 && count === n ? "atLeast" : "between";
  const [lo, hi] = credibleInterval(a, b, level, shape);
  const typical = prior[outcome];
  return {
    situation,
    outcome,
    n,
    count,
    a,
    b,
    mean: a / (a + b),
    lo,
    hi,
    level,
    shape,
    typical,
    pAboveTypical: probAbove(typical, a, b),
    k,
    tooFew: n < Math.max(k, 1),
  };
}

const pct = (x: number): string => `${Math.round(100 * x)}%`;

/** "After 23 flop c-bets faced, I'm 90% sure Bob folds between 48% and 79% of the time (best guess 64%)." */
export function describeRead(read: OutcomeRead, name: string): string {
  const sit = SITUATIONS[read.situation];
  const range =
    read.shape === "atMost" ? `at most ${pct(read.hi)}` : read.shape === "atLeast" ? `at least ${pct(read.lo)}` : `between ${pct(read.lo)} and ${pct(read.hi)}`;
  return (
    `After ${read.n} ${sit.spot[read.n === 1 ? 0 : 1]}, I'm ${pct(read.level)} sure ${name} ${sit.verbs[read.outcome]} ` +
    `${range} of the time (best guess ${pct(read.mean)}).`
  );
}

/** How sure we are that the player does this more (or less) often than a typical player. */
export const confidenceVsTypical = (read: OutcomeRead): number => Math.max(read.pAboveTypical, 1 - read.pAboveTypical);

/**
 * "I'm 85% sure Bob folds facing a flop c-bet more often than a typical player.", or, seen fewer than
 * k times, "Only 2 of 4 spots needed to compare Bob with a typical player here."
 */
export function compareRead(read: OutcomeRead, name: string): string {
  if (read.tooFew) {
    const needed = Math.max(read.k, 1);
    const start = read.n === 0 ? `No spots yet: ${needed} needed` : `Only ${read.n} of ${needed} spots needed`;
    return `${start} to compare ${name} with a typical player here.`;
  }
  const sit = SITUATIONS[read.situation];
  const more = read.pAboveTypical >= 0.5;
  return `I'm ${pct(confidenceVsTypical(read))} sure ${name} ${sit.verbs[read.outcome]} ${sit.context} ${more ? "more" : "less"} often than a typical player.`;
}

export interface RankedRead {
  read: OutcomeRead;
  /** confidenceVsTypical(read). */
  confidence: number;
  sentence: string;
  comparison: string;
}

/**
 * The player's most unusual reads: every outcome of every situation seen at least k times (binary
 * situations once, by their first outcome), ranked by how sure we are that the player differs from a
 * typical player in that direction. Requiring n ≥ k (the player's own observations weigh at least as
 * much as the prior; the same rule as `tooFew`) keeps one or two hands from topping the list, where
 * the skewed prior alone would sway the comparison. Until some situation has been seen k times the
 * list is empty.
 */
export function topReads(counts: SituationCounts, name: string, options: ReadOptions & { limit?: number } = {}): RankedRead[] {
  const k = options.k ?? DEFAULT_K;
  const out: RankedRead[] = [];
  counts.forEach((c, situation) => {
    if (c.reduce((a, b) => a + b, 0) < Math.max(k, 1)) return;
    const outcomes = c.length === 2 ? 1 : c.length;
    for (let outcome = 0; outcome < outcomes; outcome++) {
      const read = readOutcome(c, situation, outcome, options);
      out.push({ read, confidence: confidenceVsTypical(read), sentence: describeRead(read, name), comparison: compareRead(read, name) });
    }
  });
  out.sort((x, y) => y.confidence - x.confidence || y.read.n - x.read.n);
  return out.slice(0, options.limit ?? 5);
}
