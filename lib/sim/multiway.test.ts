import { describe, expect, it } from "vitest";
import { parseCards, type Card } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO, comboIndex } from "../poker/combinatorics";
import { exactEquity } from "../poker/equity";
import { parseRange } from "../poker/range";
import { multiwayEquity, sampleJoint, startMultiwayEquity } from "./multiway";
import { equityVsRange, liveWeights } from "./weighted-equity";

const cards = (s: string): Card[] => parseCards(s);
const hand = (s: string): [Card, Card] => parseCards(s) as [Card, Card];
/** Range text -> weights; each listed token gets its own weight. */
const weightsOf = (entries: [string, number][]): Float64Array => {
  const w = new Float64Array(COMBO_COUNT);
  for (const [text, x] of entries) for (const c of parseRange(text)) w[c] = x;
  return w;
};
const disjoint = (cs: number[]): boolean => {
  const seen = new Set<number>();
  for (const c of cs) {
    for (const x of [COMBO_HI[c], COMBO_LO[c]]) {
      if (seen.has(x)) return false;
      seen.add(x);
    }
  }
  return true;
};

/** Exact joint enumeration: Σ over disjoint (c1, c2) of w1·w2·exactEquity, normalized. */
function exactTwoRanges(hero: [Card, Card], r1: Float64Array, r2: Float64Array, board: Card[]) {
  const known = [...hero, ...board];
  const w1 = liveWeights(r1, known), w2 = liveWeights(r2, known);
  const eq = [0, 0, 0];
  let z = 0;
  for (let a = 0; a < COMBO_COUNT; a++) {
    if (w1[a] === 0) continue;
    for (let b = 0; b < COMBO_COUNT; b++) {
      if (w2[b] === 0 || !disjoint([a, b])) continue;
      const p = w1[a] * w2[b];
      const r = exactEquity([hero, [COMBO_HI[a], COMBO_LO[a]], [COMBO_HI[b], COMBO_LO[b]]], board);
      z += p;
      r.players.forEach((x, k) => (eq[k] += p * x.equity));
    }
  }
  return { equity: eq.map((x) => x / z), acceptance: z };
}

describe("multiwayEquity", () => {
  it("with one range agrees with exact equityVsRange within 4 stdErr", () => {
    const hero = hand("AhQh"), board = cards("Qs8h3h");
    const w = weightsOf([["22+, A2s+, KTs+, QTs+, JTs, ATo+, KJo+", 1], ["T9s, 98s, 87s", 3]]);
    const exact = equityVsRange(hero, w, board);
    const mc = multiwayEquity(hero, [w], board, { seed: 3 });
    expect(mc.exact).toBe(false);
    expect(mc.samples).toBe(100_000);
    expect(mc.acceptance).toBe(1);
    expect(Math.abs(mc.players[0].equity - exact.equity)).toBeLessThan(4 * mc.players[0].stdErr);
    expect(Math.abs(mc.players[1].equity - (1 - exact.equity))).toBeLessThan(4 * mc.players[1].stdErr);
  });

  for (const [street, board] of [["river", "Kd9s4c4h2s"], ["turn", "Kd9s4c2h"]] as const) {
    it(`two colliding ranges match exact joint enumeration on the ${street}`, () => {
      const hero = hand("AhKh");
      const r1 = weightsOf([["AK", 2], ["99", 1], ["KQs", 1.5], ["4s3s", 1]]);
      const r2 = weightsOf([["AK", 1], ["AQs", 1], ["99, 44", 2], ["QJs", 0.5]]);
      const ref = exactTwoRanges(hero, r1, r2, cards(board));
      const mc = multiwayEquity(hero, [r1, r2], cards(board), { seed: 11, trials: 60_000 });
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(mc.players[k].equity - ref.equity[k]), `player ${k}`).toBeLessThan(4 * mc.players[k].stdErr);
      }
      const z = ref.acceptance, attempts = mc.samples / mc.acceptance;
      expect(Math.abs(mc.acceptance - z)).toBeLessThan(4 * Math.sqrt((z * (1 - z)) / attempts));
      const sum = mc.players.reduce((s, p) => s + p.equity, 0);
      expect(sum).toBeCloseTo(1, 12);
    });
  }

  it("players' equities sum to 1 and win/tie are consistent, preflop 4-way", () => {
    const ranges = [weightsOf([["QQ+, AK", 1]]), weightsOf([["22+, ATs+", 1]]), weightsOf([["T9s, 98s, 87s, KQo", 1]])];
    const r = multiwayEquity(hand("7c7d"), ranges, [], { seed: 5, trials: 20_000 });
    expect(r.players).toHaveLength(4);
    expect(r.players.reduce((s, p) => s + p.equity, 0)).toBeCloseTo(1, 12);
    for (const p of r.players) {
      expect(p.equity).toBeGreaterThanOrEqual(p.win - 1e-12);
      expect(p.equity).toBeLessThanOrEqual(p.win + p.tie + 1e-12);
      expect(p.stdErr).toBeGreaterThan(0);
    }
  });

  it("is deterministic by seed and identical for any split of the work", () => {
    const ranges = [weightsOf([["AK, QQ", 1]]), weightsOf([["AK, JJ", 1]])];
    const hero = hand("AsQs"), board = cards("Qd7c2h");
    const a = multiwayEquity(hero, ranges, board, { seed: 9, trials: 10_000 });
    const run = startMultiwayEquity(hero, ranges, board, { seed: 9, trials: 10_000 });
    expect(Number.isNaN(run.result().players[0].equity)).toBe(true);
    while (!run.step(3_000)) expect(run.result().samples % 3_000).toBe(0);
    expect(run.done).toBe(true);
    expect(run.result()).toEqual(a);
    expect(multiwayEquity(hero, ranges, board, { seed: 10, trials: 10_000 }).players[0].equity).not.toBe(a.players[0].equity);
  });

  it("throws on incompatible ranges, empty ranges and too many opponents", () => {
    const only = weightsOf([["AsAh", 1]]);
    expect(() => multiwayEquity(hand("KdKc"), [only, only], [], { trials: 10 })).toThrow(/incompatible/);
    expect(() => multiwayEquity(hand("AsKc"), [only], [])).toThrow(/empty/);
    const u = new Float64Array(COMBO_COUNT).fill(1);
    expect(() => multiwayEquity(hand("AsKc"), Array(9).fill(u), [])).toThrow(/1-8/);
    expect(() => multiwayEquity(hand("AsKc"), [], [])).toThrow(/1-8/);
  });
});

describe("sampleJoint", () => {
  it("matches the exact joint posterior for heavily colliding ranges", () => {
    const blocked = cards("Ks7d2c");
    const r1 = weightsOf([["AK", 1], ["AA", 2]]);
    const r2 = weightsOf([["AK", 3], ["AQs", 1]]);
    const w1 = liveWeights(r1, blocked), w2 = liveWeights(r2, blocked);
    const exact = new Map<number, number>();
    let z = 0;
    for (let a = 0; a < COMBO_COUNT; a++) {
      for (let b = 0; b < COMBO_COUNT; b++) {
        if (w1[a] === 0 || w2[b] === 0 || !disjoint([a, b])) continue;
        exact.set(a * COMBO_COUNT + b, w1[a] * w2[b]);
        z += w1[a] * w2[b];
      }
    }
    const N = 200_000;
    const { combos, acceptance } = sampleJoint([r1, r2], blocked, N, 1);
    expect(combos).toHaveLength(2);
    expect(combos[0]).toBeInstanceOf(Int16Array);
    expect(combos[0]).toHaveLength(N);
    const counts = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      const key = combos[0][i] * COMBO_COUNT + combos[1][i];
      expect(exact.has(key)).toBe(true); // never a collision or a blocked combo
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let worst = 0, chi2 = 0;
    for (const [key, p0] of exact) {
      const p = p0 / z;
      const f = (counts.get(key) ?? 0) / N;
      worst = Math.max(worst, Math.abs(f - p) / Math.sqrt((p * (1 - p)) / N));
      chi2 += (N * (f - p) ** 2) / p;
    }
    expect(worst).toBeLessThan(4.5);
    // chi-square with exact.size - 1 degrees of freedom: mean df, sd sqrt(2 df).
    const df = exact.size - 1;
    expect(chi2).toBeLessThan(df + 5 * Math.sqrt(2 * df));
    // Acceptance estimates P(disjoint) under independent draws, which is z.
    const attempts = N / acceptance;
    expect(Math.abs(acceptance - z)).toBeLessThan(4 * Math.sqrt((z * (1 - z)) / attempts));
  }, 20_000);

  it("is deterministic by seed", () => {
    const r = [weightsOf([["AK", 1]]), weightsOf([["AK, KK", 1]])];
    const a = sampleJoint(r, [], 1000, 4), b = sampleJoint(r, [], 1000, 4);
    expect(Array.from(a.combos[1])).toEqual(Array.from(b.combos[1]));
    expect(a.combos[0][0]).toBeGreaterThanOrEqual(0);
    expect(comboIndex(COMBO_HI[a.combos[0][0]], COMBO_LO[a.combos[0][0]])).toBe(a.combos[0][0]);
  });
});
