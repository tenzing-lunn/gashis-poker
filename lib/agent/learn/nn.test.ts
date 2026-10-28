import { describe, expect, it } from "vitest";
import { createRng } from "../../poker/cards";
import {
  bernoulliLogProbGrad,
  createAdam,
  createMlp,
  deserializeMlp,
  parameterCount,
  serializeMlp,
  sigmoid,
  softmax,
  softmaxLogProbGrad,
  type Mlp,
} from "./nn";

// A head turns the net's output into a scalar loss and gives dLoss/doutput. These are the three heads used:
// a Bernoulli policy (C1's push and call), a value baseline (squared error) and a softmax policy (C2).
interface Head {
  name: string;
  outputs: number;
  loss(out: Float64Array, k: number): number;
  grad(out: Float64Array, k: number): Float64Array;
}

const ADV = [1.7, -0.6, 2.3];
const heads: Head[] = [
  {
    name: "sigmoid policy, loss -A log pi(a)",
    outputs: 1,
    loss: (o, k) => {
      const a = k % 2, p = sigmoid(o[0]);
      return -ADV[k] * Math.log(a ? p : 1 - p);
    },
    grad: (o, k) => Float64Array.of(-ADV[k] * bernoulliLogProbGrad(k % 2 ? 1 : 0, o[0])),
  },
  {
    name: "linear value, loss (V - y)^2 / 2",
    outputs: 1,
    loss: (o, k) => 0.5 * (o[0] - ADV[k]) ** 2,
    grad: (o, k) => Float64Array.of(o[0] - ADV[k]),
  },
  {
    name: "softmax policy, loss -A log pi(a)",
    outputs: 3,
    loss: (o, k) => -ADV[k] * Math.log(softmax(o)[k]),
    grad: (o, k) => softmaxLogProbGrad(k, o).map((g) => -ADV[k] * g),
  },
];

const INPUTS = [
  [0.3, -1.2, 0.8],
  [-0.5, 0.4, 1.1],
  [1.4, 0.2, -0.7],
];

/** Total loss over the three inputs; if `backprop`, also accumulates the analytic gradient into net.grads. */
function totalLoss(net: Mlp, head: Head, backprop: boolean): number {
  let L = 0;
  for (let k = 0; k < INPUTS.length; k++) {
    const out = net.forward(INPUTS[k]);
    L += head.loss(out, k);
    if (backprop) net.backward(head.grad(out, k));
  }
  return L;
}

describe("nn: gradient check (central finite differences, double precision)", () => {
  for (const head of heads) {
    it(`${head.name}: every parameter of a 3-5-4-${head.outputs} tanh net matches to relative error < 1e-5`, () => {
      const net = createMlp({ sizes: [3, 5, 4, head.outputs], activation: "tanh" }, 7);
      // Random biases too, so every parameter has a non-trivial gradient.
      const rng = createRng(11);
      for (let k = 0; k < net.params.length; k++) net.params[k] = 1.2 * (2 * rng.next() - 1);
      net.zeroGrad();
      totalLoss(net, head, true);
      const analytic = Float64Array.from(net.grads);
      const h = 1e-6;
      let worst = 0;
      for (let k = 0; k < net.params.length; k++) {
        const w = net.params[k];
        net.params[k] = w + h;
        const up = totalLoss(net, head, false);
        net.params[k] = w - h;
        const down = totalLoss(net, head, false);
        net.params[k] = w;
        const numeric = (up - down) / (2 * h);
        const rel = Math.abs(analytic[k] - numeric) / Math.max(Math.abs(analytic[k]), Math.abs(numeric), 1e-8);
        worst = Math.max(worst, rel);
        expect(rel, `param ${k}: analytic ${analytic[k]}, numeric ${numeric}`).toBeLessThan(1e-5);
      }
      expect(worst).toBeLessThan(1e-5);
      expect(net.params.length).toBe(parameterCount([3, 5, 4, head.outputs]));
    });
  }
});

describe("nn: init, serialisation, Adam", () => {
  it("the same seed gives the same weights; JSON round-trips exactly", () => {
    const spec = { sizes: [5, 8, 1], activation: "tanh" as const };
    const a = createMlp(spec, 3), b = createMlp(spec, 3), c = createMlp(spec, 4);
    expect(Array.from(a.params)).toEqual(Array.from(b.params));
    expect(Array.from(a.params)).not.toEqual(Array.from(c.params));
    const copy = deserializeMlp(JSON.parse(JSON.stringify(serializeMlp(a))));
    expect(Array.from(copy.params)).toEqual(Array.from(a.params));
    const x = [0.1, -0.2, 0.3, 1, 0];
    expect(copy.forward(x)[0]).toBe(a.forward(x)[0]);
  });

  it("Adam fits a small regression (y = sin(2x)) by minimising squared error", () => {
    const net = createMlp({ sizes: [1, 16, 1], activation: "tanh" }, 1);
    const adam = createAdam(net.params.length);
    const xs = Array.from({ length: 32 }, (_, i) => -1.5 + (3 * i) / 31);
    const mse = () => xs.reduce((s, x) => s + (net.forward([x])[0] - Math.sin(2 * x)) ** 2, 0) / xs.length;
    const before = mse();
    for (let step = 0; step < 2000; step++) {
      net.zeroGrad();
      for (const x of xs) net.backward([net.forward([x])[0] - Math.sin(2 * x)]);
      adam.step(net.params, net.grads, 0.01);
    }
    expect(before).toBeGreaterThan(0.1);
    expect(mse()).toBeLessThan(1e-3);
    expect(adam.t).toBe(2000);
  });
});
