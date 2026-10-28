// The sim worker's jobs: hero's equity and the bots' ranges at a spot, and grading a hero decision.
// Message types live in protocol.ts; the worker entry (sim.worker.ts) only wires messages to runJob.
//
// runJob takes an injected JobContext (post, isCurrent, sleep, now, optional cache), so the same code runs
// in Node tests without a Worker. Work is chunked and the job yields (ctx.sleep(0)) once SLICE_MS have
// passed since the last yield; after each yield it stops silently if it is no longer current. Chunks are
// small: exact enumeration steps about EXACT_EVALS_PER_CHUNK hand evaluations at a time (a flop vs a
// full range is ~1M evaluations, so it is cut into ~50 chunks) and Monte Carlo steps a few hundred to a
// couple of thousand trials, so a cancel lands within one slice. Progress posts are throttled to one per
// PROGRESS_INTERVAL_MS (the first rough estimate and the final one are always posted).
//
// spot: ranges = inferRange(persona, history, seat, { dead: heroCards }) for every live bot, plus the
//   lib/sim/breakdown summaries. Equity:
//   - heads-up postflop: rough = SPOT_ROUGH_TRIALS of Monte Carlo (multiway.ts with one range), then the
//     exact enumeration of weighted-equity.ts (startEquityVsRange), chunked;
//   - heads-up preflop (startEquityVsRange) and multiway (startMultiwayEquity): one seeded Monte Carlo run
//     capped at maxTrials; its first SPOT_ROUGH_TRIALS are the rough estimate and it continues in fixed
//     chunks until hero's stdErr <= targetStdErr or the cap. The stopping rule only looks at the estimate
//     after whole chunks, so the answer is deterministic and equals the direct lib/sim call with
//     trials = result.equity.samples and the same seed.
// grade: gradeDecision (lib/grading) is one synchronous computation, so it cannot be cut into slices;
//   multiway it runs twice, first with GRADE_COARSE_PARTICLES particles (posted as "progress"), with a
//   yield in between. Cancellation lands between the passes, or before the first.
//
// Cache (cache.ts): a finished job's result is stored under its canonical key; a request with the same
// key posts "done" with the stored result immediately (`cached: true`) without recomputing anything.

import { legalActions, potTotal, type HandState } from "../engine/engine";
import type { Card } from "../poker/cards";
import { COMBO_COUNT } from "../poker/combinatorics";
import { PERSONAS, type Persona, type PersonaId } from "../bots/personas";
import { inferRange } from "../bots/range";
import { DEFAULT_PARTICLES } from "../grading/ev";
import { gradeDecision } from "../grading/grade";
import { stateFromHistory } from "../grading/state";
import type { GradeInput, GradeResult } from "../grading/types";
import { classFrequencies, classShares, handBuckets } from "./breakdown";
import { gradeKey, spotKey, type LruCache } from "./cache";
import { startMultiwayEquity, type MultiwayEquity } from "./multiway";
import {
  GRADE_COARSE_PARTICLES,
  GRADE_MAX_PARTICLES,
  SPOT_DEFAULT_STDERR,
  SPOT_DEFAULT_TRIALS,
  SPOT_MAX_TRIALS,
  SPOT_ROUGH_TRIALS,
  type GradeRequest,
  type SimRequest,
  type SimResponse,
  type SpotEquity,
  type SpotRange,
  type SpotRequest,
  type SpotResult,
} from "./protocol";
import { startEquityVsRange, type WeightedEquity } from "./weighted-equity";

type JobRequest = Exclude<SimRequest, { kind: "cancel" }>;

/** What the cache stores per key. */
export type CachedResult = { kind: "spot"; result: SpotResult } | { kind: "grade"; result: GradeResult };

export interface JobContext {
  post: (msg: SimResponse) => void;
  /** False once this job has been superseded or cancelled. */
  isCurrent: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Finished results by request key; omit to disable caching. */
  cache?: LruCache<CachedResult>;
}

/** Work between yields. */
export const SLICE_MS = 12;
/** Minimum gap between progress posts. */
export const PROGRESS_INTERVAL_MS = 50;
/** Hand evaluations per exact-enumeration chunk. */
export const EXACT_EVALS_PER_CHUNK = 20_000;
/** Monte Carlo trials per chunk: heads-up, and per opponent multiway. */
const HU_CHUNK = 2000;
const MW_CHUNK = 1000;
const MAX_TRIALS_PER_COMBO = 10_000;

/** Returns a function that yields once SLICE_MS have passed since the last yield; false = stop (superseded). */
function slicer(ctx: JobContext): () => Promise<boolean> {
  let start = ctx.now();
  return async () => {
    if (ctx.now() - start < SLICE_MS) return true;
    await ctx.sleep(0);
    start = ctx.now();
    return ctx.isCurrent();
  };
}

// ---------------------------------------------------------------------------------------------------
// Validation

const isCard = (c: unknown): c is Card => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 51;
const isPersonaId = (p: unknown): p is PersonaId => typeof p === "string" && Object.prototype.hasOwnProperty.call(PERSONAS, p);
const isPositiveInt = (x: unknown, max: number): boolean => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= max;

interface Spot {
  state: HandState;
  /** Live bot seats (not the hero, not folded), ascending. */
  seats: number[];
  /** Persona of each seat in `seats`. */
  personas: Persona[];
}

/** Checks everything the jobs share and rebuilds the state; throws with a readable message. */
function validateSpot(req: SpotRequest | GradeRequest): Spot {
  const h = req.history;
  if (!h || !Array.isArray(h.stacks) || !Array.isArray(h.actions) || !Array.isArray(h.board)) {
    throw new Error("history needs stacks, actions and board arrays");
  }
  const n = h.stacks.length;
  if (![0, 3, 4, 5].includes(h.board.length)) throw new Error(`Board must have 0 or 3-5 cards, got ${h.board.length}`);
  if (!Number.isInteger(req.heroSeat) || req.heroSeat < 0 || req.heroSeat >= n) throw new Error(`Invalid hero seat ${req.heroSeat}`);
  if (!Array.isArray(req.heroCards) || req.heroCards.length !== 2) throw new Error("Hero needs exactly 2 cards");
  const seen = new Uint8Array(52);
  for (const c of [...h.board, ...req.heroCards]) {
    if (!isCard(c)) throw new Error(`Invalid card id ${String(c)}`);
    if (seen[c]) throw new Error(`Card ${c} appears twice among the board and hero's cards`);
    seen[c] = 1;
  }
  if (!Array.isArray(req.personas) || req.personas.length !== n) throw new Error(`personas needs one entry per seat (${n})`);
  req.personas.forEach((p, seat) => {
    if (seat !== req.heroSeat && p !== null && !isPersonaId(p)) throw new Error(`Unknown persona ${String(p)} at seat ${seat}`);
  });

  const state = stateFromHistory(h);
  if (state.folded[req.heroSeat]) throw new Error(`Hero (seat ${req.heroSeat}) has folded`);
  const seats: number[] = [];
  const personas: Persona[] = [];
  for (let seat = 0; seat < n; seat++) {
    if (seat === req.heroSeat || state.folded[seat]) continue;
    const id = req.personas[seat];
    if (id === null) throw new Error(`Seat ${seat} is live but has no persona`);
    seats.push(seat);
    personas.push(PERSONAS[id]);
  }
  if (seats.length === 0) throw new Error("No live opponents");
  return { state, seats, personas };
}

// ---------------------------------------------------------------------------------------------------
// spot

function headsUpPlayers(e: WeightedEquity, hero: number, seat: number): SpotEquity["players"] {
  return [
    { seat: hero, equity: e.equity, win: e.win, tie: e.tie, stdErr: e.stdErr },
    { seat, equity: 1 - e.equity, win: Math.max(0, 1 - e.win - e.tie), tie: e.tie, stdErr: e.stdErr },
  ];
}

function multiwayPlayers(e: MultiwayEquity, hero: number, seats: readonly number[]): SpotEquity["players"] {
  return e.players.map((p, k) => ({ seat: k === 0 ? hero : seats[k - 1], equity: p.equity, win: p.win, tie: p.tie, stdErr: p.stdErr }));
}

async function runSpot(req: SpotRequest, ctx: JobContext): Promise<void> {
  const { state, seats, personas } = validateSpot(req);
  const maxTrials = req.maxTrials ?? SPOT_DEFAULT_TRIALS;
  const target = req.targetStdErr ?? SPOT_DEFAULT_STDERR;
  const seed = req.seed ?? 1;
  if (!isPositiveInt(maxTrials, SPOT_MAX_TRIALS)) throw new Error(`maxTrials must be an integer in 1..${SPOT_MAX_TRIALS}`);
  if (!(target > 0) || !Number.isFinite(target)) throw new Error("targetStdErr must be a positive number");
  if (!Number.isFinite(seed)) throw new Error("seed must be a finite number");

  const key = spotKey(req);
  const hit = ctx.cache?.get(key);
  if (hit?.kind === "spot") {
    ctx.post({ id: req.id, kind: "spot", type: "done", result: hit.result, cached: true });
    return;
  }
  // Let a queued newer request or cancel land before any real work.
  await ctx.sleep(0);
  if (!ctx.isCurrent()) return;
  const tick = slicer(ctx);
  const hero = req.heroCards;
  const board = state.board.slice();
  const blocked = [...board, ...hero];

  const ranges: SpotRange[] = [];
  for (let k = 0; k < seats.length; k++) {
    const weights = inferRange(personas[k], req.history, seats[k], { dead: hero });
    ranges.push({
      seat: seats[k],
      persona: personas[k].id,
      weights,
      classShares: classShares(weights),
      classFrequencies: classFrequencies(weights, blocked),
      buckets: board.length >= 3 ? handBuckets(weights, board) : null,
    });
    if (!(await tick())) return;
  }
  ctx.post({ id: req.id, kind: "spot", type: "ranges", ranges });

  const ws = ranges.map((r) => r.weights);
  const heroSeat = req.heroSeat;
  let lastPost = -Infinity;
  const postEquity = (equity: SpotEquity, force: boolean) => {
    if (!force && ctx.now() - lastPost < PROGRESS_INTERVAL_MS) return;
    ctx.post({ id: req.id, kind: "spot", type: "equity", equity });
    lastPost = ctx.now();
  };

  let final: SpotEquity;
  if (seats.length === 1 && board.length >= 3) {
    // Rough: a small Monte Carlo; then the exact enumeration in chunks.
    const rough = startMultiwayEquity(hero, ws, board, { trials: Math.min(SPOT_ROUGH_TRIALS, maxTrials), seed });
    while (!rough.done) {
      rough.step(HU_CHUNK);
      if (!(await tick())) return;
    }
    const r = rough.result();
    postEquity({ stage: "rough", players: multiwayPlayers(r, heroSeat, seats), exact: false, samples: r.samples }, true);

    const exact = startEquityVsRange(hero, ws[0], board);
    let combos = 0;
    for (let c = 0; c < COMBO_COUNT; c++) if (ws[0][c] > 0) combos++;
    const units = Math.max(1, Math.floor(EXACT_EVALS_PER_CHUNK / combos));
    while (!exact.done) {
      exact.step(units);
      if (!(await tick())) return;
    }
    const e = exact.result();
    final = { stage: "refined", players: headsUpPlayers(e, heroSeat, seats[0]), exact: true, samples: e.samples };
  } else {
    // One Monte Carlo run: its first SPOT_ROUGH_TRIALS are the rough estimate.
    const headsUp = seats.length === 1;
    let run: { step(units: number): boolean; readonly done: boolean };
    let snapshot: (stage: SpotEquity["stage"]) => SpotEquity;
    if (headsUp) {
      const hu = startEquityVsRange(hero, ws[0], board, { trials: maxTrials, seed });
      run = hu;
      snapshot = (stage) => {
        const e = hu.result();
        return { stage, players: headsUpPlayers(e, heroSeat, seats[0]), exact: false, samples: e.samples };
      };
    } else {
      const mw = startMultiwayEquity(hero, ws, board, { trials: maxTrials, seed });
      run = mw;
      snapshot = (stage) => {
        const e = mw.result();
        return { stage, players: multiwayPlayers(e, heroSeat, seats), exact: false, samples: e.samples };
      };
    }
    const chunk = headsUp ? HU_CHUNK : Math.max(100, Math.floor(MW_CHUNK / seats.length));
    const roughTrials = Math.min(SPOT_ROUGH_TRIALS, maxTrials);
    let trials = 0;
    while (trials < roughTrials) {
      const k = Math.min(chunk, roughTrials - trials);
      run.step(k);
      trials += k;
      if (!(await tick())) return;
    }
    let current = snapshot("rough");
    postEquity(current, true);
    while (!run.done && current.players[0].stdErr > target) {
      run.step(chunk);
      if (!(await tick())) return;
      current = snapshot("refined");
      if (!run.done && current.players[0].stdErr > target) postEquity(current, false);
    }
    final = { ...current, stage: "refined" };
  }

  if (!ctx.isCurrent()) return;
  postEquity(final, true);
  const result: SpotResult = { street: state.street, board, pot: potTotal(state), heroSeat, ranges, equity: final };
  ctx.cache?.set(key, { kind: "spot", result });
  ctx.post({ id: req.id, kind: "spot", type: "done", result, cached: false });
}

// ---------------------------------------------------------------------------------------------------
// grade

async function runGrade(req: GradeRequest, ctx: JobContext): Promise<void> {
  const { state, seats } = validateSpot(req);
  const la = legalActions(state);
  if (la === null || la.seat !== req.heroSeat) throw new Error(`Seat ${req.heroSeat} is not on the clock`);
  const o = req.options ?? {};
  if (o.particles !== undefined && !isPositiveInt(o.particles, GRADE_MAX_PARTICLES)) {
    throw new Error(`particles must be an integer in 1..${GRADE_MAX_PARTICLES}`);
  }
  if (o.trialsPerCombo !== undefined && !isPositiveInt(o.trialsPerCombo, MAX_TRIALS_PER_COMBO)) {
    throw new Error(`trialsPerCombo must be an integer in 1..${MAX_TRIALS_PER_COMBO}`);
  }
  if (o.maxRaises !== undefined && !(Number.isInteger(o.maxRaises) && o.maxRaises >= 0)) throw new Error("maxRaises must be a non-negative integer");
  if (o.seed !== undefined && !Number.isFinite(o.seed)) throw new Error("seed must be a finite number");

  const key = gradeKey(req);
  const hit = ctx.cache?.get(key);
  if (hit?.kind === "grade") {
    ctx.post({ id: req.id, kind: "grade", type: "done", result: hit.result, cached: true });
    return;
  }
  await ctx.sleep(0);
  if (!ctx.isCurrent()) return;

  const input: GradeInput = {
    history: req.history,
    heroSeat: req.heroSeat,
    heroCards: req.heroCards,
    personas: req.personas.map((p, seat) => (seat === req.heroSeat || p === null ? null : PERSONAS[p])),
    chosen: req.chosen,
    options: o,
  };
  if (seats.length >= 2 && (o.particles ?? DEFAULT_PARTICLES) > GRADE_COARSE_PARTICLES) {
    const coarse = gradeDecision({ ...input, options: { ...o, particles: GRADE_COARSE_PARTICLES } });
    ctx.post({ id: req.id, kind: "grade", type: "progress", result: coarse, particles: GRADE_COARSE_PARTICLES });
    await ctx.sleep(0);
    if (!ctx.isCurrent()) return;
  }
  const result = gradeDecision(input);
  ctx.cache?.set(key, { kind: "grade", result });
  ctx.post({ id: req.id, kind: "grade", type: "done", result, cached: false });
}

/** Runs one job, posting its messages through ctx.post. Errors become one "error" response. */
export async function runJob(req: JobRequest, ctx: JobContext): Promise<void> {
  try {
    if (req.kind === "spot") await runSpot(req, ctx);
    else if (req.kind === "grade") await runGrade(req, ctx);
    else throw new Error(`Unknown job kind ${String((req as { kind: unknown }).kind)}`);
  } catch (err) {
    if (ctx.isCurrent()) {
      const kind = req.kind === "grade" ? "grade" : "spot";
      ctx.post({ id: req.id, kind, type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
}
