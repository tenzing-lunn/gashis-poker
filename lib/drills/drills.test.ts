import { describe, expect, it } from "vitest";
import { parseCards } from "../poker/cards";
import { comboCards } from "../poker/combinatorics";
import { exactEquity } from "../poker/equity";
import { countCombos, parseRange, removeDeadCards } from "../poker/range";
import { naiveBest } from "../poker/testing/naive-evaluator";
import type { RangeEquityParams } from "./estimate";
import { DRILL_LABELS, DRILL_TYPES, check, generate, type Difficulty, type Question } from "./index";
import type { CountOutsParams } from "./outs";
import type { SpeedCallFoldParams } from "./odds";

const diff = (seed: number) => ((seed % 3) + 1) as Difficulty;
const many = (type: (typeof DRILL_TYPES)[number], n: number): Question[] =>
  Array.from({ length: n }, (_, i) => generate(type, i + 1, diff(i + 1)));

describe("generate", () => {
  it("has a label for every type", () => {
    expect(DRILL_TYPES).toHaveLength(8);
    for (const t of DRILL_TYPES) expect(DRILL_LABELS[t]).toBeTruthy();
  });

  it("is deterministic by seed", () => {
    for (const t of DRILL_TYPES) {
      for (const seed of [1, 7, 12345]) {
        const a = generate(t, seed, 3), b = generate(t, seed, 3);
        expect(a).toEqual(b);
        expect(a.id).toBe(`${t}:${seed}`);
      }
    }
  });

  it("every type generates 200 seeds without throwing, with a well-formed question", () => {
    for (const t of DRILL_TYPES) {
      for (const q of many(t, 200)) {
        expect(q.type).toBe(t);
        expect(q.prompt.length).toBeGreaterThan(10);
        expect(q.explanation.length).toBeGreaterThan(5);
        if (q.unit === "action") expect(["call", "fold"]).toContain(q.answer);
        else expect(Number.isFinite(q.answer)).toBe(true);
        // A correct answer typed back in is accepted.
        expect(check(q, String(q.answer)).correct).toBe(true);
      }
    }
  }, 60_000);
});

describe("countOuts", () => {
  it("matches a brute-force count with the naive evaluator", () => {
    for (const q of many("countOuts", 150)) {
      const p = q.params as CountOutsParams;
      const hero = parseCards(p.hero), villain = parseCards(p.villain), board = parseCards(p.board);
      const cat = (score: number) => Math.floor(score / 16 ** 5);
      const heroNow = naiveBest([...hero, ...board]);
      expect(heroNow).toBeLessThan(naiveBest([...villain, ...board]));
      const used = new Set([...hero, ...villain, ...board]);
      let count = 0;
      for (let c = 0; c < 52; c++) {
        if (used.has(c)) continue;
        const h = naiveBest([...hero, ...board, c]), v = naiveBest([...villain, ...board, c]);
        if (p.variant === "outs" ? h > v : h <= v && cat(h) > cat(heroNow)) count++;
      }
      expect(q.answer, q.id).toBe(count);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(20);
      expect(p.unseen).toBe(52 - 4 - board.length);
    }
  });
});

describe("comboCount", () => {
  it("answer = countCombos(range, dead) and card removal always matters", () => {
    for (const q of many("comboCount", 200)) {
      const p = q.params as { range: string; dead: string };
      const dead = parseCards(p.dead);
      expect(q.answer).toBe(countCombos(p.range, dead));
      expect(q.answer).toBeLessThan(countCombos(p.range));
    }
  });
});

describe("equityEstimate", () => {
  it("range variant is the plain mean of exact equity over compatible combos", () => {
    const qs = many("equityEstimate", 60).filter((q) => (q.params as { variant: string }).variant === "range");
    expect(qs.length).toBeGreaterThan(5);
    for (const q of qs) {
      const p = q.params as RangeEquityParams;
      const hero = parseCards(p.hero), board = parseCards(p.board);
      const live = removeDeadCards(parseRange(p.range), [...hero, ...board]);
      expect(live.length).toBe(p.combos);
      const mean = live.reduce((s, c) => s + exactEquity([hero, comboCards(c)], board).players[0].equity, 0) / live.length;
      expect(q.answer).toBeCloseTo(100 * mean, 9);
    }
  });
});

describe("speedCallFold", () => {
  it("is never a near-tie and calls iff equity >= B/(P+2B)", () => {
    for (const q of many("speedCallFold", 200)) {
      const p = q.params as SpeedCallFoldParams;
      const required = (100 * p.bet) / (p.pot + 2 * p.bet);
      expect(Math.abs(p.equity - required)).toBeGreaterThanOrEqual(3);
      expect(q.answer).toBe(p.equity >= required ? "call" : "fold");
    }
  });
});

describe("check", () => {
  const pct: Question = {
    type: "potOdds",
    id: "potOdds:0",
    prompt: "",
    params: {},
    answer: 200 / 7, // 28.571428...
    unit: "%",
    tolerance: 1,
    explanation: "",
  };
  const action: Question = { ...pct, type: "speedCallFold", answer: "call", unit: "action", tolerance: 0 };
  const outs: Question = { ...pct, type: "countOuts", answer: 12, unit: "outs", tolerance: 0 };

  it("parses leniently", () => {
    expect(check(pct, "28.6").given).toBe(28.6);
    expect(check(pct, "28.6%").given).toBe(28.6);
    expect(check(pct, " 29 % ").given).toBe(29);
    expect(check(outs, " 12 ").correct).toBe(true);
    expect(check(outs, "12 outs").correct).toBe(true);
    expect(check(action, "Call").correct).toBe(true);
    expect(check(action, "c").correct).toBe(true);
    expect(check(action, "f")).toMatchObject({ correct: false, given: "fold", expected: "call" });
    expect(check({ ...pct, unit: "bb", answer: -3.5 }, "−3.5 bb").correct).toBe(true);
  });

  it("rejects unparseable input", () => {
    for (const bad of ["", "abc", "12x", "1.2.3", "call"]) expect(check(pct, bad)).toMatchObject({ correct: false, given: null });
    expect(check(action, "12")).toMatchObject({ correct: false, given: null });
  });

  it("applies an absolute tolerance", () => {
    expect(check(pct, "27.6").correct).toBe(true); // |−0.97| ≤ 1
    expect(check(pct, "29.5").correct).toBe(true);
    expect(check(pct, "27.5").correct).toBe(false);
    expect(check(pct, "29.6").correct).toBe(false);
    expect(check(outs, "11").correct).toBe(false);
    expect(check(outs, "13").correct).toBe(false);
    expect(check(pct, "30").error).toBeCloseTo(30 - 200 / 7, 12);
    expect(check(pct, "28.6").expected).toBe("28.57%");
  });
});
