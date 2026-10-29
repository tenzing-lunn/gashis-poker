// What the Reader sees of a finished hand: only what a player at the table could know. See README.md.
//
// The public event log of a finished hand holds the blinds, every action, the deals and, at a
// showdown, the cards of every seat that was still in. That plus the table config is the whole input;
// the observer may add the cards it knows (its own hole cards). Players are named by a caller-supplied
// id per seat, so the same person can sit in different seats in different hands. The observer's own seat
// can be modeled like any other: its known hole cards count as that seat's shown cards (style.ts).

import type { HandEvent, HandState } from "../../engine/engine";
import type { Card } from "../../poker/cards";
import type { PublicHistory } from "../../bots/view";

export interface ObservedHand {
  /** Starting stack of each seat. */
  stacks: readonly number[];
  button: number;
  smallBlind: number;
  bigBlind: number;
  /** The complete public event log (showdown events carry the shown cards). */
  events: readonly HandEvent[];
  /** Player id of each seat (who to credit the seat's actions to); null for a seat not to model. */
  players: readonly (string | null)[];
  /** The observer's seat, when it plays in the hand: `known` is then its hole cards. */
  observer?: number;
  /** Cards the observer knows: its own hole cards, dead for every other seat. */
  known?: readonly Card[];
}

/**
 * The observed record of a finished hand. Only public fields of the state are read, plus the
 * observer's own hole cards when `observerSeat` is given.
 */
export function observe(state: HandState, players: readonly (string | null)[], observerSeat?: number): ObservedHand {
  if (!state.complete) throw new Error("observe needs a finished hand");
  if (players.length !== state.seatCount) throw new Error("Need one player id per seat");
  return {
    stacks: state.startingStacks.slice(),
    button: state.button,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    events: state.events,
    players: players.slice(),
    observer: observerSeat,
    known: observerSeat === undefined ? [] : state.holeCards[observerSeat].slice(),
  };
}

/** The hand's PublicHistory (config, actions as raise-to totals, final board) for replaying views. */
export function historyOf(hand: ObservedHand): PublicHistory {
  const actions: PublicHistory["actions"] = [];
  for (const e of hand.events) {
    if (e.type === "action") actions.push(e.action === "bet" || e.action === "raise" ? { type: "raise", to: e.to } : { type: e.action });
  }
  const { button, smallBlind, bigBlind } = hand;
  return { stacks: hand.stacks.slice(), button, smallBlind, bigBlind, actions, board: finalBoard(hand) };
}

/** Cards shown at showdown, per seat (null where nothing was shown). */
export function shownCards(hand: ObservedHand): ([Card, Card] | null)[] {
  const shown: ([Card, Card] | null)[] = new Array(hand.stacks.length).fill(null);
  for (const e of hand.events) if (e.type === "showdown") shown[e.seat] = [e.cards[0], e.cards[1]];
  return shown;
}

/** The final board (the last deal event's board; empty if the hand ended preflop). */
export function finalBoard(hand: ObservedHand): Card[] {
  let board: Card[] = [];
  for (const e of hand.events) if (e.type === "deal") board = e.board;
  return board.slice();
}
