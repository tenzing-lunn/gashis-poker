import { describe, expect, it } from "vitest";
import { akqClosedForm, akqClosedFormProfile, akqSummary, createAkqGame } from "./akq";
import { createCfrSolver } from "./cfr";
import { exploitability } from "./game";

describe("AKQ closed form", () => {
  it("matches the textbook numbers with B = 1", () => {
    for (const P of [1.5, 2, 3, 5, 10]) {
      const s = akqClosedForm(P, 1);
      expect(s.unique).toBe(true);
      expect(s.yBluff).toBeCloseTo(1 / (P + 1), 14); // RESEARCH.md: "bluff Q at 1/(P+1)" holds
      expect(s.kCall).toBeCloseTo((P - 1) / (P + 1), 14); // K itself calls (P-1)/(P+1) ...
      expect(s.xCallVsBluff).toBeCloseTo(P / (P + 1), 14); // ... X's total vs the bluffer is P/(P+1) = MDF
      expect(s.bluffShareOfBets).toBeCloseTo(1 / (P + 2), 14); // B/(P+2B)
      expect(s.valueY).toBeCloseTo((P - 1) / (6 * (P + 1)), 14);
    }
  });

  it("pot-sized bet (P = B): K never calls, X's total vs the bluffer is 1/2, Y may bluff anywhere in [0, 1/2]", () => {
    const s = akqClosedForm(1, 1);
    expect(s.unique).toBe(false);
    expect(s.kCall).toBe(0);
    expect(s.xCallVsBluff).toBe(0.5);
    expect(s.yBluffRange).toEqual([0, 0.5]);
    expect(s.valueY).toBe(0);
    for (const beta of [0, 0.25, 0.5]) {
      const g = createAkqGame(1, 1);
      const p = akqClosedFormProfile(g, 1, 1);
      p[g.infoSets.find((x) => x.key === "Y:Q")!.offset + 1] = beta;
      p[g.infoSets.find((x) => x.key === "Y:Q")!.offset] = 1 - beta;
      expect(exploitability(g, p).nashConv).toBeLessThan(1e-14);
    }
  });

  it("the closed-form profile has zero exploitability and the closed-form value", () => {
    for (const [P, B] of [[2, 1], [1, 0.5], [3, 1], [10, 1], [1.5, 1], [4, 3], [1, 1], [1, 2]]) {
      const g = createAkqGame(P, B);
      const r = exploitability(g, akqClosedFormProfile(g, P, B));
      expect(Math.abs(r.nashConv), `P=${P} B=${B}`).toBeLessThan(1e-14);
      expect(-r.value).toBeCloseTo(akqClosedForm(P, B).valueY, 14);
    }
  });
});

describe("AKQ: CFR+ agrees with the closed form", () => {
  it("to 1e-3 in every strategy number and 1e-4 in value for P > B", () => {
    for (const [P, B] of [[2, 1], [1, 0.5], [3, 1], [10, 1], [1.5, 1], [4, 3]]) {
      const g = createAkqGame(P, B);
      const solver = createCfrSolver(g);
      solver.step(5000);
      const r = solver.report();
      const cfr = akqSummary(g, solver.averageStrategy(), P, B, r.value);
      const cf = akqClosedForm(P, B);
      const tag = `P=${P} B=${B}`;
      expect(r.nashConv, tag).toBeLessThan(1e-3);
      expect(Math.abs(cfr.yBluff - cf.yBluff), tag).toBeLessThan(1e-3);
      expect(Math.abs(cfr.kCall - cf.kCall), tag).toBeLessThan(1e-3);
      expect(Math.abs(cfr.yBetA - 1), tag).toBeLessThan(1e-3);
      expect(Math.abs(cfr.xCallVsBluff - cf.xCallVsBluff), tag).toBeLessThan(1e-3);
      expect(Math.abs(cfr.xCallGivenBet - cf.xCallGivenBet), tag).toBeLessThan(1e-3);
      expect(Math.abs(cfr.valueY - cf.valueY), tag).toBeLessThan(1e-4);
    }
  });

  it("for B >= P: value 0, K never calls, Y's bluffing within the equilibrium interval", () => {
    for (const [P, B] of [[1, 1], [1, 2]]) {
      const g = createAkqGame(P, B);
      const solver = createCfrSolver(g);
      solver.step(5000);
      const r = solver.report();
      const cfr = akqSummary(g, solver.averageStrategy(), P, B, r.value);
      const cf = akqClosedForm(P, B);
      expect(r.nashConv).toBeLessThan(1e-4);
      expect(Math.abs(cfr.valueY)).toBeLessThan(1e-4);
      expect(cfr.kCall).toBeLessThan(1e-3);
      expect(cfr.yBluff).toBeLessThanOrEqual(cf.yBluffRange[1] + 1e-3);
    }
  });
});
