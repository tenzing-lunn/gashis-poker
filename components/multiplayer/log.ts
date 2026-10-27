// The hand log under a multiplayer table, dealer-trace style (DESIGN.md §6): `+0.074  S2 CHECK`.
// Built from successive `state` snapshots: each new action, board deal and result becomes a row, timed
// from when this client first saw the hand. Pure, so it is unit-tested.

import { fmt, padHand, rankText, suitGlyph } from "@/components/table/model";
import type { PublicAction, TableState } from "@/lib/multiplayer/protocol";
import { parseCard } from "@/lib/poker/cards";

export interface LogRow {
  key: string;
  /** Ms since the hand was first seen. */
  t: number;
  text: string;
}

export interface HandLog {
  handNo: number;
  startedAt: number;
  /** Actions of `handNo` already logged. */
  actions: number;
  /** Board cards already logged. */
  board: number;
  /** Result of `handNo` already logged. */
  result: boolean;
  /** Rows ever logged (keys stay unique after old rows drop off). */
  count: number;
  rows: LogRow[];
}

export const LOG_ROWS = 20;

export const emptyLog = (): HandLog => ({ handNo: 0, startedAt: 0, actions: 0, board: 0, result: false, count: 0, rows: [] });

const seatLabel = (seat: number) => `S${seat + 1}`;
const cardText = (c: string) => {
  const id = parseCard(c);
  return `${rankText(id)}${suitGlyph(id)}`;
};

export function actionWords(a: PublicAction): string {
  let w: string;
  if (a.action === "fold") w = "FOLD";
  else if (a.action === "check") w = "CHECK";
  else if (a.allIn) w = `ALL-IN ${fmt(a.to)}`;
  else if (a.action === "call") w = `CALL ${fmt(a.to)}`;
  else if (a.action === "bet") w = `BET ${fmt(a.to)}`;
  else w = `RAISE TO ${fmt(a.to)}`;
  return `${seatLabel(a.seat)} ${w}${a.auto ? " (AUTO)" : ""}`;
}

const STREET_AT: Record<number, string> = { 3: "FLOP", 4: "TURN", 5: "RIVER" };

/** The log after seeing `state` at local time `now`. Returns `log` itself when nothing changed. */
export function updateLog(log: HandLog, state: TableState, now: number): HandLog {
  const hand = state.hand;
  if (!hand) return log;
  let next = log;
  const rows: LogRow[] = [];
  const push = (text: string) => rows.push({ key: String(next.count + rows.length), t: now - next.startedAt, text });

  if (hand.handNo !== log.handNo) {
    next = { ...log, handNo: hand.handNo, startedAt: now, actions: 0, board: 0, result: false };
    push(`HAND ${padHand(hand.handNo)}  BUTTON ${seatLabel(hand.button)}`);
    push(`${seatLabel(hand.smallBlindSeat)} SB ${fmt(hand.smallBlind)}`);
    push(`${seatLabel(hand.bigBlindSeat)} BB ${fmt(hand.bigBlind)}`);
  }

  let board = next.board;
  const dealTo = (len: number) => {
    // Flop is three cards at once; turn and river one each.
    while (board < len && board < hand.board.length) {
      const upto = board === 0 ? 3 : board + 1;
      push(`${STREET_AT[upto]} ${hand.board.slice(board, upto).map(cardText).join(" ")}`);
      board = upto;
    }
  };
  const fresh = hand.actions.slice(next.actions);
  for (const a of fresh) {
    dealTo(a.street === "flop" ? 3 : a.street === "turn" ? 4 : a.street === "river" ? 5 : 0);
    push(actionWords(a));
  }
  dealTo(hand.board.length);

  let result = next.result;
  const r = state.lastResult;
  if (hand.complete && !result && r && r.handNo === hand.handNo) {
    result = true;
    const category = new Map(r.revealed.map((x) => [x.seat, x.category.toUpperCase()]));
    for (const x of r.revealed) push(`${seatLabel(x.seat)} SHOWS ${x.cards.map(cardText).join(" ")}  ${category.get(x.seat)}`);
    const won = new Map<number, number>();
    for (const pot of r.pots) pot.winners.forEach((seat, k) => won.set(seat, (won.get(seat) ?? 0) + pot.shares[k]));
    for (const [seat, amount] of won) push(`${seatLabel(seat)} WINS ${fmt(amount)}`);
  }

  if (rows.length === 0 && next === log) return log;
  return {
    ...next,
    actions: hand.actions.length,
    board,
    result,
    count: next.count + rows.length,
    rows: [...next.rows, ...rows].slice(-LOG_ROWS),
  };
}

/** `+0.074`. */
export const stamp = (ms: number): string => `+${(Math.max(0, ms) / 1000).toFixed(3)}`;
