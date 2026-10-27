// Heads-up no-limit hold'em push/fold Nash equilibrium, solved by CFR+ over the 169 hand classes.
//
// Game (units: big blinds). SB posts 0.5, BB posts 1, no ante; both start with S bb (S includes the
// blind, S >= 1). SB folds (SB nets -0.5) or shoves all-in. Facing the shove BB folds (SB nets +1) or
// calls (SB nets 2S * eq - S, eq = SB's all-in equity with ties split).
// Deals: SB class i and BB class j occur with probability w_ij = n_ij / 1,624,350, where n_ij counts the
// card-disjoint combo pairs (card removal), and eq is replaced by E_ij, the average equity over those
// pairs. Both come from the precomputed matrix (preflop-matrix.ts).
//
// Class index = HAND_CLASSES order from lib/poker: row-major over the 13x13 grid, row r and column c
// using ranks A..2 (index 0 = AA, 1 = AKs, 13 = AKo, 14 = KK, 168 = 22); pairs on the diagonal,
// suited above it, offsuit below it.
//
// With s_i = P(SB pushes class i) and c_j = P(BB calls with class j), SB's value is bilinear:
//   u(s, c) = -0.5 + sum_i s_i * 1.5 * W_i + sum_ij s_i c_j M_ij,
//   W_i = sum_j w_ij,   M_ij = w_ij (2 S E_ij - S - 1)   (calling instead of folding moves SB's result
//   from +1 to 2S E_ij - S).
// So the push gain of class i is g_i = 1.5 W_i + (M c)_i and BB's call gain for class j is -(M^T s)_j.
// Best responses and NashConv are exact and cheap: NashConv = max_s u(s, c) - min_c u(s, c).
//
// Why CFR+ rather than fictitious play: each class is a one-shot two-action info set, so CFR+ here is
// regret-matching+ with alternating updates and linear averaging on a bilinear game. Its average
// converges roughly like 1/T in practice, where fictitious play's best-response averaging is closer to
// 1/sqrt(T) and oscillates; one iteration costs two 169x169 matrix-vector products either way.

import { HAND_CLASSES, combosOfClass } from "../poker/combinatorics";
import { formatRange } from "../poker/range";
import { CLASS_COUNT, TOTAL_COMBO_PAIRS, preflopMatrix, type PreflopMatrix } from "./preflop-matrix";

const K = CLASS_COUNT;

export interface PushFoldReport {
  /** Effective stack in bb (including the posted blind). */
  stack: number;
  /** P(SB shoves) per class, HAND_CLASSES order. */
  push: Float64Array;
  /** P(BB calls a shove) per class, HAND_CLASSES order. */
  call: Float64Array;
  /** SB's expected result in bb under (push, call). BB's is the negative. */
  sbValue: number;
  /** [SB's best-response value vs call, SB's value when BB best-responds to push], in SB's bb. */
  bestResponseValues: [number, number];
  /** Sum of both players' best-response gains, bb. */
  nashConv: number;
  /** NashConv / 2, bb. */
  exploitability: number;
  /** Fraction of all 1326 combos SB shoves. */
  pushFraction: number;
  /** Fraction of all 1326 combos BB calls with (ignoring card removal against SB's hand). */
  callFraction: number;
  iterations: number;
}

export interface PushFoldSolver {
  readonly stack: number;
  readonly iterations: number;
  step(iterations?: number): void;
  /** Linear-weighted average strategies (these converge to equilibrium). */
  averageStrategy(): { push: Float64Array; call: Float64Array };
  report(): PushFoldReport;
}

interface Model {
  stack: number;
  /** W_i (= W_j by symmetry): probability of class i. */
  classProb: Float64Array;
  /** M_ij, row-major. */
  M: Float64Array;
}

function buildModel(stack: number, matrix: PreflopMatrix): Model {
  if (!(Number.isFinite(stack) && stack >= 1)) throw new Error(`stack must be at least 1 bb, got ${stack}`);
  const { equity, pairs } = matrix;
  const M = new Float64Array(K * K), classProb = new Float64Array(K);
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      const w = pairs[i * K + j] / TOTAL_COMBO_PAIRS;
      classProb[i] += w;
      M[i * K + j] = w * (2 * stack * equity[i * K + j] - stack - 1);
    }
  }
  return { stack, classProb, M };
}

/** Push gains g = 1.5 W + M c (SB's gain from shoving over folding, per class, chance-weighted). */
function pushGains(m: Model, call: Float64Array, out: Float64Array): void {
  const M = m.M, W = m.classProb;
  for (let i = 0; i < K; i++) {
    let g = 1.5 * W[i];
    const row = i * K;
    for (let j = 0; j < K; j++) g += M[row + j] * call[j];
    out[i] = g;
  }
}

/** Call gains h = -(M^T s) (BB's gain from calling over folding, per class, chance-weighted). */
function callGains(m: Model, push: Float64Array, out: Float64Array): void {
  const M = m.M;
  out.fill(0);
  for (let i = 0; i < K; i++) {
    const s = push[i];
    if (s === 0) continue;
    const row = i * K;
    for (let j = 0; j < K; j++) out[j] -= s * M[row + j];
  }
}

function evaluate(m: Model, push: Float64Array, call: Float64Array, iterations: number): PushFoldReport {
  const g = new Float64Array(K), h = new Float64Array(K);
  pushGains(m, call, g);
  callGains(m, push, h);
  let value = -0.5, brSb = -0.5, brBb = -0.5;
  for (let i = 0; i < K; i++) {
    value += push[i] * g[i];
    brSb += Math.max(g[i], 0);
    brBb += 1.5 * m.classProb[i] * push[i];
  }
  // BB best response: call exactly where calling gains (h_j > 0), lowering SB's value by h_j.
  for (let j = 0; j < K; j++) brBb -= Math.max(h[j], 0);
  const nashConv = brSb - brBb;
  return {
    stack: m.stack,
    push,
    call,
    sbValue: value,
    bestResponseValues: [brSb, brBb],
    nashConv,
    exploitability: nashConv / 2,
    pushFraction: comboFraction(push),
    callFraction: comboFraction(call),
    iterations,
  };
}

/** A CFR+ solver for one stack depth, steppable in chunks (for progress from a worker). */
export function createPushFoldSolver(stack: number, matrix: PreflopMatrix = preflopMatrix()): PushFoldSolver {
  const m = buildModel(stack, matrix);
  // Regrets for [fold, push] / [fold, call], RM+ (kept >= 0).
  const rPush = new Float64Array(K), rSbFold = new Float64Array(K), rCall = new Float64Array(K), rBbFold = new Float64Array(K);
  const push = new Float64Array(K).fill(0.5), call = new Float64Array(K).fill(0.5);
  const sumPush = new Float64Array(K), sumCall = new Float64Array(K);
  const g = new Float64Array(K), h = new Float64Array(K);
  let t = 0, weightTotal = 0;

  const match = (rYes: Float64Array, rNo: Float64Array, out: Float64Array) => {
    for (let i = 0; i < K; i++) {
      const tot = rYes[i] + rNo[i];
      out[i] = tot > 0 ? rYes[i] / tot : 0.5;
    }
  };

  const iterate = () => {
    t++;
    // SB update against BB's current strategy. Action values relative to folding: push = g_i, fold = 0.
    pushGains(m, call, g);
    for (let i = 0; i < K; i++) {
      const s = push[i], v = s * g[i];
      rPush[i] = Math.max(rPush[i] + g[i] - v, 0);
      rSbFold[i] = Math.max(rSbFold[i] - v, 0);
      sumPush[i] += t * s;
    }
    match(rPush, rSbFold, push);
    // BB update against SB's new strategy.
    callGains(m, push, h);
    for (let j = 0; j < K; j++) {
      const c = call[j], v = c * h[j];
      rCall[j] = Math.max(rCall[j] + h[j] - v, 0);
      rBbFold[j] = Math.max(rBbFold[j] - v, 0);
      sumCall[j] += t * c;
    }
    match(rCall, rBbFold, call);
    weightTotal += t;
  };

  const average = () => {
    if (t === 0) return { push: Float64Array.from(push), call: Float64Array.from(call) };
    return { push: sumPush.map((x) => x / weightTotal), call: sumCall.map((x) => x / weightTotal) };
  };

  return {
    stack,
    get iterations() {
      return t;
    },
    step(iterations = 1) {
      for (let k = 0; k < iterations; k++) iterate();
    },
    averageStrategy: average,
    report() {
      const a = average();
      return evaluate(m, a.push, a.call, t);
    },
  };
}

export interface SolvePushFoldOptions {
  /** Stop once NashConv (bb) of the average strategy is below this. Default 1e-5 (a few hundred iterations, ~30 ms). */
  targetNashConv?: number;
  /** Hard cap on iterations. Default 20,000. */
  maxIterations?: number;
  /** Iterations between exploitability checks. Default 50. */
  checkEvery?: number;
  matrix?: PreflopMatrix;
}

/** Solves push/fold at one stack depth until the target NashConv (or the iteration cap) is reached. */
export function solvePushFold(stack: number, options: SolvePushFoldOptions = {}): PushFoldReport {
  const target = options.targetNashConv ?? 1e-5;
  const maxIterations = options.maxIterations ?? 20_000;
  const checkEvery = options.checkEvery ?? 50;
  const solver = createPushFoldSolver(stack, options.matrix);
  let report = solver.report();
  while (solver.iterations < maxIterations) {
    solver.step(Math.min(checkEvery, maxIterations - solver.iterations));
    report = solver.report();
    if (report.nashConv < target) break;
  }
  return report;
}

/** Exact value, NashConv and exploitability of any (push, call) pair at a stack depth. */
export function pushFoldExploitability(
  stack: number,
  push: ArrayLike<number>,
  call: ArrayLike<number>,
  matrix: PreflopMatrix = preflopMatrix(),
): PushFoldReport {
  if (push.length !== K || call.length !== K) throw new Error("push and call need one entry per class (169)");
  return evaluate(buildModel(stack, matrix), Float64Array.from(push), Float64Array.from(call), 0);
}

// ---------------------------------------------------------------------------
// Presenting a per-class frequency vector.

/** Fraction of the 1326 combos covered by a per-class frequency vector (each class weighted by its combo count). */
export function comboFraction(freq: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < K; i++) total += freq[i] * HAND_CLASSES[i].combos;
  return total / 1326;
}

/**
 * The standard 13x13 grid: grid[r][c] for row r and column c, ranks A..2 from the top-left. Pairs on the
 * diagonal, suited above it (row = higher rank), offsuit below it. This is exactly HAND_CLASSES order.
 */
export function classGrid(freq: ArrayLike<number>): number[][] {
  if (freq.length !== K) throw new Error("Need one frequency per class (169)");
  return Array.from({ length: 13 }, (_, r) => Array.from({ length: 13 }, (_, c) => freq[r * 13 + c]));
}

/** Class names in the same 13x13 layout as classGrid. */
export const CLASS_GRID_NAMES: readonly (readonly string[])[] = classGrid(HAND_CLASSES.map((_, i) => i)).map((row) =>
  row.map((i) => HAND_CLASSES[i].name),
);

/** lib/poker range text for the classes played at least `threshold` of the time (default 0.5), e.g. "22+, A2s+, K9o+". */
export function rangeText(freq: ArrayLike<number>, threshold = 0.5): string {
  const combos: number[] = [];
  for (let i = 0; i < K; i++) {
    if (freq[i] >= threshold) {
      const h = HAND_CLASSES[i];
      combos.push(...combosOfClass(h.hi, h.lo, h.kind));
    }
  }
  return formatRange(combos.sort((a, b) => a - b));
}
