import { describe, expect, it, vi } from "vitest";
import { LESSONS } from "../../app/learn/lessons";
import { parseCards } from "../poker/cards";
import { countCombos } from "../poker/range";
import type { ComboCountParams } from "./combos";
import type { EquityEstimateParams } from "./estimate";
import {
  DIFFICULTY_LABELS,
  DRILL_INFO,
  DRILL_LABELS,
  DRILL_TYPES,
  START_HERE,
  check,
  generate,
  parseDrillType,
  summarize,
  type Difficulty,
  type DrillType,
  type Question,
  type RoundAnswer,
} from "./index";
import type { CallEvParams, MdfParams, OutsToEquityParams, PotBetParams, SpeedCallFoldParams } from "./odds";
import { countOutCards, type CountOutsParams } from "./outs";
import { mistakesOf } from "./util";

// Pass-through spy: lets the sweep below see every candidate formula a generator offered, kept or dropped.
vi.mock("./util", async (importOriginal) => {
  const util = await importOriginal<typeof import("./util")>();
  return { ...util, mistakesOf: vi.fn(util.mistakesOf) };
});

// equityEstimate enumerates every runout (preflop ~55 ms a question), so it gets fewer seeds.
const seeds = (type: DrillType) => (type === "equityEstimate" ? 100 : 200);
const DIFFICULTIES: Difficulty[] = [1, 2, 3];

const cache = new Map<DrillType, Question[]>();
/** 200 seeds (100 for equityEstimate) × 3 difficulties, generated once per type. */
function all(type: DrillType): Question[] {
  if (!cache.has(type)) {
    const qs: Question[] = [];
    for (const d of DIFFICULTIES) for (let seed = 1; seed <= seeds(type); seed++) qs.push(generate(type, seed, d));
    cache.set(type, qs);
  }
  return cache.get(type)!;
}

/** The first generated question of `type` matching `pred`. */
function find<P>(type: DrillType, pred: (q: Question<P>) => boolean): Question<P> {
  const q = (all(type) as Question<P>[]).find(pred);
  if (!q) throw new Error(`No ${type} question matches`);
  return q;
}

const FACTS: Record<DrillType, number> = {
  countOuts: 4,
  outsToEquity: 3,
  potOdds: 2,
  callEv: 3,
  speedCallFold: 3,
  comboCount: 3,
  equityEstimate: 3,
  mdf: 2,
};

const FORMULA_TYPES: DrillType[] = ["outsToEquity", "potOdds", "callEv", "speedCallFold", "mdf"];

describe("question shape", () => {
  it("every type emits a fixed set of fact labels, and prompt = facts + ask", () => {
    for (const t of DRILL_TYPES) {
      const labels = all(t)[0].facts.map((f) => f.label);
      expect(labels).toHaveLength(FACTS[t]);
      for (const q of all(t)) {
        expect(q.facts.map((f) => f.label), q.id).toEqual(labels);
        for (const f of q.facts) expect(f.value.length, q.id).toBeGreaterThan(0);
        expect(q.prompt).toBe([...q.facts.map((f) => `${f.label}: ${f.value}`), q.ask].join("\n"));
      }
    }
  }, 120_000);

  it("says you / them, never hero / villain, and drops the tolerance from the text", () => {
    for (const t of DRILL_TYPES) {
      for (const q of all(t)) {
        const text = [q.prompt, q.hint, q.explanation, q.estimate, ...q.mistakes.map((m) => m.message)].join(" ");
        expect(text, q.id).not.toMatch(/hero|villain/i);
        expect(text, q.id).not.toMatch(/graded within/i);
      }
    }
  });

  it("hints only at difficulty 1 on formula drills; estimates only on equityEstimate", () => {
    for (const t of DRILL_TYPES) {
      for (const q of all(t)) {
        const d = (q.params as { difficulty: Difficulty }).difficulty;
        expect(q.hint !== undefined, q.id).toBe(d === 1 && FORMULA_TYPES.includes(t));
        expect(q.estimate !== undefined, q.id).toBe(t === "equityEstimate");
      }
    }
  });

  it("the pot-odds question doesn't give the formula away", () => {
    for (const q of all("potOdds")) expect(q.ask).not.toMatch(/\/|divid|final pot|POT \+/i);
  });
});

describe("mistakes", () => {
  it("a correct answer never gets a mistake, across seeds and difficulties", () => {
    for (const t of DRILL_TYPES) {
      for (const q of all(t)) {
        const tries = typeof q.answer === "number" ? [q.answer, q.answer - q.tolerance, q.answer + q.tolerance] : [q.answer];
        for (const a of tries) {
          const r = check(q, String(a));
          expect(r.correct, q.id).toBe(true);
          expect(r.mistake, q.id).toBeUndefined();
        }
      }
    }
  });

  it("every mistake sits outside the correct band, apart from the others, and is named when typed", () => {
    let total = 0;
    for (const t of DRILL_TYPES) {
      let typed = 0;
      for (const q of all(t)) {
        q.mistakes.forEach((m, i) => {
          if (typeof m.value === "number") {
            expect(Math.abs(m.value - (q.answer as number)), q.id).toBeGreaterThan(q.tolerance + m.tolerance);
            // Mistakes that share a message (two formulas that can't be told apart) may overlap.
            for (const o of q.mistakes.slice(0, i).filter((o) => o.message !== m.message)) {
              expect(Math.abs(m.value - (o.value as number)), q.id).toBeGreaterThan(m.tolerance + o.tolerance);
            }
          } else {
            expect(m.value).not.toBe(q.answer);
            expect(q.mistakes.slice(0, i).map((o) => o.value)).not.toContain(m.value);
          }
          const r = check(q, String(m.value));
          expect(r.correct, q.id).toBe(false);
          expect(r.mistake, q.id).toBe(m.message);
          typed++;
        });
      }
      expect(typed, `${t} has mistakes`).toBeGreaterThan(0);
      total += typed;
    }
    expect(total).toBeGreaterThan(1000);
  });

  it("potOdds: BET / POT, forgetting your call, and the complement", () => {
    const q = find<PotBetParams>("potOdds", (q) => q.mistakes.length === 3);
    const { pot: P, bet: B } = q.params;
    expect(check(q, String((100 * B) / P)).mistake).toMatch(/BET \/ POT/);
    expect(check(q, String((100 * B) / (P + B))).mistake).toMatch(/BET \/ \(POT \+ BET\).*forgets your own call/);
    expect(check(q, String(100 - (q.answer as number))).mistake).toMatch(/afford to lose/);
    expect(check(q, "abc").mistake).toBeUndefined();
  });

  it("outsToEquity: rule of 4 shortcut, one card instead of two, rule of 4 with one card", () => {
    const two = find<OutsToEquityParams>("outsToEquity", (q) => q.params.cardsToCome === 2 && q.params.outs >= 13);
    expect(check(two, String(4 * two.params.outs)).mistake).toMatch(/rule of 4 shortcut/);
    expect(check(two, String((100 * two.params.outs) / two.params.unseen)).mistake).toMatch(/chance for one card/);
    const one = find<OutsToEquityParams>("outsToEquity", (q) => q.params.cardsToCome === 1 && q.params.outs >= 15);
    expect(check(one, String(4 * one.params.outs)).mistake).toMatch(/rule of 4.*two cards to come/);
    // Few outs: the rule of 4 and the exact two-card chance can't be told apart, so one message names both.
    const close = find<OutsToEquityParams>("outsToEquity", (q) => q.params.cardsToCome === 1 && q.params.outs === 6);
    const { outs, unseen } = close.params;
    const twoCards = 100 * (1 - ((unseen - outs) * (unseen - outs - 1)) / (unseen * (unseen - 1)));
    expect(check(close, String(4 * outs)).mistake).toMatch(/chance over two cards.*rule of 4/);
    expect(check(close, twoCards.toFixed(2)).mistake).toBe(check(close, String(4 * outs)).mistake);
  });

  it("countOuts: counting dirty outs as outs, and clean outs as dirty", () => {
    const cards = (p: CountOutsParams, v: "outs" | "dirty") =>
      countOutCards(parseCards(p.hero), parseCards(p.villain), parseCards(p.board), v).length;
    const outs = find<CountOutsParams>("countOuts", (q) => q.params.variant === "outs" && cards(q.params, "dirty") > 0);
    expect(check(outs, String(cards(outs.params, "outs") + cards(outs.params, "dirty"))).mistake).toMatch(/dirty outs/);
    const dirty = find<CountOutsParams>("countOuts", (q) => q.params.variant === "dirty" && cards(q.params, "outs") > 0);
    expect(check(dirty, String(cards(dirty.params, "outs"))).mistake).toMatch(/clean outs/);
  });

  it("mdf: bluff break-even and pot odds for MDF; MDF for the bluff", () => {
    const m = find<MdfParams>("mdf", (q) => q.params.variant === "mdf" && q.mistakes.length === 2);
    const { pot: P, bet: B } = m.params;
    expect(check(m, String((100 * B) / (P + B))).mistake).toMatch(/100% − MDF.*bluff must work/);
    expect(check(m, String(100 - (m.answer as number))).mistake).toMatch(/100% − MDF/);
    expect(check(m, String((100 * B) / (P + 2 * B))).mistake).toMatch(/pot odds/);
    const b = find<MdfParams>("mdf", (q) => q.params.variant === "bluff" && q.mistakes.length === 3);
    expect(check(b, String((100 * b.params.pot) / (b.params.pot + b.params.bet))).mistake).toMatch(/minimum defense frequency/);
    expect(check(b, String((100 * b.params.bet) / b.params.pot)).mistake).toMatch(/BET \/ POT/);
  });

  it("comboCount: no card removal, and removing only one set of dead cards", () => {
    const q = find<ComboCountParams>("comboCount", (q) => q.params.hero !== null && q.params.board !== null && q.mistakes.length === 3);
    const { range, hero, board } = q.params;
    expect(check(q, String(countCombos(range))).mistake).toMatch(/before card removal/);
    expect(check(q, String(countCombos(range, parseCards(hero!)))).mistake).toMatch(/not the board's/);
    expect(check(q, String(countCombos(range, parseCards(board!)))).mistake).toMatch(/board cards but not yours/);
  });

  it("callEv: not subtracting the call, leaving it out of the pot, the pre-bet pot, the sign", () => {
    const q = find<CallEvParams>("callEv", (q) => q.mistakes.length === 4);
    const { pot: P, bet: B, equity } = q.params, e = equity / 100;
    expect(check(q, String(e * (P + 2 * B))).mistake).toMatch(/didn't subtract your call/);
    expect(check(q, String(e * (P + B) - B)).mistake).toMatch(/left your own call out/);
    expect(check(q, String(e * P - B)).mistake).toMatch(/only the pot before the bet/);
    expect(check(q, String(-(q.answer as number))).mistake).toMatch(/wrong sign/);
  });

  it("speedCallFold: folding a call by comparing with BET / (POT + BET)", () => {
    const q = find<SpeedCallFoldParams>(
      "speedCallFold",
      (q) => q.answer === "call" && q.params.equity < (100 * q.params.bet) / (q.params.pot + q.params.bet),
    );
    expect(check(q, "fold").mistake).toMatch(/BET \/ \(POT \+ BET\).*forgets your call/);
    const fold = find<SpeedCallFoldParams>("speedCallFold", (q) => q.answer === "fold");
    expect(check(fold, "call").mistake).toBeUndefined();
  });

  it("typing any candidate formula's value, exact or rounded, never gets a different formula's message", () => {
    const spy = vi.mocked(mistakesOf);
    let named = 0;
    for (const t of DRILL_TYPES) {
      for (const d of DIFFICULTIES) {
        for (let seed = 1; seed <= (t === "equityEstimate" ? 40 : 300); seed++) {
          spy.mockClear();
          const q = generate(t, seed, d);
          expect(spy, q.id).toHaveBeenCalledTimes(1);
          for (const [value, message] of spy.mock.calls[0][2]) {
            const typed =
              typeof value === "number" ? [value, value.toFixed(2), value.toFixed(1), Math.round(value)] : [value];
            for (const x of typed) {
              const r = check(q, String(x));
              if (r.mistake === undefined) continue;
              expect(r.mistake, `${q.id} d${d} typed ${x}`).toBe(message);
              named++;
            }
          }
        }
      }
    }
    expect(named).toBeGreaterThan(10_000);
  }, 120_000);

  it("speedCallFold: BET / POT is only named when it's under 100%", () => {
    let capped = 0;
    for (const q of all("speedCallFold") as Question<SpeedCallFoldParams>[]) {
      const { pot, bet, equity } = q.params;
      const r = check(q, q.answer === "call" ? "fold" : "call");
      if (r.mistake?.includes("BET / POT (")) expect(bet, q.id).toBeLessThan(pot);
      if (q.answer === "call" && bet >= pot && equity >= (100 * bet) / (pot + bet)) {
        expect(r.mistake, q.id).toBeUndefined();
        capped++;
      }
    }
    expect(capped).toBeGreaterThan(0);
  });

  it("equityEstimate: giving their equity", () => {
    const q = find<EquityEstimateParams>("equityEstimate", (q) => Math.abs(100 - 2 * (q.answer as number)) > 20);
    expect(check(q, String(100 - (q.answer as number))).mistake).toMatch(/their equity/);
  });
});

describe("speedCallFold balance", () => {
  it("calls are 35–65% of answers at every difficulty", () => {
    for (const d of DIFFICULTIES) {
      let calls = 0;
      for (let seed = 1; seed <= 600; seed++) if (generate("speedCallFold", seed, d).answer === "call") calls++;
      expect(calls / 600, `d${d}`).toBeGreaterThan(0.35);
      expect(calls / 600, `d${d}`).toBeLessThan(0.65);
    }
  });
});

describe("equityEstimate teaching", () => {
  it("flop hands count outs with the rule of 4; preflop names a class; ranges count combos ahead", () => {
    for (const q of all("equityEstimate")) {
      const p = q.params as EquityEstimateParams;
      const exact = `Exact${p.variant === "range" ? " mean" : ""}: ${(q.answer as number).toFixed(1)}%.`;
      expect(q.estimate, q.id).toContain(exact);
      if (p.variant === "range") expect(q.estimate).toMatch(/^You're ahead of \d+ of \d+ combos now/);
      else if (p.street === "flop") expect(q.estimate).toMatch(/× 4|50 \+ 2 ×/);
      else expect(q.estimate).toMatch(/usually about \d+(–\d+)?% for you/);
    }
  });
});

describe("index", () => {
  it("lists types in curriculum order and starts with countOuts", () => {
    expect(DRILL_TYPES).toEqual([
      "countOuts",
      "outsToEquity",
      "potOdds",
      "callEv",
      "speedCallFold",
      "comboCount",
      "equityEstimate",
      "mdf",
    ]);
    expect(START_HERE).toBe("countOuts");
    expect(DIFFICULTY_LABELS).toEqual({ 1: "Easy", 2: "Medium", 3: "Hard" });
  });

  it("DRILL_INFO: short blurbs and levels, lessons that exist", () => {
    for (const t of DRILL_TYPES) {
      const info = DRILL_INFO[t];
      expect(DRILL_LABELS[t]).toBeTruthy();
      expect(info.blurb.length, t).toBeLessThanOrEqual(40);
      expect(info.levels).toHaveLength(3);
      for (const l of info.levels) expect(l.length, l).toBeLessThanOrEqual(40);
      expect(LESSONS.find((l) => l.slug === info.lesson.slug)?.module, t).toBe(info.lesson.module);
    }
  });

  it("parseDrillType matches exact ids only", () => {
    expect(parseDrillType("potOdds")).toBe("potOdds");
    for (const t of DRILL_TYPES) expect(parseDrillType(t)).toBe(t);
    for (const bad of [null, undefined, "", "potodds", " potOdds", "pot-odds", "toString"]) expect(parseDrillType(bad)).toBeNull();
  });
});

describe("summarize", () => {
  const ans = (ms: number, correct: boolean): RoundAnswer => ({
    id: `potOdds:${ms}`,
    seed: ms,
    type: "potOdds",
    difficulty: 1,
    correct,
    ms,
    given: "1",
    expected: "2",
    facts: [],
    ask: "",
  });

  it("is empty-safe", () => {
    expect(summarize([])).toEqual({ attempted: 0, correct: 0, accuracy: 0, medianMs: null, misses: [] });
  });

  it("takes the middle time for odd counts and the mean of the two middles for even", () => {
    expect(summarize([ans(3000, true), ans(1000, false), ans(2000, true)]).medianMs).toBe(2000);
    expect(summarize([ans(4000, true), ans(1000, true), ans(3000, true), ans(2000, true)]).medianMs).toBe(2500);
  });

  it("counts accuracy and keeps misses in order", () => {
    const a = [ans(1, true), ans(2, false), ans(3, true), ans(4, false)];
    const s = summarize(a);
    expect(s).toMatchObject({ attempted: 4, correct: 2, accuracy: 50 });
    expect(s.misses).toEqual([a[1], a[3]]);
  });
});
