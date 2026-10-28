import { describe, expect, it } from "vitest";
import {
  AKQ_CALLER_KEY,
  akqBettorEv,
  akqBettorKey,
  akqBluffEv,
  akqCallEv,
  akqClosedForm,
  akqClosedFormProfile,
  akqSummary,
  createAkqGame,
} from "./akq";
import { createCfrSolver } from "./cfr";
import { bestResponse, expectedValue, exploitability, profileFromMap, type Game } from "./game";

// Pot / bet pairs, including a pot-sized bet and overbets (B >= P).
const SPOTS: [number, number][] = [[2, 1], [1, 1], [1, 2], [10, 10], [10, 6], [3, 1], [1, 0.5], [4, 3], [1, 5]];

/** A profile where the bettor bets the A with aBet, bluffs the Q with b and the K calls with c. */
const profileOf = (g: Game, b: number, c: number, aBet = 1) =>
  profileFromMap(g, { [akqBettorKey("A")]: [1 - aBet, aBet], [akqBettorKey("Q")]: [1 - b, b], [AKQ_CALLER_KEY]: [1 - c, c] });

/** Bettor's EV (pot as dead money) of a profile. */
const bettorEv = (g: Game, pot: number, b: number, c: number) => expectedValue(g, profileOf(g, b, c)) + pot / 2;

describe("AKQ closed form", () => {
  it("matches the lesson's formulas at several pot and bet sizes", () => {
    for (const [P, B] of SPOTS) {
      const s = akqClosedForm(P, B);
      const tag = `P=${P} B=${B}`;
      expect(s.qBluff, tag).toBeCloseTo(B / (P + B), 14);
      expect(s.kCall, tag).toBeCloseTo(P / (P + B), 14);
      expect(s.bluffShare, tag).toBeCloseTo(B / (P + 2 * B), 14);
      expect(s.bluffShare, tag).toBeCloseTo(s.qBluff / (1 + s.qBluff), 14);
      expect(s.aBet).toBe(1);
      expect(s.bettorEv, tag).toBeCloseTo((P + s.kCall * B) / 2, 14);
      expect(s.bettorEv + s.callerEv, tag).toBeCloseTo(P, 14);
    }
  });

  it("the closed-form profile has zero exploitability and the closed-form EVs", () => {
    for (const [P, B] of SPOTS) {
      const g = createAkqGame(P, B);
      const r = exploitability(g, akqClosedFormProfile(g, P, B));
      const tag = `P=${P} B=${B}`;
      expect(Math.abs(r.nashConv), tag).toBeLessThan(1e-12);
      expect(r.value + P / 2, tag).toBeCloseTo(akqClosedForm(P, B).bettorEv, 12);
    }
  });

  it("the EV helpers agree with the game tree", () => {
    for (const [P, B] of SPOTS) {
      const g = createAkqGame(P, B);
      for (const b of [0, 0.3, 1]) {
        for (const c of [0, 0.6, 1]) expect(akqBettorEv(P, B, b, c)).toBeCloseTo(bettorEv(g, P, b, c), 12);
      }
    }
  });
});

describe("AKQ indifference", () => {
  it("at b* the K's call breaks even and at c* the Q's bluff breaks even", () => {
    for (const [P, B] of SPOTS) {
      const s = akqClosedForm(P, B);
      expect(akqCallEv(P, B, s.qBluff)).toBeCloseTo(0, 12);
      expect(akqBluffEv(P, B, s.kCall)).toBeCloseTo(0, 12);
    }
  });

  it("against the equilibrium caller every bluff frequency earns the same, and vice versa", () => {
    for (const [P, B] of SPOTS) {
      const g = createAkqGame(P, B);
      const s = akqClosedForm(P, B);
      for (const x of [0, 0.25, 0.5, 0.9, 1]) {
        expect(bettorEv(g, P, x, s.kCall), `P=${P} B=${B} b=${x}`).toBeCloseTo(s.bettorEv, 12);
        expect(P - bettorEv(g, P, s.qBluff, x), `P=${P} B=${B} c=${x}`).toBeCloseTo(s.callerEv, 12);
      }
    }
  });
});

describe("AKQ worked example (P = B = 10)", () => {
  const P = 10, B = 10;
  const g = createAkqGame(P, B);

  it("bettor 7.5, caller 2.5; b = c = 1/2; bluffs are 1/3 of bets", () => {
    const s = akqClosedForm(P, B);
    expect(s.qBluff).toBe(0.5);
    expect(s.kCall).toBe(0.5);
    expect(s.bluffShare).toBeCloseTo(1 / 3, 14);
    expect(s.bettorEv).toBe(7.5);
    expect(s.callerEv).toBe(2.5);
  });

  // Each deviation's best response, found on the tree.
  it("the four one-sided deviations: 10, 10, 5, 5", () => {
    const bettorBest = (c: number) => bestResponse(g, profileOf(g, 0.5, c), 0).value + P / 2;
    const callerBest = (b: number) => P / 2 + bestResponse(g, profileOf(g, b, 0.5), 1).value;
    expect(bettorBest(1)).toBeCloseTo(10, 12); // caller always calls: stop bluffing
    expect(bettorBest(0)).toBeCloseTo(10, 12); // caller never calls: bluff every Q
    expect(callerBest(1)).toBeCloseTo(5, 12); // bettor bluffs every Q: always call
    expect(callerBest(0)).toBeCloseTo(5, 12); // bettor never bluffs: always fold
    expect(bestResponse(g, profileOf(g, 0.5, 1), 0).profile[g.infoSets.find((x) => x.key === akqBettorKey("Q"))!.offset + 1]).toBe(0);
  });
});

describe("AKQ: CFR+ agrees with the closed form", () => {
  it("to 1e-3 in every frequency and 1e-4 in EV after 5,000 iterations", () => {
    for (const [P, B] of SPOTS) {
      const g = createAkqGame(P, B);
      const solver = createCfrSolver(g);
      solver.step(5000);
      const r = solver.report();
      const cfr = akqSummary(g, solver.averageStrategy(), P, B);
      const cf = akqClosedForm(P, B);
      const tag = `P=${P} B=${B}`;
      expect(r.exploitability, tag).toBeLessThan(1e-4 * P);
      expect(Math.abs(cfr.aBet - 1), tag).toBeLessThan(1e-3); // the A could check, but CFR+ learns to bet it
      expect(Math.abs(cfr.qBluff - cf.qBluff), tag).toBeLessThan(1e-3);
      expect(Math.abs(cfr.kCall - cf.kCall), tag).toBeLessThan(1e-3);
      expect(Math.abs(cfr.bluffShare - cf.bluffShare), tag).toBeLessThan(1e-3);
      expect(Math.abs(cfr.bettorEv - cf.bettorEv), tag).toBeLessThan(1e-4 * P);
      expect(cfr.bettorEv + cfr.callerEv, tag).toBeCloseTo(P, 12);
      expect(cfr.bettorEv, tag).toBeCloseTo(r.value + P / 2, 12);
    }
  });
});
