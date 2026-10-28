// A small multilayer perceptron written by hand: dense layers, forward pass, backpropagation, Adam, seeded
// initialisation and JSON weights. No ML library; everything is plain Float64Array loops.
//
// Network. sizes = [n0, n1, ..., nL]. Layer l (1..L) maps a_{l-1} (length n_{l-1}) to
//   z_l = W_l a_{l-1} + b_l,   a_l = act(z_l) for hidden layers,   a_L = z_L (the last layer is linear).
// The last layer stays linear on purpose: its outputs are logits (for a sigmoid or softmax policy) or a value
// (for a baseline / critic), and the output helpers at the bottom turn logits into probabilities and give the
// loss gradient with respect to the logits. Keeping that split means one network class serves every head.
//
// Backpropagation (the chain rule, run backwards). Given g_L = dLoss/dz_L from the head:
//   dLoss/dW_l = g_l a_{l-1}^T,   dLoss/db_l = g_l,   dLoss/da_{l-1} = W_l^T g_l,
//   g_{l-1} = dLoss/da_{l-1} * act'(z_{l-1})       (elementwise),
// with tanh'(z) = 1 - tanh(z)^2 = 1 - a^2, readable from the stored activation a = tanh(z).
// backward() ADDS into `grads`, so a minibatch is: zeroGrad, then forward+backward per sample, then one
// optimiser step on the summed (or, after scaling, averaged) gradient.
//
// Memory layout. All weights and biases live in ONE flat Float64Array `params` (layer by layer: W_l row-major
// [out][in], then b_l), and `grads` has the same layout. That makes Adam, weight averaging, serialisation and the
// finite-difference gradient check each a single loop over one array.

import { createRng, type Rng } from "../../poker/cards";

/** Hidden-layer nonlinearity. Only tanh so far: smooth (clean gradient checks) and bounded. */
export type Activation = "tanh";

export interface MlpSpec {
  /** Layer widths [inputs, hidden..., outputs]. At least two entries. */
  sizes: readonly number[];
  /** Nonlinearity of the hidden layers (the output layer is always linear). */
  activation: Activation;
}

export interface Mlp {
  readonly spec: MlpSpec;
  /** Every weight and bias, flat (see the layout note at the top of the file). */
  readonly params: Float64Array;
  /** dLoss/dparams, same layout, accumulated by backward(). */
  readonly grads: Float64Array;
  /** Runs the net on x and returns the output layer (a view that the next forward() overwrites). */
  forward(x: ArrayLike<number>): Float64Array;
  /** Adds dLoss/dparams to `grads`, given dLoss/doutput for the most recent forward(). */
  backward(dOut: ArrayLike<number>): void;
  zeroGrad(): void;
}

interface LayerView {
  nIn: number;
  nOut: number;
  /** Offset of W (row-major [out][in]) in params; b follows at wOff + nIn * nOut. */
  wOff: number;
  bOff: number;
}

export function parameterCount(sizes: readonly number[]): number {
  let n = 0;
  for (let l = 1; l < sizes.length; l++) n += sizes[l] * (sizes[l - 1] + 1);
  return n;
}

function layout(sizes: readonly number[]): LayerView[] {
  const out: LayerView[] = [];
  let off = 0;
  for (let l = 1; l < sizes.length; l++) {
    const nIn = sizes[l - 1], nOut = sizes[l];
    out.push({ nIn, nOut, wOff: off, bOff: off + nIn * nOut });
    off += nOut * (nIn + 1);
  }
  return out;
}

/**
 * Builds a network. With an rng (or seed) the weights get a seeded uniform init on [-a, a] with Glorot's
 * a = sqrt(6 / (fanIn + fanOut)); biases start at 0. Without one, all zeros.
 * The same seed always gives the same weights.
 */
export function createMlp(spec: MlpSpec, init?: Rng | number): Mlp {
  const sizes = spec.sizes;
  if (sizes.length < 2 || sizes.some((n) => !(Number.isInteger(n) && n > 0))) throw new Error(`bad layer sizes ${sizes}`);
  const layers = layout(sizes);
  const params = new Float64Array(parameterCount(sizes));
  const grads = new Float64Array(params.length);
  // acts[0] is a copy of the input; acts[l] is layer l's output (post-activation; linear for the last layer).
  const acts = sizes.map((n) => new Float64Array(n));
  const deltas = sizes.map((n) => new Float64Array(n));

  if (init !== undefined) {
    const rng = typeof init === "number" ? createRng(init) : init;
    for (const L of layers) {
      const a = Math.sqrt(6 / (L.nIn + L.nOut));
      for (let k = 0; k < L.nIn * L.nOut; k++) params[L.wOff + k] = (2 * rng.next() - 1) * a;
    }
  }

  const forward = (x: ArrayLike<number>): Float64Array => {
    const a0 = acts[0];
    if (x.length !== a0.length) throw new Error(`expected ${a0.length} inputs, got ${x.length}`);
    for (let i = 0; i < a0.length; i++) a0[i] = x[i];
    const last = layers.length - 1;
    for (let l = 0; l <= last; l++) {
      const { nIn, nOut, wOff, bOff } = layers[l];
      const inp = acts[l], out = acts[l + 1];
      for (let o = 0; o < nOut; o++) {
        let z = params[bOff + o];
        const row = wOff + o * nIn;
        for (let i = 0; i < nIn; i++) z += params[row + i] * inp[i];
        out[o] = l === last ? z : Math.tanh(z);
      }
    }
    return acts[layers.length];
  };

  const backward = (dOut: ArrayLike<number>): void => {
    const top = deltas[layers.length];
    if (dOut.length !== top.length) throw new Error(`expected ${top.length} output gradients, got ${dOut.length}`);
    for (let o = 0; o < top.length; o++) top[o] = dOut[o];
    for (let l = layers.length - 1; l >= 0; l--) {
      const { nIn, nOut, wOff, bOff } = layers[l];
      const g = deltas[l + 1], inp = acts[l];
      for (let o = 0; o < nOut; o++) {
        const go = g[o];
        if (go === 0) continue;
        grads[bOff + o] += go;
        const row = wOff + o * nIn;
        for (let i = 0; i < nIn; i++) grads[row + i] += go * inp[i];
      }
      if (l === 0) break; // no gradient needed for the input itself
      const below = deltas[l];
      for (let i = 0; i < nIn; i++) {
        let s = 0;
        for (let o = 0; o < nOut; o++) s += params[wOff + o * nIn + i] * g[o];
        const a = inp[i];
        below[i] = s * (1 - a * a);
      }
    }
  };

  return { spec: { sizes: [...sizes], activation: spec.activation }, params, grads, forward, backward, zeroGrad: () => grads.fill(0) };
}

// ---------------------------------------------------------------------------
// Adam (Kingma & Ba 2015). For each parameter, with gradient g at step t:
//   m = b1 m + (1 - b1) g,   v = b2 v + (1 - b2) g^2,
//   param -= lr * mhat / (sqrt(vhat) + eps),   mhat = m / (1 - b1^t),   vhat = v / (1 - b2^t).
// m is a running mean of the gradient (momentum), v a running mean of its square; dividing by sqrt(v) gives
// each parameter a step of about lr whatever its gradient's scale, which suits noisy policy gradients.
// It MINIMISES: pass the gradient of a loss.

export interface AdamOptions {
  beta1?: number;
  beta2?: number;
  eps?: number;
}

export interface Adam {
  readonly t: number;
  step(params: Float64Array, grads: Float64Array, lr: number): void;
}

export function createAdam(size: number, options: AdamOptions = {}): Adam {
  const b1 = options.beta1 ?? 0.9, b2 = options.beta2 ?? 0.999, eps = options.eps ?? 1e-8;
  const m = new Float64Array(size), v = new Float64Array(size);
  let t = 0, p1 = 1, p2 = 1;
  return {
    get t() {
      return t;
    },
    step(params, grads, lr) {
      if (params.length !== size || grads.length !== size) throw new Error("Adam size mismatch");
      t++;
      p1 *= b1;
      p2 *= b2;
      const c1 = 1 / (1 - p1), c2 = 1 / (1 - p2);
      for (let k = 0; k < size; k++) {
        const g = grads[k];
        m[k] = b1 * m[k] + (1 - b1) * g;
        v[k] = b2 * v[k] + (1 - b2) * g * g;
        params[k] -= (lr * m[k] * c1) / (Math.sqrt(v[k] * c2) + eps);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Weights as JSON.

export interface MlpJson {
  sizes: number[];
  activation: Activation;
  /** The flat parameter array (layout at the top of the file). Numbers round-trip exactly through JSON. */
  params: number[];
}

export const serializeMlp = (net: Mlp): MlpJson => ({
  sizes: [...net.spec.sizes],
  activation: net.spec.activation,
  params: Array.from(net.params),
});

export function deserializeMlp(json: MlpJson): Mlp {
  const net = createMlp({ sizes: json.sizes, activation: json.activation });
  if (json.params.length !== net.params.length) throw new Error(`expected ${net.params.length} params, got ${json.params.length}`);
  net.params.set(json.params);
  return net;
}

// ---------------------------------------------------------------------------
// Output heads: logits -> probabilities, and dLoss/dlogits for the losses we use.

export const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/**
 * Bernoulli policy with P(action 1) = sigmoid(z). d log pi(a) / dz = a - p (a in {0, 1}).
 * Returns that derivative; a policy-gradient loss -A log pi(a) has dLoss/dz = -A (a - p).
 */
export const bernoulliLogProbGrad = (a: 0 | 1, z: number): number => a - sigmoid(z);

/** Numerically stable softmax of logits into `out` (default: a new array). */
export function softmax(z: ArrayLike<number>, out: Float64Array = new Float64Array(z.length)): Float64Array {
  let max = -Infinity;
  for (let i = 0; i < z.length; i++) max = Math.max(max, z[i]);
  let sum = 0;
  for (let i = 0; i < z.length; i++) sum += out[i] = Math.exp(z[i] - max);
  for (let i = 0; i < z.length; i++) out[i] /= sum;
  return out;
}

/** Categorical policy pi = softmax(z): d log pi(a) / dz_k = [k = a] - pi_k. */
export function softmaxLogProbGrad(a: number, z: ArrayLike<number>, out: Float64Array = new Float64Array(z.length)): Float64Array {
  softmax(z, out);
  for (let k = 0; k < out.length; k++) out[k] = (k === a ? 1 : 0) - out[k];
  return out;
}
