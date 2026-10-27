import { describe, expect, it } from "vitest";
import { createCfrSolver } from "./cfr";
import { bestResponse, createGame, expectedValue, exploitability, profileFromMap, uniformProfile } from "./game";
import { KUHN_VALUE, createKuhnGame, kuhnAlpha, kuhnEquilibriumProfile, toOpenSpielInfoState } from "./kuhn";

const game = createKuhnGame();

describe("Kuhn poker tree", () => {
  it("has OpenSpiel's 12 info sets, each with [pass, bet]", () => {
    const keys = game.infoSets.map((s) => s.key).sort();
    expect(keys).toEqual(["J", "Jb", "Jp", "Jpb", "K", "Kb", "Kp", "Kpb", "Q", "Qb", "Qp", "Qpb"]);
    expect(game.infoSets.map((s) => toOpenSpielInfoState(s.key)).sort()).toEqual(
      ["0", "0b", "0p", "0pb", "1", "1b", "1p", "1pb", "2", "2b", "2p", "2pb"],
    );
    for (const s of game.infoSets) {
      expect(s.actions).toEqual(["pass", "bet"]);
      expect(s.player).toBe(s.key.length % 2 === 1 ? 0 : 1);
    }
    expect(() => toOpenSpielInfoState("Ax")).toThrow();
  });

  it("rejects inconsistent info sets", () => {
    const t = { kind: "terminal", payoff: 0 } as const;
    expect(() =>
      createGame({
        kind: "chance",
        outcomes: [
          { prob: 0.5, child: { kind: "decision", player: 0, infoSet: "x", actions: ["a", "b"], children: [t, t] } },
          { prob: 0.5, child: { kind: "decision", player: 1, infoSet: "x", actions: ["a", "b"], children: [t, t] } },
        ],
      }),
    ).toThrow(/inconsistent/);
  });
});

describe("exact exploitability of known profiles", () => {
  it("the analytic equilibrium family has value -1/18 and exploitability 0", () => {
    for (const alpha of [0, 1 / 9, 0.2, 1 / 3]) {
      const r = exploitability(game, kuhnEquilibriumProfile(game, alpha));
      expect(r.value).toBeCloseTo(KUHN_VALUE, 14);
      expect(Math.abs(r.nashConv)).toBeLessThan(1e-14);
      expect(kuhnAlpha(game, kuhnEquilibriumProfile(game, alpha))).toBeCloseTo(alpha, 12);
    }
  });

  it("uniform random: NashConv 11/12, exploitability 11/24", () => {
    // Derivation (player 1 = second to act):
    // BR of player 0 vs uniform: J bets (EV -1/2), Q bets (+1/2), K checks-calls or bets (+3/2): mean 1/2.
    // BR of player 1 vs uniform: facing a bet J folds (-1), Q folds (0 = max(-1, 0)), K calls (+2);
    // after a pass J bets (-1/2), Q bets (+1/2), K bets (+3/2). Card averages -3/4, 1/4, 7/4: mean 5/12.
    // Uniform's own value to player 0 is +1/8, so NashConv = (1/2 - 1/8) + (5/12 + 1/8) = 1/2 + 5/12 = 11/12.
    const r = exploitability(game, uniformProfile(game));
    expect(r.value).toBeCloseTo(1 / 8, 14);
    expect(r.bestResponseValues[0]).toBeCloseTo(1 / 2, 14);
    expect(r.bestResponseValues[1]).toBeCloseTo(5 / 12, 14);
    expect(r.nashConv).toBeCloseTo(11 / 12, 14);
    expect(r.exploitability).toBeCloseTo(11 / 24, 14);
  });

  it("always-bet vs always-call: player 0's BR is the max over pure plans", () => {
    const allBet = profileFromMap(game, Object.fromEntries(game.infoSets.map((s) => [s.key, [0, 1]])));
    // Both always bet/call: every hand goes to a 2-chip showdown, which is zero on average.
    expect(expectedValue(game, allBet)).toBeCloseTo(0, 14);
    // Player 1 bets after a check and calls every bet. Player 0's best plan per card:
    // J: check-fold -1 (betting loses 2). Q: any showdown is +2 vs J, -2 vs K = 0 (check-fold is -1). K: +2.
    const br = bestResponse(game, allBet, 0);
    expect(br.value).toBeCloseTo((-1 + 0 + 2) / 3, 14);
  });
});

describe("CFR on Kuhn poker", () => {
  it("CFR+ reaches exploitability < 1e-4 and value -1/18 within 1e-3 in 1,500 iterations", () => {
    const solver = createCfrSolver(game, { variant: "cfr+" });
    solver.step(1500);
    const r = solver.report();
    expect(r.iterations).toBe(1500);
    expect(r.exploitability).toBeLessThan(1e-4);
    expect(Math.abs(r.value - KUHN_VALUE)).toBeLessThan(1e-3);
    // The solution sits inside Kuhn's family: player 1's strategy is unique.
    const avg = solver.averageStrategy();
    const bet = (key: string) => avg[game.infoSets.find((s) => s.key === key)!.offset + 1];
    expect(bet("Jp")).toBeCloseTo(1 / 3, 2);
    expect(bet("Qb")).toBeCloseTo(1 / 3, 2);
    expect(bet("Kb")).toBeCloseTo(1, 2);
    expect(bet("Jb")).toBeCloseTo(0, 2);
    const alpha = kuhnAlpha(game, avg);
    expect(bet("K")).toBeCloseTo(3 * alpha, 2);
    expect(bet("Qpb")).toBeCloseTo(alpha + 1 / 3, 2);
  });

  it("vanilla CFR also converges (exploitability < 0.01 by 3,000 iterations, falling)", () => {
    const solver = createCfrSolver(game, { variant: "cfr" });
    solver.step(300);
    const early = solver.report().exploitability;
    solver.step(2700);
    const r = solver.report();
    expect(r.exploitability).toBeLessThan(0.01);
    expect(r.exploitability).toBeLessThan(early);
    expect(Math.abs(r.value - KUHN_VALUE)).toBeLessThan(5e-3);
  });

  it("can be stepped in chunks with identical results", () => {
    const a = createCfrSolver(game), b = createCfrSolver(game);
    a.step(200);
    for (let i = 0; i < 20; i++) b.step(10);
    expect(b.iterations).toBe(200);
    expect(Array.from(b.averageStrategy())).toEqual(Array.from(a.averageStrategy()));
    expect(Array.from(b.currentStrategy())).toEqual(Array.from(a.currentStrategy()));
  });
});
