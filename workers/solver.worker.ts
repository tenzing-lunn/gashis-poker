// The solver worker behind the lesson widgets (the AKQ game, push/fold Nash) and the /learn/tools
// DCFR river solver, off the main thread. Message types live in lib/gto/worker-protocol.ts.
//
// One job runs at a time. Jobs yield to the event loop between chunks, so a newer request or a
// "cancel" (which bump `active`) stops the running job at its next yield. The page can also simply
// terminate the worker.
//
// The job runner (`runJob`) is exported and takes its `post` and `sleep` as arguments, so the same
// code can be exercised in Node without a Worker.

import { createCfrSolver } from "../lib/gto/cfr";
import { createAkqGame, akqSummary } from "../lib/gto/akq";
import { createPushFoldSolver, rangeText } from "../lib/gto/pushfold";
import { buildRiverGame, comboClassIndex, comboLabel, createRiverSolver, riverReach, type RiverGame } from "../lib/gto/river";
import { formatCards } from "../lib/poker/cards";
import { handCategory } from "../lib/poker/evaluator";
import {
  RIVER_MAX_ITERATIONS,
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

const clampInt = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));

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
  ctx.post({
    id: req.id,
    kind: "akq",
    type: "done",
    result: {
      ...akqSummary(game, avg, req.pot, req.bet),
      iterations: solver.iterations,
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
    if (req.kind === "akq") await runAkq(req, ctx);
    else if (req.kind === "pushfold") await runPushFold(req, ctx);
    else await runRiver(req, ctx);
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
