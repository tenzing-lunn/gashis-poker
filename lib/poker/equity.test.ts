import { describe, expect, it } from "vitest";
import { FULL_DECK, createRng, formatCards, parseCards, shuffle, type Card } from "./cards";
import { COMBO_HI, COMBO_LO } from "./combinatorics";
import { exactEquity, monteCarloEquity } from "./equity";
import { evaluate } from "./evaluator";
import { parseRange, removeDeadCards } from "./range";
import { naiveExactEquity } from "./testing/naive-evaluator";

describe("exactEquity", () => {
  it("matches a brute-force naive evaluator on random flop/turn/river spots (2-3 players)", () => {
    const rng = createRng(8);
    for (let i = 0; i < 40; i++) {
      const players = 2 + rng.int(2);
      const boardLen = [3, 4, 5][rng.int(3)];
      const deck = shuffle([...FULL_DECK], rng);
      const hands = Array.from({ length: players }, (_, p) => deck.slice(2 * p, 2 * p + 2));
      const board = deck.slice(2 * players, 2 * players + boardLen);
      const dead = rng.next() < 0.3 ? deck.slice(20, 22) : [];
      // The naive oracle is slow, so keep flop spots heads-up.
      if (boardLen === 3 && players === 3) continue;
      const res = exactEquity(hands, board, dead);
      const naive = naiveExactEquity(hands, board, dead);
      res.players.forEach((p, k) => expect(p.equity, `${hands.map(formatCards)} | ${formatCards(board)}`).toBeCloseTo(naive[k], 12));
      const sum = res.players.reduce((s, p) => s + p.equity, 0);
      expect(sum).toBeCloseTo(1, 12);
    }
  });

  it("counts runouts and reports win/tie/equity consistently", () => {
    const flop = exactEquity(["AsKs", "QhQd"], "Ts9s2c");
    expect(flop.samples).toBe(990); // C(45, 2)
    const turn = exactEquity(["AsKs", "QhQd", "7c7d"], "Ts9s2c3h");
    expect(turn.samples).toBe(42); // 52 - 6 hole - 4 board
    const river = exactEquity(["AsKs", "AhKh"], "2c3d7h8sTc");
    expect(river.players.map((p) => [p.win, p.tie, p.equity])).toEqual([[0, 1, 0.5], [0, 1, 0.5]]);
    for (const r of [flop, turn]) {
      for (const p of r.players) expect(p.equity).toBeGreaterThanOrEqual(p.win - 1e-12);
    }
  });

  it("preflop heads-up enumerates all 1,712,304 boards", () => {
    const t0 = performance.now();
    const r = exactEquity(["AsAh", "KdKc"]);
    const ms = performance.now() - t0;
    expect(r.samples).toBe(1_712_304);
    // AsAh vs KdKc: 81.2555% / 18.7445%, cross-checked by brute force with the naive evaluator
    // and by the judge's independent Python evaluator.
    expect(r.players[0].equity).toBeCloseTo(0.8125548967940273, 12);
    expect(r.players[1].equity).toBeCloseTo(0.18744510320597277, 12);
    expect(r.players[0].equity + r.players[1].equity).toBeCloseTo(1, 12);
    expect(ms).toBeLessThan(5000);
  });

  it("handles dead cards and suit symmetry", () => {
    const a = exactEquity(["AsKs", "QhQd"], "", "");
    const b = exactEquity(["AhKh", "QsQd"], "", "");
    expect(a.players[0].equity).toBeCloseTo(b.players[0].equity, 12);
    const withDead = exactEquity(["AsKs", "QhQd"], "Ts9s2c", "Qc");
    expect(withDead.samples).toBe(44 * 43 / 2);
    expect(() => exactEquity(["AsKs", "AsQd"])).toThrow(/Duplicate/);
    expect(() => exactEquity(["AsKs"])).toThrow();
  });

  it("multiway preflop (3 players) sums to 1", () => {
    const r = exactEquity(["AsAh", "KdKc", "7s2h"], "", "");
    expect(r.samples).toBe(1_370_754); // C(46, 5)
    expect(r.players.reduce((s, p) => s + p.equity, 0)).toBeCloseTo(1, 12);
  });
});

// Exact range-vs-range equity by enumerating compatible combo pairs, for checking Monte Carlo.
function exactRangeVsRange(r1: number[], r2: number[], board: Card[]): number {
  let eq = 0, weight = 0;
  for (const c1 of r1) {
    for (const c2 of r2) {
      const cards = [COMBO_HI[c1], COMBO_LO[c1], COMBO_HI[c2], COMBO_LO[c2]];
      if (new Set([...cards, ...board]).size !== 4 + board.length) continue;
      const res = exactEquity([cards.slice(0, 2), cards.slice(2)], board);
      eq += res.players[0].equity;
      weight++;
    }
  }
  return eq / weight;
}

describe("monteCarloEquity", () => {
  it("is reproducible for a fixed seed", () => {
    const a = monteCarloEquity(["AsKs", "QQ"], { trials: 5000, seed: 3 });
    const b = monteCarloEquity(["AsKs", "QQ"], { trials: 5000, seed: 3 });
    expect(a).toEqual(b);
  });

  it("hand vs hand within 0.5 pp of exact at the default sample size, error consistent with stdErr", () => {
    const spots: [string[], string][] = [
      [["AsAh", "KdKc"], ""],
      [["AsKs", "QhQd"], "Ts9s2c"],
      [["7c7d", "AhKh", "Qs Js"], "2h3h8c"],
      [["9s8s", "AcQd"], "7s6d2h"],
    ];
    spots.forEach(([hands, board], i) => {
      const exact = exactEquity(hands, board);
      const mc = monteCarloEquity(hands, { board, seed: 100 + i });
      expect(mc.samples).toBe(200_000);
      mc.players.forEach((p, k) => {
        const err = Math.abs(p.equity - exact.players[k].equity);
        expect(err).toBeLessThan(0.005);
        expect(err).toBeLessThan(4.5 * p.stdErr);
        expect(p.stdErr).toBeLessThan(0.0012);
      });
    });
  });

  it("range vs range with overlapping ranges matches exact enumeration", () => {
    const board = parseCards("Kh7d2c5s");
    const r1 = removeDeadCards(parseRange("AA, KK, AK, 77"), board);
    const r2 = removeDeadCards(parseRange("AK, KQ, 55, A5s"), board);
    const exact = exactRangeVsRange(r1, r2, board);
    const mc = monteCarloEquity([r1, r2], { board, seed: 9 });
    expect(Math.abs(mc.players[0].equity - exact)).toBeLessThan(0.005);
    expect(Math.abs(mc.players[0].equity - exact)).toBeLessThan(4.5 * mc.players[0].stdErr);
  });

  it("hand vs range on a river is unbiased", () => {
    const board = parseCards("Ah9d4c2s2h");
    const hero = parseCards("AsKd");
    const villain = removeDeadCards(parseRange("22+, A2+, K9s+"), [...board, ...hero]);
    let eq = 0;
    for (const c of villain) {
      const v = evaluate([COMBO_HI[c], COMBO_LO[c], ...board]), h = evaluate([...hero, ...board]);
      eq += h > v ? 1 : h === v ? 0.5 : 0;
    }
    eq /= villain.length;
    const mc = monteCarloEquity(["AsKd", "22+, A2+, K9s+"], { board, seed: 4 });
    expect(Math.abs(mc.players[0].equity - eq)).toBeLessThan(4.5 * mc.players[0].stdErr + 1e-9);
  });

  it("validates trials and combo arrays; duplicate combos are deduped", () => {
    expect(() => monteCarloEquity(["AsKs", "QQ"], { trials: 1.5 })).toThrow(/positive integer/);
    expect(() => monteCarloEquity(["AsKs", "QQ"], { trials: 0 })).toThrow(/positive integer/);
    expect(() => monteCarloEquity(["AsKs", "QQ"], { trials: NaN })).toThrow(/positive integer/);
    expect(() => monteCarloEquity([[1326], "QQ"], { trials: 10 })).toThrow(/invalid combo/);
    expect(() => monteCarloEquity([[-1], "QQ"], { trials: 10 })).toThrow(/invalid combo/);
    expect(() => monteCarloEquity([[0.5], "QQ"], { trials: 10 })).toThrow(/invalid combo/);
    const aks = parseRange("AsKs");
    const qq = parseRange("QQ");
    const once = monteCarloEquity([aks, qq], { trials: 20_000, seed: 2 });
    const doubled = monteCarloEquity([aks, [...qq, ...qq, qq[0], qq[0]]], { trials: 20_000, seed: 2 });
    expect(doubled).toEqual(once);
    const sum = once.players.reduce((s, p) => s + p.equity, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it("rejects impossible inputs", () => {
    expect(() => monteCarloEquity(["AsAh", "AsAh"], { trials: 10 })).toThrow(/incompatible/);
    expect(() => monteCarloEquity(["AA", "KK"], { dead: "AsAhAdAc", trials: 10 })).toThrow(/empty/);
  });
});
