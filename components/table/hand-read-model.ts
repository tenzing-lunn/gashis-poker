// What the hand read panel and the result popup show, as plain data (the components are hand-read.tsx and
// result-popup.tsx). The math is lib/poker/hand-read.ts and lib/poker/hand-review.ts.

import { DEFAULT_ROOM_CONFIG } from "@/lib/multiplayer/config";
import { readHand, type HandRead } from "@/lib/poker/hand-read";
import type { TableModel } from "./model";

/** How long the result popup stays up, ms (the friends server waits as long when no host is here to click). */
export const RESULT_MS = DEFAULT_ROOM_CONFIG.resultMs;

/**
 * The hero's hand read, or null when there is nothing to read: watching, not dealt in, folded, before the first
 * hand and between hands.
 */
export function heroRead(model: TableModel): HandRead | null {
  if (model.heroSeat === null || model.handNo === 0 || model.complete) return null;
  const seat = model.seats[model.heroSeat];
  if (!seat || seat.out || !Array.isArray(seat.holeCards) || seat.holeCards.length !== 2) return null;
  if (![0, 3, 4, 5].includes(model.board.length)) return null;
  return readHand(seat.holeCards, model.board);
}

const pct = (x: number): string => `${Math.round(x)}%`;

/**
 * The narrow screens' one line: `TWO PAIR · 9 OUTS 35% · FLUSH DRAW`. With draws the made hand is its short name
 * (before the comma), then the outs and odds of all draws together, then the draws' names last, so a line too long
 * for a phone loses only names to the ellipsis; without draws (preflop, the river, or nothing to draw to) the
 * whole made hand.
 */
export function narrowReadText(read: HandRead): string {
  if (read.draws.length === 0) return read.made;
  const short = read.made.split(",")[0];
  const draws = read.draws.map((d) => d.label).join(" + ");
  return `${short} · ${read.outs} OUTS${read.pctByRiver === null ? "" : ` ${pct(read.pctByRiver)}`} · ${draws}`;
}

export interface PanelRow {
  label: string;
  outs: string;
  pct: string;
}

export interface PanelView {
  /** `STARTING HAND` preflop, else `YOUR HAND`. */
  title: string;
  made: string;
  /** Null preflop and on the river (no draws section); empty when there is nothing to draw to. */
  draws: PanelRow[] | null;
  /** All draws together, only when there is more than one. */
  total: PanelRow | null;
}

/** The wide panel's rows, given the board length the read was made on. */
export function panelView(read: HandRead, boardLength: number): PanelView {
  const title = boardLength === 0 ? "STARTING HAND" : "YOUR HAND";
  if (boardLength === 0 || boardLength === 5) return { title, made: read.made, draws: null, total: null };
  const draws = read.draws.map((d) => ({ label: d.label, outs: `${d.outs.length} OUTS`, pct: pct(d.pctByRiver) }));
  const total =
    read.draws.length > 1 && read.pctByRiver !== null ? { label: "TOTAL", outs: `${read.outs} OUTS`, pct: pct(read.pctByRiver) } : null;
  return { title, made: read.made, draws, total };
}

/** Whole seconds left on the popup's countdown (`CLOSES IN 7 S`), never below 0. */
export function popupSecondsLeft(elapsedMs: number, totalMs: number = RESULT_MS): number {
  return Math.max(0, Math.ceil((totalMs - elapsedMs) / 1000));
}
