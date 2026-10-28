import { describe, expect, it } from "vitest";
import { legalActions, potTotal, type Action, type HandState } from "../engine/engine";
import { createRng, parseCards, type Card } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO, comboIndex } from "../poker/combinatorics";
import { exactEquity } from "../poker/equity";
import { STATION, TAG } from "../bots/personas";
import { strategyAt, sameAction } from "../bots/policy";
import { inferRange } from "../bots/range";
import { publicHistory, publicView } from "../bots/view";
import { candidatesAt } from "./candidates";
import { evaluateOptions, gradeWithModel, headsUpModel, particleModel, type OptionValue } from "./ev";
import { stateFromHistory } from "./state";
import { exactComboEquities, oracleEV, riverEquities, scenario, type Scenario, type Step } from "./test-helpers";
import type { ShowdownModel } from "./types";

const cards = (t: string): Card[] => parseCards(t);
const hand = (t: string): [Card, Card] => {
  const [a, b] = parseCards(t);
  return [a, b];
};

/** The n heaviest combos of a range (other weights 0), so the brute-force oracle stays small. */
function heaviest(weights: Float64Array, n: number): Float64Array {
  const top = Array.from(weights.keys()).sort((x, y) => weights[y] - weights[x]).slice(0, n);
  const w = new Float64Array(COMBO_COUNT);
  for (const c of top) w[c] = weights[c];
  return w;
}

function headsUp(sc: Scenario) {
  const bot = sc.heroSeat === 0 ? 1 : 0;
  const weights = inferRange(sc.personas[bot]!, sc.history, bot, { dead: sc.heroCards });
  return { bot, weights };
}

const particlesOf = (model: ShowdownModel) => {
  const n = model.weights.length;
  return {
    particles: Array.from({ length: n }, (_, i) => model.combos.map((col) => col[i])),
    weights: Array.from(model.weights),
  };
};

function checkAgainstOracle(sc: Scenario, model: ShowdownModel, maxRaises: number, tol = 1e-7): OptionValue[] {
  const options = candidatesAt(sc.state);
  const values = evaluateOptions({ ...sc, maxRaises }, model, options);
  const { particles, weights } = particlesOf(model);
  const input = { ...sc, seats: model.seats, particles, weights, maxRaises };
  values.forEach((v) => expect(v.ev, v.label).toBeCloseTo(oracleEV(input, v.action), -Math.log10(tol)));
  return values;
}

const find = (values: OptionValue[], pred: (a: Action) => boolean) => values.find((v) => pred(v.action))!;

// ---------------------------------------------------------------------------
// Heads-up river: hero (big blind) faces a 66% bet from the TAG button after check-check on the turn.
const BOARD = "Ks9d4c7h2s";
const riverFacingBet = () =>
  scenario([10_000, 10_000], 0, 1, "9h8h", BOARD, [TAG, TAG], [
    "raise", "call", // preflop: button opens, hero calls
    "check", "bet33", "call", // flop
    "check", "check", // turn
    "check", "bet66", // river
  ]);

describe("heads-up river (exact)", () => {
  it("calling: EV = sum_c w_c eq_c (P + A) - A; folding: 0", () => {
    const sc = riverFacingBet();
    const { bot, weights } = headsUp(sc);
    const eq = riverEquities(sc.heroCards, sc.state.board, weights);
    const model = headsUpModel(bot, weights, { equity: eq, stdErr: new Float64Array(COMBO_COUNT), exact: true });
    const values = evaluateOptions(sc, model, candidatesAt(sc.state));
    const la = legalActions(sc.state)!;
    const P = potTotal(sc.state), A = la.callAmount;
    let expected = 0;
    for (let c = 0; c < COMBO_COUNT; c++) if (weights[c] > 0) expected += weights[c] * eq[c] * (P + A);
    expected -= A;
    const call = find(values, (a) => a.type === "call");
    expect(Math.abs(call.ev - expected)).toBeLessThan(1e-9);
    expect(call.model).toBe("exact");
    expect(call.stdErr).toBe(0);
    expect(call.responses).toEqual([]);
    expect(call.foldEquity).toBe(0);
    const fold = find(values, (a) => a.type === "fold");
    expect(fold.ev).toBe(0);
    expect(fold.model).toBe("exact");
    expect(Number.isNaN(fold.showdownEquity)).toBe(true);
    expect(values.every((v) => v.model === "exact")).toBe(true);
  });

  it("raising matches the brute-force engine oracle (bot re-raises, hero best-responds)", () => {
    const sc = riverFacingBet();
    const { bot, weights } = headsUp(sc);
    const model = headsUpModel(bot, weights, { equity: riverEquities(sc.heroCards, sc.state.board, weights), stdErr: new Float64Array(COMBO_COUNT), exact: true });
    const values = checkAgainstOracle(sc, model, 4);
    for (const v of values) {
      if (v.responses.length) expect(v.responses.reduce((s, r) => s + r.prob, 0)).toBeCloseTo(1, 12);
    }
    const minRaise = values.find((v) => v.kind === "raise")!;
    expect(minRaise.responses.some((r) => r.action.type === "raise")).toBe(true); // the bot re-raises sometimes
  });

  it("betting matches a hand-written recursion with strategyAt's probabilities (short stacks: raise = all-in)", () => {
    // Hero on the button, 1,000 deep; everything checks to the river; the bot checks to the hero.
    const sc = scenario([1000, 1000], 0, 0, "Qc9c", BOARD, [TAG, TAG], ["raise", "call", "check", "check", "check", "check", "check"]);
    const { bot, weights } = headsUp(sc);
    const eq = riverEquities(sc.heroCards, sc.state.board, weights);
    const model = headsUpModel(bot, weights, { equity: eq, stdErr: new Float64Array(COMBO_COUNT), exact: true });
    const options = candidatesAt(sc.state);
    const values = evaluateOptions(sc, model, options);
    const P = potTotal(sc.state);
    const S = sc.state.stacks[0];
    expect(S).toBe(750);

    let check = 0;
    for (let c = 0; c < COMBO_COUNT; c++) if (weights[c] > 0) check += weights[c] * eq[c] * P;
    expect(Math.abs(find(values, (a) => a.type === "check").ev - check)).toBeLessThan(1e-9);

    for (const v of values) {
      if (v.action.type !== "raise") continue;
      const X = v.action.to;
      const after = applyTo(sc.state, v.action);
      const st = strategyAt(TAG, publicView(after, bot), sc.heroCards);
      const idx = (pred: (a: Action) => boolean) => st.concrete.flatMap((a, i) => (a && pred(a) ? [i] : []));
      const fold = idx((a) => a.type === "fold"), call = idx((a) => a.type === "call"), raise = idx((a) => a.type === "raise");
      if (X < S) expect(raise.length).toBeGreaterThan(0);
      let base = 0, raiseFold = 0, raiseCall = 0, pf = 0;
      for (let c = 0; c < COMBO_COUNT; c++) {
        if (!(weights[c] > 0)) continue;
        const p = (ids: number[]) => ids.reduce((s, a) => s + st.probs[c * 8 + a], 0);
        base += weights[c] * (p(fold) * P + p(call) * (eq[c] * (P + 2 * X) - X));
        pf += weights[c] * p(fold);
        // Every bot raise is the all-in to 750 (3x the bet is past 45% of the stack): hero folds or calls.
        raiseFold += weights[c] * p(raise) * -X;
        raiseCall += weights[c] * p(raise) * (eq[c] * (P + 2 * S) - S);
      }
      const expected = base + Math.max(raiseFold, raiseCall);
      expect(Math.abs(v.ev - expected), v.label).toBeLessThan(1e-9);
      expect(v.model).toBe("exact");
      if (X === S) expect(v.foldEquity).toBeCloseTo(pf, 12);
    }
  });

  it("checking first: the bot's bets and the hero's check-raises match the oracle, with and without a raise cap", () => {
    const sc = scenario([10_000, 10_000], 0, 1, "9h8h", BOARD, [TAG, TAG], ["raise", "call", "check", "bet33", "call", "check", "check"]);
    const { bot, weights } = headsUp(sc);
    const w = heaviest(weights, 40); // keeps the brute-force oracle fast
    const model = headsUpModel(bot, w, { equity: riverEquities(sc.heroCards, sc.state.board, w), stdErr: new Float64Array(COMBO_COUNT), exact: true });
    const full = checkAgainstOracle(sc, model, 4);
    const capped = checkAgainstOracle(sc, model, 1);
    // With fewer hero options deeper in the tree, a best response can only do worse or the same.
    full.forEach((v, i) => expect(capped[i].ev).toBeLessThanOrEqual(v.ev + 1e-9));
    expect(capped.some((v, i) => capped[i].ev < full[i].ev - 1e-6)).toBe(true);
  });
});

function applyTo(s: HandState, a: Action): HandState {
  return stateFromHistory({ ...publicHistory(s), actions: [...publicHistory(s).actions, a] });
}

// ---------------------------------------------------------------------------
// Multiway

/** Particles for the given bot seats: random disjoint combos avoiding the known cards, uniform weights. */
function randomParticles(known: readonly Card[], m: number, count: number, seed: number): Int16Array[] {
  const rng = createRng(seed);
  const cols = Array.from({ length: m }, () => new Int16Array(count));
  for (let i = 0; i < count; i++) {
    const used = new Set(known);
    for (let k = 0; k < m; k++) {
      let a: number, b: number;
      do {
        a = rng.int(52);
        b = rng.int(52);
      } while (a === b || used.has(a) || used.has(b));
      used.add(a).add(b);
      cols[k][i] = comboIndex(a, b);
    }
  }
  return cols;
}

describe("multiway", () => {
  // Hero on the button opens, both blinds call; flop: hero bets, both call; turn checks through; river: SB bets, BB calls.
  const threeWay = (stacks: number[], river: Step[]) =>
    scenario(stacks, 0, 0, "Ah9h", BOARD, [TAG, TAG, STATION], [
      "raise", "call", "call",
      ...(stacks[1] < 1000 ? ["check", "check", "check"] as Step[] : ["check", "check", "bet33", "call", "call"] as Step[]),
      "check", "check", "check",
      ...river,
    ]);

  it("river, 3-way: hand-built particles match the engine oracle", () => {
    const sc = threeWay([10_000, 10_000, 10_000], ["bet66", "call"]);
    const cols = randomParticles([...sc.heroCards, ...sc.state.board], 2, 6, 11);
    const model = particleModel(sc.heroCards, sc.state.board, [1, 2], cols);
    const values = checkAgainstOracle(sc, model, 4, 1e-6);
    // Calling closes the river: EV = mean_i share_i(both) * (P + A) - A.
    const P = potTotal(sc.state), A = legalActions(sc.state)!.callAmount;
    const sh = model.share(3);
    const call = find(values, (a) => a.type === "call");
    expect(call.ev).toBeCloseTo(sh.reduce((s, x) => s + x, 0) / sh.length * (P + A) - A, 9);
    expect(call.model).toBe("ev-now"); // sampled particles are never labelled exact
    expect(call.stdErr).toBeGreaterThan(0);
    expect(find(values, (a) => a.type === "fold").model).toBe("exact");
  });

  it("side pots with unequal stacks: a short all-in bot, hero raising the other bot", () => {
    const sc = threeWay([10_000, 600, 10_000], ["bet33", "call"]);
    expect(sc.state.stacks[1]).toBe(0); // the SB's bet was its all-in
    const cols = randomParticles([...sc.heroCards, ...sc.state.board], 2, 8, 5);
    const model = particleModel(sc.heroCards, sc.state.board, [1, 2], cols);
    const values = checkAgainstOracle(sc, model, 4, 1e-6);
    expect(values.filter((v) => v.action.type === "raise").length).toBeGreaterThan(1);
    // Hero raises, BB folds: hero plays the main pot against the SB only.
    const raise = values.find((v) => v.kind === "raise")!;
    expect(raise.responses.map((r) => r.action.type).sort()).toContain("fold");
  });

  it("particle shares on the turn equal exact enumeration with the other particles' cards removed", () => {
    const hero = hand("AhKd");
    const board = cards("Qs9h4h2c");
    const cols = randomParticles([...hero, ...board], 2, 5, 3);
    const model = particleModel(hero, board, [4, 7], cols);
    expect(model.exactShares).toBe(true);
    for (let i = 0; i < 5; i++) {
      const c1 = [COMBO_HI[cols[0][i]], COMBO_LO[cols[0][i]]], c2 = [COMBO_HI[cols[1][i]], COMBO_LO[cols[1][i]]];
      expect(model.share(3)[i]).toBeCloseTo(exactEquity([hero, c1, c2], board).players[0].equity, 12);
      expect(model.share(1)[i]).toBeCloseTo(exactEquity([hero, c1], board, c2).players[0].equity, 12);
      expect(model.share(2)[i]).toBeCloseTo(exactEquity([hero, c2], board, c1).players[0].equity, 12);
    }
  });

  it("sampled flop shares are seeded and unbiased", () => {
    const hero = hand("AhKd");
    const board = cards("Qs9h4h");
    const cols = randomParticles([...hero, ...board], 1, 1, 9);
    const c1 = [COMBO_HI[cols[0][0]], COMBO_LO[cols[0][0]]];
    const one = Array.from({ length: 400 }, () => cols[0][0]);
    const a = particleModel(hero, board, [1], [Int16Array.from(one)], { seed: 4 });
    const b = particleModel(hero, board, [1], [Int16Array.from(one)], { seed: 4 });
    expect(Array.from(a.share(1))).toEqual(Array.from(b.share(1)));
    const mean = a.share(1).reduce((s, x) => s + x, 0) / 400;
    const exact = exactEquity([hero, c1], board).players[0].equity;
    expect(Math.abs(mean - exact)).toBeLessThan(4 * Math.sqrt(0.25 / (400 * 32)));
  });
});

// ---------------------------------------------------------------------------
// Earlier streets: the street closing is a terminal valued by check-down equity.

describe("streets before the river", () => {
  it("turn, heads-up: street-close terminals check down over every river card (oracle), all-in is exact", () => {
    const sc = scenario([10_000, 10_000], 0, 1, "9h8h", BOARD.slice(0, 8), [TAG, TAG], ["raise", "call", "check", "bet33", "call"]);
    const { bot, weights } = headsUp(sc);
    const w = heaviest(weights, 6); // the oracle deals all 44 rivers per particle and terminal
    const model = headsUpModel(bot, w, exactComboEquities(sc.heroCards, sc.state.board, w));
    const values = checkAgainstOracle(sc, model, 2);
    expect(find(values, (a) => a.type === "check").model).toBe("ev-now");
    const allin = values.find((v) => v.kind === "allin")!;
    expect(allin.model).toBe("exact");
    expect(allin.responses.map((r) => r.action.type).sort()).toEqual(["call", "fold"]);
  });

  it("flop all-in: EV = sum_c w_c [pFold P + pCall (eq_c * 2S - stack now)], exact", () => {
    const sc = scenario([10_000, 10_000], 0, 1, "9h8h", BOARD.slice(0, 6), [TAG, TAG], ["raise", "call"]);
    const { bot, weights } = headsUp(sc);
    const eq = exactComboEquities(sc.heroCards, sc.state.board, weights);
    const model = headsUpModel(bot, weights, eq);
    const options = candidatesAt(sc.state);
    const values = evaluateOptions(sc, model, options);
    const allin = values.find((v) => v.kind === "allin")!;
    const after = applyTo(sc.state, allin.action);
    const st = strategyAt(TAG, publicView(after, bot), sc.heroCards);
    const P = potTotal(sc.state), now = sc.state.stacks[1];
    let expected = 0;
    for (let c = 0; c < COMBO_COUNT; c++) {
      if (!(weights[c] > 0)) continue;
      let pf = 0, pc = 0;
      st.concrete.forEach((a, i) => {
        if (a?.type === "fold") pf += st.probs[c * 8 + i];
        if (a?.type === "call") pc += st.probs[c * 8 + i];
      });
      expected += weights[c] * (pf * P + pc * (eq.equity[c] * 20_000 - now));
    }
    expect(Math.abs(allin.ev - expected)).toBeLessThan(1e-8);
    expect(allin.model).toBe("exact");
    expect(find(values, (a) => a.type === "check").model).toBe("ev-now");
    expect(values.filter((v) => v.kind === "bet").every((v) => v.model === "ev-now")).toBe(true);
  });

  it("preflop, heads-up: calling closes the street; MC equity errors propagate linearly", () => {
    // Hero in the big blind faces the TAG button's open.
    const sc = scenario([10_000, 10_000], 0, 1, "Td9d", "", [TAG, TAG], ["raise"]);
    const { bot, weights } = headsUp(sc);
    const rng = createRng(2);
    const equity = new Float64Array(COMBO_COUNT).fill(NaN), stdErr = new Float64Array(COMBO_COUNT);
    for (let c = 0; c < COMBO_COUNT; c++) {
      if (weights[c] > 0) {
        equity[c] = rng.next();
        stdErr[c] = 0.01 + 0.03 * rng.next();
      }
    }
    const model = headsUpModel(bot, weights, { equity, stdErr, exact: false });
    const values = evaluateOptions(sc, model, candidatesAt(sc.state));
    const la = legalActions(sc.state)!;
    const P = potTotal(sc.state), A = la.callAmount;
    let ev = 0, v = 0;
    for (let c = 0; c < COMBO_COUNT; c++) {
      if (!(weights[c] > 0)) continue;
      ev += weights[c] * equity[c] * (P + A);
      v += (weights[c] * (P + A) * stdErr[c]) ** 2;
    }
    const call = find(values, (a) => a.type === "call");
    expect(call.ev).toBeCloseTo(ev - A, 9);
    expect(call.stdErr).toBeCloseTo(Math.sqrt(v), 9);
    expect(call.model).toBe("ev-now");
    expect(call.responses).toEqual([]);

    const allin = values.find((v) => v.kind === "allin")!;
    const st = strategyAt(TAG, publicView(applyTo(sc.state, allin.action), bot), sc.heroCards);
    let e2 = 0, v2 = 0;
    for (let c = 0; c < COMBO_COUNT; c++) {
      if (!(weights[c] > 0)) continue;
      let pf = 0, pc = 0;
      st.concrete.forEach((a, i) => {
        if (a?.type === "fold") pf += st.probs[c * 8 + i];
        if (a?.type === "call") pc += st.probs[c * 8 + i];
      });
      e2 += weights[c] * (pf * P + pc * (equity[c] * 20_000 - sc.state.stacks[1]));
      v2 += (weights[c] * pc * 20_000 * stdErr[c]) ** 2;
    }
    expect(allin.ev).toBeCloseTo(e2, 8);
    expect(allin.stdErr).toBeCloseTo(Math.sqrt(v2), 8);
    expect(allin.model).toBe("ev-now"); // preflop equities are sampled
    expect(find(values, (a) => a.type === "fold")).toMatchObject({ ev: 0, stdErr: 0, model: "exact" });
    // 3-bets: the bot folds, calls or 4-bets; the hero's best response to a 4-bet is inside the EV.
    const threeBet = values.find((v) => v.kind === "raise")!;
    expect(threeBet.responses.map((r) => r.action.type)).toContain("raise");
    expect(threeBet.foldEquity).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Full grading with an injected model.

describe("gradeWithModel", () => {
  const riverBuilder = ({ seats, ranges, heroCards, board }: Parameters<Parameters<typeof gradeWithModel>[1]>[0]) =>
    headsUpModel(seats[0], ranges[0], { equity: riverEquities(heroCards, board, ranges[0]), stdErr: new Float64Array(COMBO_COUNT), exact: true });

  it("assembles the result: required equity, hero equity, blockers, tiers, chosen", () => {
    const sc = riverFacingBet();
    const odd: Action = { type: "raise", to: legalActions(sc.state)!.minRaiseTo + 7 };
    const r = gradeWithModel({ ...sc, chosen: odd }, riverBuilder);
    const la = legalActions(sc.state)!;
    expect(r.street).toBe("river");
    expect(r.pot).toBe(potTotal(sc.state));
    expect(r.toCall).toBe(la.toCall);
    expect(r.heroStreetBet).toBe(sc.state.bets[sc.heroSeat]);
    expect(r.requiredEquity).toBeCloseTo(la.toCall / (r.pot + la.toCall), 12);
    const w = r.ranges[0].weights;
    const eq = riverEquities(sc.heroCards, r.board, w);
    let he = 0;
    for (let c = 0; c < COMBO_COUNT; c++) if (w[c] > 0) he += w[c] * eq[c];
    expect(r.heroEquity).toBeCloseTo(he, 12);
    expect(r.heroEquityStdErr).toBe(0);
    expect(r.model).toBe("exact");
    expect(r.options[r.best].tier).toBe("best");
    expect(r.options[r.best].loss).toBe(0);
    expect(r.options.every((o) => o.ev <= r.options[r.best].ev)).toBe(true);
    expect(r.chosen).toBe(r.options.length - 1);
    expect(sameAction(r.options[r.chosen!].action, odd)).toBe(true);
    expect(r.options[r.chosen!].label).toMatch(/^Raise to /);
    // The best call/fold verdict agrees with pot odds: call iff equity >= required equity.
    const call = r.options.find((o) => o.action.type === "call")!;
    expect(call.ev > 0).toBe(r.heroEquity > r.requiredEquity!);
    // Blockers: unconditioned range share on the hero's cards vs a uniform range (2*45 + 1 of C(47,2)).
    expect(r.blockers[0].uniformShare).toBeCloseTo(91 / 1081, 12);
    const raw = inferRange(TAG, sc.history, 0);
    const blocked = Array.from(raw.keys()).filter((c) => sc.heroCards.includes(COMBO_HI[c]) || sc.heroCards.includes(COMBO_LO[c]));
    expect(r.blockers[0].blockedShare).toBeCloseTo(blocked.reduce((s, c) => s + raw[c], 0), 12);
    // Same inputs, same output.
    expect(gradeWithModel({ ...sc, chosen: odd }, riverBuilder)).toEqual(r);
  });

  it("rejects an illegal chosen action and a seat that is not on the clock", () => {
    const sc = riverFacingBet();
    expect(() => gradeWithModel({ ...sc, chosen: { type: "check" } }, riverBuilder)).toThrow(/not legal/);
    expect(() => gradeWithModel({ ...sc, heroSeat: 0 }, riverBuilder)).toThrow(/not on the clock/);
  });
});
