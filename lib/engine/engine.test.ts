import { describe, expect, it } from "vitest";
import { FULL_DECK, parseCards, type Card } from "../poker/cards";
import {
  applyAction,
  createHand,
  IllegalActionError,
  legalActions,
  pots,
  potTotal,
  seatToAct,
  type Action,
  type HandState,
  type TableConfig,
} from "./engine";

const fold: Action = { type: "fold" };
const check: Action = { type: "check" };
const call: Action = { type: "call" };
const raise = (to: number): Action => ({ type: "raise", to });

/** A deck that deals `holes[seat]` to each seat and then `board`, following the engine's dealing order. */
function stackedDeck(button: number, holes: string[], board: string): Card[] {
  const n = holes.length;
  const deck: Card[] = [];
  for (let j = 0; j < 2 * n; j++) deck.push(parseCards(holes[(button + 1 + (j % n)) % n])[Math.floor(j / n)]);
  deck.push(...parseCards(board));
  for (const c of FULL_DECK) if (!deck.includes(c)) deck.push(c);
  return deck;
}

function play(state: HandState, ...actions: Action[]): HandState {
  return actions.reduce(applyAction, state);
}

const table = (stacks: number[], button: number, extra: Partial<TableConfig> = {}): TableConfig => ({
  stacks,
  button,
  ...extra,
});

describe("dealing and blinds", () => {
  it("uses the defaults: 50/100 blinds", () => {
    const s = createHand(table([10000, 10000, 10000], 0), { seed: 1 });
    expect(s.bets).toEqual([0, 50, 100]);
    expect(s.stacks).toEqual([10000, 9950, 9900]);
    expect([s.smallBlindSeat, s.bigBlindSeat]).toEqual([1, 2]);
    expect(potTotal(s)).toBe(150);
  });

  it("deals the same cards for the same seed, and from an explicit deck in dealing order", () => {
    const a = createHand(table([500, 500, 500], 1), { seed: 42 });
    const b = createHand(table([500, 500, 500], 1), { seed: 42 });
    expect(a.holeCards).toEqual(b.holeCards);
    expect(a.deck).toEqual(b.deck);
    const deck = stackedDeck(1, ["AsAh", "KsKh", "QsQh"], "2c3d4h5s6c");
    const c = createHand(table([500, 500, 500], 1), { deck });
    expect(c.holeCards).toEqual([parseCards("AsAh"), parseCards("KsKh"), parseCards("QsQh")]);
    // Seat 2 (left of the button) gets the first card.
    expect(deck[0]).toBe(parseCards("Qs")[0]);
  });

  it("rejects bad configs and decks", () => {
    expect(() => createHand(table([100], 0), { seed: 1 })).toThrow(/2-9 seats/);
    expect(() => createHand(table(new Array(10).fill(100), 0), { seed: 1 })).toThrow(/2-9 seats/);
    expect(() => createHand(table([100, 0], 0), { seed: 1 })).toThrow(/positive integers/);
    expect(() => createHand(table([100, 1.5], 0), { seed: 1 })).toThrow(/positive integers/);
    expect(() => createHand(table([100, 100], 2), { seed: 1 })).toThrow(/button/);
    expect(() => createHand(table([100, 100], 0, { smallBlind: 10, bigBlind: 5 }), { seed: 1 })).toThrow(/Blinds/);
    expect(() => createHand(table([100, 100], 0), { deck: [0, 1, 2] })).toThrow(/at least 9 cards/);
    expect(() => createHand(table([100, 100], 0), { deck: [0, 0, 1, 2, 3, 4, 5, 6, 7] })).toThrow(/Duplicate/);
  });

  it("lets a stack below a blind post what it has, all-in", () => {
    const s = createHand(table([30, 10000, 10000], 2), { seed: 3 }); // seat 0 is the small blind
    expect(s.bets).toEqual([30, 100, 0]);
    expect(s.events[0]).toEqual({ type: "blind", seat: 0, blind: "small", amount: 30, allIn: true });
    expect(seatToAct(s)).toBe(2);
    expect(legalActions(s)!.callAmount).toBe(100);
  });

  it("is serializable: a JSON round trip plays on identically", () => {
    const s = play(createHand(table([1000, 1000, 1000], 0), { seed: 9 }), raise(300), call);
    const copy = JSON.parse(JSON.stringify(s)) as HandState;
    expect(copy).toEqual(s);
    expect(play(copy, call, check, check)).toEqual(play(s, call, check, check));
  });
});

describe("action order", () => {
  it("heads-up: the button posts the small blind, acts first preflop and last on every later street", () => {
    for (const button of [0, 1]) {
      const other = 1 - button;
      let s = createHand(table([10000, 10000], button), { seed: 5 });
      expect(s.smallBlindSeat).toBe(button);
      expect(s.bets[button]).toBe(50);
      expect(s.bets[other]).toBe(100);
      expect(seatToAct(s)).toBe(button);
      s = play(s, call);
      expect(seatToAct(s)).toBe(other); // big blind's option
      expect(legalActions(s)!.canCheck).toBe(true);
      expect(legalActions(s)!.canFold).toBe(false);
      s = play(s, check);
      for (const street of ["flop", "turn", "river"]) {
        expect(s.street).toBe(street);
        expect(seatToAct(s)).toBe(other);
        s = play(s, check);
        expect(seatToAct(s)).toBe(button);
        s = play(s, check);
      }
      expect(s.complete).toBe(true);
    }
  });

  it("6-max: blinds left of the button, UTG first preflop, first live seat left of the button postflop", () => {
    let s = createHand(table(new Array(6).fill(10000), 2), { seed: 11 });
    expect([s.smallBlindSeat, s.bigBlindSeat]).toEqual([3, 4]);
    const order: number[] = [];
    while (s.street === "preflop") {
      order.push(seatToAct(s)!);
      s = play(s, seatToAct(s) === 3 ? fold : legalActions(s)!.canCheck ? check : call);
    }
    expect(order).toEqual([5, 0, 1, 2, 3, 4]);
    expect(seatToAct(s)).toBe(4); // the small blind folded, so the big blind is first postflop
    s = play(s, check);
    expect(seatToAct(s)).toBe(5);
  });
});

describe("raises and Rule 96", () => {
  // Three-handed, button seat 0: preflop order 0, 1, 2; postflop order 1, 2, 0.
  const flop = (stacks: number[]) => play(createHand(table(stacks, 0), { seed: 21 }), call, call, check);

  it("min-raise is the last full increment, at least the big blind", () => {
    let s = createHand(table([10000, 10000, 10000], 0), { seed: 2 });
    expect(legalActions(s)).toMatchObject({ canRaise: true, minRaiseTo: 200, maxRaiseTo: 10000, isBet: false });
    s = play(s, raise(350)); // increment 250
    expect(legalActions(s)).toMatchObject({ minRaiseTo: 600 });
    s = play(s, raise(600)); // increment 250 again
    expect(legalActions(s)).toMatchObject({ minRaiseTo: 850 });
    expect(() => applyAction(s, raise(849))).toThrow(/between 850 and 10000/);
  });

  it("a short all-in does not reopen the betting for players who already acted", () => {
    // A (seat 1) bets 100, B (seat 2) calls, C (seat 0, 150 behind) is all-in for 150: a 50 raise.
    let s = flop([250, 10000, 10000]);
    s = play(s, raise(100), call, raise(150));
    expect(s.stacks[0]).toBe(0);
    for (const seat of [1, 2]) {
      expect(seatToAct(s)).toBe(seat);
      expect(legalActions(s)).toMatchObject({ canRaise: false, callAmount: 50, canFold: true });
      expect(() => applyAction(s, raise(300))).toThrow(/Rule 96/);
      s = play(s, call);
    }
    expect(s.street).toBe("turn");
  });

  it("a player who has not acted yet may still raise over a short all-in, by a full increment", () => {
    // A bets 100, B (150 behind) is all-in for 150, C has not acted.
    let s = flop([10000, 10000, 250]);
    s = play(s, raise(100), raise(150));
    expect(seatToAct(s)).toBe(0);
    // The short all-in did not change the min-raise increment: 150 + 100, not 150 + 50.
    expect(legalActions(s)).toMatchObject({ canRaise: true, minRaiseTo: 250, callAmount: 150 });
    s = play(s, call);
    // A already acted and faces only the 50 extra: call or fold.
    expect(legalActions(s)).toMatchObject({ seat: 1, canRaise: false, callAmount: 50 });
  });

  it("a full raise reopens the betting even when a short all-in follows it", () => {
    // A bets 100, B raises to 300 (full), C (350 behind) goes all-in for 350.
    let s = flop([450, 10000, 10000]);
    s = play(s, raise(100), raise(300), raise(350));
    // A has not acted since B's full raise, so A may re-raise; the min increment is still 200.
    expect(legalActions(s)).toMatchObject({ seat: 1, canRaise: true, callAmount: 250, minRaiseTo: 550 });
    s = play(s, call);
    // B faces only C's 50: no raise.
    expect(legalActions(s)).toMatchObject({ seat: 2, canRaise: false, callAmount: 50 });
  });

  it("short all-ins that add up to a full raise reopen the betting (pokerkit refuses this one)", () => {
    // Five-handed, button 4: postflop order 0..4. Stacks after a limped preflop: 9900, 9900, 160, 220, 250.
    let s = createHand(table([10000, 10000, 260, 320, 350], 4), { seed: 4 });
    s = play(s, call, call, call, call, check);
    expect(s.street).toBe("flop");
    s = play(s, raise(100), call, raise(160), raise(220), raise(250));
    // Seat 0 bet 100 and now faces 150 of short raises, which add up to more than a full raise.
    expect(legalActions(s)).toMatchObject({ seat: 0, canRaise: true, callAmount: 150, minRaiseTo: 350 });
    s = play(s, call);
    // Seat 1 called 100 and also faces 150.
    expect(legalActions(s)).toMatchObject({ seat: 1, canRaise: true, callAmount: 150 });
  });

  it("preflop, a limper facing an all-in raise of less than a big blind may only call or fold", () => {
    // Four-handed, button 0: UTG is seat 3, then 0. UTG limps, the button shoves 150 total.
    let s = createHand(table([150, 10000, 10000, 10000], 0), { seed: 8 });
    s = play(s, call, raise(150));
    expect(legalActions(s)).toMatchObject({ seat: 1, canRaise: true, minRaiseTo: 250 }); // SB has not acted
    s = play(s, call);
    expect(legalActions(s)).toMatchObject({ seat: 2, canRaise: true }); // BB has not acted voluntarily
    s = play(s, call);
    expect(legalActions(s)).toMatchObject({ seat: 3, canRaise: false, callAmount: 50 });
  });

  it("after checking, a player facing an all-in bet smaller than the big blind may only call or fold", () => {
    let s = flop([130, 10000, 10000]); // seat 0 has 30 behind on the flop
    s = play(s, check, check, raise(30));
    expect(legalActions(s)).toMatchObject({ seat: 1, canRaise: false, callAmount: 30 });
  });

  it("an all-in bet below the big blind can be raised by those yet to act, to the bet plus a big blind", () => {
    let s = flop([10000, 130, 10000]); // seat 1 has 30 behind and acts first
    s = play(s, raise(30));
    expect(legalActions(s)).toMatchObject({ seat: 2, canRaise: true, minRaiseTo: 130, isBet: false });
  });

  it("nobody may raise when every other player is all-in", () => {
    let s = createHand(table([10000, 500, 10000], 0), { seed: 6 });
    s = play(s, fold, raise(500)); // the small blind shoves 500
    expect(legalActions(s)).toMatchObject({ seat: 2, canRaise: false, canCall: true, callAmount: 400 });
  });
});

describe("illegal actions", () => {
  it("throws IllegalActionError with a clear message and leaves the state untouched", () => {
    const s = createHand(table([10000, 10000, 10000], 0), { seed: 1 });
    const snapshot = JSON.stringify(s);
    const bad: [Action, RegExp][] = [
      [check, /cannot check: facing 100/],
      [raise(150), /between 200 and 10000/],
      [raise(10001), /between 200 and 10000/],
      [raise(250.5), /integer/],
      [{ type: "shove" } as unknown as Action, /Unknown action/],
    ];
    for (const [action, message] of bad) {
      expect(() => applyAction(s, action)).toThrow(IllegalActionError);
      expect(() => applyAction(s, action)).toThrow(message);
    }
    const bb = play(s, call, call);
    expect(() => applyAction(bb, fold)).toThrow(/cannot fold/);
    expect(() => applyAction(bb, call)).toThrow(/nothing to call/);
    expect(JSON.stringify(s)).toBe(snapshot);
    const done = play(s, fold, fold);
    expect(done.complete).toBe(true);
    expect(() => applyAction(done, check)).toThrow(/hand is over/);
  });
});

describe("pots and showdown", () => {
  it("returns an uncalled bet and gives the blinds to the last player standing", () => {
    const s = play(createHand(table([10000, 10000, 10000], 0), { seed: 1 }), raise(300), fold, fold);
    expect(s.complete).toBe(true);
    expect(s.events).toContainEqual({ type: "uncalled", seat: 0, street: "preflop", amount: 200 });
    expect(s.result!.showdown).toBe(false);
    expect(s.result!.pots).toEqual([{ amount: 250, eligible: [0], winners: [0], shares: [250] }]);
    expect(s.result!.finalStacks).toEqual([10150, 9950, 9900]);
    expect(s.stacks).toEqual(s.result!.finalStacks);
  });

  it("builds side pots from unequal all-ins and pays each to the best eligible hand", () => {
    // Seat 0: 1000 with AA (best), seat 1: 3000 with KK, seat 2: 5000 with QQ. Button 2.
    const deck = stackedDeck(2, ["AsAh", "KsKh", "QsQh"], "2c3d7h8s9c");
    let s = createHand(table([1000, 3000, 5000], 2), { deck });
    s = play(s, raise(5000), call, call); // seat 2 shoves, seats 0 and 1 call all-in for less
    expect(s.complete).toBe(true);
    expect(s.events).toContainEqual({ type: "uncalled", seat: 2, street: "preflop", amount: 2000 });
    expect(s.board).toEqual(parseCards("2c3d7h8s9c"));
    expect(pots({ ...s, complete: false, bets: [0, 0, 0] })).toEqual([
      { amount: 3000, eligible: [0, 1, 2] },
      { amount: 4000, eligible: [1, 2] },
    ]);
    // In the settled result seat 2 (QQ) is gone: it cannot win either pot, so it drops out first.
    expect(s.result!.pots).toEqual([
      { amount: 3000, eligible: [0, 1], winners: [0], shares: [3000] },
      { amount: 4000, eligible: [1], winners: [1], shares: [4000] },
    ]);
    expect(s.result!.finalStacks).toEqual([3000, 4000, 2000]);
    expect(s.result!.net).toEqual([2000, 1000, -3000]);
  });

  it("reports pots with eligibility while betting continues", () => {
    let s = createHand(table([300, 10000, 10000], 0), { seed: 12 });
    s = play(s, raise(300), call, call); // seat 0 all-in preflop
    expect(s.street).toBe("flop");
    expect(pots(s)).toEqual([{ amount: 900, eligible: [0, 1, 2] }]);
    s = play(s, raise(500));
    expect(pots(s)).toEqual([{ amount: 900, eligible: [0, 1, 2] }]); // outstanding bets are not in pots yet
    expect(potTotal(s)).toBe(1400);
    s = play(s, call);
    expect(s.street).toBe("turn");
    expect(pots(s)).toEqual([
      { amount: 900, eligible: [0, 1, 2] },
      { amount: 1000, eligible: [1, 2] },
    ]);
  });

  it("splits a tied pot evenly", () => {
    const deck = stackedDeck(0, ["2c3c", "2d3d"], "AsKsQsJsTs"); // the board is a royal flush
    const s = play(createHand(table([1000, 1000], 0), { deck }), call, check, check, check, check, check, check, check);
    expect(s.result!.pots).toEqual([{ amount: 200, eligible: [0, 1], winners: [1, 0], shares: [100, 100] }]);
    expect(s.result!.net).toEqual([0, 0]);
  });

  it("gives the odd chip to the first winner left of the button", () => {
    // Blinds 25/50, button 0 raises to 125, seat 1 (SB) folds, seat 2 calls: pot 275, split two ways.
    const deck = stackedDeck(0, ["2c3c", "4h5h", "2d3d"], "AsKsQsJsTs");
    const s = play(createHand(table([1000, 1000, 1000], 0, { smallBlind: 25, bigBlind: 50 }), { deck }), raise(125), fold, call);
    const end = play(s, check, check, check, check, check, check);
    expect(end.result!.pots).toEqual([{ amount: 275, eligible: [0, 2], winners: [2, 0], shares: [138, 137] }]);
  });

  it("gives the whole remainder of a three-way split to the first winner (pokerkit's rule)", () => {
    // Blinds 2/4. Seat 3 raises to 100, seat 0 calls, the small blind folds its 2, the big blind calls:
    // 302 split three ways on a board royal flush.
    const deck = stackedDeck(0, ["2c3c", "2d3d", "2h3h", "4c5d"], "AsKsQsJsTs");
    let s = createHand(table([1000, 1000, 1000, 1000], 0, { smallBlind: 2, bigBlind: 4 }), { deck });
    s = play(s, raise(100), call, fold, call);
    s = play(s, check, check, check, check, check, check, check, check, check);
    expect(s.result!.pots).toEqual([{ amount: 302, eligible: [0, 2, 3], winners: [2, 3, 0], shares: [102, 100, 100] }]);
  });

  it("drops players who cannot win any pot before splitting, so equal side pots merge (pokerkit's rule)", () => {
    // Blinds 1/2, button 4. Contributions: seat 0 (SB) folds 1, seat 1 (BB) 152 all-in, seat 2 raises to
    // 120 then folds, seat 3 152 all-in, seat 4 101 all-in with the worst hand. Seats 1 and 3 tie.
    // With seat 4 eligible the pots are 405 (seats 1, 3, 4) and 121 (seats 1, 3): split separately the odd
    // chips would give seat 1 two more than seat 3. Seat 4 cannot win anything, so it drops out, the
    // pots merge into one of 526, and the tie splits 263 / 263.
    const deck = stackedDeck(4, ["4s5c", "AdKh", "9h9s", "AhKd", "7c2d"], "As8c9dTs3h");
    let s = createHand(table([1000, 152, 1000, 152, 101], 4, { smallBlind: 1, bigBlind: 2 }), { deck });
    s = play(s, raise(120), raise(152), call, fold, call);
    expect(legalActions(s)).toMatchObject({ seat: 2, canRaise: false, callAmount: 32 });
    s = play(s, fold);
    expect(s.result!.pots).toEqual([{ amount: 526, eligible: [1, 3], winners: [1, 3], shares: [263, 263] }]);
    expect(s.result!.finalStacks).toEqual([999, 263, 880, 263, 0]);
  });

  it("runs out the board when at most one player can still bet", () => {
    let s = createHand(table([500, 10000], 0), { seed: 31 });
    s = play(s, raise(500), call);
    expect(s.complete).toBe(true);
    expect(s.board).toHaveLength(5);
    expect(s.events.filter((e) => e.type === "deal").map((e) => (e.type === "deal" ? e.street : ""))).toEqual([
      "flop",
      "turn",
      "river",
    ]);
    expect(s.result!.finalStacks.reduce((a, b) => a + b, 0)).toBe(10500);
  });

  it("logs each decision with the situation before it", () => {
    let s = createHand(table([10000, 10000], 0), { seed: 1 });
    s = play(s, raise(300), call, raise(400));
    const last = s.events[s.events.length - 1];
    expect(last).toEqual({
      type: "action",
      seat: 1,
      street: "flop",
      action: "bet",
      amount: 400,
      to: 400,
      allIn: false,
      board: s.board,
      potBefore: 600,
      toCall: 0,
      stackBefore: 9700,
    });
  });
});
