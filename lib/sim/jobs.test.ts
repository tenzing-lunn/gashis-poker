import { describe, expect, it } from "vitest";
import { applyAction, createHand, legalActions } from "../engine/engine";
import { FULL_DECK, parseCards, type Card } from "../poker/cards";
import { PERSONAS, type PersonaId } from "../bots/personas";
import { ABSTRACT_ACTIONS, analyzeSpot, type AbstractAction } from "../bots/policy";
import { inferRange } from "../bots/range";
import { publicHistory, publicView, type PublicHistory } from "../bots/view";
import { gradeDecision } from "../grading/grade";
import { LruCache } from "./cache";
import { EXACT_EVALS_PER_CHUNK, runJob, SLICE_MS, type CachedResult, type JobContext } from "./jobs";
import { multiwayEquity } from "./multiway";
import type { GradeRequest, SimResponse, SpotEquity, SpotRequest } from "./protocol";
import { equityVsRange } from "./weighted-equity";

const BOARD = parseCards("Ks7d2c9h4s");

/** Public history after `steps` (abstract actions resolved with each acting seat's persona). */
function script(resolvers: readonly PersonaId[], steps: readonly AbstractAction[]): PublicHistory {
  const n = resolvers.length;
  const filler = FULL_DECK.filter((c) => !BOARD.includes(c));
  let s = createHand({ stacks: Array(n).fill(10_000), button: 0 }, { deck: [...filler.slice(0, 2 * n), ...BOARD] });
  for (const step of steps) {
    const seat = legalActions(s)!.seat;
    const a = analyzeSpot(PERSONAS[resolvers[seat]], publicView(s, seat)).concrete[ABSTRACT_ACTIONS.indexOf(step)];
    if (!a) throw new Error(`Seat ${seat} cannot ${step}`);
    s = applyAction(s, a);
  }
  return publicHistory(s);
}

const HERO: [Card, Card] = parseCards("AhQh") as [Card, Card];
// Heads-up: seat 0 (button, TAG) opens, the hero (seat 1, big blind) calls; hero first to act on the flop.
const HU_FLOP = script(["tag", "tag"], ["raise", "call"]);
const HU_PRE = script(["tag", "tag"], ["raise"]);
// 3-way: button (TAG) opens, small blind (station) and hero (big blind) call; SB checks the flop.
const MW_FLOP = script(["tag", "station", "tag"], ["raise", "call", "call", "check"]);
// 3-way preflop: button opens, small blind calls, hero (big blind) to act.
const MW_PRE = script(["tag", "station", "tag"], ["raise", "call"]);

const spotReq = (over: Partial<SpotRequest> = {}): SpotRequest => ({
  kind: "spot",
  id: 1,
  history: HU_FLOP,
  heroSeat: 1,
  heroCards: HERO,
  personas: ["tag", null],
  ...over,
});
const gradeReq = (over: Partial<GradeRequest> = {}): GradeRequest => ({
  kind: "grade",
  id: 2,
  history: HU_FLOP,
  heroSeat: 1,
  heroCards: HERO,
  personas: ["tag", null],
  ...over,
});

/** Fake clock: every now() call advances `dt` ms. */
function context(opts: { current?: () => boolean; dt?: number; cache?: LruCache<CachedResult> } = {}) {
  const posts: SimResponse[] = [];
  let clock = 0, sleeps = 0;
  const ctx: JobContext = {
    post: (m) => posts.push(m),
    isCurrent: opts.current ?? (() => true),
    sleep: () => {
      sleeps++;
      return Promise.resolve();
    },
    now: () => (clock += opts.dt ?? 1),
    cache: opts.cache,
  };
  return { ctx, posts, sleeps: () => sleeps };
}

const equities = (posts: SimResponse[]): SpotEquity[] => posts.flatMap((m) => (m.kind === "spot" && m.type === "equity" ? [m.equity] : []));

function lastDone(posts: SimResponse[]) {
  const done = posts[posts.length - 1];
  if (done.kind !== "spot" || done.type !== "done") throw new Error(`last message is ${done.kind} ${done.type}`);
  return done;
}

describe("sim worker: spot", () => {
  it("heads-up flop: ranges, a rough MC, the exact equity, done", async () => {
    const { ctx, posts } = context();
    await runJob(spotReq(), ctx);
    expect(posts.map((m) => m.type)).toEqual(["ranges", "equity", "equity", "done"]);
    expect(posts.every((m) => m.id === 1 && m.kind === "spot")).toBe(true);
    const [rough, final] = equities(posts);
    expect(rough).toMatchObject({ stage: "rough", exact: false, samples: 1500 });
    expect(final).toMatchObject({ stage: "refined", exact: true, samples: 990 });

    const weights = inferRange(PERSONAS.tag, HU_FLOP, 0, { dead: HERO });
    const direct = equityVsRange(HERO, weights, BOARD.slice(0, 3));
    expect(final.players[0]).toEqual({ seat: 1, equity: direct.equity, win: direct.win, tie: direct.tie, stdErr: 0 });
    expect(final.players[1].seat).toBe(0);
    expect(final.players[1].equity).toBeCloseTo(1 - direct.equity, 12);
    expect(Math.abs(rough.players[0].equity - direct.equity)).toBeLessThan(4 * rough.players[0].stdErr);

    const done = lastDone(posts);
    expect(done.cached).toBe(false);
    expect(done.result.equity).toEqual(final);
    expect(done.result).toMatchObject({ street: "flop", board: BOARD.slice(0, 3), heroSeat: 1, pot: 500 });
    const [range] = done.result.ranges;
    expect(range.seat).toBe(0);
    expect(range.persona).toBe("tag");
    expect(Array.from(range.weights)).toEqual(Array.from(weights));
    expect(range.classShares.length).toBe(169);
    expect(range.classFrequencies.length).toBe(169);
    expect(range.buckets!.buckets.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 10);
    // Everything crossing postMessage must survive a structured clone.
    expect(structuredClone(done.result)).toEqual(done.result);
  });

  it("heads-up preflop: Monte Carlo that gets more precise, ending at the direct result", async () => {
    const { ctx, posts } = context({ dt: 4 });
    await runJob(spotReq({ history: HU_PRE, maxTrials: 40_000, targetStdErr: 1e-9 }), ctx);
    const eqs = equities(posts);
    expect(posts[0].type).toBe("ranges");
    expect(eqs[0].stage).toBe("rough");
    expect(eqs.length).toBeGreaterThan(2);
    for (let k = 1; k < eqs.length; k++) {
      expect(eqs[k].stage).toBe("refined");
      expect(eqs[k].samples).toBeGreaterThan(eqs[k - 1].samples);
      expect(eqs[k].players[0].stdErr).toBeLessThan(eqs[k - 1].players[0].stdErr);
    }
    const final = eqs[eqs.length - 1];
    expect(final.samples).toBe(40_000);
    expect(final.players[0].stdErr).toBeLessThan(0.003);
    const weights = inferRange(PERSONAS.tag, HU_PRE, 0, { dead: HERO });
    const direct = equityVsRange(HERO, weights, [], { trials: 40_000, seed: 1 });
    expect(final.players[0]).toEqual({ seat: 1, equity: direct.equity, win: direct.win, tie: direct.tie, stdErr: direct.stdErr });
    const done = lastDone(posts);
    expect(done.result.ranges[0].buckets).toBeNull();
    expect(done.result.equity).toEqual(final);
  });

  it("stops Monte Carlo at the target stdErr", async () => {
    const { ctx, posts } = context();
    await runJob(spotReq({ history: HU_PRE, maxTrials: 200_000, targetStdErr: 0.006 }), ctx);
    const final = lastDone(posts).result.equity;
    expect(final.players[0].stdErr).toBeLessThanOrEqual(0.006);
    expect(final.samples).toBeLessThan(20_000);
    const weights = inferRange(PERSONAS.tag, HU_PRE, 0, { dead: HERO });
    expect(final.players[0].equity).toBe(equityVsRange(HERO, weights, [], { trials: final.samples, seed: 1 }).equity);
  });

  it("3-way flop: joint Monte Carlo equal to multiwayEquity with the same trials and seed", async () => {
    const { ctx, posts } = context();
    await runJob(spotReq({ history: MW_FLOP, heroSeat: 2, personas: ["tag", "station", null], maxTrials: 12_000, targetStdErr: 1e-9, seed: 9 }), ctx);
    expect(posts[0].type).toBe("ranges");
    const eqs = equities(posts);
    expect(eqs[0].stage).toBe("rough");
    const done = lastDone(posts);
    expect(done.result.ranges.map((r) => [r.seat, r.persona])).toEqual([
      [0, "tag"],
      [1, "station"],
    ]);
    const final = done.result.equity;
    expect(final.samples).toBe(12_000);
    expect(final.players.map((p) => p.seat)).toEqual([2, 0, 1]);
    const ws = [inferRange(PERSONAS.tag, MW_FLOP, 0, { dead: HERO }), inferRange(PERSONAS.station, MW_FLOP, 1, { dead: HERO })];
    const direct = multiwayEquity(HERO, ws, BOARD.slice(0, 3), { trials: 12_000, seed: 9 });
    final.players.forEach((p, k) => expect(p.equity).toBe(direct.players[k].equity));
    expect(final.players.reduce((s, p) => s + p.equity, 0)).toBeCloseTo(1, 12);
  });

  it("a job superseded at its first yield posts nothing", async () => {
    let yields = 0;
    const { ctx, posts } = context({ current: () => yields === 0 });
    ctx.sleep = () => {
      yields++;
      return Promise.resolve();
    };
    await runJob(spotReq(), ctx);
    expect(posts).toHaveLength(0);
  });

  it("a cancel during the exact enumeration stops the job (no done)", async () => {
    const posts: SimResponse[] = [];
    const { ctx } = context({ current: () => !posts.some((m) => m.type === "equity") });
    ctx.post = (m) => posts.push(m);
    await runJob(spotReq(), ctx);
    expect(posts.map((m) => m.type)).toEqual(["ranges", "equity"]);
  });

  it("exact flop work is cut into small chunks, each followed by a yield check", async () => {
    // A wide range (the hero limps on the button, the big blind checks its option): ~1M flop evaluations.
    const history = script(["station", "station"], ["call", "check"]);
    const req = spotReq({ history, heroSeat: 0, personas: [null, "station"] });
    // A clock where every chunk overruns the slice: one yield per chunk.
    const slow = context({ dt: SLICE_MS + 1 });
    await runJob(req, slow.ctx);
    const done = lastDone(slow.posts);
    const combos = done.result.ranges[0].weights.filter((w) => w > 0).length;
    expect(combos).toBeGreaterThan(900);
    const exactChunks = Math.ceil(1081 / Math.floor(EXACT_EVALS_PER_CHUNK / combos));
    expect(slow.sleeps()).toBeGreaterThanOrEqual(exactChunks);

    // Real clock: the gaps between yields stay near SLICE_MS.
    const stamps: number[] = [];
    const ctx: JobContext = {
      post: () => {},
      isCurrent: () => true,
      sleep: () => {
        stamps.push(performance.now());
        return Promise.resolve();
      },
      now: () => performance.now(),
    };
    await runJob(req, ctx);
    let gap = 0;
    for (let k = 1; k < stamps.length; k++) gap = Math.max(gap, stamps[k] - stamps[k - 1]);
    expect(gap).toBeLessThan(SLICE_MS + 40);
  });

  it("a cache hit posts the identical result at once without recomputing", async () => {
    const cache = new LruCache<CachedResult>(4);
    const first = context({ cache });
    await runJob(spotReq(), first.ctx);
    const original = lastDone(first.posts).result;

    const again = context({ cache });
    // Same spot, another id, the hero's own persona entry differs (it is ignored).
    await runJob(spotReq({ id: 5, personas: ["tag", "nit"] }), again.ctx);
    expect(again.posts).toHaveLength(1);
    const hit = lastDone(again.posts);
    expect(hit.id).toBe(5);
    expect(hit.cached).toBe(true);
    expect(hit.result).toBe(original);
    expect(again.sleeps()).toBe(0);

    // A different seed is a different key.
    const other = context({ cache });
    await runJob(spotReq({ id: 6, seed: 2 }), other.ctx);
    expect(lastDone(other.posts).cached).toBe(false);
    expect(cache.size).toBe(2);
  });

  it("reports invalid requests as one error message", async () => {
    const cases: [Partial<SpotRequest>, RegExp][] = [
      [{ heroCards: [1, 52] }, /Invalid card id 52/],
      [{ heroCards: [1] as unknown as [Card, Card] }, /exactly 2 cards/],
      [{ heroCards: [BOARD[0], 0] }, /appears twice/],
      [{ history: { ...HU_FLOP, board: BOARD.slice(0, 2) } }, /0 or 3-5 cards/],
      [{ history: { ...HU_FLOP, board: BOARD.slice(0, 4) } }, /board cards/],
      [{ personas: ["shark" as PersonaId, null] }, /Unknown persona shark/],
      [{ personas: [null, null] }, /Seat 0 is live but has no persona/],
      [{ personas: ["tag"] }, /one entry per seat/],
      [{ heroSeat: 2 }, /Invalid hero seat/],
      [{ maxTrials: 0 }, /maxTrials/],
      [{ targetStdErr: -1 }, /targetStdErr/],
      [{ history: { ...HU_FLOP, actions: [...HU_FLOP.actions, { type: "raise", to: 1 }] } }, /./],
    ];
    for (const [over, pattern] of cases) {
      const { ctx, posts } = context();
      await runJob(spotReq(over), ctx);
      expect(posts).toHaveLength(1);
      const m = posts[0];
      expect(m.type).toBe("error");
      if (m.type === "error") expect(m.message).toMatch(pattern);
    }
  });
});

describe("sim worker: grade", () => {
  it("heads-up: done with gradeDecision's result", async () => {
    const { ctx, posts } = context();
    await runJob(gradeReq({ chosen: { type: "check" } }), ctx);
    expect(posts).toHaveLength(1);
    const done = posts[0];
    if (done.kind !== "grade" || done.type !== "done") throw new Error(`got ${done.type}`);
    const direct = gradeDecision({ history: HU_FLOP, heroSeat: 1, heroCards: HERO, personas: [PERSONAS.tag, null], chosen: { type: "check" } });
    expect(done.result).toEqual(direct);
    expect(structuredClone(done.result)).toEqual(done.result);
  });

  it("multiway: a coarse progress pass, then the full one; cached afterwards", async () => {
    const cache = new LruCache<CachedResult>();
    const req = gradeReq({ history: MW_PRE, heroSeat: 2, personas: ["tag", "station", null], options: { particles: 600 } });
    const { ctx, posts } = context({ cache });
    await runJob(req, ctx);
    expect(posts.map((m) => m.type)).toEqual(["progress", "done"]);
    const [progress, done] = posts;
    if (progress.kind !== "grade" || progress.type !== "progress" || done.kind !== "grade" || done.type !== "done") throw new Error("bad sequence");
    expect(progress.particles).toBe(200);
    const input = { history: MW_PRE, heroSeat: 2, heroCards: HERO, personas: [PERSONAS.tag, PERSONAS.station, null] };
    expect(progress.result).toEqual(gradeDecision({ ...input, options: { particles: 200 } }));
    expect(done.result).toEqual(gradeDecision({ ...input, options: { particles: 600 } }));

    const again = context({ cache });
    await runJob({ ...req, id: 9 }, again.ctx);
    expect(again.posts).toHaveLength(1);
    const hit = again.posts[0];
    if (hit.kind !== "grade" || hit.type !== "done") throw new Error("expected a cached done");
    expect(hit.cached).toBe(true);
    expect(hit.result).toBe(done.result);
  });

  it("a cancel after the coarse pass stops the job (no done)", async () => {
    const posts: SimResponse[] = [];
    const { ctx } = context({ current: () => posts.length === 0 });
    ctx.post = (m) => posts.push(m);
    await runJob(gradeReq({ history: MW_PRE, heroSeat: 2, personas: ["tag", "station", null], options: { particles: 600 } }), ctx);
    expect(posts.map((m) => m.type)).toEqual(["progress"]);
  });

  it("errors: hero not on the clock, bad options", async () => {
    const cases: [Partial<GradeRequest>, RegExp][] = [
      [{ history: HU_PRE, heroSeat: 0, personas: [null, "tag"] }, /Seat 0 is not on the clock/],
      [{ options: { particles: 0 } }, /particles/],
      [{ options: { trialsPerCombo: 1.5 } }, /trialsPerCombo/],
      [{ heroCards: [HERO[0], HERO[0]] }, /appears twice/],
    ];
    for (const [over, pattern] of cases) {
      const { ctx, posts } = context();
      await runJob(gradeReq(over), ctx);
      expect(posts).toHaveLength(1);
      const m = posts[0];
      if (m.type !== "error") throw new Error(`expected an error, got ${m.type}`);
      expect(m.kind).toBe("grade");
      expect(m.message).toMatch(pattern);
    }
  });
});
