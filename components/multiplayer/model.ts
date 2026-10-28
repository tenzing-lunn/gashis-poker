// The multiplayer table as a TableModel: the server's public `state` plus this player's own `hole`
// cards, mapped into the same TableInput the solo table uses (components/table/model.ts buildModel).
//
// Hidden information: the only hole cards that reach the model are this player's own (from `hole`,
// matched by hand number and seat) and the server's showdown reveals (`lastResult.revealed` of the same
// hand). Every other dealt-in seat is "hidden". Nothing else is invented.

import {
  buildModel,
  emptyTableModel,
  type HoleCards,
  type SeatSource,
  type TableInput,
  type TableModel,
  type TimelineEvent,
} from "@/components/table/model";
import { botNames } from "@/components/table/names";
import type { Street } from "@/lib/engine/engine";
import type { CardText, PublicAction, PublicHand, PublicLegal, TableState } from "@/lib/multiplayer/protocol";
import { parseCard, type Card } from "@/lib/poker/cards";

/** This player's cards for one hand, as the server sent them. */
export interface HoleMsg {
  handNo: number;
  seat: number;
  cards: CardText[];
}

const STREETS: Street[] = ["preflop", "flop", "turn", "river"];
/** Board length once a street is dealt. */
const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** The table seat of `playerId`, or null when watching. */
export function heroSeatOf(state: TableState, playerId: string | null): number | null {
  if (!playerId) return null;
  const i = state.seats.findIndex((s) => s?.playerId === playerId);
  return i >= 0 ? i : null;
}

/**
 * Seat names: humans by their (uppercased) handle; bots by persona, a second TAG becoming TAG-2. A human
 * with no open connection is `away`.
 */
export function seatSources(state: TableState): (SeatSource | null)[] {
  const bots = botNames(state.seats.map((s) => (s && s.kind === "bot" ? s.persona : null)));
  return state.seats.map((s, i) => {
    if (!s) return null;
    const src: SeatSource = { name: s.kind === "bot" && s.persona ? bots[i] : s.name.toUpperCase(), kind: s.kind };
    if (s.kind === "human" && !s.connected) src.away = true;
    return src;
  });
}

/** `TIMED OUT → FOLD`: an action the server took because the player's clock ran out. */
export const timedOutText = (a: PublicAction): string => `TIMED OUT → ${a.action === "check" ? "CHECK" : "FOLD"}`;

const cards = (xs: readonly CardText[]): Card[] => xs.map(parseCard);

/** Blinds, actions, board deals (inferred from street changes and the board) and the award. */
export function timelineOf(hand: PublicHand, startingStacks: readonly number[], result: TableState["lastResult"]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const blind = (seat: number, kind: "small" | "big", size: number) => {
    const amount = Math.min(size, startingStacks[seat] ?? size);
    out.push({ kind: "blind", seat, blind: kind, amount, allIn: amount > 0 && amount === startingStacks[seat] });
  };
  blind(hand.smallBlindSeat, "small", hand.smallBlind);
  blind(hand.bigBlindSeat, "big", hand.bigBlind);

  let dealt = 0; // index into STREETS of the last street dealt
  const dealUpTo = (street: Street) => {
    const k = STREETS.indexOf(street);
    while (dealt < k) out.push({ kind: "deal", street: STREETS[++dealt] });
  };
  for (const a of hand.actions) {
    dealUpTo(a.street);
    out.push({ kind: "action", seat: a.seat, street: a.street, action: a.action, to: a.to, allIn: a.allIn });
  }
  // Streets dealt after the last action (the next street, or an all-in runout).
  const boardStreet = [...STREETS].reverse().find((s) => hand.board.length >= BOARD_LEN[s]) ?? "preflop";
  dealUpTo(STREETS.indexOf(hand.street) > STREETS.indexOf(boardStreet) ? hand.street : boardStreet);

  if (hand.complete && result && result.handNo === hand.handNo) {
    const won = new Map<number, number>();
    for (const pot of result.pots) pot.winners.forEach((seat, k) => won.set(seat, (won.get(seat) ?? 0) + pot.shares[k]));
    out.push({ kind: "end", winners: [...won].map(([seat, amount]) => ({ seat, amount })) });
  }
  return out;
}

/** The server state (and this player's hole cards) as a TableInput; null before the first deal. */
export function tableInputFromState(state: TableState, hole: HoleMsg | null, playerId: string | null): TableInput | null {
  const hand = state.hand;
  if (!hand) return null;
  const n = state.config.seats;
  const heroSeat = heroSeatOf(state, playerId);
  const dealt = new Map(hand.players.map((p) => [p.seat, p]));
  const result = state.lastResult && state.lastResult.handNo === hand.handNo ? state.lastResult : null;
  const net = new Map((result?.net ?? []).map((x) => [x.seat, x.amount]));
  const shown = new Map(hand.complete && result?.showdown ? result.revealed.map((r) => [r.seat, r]) : []);

  const stacks: number[] = [];
  const startingStacks: number[] = [];
  const committed: number[] = [];
  const folded: boolean[] = [];
  const inHand: boolean[] = [];
  const holeCards: HoleCards[] = [];
  const revealed: boolean[] = [];
  const categories: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    const p = dealt.get(i);
    const seat = state.seats[i];
    stacks.push(p ? p.stack : (seat?.stack ?? 0));
    // Live: chips behind plus chips put in. Over: final stack minus the net result.
    startingStacks.push(p ? (hand.complete && net.has(i) ? p.stack - net.get(i)! : p.stack + p.committed) : (seat?.stack ?? 0));
    committed.push(p ? p.committed : 0);
    folded.push(p ? p.folded : false);
    inHand.push(!!p);
    const r = shown.get(i);
    if (p && i === heroSeat && hole && hole.handNo === hand.handNo && hole.seat === i) {
      holeCards.push(cards(hole.cards));
      revealed.push(false);
    } else if (p && r) {
      holeCards.push(cards(r.cards));
      revealed.push(true);
    } else {
      holeCards.push(p ? "hidden" : null);
      revealed.push(false);
    }
    categories.push(r ? r.category.toUpperCase() : null);
  }

  return {
    handNo: hand.handNo,
    seats: seatSources(state),
    button: hand.button,
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    street: hand.street,
    board: cards(hand.board),
    pot: hand.pot,
    stacks,
    startingStacks,
    committed,
    folded,
    inHand,
    toAct: hand.complete ? null : state.toAct,
    complete: hand.complete,
    showdown: !!result?.showdown,
    timeline: timelineOf(hand, startingStacks, result),
    holeCards,
    revealed,
    categories,
    heroSeat,
  };
}

/** The table as this player sees it. */
export function modelFromState(state: TableState, hole: HoleMsg | null, playerId: string | null): TableModel {
  const input = tableInputFromState(state, hole, playerId);
  let model: TableModel;
  if (input) {
    model = buildModel(input);
  } else {
    model = emptyTableModel(
      seatSources(state),
      state.seats.map((s) => s?.stack ?? 0),
      { heroSeat: heroSeatOf(state, playerId), smallBlind: state.config.smallBlind, bigBlind: state.config.bigBlind },
    );
    // Waiting after earlier hands: keep the count, the last hand is over.
    if (state.handNo > 0) model = { ...model, handNo: state.handNo, street: "over" };
  }
  // A seat's last action in this hand, when its clock ran out (`TIMED OUT → FOLD` does not fit the seat).
  const actions = input ? state.hand!.actions : [];
  const lastOf = (seat: number) => actions.findLast((a) => a.seat === seat);
  // Seats sitting out (and not in this hand) are drawn muted with a word on their action line.
  const seats = model.seats.map((s) => {
    const info = state.seats[s.seat];
    const dealtIn = input?.inHand[s.seat] ?? false;
    if (dealtIn) {
      const last = lastOf(s.seat);
      if (last?.timedOut && s.lastAction === (last.action === "check" ? "CHECK" : "FOLD")) {
        return { ...s, lastAction: `${s.lastAction} (TIME)` };
      }
      return s;
    }
    if (!info || (!info.sittingOut && !info.leaving)) return s;
    return { ...s, out: true, lastAction: info.leaving ? "LEAVING" : "SITTING OUT" };
  });
  // The strip's marks are each seat's blinds, actions and wins in order: name the timed-out actions.
  const rows = model.strip.rows.map((row) => {
    const mine = actions.filter((a) => a.seat === row.seat);
    if (!mine.some((a) => a.timedOut)) return row;
    let k = 0;
    const marks = row.marks.map((m) => {
      if (m.letter === "b" || m.letter === "W") return m;
      const a = mine[k++];
      return a?.timedOut ? { ...m, text: timedOutText(a) } : m;
    });
    return { ...row, marks };
  });
  return { ...model, seats, strip: { ...model.strip, rows } };
}

/** What the hero may do now, or null when it is not their decision. */
export function heroLegal(state: TableState, playerId: string | null): PublicLegal | null {
  const hero = heroSeatOf(state, playerId);
  const legal = state.hand?.legal ?? null;
  if (hero === null || !legal || state.hand!.complete || state.toAct !== hero || legal.seat !== hero) return null;
  return legal;
}

/** The hero's bet this street and chips behind (0 / their seat stack when not dealt in). */
export function heroChips(state: TableState, playerId: string | null): { bet: number; stack: number } {
  const hero = heroSeatOf(state, playerId);
  if (hero === null) return { bet: 0, stack: 0 };
  const p = state.hand?.players.find((x) => x.seat === hero);
  return p ? { bet: p.bet, stack: p.stack } : { bet: 0, stack: state.seats[hero]?.stack ?? 0 };
}

/** Seconds left on a server deadline, given the estimated server-minus-local clock offset. */
export function secondsLeft(deadline: number | null, localNow: number, clockOffsetMs: number): number | null {
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - (localNow + clockOffsetMs)) / 1000));
}

/** The option after `value` in a cycling control, wrapping to the first. */
export function cycleNext<T>(options: readonly T[], value: T): T {
  const i = options.indexOf(value);
  return options[(i + 1) % options.length];
}

/** The hand line before the first deal, instead of `HAND 000000`. */
export function waitingText(state: TableState, isHost: boolean): string {
  if (!state.started) {
    if (!isHost) return "WAITING FOR THE HOST";
    return seatedCount(state) >= 2 ? "PRESS START ABOVE" : "WAITING FOR A SECOND PLAYER";
  }
  return "WAITING FOR PLAYERS";
}

/** Seats taken, by humans or bots. */
export const seatedCount = (state: TableState): number => state.seats.filter(Boolean).length;

/** Seats in play (seated, neither sitting out nor leaving), and seats sitting out. */
export function seatCounts(state: TableState): { playing: number; out: number } {
  let playing = 0;
  let out = 0;
  for (const s of state.seats) {
    if (!s) continue;
    if (s.sittingOut) out++;
    else if (!s.leaving) playing++;
  }
  return { playing, out };
}

/** Started, but no hand is running and none is coming: too few players in, or nobody human here. */
export const isPaused = (state: TableState): boolean =>
  state.started && (!state.hand || state.hand.complete) && state.nextHandAt === null;

/** The header's mode: `LIVE  4/6 IN`, `PAUSED  1/6 IN, 2 OUT`, `WAITING  1/6 IN` before the start. */
export function modeText(state: TableState): string {
  const { playing, out } = seatCounts(state);
  const head = !state.started ? "WAITING" : isPaused(state) ? "PAUSED" : "LIVE";
  return `${head}  ${playing}/${state.config.seats} IN${out > 0 ? `, ${out} OUT` : ""}`;
}

/** Why a started table is paused (see isPaused), for the status line. */
export function pausedText(state: TableState): string {
  const { playing, out } = seatCounts(state);
  const outText = out === 0 ? "" : ` — ${out} SITTING OUT`;
  if (playing < 2) return `WAITING FOR A SECOND PLAYER${outText}`;
  return "WAITING FOR A PLAYER TO COME BACK";
}
