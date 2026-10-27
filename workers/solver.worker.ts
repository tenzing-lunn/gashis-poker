// The Lab's solver worker: Kuhn CFR, the AKQ game, push/fold Nash, the variance simulator and the DCFR
// river solver, off the main thread. Message types live in lib/gto/worker-protocol.ts.
//
// One job runs at a time. Jobs yield to the event loop between chunks, so a newer request or a
// "cancel" (which bump `active`) stops the running job at its next yield. The page can also simply
// terminate the worker.
//
// The job runner (`runJob`) is exported and takes its `post` and `sleep` as arguments, so the same
// code can be exercised in Node without a Worker.

import { createCfrSolver, type CfrSolver } from "../lib/gto/cfr";
import { createKuhnGame, kuhnAlpha } from "../lib/gto/kuhn";
import { createAkqGame, akqSummary } from "../lib/gto/akq";
import { createPushFoldSolver, rangeText } from "../lib/gto/pushfold";
import { simulateVariance } from "../lib/gto/variance";
import { buildRiverGame, comboClassIndex, comboLabel, createRiverSolver, riverReach, type RiverGame } from "../lib/gto/river";
import { formatCards } from "../lib/poker/cards";
import { handCategory } from "../lib/poker/evaluator";
import type { Game } from "../lib/gto/game";
import {
  KUHN_MAX_ITERATIONS,
  RIVER_MAX_ITERATIONS,
  VARIANCE_MAX_HANDS_X_RUNS,
  type KuhnBetProbs,
  type KuhnPoint,
  type RiverComboView,
  type RiverNodeView,
  type RiverPoint,
  type RiverTreeInfo,
  type SolverRequest,
  type SolverResponse,
} from "../lib/gto/worker-protocol";

type JobRequest = Exclude<SolverRequest, { kind: "cancel" }>;

export interface JobContext {
  post: (msg: SolverResponse) => void;
  /** False once this job has been superseded or cancelled. */
  isCurrent: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** Minimum gap between progress posts, so the main thread is never flooded. */
const PROGRESS_INTERVAL_MS = 50;
/** Work between yields when running at full speed. */
const SLICE_MS = 12;

/** Checkpoints 1, 2, ..., then about `perDecade` per decade up to n (always ending at n). */
export function logSchedule(n: number, perDecade = 24): number[] {
  const out: number[] = [];
  let last = 0;
  for (let k = 0; ; k++) {
    const it = Math.round(10 ** (k / perDecade));
    if (it >= n) break;
    if (it > last) out.push((last = it));
  }
  out.push(n);
  return out;
}

function betProbs(game: Game, profile: Float64Array): KuhnBetProbs {
  const out: KuhnBetProbs = {};
  for (const s of game.infoSets) out[s.key] = profile[s.offset + 1];
  return out;
}

const clampInt = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));

async function runKuhn(req: Extract<JobRequest, { kind: "kuhn" }>, ctx: JobContext): Promise<void> {
  const t0 = ctx.now();
  const total = clampInt(req.iterations, 1, KUHN_MAX_ITERATIONS);
  const pace = Math.max(0, req.paceMs);
  const game = createKuhnGame();
  const solver: CfrSolver = createCfrSolver(game, { variant: req.variant });
  const all: KuhnPoint[] = [];
  let pending: KuhnPoint[] = [];
  let lastPost = -Infinity, sliceStart = ctx.now();

  for (const target of logSchedule(total)) {
    // Step to the checkpoint in slices so a cancel can land even at full speed.
    while (solver.iterations < target) {
      solver.step(Math.min(target - solver.iterations, 2000));
      if (ctx.now() - sliceStart > SLICE_MS) {
        await ctx.sleep(0);
        if (!ctx.isCurrent()) return;
        sliceStart = ctx.now();
      }
    }
    const r = solver.report();
    const point = { iteration: target, exploitability: r.exploitability, value: r.value };
    all.push(point);
    pending.push(point);
    if (target < total && ctx.now() - lastPost >= PROGRESS_INTERVAL_MS) {
      ctx.post({ id: req.id, kind: "kuhn", type: "progress", points: pending, iterations: target, strategy: betProbs(game, solver.averageStrategy()) });
      pending = [];
      lastPost = ctx.now();
    }
    if (pace > 0 && target < total) {
      await ctx.sleep(pace);
      if (!ctx.isCurrent()) return;
      sliceStart = ctx.now();
    }
  }

  const avg = solver.averageStrategy();
  const r = solver.report();
  ctx.post({
    id: req.id,
    kind: "kuhn",
    type: "done",
    points: pending,
    result: {
      variant: req.variant,
      iterations: solver.iterations,
      exploitability: r.exploitability,
      nashConv: r.nashConv,
      value: r.value,
      strategy: betProbs(game, avg),
      alpha: kuhnAlpha(game, avg),
      timeMs: ctx.now() - t0,
    },
  });
}

async function runAkq(req: Extract<JobRequest, { kind: "akq" }>, ctx: JobContext): Promise<void> {
  const t0 = ctx.now();
  const game = createAkqGame(req.pot, req.bet);
  const solver = createCfrSolver(game, { variant: "cfr+" });
  const total = clampInt(req.iterations, 1, 200_000);
  while (solver.iterations < total) {
    solver.step(Math.min(1000, total - solver.iterations));
    await ctx.sleep(0);
    if (!ctx.isCurrent()) return;
  }
  const avg = solver.averageStrategy();
  const r = solver.report();
  const s = akqSummary(game, avg, req.pot, req.bet, r.value);
  ctx.post({
    id: req.id,
    kind: "akq",
    type: "done",
    result: {
      pot: req.pot,
      bet: req.bet,
      iterations: solver.iterations,
      yBluff: s.yBluff,
      yBetA: s.yBetA,
      kCall: s.kCall,
      xCallVsBluff: s.xCallVsBluff,
      xCallGivenBet: s.xCallGivenBet,
      bluffShareOfBets: s.bluffShareOfBets,
      valueY: s.valueY,
      yPotShare: s.yPotShare,
      exploitability: r.exploitability,
      timeMs: ctx.now() - t0,
    },
  });
}

async function runPushFold(req: Extract<JobRequest, { kind: "pushfold" }>, ctx: JobContext): Promise<void> {
  // Yield first: if the slider queued newer requests behind this one, they take over and this one stops.
  await ctx.sleep(0);
  if (!ctx.isCurrent()) return;
  const t0 = ctx.now();
  // Same stopping rule as solvePushFold: NashConv < 1e-5 bb, checked every 50 iterations, cap 20,000.
  const solver = createPushFoldSolver(req.stack);
  let report = solver.report();
  let lastPost = ctx.now();
  while (solver.iterations < 20_000) {
    solver.step(50);
    report = solver.report();
    if (report.nashConv < 1e-5) break;
    if (ctx.now() - lastPost >= PROGRESS_INTERVAL_MS) {
      ctx.post({ id: req.id, kind: "pushfold", type: "progress", stack: req.stack, iterations: solver.iterations, nashConv: report.nashConv });
      lastPost = ctx.now();
      await ctx.sleep(0);
      if (!ctx.isCurrent()) return;
    }
  }
  ctx.post({
    id: req.id,
    kind: "pushfold",
    type: "done",
    result: {
      stack: req.stack,
      push: Array.from(report.push),
      call: Array.from(report.call),
      sbValue: report.sbValue,
      nashConv: report.nashConv,
      exploitability: report.exploitability,
      pushFraction: report.pushFraction,
      callFraction: report.callFraction,
      iterations: report.iterations,
      pushRange: rangeText(report.push),
      callRange: rangeText(report.call),
      timeMs: ctx.now() - t0,
    },
  });
}

async function runVariance(req: Extract<JobRequest, { kind: "variance" }>, ctx: JobContext): Promise<void> {
  await ctx.sleep(0);
  if (!ctx.isCurrent()) return;
  if (req.hands * req.runs > VARIANCE_MAX_HANDS_X_RUNS) throw new Error("hands x runs is too large");
  const t0 = ctx.now();
  // simulateVariance is one synchronous call (about 25 ns per hand), so this job has no progress stream.
  const v = simulateVariance({
    winRate: req.winRate,
    stdDev: req.stdDev,
    hands: req.hands,
    runs: req.runs,
    seed: req.seed,
    samplePaths: 12,
    pathPoints: 200,
    histogramBins: 40,
  });
  ctx.post({
    id: req.id,
    kind: "variance",
    type: "done",
    result: {
      winRate: req.winRate,
      stdDev: req.stdDev,
      hands: req.hands,
      runs: req.runs,
      seed: req.seed,
      histogram: { min: v.histogram.min, binWidth: v.histogram.binWidth, counts: Array.from(v.histogram.counts) },
      pathHands: Array.from(v.pathHands),
      paths: v.paths.map((p) => Array.from(p)),
      simulated: v.simulated,
      analytic: v.analytic,
      drawdown: v.drawdown,
      timeMs: ctx.now() - t0,
    },
  });
}

function riverTreeInfo(game: RiverGame): RiverTreeInfo {
  return { counts: { ...game.counts }, combos: [game.ranges[0].combos.length, game.ranges[1].combos.length], pairs: game.pairs };
}

async function runRiver(req: Extract<JobRequest, { kind: "river" }>, ctx: JobContext): Promise<void> {
  await ctx.sleep(0);
  if (!ctx.isCurrent()) return;
  const t0 = ctx.now();
  if (!(Number.isFinite(req.targetPct) && req.targetPct > 0)) throw new Error("Target exploitability must be a positive percentage of the pot");
  if (!Number.isFinite(req.maxIterations)) throw new Error("Max iterations must be a number");
  const maxIterations = clampInt(req.maxIterations, 1, RIVER_MAX_ITERATIONS);
  // Throws a readable error for a bad board, duplicate cards, empty ranges, bad sizes or a spot that is too large.
  const game = buildRiverGame({
    board: req.board,
    oopRange: req.oopRange,
    ipRange: req.ipRange,
    pot: req.pot,
    stack: req.stack,
    oopBetSizes: req.oopBetSizes,
    ipBetSizes: req.ipBetSizes,
    raiseSizes: req.raiseSizes,
    allIn: req.allIn,
    maxRaises: req.maxRaises,
  });
  const tree = riverTreeInfo(game);
  const solver = createRiverSolver(game);
  let pending: RiverPoint[] = [];
  let report = solver.report();
  let lastPost = -Infinity, sliceStart = ctx.now();
  ctx.post({ id: req.id, kind: "river", type: "progress", tree, points: [], iterations: 0 });

  while (solver.iterations < maxIterations) {
    // Checkpoints every iteration at first, then every 15% of the count, at most 25 apart: a report costs
    // about as much as one iteration, so this keeps the overhead to a few percent.
    const gap = Math.min(25, Math.max(1, Math.round(solver.iterations * 0.15)));
    const target = Math.min(maxIterations, solver.iterations + gap);
    while (solver.iterations < target) {
      solver.step(1);
      if (ctx.now() - sliceStart > SLICE_MS) {
        await ctx.sleep(0);
        if (!ctx.isCurrent()) return;
        sliceStart = ctx.now();
      }
    }
    report = solver.report();
    pending.push({ iteration: report.iterations, exploitabilityPct: report.exploitabilityPct });
    if (report.exploitabilityPct < req.targetPct) break;
    if (ctx.now() - lastPost >= PROGRESS_INTERVAL_MS) {
      ctx.post({ id: req.id, kind: "river", type: "progress", tree, points: pending, iterations: report.iterations });
      pending = [];
      lastPost = ctx.now();
    }
  }

  const avg = solver.averageStrategy();
  const reach = riverReach(game, avg);
  const index = new Map<number, number>();
  for (const nd of game.nodes) if (nd.kind === "decision") index.set(nd.id, index.size);
  const nodes: RiverNodeView[] = [];
  for (const nd of game.nodes) {
    if (nd.kind !== "decision") continue;
    nodes.push({
      id: nd.id,
      player: nd.player,
      history: nd.history,
      committed: nd.committed,
      actions: nd.actions.map((a) => ({ kind: a.kind, amount: a.amount, label: a.label })),
      next: nd.children.map((c) => index.get(c) ?? -1),
      parent: nd.parent < 0 ? -1 : (index.get(nd.parent) ?? -1),
      strategy: Float32Array.from(avg[nd.id]),
      reach: Float32Array.from(reach[nd.player][nd.id]),
    });
  }
  const combos = (p: 0 | 1): RiverComboView[] =>
    Array.from(game.ranges[p].combos, (c, i) => ({
      combo: c,
      label: comboLabel(c),
      classIndex: comboClassIndex(c),
      value: game.ranges[p].value[i],
      category: handCategory(game.ranges[p].value[i]),
    }));
  ctx.post({
    id: req.id,
    kind: "river",
    type: "done",
    tree,
    points: pending,
    result: {
      ...tree,
      board: formatCards(game.board),
      pot: game.pot,
      stack: game.stack,
      iterations: report.iterations,
      value: report.value,
      potShare: report.potShare,
      nashConv: report.nashConv,
      exploitability: report.exploitability,
      exploitabilityPct: report.exploitabilityPct,
      stoppedBy: report.exploitabilityPct < req.targetPct ? "target" : "max-iterations",
      targetPct: req.targetPct,
      rangeCombos: [combos(0), combos(1)],
      nodes,
      timeMs: ctx.now() - t0,
    },
  });
}

/** Runs one job, posting its progress and result through ctx.post. Errors become "error" responses. */
export async function runJob(req: JobRequest, ctx: JobContext): Promise<void> {
  try {
    if (req.kind === "kuhn") await runKuhn(req, ctx);
    else if (req.kind === "akq") await runAkq(req, ctx);
    else if (req.kind === "pushfold") await runPushFold(req, ctx);
    else if (req.kind === "river") await runRiver(req, ctx);
    else await runVariance(req, ctx);
  } catch (err) {
    if (ctx.isCurrent()) ctx.post({ id: req.id, kind: req.kind, type: "error", message: err instanceof Error ? err.message : String(err) } as SolverResponse);
  }
}

// ---------------------------------------------------------------------------------------------------
// Worker wiring (skipped when this module is imported outside a worker, e.g. in Node).

interface WorkerScope {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", fn: (e: MessageEvent<SolverRequest>) => void): void;
}

const WorkerGlobal = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope;
const scope: WorkerScope | undefined =
  WorkerGlobal !== undefined && globalThis instanceof WorkerGlobal ? (globalThis as unknown as WorkerScope) : undefined;

if (scope) {
  let active = 0;
  const ctxFor = (id: number): JobContext => ({
    post: (msg) => scope.postMessage(msg),
    isCurrent: () => active === id,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => performance.now(),
  });
  scope.addEventListener("message", (e) => {
    const req = e.data;
    if (req.kind === "cancel") {
      if (active === req.id) active = 0;
      return;
    }
    active = req.id;
    void runJob(req, ctxFor(req.id));
  });
}
