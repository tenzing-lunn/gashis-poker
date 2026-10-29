// The REINFORCE estimator is unbiased: on a two-armed bandit whose expected-reward gradient is known in
// closed form, the average of many one-sample estimates matches it within a few standard errors, for every
// parameter of the policy net, with and without a baseline. The baseline also lowers the variance.
import { describe, expect, it } from "vitest";
import { createRng } from "../../poker/cards";
import { bernoulliLogProbGrad, createMlp, sigmoid } from "./nn";

describe("REINFORCE on a two-armed bandit", () => {
  // Arm 1 pays 4 with probability 0.3, else -1 (mean 0.5). Arm 0 pays uniform on [-2, 1] (mean -0.5).
  // J(theta) = p mu1 + (1 - p) mu0 with p = sigmoid(z(theta)), so grad J = (mu1 - mu0) p (1 - p) grad z.
  const mu1 = 0.5, mu0 = -0.5;
  const x = [0.4, -0.9];
  const net = createMlp({ sizes: [2, 3, 1], activation: "tanh" }, 21);
  const P = net.params.length;
  const z = net.forward(x)[0], p = sigmoid(z);
  net.zeroGrad();
  net.backward([1]);
  const exact = Float64Array.from(net.grads, (dz) => (mu1 - mu0) * p * (1 - p) * dz);

  const estimate = (baseline: number, n: number, seed: number) => {
    const rng = createRng(seed);
    const sum = new Float64Array(P), sq = new Float64Array(P);
    for (let k = 0; k < n; k++) {
      net.forward(x);
      const a = rng.next() < p ? 1 : 0;
      const r = a ? (rng.next() < 0.3 ? 4 : -1) : -2 + 3 * rng.next();
      net.zeroGrad();
      net.backward([-(r - baseline) * bernoulliLogProbGrad(a, z)]); // the trainer's policy-loss gradient
      for (let i = 0; i < P; i++) {
        const g = -net.grads[i]; // the trainer minimises a loss; the ascent direction is its negative
        sum[i] += g;
        sq[i] += g * g;
      }
    }
    const mean = sum.map((s) => s / n);
    const se = sq.map((s, i) => Math.sqrt((s / n - mean[i] ** 2) / n));
    return { mean, se };
  };

  it("matches the exact gradient within 4 standard errors, for every parameter, with and without a baseline", () => {
    expect(p).toBeGreaterThan(0.2);
    expect(p).toBeLessThan(0.8);
    const plain = estimate(0, 200_000, 1), based = estimate(0.1, 200_000, 2);
    for (const { mean, se } of [plain, based]) {
      for (let i = 0; i < P; i++) {
        expect(Math.abs(mean[i] - exact[i]), `param ${i}: ${mean[i]} vs ${exact[i]} (se ${se[i]})`).toBeLessThan(4 * se[i] + 1e-12);
      }
    }
    // The baseline (about the average reward) shrinks every parameter's standard error.
    for (let i = 0; i < P; i++) if (exact[i] !== 0) expect(based.se[i]).toBeLessThan(plain.se[i]);
  });
});
