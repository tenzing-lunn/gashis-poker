// Variance simulator: how far luck moves a player with a known true win rate.
//
// Model: each hand's result is an independent normal draw with mean winRate/100 bb and standard
// deviation stdDev/10 bb, so 100 hands have mean winRate and SD stdDev * sqrt(100)/10 = stdDev:
// exactly the bb/100 numbers players quote. Real per-hand results are far from normal (mostly small
// losses, occasional big pots), but over hundreds of hands the sum is close to normal anyway, and the
// sum is what this tool is about. Hands are simulated one by one (seeded, deterministic), so
// drawdowns are measured at hand resolution.
//
// Analytic results for H hands: final ~ Normal(winRate * H/100, stdDev * sqrt(H/100)).

import { createRng } from "../poker/cards";

export interface VarianceOptions {
  /** True win rate, bb/100. */
  winRate: number;
  /** Standard deviation, bb/100. */
  stdDev: number;
  /** Hands per run. */
  hands: number;
  /** Number of independent runs. */
  runs: number;
  seed?: number;
  /** How many runs to return as plotted paths (the first ones). Default 5. */
  samplePaths?: number;
  /** Points per sample path, evenly spaced from hand 0 to hand H. Default 200. */
  pathPoints?: number;
  /** Histogram bins over [min, max] of the final results. Default 40. */
  histogramBins?: number;
}

export interface Summary {
  mean: number;
  sd: number;
  /** Fraction of runs finishing below 0 bb. */
  belowZero: number;
  /** Central 95% interval of the final result, bb. */
  interval95: [number, number];
}

export interface VarianceResult {
  /** Final result of each run, bb. */
  finals: Float64Array;
  histogram: { min: number; binWidth: number; counts: Int32Array };
  /** Hand numbers of the path points (shared by all paths). */
  pathHands: Float64Array;
  /** Cumulative bb at each path point, one array per sample run. */
  paths: Float64Array[];
  /** Simulated statistics (interval = 2.5th and 97.5th percentiles). */
  simulated: Summary;
  /** Normal-theory values (interval = mean +- 1.96 SD, belowZero = Phi(-mean/sd)). */
  analytic: Summary;
  /** Largest peak-to-trough fall within each run (the running peak starts at 0), bb: mean, median, 95th percentile, max over runs. */
  drawdown: { mean: number; median: number; p95: number; max: number };
}

/** Standard normal CDF, via Abramowitz & Stegun 7.1.26 for erf (absolute error < 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Linear-interpolated quantile of an ascending-sorted array. */
function quantile(sorted: Float64Array, q: number): number {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function simulateVariance(options: VarianceOptions): VarianceResult {
  const { winRate, stdDev, hands, runs } = options;
  if (!Number.isInteger(hands) || hands < 1) throw new Error(`hands must be a positive integer, got ${hands}`);
  if (!Number.isInteger(runs) || runs < 2) throw new Error(`runs must be an integer >= 2, got ${runs}`);
  if (!Number.isFinite(winRate) || !(stdDev >= 0)) throw new Error("winRate must be finite and stdDev >= 0");
  const nPaths = Math.min(options.samplePaths ?? 5, runs);
  const points = Math.max(1, Math.min(options.pathPoints ?? 200, hands));
  const bins = options.histogramBins ?? 40;

  const rng = createRng(options.seed ?? 1);
  const next = rng.next;
  const mu = winRate / 100, sigma = stdDev / 10;

  const pathHands = new Float64Array(points + 1);
  for (let k = 0; k <= points; k++) pathHands[k] = Math.round((k * hands) / points);
  const paths: Float64Array[] = [];
  const finals = new Float64Array(runs), drawdowns = new Float64Array(runs);

  for (let r = 0; r < runs; r++) {
    const path = r < nPaths ? new Float64Array(points + 1) : null;
    let cum = 0, peak = 0, dd = 0, k = 1;
    // Box-Muller gives normals in pairs; `spare` holds the second.
    let spare = 0, haveSpare = false;
    for (let h = 1; h <= hands; h++) {
      let z: number;
      if (haveSpare) {
        z = spare;
        haveSpare = false;
      } else {
        const u = 1 - next(); // (0, 1], so log(u) is finite
        const rad = Math.sqrt(-2 * Math.log(u)), ang = 2 * Math.PI * next();
        z = rad * Math.cos(ang);
        spare = rad * Math.sin(ang);
        haveSpare = true;
      }
      cum += mu + sigma * z;
      if (cum > peak) peak = cum;
      else if (peak - cum > dd) dd = peak - cum;
      if (path && h === pathHands[k]) path[k++] = cum;
    }
    finals[r] = cum;
    drawdowns[r] = dd;
    if (path) paths.push(path);
  }

  let sum = 0, below = 0;
  for (let r = 0; r < runs; r++) {
    sum += finals[r];
    if (finals[r] < 0) below++;
  }
  const mean = sum / runs;
  let ss = 0;
  for (let r = 0; r < runs; r++) ss += (finals[r] - mean) ** 2;
  const sorted = Float64Array.from(finals).sort();

  const lo = sorted[0], hi = sorted[runs - 1];
  const binWidth = hi > lo ? (hi - lo) / bins : 1;
  const counts = new Int32Array(bins);
  for (let r = 0; r < runs; r++) counts[Math.min(bins - 1, Math.floor((finals[r] - lo) / binWidth))]++;

  const aMean = (winRate * hands) / 100, aSd = stdDev * Math.sqrt(hands / 100);
  const ddSorted = Float64Array.from(drawdowns).sort();
  let ddSum = 0;
  for (let r = 0; r < runs; r++) ddSum += drawdowns[r];

  return {
    finals,
    histogram: { min: lo, binWidth, counts },
    pathHands,
    paths,
    simulated: {
      mean,
      sd: Math.sqrt(ss / (runs - 1)),
      belowZero: below / runs,
      interval95: [quantile(sorted, 0.025), quantile(sorted, 0.975)],
    },
    analytic: {
      mean: aMean,
      sd: aSd,
      belowZero: aSd > 0 ? normalCdf(-aMean / aSd) : aMean < 0 ? 1 : 0,
      interval95: [aMean - 1.96 * aSd, aMean + 1.96 * aSd],
    },
    drawdown: { mean: ddSum / runs, median: quantile(ddSorted, 0.5), p95: quantile(ddSorted, 0.95), max: ddSorted[runs - 1] },
  };
}
