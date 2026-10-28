import { describe, expect, it } from "vitest";
import { FULL_DECK, createRng, parseCards, shuffle, type Card } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO, comboIndex } from "../poker/combinatorics";
import { exactEquity } from "../poker/equity";
import { evaluate } from "../poker/evaluator";
import { comboEquities, comboSampler, equityVsRange, liveWeights, startEquityVsRange } from "./weighted-equity";

const cards = (s: string): Card[] => parseCards(s);
const hand = (s: string): [Card, Card] => parseCards(s) as [Card, Card];
const combo = (s: string): number => {
  const [a, b] = parseCards(s);
  return comboIndex(a, b);
};
const weightsOf = (entries: [string, number][]): Float64Array => {
  const w = new Float64Array(COMBO_COUNT);
  for (const [s, x] of entries) w[combo(s)] = x;
  return w;
};
const uniform = (): Float64Array => new Float64Array(COMBO_COUNT).fill(1);
const randomWeights = (seed: number, density = 1): Float64Array => {
  const rng = createRng(seed);
  const w = new Float64Array(COMBO_COUNT);
  for (let c = 0; c < COMBO_COUNT; c++) if (rng.next() < density) w[c] = rng.next() * 3;
  return w;
};
const uses = (c: number, known: readonly Card[]): boolean => known.includes(COMBO_HI[c]) || known.includes(COMBO_LO[c]);

/** Brute force: Σ w_c · exactEquity(hero vs c) over live combos, normalized. */
function bruteForce(hero: [Card, Card], w: Float64Array, board: Card[], dead: Card[] = []) {
  const known = [...hero, ...board, ...dead];
  let total = 0, eq = 0, win = 0, tie = 0;
  for (let c = 0; c < COMBO_COUNT; c++) {
    if (w[c] === 0 || uses(c, known)) continue;
    const r = exactEquity([hero, [COMBO_HI[c], COMBO_LO[c]]], board, dead).players[0];
    total += w[c];
    eq += w[c] * r.equity;
    win += w[c] * r.win;
    tie += w[c] * r.tie;
  }
  return { equity: eq / total, win: win / total, tie: tie / total };
}

describe("liveWeights", () => {
  it("zeroes blocked combos and normalizes", () => {
    const w = weightsOf([["AsAh", 2], ["AsKd", 5], ["QhQd", 3], ["7c2d", 0]]);
    const live = liveWeights(w, cards("As"));
    expect(live[combo("AsAh")]).toBe(0);
    expect(live[combo("AsKd")]).toBe(0);
    expect(live[combo("QhQd")]).toBe(1);
    expect(liveWeights(w, []).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 14);
    expect(w[combo("AsAh")]).toBe(2); // input untouched
  });

  it("throws on an empty range and on bad input", () => {
    expect(() => liveWeights(weightsOf([["AsKs", 1]]), cards("Ks"))).toThrow(/empty/);
    expect(() => liveWeights(new Float64Array(COMBO_COUNT), [])).toThrow(/empty/);
    expect(() => liveWeights(new Float64Array(10), [])).toThrow(/1326/);
    const neg = uniform();
    neg[5] = -1;
    expect(() => liveWeights(neg, [])).toThrow(/Invalid weight/);
    const nan = uniform();
    nan[5] = NaN;
    expect(() => liveWeights(nan, [])).toThrow(/Invalid weight/);
  });
});

describe("equityVsRange (exact postflop)", () => {
  it("matches exactEquity for a single-combo range on flop, turn and river", () => {
    const rng = createRng(3);
    for (let i = 0; i < 30; i++) {
      const deck = shuffle([...FULL_DECK], rng);
      const hero = [deck[0], deck[1]] as [Card, Card];
      const villain = [deck[2], deck[3]];
      const board = deck.slice(4, 4 + [3, 4, 5][i % 3]);
      const dead = i % 4 === 0 ? deck.slice(10, 12) : [];
      const w = new Float64Array(COMBO_COUNT);
      w[comboIndex(villain[0], villain[1])] = 0.37;
      const r = equityVsRange(hero, w, board, { dead });
      const ref = exactEquity([hero, villain], board, dead);
      expect(r.exact).toBe(true);
      expect(r.stdErr).toBe(0);
      expect(r.combos).toBe(1);
      expect(r.samples).toBe(ref.samples);
      expect(Math.abs(r.equity - ref.players[0].equity)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(r.win - ref.players[0].win)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(r.tie - ref.players[0].tie)).toBeLessThanOrEqual(1e-12);
    }
  });

  it("uniform and random weights match brute-force enumeration over the range", () => {
    const spots: [string, string, string][] = [
      ["AsKs", "Ts9s2c", ""],
      ["7h7d", "Ah8c2d", "Kc"],
      ["QcJc", "Tc9h2c5s", ""],
      ["AhAd", "KsKdQh7c", "2s3s"],
      ["9c8c", "Ts7d2h3c4s", ""],
      ["AsQd", "AhAcQs5d5h", "Kd"],
    ];
    for (const [h, b, d] of spots) {
      for (const w of [uniform(), randomWeights(b.length, 0.5)]) {
        const r = equityVsRange(hand(h), w, cards(b), { dead: cards(d) });
        const ref = bruteForce(hand(h), w, cards(b), cards(d));
        expect(Math.abs(r.equity - ref.equity), `${h} ${b}`).toBeLessThanOrEqual(1e-12);
        expect(Math.abs(r.win - ref.win)).toBeLessThanOrEqual(1e-12);
        expect(Math.abs(r.tie - ref.tie)).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it("river matches a naive 7-card evaluation", () => {
    const hero = hand("JhTh"), board = cards("9h8d2c2sKh");
    const w = randomWeights(11);
    const known = [...hero, ...board];
    let total = 0, eq = 0;
    for (let c = 0; c < COMBO_COUNT; c++) {
      if (uses(c, known)) continue;
      const hv = evaluate([...hero, ...board]), v = evaluate([COMBO_HI[c], COMBO_LO[c], ...board]);
      total += w[c];
      eq += w[c] * (hv > v ? 1 : hv === v ? 0.5 : 0);
    }
    expect(equityVsRange(hero, w, board).equity).toBeCloseTo(eq / total, 12);
  });

  it("is invariant to the scale of the weights", () => {
    const w = randomWeights(5);
    const scaled = w.map((x) => x * 1234.5);
    const a = equityVsRange(hand("KdQd"), w, cards("Qs7d3d"));
    const b = equityVsRange(hand("KdQd"), scaled, cards("Qs7d3d"));
    expect(b.equity).toBeCloseTo(a.equity, 13);
    expect(b.win).toBeCloseTo(a.win, 13);
  });

  it("applies card removal: blocked combos carry no weight; dead cards change the runouts", () => {
    const hero = hand("AhKh"), board = cards("Qh7h2c");
    const base = weightsOf([["QsQd", 1], ["Th9h", 1]]);
    const withBlocked = base.slice();
    withBlocked[combo("AhQs")] = 50; // uses a hero card
    withBlocked[combo("Qh2s")] = 50; // uses a board card
    withBlocked[combo("Jc9c")] = 50; // dead below
    const a = equityVsRange(hero, base, board);
    const b = equityVsRange(hero, withBlocked, board, { dead: cards("Jc") });
    const c = equityVsRange(hero, base, board, { dead: cards("Jc") });
    expect(b.combos).toBe(2);
    expect(b.equity).toBeCloseTo(c.equity, 14);
    expect(a.samples).toBe(990);
    expect(c.samples).toBe(946); // C(44, 2)
    expect(c.equity).toBeCloseTo(bruteForce(hero, base, board, cards("Jc")).equity, 12);
  });

  it("throws on an empty range and bad spots", () => {
    expect(() => equityVsRange(hand("AsKs"), weightsOf([["AsQd", 1]]), cards("2c3c4c"))).toThrow(/empty/);
    expect(() => equityVsRange(hand("AsKs"), uniform(), cards("2c3c"))).toThrow(/Board/);
    expect(() => equityVsRange(hand("AsKs"), uniform(), cards("As3c4c"))).toThrow(/Duplicate/);
  });
});

describe("comboEquities", () => {
  it("exact postflop: per-combo values match exactEquity, NaN where blocked or weightless", () => {
    const hero = hand("8s7s"), board = cards("9s6d2h");
    const w = randomWeights(9, 0.3);
    w[combo("AsKd")] = 1; // live
    w[combo("9sKd")] = 1; // blocked by the board
    const r = comboEquities(hero, board, w, { dead: cards("Kc") });
    expect(r.exact).toBe(true);
    expect(r.samplesPerCombo).toBe(946);
    expect(r.stdErr.every((x) => x === 0)).toBe(true);
    expect(r.equity[combo("9sKd")]).toBeNaN();
    expect(r.equity[combo("KcQc")]).toBeNaN(); // dead card
    for (let c = 0; c < COMBO_COUNT; c++) {
      const live = w[c] > 0 && !uses(c, [...hero, ...board, ...cards("Kc")]);
      expect(Number.isNaN(r.equity[c])).toBe(!live);
      if (!live || c % 7 !== 0) continue;
      const ref = exactEquity([hero, [COMBO_HI[c], COMBO_LO[c]]], board, cards("Kc")).players[0];
      expect(Math.abs(r.equity[c] - ref.equity)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(r.win[c] - ref.win)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(r.tie[c] - ref.tie)).toBeLessThanOrEqual(1e-12);
    }
    // Σ w_c eq_c over live combos reproduces equityVsRange.
    const lw = liveWeights(w, [...hero, ...board, ...cards("Kc")]);
    let sum = 0;
    for (let c = 0; c < COMBO_COUNT; c++) if (lw[c] > 0) sum += lw[c] * r.equity[c];
    expect(sum).toBeCloseTo(equityVsRange(hero, w, board, { dead: cards("Kc") }).equity, 12);
  });

  it("counts 44 runouts on the turn and 1 on the river", () => {
    expect(comboEquities(hand("AsKs"), cards("2c3d4h5s"), uniform()).samplesPerCombo).toBe(44);
    const river = comboEquities(hand("AsKs"), cards("2c3d4h5s9c"), uniform());
    expect(river.samplesPerCombo).toBe(1);
    expect(river.equity[combo("6c6d")]).toBe(0); // 6-high straight beats the wheel
    expect(river.equity[combo("AhKh")]).toBe(0.5);
  });

  it("preflop Monte Carlo: each combo within 4 stdErr of the exact equity; deterministic by seed", () => {
    const hero = hand("JhTh");
    const w = weightsOf([["AsAd", 1], ["7c2d", 1], ["JcTc", 1], ["Ks9d", 2]]);
    const r = comboEquities(hero, [], w, { trialsPerCombo: 4000, seed: 42 });
    expect(r.exact).toBe(false);
    expect(r.samplesPerCombo).toBe(4000);
    for (const s of ["AsAd", "7c2d", "JcTc", "Ks9d"]) {
      const c = combo(s);
      const ref = exactEquity([hero, [COMBO_HI[c], COMBO_LO[c]]]).players[0].equity;
      expect(r.stdErr[c]).toBeGreaterThan(0);
      expect(Math.abs(r.equity[c] - ref), s).toBeLessThan(4 * r.stdErr[c]);
    }
    expect(r.equity[combo("AhAd")]).toBeNaN();
    expect(r.stdErr[combo("AhAd")]).toBe(0);
    const again = comboEquities(hero, [], w, { trialsPerCombo: 4000, seed: 42 });
    expect(Array.from(again.equity)).toEqual(Array.from(r.equity));
    const other = comboEquities(hero, [], w, { trialsPerCombo: 4000, seed: 43 });
    expect(other.equity[combo("AsAd")]).not.toBe(r.equity[combo("AsAd")]);
  });
});

describe("equityVsRange (preflop Monte Carlo)", () => {
  const hero = hand("9h9d");
  const w = weightsOf([["AsKs", 3], ["QcQd", 1], ["7s6s", 2], ["9s8c", 1], ["9c2c", 0.5]]);
  const reference = (() => {
    let total = 0, eq = 0;
    for (let c = 0; c < COMBO_COUNT; c++) {
      if (w[c] === 0) continue;
      total += w[c];
      eq += w[c] * exactEquity([hero, [COMBO_HI[c], COMBO_LO[c]]]).players[0].equity;
    }
    return eq / total;
  })();

  it("is within 4 stdErr of the exact weighted reference", () => {
    const r = equityVsRange(hero, w, [], { seed: 7 });
    expect(r.exact).toBe(false);
    expect(r.samples).toBe(200_000);
    expect(r.combos).toBe(5);
    expect(r.stdErr).toBeGreaterThan(0);
    expect(r.stdErr).toBeLessThan(0.0012);
    expect(Math.abs(r.equity - reference)).toBeLessThan(4 * r.stdErr);
    expect(r.equity).toBeCloseTo(r.win + r.tie / 2, 12);
  });

  it("is deterministic by seed and identical however the work is split", () => {
    const a = equityVsRange(hero, w, [], { seed: 7, trials: 30_000 });
    const run = startEquityVsRange(hero, w, [], { seed: 7, trials: 30_000 });
    expect(run.result().samples).toBe(0);
    let steps = 0;
    while (!run.step(7_777)) {
      steps++;
      const mid = run.result(); // valid at any time for MC
      expect(mid.samples).toBe(7_777 * steps);
    }
    expect(run.done).toBe(true);
    expect(run.result()).toEqual(a);
    expect(equityVsRange(hero, w, [], { seed: 8, trials: 30_000 }).equity).not.toBe(a.equity);
  });

  it("removes dead cards from the range and the deck", () => {
    const r = equityVsRange(hero, w, [], { dead: cards("As"), trials: 20_000 });
    expect(r.combos).toBe(4);
  });
});

describe("startEquityVsRange (exact)", () => {
  it("steps over outer runouts and gives the one-shot result; result() throws before done", () => {
    const hero = hand("AsKs"), board = cards("Ts9s2c"), w = randomWeights(2);
    const run = startEquityVsRange(hero, w, board);
    expect(() => run.result()).toThrow(/done/);
    let calls = 0;
    while (!run.step(100)) calls++;
    expect(calls).toBe(10); // 1,081 (turn, river) pairs in steps of 100
    expect(run.result()).toEqual(equityVsRange(hero, w, board));
  });
});

describe("comboSampler", () => {
  it("draws combos in proportion to weight", () => {
    const w = weightsOf([["AsKs", 1], ["QcQd", 2], ["7s6s", 7]]);
    const s = comboSampler(w);
    const rng = createRng(1);
    const counts = new Map<number, number>();
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      const j = rng.int(s.combos.length);
      const c = rng.next() < s.prob[j] ? s.combos[j] : s.combos[s.alias[j]];
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const [k, p] of [["AsKs", 0.1], ["QcQd", 0.2], ["7s6s", 0.7]] as const) {
      expect(Math.abs((counts.get(combo(k)) ?? 0) / N - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N));
    }
  });
});

it("flop exact vs a full range stays fast under Vitest", () => {
  const w = randomWeights(4);
  equityVsRange(hand("AsKs"), w, cards("Ts9s2c"));
  // Best of three, so a burst of load from other test files doesn't fail the 150 ms target.
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    equityVsRange(hand("AsKs"), w, cards("Ts9s2c"));
    best = Math.min(best, performance.now() - t0);
  }
  expect(best).toBeLessThan(150);
});
