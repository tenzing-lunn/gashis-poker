// The table as data. Every table on the site (solo practice, the home attract table, multiplayer) is
// drawn from one TableModel by the presentational components in this folder.
//
//   modelFromHand(state, heroSeat, names, opts)            solo: an engine HandState
//   modelFromPublicView(view, ownCards, names, opts)        a seat's PublicView (no deck, no foreign cards)
//   buildModel(input)                                      any source normalized to a TableInput
//                                                          (multiplayer: map PublicHand + SeatInfo into it)
//
// Hidden information: the adapters never read `state.deck`, and a non-hero seat's hole cards reach the
// model only through showdown reveals (engine `showdown` events, or `revealed` passed in).

import type { ActionKind, HandEvent, HandState, Street } from "@/lib/engine/engine";
import type { PublicView } from "@/lib/bots/view";
import type { Card } from "@/lib/poker/cards";
import { handCategory } from "@/lib/poker/evaluator";

// ---------------------------------------------------------------------------
// Types

export type SeatKind = "human" | "bot" | "empty";

/** Face-up cards, two face-down backs, or nothing (empty seat / not dealt in). */
export type HoleCards = Card[] | "hidden" | null;

/** Engine street, plus the two end states. */
export type TableStreet = Street | "showdown" | "over";

export interface SeatModel {
  /** Table seat index, 0-based. */
  seat: number;
  /** Display label, `S1`.. (1-based). */
  label: string;
  name: string;
  kind: SeatKind;
  /** Chips behind. */
  stack: number;
  /** Stack depth in big blinds (`stack / bigBlind`); null for an empty seat. Drawn by `seatMeta`. */
  bbDepth: number | null;
  /** Share of the chips at the table, in % (drawn only as the bar); null for an empty seat. */
  metaPct: number | null;
  /** 0..1, fill of the stack bar: the same share as `metaPct`. */
  barFraction: number;
  /**
   * The `.act` line: `CALL 100`, `SB 50`, `RAISE TO 300`, `FOLD`, "" for nothing yet this street; at hand end
   * a showdown hand in its seat form (`TWO PAIR`, `STR FLUSH`) or `WINS` for an uncontested winner.
   */
  lastAction: string;
  /** Net result for the hand of a winner or a showdown loser (drawn green/red on the meta line), else null. */
  net: number | null;
  /** Hand shown at showdown (`TWO PAIR`), else null. */
  category: string | null;
  holeCards: HoleCards;
  /** True when face-up cards were revealed at showdown (drawn with the flip animation). */
  revealed: boolean;
  isButton: boolean;
  /** On the clock. */
  turn: boolean;
  /** Won (part of) a pot. */
  win: boolean;
  /** Folded, sitting out, or an empty seat. */
  out: boolean;
  isHero: boolean;
}

export type StripLetter = "b" | "X" | "C" | "B" | "R" | "A" | "F" | "W";
export type StripLabelText = "PRE" | "FLOP" | "TURN" | "RIVER" | "SHOW";

export interface StripMark {
  letter: StripLetter;
  /** Position on the track, 0..1. */
  at: number;
  /** Street the mark belongs to (`showdown` for W). */
  street: TableStreet;
}

export interface StripRow {
  seat: number;
  label: string;
  name: string;
  out: boolean;
  marks: StripMark[];
  /** The solid line runs from 0 to here (the fold for folded seats, else "now"). */
  lineTo: number;
}

export interface StripLabel {
  label: StripLabelText;
  at: number;
  /** Projected (not reached yet), drawn muted. */
  future: boolean;
}

export interface StripModel {
  labels: StripLabel[];
  rows: StripRow[];
  /** Where "now" is on the track, 0..1. */
  now: number;
}

/** One winner of a finished hand. */
export interface ResultWinner {
  seat: number;
  label: string;
  name: string;
  /** Chips awarded (all pots this seat won). */
  amount: number;
  /** Net result for the hand, when the starting stacks are known. */
  net: number | null;
  /** Hand shown at showdown, else null. */
  category: string | null;
  isHero: boolean;
}

/** How a finished hand ended, for the status line (`YOU WIN 3,516 WITH TWO PAIR`). */
export interface HandResult {
  winners: ResultWinner[];
  /** More than one seat won chips. */
  split: boolean;
  showdown: boolean;
  /** The hero's net result for the hand; null without a dealt-in hero or starting stacks. */
  heroNet: number | null;
  /** One line in CAPS. */
  text: string;
}

export interface TableModel {
  handNo: number;
  smallBlind: number;
  bigBlind: number;
  street: TableStreet;
  board: Card[];
  /** Everything in the middle; once the hand is over, the amount that was awarded. */
  pot: number;
  /** One per table seat (index = seat). */
  seats: SeatModel[];
  /** Seat drawn at the bottom-left / bottom-center: the hero, else seat 0. */
  anchorSeat: number;
  heroSeat: number | null;
  toAct: number | null;
  complete: boolean;
  /** Occupied seats / seats at the table. */
  seated: number;
  capacity: number;
  strip: StripModel;
  /** One sentence on the latest event, for a polite live region. */
  lastEvent: string;
  /** Who won what, once the hand is complete; null while it runs. */
  result: HandResult | null;
}

// ---------------------------------------------------------------------------
// Normalized input

export interface SeatSource {
  name: string;
  kind: "human" | "bot";
}

/** One step of the hand in time order. Seats are table seats. */
export type TimelineEvent =
  | { kind: "blind"; seat: number; blind: "small" | "big"; amount: number; allIn: boolean }
  | { kind: "action"; seat: number; street: Street; action: ActionKind; to: number; allIn: boolean }
  | { kind: "deal"; street: Street }
  /** The hand is over; W goes to these seats. */
  | { kind: "end"; winners: { seat: number; amount: number }[] };

export interface TableInput {
  handNo: number;
  /** One entry per table seat; null = empty seat. */
  seats: (SeatSource | null)[];
  button: number | null;
  smallBlind: number;
  bigBlind: number;
  street: Street;
  board: Card[];
  /** Everything in the middle (ignored once complete: the awarded total is shown instead). */
  pot: number;
  /** Per table seat. Seats not dealt in: stack = their chips, the rest 0/false. */
  stacks: number[];
  /** Stacks before the blinds; gives a winner's net result. Without it a winner shows `+` the amount won. */
  startingStacks?: number[];
  committed: number[];
  folded: boolean[];
  inHand: boolean[];
  toAct: number | null;
  complete: boolean;
  /** True when the hand went to showdown. */
  showdown: boolean;
  timeline: TimelineEvent[];
  /** Already filtered: hero's cards, revealed cards, "hidden" for other dealt-in seats. */
  holeCards: HoleCards[];
  revealed: boolean[];
  /** Showdown hand names (e.g. "TWO PAIR") per seat, or null. */
  categories: (string | null)[];
  heroSeat: number | null;
}

// ---------------------------------------------------------------------------
// Formatting

export const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

/** `+408`, `-1,200`, `+0`. */
export const signed = (n: number): string => (n < 0 ? `-${fmt(-n)}` : `+${fmt(n)}`);

/** `HAND 000042` numbering. */
export const padHand = (n: number): string => String(Math.max(0, Math.floor(n))).padStart(6, "0");

const STREET_TEXT: Record<TableStreet, string> = {
  preflop: "PREFLOP",
  flop: "FLOP",
  turn: "TURN",
  river: "RIVER",
  showdown: "SHOWDOWN",
  over: "HAND OVER",
};
export const streetText = (s: TableStreet): string => STREET_TEXT[s];

const RANK_TEXT = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_WORD = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king", "ace"];
/** Text-presentation suit glyphs (U+FE0E) so they never render as emoji. Order c d h s. */
const SUIT_GLYPH = ["♣︎", "♦︎", "♥︎", "♠︎"];
const SUIT_WORD = ["clubs", "diamonds", "hearts", "spades"];

export const rankText = (c: Card): string => RANK_TEXT[c >> 2];
export const suitGlyph = (c: Card): string => SUIT_GLYPH[c & 3];
export const cardWords = (c: Card): string => `${RANK_WORD[c >> 2]} of ${SUIT_WORD[c & 3]}`;

/** Stack depth: `100 BB` (whole BBs from 10 up, one decimal below, `0 BB` for none). Rounded down. */
export function bbText(depth: number): string {
  if (depth <= 0) return "0 BB";
  if (depth >= 10) return `${fmt(Math.floor(depth))} BB`;
  return `${(Math.floor(depth * 10) / 10).toFixed(1)} BB`;
}

/** `12,345` → `12.3K`, `1,234,567` → `1.2M` (rounded down); below 10,000 as `fmt`. */
function compact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const cut = (x: number, unit: string) => `${sign}${x >= 100 ? Math.floor(x) : (Math.floor(x * 10) / 10).toFixed(1)}${unit}`;
  if (a < 10_000) return `${sign}${fmt(a)}`;
  if (a < 1_000_000) return cut(a / 1000, "K");
  return cut(a / 1_000_000, "M");
}

/** Seat width in characters: 14ch on the wide figure, 12ch on the tall (mobile) one (DESIGN.md §4.2, §4.7). */
export const SEAT_CHARS = { wide: 14, tall: 12 } as const;

/**
 * The `.meta` line fitted to `width` characters: the stack, then its depth in big blinds, or at hand end
 * the seat's net result (`21,750  +1,783`). `tail` is drawn green/red when it is a net result.
 */
export function seatMeta(s: SeatModel, width: number): { head: string; tail: string } {
  if (s.kind === "empty") return { head: "--", tail: "" };
  const net = s.net !== null;
  const tail = net ? signed(s.net!) : s.bbDepth === null ? "" : bbText(s.bbDepth);
  const tailShort = net ? (s.net! < 0 ? compact(s.net!) : `+${compact(s.net!)}`) : tail.replace(" BB", "BB");
  const stack = fmt(s.stack);
  const options = [
    [`${stack}  `, tail],
    [`${stack} `, tail],
    [`${stack} `, tailShort],
    [`${compact(s.stack)} `, tail],
    [`${compact(s.stack)} `, tailShort],
  ];
  for (const [head, t] of options) if (head.length + t.length <= width) return { head, tail: t };
  return { head: compact(s.stack).slice(0, width), tail: "" };
}

const SEAT_CATEGORY: Record<string, string> = {
  "THREE OF A KIND": "TRIPS",
  "FOUR OF A KIND": "QUADS",
  "STRAIGHT FLUSH": "STR FLUSH",
  "ROYAL FLUSH": "STR FLUSH",
};
/** A showdown hand short enough for the seat's `.act` line (12 characters at most). */
export const seatCategory = (category: string): string => (SEAT_CATEGORY[category] ?? category).slice(0, SEAT_CHARS.tall);

const CATEGORY_PHRASE: Record<string, string> = {
  PAIR: "A PAIR",
  TRIPS: "THREE OF A KIND",
  STRAIGHT: "A STRAIGHT",
  FLUSH: "A FLUSH",
  "FULL HOUSE": "A FULL HOUSE",
  QUADS: "FOUR OF A KIND",
  "STRAIGHT FLUSH": "A STRAIGHT FLUSH",
  "ROYAL FLUSH": "A ROYAL FLUSH",
};
/** The full hand name for the result line: `A STRAIGHT`, `THREE OF A KIND`, `TWO PAIR`. */
export const categoryPhrase = (category: string): string => CATEGORY_PHRASE[category] ?? category;

function actionText(e: Extract<TimelineEvent, { kind: "action" }>): string {
  if (e.action === "fold") return "FOLD";
  if (e.action === "check") return "CHECK";
  if (e.allIn) return `ALL-IN ${fmt(e.to)}`;
  if (e.action === "call") return `CALL ${fmt(e.to)}`;
  if (e.action === "bet") return `BET ${fmt(e.to)}`;
  return `RAISE TO ${fmt(e.to)}`;
}

export function letterFor(e: TimelineEvent): StripLetter | null {
  if (e.kind === "blind") return "b";
  if (e.kind !== "action") return null;
  switch (e.action) {
    case "fold":
      return "F";
    case "check":
      return "X";
    case "call":
      return e.allIn ? "A" : "C";
    case "bet":
      return e.allIn ? "A" : "B";
    case "raise":
      return e.allIn ? "A" : "R";
  }
}

// ---------------------------------------------------------------------------
// Seat coordinates (DESIGN.md §4.2, §4.7)

export type SeatLayout = "wide" | "tall";

/**
 * Where the seats sit, per layout and seat count. Radii are % of the figure; `e` < 1 bends the ellipse
 * toward a rounded rectangle (superellipse exponent); `angles` (degrees clockwise, 90 = bottom center)
 * replace the even spacing; `off` rotates the even spacing by half a step (anchor bottom-left).
 * Tuned so seat boxes clear each other, the board and the figure edge at 320-1440px (model.test.ts);
 * wide 8 is exactly §4.2.
 */
interface Ring {
  rx: number;
  ry: number;
  e?: number;
  off?: 0 | 0.5;
  angles?: number[];
}
const RINGS: Record<SeatLayout, (n: number) => Ring> = {
  wide: (n) =>
    n === 4 || n === 8
      ? { rx: 43, ry: 39, off: 0.5 }
      : n === 6
        ? { rx: 41, ry: 39, off: 0.5 }
        : { rx: n === 7 ? 42 : 43, ry: 34.5 },
  tall: (n) =>
    n === 4
      ? { rx: 33, ry: 41, off: 0.5 }
      : n === 5
        ? { rx: 34, ry: 38.5, angles: [90, 150, 242.5, 297.5, 30] }
        : n === 6
          ? { rx: 33.5, ry: 38.5 }
          : n === 7
            ? { rx: 33, ry: 39, e: 0.6, angles: [90, 165, 195, 255, 285, 345, 15] }
            : n === 8
              ? { rx: 34, ry: 42, e: 0.9, off: 0.5 }
              : { rx: 33, ry: 38.5 },
};

export interface SeatPoint {
  /** % of the figure width. */
  left: number;
  /** % of the figure height. */
  top: number;
}

/**
 * Seat centers for an n-seat table, clockwise starting from the anchor (hero) seat, which sits at the
 * bottom: bottom-left for 4, 6 (wide) and 8 seats (8 wide: exactly §4.2), else bottom-center.
 */
export function seatPoints(n: number, layout: SeatLayout = "wide"): SeatPoint[] {
  const { rx, ry, e = 1, off = 0, angles } = RINGS[layout](n);
  const bend = (c: number) => Math.sign(c) * Math.abs(c) ** e;
  return Array.from({ length: n }, (_, k) => {
    const a = ((angles?.[k] ?? 90 + (360 / n) * (k + off)) * Math.PI) / 180;
    return { left: round4(50 + rx * bend(Math.cos(a))), top: round4(50 + ry * bend(Math.sin(a))) };
  });
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

// ---------------------------------------------------------------------------
// Building the model

export function buildModel(input: TableInput): TableModel {
  const n = input.seats.length;
  const { timeline } = input;
  const last = new Array<string>(n).fill("");
  const lastStreet = new Array<Street | null>(n).fill(null);
  let winners: { seat: number; amount: number }[] = [];
  let awarded = 0;
  for (const e of timeline) {
    if (e.kind === "blind") {
      last[e.seat] = `${e.blind === "small" ? "SB" : "BB"} ${fmt(e.amount)}`;
      lastStreet[e.seat] = "preflop";
    } else if (e.kind === "action") {
      last[e.seat] = actionText(e);
      lastStreet[e.seat] = e.street;
    } else if (e.kind === "end") {
      winners = e.winners;
      awarded = e.winners.reduce((a, w) => a + w.amount, 0);
    }
  }
  const won = new Map<number, number>();
  for (const w of winners) won.set(w.seat, (won.get(w.seat) ?? 0) + w.amount);

  // Once the hand is over the pot is already in the winners' stacks.
  const chips = input.stacks.map((s, i) => (input.seats[i] ? s + (input.complete ? 0 : input.committed[i]) : 0));
  const totalChips = chips.reduce((a, b) => a + b, 0);

  const seats: SeatModel[] = input.seats.map((src, i) => {
    const label = `S${i + 1}`;
    if (!src) {
      return {
        seat: i,
        label,
        name: "EMPTY",
        kind: "empty",
        stack: 0,
        bbDepth: null,
        metaPct: null,
        barFraction: 0,
        lastAction: "",
        net: null,
        category: null,
        holeCards: null,
        revealed: false,
        isButton: false,
        turn: false,
        win: false,
        out: true,
        isHero: false,
      };
    }
    const folded = input.folded[i];
    const category = input.complete && !folded ? input.categories[i] || null : null;
    const startNet = input.startingStacks ? input.stacks[i] - input.startingStacks[i] : null;
    // Winners and showdown losers show their net result; without starting stacks a winner shows `+` its winnings.
    const net = !input.complete ? null : won.has(i) ? (startNet ?? won.get(i)!) : category !== null ? startNet : null;
    const metaPct = totalChips > 0 ? Math.round((100 * chips[i]) / totalChips) : null;
    let lastAction = "";
    if (folded) lastAction = "FOLD";
    else if (category !== null) lastAction = seatCategory(category);
    else if (input.complete && won.has(i)) lastAction = "WINS";
    else if (!input.complete && lastStreet[i] === input.street) lastAction = last[i];
    else if (!input.inHand[i] && input.handNo > 0) lastAction = "SITTING OUT";
    return {
      seat: i,
      label,
      name: src.name,
      kind: src.kind,
      stack: input.stacks[i],
      bbDepth: input.bigBlind > 0 ? input.stacks[i] / input.bigBlind : null,
      metaPct,
      barFraction: (metaPct ?? 0) / 100,
      lastAction,
      net,
      category,
      holeCards: input.holeCards[i],
      revealed: input.revealed[i],
      isButton: input.button === i,
      turn: !input.complete && input.toAct === i,
      win: input.complete && won.has(i),
      out: folded || (!input.inHand[i] && input.handNo > 0),
      isHero: input.heroSeat === i,
    };
  });

  const street: TableStreet = input.complete ? (input.showdown ? "showdown" : "over") : input.street;
  return {
    handNo: input.handNo,
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
    street,
    board: input.board.slice(),
    pot: input.complete ? awarded : input.pot,
    seats,
    anchorSeat: input.heroSeat ?? 0,
    heroSeat: input.heroSeat,
    toAct: input.complete ? null : input.toAct,
    complete: input.complete,
    seated: input.seats.filter(Boolean).length,
    capacity: n,
    strip: buildStrip(input, seats),
    lastEvent: describe(timeline[timeline.length - 1], seats),
    result: input.complete && winners.length > 0 ? buildResult(input, seats, won) : null,
  };
}

/**
 * The result line: `YOU WIN 3,516 WITH TWO PAIR`, `S4 STATION WINS 400 WITH A STRAIGHT · YOU LOSE 100`,
 * `S2 LAG WINS 150 · EVERYONE ELSE FOLDED`, `SPLIT POT: S2 LAG AND S4 BEA EACH WIN 375`.
 */
function buildResult(input: TableInput, seats: SeatModel[], won: Map<number, number>): HandResult {
  const winners: ResultWinner[] = [...won]
    .sort((a, b) => a[0] - b[0])
    .map(([seat, amount]) => {
      const s = seats[seat];
      return { seat, label: s.label, name: s.name, amount, net: s.net, category: s.category, isHero: s.isHero };
    });
  const hero = input.heroSeat;
  const heroNet =
    hero !== null && input.startingStacks && input.inHand[hero] && input.seats[hero] ? input.stacks[hero] - input.startingStacks[hero] : null;
  const who = (w: ResultWinner) => (w.isHero ? "YOU" : `${w.label} ${w.name}`);
  const withHand = (c: string | null) => (c ? ` WITH ${categoryPhrase(c)}` : "");

  let text: string;
  const split = winners.length > 1;
  if (split && winners.every((w) => w.amount === winners[0].amount)) {
    const names = winners.map(who);
    const list = `${names.slice(0, -1).join(", ")} AND ${names[names.length - 1]}`;
    const same = winners.every((w) => w.category === winners[0].category);
    text = `SPLIT POT: ${list} EACH WIN ${fmt(winners[0].amount)}${same ? withHand(winners[0].category) : ""}`;
  } else {
    text = winners.map((w) => `${who(w)} ${w.isHero ? "WIN" : "WINS"} ${fmt(w.amount)}${withHand(w.category)}`).join(" · ");
  }
  if (!input.showdown) text += " · EVERYONE ELSE FOLDED";
  else if (hero !== null && !won.has(hero) && seats[hero]?.category && heroNet !== null && heroNet < 0) text += ` · YOU LOSE ${fmt(-heroNet)}`;

  return { winners, split, showdown: input.showdown, heroNet, text };
}

const LABEL_OF: Record<Street, StripLabelText> = { preflop: "PRE", flop: "FLOP", turn: "TURN", river: "RIVER" };
const NEXT_STREETS: Record<Street, Street[]> = {
  preflop: ["flop", "turn", "river"],
  flop: ["turn", "river"],
  turn: ["river"],
  river: [],
};

/**
 * The hand as ticks: every blind, the hole-card deal (PRE), every action, every board deal and the end
 * (SHOW, with W marks) is one tick. A finished hand spans the whole track; a live one is scaled against
 * a projection of the ticks still to come, whose street labels are drawn muted.
 */
function buildStrip(input: TableInput, seats: SeatModel[]): StripModel {
  type Tick = { j: number; seat: number; letter: StripLetter; street: TableStreet };
  const marks: Tick[] = [];
  const labels: { label: StripLabelText; j: number }[] = [];
  let j = 0;
  let prePlaced = false;
  let street: TableStreet = "preflop";
  const foldAt = new Map<number, number>();
  const placePre = () => {
    if (!prePlaced) {
      labels.push({ label: "PRE", j: ++j });
      prePlaced = true;
    }
  };
  for (const e of input.timeline) {
    if (e.kind === "blind") {
      marks.push({ j: ++j, seat: e.seat, letter: "b", street: "preflop" });
      continue;
    }
    placePre();
    if (e.kind === "action") {
      street = e.street;
      marks.push({ j: ++j, seat: e.seat, letter: letterFor(e)!, street });
      if (e.action === "fold") foldAt.set(e.seat, j);
    } else if (e.kind === "deal") {
      street = e.street;
      labels.push({ label: LABEL_OF[e.street], j: ++j });
    } else {
      labels.push({ label: "SHOW", j: ++j });
      for (const w of e.winners) if (!marks.some((m) => m.j === j && m.seat === w.seat)) marks.push({ j, seat: w.seat, letter: "W", street: "showdown" });
    }
  }
  placePre();

  const projected: { label: StripLabelText; j: number }[] = [];
  let total = j;
  if (!input.complete) {
    const live = input.folded.filter((f, i) => input.inHand[i] && !f).length;
    let k = j + Math.max(1, live); // the rest of this street
    for (const s of NEXT_STREETS[input.street]) {
      projected.push({ label: LABEL_OF[s], j: ++k });
      k += live;
    }
    projected.push({ label: "SHOW", j: ++k });
    total = k;
  }
  total = Math.max(1, total);
  const at = (t: number) => Math.min(1, t / total);
  const now = input.complete ? 1 : at(j);

  const rows: StripRow[] = seats
    .filter((s) => s.kind !== "empty" && (input.inHand[s.seat] || marks.some((m) => m.seat === s.seat)))
    .map((s) => ({
      seat: s.seat,
      label: s.label,
      name: s.name,
      out: s.out,
      marks: marks.filter((m) => m.seat === s.seat).map((m) => ({ letter: m.letter, at: at(m.j), street: m.street })),
      lineTo: foldAt.has(s.seat) ? at(foldAt.get(s.seat)!) : now,
    }));
  return {
    labels: [
      ...labels.map((l) => ({ label: l.label, at: at(l.j), future: false })),
      ...projected.map((l) => ({ label: l.label, at: at(l.j), future: true })),
    ],
    rows,
    now,
  };
}

/**
 * Street labels drawn as their initial (`F T R S`): both neighbours of a gap narrower than half of each
 * label plus a space, as on the reference (an all-in runout puts FLOP TURN RIVER SHOW one tick apart).
 * `trackPx` is the width the `at` fractions span, `chPx` one character.
 */
export function shortLabels(labels: readonly { label: string; at: number }[], trackPx: number, chPx: number): boolean[] {
  const short = labels.map(() => false);
  for (let t = 1; t < labels.length; t++) {
    const room = (labels[t].at - labels[t - 1].at) * trackPx;
    if (room < ((labels[t].label.length + labels[t - 1].label.length) / 2 + 1) * chPx) short[t] = short[t - 1] = true;
  }
  return short;
}

function describe(e: TimelineEvent | undefined, seats: SeatModel[]): string {
  if (!e) return "";
  const who = (seat: number) => `Seat ${seat + 1}, ${seats[seat]?.name ?? ""}`;
  switch (e.kind) {
    case "blind":
      return `${who(e.seat)} posts the ${e.blind} blind, ${fmt(e.amount)}`;
    case "action":
      return `${who(e.seat)}: ${actionText(e).toLowerCase()}`;
    case "deal":
      return `The ${e.street} is dealt`;
    case "end":
      return e.winners.map((w) => `${who(w.seat)} wins ${fmt(w.amount)}`).join(". ");
  }
}

// ---------------------------------------------------------------------------
// Adapters

/** Engine events to timeline events, with engine seats mapped to table seats. */
export function timelineFromEvents(events: readonly HandEvent[], tableSeat: (s: number) => number = (s) => s): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  let winners: { seat: number; amount: number }[] | null = null;
  for (const e of events) {
    switch (e.type) {
      case "blind":
        out.push({ kind: "blind", seat: tableSeat(e.seat), blind: e.blind, amount: e.amount, allIn: e.allIn });
        break;
      case "action":
        out.push({ kind: "action", seat: tableSeat(e.seat), street: e.street, action: e.action, to: e.to, allIn: e.allIn });
        break;
      case "deal":
        out.push({ kind: "deal", street: e.street });
        break;
      case "award":
        winners ??= [];
        e.winners.forEach((w, k) => winners!.push({ seat: tableSeat(w), amount: e.shares[k] }));
        break;
      default:
        break;
    }
  }
  if (winners) out.push({ kind: "end", winners });
  return out;
}

export interface ModelOptions {
  handNo: number;
  /** Seat kinds; default: the hero is human, everyone else a bot. */
  kinds?: ("human" | "bot")[];
}

/**
 * Solo: the table as `heroSeat` sees it (null = spectator, every hole card face down until showdown).
 * Reads public fields, the hero's own hole cards and the showdown events. Never `state.deck`.
 */
export function modelFromHand(state: HandState, heroSeat: number | null, names: readonly string[], opts: ModelOptions): TableModel {
  const n = state.seatCount;
  const shown = showdownCards(state.events);
  const holeCards: HoleCards[] = [];
  const revealed: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (i === heroSeat) {
      holeCards.push(state.holeCards[i].slice());
      revealed.push(false);
    } else if (shown.has(i)) {
      holeCards.push(shown.get(i)!.cards);
      revealed.push(true);
    } else {
      holeCards.push("hidden");
      revealed.push(false);
    }
  }
  return buildModel({
    handNo: opts.handNo,
    seats: names.slice(0, n).map((name, i) => ({ name, kind: opts.kinds?.[i] ?? (i === heroSeat ? "human" : "bot") })),
    button: state.button,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    street: state.street,
    board: state.board.slice(),
    pot: potTotal(state),
    stacks: state.stacks.slice(),
    startingStacks: state.startingStacks.slice(),
    committed: state.committed.slice(),
    folded: state.folded.slice(),
    inHand: new Array(n).fill(true),
    toAct: state.toAct.length > 0 ? state.toAct[0] : null,
    complete: state.complete,
    showdown: state.result?.showdown ?? false,
    timeline: timelineFromEvents(state.events),
    holeCards,
    revealed,
    categories: Array.from({ length: n }, (_, i) => shown.get(i)?.category ?? null),
    heroSeat,
  });
}

/** Same as the engine's potTotal: collected pots plus outstanding bets, 0 once the hand is over. */
const potTotal = (s: HandState): number => (s.complete ? 0 : s.committed.reduce((a, b) => a + b, 0));

function showdownCards(events: readonly HandEvent[]): Map<number, { cards: Card[]; category: string }> {
  const out = new Map<number, { cards: Card[]; category: string }>();
  for (const e of events) {
    if (e.type === "showdown") out.set(e.seat, { cards: e.cards.slice(), category: handCategory(e.value).toUpperCase() });
  }
  return out;
}

export interface PublicViewOptions extends ModelOptions {
  /** Showdown cards the server revealed, by view seat. Merged with any showdown events in the view. */
  revealed?: { seat: number; cards: Card[]; category?: string }[];
}

/**
 * A seat's PublicView (no deck, no foreign hole cards) plus its own cards. `ownCards` null = spectator.
 * For multiplayer, the same view-seat space is used for names, kinds and revealed cards.
 */
export function modelFromPublicView(
  view: PublicView,
  ownCards: readonly Card[] | null,
  names: readonly string[],
  opts: PublicViewOptions,
): TableModel {
  const n = view.seatCount;
  const shown = showdownCards(view.events);
  for (const r of opts.revealed ?? []) {
    shown.set(r.seat, { cards: r.cards.slice(), category: r.category?.toUpperCase() ?? shown.get(r.seat)?.category ?? "" });
  }
  const hero = ownCards ? view.seat : null;
  const holeCards: HoleCards[] = [];
  const revealed: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (i === hero) {
      holeCards.push(ownCards!.slice());
      revealed.push(false);
    } else if (shown.has(i)) {
      holeCards.push(shown.get(i)!.cards);
      revealed.push(true);
    } else {
      holeCards.push("hidden");
      revealed.push(false);
    }
  }
  const showdown = view.events.some((e) => e.type === "showdown") || (opts.revealed?.length ?? 0) > 1;
  return buildModel({
    handNo: opts.handNo,
    seats: names.slice(0, n).map((name, i) => ({ name, kind: opts.kinds?.[i] ?? (i === hero ? "human" : "bot") })),
    button: view.button,
    smallBlind: view.smallBlind,
    bigBlind: view.bigBlind,
    street: view.street,
    board: view.board.slice(),
    pot: view.pot,
    stacks: view.stacks.slice(),
    startingStacks: view.startingStacks.slice(),
    committed: view.committed.slice(),
    folded: view.folded.slice(),
    inHand: new Array(n).fill(true),
    toAct: view.toAct,
    complete: view.complete,
    showdown,
    timeline: timelineFromEvents(view.events),
    holeCards,
    revealed,
    categories: Array.from({ length: n }, (_, i) => shown.get(i)?.category || null),
    heroSeat: hero,
  });
}

/** A table before the first hand: everyone seated with their stack, no cards, no button. */
export function emptyTableModel(
  seats: (SeatSource | null)[],
  stacks: readonly number[],
  opts: { heroSeat: number | null; smallBlind: number; bigBlind: number },
): TableModel {
  const n = seats.length;
  return buildModel({
    handNo: 0,
    seats,
    button: null,
    smallBlind: opts.smallBlind,
    bigBlind: opts.bigBlind,
    street: "preflop",
    board: [],
    pot: 0,
    stacks: Array.from({ length: n }, (_, i) => stacks[i] ?? 0),
    committed: new Array(n).fill(0),
    folded: new Array(n).fill(false),
    inHand: new Array(n).fill(false),
    toAct: null,
    complete: false,
    showdown: false,
    timeline: [],
    holeCards: new Array(n).fill(null),
    revealed: new Array(n).fill(false),
    categories: new Array(n).fill(null),
    heroSeat: opts.heroSeat,
  });
}
