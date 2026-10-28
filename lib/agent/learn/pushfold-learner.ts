// C1, the first Learner: heads-up push/fold learned by REINFORCE with a learned baseline, in self-play.
//
// Two policies, each a small net from nn.ts reading the player's features (pushfold-env.ts):
//   SB: P(shove | hand, stack) = sigmoid(f_SB(x)),   BB: P(call a shove | hand, stack) = sigmoid(f_BB(x)).
// One pair of nets covers every stack in [STACK_MIN, STACK_MAX].
//
// The policy gradient (REINFORCE, Williams 1992). A player wants to raise J(theta) = E[R], its expected
// reward. Since E[R] = sum_a pi(a|x) Q(x, a) and grad pi = pi grad log pi,
//   grad J = E[ R grad log pi(a|x) ],
// so one played episode gives an unbiased estimate: the reward times the gradient of the log-probability of
// the action actually taken. Good results push up the probability of what was done; bad ones push it down.
// Subtracting a BASELINE b(x) that doesn't depend on the action keeps it unbiased, because
// E[b(x) grad log pi(a|x)] = b(x) grad sum_a pi(a|x) = b(x) grad 1 = 0, and it cuts the variance a lot:
// the update becomes (R - b(x)) grad log pi, "was this better or worse than I usually do from here?".
// For a sigmoid policy d log pi(a) / dz = a - p, so the logit gets the signal (R - b)(a - p).
//
// The baseline is a second small net per seat, V(x), trained by least squares to predict R from x. That is
// a learned estimate of "what this hand is worth to me at this stack under the current policies".
//
// Self-play. Both seats learn at the same time against each other. Gradient play in a zero-sum game can
// circle the equilibrium instead of settling on it (matching pennies is the classic case), and here the
// noise of real showdowns keeps kicking the policies around too. Two remedies, both standard:
//   1. the step size decays linearly to a small final value, so late updates move the nets less;
//   2. we play and report the AVERAGED nets: a running average of each policy's weights (Polyak averaging,
//      uniform at first, then an exponential average over roughly the last 1 / (1 - averaging) updates).
//      Averaging iterates that circle a point lands near the point, and it averages away the noise.
// The README shows the current and averaged nets side by side.

import { createRng } from "../../poker/cards";
import { pushFoldExploitability, type PushFoldReport } from "../../gto/pushfold";
import { CLASS_COUNT } from "../../gto/preflop-matrix";
import {
  bernoulliLogProbGrad,
  createAdam,
  createMlp,
  deserializeMlp,
  serializeMlp,
  sigmoid,
  type Activation,
  type Adam,
  type Mlp,
  type MlpJson,
} from "./nn";
import {
  FEATURE_COUNT,
  STACK_MAX,
  STACK_MIN,
  classEquity,
  classIndexOf,
  createDealer,
  sbResult,
  writeFeatures,
  type RewardMode,
} from "./pushfold-env";

export interface PushFoldConfig {
  seed: number;
  /** Hidden layer widths of every net (policies and baselines). */
  hidden: number[];
  activation: Activation;
  /** Episodes per update. */
  batchSize: number;
  /** Policy step size (Adam) at the start; decays linearly to lrFinal at totalEpisodes. */
  lr: number;
  lrFinal: number;
  /** Length of the step-size schedule (training may stop earlier). */
  totalEpisodes: number;
  /** Baseline step size (constant). */
  baselineLr: number;
  /** Weight-averaging decay per update; the average spans about 1 / (1 - averaging) updates. */
  averaging: number;
  /** Stacks are drawn uniformly from [stackMin, stackMax] bb, one per episode. */
  stackMin: number;
  stackMax: number;
  reward: RewardMode;
}

export const DEFAULT_CONFIG: PushFoldConfig = {
  seed: 1,
  hidden: [32],
  activation: "tanh",
  batchSize: 1000,
  lr: 3e-3,
  lrFinal: 2e-4,
  totalEpisodes: 20_000_000,
  baselineLr: 3e-3,
  averaging: 0.999,
  stackMin: STACK_MIN,
  stackMax: STACK_MAX,
  reward: "showdown",
};

export interface PushFoldStrategy {
  /** P(SB shoves) per class, HAND_CLASSES order. */
  push: Float64Array;
  /** P(BB calls) per class. */
  call: Float64Array;
}

export interface PushFoldTrainer {
  readonly config: PushFoldConfig;
  readonly episodes: number;
  readonly updates: number;
  /** Plays and learns from `episodes` more episodes (rounded up to whole batches). */
  train(episodes: number): void;
  /** Per-class probabilities at a stack, from the averaged nets (default) or the current ones. */
  strategy(stack: number, nets?: "average" | "current"): PushFoldStrategy;
  /** Exact exploitability of strategy(stack, nets), by lib/gto/pushfold. */
  report(stack: number, nets?: "average" | "current"): PushFoldReport;
  /** The current weights of the four nets and the two averages (for reproducibility checks). */
  weights(): Float64Array[];
  checkpoint(stacks?: readonly number[]): PushFoldCheckpoint;
}

export interface PushFoldCheckpoint {
  format: "pushfold-c1";
  config: PushFoldConfig;
  episodes: number;
  /** The averaged policy nets (what the learner plays). */
  sb: MlpJson;
  bb: MlpJson;
  /** Exploitability (bb) of these nets at a few stacks, when the checkpoint was written. */
  exploitability: Record<string, number>;
  /** The learning curve, written by scripts/train-pushfold.ts (absent from trainer.checkpoint()). */
  curve?: PushFoldCurveRow[];
}

/** One learning-curve row: exploitability (bb, rounded to 1e-5) at the script's stacks, averaged and current nets. */
export interface PushFoldCurveRow {
  episodes: number;
  seconds: number;
  average: number[];
  current: number[];
}

/** Per-class probabilities of a policy net at one stack. */
export function netStrategy(net: Mlp, stack: number): Float64Array {
  const x = new Float64Array(FEATURE_COUNT), out = new Float64Array(CLASS_COUNT);
  for (let c = 0; c < CLASS_COUNT; c++) out[c] = sigmoid(net.forward(writeFeatures(c, stack, x))[0]);
  return out;
}

export function createPushFoldTrainer(overrides: Partial<PushFoldConfig> = {}): PushFoldTrainer {
  const config: PushFoldConfig = { ...DEFAULT_CONFIG, ...overrides, hidden: [...(overrides.hidden ?? DEFAULT_CONFIG.hidden)] };
  if (config.reward !== "showdown" && config.reward !== "expected") throw new Error(`unknown reward mode: ${String(config.reward)}`);
  const { batchSize, stackMin, stackMax, reward } = config;
  const rng = createRng(config.seed);
  const spec = { sizes: [FEATURE_COUNT, ...config.hidden, 1], activation: config.activation };
  // Init order is fixed, so a seed fixes every weight.
  const sbPolicy = createMlp(spec, rng), bbPolicy = createMlp(spec, rng);
  const sbValue = createMlp(spec, rng), bbValue = createMlp(spec, rng);
  const sbAverage = createMlp(spec), bbAverage = createMlp(spec);
  sbAverage.params.set(sbPolicy.params);
  bbAverage.params.set(bbPolicy.params);
  const nets = [sbPolicy, bbPolicy, sbValue, bbValue];
  const optimisers: Adam[] = nets.map((n) => createAdam(n.params.length));
  const dealer = createDealer(rng), deck = dealer.deck;
  const xs = new Float64Array(FEATURE_COUNT), xb = new Float64Array(FEATURE_COUNT), d = new Float64Array(1);
  let episodes = 0, updates = 0;

  const backward = (net: Mlp, g: number) => {
    d[0] = g;
    net.backward(d);
  };

  const playOne = () => {
    dealer.dealHoles();
    const sbClass = classIndexOf(deck[0], deck[1]), bbClass = classIndexOf(deck[2], deck[3]);
    const stack = stackMin + (stackMax - stackMin) * rng.next();

    // SB acts: sample shove ~ Bernoulli(p), and read the baseline for this observation.
    writeFeatures(sbClass, stack, xs);
    const zShove = sbPolicy.forward(xs)[0];
    const shove = rng.next() < sigmoid(zShove);
    const sbBase = sbValue.forward(xs)[0];

    let r = -0.5; // SB's reward
    if (shove) {
      writeFeatures(bbClass, stack, xb);
      const zCall = bbPolicy.forward(xb)[0];
      const call = rng.next() < sigmoid(zCall);
      const bbBase = bbValue.forward(xb)[0];
      const share = !call ? 0 : reward === "showdown" ? dealer.showdown() : classEquity(sbClass, bbClass);
      r = sbResult(stack, true, call, share);
      // BB's reward is -r. Policy: (R - b) grad log pi. Baseline: gradient of (b - R)^2 / 2.
      backward(bbPolicy, -(-r - bbBase) * bernoulliLogProbGrad(call ? 1 : 0, zCall));
      backward(bbValue, bbBase + r);
    }
    backward(sbPolicy, -(r - sbBase) * bernoulliLogProbGrad(shove ? 1 : 0, zShove));
    backward(sbValue, sbBase - r);
  };

  const average = (avg: Mlp, net: Mlp) => {
    // Uniform average for the first updates, then exponential: weight of the newest = max(1 - averaging, 1/k).
    const w = Math.max(1 - config.averaging, 1 / (updates + 1));
    const a = avg.params, p = net.params;
    for (let k = 0; k < a.length; k++) a[k] += w * (p[k] - a[k]);
  };

  const update = () => {
    const progress = Math.min(1, episodes / config.totalEpisodes);
    const lr = config.lr + (config.lrFinal - config.lr) * progress;
    for (let n = 0; n < nets.length; n++) {
      const net = nets[n], g = net.grads;
      for (let k = 0; k < g.length; k++) g[k] /= batchSize;
      optimisers[n].step(net.params, g, n < 2 ? lr : config.baselineLr);
      net.zeroGrad();
    }
    updates++;
    average(sbAverage, sbPolicy);
    average(bbAverage, bbPolicy);
  };

  const pick = (which: "average" | "current") => (which === "average" ? [sbAverage, bbAverage] : [sbPolicy, bbPolicy]);

  const trainer: PushFoldTrainer = {
    config,
    get episodes() {
      return episodes;
    },
    get updates() {
      return updates;
    },
    train(n) {
      for (let done = 0; done < n; done += batchSize) {
        for (let k = 0; k < batchSize; k++) playOne();
        episodes += batchSize;
        update();
      }
    },
    strategy(stack, which = "average") {
      const [sb, bb] = pick(which);
      return { push: netStrategy(sb, stack), call: netStrategy(bb, stack) };
    },
    report(stack, which = "average") {
      const s = trainer.strategy(stack, which);
      return pushFoldExploitability(stack, s.push, s.call);
    },
    weights: () => [...nets, sbAverage, bbAverage].map((n) => Float64Array.from(n.params)),
    checkpoint(stacks = [5, 10, 15, 20]) {
      const exploitability: Record<string, number> = {};
      for (const s of stacks) exploitability[s] = trainer.report(s).exploitability;
      return { format: "pushfold-c1", config, episodes, sb: serializeMlp(sbAverage), bb: serializeMlp(bbAverage), exploitability };
    },
  };
  return trainer;
}

/** The policy stored in a checkpoint: per-class probabilities at any stack. */
export function loadPushFoldPolicy(checkpoint: PushFoldCheckpoint): { strategy(stack: number): PushFoldStrategy } {
  if (checkpoint.format !== "pushfold-c1") throw new Error(`not a C1 checkpoint: ${checkpoint.format}`);
  const sb = deserializeMlp(checkpoint.sb), bb = deserializeMlp(checkpoint.bb);
  return { strategy: (stack) => ({ push: netStrategy(sb, stack), call: netStrategy(bb, stack) }) };
}
