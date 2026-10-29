import { describe, expect, it } from "vitest";
import { applyAction, createHand, type Street } from "../engine/engine";
import type { HandResultPublic, PublicAction } from "../multiplayer/protocol";
import { parseCards } from "./cards";
import { exactEquity } from "./equity";
import {
  classifyVerdict,
  reviewHand,
  reviewInputFromEngine,
  reviewInputFromPublic,
  type ReviewAction,
  type ReviewInput,
} from "./hand-review";

const NAMES = { 1: "Josef", 2: "Mia" };

function input(over: Partial<ReviewInput>): ReviewInput {
  return { heroSeat: 0, names: NAMES, board: [], showdown: false, revealed: [], actions: [], pots: [], net: [], ...over };
}

const act = (seat: number, street: Street, action: ReviewAction["action"], amount = 0, allIn = false): ReviewAction => ({
  seat,
  street,
  action,
  amount,
  allIn,
});

/** A showdown between the hero (seat 0) and others, hero's net given, the last chips going in on `street`. */
function showdown(hands: string[], board: string, net: number[], street: Street, extra: Partial<ReviewInput> = {}): ReviewInput {
  const winners = net.flatMap((n, seat) => (n > 0 ? [seat] : []));
  const pot = net.reduce((a, n) => a + Math.abs(n), 0);
  return input({
    board: parseCards(board),
    showdown: true,
    revealed: hands.map((h, seat) => ({ seat, cards: parseCards(h) })),
    actions: [act(1, street, "bet", 100), act(0, street, "call", 100), ...hands.slice(2).map((_, i) => act(i + 2, street, "call", 100))],
    pots: [{ amount: pot, winners, shares: winners.map(() => pot / winners.length) }],
    net: net.map((amount, seat) => ({ seat, amount })),
    ...extra,
  });
}

const equityOf = (hands: string[], board: string) => exactEquity(hands, board).players[0].equity;

describe("reviewHand: showdown", () => {
  it("lucky win: the river flush against aces, 27% when the chips went in on the turn", () => {
    const r = reviewHand(showdown(["9h8h", "AcAd"], "2h7hJd3c4h", [1240, -1240], "turn"));
    expect(r.headline).toBe("YOU WON 1,240");
    expect(r.why).toBe("YOUR FLUSH, NINE HIGH BEAT JOSEF'S ONE PAIR, ACES");
    expect(r.shown).toEqual([
      { seat: 0, name: "YOU", cards: parseCards("9h8h"), hand: "FLUSH, NINE HIGH" },
      { seat: 1, name: "JOSEF", cards: parseCards("AcAd"), hand: "ONE PAIR, ACES" },
    ]);
    const equity = equityOf(["9h8h", "AcAd"], "2h7hJd3c");
    expect(equity).toBeCloseTo(12 / 44, 10); // 9 hearts + three other tens (7-J straight)
    expect(r.verdict).toEqual({ kind: "LUCKY_WIN", text: "LUCKY WIN: YOU HAD 27% WHEN THE CHIPS WENT IN ON THE TURN", equity, street: "turn" });
  });

  it("bad beat: aces all-in preflop lose to seven-two", () => {
    const r = reviewHand(showdown(["AsAd", "7c2h"], "7d2cKh9s3d", [-10000, 10000], "preflop"));
    expect(r.headline).toBe("YOU LOST 10,000");
    expect(r.why).toBe("JOSEF'S TWO PAIR, SEVENS AND TWOS BEAT YOUR ONE PAIR, ACES");
    expect(r.verdict!.kind).toBe("BAD_BEAT");
    expect(r.verdict!.equity).toBeCloseTo(equityOf(["AsAd", "7c2h"], ""), 12);
    expect(r.verdict!.text).toBe(`BAD BEAT: YOU HAD ${Math.round(r.verdict!.equity * 100)}% WHEN THE CHIPS WENT IN PREFLOP`);
  });

  it("cooler: set under set on the flop", () => {
    const r = reviewHand(showdown(["8s8d", "KcKd"], "Kh8h2c5d9s", [-3000, 3000], "flop"));
    expect(r.why).toBe("JOSEF'S THREE OF A KIND, KINGS BEAT YOUR THREE OF A KIND, EIGHTS");
    expect(r.verdict!.kind).toBe("COOLER");
    expect(r.verdict!.street).toBe("flop");
    expect(r.verdict!.text).toMatch(/^COOLER: YOU HAD \d+% WHEN THE CHIPS WENT IN ON THE FLOP$/);
  });

  it("coin flip: ace-king against queens preflop, lost", () => {
    const r = reviewHand(showdown(["AsKd", "QhQc"], "2c7d9hJs4c", [-500, 500], "preflop"));
    expect(r.verdict!.kind).toBe("COIN_FLIP");
    expect(r.verdict!.text).toBe(`COIN FLIP: YOU HAD ${Math.round(equityOf(["AsKd", "QhQc"], "") * 100)}% WHEN THE CHIPS WENT IN PREFLOP`);
  });

  it("as expected, ahead or behind, with the river call", () => {
    const won = reviewHand(showdown(["AsAd", "KsKd"], "2c7d9hJs4c", [200, -200], "river"));
    expect(won.verdict).toMatchObject({ kind: "AHEAD", equity: 1, text: "AS EXPECTED: YOU WERE AHEAD (100%) WHEN THE CHIPS WENT IN ON THE RIVER" });
    const lost = reviewHand(showdown(["KsKd", "AsAd"], "2c7d9hJs4c", [-200, 200], "river"));
    expect(lost.verdict).toMatchObject({
      kind: "BEHIND",
      equity: 0,
      text: "AS EXPECTED: THEY WERE AHEAD (YOU HAD 0%) WHEN THE CHIPS WENT IN ON THE RIVER",
    });
  });

  it("measures equity on the street of the last bet or call, not the last street", () => {
    const actions = [act(1, "flop", "bet", 100), act(0, "flop", "call", 100), act(1, "turn", "check"), act(0, "turn", "check"), act(1, "river", "check"), act(0, "river", "check")];
    const r = reviewHand(showdown(["As5s", "KcKd"], "2s7sJd3c9s", [100, -100], "flop", { actions }));
    expect(r.verdict!.street).toBe("flop");
    expect(r.verdict!.equity).toBeCloseTo(equityOf(["As5s", "KcKd"], "2s7sJd"), 12);
  });

  it("a river bet that is called puts the chips in on the river", () => {
    const actions = [act(1, "preflop", "call", 50), act(0, "preflop", "check"), act(1, "flop", "check"), act(0, "flop", "check"), act(1, "river", "bet", 300), act(0, "river", "call", 300)];
    const r = reviewHand(showdown(["As5s", "KcKd"], "2s7sJd3c9s", [400, -400], "river", { actions }));
    expect(r.verdict!.street).toBe("river");
    expect(r.verdict!.text).toBe("AS EXPECTED: YOU WERE AHEAD (100%) WHEN THE CHIPS WENT IN ON THE RIVER");
  });

  // Seat 0 (the hero, button, 500 behind) holds aces, seat 1 kings, seat 2 queens. Deal order: 1, 2, 0, 1, 2, 0, board.
  const threeWay = (board: string) =>
    createHand({ stacks: [500, 3000, 3000], button: 0 }, { deck: parseCards(`KsQsAsKdQdAd${board}`) });

  it("an uncalled bet after the hero is all-in does not move the street", () => {
    let s = threeWay("2c7h9dJc3h");
    s = applyAction(s, { type: "raise", to: 500 }); // hero all-in
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "check" }); // flop
    s = applyAction(s, { type: "check" });
    s = applyAction(s, { type: "raise", to: 1000 }); // turn bet, never called
    s = applyAction(s, { type: "fold" });
    const r = reviewHand(reviewInputFromEngine(s, 0, NAMES));
    expect(r.verdict!.street).toBe("preflop");
    expect(r.verdict!.equity).toBeCloseTo(equityOf(["AsAd", "KsKd"], ""), 12);
    expect(r.verdict!.text).toMatch(/PREFLOP$/);
  });

  it("a side-pot bet and call between the others after the hero is all-in does not move the street", () => {
    let s = threeWay("2c7h9dJcKh");
    s = applyAction(s, { type: "raise", to: 500 }); // hero all-in
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "raise", to: 200 }); // flop bet, side pot
    s = applyAction(s, { type: "call" });
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: "check" }); // turn, river
    const r = reviewHand(reviewInputFromEngine(s, 0, NAMES));
    expect(r.headline).toBe("YOU LOST 500");
    expect(r.verdict!.street).toBe("preflop");
    expect(r.verdict!.equity).toBeCloseTo(exactEquity(["AsAd", "KsKd", "QsQd"], "").players[0].equity, 12);
    expect(r.verdict!.text).toMatch(/PREFLOP$/);
  });

  it("a hero all-in from posting the big blind (no actions of their own) gets the preflop street", () => {
    // Button 0, small blind 1, the hero big blind at seat 2 with 100. Deal order: 1, 2, 0, 1, 2, 0, board.
    let s = createHand({ stacks: [3000, 3000, 100], button: 0 }, { deck: parseCards("KsAsQsKdAdQd2c7h9dJc3h") });
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "raise", to: 200 }); // flop bet, side pot
    s = applyAction(s, { type: "call" });
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: "check" }); // turn, river
    const inp = reviewInputFromEngine(s, 2, NAMES);
    expect(inp.actions.filter((a) => a.seat === 2)).toEqual([]);
    const r = reviewHand(inp);
    expect(r.verdict!.street).toBe("preflop");
    expect(r.verdict!.equity).toBeCloseTo(exactEquity(["AsAd", "QsQd", "KsKd"], "").players[0].equity, 12);
  });

  it("a shove matched by a raise (the raise's excess returned) puts the chips in on that street", () => {
    // Stacks [10000, 10000, 600], button 0: seat 2 shoves the flop, seat 0 raises over it, seat 1 folds.
    let s = createHand({ stacks: [10000, 10000, 600], button: 0 }, { seed: 7 });
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "check" });
    s = applyAction(s, { type: "check" }); // flop
    s = applyAction(s, { type: "raise", to: 500 }); // all-in
    s = applyAction(s, { type: "raise", to: 2000 });
    s = applyAction(s, { type: "fold" }); // 1,500 returned uncalled
    expect(s.complete).toBe(true);
    for (const hero of [0, 2]) {
      const v = reviewHand(reviewInputFromEngine(s, hero, NAMES)).verdict!;
      expect(v.street).toBe("flop");
      const other = hero === 0 ? 2 : 0;
      expect(v.equity).toBeCloseTo(exactEquity([s.holeCards[hero], s.holeCards[other]], s.board.slice(0, 3)).players[0].equity, 12);
    }
  });

  it("names the kicker when both hands read the same", () => {
    const r = reviewHand(showdown(["AsKd", "AcQh"], "Ad7c2s9h4d", [300, -300], "river"));
    expect(r.why).toBe("YOUR ONE PAIR, ACES BEAT JOSEF'S ONE PAIR, ACES ON THE KICKER");
  });

  it("multiway: names the best hand you beat and measures equity against every revealed hand", () => {
    const r = reviewHand(showdown(["AsAd", "KsKd", "QsQd"], "2c7d9hJc4h", [800, -400, -400], "flop"));
    expect(r.why).toBe("YOUR ONE PAIR, ACES BEAT JOSEF'S ONE PAIR, KINGS");
    expect(r.shown.map((s) => s.name)).toEqual(["YOU", "JOSEF", "MIA"]);
    expect(r.verdict!.equity).toBeCloseTo(exactEquity(["AsAd", "KsKd", "QsQd"], "2c7d9h").players[0].equity, 12);
    expect(r.verdict!.kind).toBe("AHEAD");
  });

  it("multiway loss: names the best hand that beat you", () => {
    const r = reviewHand(showdown(["9s9d", "KsKd", "QsQd"], "2c7d9hKc4h", [-400, 800, -400], "river"));
    expect(r.why).toBe("JOSEF'S THREE OF A KIND, KINGS BEAT YOUR THREE OF A KIND, NINES");
  });
});

describe("reviewHand: splits and side pots", () => {
  const board = "9cTdJhQs2c";
  it("split pot with dead money", () => {
    const r = reviewHand(
      showdown(["Ks3d", "Kd4c"], board, [0, 0], "river", {
        pots: [{ amount: 2100, winners: [0, 1], shares: [1050, 1050] }],
        net: [{ seat: 0, amount: 50 }, { seat: 1, amount: 50 }, { seat: 2, amount: -100 }],
      }),
    );
    expect(r.headline).toBe("SPLIT POT, +50");
    expect(r.why).toBe("YOUR STRAIGHT, KING HIGH TIES JOSEF'S STRAIGHT, KING HIGH");
    // A split is neither a win nor a loss: 50% on the river reads as a coin flip.
    expect(r.verdict!.kind).toBe("COIN_FLIP");
    expect(r.verdict!.text).toBe("COIN FLIP: YOU HAD 50% WHEN THE CHIPS WENT IN ON THE RIVER");
  });

  it("split pot that breaks even", () => {
    const r = reviewHand(
      showdown(["Ks3d", "Kd4c"], board, [0, 0], "river", {
        pots: [{ amount: 2000, winners: [0, 1], shares: [1000, 1000] }],
        net: [{ seat: 0, amount: 0 }, { seat: 1, amount: 0 }],
      }),
    );
    expect(r.headline).toBe("SPLIT POT, EVEN");
  });

  it("tied a pot but lost chips overall: the headline is a loss", () => {
    // Mia (short, all-in) takes the main pot with the ace-high straight; hero and Josef split the side pot.
    const r = reviewHand(
      showdown(["Ks3d", "Kd4c", "AhKh"], board, [0, 0, 0], "river", {
        pots: [
          { amount: 300, winners: [2], shares: [300] },
          { amount: 400, winners: [0, 1], shares: [200, 200] },
        ],
        net: [{ seat: 0, amount: -100 }, { seat: 1, amount: -100 }, { seat: 2, amount: 200 }],
      }),
    );
    expect(r.headline).toBe("YOU LOST 100");
  });

  it("side pot: lose the main pot to a short all-in, win the side pot; net decides the headline", () => {
    // Josef (all-in for 300) has aces and takes the 900 main pot; hero's kings beat Mia's queens for the 1,400 side pot.
    const r = reviewHand(
      showdown(["KcKd", "AcAd", "QcQd"], "2s7s9h4d3c", [400, 600, -1000], "preflop", {
        pots: [
          { amount: 900, winners: [1], shares: [900] },
          { amount: 1400, winners: [0], shares: [1400] },
        ],
      }),
    );
    expect(r.headline).toBe("YOU WON 400");
    expect(r.why).toBe("JOSEF'S ONE PAIR, ACES BEAT YOUR ONE PAIR, KINGS");
    const equity = exactEquity(["KcKd", "AcAd", "QcQd"], "").players[0].equity;
    expect(r.verdict!.equity).toBeCloseTo(equity, 12);
    expect(r.verdict!.kind).toBe(classifyVerdict("won", Math.round(equity * 100), false));
  });
});

describe("reviewHand: no showdown and folds", () => {
  const pots = [{ amount: 400, winners: [0], shares: [400] }];
  const net = [{ seat: 0, amount: 150 }, { seat: 1, amount: -150 }];

  it("everyone folded to your bet, raise or all-in", () => {
    const bet = reviewHand(input({ pots, net, actions: [act(0, "turn", "bet", 150), act(1, "turn", "fold")] }));
    expect(bet).toEqual({ headline: "YOU WON 150", why: "EVERYONE FOLDED TO YOUR TURN BET", shown: [], verdict: null });
    const raise = reviewHand(input({ pots, net, actions: [act(0, "preflop", "raise", 300), act(1, "preflop", "fold")] }));
    expect(raise.why).toBe("EVERYONE FOLDED TO YOUR PREFLOP RAISE");
    const allIn = reviewHand(input({ pots, net, actions: [act(0, "flop", "bet", 900, true), act(1, "flop", "fold")] }));
    expect(allIn.why).toBe("EVERYONE FOLDED TO YOUR FLOP ALL-IN");
  });

  it("a walk in the big blind", () => {
    const r = reviewHand(input({ pots, net, actions: [act(2, "preflop", "fold"), act(1, "preflop", "fold")] }));
    expect(r.why).toBe("EVERYONE FOLDED TO YOUR BIG BLIND");
  });

  it("you folded: the street, and who took the chips (seat label when unnamed)", () => {
    const r = reviewHand(
      input({
        names: {},
        actions: [act(1, "flop", "bet", 200), act(0, "flop", "fold")],
        pots: [{ amount: 400, winners: [1], shares: [400] }],
        net: [{ seat: 0, amount: -100 }, { seat: 1, amount: 100 }],
      }),
    );
    expect(r).toEqual({ headline: "YOU FOLDED ON THE FLOP", why: "YOU FOLDED ON THE FLOP; S2 TOOK 400", shown: [], verdict: null });
    const pre = reviewHand(input({ actions: [act(0, "preflop", "fold")], pots: [{ amount: 150, winners: [1], shares: [150] }] }));
    expect(pre.why).toBe("YOU FOLDED PREFLOP; JOSEF TOOK 150");
  });

  it("you folded, then the others showed down: their hands are shown, no verdict", () => {
    const r = reviewHand(
      input({
        board: parseCards("2c7d9hJc4h"),
        showdown: true,
        revealed: [{ seat: 2, cards: parseCards("QsQd") }, { seat: 1, cards: parseCards("KsKd") }],
        actions: [act(0, "turn", "fold"), act(1, "river", "bet", 300), act(2, "river", "call", 300)],
        pots: [{ amount: 900, winners: [1], shares: [900] }],
      }),
    );
    expect(r.headline).toBe("YOU FOLDED ON THE TURN");
    expect(r.why).toBe("YOU FOLDED ON THE TURN; JOSEF TOOK 900");
    expect(r.shown.map((s) => [s.name, s.hand])).toEqual([
      ["JOSEF", "ONE PAIR, KINGS"],
      ["MIA", "ONE PAIR, QUEENS"],
    ]);
    expect(r.verdict).toBeNull();
  });
});

describe("classifyVerdict: threshold edges and precedence", () => {
  it.each([
    ["lost", 70, false, "BAD_BEAT"],
    ["lost", 69, false, "AHEAD"],
    ["lost", 100, true, "BAD_BEAT"], // BAD BEAT before COOLER
    ["lost", 69, true, "COOLER"],
    ["lost", 50, true, "COOLER"], // COOLER before COIN FLIP
    ["lost", 61, false, "AHEAD"],
    ["lost", 60, false, "COIN_FLIP"],
    ["lost", 40, false, "COIN_FLIP"],
    ["lost", 39, false, "BEHIND"],
    ["lost", 30, false, "BEHIND"],
    ["won", 30, false, "LUCKY_WIN"],
    ["won", 0, true, "LUCKY_WIN"],
    ["won", 31, false, "BEHIND"],
    ["won", 39, false, "BEHIND"],
    ["won", 40, false, "COIN_FLIP"],
    ["won", 60, false, "COIN_FLIP"],
    ["won", 61, false, "AHEAD"],
    ["won", 70, true, "AHEAD"],
    ["split", 20, false, "BEHIND"], // no LUCKY WIN on a split
    ["split", 80, true, "AHEAD"], // no BAD BEAT or COOLER on a split
    ["split", 50, false, "COIN_FLIP"],
  ] as const)("%s at %i%% (trips+ %s) is %s", (outcome, pct, trips, kind) => {
    expect(classifyVerdict(outcome, pct, trips)).toBe(kind);
  });
});

describe("adapters", () => {
  it("builds the input from a finished solo engine hand", () => {
    // Heads-up, button (seat 0, the hero) posts the small blind and acts first. Deal: seat 1, seat 0, seat 1, seat 0, board.
    let s = createHand({ stacks: [1000, 1000], button: 0 }, { deck: parseCards("KcAsKdAd2c7d9hJs4c") });
    s = applyAction(s, { type: "raise", to: 1000 });
    s = applyAction(s, { type: "call" });
    const inp = reviewInputFromEngine(s, 0, { 1: "Josef" });
    expect(inp.revealed.map((r) => r.seat).sort()).toEqual([0, 1]);
    const r = reviewHand(inp);
    expect(r.headline).toBe("YOU WON 1,000");
    expect(r.why).toBe("YOUR ONE PAIR, ACES BEAT JOSEF'S ONE PAIR, KINGS");
    expect(r.verdict!.street).toBe("preflop");
    expect(r.verdict!.equity).toBeCloseTo(equityOf(["AsAd", "KcKd"], ""), 12);
  });

  it("refuses a solo hand that is not over", () => {
    const s = createHand({ stacks: [1000, 1000], button: 0 }, { seed: 1 });
    expect(() => reviewInputFromEngine(s, 0, {})).toThrow();
  });

  it("builds the input from a friends table result and its public actions", () => {
    const result: HandResultPublic = {
      handNo: 7,
      board: ["2h", "7h", "Jd", "3c", "4h"],
      showdown: true,
      pots: [{ amount: 2480, winners: [3], shares: [2480] }],
      net: [{ seat: 3, amount: 1240 }, { seat: 5, amount: -1240 }],
      revealed: [
        { seat: 5, cards: ["Ac", "Ad"], category: "PAIR" },
        { seat: 3, cards: ["9h", "8h"], category: "FLUSH" },
      ],
    };
    const actions: PublicAction[] = [
      { seat: 5, street: "turn", action: "bet", amount: 1240, to: 1240, allIn: true },
      { seat: 3, street: "turn", action: "call", amount: 1240, to: 1240, allIn: false },
    ];
    const r = reviewHand(reviewInputFromPublic(result, actions, 3, { 5: "Josef" }));
    expect(r.headline).toBe("YOU WON 1,240");
    expect(r.why).toBe("YOUR FLUSH, NINE HIGH BEAT JOSEF'S ONE PAIR, ACES");
    expect(r.shown.map((s) => s.seat)).toEqual([3, 5]);
    expect(r.verdict!.text).toBe("LUCKY WIN: YOU HAD 27% WHEN THE CHIPS WENT IN ON THE TURN");
  });
});
