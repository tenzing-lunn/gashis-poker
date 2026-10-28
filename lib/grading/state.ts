// Rebuilding the decision state from public information only.
//
// Grading never sees a HandState with real hidden cards. Like `replay` in lib/bots/view.ts, we deal
// placeholder hole cards (cards not on the board) and the real board, then apply the public actions.
// Only public fields are ever read from the result: stacks, bets, committed, folded, the board, the
// event log and the legal actions. The placeholder cards matter in two places, and we ignore both: when a
// street closes the engine deals the next street from the placeholder deck (grading treats that as a
// terminal and never looks at those cards), and when players are all in the engine runs the board out
// and settles with placeholder hands (grading reads only the final contributions, never the winners).

import { applyAction, createHand, type HandState } from "../engine/engine";
import { FULL_DECK } from "../poker/cards";
import type { PublicHistory } from "../bots/view";

/** The hand after every action of `history`, with placeholder hole cards. Throws if the hand is over. */
export function stateFromHistory(history: PublicHistory): HandState {
  const n = history.stacks.length;
  const used = new Uint8Array(52);
  for (const c of history.board) used[c] = 1;
  const filler = FULL_DECK.filter((c) => !used[c]);
  const deck = filler.slice(0, 2 * n);
  for (let k = 0; k < 5; k++) deck.push(k < history.board.length ? history.board[k] : filler[2 * n + k]);
  const { stacks, button, smallBlind, bigBlind } = history;
  let s = createHand({ stacks, button, smallBlind, bigBlind }, { deck });
  for (const a of history.actions) {
    if (s.complete) throw new Error("History continues after the hand is over");
    s = applyAction(s, a);
  }
  if (s.complete) throw new Error("The hand is over: there is no decision to grade");
  if (s.board.length !== history.board.length) {
    throw new Error(`History has ${history.board.length} board cards but its actions reach the ${s.street} (${s.board.length})`);
  }
  return s;
}

/** Bets plus raises made on the current street (preflop: voluntary raises; the blinds don't count). */
export function streetRaises(s: HandState): number {
  let count = 0;
  for (const e of s.events) {
    if (e.type === "action" && e.street === s.street && (e.action === "bet" || e.action === "raise")) count++;
  }
  return count;
}
