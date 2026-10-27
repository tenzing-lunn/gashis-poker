import { describe, expect, it } from "vitest";
import { createRng } from "../poker/cards";
import { createCfrSolver } from "./cfr";
import { createGame, exploitability, profileFromMap, type GameNode } from "./game";
import {
  buildRiverGame,
  createRiverSolver,
  riverExploitability,
  riverReach,
  riverValue,
  solveRiver,
  uniformRiverProfile,
  type RiverGame,
  type RiverProfile,
  type RiverSpot,
} from "./river";

const base = (over: Partial<RiverSpot>): RiverSpot => ({
  board: "Ks9d6c3h2s",
  oopRange: "QQ",
  ipRange: "KK, JT",
  pot: 10,
  stack: 100,
  oopBetSizes: [],
  ipBetSizes: [1],
  raiseSizes: [],
  allIn: false,
  maxRaises: 0,
  ...over,
});

/** The decision node reached by following action labels (e.g. ["Check", "Bet 5"]) from the root. */
function nodeAt(game: RiverGame, path: string[]): number {
  let v = 0;
  for (const label of path) {
    const nd = game.nodes[v];
    if (nd.kind !== "decision") throw new Error("not a decision node");
    const a = nd.actions.findIndex((x) => x.label === label);
    if (a < 0) throw new Error(`no action ${label} at node ${v}: ${nd.actions.map((x) => x.label).join(", ")}`);
    v = nd.children[a];
  }
  return v;
}

/** Reach-weighted frequency of action `a` at node v over the acting player's combos selected by `pick`. */
function freq(game: RiverGame, profile: RiverProfile, v: number, a: number, pick: (i: number) => boolean = () => true): number {
  const nd = game.nodes[v];
  if (nd.kind !== "decision") throw new Error("not a decision node");
  const reach = riverReach(game, profile)[nd.player][v];
  const n = game.ranges[nd.player].combos.length;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    if (!pick(i)) continue;
    num += reach[i] * profile[v][a * n + i];
    den += reach[i];
  }
  return num / den;
}

// -------------------------------------------------------------------------------------------------
// (a) Polarized range vs a bluff-catcher, on a real board

describe("polarized vs bluff-catcher (clairvoyance game) on Ks9d6c3h2s", () => {
  // IP: KK = top set (3 combos once the Ks is on the board) and JT = jack-high air (16 combos; JsTs has
  // only four spades, no flush). OOP: QQ (6 combos) beats every JT and loses to every KK. The ranges share
  // no rank, so no OOP combo blocks an IP combo and every pair is compatible. OOP has no bet option.
  for (const f of [0.5, 1, 2]) {
    it(`bet = ${f} x pot: IP bluffs B/(P+2B) of its bets, OOP calls P/(P+B)`, () => {
      const game = buildRiverGame(base({ ipBetSizes: [f] }));
      const P = game.pot, B = f * P;
      const ip = game.ranges[1];
      const isValue = (j: number) => ip.value[j] > game.ranges[0].value[0];
      const V = Array.from(ip.combos.keys()).filter(isValue).length;
      const A = ip.combos.length - V;
      expect([V, A, game.ranges[0].combos.length, game.pairs]).toEqual([3, 16, 6, 6 * 19]);

      const { solver, report } = solveRiver(game, { targetPct: 1e-3, maxIterations: 30_000 });
      const avg = solver.averageStrategy();
      const ipNode = nodeAt(game, ["Check"]);
      const oopNode = nodeAt(game, ["Check", `Bet ${B}`]);
      const betA = 1, callA = 1;

      // Expected, from the actual combo counts: IP bets all V value combos and b = V B / (P + B) air combos.
      const bluffCombos = (V * B) / (P + B);
      const expectedBluffShare = B / (P + 2 * B);
      const expectedCall = P / (P + B);
      const valueBet = freq(game, avg, ipNode, betA, isValue);
      const airBet = freq(game, avg, ipNode, betA, (j) => !isValue(j));
      const bluffShare = (A * airBet) / (A * airBet + V * valueBet);
      const call = freq(game, avg, oopNode, callA);
      // OOP is indifferent, so its pot share is what it gets by always folding: P x P(IP checks).
      const expectedOopShare = (P * (A - bluffCombos)) / (V + A);

      console.log(
        `  B=${B}: bluff share ${bluffShare.toFixed(5)} (expected ${expectedBluffShare.toFixed(5)}), OOP call ${call.toFixed(5)} (expected ${expectedCall.toFixed(5)}), ` +
          `air bet ${airBet.toFixed(5)} (expected ${(bluffCombos / A).toFixed(5)}), value bet ${valueBet.toFixed(5)}, OOP pot share ${report.potShare[0].toFixed(5)} ` +
          `(expected ${expectedOopShare.toFixed(5)}), expl ${report.exploitabilityPct.toExponential(2)}% pot after ${report.iterations} it`,
      );
      expect(report.exploitabilityPct).toBeLessThan(1e-3);
      expect(valueBet).toBeGreaterThan(0.9999);
      expect(bluffShare).toBeCloseTo(expectedBluffShare, 3);
      expect(airBet).toBeCloseTo(bluffCombos / A, 3);
      expect(call).toBeCloseTo(expectedCall, 3);
      expect(report.potShare[0]).toBeCloseTo(expectedOopShare, 3);
    });
  }
});

// -------------------------------------------------------------------------------------------------
// (b) Agreement with the generic tree solver (game.ts)

/** The same game as a game.ts tree: a chance node over compatible combo pairs, then the betting tree. */
function toGameTree(game: RiverGame) {
  const half = game.pot / 2;
  const [r0, r1] = game.ranges;
  const sub = (v: number, i: number, j: number): GameNode => {
    const nd = game.nodes[v];
    if (nd.kind === "fold") return { kind: "terminal", payoff: nd.folder === 0 ? -(half + nd.committed[0]) : half + nd.committed[1] };
    if (nd.kind === "showdown") return { kind: "terminal", payoff: Math.sign(r0.value[i] - r1.value[j]) * (half + nd.committed[0]) };
    return {
      kind: "decision",
      player: nd.player,
      infoSet: `${v}:${nd.player === 0 ? i : j}`,
      actions: nd.actions.map((a) => a.label),
      children: nd.children.map((c) => sub(c, i, j)),
    };
  };
  const pairs: [number, number][] = [];
  for (let i = 0; i < r0.combos.length; i++) {
    for (let j = 0; j < r1.combos.length; j++) {
      const cards = new Set([r0.card1[i], r0.card2[i], r1.card1[j], r1.card2[j]]);
      if (cards.size === 4) pairs.push([i, j]);
    }
  }
  expect(pairs.length).toBe(game.pairs);
  return createGame({ kind: "chance", outcomes: pairs.map(([i, j]) => ({ prob: 1 / pairs.length, child: sub(0, i, j) })) });
}

function toGameProfile(game: RiverGame, g: ReturnType<typeof createGame>, profile: RiverProfile) {
  const map: Record<string, number[]> = {};
  for (const nd of game.nodes) {
    if (nd.kind !== "decision") continue;
    const n = game.ranges[nd.player].combos.length;
    for (let i = 0; i < n; i++) map[`${nd.id}:${i}`] = nd.actions.map((_, a) => profile[nd.id][a * n + i]);
  }
  // Every info set of the game.ts tree must be covered (none may silently default to uniform).
  for (const s of g.infoSets) expect(map[s.key], s.key).toBeDefined();
  return profileFromMap(g, map);
}

function randomProfile(game: RiverGame, seed: number): RiverProfile {
  const rng = createRng(seed);
  return game.nodes.map((nd) => {
    if (nd.kind !== "decision") return new Float64Array(0);
    const A = nd.actions.length, n = game.ranges[nd.player].combos.length;
    const out = new Float64Array(A * n);
    for (let i = 0; i < n; i++) {
      let t = 0;
      for (let a = 0; a < A; a++) t += out[a * n + i] = rng.next() < 0.2 ? 0 : rng.next();
      for (let a = 0; a < A; a++) out[a * n + i] = t > 0 ? out[a * n + i] / t : 1 / A;
    }
    return out;
  });
}

describe("agreement with game.ts on tiny spots", () => {
  // Overlapping cards between the ranges (Ah, Jc, Qh, Qs...) and a tie (AcQd vs AdQs), so card removal and
  // split pots are both exercised.
  const tiny = base({
    oopRange: "QhQd, AhKd, 8h7h, JcJd, AcQd",
    ipRange: "KhKc, JhTh, AhQh, QcJc, AdQs, QsQc",
    oopBetSizes: [0.75],
    ipBetSizes: [0.75],
  });
  const withRaise = { ...tiny, raiseSizes: [1], maxRaises: 1, allIn: true, stack: 25 };

  for (const [name, spot] of [["one size, no raise", tiny], ["one size, a raise and all-in", withRaise]] as const) {
    it(`${name}: same game value as CFR+ on the explicit tree`, () => {
      const game = buildRiverGame(spot);
      const g = toGameTree(game);
      const { report } = solveRiver(game, { targetPct: 1e-6, maxIterations: 20_000 });
      const cfr = createCfrSolver(g, { variant: "cfr+" });
      cfr.step(20_000);
      const ref = cfr.report();
      console.log(
        `  ${name}: ${game.ranges[0].combos.length}x${game.ranges[1].combos.length} combos, ${game.pairs} pairs, ${game.counts.total} nodes; ` +
          `river DCFR value ${report.value.toFixed(6)} (expl ${report.exploitability.toExponential(1)} bb, ${report.iterations} it), game.ts CFR+ ${ref.value.toFixed(6)} (expl ${ref.exploitability.toExponential(1)})`,
      );
      expect(report.exploitability).toBeLessThan(1e-5);
      expect(ref.exploitability).toBeLessThan(1e-4);
      expect(Math.abs(report.value - ref.value)).toBeLessThan(1e-3);
    });

    it(`${name}: exploitability of fixed profiles matches game.ts exactly`, () => {
      const game = buildRiverGame(spot);
      const g = toGameTree(game);
      const solved = solveRiver(game, { targetPct: 1e-3, maxIterations: 5000 }).solver.averageStrategy();
      for (const profile of [uniformRiverProfile(game), randomProfile(game, 1), randomProfile(game, 2), solved]) {
        const ours = riverExploitability(game, profile);
        const ref = exploitability(g, toGameProfile(game, g, profile));
        expect(ours.value).toBeCloseTo(ref.value, 12);
        expect(ours.bestResponseValues[0]).toBeCloseTo(ref.bestResponseValues[0], 12);
        expect(ours.bestResponseValues[1]).toBeCloseTo(ref.bestResponseValues[1], 12);
        expect(ours.nashConv).toBeCloseTo(ref.nashConv, 12);
        expect(ours.exploitability).toBeCloseTo(ref.exploitability, 12);
      }
    });
  }
});

// -------------------------------------------------------------------------------------------------
// (c) Convergence on realistic spots

const REALISTIC: RiverSpot = {
  board: "Ks7d2c9h4s",
  oopRange: "AK, KQ, KJ, KT, 99, 77, 22, A9s, 98s, 87s, QQ, JJ, TT, 88, A7s, 76s",
  ipRange: "AA, KK, AK, KQ, KJ, 99, 77, 44, AQs, QJs, JTs, 65s, 86s, T8s, 53s, A5s, A4s",
  pot: 10,
  stack: 100,
  oopBetSizes: [0.33, 0.75],
  ipBetSizes: [0.33, 0.75, 1.5],
  raiseSizes: [0.75],
  allIn: true,
  maxRaises: 2,
};

describe("convergence", () => {
  it("reaches exploitability < 0.3% of the pot on a ~100x100 spot with 2 raises", () => {
    const game = buildRiverGame(REALISTIC);
    const t0 = performance.now();
    const solver = createRiverSolver(game);
    const trace: [number, number][] = [];
    let r = solver.report();
    while (solver.iterations < 2000 && r.exploitabilityPct >= 0.3) {
      solver.step(25);
      r = solver.report();
      trace.push([r.iterations, r.exploitabilityPct]);
    }
    const ms = performance.now() - t0;
    console.log(
      `  ${game.ranges[0].combos.length}x${game.ranges[1].combos.length} combos, tree ${JSON.stringify(game.counts)}: ${r.exploitabilityPct.toFixed(3)}% of pot after ${r.iterations} iterations, ${ms.toFixed(0)} ms ` +
        `(trace ${trace.filter((_, k) => k % 3 === 0).map(([it, e]) => `${it}:${e.toFixed(2)}%`).join(" ")})`,
    );
    expect(r.exploitabilityPct).toBeLessThan(0.3);
    expect(r.iterations).toBeLessThanOrEqual(1000);
    expect(ms).toBeLessThan(5000);
    // Exploitability falls by at least 10x between iteration 25 and the end.
    expect(trace[trace.length - 1][1]).toBeLessThan(trace[0][1] / 10);
  });

  it("reaches < 0.3% of the pot with every possible hand on both sides (1081 x 1081 combos)", () => {
    const any = "22+, A2+, K2+, Q2+, J2+, T2+, 92+, 82+, 72+, 62+, 52+, 42+, 32";
    const game = buildRiverGame({ ...REALISTIC, oopRange: any, ipRange: any, oopBetSizes: [0.5, 1], ipBetSizes: [0.5, 1], raiseSizes: [1], maxRaises: 1 });
    expect(game.ranges[0].combos.length).toBe(1081);
    const t0 = performance.now();
    const { report } = solveRiver(game, { targetPct: 0.3, maxIterations: 1000, checkEvery: 25 });
    const ms = performance.now() - t0;
    console.log(`  full ranges: ${report.exploitabilityPct.toFixed(3)}% of pot after ${report.iterations} iterations, ${ms.toFixed(0)} ms`);
    expect(report.exploitabilityPct).toBeLessThan(0.3);
    expect(ms).toBeLessThan(10_000);
  });
});

// -------------------------------------------------------------------------------------------------
// (d) Sanity

describe("sanity", () => {
  const game = buildRiverGame(REALISTIC);
  const { solver, report } = solveRiver(game, { targetPct: 0.1, maxIterations: 3000 });
  const avg = solver.averageStrategy();

  it("chips are conserved: zero-sum values from both sides, pot shares add up to the pot", () => {
    for (const profile of [avg, uniformRiverProfile(game), randomProfile(game, 7)]) {
      const v0 = riverValue(game, profile, 0), v1 = riverValue(game, profile, 1);
      expect(v0 + v1).toBeCloseTo(0, 10);
      const r = riverExploitability(game, profile);
      expect(r.value).toBeCloseTo(v0, 12);
      expect(r.potShare[0] + r.potShare[1]).toBeCloseTo(game.pot, 12);
      expect(r.nashConv).toBeGreaterThanOrEqual(-1e-12);
      // A best responder never does worse than the profile itself.
      expect(r.bestResponseValues[0]).toBeGreaterThanOrEqual(v0 - 1e-12);
      expect(r.bestResponseValues[1]).toBeGreaterThanOrEqual(v1 - 1e-12);
    }
    // Shares are within [0, pot + stack] for each player: nobody wins more than the pot plus a full stack.
    expect(report.potShare[0]).toBeGreaterThan(0);
    expect(report.potShare[0]).toBeLessThan(game.pot);
  });

  it("average and current strategies are probability distributions for every combo at every node", () => {
    for (const profile of [avg, solver.currentStrategy()]) {
      for (const nd of game.nodes) {
        if (nd.kind !== "decision") {
          expect(profile[nd.id].length).toBe(0);
          continue;
        }
        const A = nd.actions.length, n = game.ranges[nd.player].combos.length;
        for (let i = 0; i < n; i++) {
          let t = 0;
          for (let a = 0; a < A; a++) {
            const x = profile[nd.id][a * n + i];
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(1);
            t += x;
          }
          expect(t).toBeCloseTo(1, 12);
        }
      }
    }
  });

  it("the nuts never folds", () => {
    // Ks7d2c9h4s allows no straight or flush, so the nuts is top set (KK, in IP's range). Generally: take
    // each player's best combos; if they beat or tie everything the opponent can hold, they must not fold.
    let checked = 0;
    for (const p of [0, 1] as const) {
      const me = game.ranges[p], them = game.ranges[1 - p];
      const best = Math.max(...me.value), oppBest = Math.max(...them.value);
      if (best < oppBest) continue;
      const nuts = Array.from(me.value.keys()).filter((i) => me.value[i] === best);
      for (const nd of game.nodes) {
        if (nd.kind !== "decision" || nd.player !== p) continue;
        const fold = nd.actions.findIndex((a) => a.kind === "fold");
        if (fold < 0) continue;
        const n = me.combos.length;
        for (const i of nuts) {
          expect(avg[nd.id][fold * n + i]).toBeLessThan(1e-3);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("builds the expected betting tree", () => {
    const simple = buildRiverGame(base({ oopRange: "QQ", oopBetSizes: [0.5], ipBetSizes: [0.5] }));
    // OOP: check / bet 5. After check, IP: check (showdown) / bet 5 -> OOP fold / call. After the bet, IP fold / call.
    expect(simple.counts).toMatchObject({ decision: 4, oopDecision: 2, ipDecision: 2, fold: 2, showdown: 3, total: 9 });

    // A size bigger than the stack becomes all-in and merges with the all-in option.
    const short = buildRiverGame(base({ oopBetSizes: [0.75, 2], ipBetSizes: [], stack: 6, allIn: true }));
    const root = short.nodes[0];
    expect(root.kind === "decision" && root.actions.map((a) => a.label)).toEqual(["Check", "All-in 6"]);

    // Raises: pot-sized raise over a 5 bb bet into 10 = call 5, then add 20 -> raise to 25. Min-raise floor: a
    // tiny raise size is lifted to at least the previous increment (raise to 10). Raise cap 1: no re-raise.
    const raised = buildRiverGame(base({ oopBetSizes: [0.5], ipBetSizes: [], raiseSizes: [0.01, 1], maxRaises: 1 }));
    const ipFacing = raised.nodes[nodeAt(raised, ["Bet 5"])];
    expect(ipFacing.kind === "decision" && ipFacing.actions.map((a) => a.label)).toEqual(["Fold", "Call 5", "Raise to 10", "Raise to 25"]);
    const oopFacing = raised.nodes[nodeAt(raised, ["Bet 5", "Raise to 25"])];
    expect(oopFacing.kind === "decision" && oopFacing.actions.map((a) => a.label)).toEqual(["Fold", "Call 20"]);

    // Facing an all-in there is nothing to raise.
    const shove = buildRiverGame(base({ oopBetSizes: [], ipBetSizes: [], allIn: true, maxRaises: 2, raiseSizes: [1], stack: 30 }));
    const facingShove = shove.nodes[nodeAt(shove, ["All-in 30"])];
    expect(facingShove.kind === "decision" && facingShove.actions.map((a) => a.label)).toEqual(["Fold", "Call 30"]);
  });

  it("rejects bad input with clear errors", () => {
    expect(() => buildRiverGame(base({ board: "Ks7d2c9h" }))).toThrow(/exactly 5 cards/);
    expect(() => buildRiverGame(base({ board: "Ks7d2c9hKs" }))).toThrow(/Duplicate card Ks/);
    expect(() => buildRiverGame(base({ board: "Ks7d2c9hXx" }))).toThrow(/Board/);
    expect(() => buildRiverGame(base({ oopRange: "" }))).toThrow(/OOP range is empty/);
    expect(() => buildRiverGame(base({ ipRange: "KsKd" }))).toThrow(/IP range is empty once combos that use a board card are removed/);
    expect(() => buildRiverGame(base({ oopRange: "QQ, TKs" }))).toThrow(/OOP range: .*higher rank first/);
    expect(() => buildRiverGame(base({ oopRange: "AhKh", ipRange: "AhKd" }))).toThrow(/no card-disjoint combo pairs/);
    expect(() => buildRiverGame(base({ pot: 0 }))).toThrow(/Pot/);
    expect(() => buildRiverGame(base({ stack: -1 }))).toThrow(/Stack/);
    expect(() => buildRiverGame(base({ ipBetSizes: [0] }))).toThrow(/IP bet sizes/);
    expect(() => buildRiverGame(base({ maxRaises: 1.5 }))).toThrow(/Max raises/);
    const any = "22+, A2+, K2+, Q2+, J2+, T2+, 92+, 82+, 72+, 62+, 52+, 42+, 32";
    expect(() =>
      buildRiverGame(base({ oopRange: any, ipRange: any, stack: 1000, oopBetSizes: [0.25, 0.5, 1, 2], ipBetSizes: [0.25, 0.5, 1, 2], raiseSizes: [0.5, 1, 2, 3], allIn: true, maxRaises: 3 })),
    ).toThrow(/Spot too large/);
  });
});
