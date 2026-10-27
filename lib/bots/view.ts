// What a bot is allowed to see. See README.md.
//
// A PublicView is one seat's view of a hand built only from public information: stacks, bets, the
// board, positions, the public action log and (when it is that seat's turn) the legal actions. It holds
// no cards except the board. A BotView adds the seat's own two hole cards.
//
// Policies are functions of (persona, PublicView, combo), never of a HandState, so they cannot read
// `state.deck` or anyone's hole cards. The same views can be rebuilt after the fact from a
// PublicHistory (the config, the actions and the board), which is how the bots' ranges are inferred.

import { FULL_DECK, type Card } from "../poker/cards";
import {
  applyAction,
  createHand,
  legalActions,
  potTotal,
  type Action,
  type HandEvent,
  type HandState,
  type LegalActions,
  type Street,
} from "../engine/engine";

export type Position = "UTG" | "MP" | "LJ" | "HJ" | "CO" | "BTN" | "SB" | "BB";

export interface PublicView {
  /** The seat whose view this is. */
  seat: number;
  seatCount: number;
  button: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  smallBlind: number;
  bigBlind: number;
  /** Position name of every seat (heads-up: the button is "BTN" and posts the small blind). */
  positions: Position[];
  startingStacks: number[];
  stacks: number[];
  /** Chips bet on the current street, per seat. */
  bets: number[];
  /** Chips put in this hand, per seat. */
  committed: number[];
  folded: boolean[];
  board: Card[];
  street: Street;
  /** Everything in the middle: collected pots plus outstanding bets. */
  pot: number;
  /** Seat on the clock, or null once the hand is over. */
  toAct: number | null;
  /** What `seat` may do; null unless `seat` is on the clock. */
  legal: LegalActions | null;
  /**
   * The public event log. Before the hand is over it holds only blinds, actions, uncalled bets and
   * board deals; showdown events (revealed cards) appear only once the hand is complete.
   */
  events: readonly HandEvent[];
  complete: boolean;
}

export interface BotView extends PublicView {
  /** The seat's own hole cards. */
  holeCards: [Card, Card];
}

/** Position names by seat. 6-max is UTG, HJ, CO, BTN, SB, BB; 7-9 seats add LJ and MP. */
export function seatPositions(seatCount: number, button: number): Position[] {
  const n = seatCount;
  const out = new Array<Position>(n);
  out[button] = "BTN";
  if (n === 2) {
    out[(button + 1) % n] = "BB";
    return out;
  }
  out[(button + 1) % n] = "SB";
  out[(button + 2) % n] = "BB";
  const early: Position[][] = [
    [],
    ["CO"],
    ["HJ", "CO"],
    ["UTG", "HJ", "CO"],
    ["UTG", "LJ", "HJ", "CO"],
    ["UTG", "MP", "LJ", "HJ", "CO"],
    ["UTG", "MP", "MP", "LJ", "HJ", "CO"],
  ];
  early[n - 3].forEach((p, i) => (out[(button + 3 + i) % n] = p));
  return out;
}

/**
 * A seat's view of the hand. Copies only public fields (the engine never mutates a state, so the event
 * log is shared rather than copied).
 */
export function publicView(state: HandState, seat: number): PublicView {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seatCount) throw new Error(`Invalid seat ${seat}`);
  const la = legalActions(state);
  return {
    seat,
    seatCount: state.seatCount,
    button: state.button,
    smallBlindSeat: state.smallBlindSeat,
    bigBlindSeat: state.bigBlindSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    positions: seatPositions(state.seatCount, state.button),
    startingStacks: state.startingStacks.slice(),
    stacks: state.stacks.slice(),
    bets: state.bets.slice(),
    committed: state.committed.slice(),
    folded: state.folded.slice(),
    board: state.board.slice(),
    street: state.street,
    pot: potTotal(state),
    toAct: la ? la.seat : null,
    legal: la && la.seat === seat ? { ...la } : null,
    events: state.events,
    complete: state.complete,
  };
}

/** The public view plus the seat's own hole cards: everything a bot in that seat may know. */
export function botView(state: HandState, seat: number): BotView {
  const view = publicView(state, seat);
  const [a, b] = state.holeCards[seat];
  return { ...view, holeCards: [a, b] };
}

// ---------------------------------------------------------------------------
// Public history: enough to rebuild every view of a hand without any hidden card.

export interface PublicHistory {
  stacks: number[];
  button: number;
  smallBlind: number;
  bigBlind: number;
  /** Every voluntary action, in order (bets and raises as raise-to totals). */
  actions: Action[];
  /** Board cards dealt so far. */
  board: Card[];
}

/** The public record of a hand (in progress or complete). */
export function publicHistory(state: HandState): PublicHistory {
  const actions: Action[] = [];
  for (const e of state.events) {
    if (e.type !== "action") continue;
    actions.push(e.action === "bet" || e.action === "raise" ? { type: "raise", to: e.to } : { type: e.action });
  }
  return {
    stacks: state.startingStacks.slice(),
    button: state.button,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    actions,
    board: state.board.slice(),
  };
}

export interface Decision {
  seat: number;
  /** The acting seat's view just before it acted. */
  view: PublicView;
  action: Action;
}

/**
 * Replays the first `upTo` actions of a history and returns every decision with the view it was made
 * from, plus the board dealt by then. The replay deals placeholder hole cards (never exposed) and the
 * real board, so every view is exactly what the acting seat saw.
 */
export function replay(history: PublicHistory, upTo: number = history.actions.length): { decisions: Decision[]; board: Card[] } {
  const n = history.stacks.length;
  const used = new Uint8Array(52);
  for (const c of history.board) used[c] = 1;
  const filler = FULL_DECK.filter((c) => !used[c]);
  const deck: Card[] = filler.slice(0, 2 * n);
  for (let k = 0; k < 5; k++) deck.push(k < history.board.length ? history.board[k] : filler[2 * n + k]);
  const { stacks, button, smallBlind, bigBlind } = history;
  let s = createHand({ stacks, button, smallBlind, bigBlind }, { deck });
  const decisions: Decision[] = [];
  for (let i = 0; i < upTo; i++) {
    const la = legalActions(s);
    if (la === null) throw new Error(`History has ${history.actions.length} actions but the hand ended after ${i}`);
    decisions.push({ seat: la.seat, view: publicView(s, la.seat), action: history.actions[i] });
    s = applyAction(s, history.actions[i]);
  }
  return { decisions, board: s.board.slice() };
}
