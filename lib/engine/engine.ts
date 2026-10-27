// No-limit hold'em hand as a pure state machine. See README.md for the rules and conventions.
//
//   const s0 = createHand({ stacks: [10000, 10000, 10000], button: 0 }, { seed: 7 });
//   const la = legalActions(s0);              // who acts and what they may do
//   const s1 = applyAction(s0, { type: "raise", to: 300 });
//
// States are plain objects and arrays (JSON-serializable). applyAction never mutates its input.
// Seats are 0..n-1 clockwise; all chip amounts are integers; bet/raise amounts are "raise to" totals
// for the current street.

import { assertDistinct, createRng, FULL_DECK, shuffle, type Card } from "../poker/cards";
import { evaluate } from "../poker/evaluator";
import { awardPots, buildPots, type Pot, type PotAward } from "./pots";

export type Street = "preflop" | "flop" | "turn" | "river";
export const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];

export const DEFAULT_SMALL_BLIND = 50;
export const DEFAULT_BIG_BLIND = 100;
export const DEFAULT_STACK = 10_000;
export const MIN_SEATS = 2;
export const MAX_SEATS = 9;

export interface TableConfig {
  /** Starting stack of each seat, clockwise. 2-9 seats, every stack a positive integer. */
  stacks: readonly number[];
  /** Button seat. Heads-up the button posts the small blind. */
  button: number;
  smallBlind?: number;
  bigBlind?: number;
}

/** Where the cards come from: a seeded shuffle, or an explicit dealing order (see README.md). */
export type DealSpec = { seed: number } | { deck: readonly Card[] };

export type Action = { type: "fold" } | { type: "check" } | { type: "call" } | { type: "raise"; to: number };

export type ActionKind = "fold" | "check" | "call" | "bet" | "raise";

export type HandEvent =
  | { type: "blind"; seat: number; blind: "small" | "big"; amount: number; allIn: boolean }
  | {
      type: "action";
      seat: number;
      street: Street;
      /** "bet" is the first bet of a street, "raise" any later one (the preflop blinds count as a bet). */
      action: ActionKind;
      /** Chips moved from the stack into the pot by this action. */
      amount: number;
      /** The seat's total bet on this street after the action. */
      to: number;
      allIn: boolean;
      /** Situation just before the action, for hand histories and per-decision grading. */
      board: Card[];
      potBefore: number;
      toCall: number;
      stackBefore: number;
    }
  | { type: "uncalled"; seat: number; street: Street; amount: number }
  | { type: "deal"; street: Street; cards: Card[]; board: Card[] }
  | { type: "showdown"; seat: number; cards: Card[]; value: number }
  | { type: "award"; pot: number; amount: number; eligible: number[]; winners: number[]; shares: number[] };

export interface HandResult {
  /** True when two or more players reached showdown, false when everyone else folded. */
  showdown: boolean;
  pots: PotAward[];
  /** Chips each seat collected from the pots (uncalled bets returned are not counted). */
  won: number[];
  finalStacks: number[];
  /** finalStacks - startingStacks. Sums to zero. */
  net: number[];
  /** Evaluator value (1..7462, higher wins) of each seat that went to showdown, else null. */
  values: (number | null)[];
}

export interface HandState {
  seatCount: number;
  button: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  smallBlind: number;
  bigBlind: number;
  startingStacks: number[];
  /** The whole dealing order. Hidden information: the undealt board is in here. */
  deck: Card[];
  holeCards: Card[][];
  board: Card[];
  street: Street;
  /** Chips behind, per seat. Once the hand is complete these are the final stacks. */
  stacks: number[];
  /** Chips bet on the current street, per seat. */
  bets: number[];
  /** Chips put in this hand (including `bets`, minus uncalled bets returned), per seat. Kept after the hand. */
  committed: number[];
  folded: boolean[];
  /** Whether each seat has acted voluntarily on this street (posting a blind does not count). */
  acted: boolean[];
  /** Seats still due to act this street, in order; toAct[0] is on the clock. Empty once the hand is over. */
  toAct: number[];
  /** Largest bet or raise increment made on this street (0 before any). The min-raise is max(this, big blind). */
  maxIncrement: number;
  complete: boolean;
  events: HandEvent[];
  result: HandResult | null;
}

export interface LegalActions {
  seat: number;
  street: Street;
  /** Chips needed to match the biggest bet (may exceed the stack). */
  toCall: number;
  /** Chips a call actually adds: min(toCall, stack). */
  callAmount: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  /** Smallest legal raise-to total (the all-in total if that is smaller than a full raise). 0 if !canRaise. */
  minRaiseTo: number;
  /** Largest legal raise-to total: the all-in. 0 if !canRaise. */
  maxRaiseTo: number;
  /** True if a raise here is the first bet of the street. */
  isBet: boolean;
}

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalActionError";
  }
}

// ---------------------------------------------------------------------------
// Creating a hand

export function createHand(config: TableConfig, deal: DealSpec): HandState {
  const { stacks, button } = config;
  const smallBlind = config.smallBlind ?? DEFAULT_SMALL_BLIND;
  const bigBlind = config.bigBlind ?? DEFAULT_BIG_BLIND;
  const n = stacks.length;
  if (!Array.isArray(stacks) || n < MIN_SEATS || n > MAX_SEATS) {
    throw new Error(`A hand needs ${MIN_SEATS}-${MAX_SEATS} seats, got ${n}`);
  }
  for (const s of stacks) if (!isPositiveInt(s)) throw new Error(`Stacks must be positive integers, got ${s}`);
  if (!Number.isInteger(button) || button < 0 || button >= n) throw new Error(`Invalid button seat ${button}`);
  if (!isPositiveInt(smallBlind) || !isPositiveInt(bigBlind) || smallBlind > bigBlind) {
    throw new Error(`Blinds must be integers with 1 <= small blind <= big blind, got ${smallBlind}/${bigBlind}`);
  }

  let deck: Card[];
  if ("deck" in deal) {
    deck = deal.deck.slice();
    assertDistinct(deck);
    if (deck.length < 2 * n + 5) throw new Error(`The deck needs at least ${2 * n + 5} cards for ${n} seats`);
  } else {
    deck = shuffle(FULL_DECK.slice(), createRng(deal.seed));
  }

  // Card j < 2n goes to the (j mod n)-th seat clockwise from the button's left, one card at a time.
  const holeCards: Card[][] = Array.from({ length: n }, () => []);
  for (let j = 0; j < 2 * n; j++) holeCards[(button + 1 + (j % n)) % n].push(deck[j]);

  const smallBlindSeat = n === 2 ? button : (button + 1) % n;
  const bigBlindSeat = (smallBlindSeat + 1) % n;
  const s: HandState = {
    seatCount: n,
    button,
    smallBlindSeat,
    bigBlindSeat,
    smallBlind,
    bigBlind,
    startingStacks: stacks.slice(),
    deck,
    holeCards,
    board: [],
    street: "preflop",
    stacks: stacks.slice(),
    bets: new Array(n).fill(0),
    committed: new Array(n).fill(0),
    folded: new Array(n).fill(false),
    acted: new Array(n).fill(false),
    toAct: [],
    maxIncrement: 0,
    complete: false,
    events: [],
    result: null,
  };
  postBlind(s, smallBlindSeat, "small", smallBlind);
  postBlind(s, bigBlindSeat, "big", bigBlind);
  startBetting(s);
  return s;
}

const isPositiveInt = (x: number): boolean => Number.isInteger(x) && x > 0;

function postBlind(s: HandState, seat: number, blind: "small" | "big", size: number): void {
  const amount = Math.min(size, s.stacks[seat]);
  moveChips(s, seat, amount);
  s.events.push({ type: "blind", seat, blind, amount, allIn: s.stacks[seat] === 0 });
}

// ---------------------------------------------------------------------------
// Queries

/** The seat on the clock, or null when the hand is over. */
export const seatToAct = (s: HandState): number | null => (s.toAct.length > 0 ? s.toAct[0] : null);

/** Everything in the middle: collected pots plus outstanding bets. */
export const potTotal = (s: HandState): number => (s.complete ? 0 : s.committed.reduce((a, b) => a + b, 0));

/** Main pot first, then side pots, from chips collected on finished streets (outstanding bets not included). */
export const pots = (s: HandState): Pot[] =>
  s.complete
    ? []
    : buildPots(
        s.committed.map((c, seat) => c - s.bets[seat]),
        s.committed,
        s.folded.map((f) => !f),
      );

/** Seats clockwise starting left of the button (the small blind, or the big blind heads-up). */
export const seatsFromButton = (s: HandState): number[] =>
  Array.from({ length: s.seatCount }, (_, k) => (s.button + 1 + k) % s.seatCount);

/** What the seat on the clock may do, or null when the hand is over. */
export function legalActions(s: HandState): LegalActions | null {
  const seat = seatToAct(s);
  if (seat === null) return null;
  const maxBet = Math.max(...s.bets);
  const toCall = maxBet - s.bets[seat];
  const stack = s.stacks[seat];
  const fullRaise = Math.max(s.maxIncrement, s.bigBlind);
  // WSOP Rule 96: a player who already acted on this street may raise again only when facing at
  // least a full bet/raise (from one raise, or several short all-ins that add up to one).
  const reopened = !s.acted[seat] || toCall >= fullRaise;
  // A raise needs chips beyond the call, and someone else still able to call more.
  const someoneCanCall = s.stacks.some((st, i) => i !== seat && !s.folded[i] && st + s.bets[i] > maxBet);
  const canRaise = stack > toCall && reopened && someoneCanCall;
  const allInTo = stack + s.bets[seat];
  return {
    seat,
    street: s.street,
    toCall,
    callAmount: Math.min(toCall, stack),
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    canRaise,
    minRaiseTo: canRaise ? Math.min(allInTo, maxBet + fullRaise) : 0,
    maxRaiseTo: canRaise ? allInTo : 0,
    isBet: maxBet === 0,
  };
}

// ---------------------------------------------------------------------------
// Applying an action

export function applyAction(state: HandState, action: Action): HandState {
  const la = legalActions(state);
  if (la === null) throw new IllegalActionError("The hand is over; nobody can act");
  const seat = la.seat;
  const who = `Seat ${seat}`;
  const s = clone(state);
  const maxBet = Math.max(...s.bets);
  const before = {
    board: s.board.slice(),
    potBefore: potTotal(s),
    toCall: la.toCall,
    stackBefore: s.stacks[seat],
  };
  let kind: ActionKind;

  switch (action?.type) {
    case "fold":
      if (!la.canFold) throw new IllegalActionError(`${who} cannot fold: there is no bet to face, so check`);
      s.folded[seat] = true;
      s.toAct.shift();
      kind = "fold";
      break;
    case "check":
      if (!la.canCheck) throw new IllegalActionError(`${who} cannot check: facing ${la.toCall} to call`);
      s.toAct.shift();
      kind = "check";
      break;
    case "call":
      if (!la.canCall) throw new IllegalActionError(`${who} cannot call: there is nothing to call, so check`);
      moveChips(s, seat, la.callAmount);
      s.toAct.shift();
      kind = "call";
      break;
    case "raise": {
      const to = action.to;
      if (!la.canRaise) {
        throw new IllegalActionError(
          s.stacks[seat] <= la.toCall
            ? `${who} cannot raise: calling already puts them all-in`
            : la.toCall > 0 && s.acted[seat] && la.toCall < Math.max(s.maxIncrement, s.bigBlind)
              ? `${who} cannot raise: they already acted and face less than a full raise (Rule 96); call or fold`
              : `${who} cannot raise: no other player can call a raise`,
        );
      }
      if (!Number.isInteger(to)) throw new IllegalActionError(`Raise-to amount must be an integer, got ${to}`);
      if (to < la.minRaiseTo || to > la.maxRaiseTo) {
        throw new IllegalActionError(
          `${who} must ${la.isBet ? "bet" : "raise"} to between ${la.minRaiseTo} and ${la.maxRaiseTo}, got ${to}`,
        );
      }
      moveChips(s, seat, to - s.bets[seat]);
      s.maxIncrement = Math.max(s.maxIncrement, to - maxBet);
      // Everyone else still in with chips must respond, starting left of the raiser.
      s.toAct = [];
      for (let k = 1; k < s.seatCount; k++) {
        const i = (seat + k) % s.seatCount;
        if (!s.folded[i] && s.stacks[i] > 0) s.toAct.push(i);
      }
      kind = la.isBet ? "bet" : "raise";
      break;
    }
    default:
      throw new IllegalActionError(`Unknown action ${JSON.stringify(action)}`);
  }

  s.acted[seat] = true;
  s.events.push({
    type: "action",
    seat,
    street: s.street,
    action: kind,
    amount: before.stackBefore - s.stacks[seat],
    to: s.bets[seat],
    allIn: s.stacks[seat] === 0,
    ...before,
  });
  if (s.toAct.length === 0 || liveSeats(s).length <= 1) endStreet(s);
  return s;
}

// ---------------------------------------------------------------------------
// Internals. These mutate the fresh copy made by createHand / applyAction.

function clone(s: HandState): HandState {
  return {
    ...s, // startingStacks, deck and holeCards never change after createHand, so they are shared
    board: s.board.slice(),
    stacks: s.stacks.slice(),
    bets: s.bets.slice(),
    committed: s.committed.slice(),
    folded: s.folded.slice(),
    acted: s.acted.slice(),
    toAct: s.toAct.slice(),
    events: s.events.slice(),
  };
}

function moveChips(s: HandState, seat: number, amount: number): void {
  s.stacks[seat] -= amount;
  s.bets[seat] += amount;
  s.committed[seat] += amount;
}

const liveSeats = (s: HandState): number[] => seatsFromButton(s).filter((i) => !s.folded[i]);

/** pokerkit's effective stack: what the seat can still lose to the biggest other live stack. */
function effectiveStack(s: HandState, seat: number): number {
  const totals = liveSeats(s)
    .map((i) => s.stacks[i] + s.bets[i])
    .sort((a, b) => b - a);
  return Math.min(s.stacks[seat], Math.max(0, totals[1] - s.bets[seat]));
}

function startBetting(s: HandState): void {
  const n = s.seatCount;
  s.acted.fill(false);
  s.maxIncrement = 0;
  // Preflop: left of the big blind (heads-up: the button). Postflop: left of the button.
  const first = s.street === "preflop" ? (n === 2 ? s.button : (s.bigBlindSeat + 1) % n) : (s.button + 1) % n;
  s.toAct = [];
  for (let k = 0; k < n; k++) {
    const i = (first + k) % n;
    if (!s.folded[i] && s.stacks[i] > 0 && effectiveStack(s, i) > 0) s.toAct.push(i);
  }
  // A lone player who already matches the biggest bet has nothing to decide.
  if (s.toAct.length === 1 && s.bets[s.toAct[0]] >= Math.max(...s.bets)) s.toAct = [];
  if (s.toAct.length === 0) endStreet(s);
}

function endStreet(s: HandState): void {
  s.toAct = [];
  // Return any bet nobody matched: chips above the second-biggest bet go back.
  const sorted = s.bets.slice().sort((a, b) => b - a);
  for (let i = 0; i < s.seatCount; i++) {
    const excess = s.bets[i] - sorted[1];
    if (excess > 0) {
      moveChips(s, i, -excess);
      s.events.push({ type: "uncalled", seat: i, street: s.street, amount: excess });
    }
  }
  s.bets.fill(0);

  const live = liveSeats(s);
  if (live.length === 1) return finish(s, false);
  const streetIndex = STREETS.indexOf(s.street);
  if (streetIndex === STREETS.length - 1) return finish(s, true);
  if (live.filter((i) => s.stacks[i] > 0).length <= 1) {
    // At most one player can still bet: run the board out.
    for (let k = streetIndex + 1; k < STREETS.length; k++) dealStreet(s, STREETS[k]);
    return finish(s, true);
  }
  dealStreet(s, STREETS[streetIndex + 1]);
  startBetting(s);
}

function dealStreet(s: HandState, street: Street): void {
  const start = 2 * s.seatCount + s.board.length;
  const cards = s.deck.slice(start, start + (street === "flop" ? 3 : 1));
  s.board = [...s.board, ...cards];
  s.street = street;
  s.events.push({ type: "deal", street, cards, board: s.board.slice() });
}

function finish(s: HandState, showdown: boolean): void {
  const n = s.seatCount;
  const values: (number | null)[] = new Array(n).fill(null);
  if (showdown) {
    for (const seat of liveSeats(s)) {
      values[seat] = evaluate([...s.holeCards[seat], ...s.board]);
      s.events.push({ type: "showdown", seat, cards: s.holeCards[seat].slice(), value: values[seat]! });
    }
  }
  const awards = awardPots(
    s.committed,
    s.folded.map((f) => !f),
    values,
    seatsFromButton(s),
  );
  const won = new Array(n).fill(0);
  awards.forEach((pot, i) => {
    pot.winners.forEach((seat, k) => (won[seat] += pot.shares[k]));
    s.events.push({ type: "award", pot: i, amount: pot.amount, eligible: pot.eligible, winners: pot.winners, shares: pot.shares });
  });
  const finalStacks = s.stacks.map((st, seat) => st + won[seat]);
  s.result = {
    showdown,
    pots: awards,
    won,
    finalStacks,
    net: finalStacks.map((st, seat) => st - s.startingStacks[seat]),
    values,
  };
  s.stacks = finalStacks.slice();
  s.complete = true;
  s.toAct = [];
}
