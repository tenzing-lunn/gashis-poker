import { describe, expect, it } from "vitest";
import { normalCdf, simulateVariance } from "./variance";

describe("normalCdf", () => {
  it("matches standard values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959963985)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655254, 6);
    expect(normalCdf(3)).toBeCloseTo(0.998650102, 6);
  });
});

describe("simulateVariance", () => {
  // Tolerances: with R runs whose finals have true SD sigma_F = sd * sqrt(H/100),
  //   SE(mean) = sigma_F / sqrt(R),
  //   SE(sample SD) ~= sigma_F / sqrt(2 (R - 1))   (normal finals),
  //   SE(fraction below 0) = sqrt(p (1 - p) / R).
  // Each check allows 4 standard errors, so a correct simulator fails a given check with
  // probability ~6e-5; the seeds are fixed, so the outcome is deterministic anyway.
  const cases = [
    { winRate: 5, stdDev: 90, hands: 20_000, runs: 1000 },
    { winRate: -2, stdDev: 130, hands: 5_000, runs: 2000 },
    { winRate: 10, stdDev: 60, hands: 1_000, runs: 4000 },
  ];
  for (const c of cases) {
    it(`matches analytic mean / SD / P(below 0) for ${JSON.stringify(c)}`, () => {
      const r = simulateVariance({ ...c, seed: 11 });
      const sigmaF = c.stdDev * Math.sqrt(c.hands / 100);
      expect(r.analytic.mean).toBeCloseTo((c.winRate * c.hands) / 100, 9);
      expect(r.analytic.sd).toBeCloseTo(sigmaF, 9);
      expect(Math.abs(r.simulated.mean - r.analytic.mean)).toBeLessThan((4 * sigmaF) / Math.sqrt(c.runs));
      expect(Math.abs(r.simulated.sd - r.analytic.sd)).toBeLessThan((4 * sigmaF) / Math.sqrt(2 * (c.runs - 1)));
      const p = r.analytic.belowZero;
      expect(Math.abs(r.simulated.belowZero - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / c.runs));
      // The 95% intervals agree to within a few SEs of a quantile (loosely: 0.25 sigma_F).
      expect(Math.abs(r.simulated.interval95[0] - r.analytic.interval95[0])).toBeLessThan(0.25 * sigmaF);
      expect(Math.abs(r.simulated.interval95[1] - r.analytic.interval95[1])).toBeLessThan(0.25 * sigmaF);
    });
  }

  it("per-hand draws have mean wr/100 and SD sd/10 (one-hand runs)", () => {
    const runs = 200_000;
    const r = simulateVariance({ winRate: 7, stdDev: 100, hands: 1, runs, seed: 3 });
    expect(Math.abs(r.simulated.mean - 0.07)).toBeLessThan((4 * 10) / Math.sqrt(runs));
    expect(Math.abs(r.simulated.sd - 10)).toBeLessThan((4 * 10) / Math.sqrt(2 * runs));
  });

  it("is deterministic for a seed and returns consistent paths, histogram and drawdowns", () => {
    const opts = { winRate: 3, stdDev: 90, hands: 2_000, runs: 300, samplePaths: 4, pathPoints: 50 };
    const a = simulateVariance({ ...opts, seed: 42 }), b = simulateVariance({ ...opts, seed: 42 });
    const c = simulateVariance({ ...opts, seed: 43 });
    expect(Array.from(a.finals)).toEqual(Array.from(b.finals));
    expect(a.drawdown).toEqual(b.drawdown);
    expect(Array.from(c.finals)).not.toEqual(Array.from(a.finals));
    expect(a.paths.length).toBe(4);
    expect(a.pathHands.length).toBe(51);
    expect(a.pathHands[50]).toBe(2000);
    for (let k = 0; k < 4; k++) {
      expect(a.paths[k][0]).toBe(0);
      expect(a.paths[k][50]).toBe(a.finals[k]);
    }
    expect(a.histogram.counts.reduce((s, x) => s + x, 0)).toBe(300);
    // A run's drawdown is at least how far its final result sits below its best point on the path.
    for (let k = 0; k < 4; k++) expect(a.drawdown.max).toBeGreaterThanOrEqual(Math.max(...a.paths[k]) - a.finals[k] - 1e-9);
    expect(a.drawdown.median).toBeLessThanOrEqual(a.drawdown.p95);
    expect(a.drawdown.p95).toBeLessThanOrEqual(a.drawdown.max);
  });

  it("rejects bad input", () => {
    expect(() => simulateVariance({ winRate: 1, stdDev: 90, hands: 0, runs: 10 })).toThrow();
    expect(() => simulateVariance({ winRate: 1, stdDev: -1, hands: 10, runs: 10 })).toThrow();
    expect(() => simulateVariance({ winRate: 1, stdDev: 90, hands: 10, runs: 1 })).toThrow();
  });
});
