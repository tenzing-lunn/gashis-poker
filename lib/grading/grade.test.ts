import { describe, expect, it } from "vitest";
import { COMBO_COUNT } from "../poker/combinatorics";
import { STATION, TAG } from "../bots/personas";
import { multiwayEquity } from "../sim/multiway";
import { gradeWithModel, headsUpModel, type ModelRequest } from "./ev";
import { buildShowdownModel, gradeDecision } from "./grade";
import { exactComboEquities, riverEquities, scenario, type Scenario } from "./test-helpers";
import type { GradeResult } from "./types";

const BOARD = "Ks9d4c7h2s";
const HU_STEPS = ["raise", "call", "check", "bet33", "call", "check", "check", "check", "bet66"] as const;
/** Heads-up: the TAG button opens, the hero (big blind) calls, then `n` more scripted steps of HU_STEPS. */
const headsUp = (n: number, board = BOARD) => scenario([10_000, 10_000], 0, 1, "9h8h", board, [TAG, TAG], HU_STEPS.slice(0, n));

/** Independent heads-up model: exactEquity per combo (or a 7-card comparison on the river). */
const exactBuilder = ({ seats, ranges, heroCards, board }: ModelRequest) =>
  board.length === 5
    ? headsUpModel(seats[0], ranges[0], { equity: riverEquities(heroCards, board, ranges[0]), stdErr: new Float64Array(COMBO_COUNT), exact: true })
    : headsUpModel(seats[0], ranges[0], exactComboEquities(heroCards, board, ranges[0]));

function timed<T>(label: string, f: () => T): T {
  const t = performance.now();
  const out = f();
  console.log(`${label}: ${(performance.now() - t).toFixed(0)} ms`);
  return out;
}

const sameEvs = (a: GradeResult, b: GradeResult, tol: number) => {
  expect(a.options.map((o) => o.label)).toEqual(b.options.map((o) => o.label));
  a.options.forEach((o, i) => expect(Math.abs(o.ev - b.options[i].ev), o.label).toBeLessThan(tol));
};

/** |a - b| within k combined standard errors, option by option. */
const withinNoise = (a: GradeResult, b: GradeResult, k = 4) =>
  a.options.forEach((o, i) => {
    const se = Math.hypot(o.stdErr, b.options[i].stdErr);
    expect(Math.abs(o.ev - b.options[i].ev), o.label).toBeLessThanOrEqual(k * se + 1e-9);
  });

describe("gradeDecision: heads-up (lib/sim comboEquities)", () => {
  it("river facing a bet: matches the independent exact model, every option exact", () => {
    const sc = headsUp(9);
    const r = timed("heads-up river facing a bet", () => gradeDecision(sc));
    sameEvs(r, gradeWithModel(sc, exactBuilder), 1e-9);
    expect(r.model).toBe("exact");
    expect(r.options.every((o) => o.stdErr === 0)).toBe(true);
  });

  it("river first to act (deepest tree): matches the exact model", () => {
    const sc = headsUp(7);
    const r = timed("heads-up river first to act", () => gradeDecision(sc));
    sameEvs(r, gradeWithModel(sc, exactBuilder), 1e-9);
  });

  it("turn and flop: same EVs as exactEquity per combo; all-in exact, the rest ev-now", () => {
    for (const [n, board, label] of [[5, BOARD.slice(0, 8), "turn"], [2, BOARD.slice(0, 6), "flop"]] as const) {
      const sc = headsUp(n, board);
      const r = timed(`heads-up ${label} first to act`, () => gradeDecision(sc));
      sameEvs(r, gradeWithModel(sc, exactBuilder), 1e-8);
      expect(r.street).toBe(label);
      for (const o of r.options) expect(o.model, o.label).toBe(o.kind === "allin" || o.kind === "fold" ? "exact" : "ev-now");
      expect(r.model).toBe("ev-now");
      expect(r.heroEquityStdErr).toBe(0);
    }
  });

  it("preflop: per-combo Monte Carlo, seeded, within noise of a 10x run", () => {
    const sc = headsUp(1, "");
    const r = timed("heads-up preflop facing an open", () => gradeDecision(sc));
    expect(gradeDecision(sc)).toEqual(r);
    const big = gradeDecision({ ...sc, options: { trialsPerCombo: 2000, seed: 9 } });
    withinNoise(r, big);
    const call = r.options.find((o) => o.action.type === "call")!;
    expect(call.stdErr).toBeGreaterThan(0);
    expect(call.model).toBe("ev-now");
    expect(r.options.find((o) => o.action.type === "fold")).toMatchObject({ ev: 0, stdErr: 0, model: "exact" });
    expect(r.heroEquityStdErr).toBeGreaterThan(0);
    expect(r.requiredEquity).toBeCloseTo(150 / 500, 12); // 2.5 bb open: 1.5 bb to call into 3.5 bb
  });
});

describe("gradeDecision: multiway (lib/sim sampleJoint + particle model)", () => {
  // 3-way: the hero's button opens, both blinds call; on the flop both check to the hero.
  const threeWay = (extra: string[] = [], board = BOARD.slice(0, 6)) =>
    scenario([10_000, 10_000, 10_000], 0, 0, "Ah9h", board, [TAG, TAG, STATION], ["raise", "call", "call", "check", "check", ...extra] as never);

  it("3-way flop: seeded, within noise of a 4x-particle run, hero equity agrees with multiwayEquity", () => {
    const sc: Scenario = threeWay();
    const r = timed("3-way flop checked to the hero", () => gradeDecision(sc));
    expect(gradeDecision(sc)).toEqual(r);
    const big = gradeDecision({ ...sc, options: { particles: 8000, seed: 3 } });
    withinNoise(r, big);
    const mw = multiwayEquity(sc.heroCards, r.ranges.map((x) => x.weights), r.board, { trials: 100_000, seed: 5 });
    expect(Math.abs(r.heroEquity - mw.players[0].equity)).toBeLessThan(4 * Math.hypot(r.heroEquityStdErr, mw.players[0].stdErr));
    expect(r.model).toBe("ev-now");
    expect(r.options.every((o) => o.stdErr > 0)).toBe(true);
    expect(r.options[r.best].tier).toBe("best");
    for (const o of r.options) {
      // Checking behind closes the flop, so nobody responds; every bet gets a response from the SB.
      if (o.kind === "check") expect(o.responses).toEqual([]);
      else expect(o.responses.reduce((s, x) => s + x.prob, 0)).toBeCloseTo(1, 9);
    }
  });

  it("3-way turn and river: exact shares, sampled particles", () => {
    const turn = threeWay(["check", "check", "check"], BOARD.slice(0, 8));
    expect(turn.state.street).toBe("turn");
    const model = buildShowdownModel({
      state: turn.state, heroSeat: 0, heroCards: turn.heroCards, board: turn.state.board, seats: [1, 2],
      ranges: [1, 2].map(() => new Float64Array(COMBO_COUNT).fill(1)),
      options: { particles: 50, trialsPerCombo: 200, seed: 1, maxRaises: 4 },
    });
    expect(model.exactShares).toBe(true);
    expect(model.sampled).toBe(true);
    const r = timed("3-way turn", () => gradeDecision(turn));
    expect(r.street).toBe("turn");
    const river = threeWay(["check", "check", "check", "check", "bet66", "call"], BOARD);
    const rr = timed("3-way river facing a bet and a call", () => gradeDecision(river));
    expect(rr.requiredEquity).not.toBeNull();
    const call = rr.options.find((o) => o.action.type === "call")!;
    expect(call.showdownEquity).toBeCloseTo(rr.heroEquity, 12); // calling closes the river: one 3-way pot
  });
});
