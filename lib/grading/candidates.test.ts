import { describe, expect, it } from "vitest";
import { applyAction, createHand, legalActions, potTotal, type Action, type LegalActions } from "../engine/engine";
import { TAG } from "../bots/personas";
import { publicHistory, replay } from "../bots/view";
import { candidates, candidatesAt, describeAction, formatBb } from "./candidates";
import { stateFromHistory, streetRaises } from "./state";
import { scenario } from "./test-helpers";

const la = (over: Partial<LegalActions>): LegalActions => ({
  seat: 0, street: "flop", toCall: 0, callAmount: 0, canFold: false, canCheck: true, canCall: false,
  canRaise: true, minRaiseTo: 100, maxRaiseTo: 9000, isBet: true, ...over,
});
const labels = (xs: { label: string }[]) => xs.map((x) => x.label);

describe("candidates", () => {
  it("first bet of a street: check, 33/66/100% of the pot, all-in; no fold when checking is free", () => {
    const c = candidates(la({}), 1000, 0, 100);
    expect(labels(c)).toEqual(["Check", "Bet 33% (3.3 bb)", "Bet 66% (6.6 bb)", "Bet 100% (10 bb)", "All-in (90 bb)"]);
    expect(c.map((x) => x.kind)).toEqual(["check", "bet", "bet", "bet", "allin"]);
    expect(c[1].action).toEqual({ type: "raise", to: 330 });
  });

  it("facing a bet: fold, call, min-raise, pot-size raise (call, then raise the pot), all-in", () => {
    // Pot 1000 before a 500 bet: pot 1500, toCall 500; pot raise = 500 + 1500 + 500 = 2500.
    const c = candidates(la({ toCall: 500, callAmount: 500, canFold: true, canCheck: false, canCall: true, minRaiseTo: 1000, isBet: false }), 1500, 500, 100);
    expect(labels(c)).toEqual(["Fold", "Call (5 bb)", "Raise to 10 bb", "Raise to 25 bb", "All-in (90 bb)"]);
    expect(c.map((x) => x.action)).toEqual([
      { type: "fold" }, { type: "call" }, { type: "raise", to: 1000 }, { type: "raise", to: 2500 }, { type: "raise", to: 9000 },
    ]);
  });

  it("clamps to [minRaiseTo, maxRaiseTo], rounds, dedupes", () => {
    // Tiny pot: 33% is below the min bet; big sizes reach the all-in.
    const c = candidates(la({ minRaiseTo: 100, maxRaiseTo: 400 }), 250, 0, 100);
    expect(c.map((x) => x.action)).toEqual([
      { type: "check" }, { type: "raise", to: 100 }, { type: "raise", to: 165 }, { type: "raise", to: 250 }, { type: "raise", to: 400 },
    ]);
    const short = candidates(la({ toCall: 500, callAmount: 500, canFold: true, canCheck: false, canCall: true, minRaiseTo: 700, maxRaiseTo: 700, isBet: false }), 1500, 500, 100);
    expect(labels(short)).toEqual(["Fold", "Call (5 bb)", "All-in (7 bb)"]);
    expect(labels(candidates(la({ canRaise: false, minRaiseTo: 0, maxRaiseTo: 0 }), 1000, 0, 100))).toEqual(["Check"]);
  });

  it("preflop: the blinds count as a bet; heads-up the button (small blind) acts first", () => {
    const s = createHand({ stacks: [10_000, 10_000], button: 0 }, { seed: 1 });
    expect(legalActions(s)!.seat).toBe(0);
    // SB: 50 to call into 150; min-raise to 200; pot raise to 100 + 150 + 50 = 300.
    expect(labels(candidatesAt(s))).toEqual(["Fold", "Call (0.5 bb)", "Raise to 2 bb", "Raise to 3 bb", "All-in (100 bb)"]);
    // Big blind after a limp: check (not fold), min-raise, pot raise to 100 + 200 + 0.
    const limped = applyAction(s, { type: "call" });
    expect(labels(candidatesAt(limped))).toEqual(["Check", "Raise to 2 bb", "Raise to 3 bb", "All-in (100 bb)"]);
  });

  it("describeAction labels arbitrary legal actions and rejects illegal ones", () => {
    const l = la({});
    expect(describeAction({ type: "raise", to: 450 }, l, 1000, 100)).toMatchObject({ label: "Bet 45% (4.5 bb)", kind: "bet" });
    expect(() => describeAction({ type: "fold" }, l, 1000, 100)).toThrow(/checking is free/);
    expect(() => describeAction({ type: "call" }, l, 1000, 100)).toThrow();
    expect(() => describeAction({ type: "raise", to: 50 }, l, 1000, 100)).toThrow();
    expect(() => describeAction({ type: "raise", to: 100.5 }, l, 1000, 100)).toThrow();
    expect(formatBb(333, 100)).toBe("3.3 bb");
    expect(formatBb(2400, 100)).toBe("24 bb");
  });
});

describe("state", () => {
  it("rebuilds the decision state from the public history alone", () => {
    const sc = scenario([10_000, 8_000, 12_000], 1, 0, "Ah9h", "Ks9d4c7h", [TAG, TAG, TAG], ["raise", "call", "call", "check", "bet33", "call", "call", "check"]);
    const s = sc.state;
    expect(s.street).toBe("turn");
    expect(s.board).toEqual(sc.history.board);
    expect(potTotal(s)).toBeGreaterThan(0);
    expect(legalActions(s)!.seat).toBe(0);
    // The views it produces are the ones replay rebuilds for the same history plus the next action.
    const next: Action = candidatesAt(s)[1].action;
    const h2 = { ...sc.history, actions: [...sc.history.actions, next] };
    const { decisions } = replay(h2);
    const last = decisions[decisions.length - 1].view;
    expect(last.stacks).toEqual(s.stacks);
    expect(last.bets).toEqual(s.bets);
    expect(last.committed).toEqual(s.committed);
    expect(last.folded).toEqual(s.folded);
    expect(publicHistory(stateFromHistory(h2)).actions).toHaveLength(h2.actions.length);
    expect(streetRaises(s)).toBe(0);
    expect(streetRaises(applyAction(s, { type: "raise", to: legalActions(s)!.minRaiseTo }))).toBe(1);
  });

  it("throws when the hand is over or the board does not match the actions", () => {
    const h = { stacks: [10_000, 10_000], button: 0, smallBlind: 50, bigBlind: 100, board: [], actions: [{ type: "fold" } as Action] };
    expect(() => stateFromHistory(h)).toThrow(/over/);
    expect(() => stateFromHistory({ ...h, actions: [{ type: "call" }, { type: "check" }] })).toThrow(/board/);
  });
});
