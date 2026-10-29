// The Beta CDF and quantile against SciPy reference values (scipy.special.betainc / betaincinv 1.16,
// computed once and pasted here), closed forms, and round trips.
import { describe, expect, it } from "vitest";
import { betaCdf, betaQuantile, logGamma } from "./beta";

const CDF: [x: number, a: number, b: number, want: number][] = [
  [0.3, 2, 5, 0.5798250000000003],
  [0.01, 0.5, 0.5, 0.06376856085851985],
  [0.9, 0.2, 3.7, 0.9999840589388561],
  [0.5, 30, 40, 0.8857998873233515],
  [0.07, 1.3, 120.0, 0.9996401738957129],
  [0.999, 50, 0.8, 0.9045141919533127],
  [0.42, 0.05, 0.05, 0.4924453962769157],
  [0.6, 250, 180, 0.7822464726748573],
];

const QUANTILE: [p: number, a: number, b: number, want: number][] = [
  [0.05, 2.3, 17.1, 0.02680717899070063],
  [0.95, 2.3, 17.1, 0.2552341863503266],
  [0.9, 0.12, 5.88, 0.06047951834230476],
  [0.05, 40.5, 3.5, 0.8448594664566738],
  [0.5, 0.3, 0.3, 0.5],
  [1e-6, 3, 4, 0.003694265299405909],
  [0.999999, 3, 4, 0.9838264867049408],
];

describe("beta distribution", () => {
  it("log-gamma matches factorials and Γ(1/2)", () => {
    let fact = 1;
    for (let n = 1; n <= 20; n++) {
      expect(logGamma(n)).toBeCloseTo(Math.log(fact), 10);
      fact *= n;
    }
    expect(logGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 12);
  });

  it("CDF matches SciPy", () => {
    for (const [x, a, b, want] of CDF) expect(Math.abs(betaCdf(x, a, b) - want)).toBeLessThan(1e-12);
  });

  it("CDF matches closed forms", () => {
    for (const x of [0.001, 0.2, 0.5, 0.77, 0.999]) {
      expect(betaCdf(x, 1, 1)).toBeCloseTo(x, 14);
      expect(betaCdf(x, 3.5, 1)).toBeCloseTo(x ** 3.5, 13);
      expect(betaCdf(x, 1, 2.5)).toBeCloseTo(1 - (1 - x) ** 2.5, 13);
      expect(betaCdf(x, 0.5, 0.5)).toBeCloseTo((2 / Math.PI) * Math.asin(Math.sqrt(x)), 13);
    }
    expect(betaCdf(0.5, 7.3, 7.3)).toBeCloseTo(0.5, 13);
  });

  it("quantile matches SciPy and inverts the CDF", () => {
    for (const [p, a, b, want] of QUANTILE) expect(Math.abs(betaQuantile(p, a, b) - want)).toBeLessThan(1e-11);
    // (Beta(0.2, 0.2) only up to p = 0.95: its 0.999 quantile is 1 - 2.5e-14, too close to 1 for a
    // double to pin the CDF to 1e-10.)
    for (const [a, b] of [[0.2, 0.2], [0.15, 9.85], [3, 400], [120.5, 6.5], [1, 1]]) {
      for (const p of a === 0.2 ? [0.001, 0.05, 0.5, 0.9, 0.95] : [0.001, 0.05, 0.5, 0.9, 0.95, 0.999]) {
        const x = betaQuantile(p, a, b);
        expect(Math.abs(betaCdf(x, a, b) - p)).toBeLessThan(1e-10);
      }
    }
    expect(betaQuantile(0, 2, 3)).toBe(0);
    expect(betaQuantile(1, 2, 3)).toBe(1);
  });
});
