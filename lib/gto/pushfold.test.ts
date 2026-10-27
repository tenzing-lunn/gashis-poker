import { describe, expect, it } from "vitest";
import { HAND_CLASSES } from "../poker/combinatorics";
import { countCombos } from "../poker/range";
import {
  CLASS_GRID_NAMES,
  classGrid,
  comboFraction,
  createPushFoldSolver,
  pushFoldExploitability,
  rangeText,
  solvePushFold,
  type PushFoldReport,
} from "./pushfold";
import { preflopMatrix } from "./preflop-matrix";

const idx = (name: string) => HAND_CLASSES.findIndex((h) => h.name === name);
const STACKS = [1, 2, 5, 8, 10, 15, 20, 25, 30];
const solved = new Map<number, PushFoldReport>();
const solve = (s: number) => {
  if (!solved.has(s)) solved.set(s, solvePushFold(s));
  return solved.get(s)!;
};

describe("push/fold Nash (CFR+ on the 169x169 matrix)", () => {
  it("reaches NashConv < 0.01 bb at every tested stack, well under a second each", () => {
    for (const s of STACKS) {
      const t0 = performance.now();
      const r = solve(s);
      const ms = performance.now() - t0;
      expect(r.nashConv, `${s} bb`).toBeLessThan(0.01);
      expect(r.exploitability).toBeCloseTo(r.nashConv / 2, 15);
      expect(ms, `${s} bb took ${ms.toFixed(0)} ms`).toBeLessThan(1000);
    }
  });

  it("works at fractional stacks", () => {
    const r = solvePushFold(7.5);
    expect(r.nashConv).toBeLessThan(0.01);
    expect(r.pushFraction).toBeLessThan(solve(5).pushFraction + 1e-9);
    expect(r.pushFraction).toBeGreaterThan(solve(10).pushFraction - 1e-9);
    expect(() => solvePushFold(0.9)).toThrow();
  });

  it("re-evaluating the solution independently gives the same exploitability", () => {
    const r = solve(10);
    const again = pushFoldExploitability(10, r.push, r.call);
    expect(again.nashConv).toBeCloseTo(r.nashConv, 12);
    expect(again.sbValue).toBeCloseTo(r.sbValue, 12);
  });

  it("sanity: AA always shoved and always called; ranges widen as stacks shrink; ~everything at 1 bb", () => {
    const aa = idx("AA");
    for (const s of STACKS) {
      const r = solve(s);
      expect(r.push[aa]).toBeGreaterThan(0.99);
      expect(r.call[aa]).toBeGreaterThan(0.99);
    }
    for (let k = 1; k < STACKS.length; k++) {
      expect(solve(STACKS[k]).pushFraction).toBeLessThanOrEqual(solve(STACKS[k - 1]).pushFraction + 0.005);
      expect(solve(STACKS[k]).callFraction).toBeLessThanOrEqual(solve(STACKS[k - 1]).callFraction + 0.005);
    }
    expect(solve(1).pushFraction).toBeGreaterThan(0.99);
    expect(solve(1).callFraction).toBeGreaterThan(0.99);
    // 72o, the worst hand, is folded from 5 bb up but shoved at 1 bb.
    expect(solve(1).push[idx("72o")]).toBeGreaterThan(0.99);
    expect(solve(10).push[idx("72o")]).toBeLessThan(0.01);
  });

  it("at 1 bb, push-all / call-all is an exact equilibrium (BB's call is free)", () => {
    const r = pushFoldExploitability(1, new Float64Array(169).fill(1), new Float64Array(169).fill(1));
    expect(Math.abs(r.nashConv)).toBeLessThan(1e-12);
  });

  it("is close to a published HU no-ante Nash chart (PokerStrategy.com 'Nash Ranges for the Push-or-Fold Play', Table 1)", () => {
    // That table (heads-up, no ante, effective stack = smaller stack before posting blinds, as here) lists,
    // as % of hands, push / call: 8 bb 62.6 / 48.4; 10 bb 56.6 / 38.5; 15 bb 45.7 / 28.4; 20 bb 40.9 / 21.7.
    // Its ranges are coarse hand groups ("Kx+", "Q7o+"), so allow 3.5 points. Below ~6 bb the table drifts
    // further from exact Nash (see the next test), so it isn't compared there.
    const reference: [number, number, number][] = [
      [8, 0.626, 0.484],
      [10, 0.566, 0.385],
      [15, 0.457, 0.284],
      [20, 0.409, 0.217],
    ];
    for (const [s, push, call] of reference) {
      const r = solve(s);
      expect(Math.abs(r.pushFraction - push), `${s} bb push ${r.pushFraction}`).toBeLessThan(0.035);
      expect(Math.abs(r.callFraction - call), `${s} bb call ${r.callFraction}`).toBeLessThan(0.035);
    }
  });

  it("at 2 bb BB calls everything (so the chart's 96.4% can't be Nash)", () => {
    // BB calls 1 more bb into a 4 bb pot, so it needs 25% equity against SB's shoving range. The worst
    // hand, 32o, has about 30% against SB's ~90% range, so every hand calls.
    const r = solve(2);
    expect(r.callFraction).toBeGreaterThan(0.999);
    const { equity, pairs } = preflopMatrix();
    const j = idx("32o");
    let w = 0, eq = 0;
    for (let i = 0; i < 169; i++) {
      w += r.push[i] * pairs[i * 169 + j];
      eq += r.push[i] * pairs[i * 169 + j] * (1 - equity[i * 169 + j]);
    }
    expect(eq / w).toBeGreaterThan(0.25);
  });

  it("steps in chunks deterministically", () => {
    const a = createPushFoldSolver(12), b = createPushFoldSolver(12);
    a.step(300);
    for (let k = 0; k < 6; k++) b.step(50);
    expect(Array.from(b.averageStrategy().push)).toEqual(Array.from(a.averageStrategy().push));
    expect(b.report().nashConv).toBe(a.report().nashConv);
  });
});

describe("presentation helpers", () => {
  it("classGrid uses the standard layout (AA top-left, suited above the diagonal)", () => {
    expect(CLASS_GRID_NAMES[0][0]).toBe("AA");
    expect(CLASS_GRID_NAMES[0][1]).toBe("AKs");
    expect(CLASS_GRID_NAMES[1][0]).toBe("AKo");
    expect(CLASS_GRID_NAMES[12][12]).toBe("22");
    expect(CLASS_GRID_NAMES[5][9]).toBe("95s");
    const freq = HAND_CLASSES.map((_, i) => i / 1000);
    expect(classGrid(freq)[3][7]).toBe(freq[3 * 13 + 7]);
  });

  it("rangeText gives lib/poker range text for hands played >= 50%", () => {
    const freq = new Float64Array(169);
    for (const n of ["AA", "KK", "QQ", "AKs", "AKo", "AQs"]) freq[idx(n)] = 1;
    freq[idx("JJ")] = 0.5;
    freq[idx("AJs")] = 0.49;
    const text = rangeText(freq);
    expect(text).toBe("JJ+, AQs+, AKo");
    expect(countCombos(text)).toBe(4 * 6 + 16 + 4);
    expect(comboFraction(freq)).toBeCloseTo((3 * 6 + 0.5 * 6 + 16 + 4 + 0.49 * 4) / 1326, 12);
    const r = solve(10);
    expect(countCombos(rangeText(r.push)) / 1326).toBeCloseTo(r.pushFraction, 1);
  });
});
