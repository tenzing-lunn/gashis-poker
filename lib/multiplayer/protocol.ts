// Wire protocol between the browser and the table server (one Durable Object per table).
// Framework-free: shared by lib/multiplayer/room.ts, the worker in table-server/ and the browser client.
//
// Every message is one JSON object with a `type`. Cards travel as two-character strings ("As", "Td").
// Server messages carry a `seq` that increases by one or more with every message the server sends.

import type { Action, Street } from "../engine/engine";
import type { PersonaId } from "../bots/personas";

export const PROTOCOL_VERSION = 1;

/** A card as text, e.g. "As" or "7h" (see lib/poker/cards.ts formatCard). */
export type CardText = string;

// ---------------------------------------------------------------------------
// Client -> server

export type ClientMessage =
  /** `sit`: a new player takes the lowest free seat at once (ignored when the token reclaims a player). */
  | { type: "join"; name: string; token?: string; sit?: boolean }
  | { type: "sit"; seat: number }
  | { type: "stand" }
  | { type: "act"; handNo: number; action: Action }
  | { type: "addBot"; seat: number; persona: PersonaId }
  | { type: "removeBot"; seat: number }
  | { type: "start" }
  /** Leave the table: stand up (after the hand if dealt in) and let the host put a bot in with these chips. */
  | { type: "leave" }
  /** Host: a bot takes this human's seat and chips (after the hand if they are dealt in). */
  | { type: "replaceWithBot"; seat: number; persona: PersonaId }
  /** Host: this human stands up (after the hand if dealt in) and watches. */
  | { type: "removePlayer"; seat: number }
  /** Host: the table ends after the hand in progress; everyone gets the final chips, then it closes. */
  | { type: "endTable" }
  | { type: "ping"; id?: number };

export const PERSONA_ID_LIST: readonly PersonaId[] = ["nit", "tag", "lag", "station", "maniac", "micro"];

/** Largest client message accepted, in characters. */
export const MAX_CLIENT_MESSAGE_LENGTH = 1024;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x);
const isSeat = (x: unknown): x is number => isInt(x) && x >= 0 && x < 16;

function parseAction(x: unknown): Action | null {
  if (!isObj(x)) return null;
  switch (x.type) {
    case "fold":
    case "check":
    case "call":
      return { type: x.type };
    case "raise":
      return isInt(x.to) && x.to > 0 ? { type: "raise", to: x.to } : null;
    default:
      return null;
  }
}

/**
 * Parses and validates one raw client message. Returns a clean copy (unknown fields dropped) or null
 * when the message is malformed. Semantic checks (whose turn, seat free, ...) happen in the room.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  let x: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > MAX_CLIENT_MESSAGE_LENGTH) return null;
    try {
      x = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(x)) return null;
  switch (x.type) {
    case "join": {
      if (typeof x.name !== "string" || x.name.length > 200) return null;
      if (x.token !== undefined && (typeof x.token !== "string" || x.token.length > 100)) return null;
      if (x.sit !== undefined && typeof x.sit !== "boolean") return null;
      const join: Extract<ClientMessage, { type: "join" }> = x.token === undefined ? { type: "join", name: x.name } : { type: "join", name: x.name, token: x.token };
      if (x.sit === true) join.sit = true;
      return join;
    }
    case "sit":
      return isSeat(x.seat) ? { type: "sit", seat: x.seat } : null;
    case "stand":
      return { type: "stand" };
    case "start":
      return { type: "start" };
    case "leave":
      return { type: "leave" };
    case "endTable":
      return { type: "endTable" };
    case "replaceWithBot":
      return isSeat(x.seat) && PERSONA_ID_LIST.includes(x.persona as PersonaId)
        ? { type: "replaceWithBot", seat: x.seat, persona: x.persona as PersonaId }
        : null;
    case "removePlayer":
      return isSeat(x.seat) ? { type: "removePlayer", seat: x.seat } : null;
    case "act": {
      const action = parseAction(x.action);
      return isInt(x.handNo) && action ? { type: "act", handNo: x.handNo, action } : null;
    }
    case "addBot":
      return isSeat(x.seat) && PERSONA_ID_LIST.includes(x.persona as PersonaId)
        ? { type: "addBot", seat: x.seat, persona: x.persona as PersonaId }
        : null;
    case "removeBot":
      return isSeat(x.seat) ? { type: "removeBot", seat: x.seat } : null;
    case "ping":
      if (x.id !== undefined && !isInt(x.id)) return null;
      return x.id === undefined ? { type: "ping" } : { type: "ping", id: x.id };
    default:
      return null;
  }
}

/** NFKC-normalizes, trims, strips control and formatting characters, collapses whitespace; null if not 1-16 chars. */
export function sanitizeName(name: string): string | null {
  const clean = name
    .normalize("NFKC")
    .replace(/[\p{C}<>]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(clean);
  if (chars.length < 1 || chars.length > 16) return null;
  return clean;
}

// ---------------------------------------------------------------------------
// Server -> client

export interface TableConfigPublic {
  seats: number;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  /** Time per decision, ms. */
  turnMs: number;
}

export interface SeatInfo {
  playerId: string;
  name: string;
  kind: "human" | "bot";
  persona: PersonaId | null;
  /** Chips behind (during a hand: what is left after this hand's bets). */
  stack: number;
  /** Bots are always connected. */
  connected: boolean;
  sittingOut: boolean;
  /** Dealt into the current hand. */
  inHand: boolean;
  /** Stood up (or removed) during a hand; the seat frees when the hand ends. */
  leaving: boolean;
  /** A bot standing in for this human (by name), who gets the seat back on returning if they were away. */
  replaces?: string;
  /** That human's playerId (so they can tell it is their chips). */
  replacesId?: string;
  /** They may take the seat back from this bot. */
  reclaimable?: boolean;
  /** They are back: the bot hands the seat over when this hand ends. */
  reclaiming?: boolean;
}

/** One player's chips when the table ended. */
export interface FinalRow {
  name: string;
  kind: "human" | "bot";
  /** Chips at the end (a human's include those of a bot that stood in for them). */
  stack: number;
  /** `stack` minus every buy-in and rebuy. */
  net: number;
}

export interface PublicAction {
  seat: number;
  street: Street;
  action: "fold" | "check" | "call" | "bet" | "raise";
  /** Chips moved into the pot by this action. */
  amount: number;
  /** The seat's street bet after the action. */
  to: number;
  allIn: boolean;
  /** Set when the server acted for the player (turn clock ran out, sitting out or leaving). */
  auto?: boolean;
  /** Set (with `auto`) only when the player's turn clock ran out. */
  timedOut?: true;
}

export interface PublicLegal {
  seat: number;
  toCall: number;
  callAmount: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  isBet: boolean;
}

/** The public part of a hand in progress. Seats are table seats. No hole cards, no deck. */
export interface PublicHand {
  handNo: number;
  button: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  smallBlind: number;
  bigBlind: number;
  street: Street;
  board: CardText[];
  /** Everything in the middle: collected pots plus outstanding bets. */
  pot: number;
  /** One entry per dealt-in seat, in table-seat order. */
  players: { seat: number; stack: number; bet: number; committed: number; folded: boolean; allIn: boolean }[];
  actions: PublicAction[];
  /** What the seat on the clock may do (public: it follows from stacks and bets). */
  legal: PublicLegal | null;
  complete: boolean;
}

export interface HandResultPublic {
  handNo: number;
  board: CardText[];
  /** False when everyone else folded. */
  showdown: boolean;
  pots: { amount: number; winners: number[]; shares: number[] }[];
  /** Net chips per dealt-in seat. */
  net: { seat: number; amount: number }[];
  /** Hole cards of the players who reached showdown only. Folded and uncontested hands stay hidden. */
  revealed: { seat: number; cards: CardText[]; category: string }[];
}

export interface TableState {
  config: TableConfigPublic;
  started: boolean;
  hostId: string | null;
  seats: (SeatInfo | null)[];
  /** Table seat of the button of the current (or last) hand. */
  button: number | null;
  /** Number of the current hand, or of the last one between hands; 0 before the first. */
  handNo: number;
  hand: PublicHand | null;
  /** Table seat on the clock, or null. */
  toAct: number | null;
  /** When the clock of `toAct` runs out, epoch ms (server clock), or null for a bot. */
  deadline: number | null;
  /** When the next hand is dealt, epoch ms, while results are shown. */
  nextHandAt: number | null;
  lastResult: HandResultPublic | null;
  /** Server time when this snapshot was made, for clock-offset estimates. */
  serverNow: number;
  /** The host ended the table; it closes after the hand in progress. */
  ending: boolean;
  /** Set on the last state before the table closes: everyone's final chips. */
  ended: { rows: FinalRow[] } | null;
  /**
   * Per seat: the human who left it empty and the chips they left with, so the host can put a bot in with
   * those chips (`addBot` there takes them). Null where nobody left.
   */
  vacated: ({ name: string; stack: number } | null)[];
}

export type ErrorCode =
  | "malformed"
  | "rate_limited"
  | "not_joined"
  | "already_joined"
  | "bad_name"
  | "name_taken"
  | "bad_seat"
  | "seat_taken"
  | "already_seated"
  | "not_seated"
  | "not_host"
  | "already_started"
  | "not_in_hand"
  | "stale_hand"
  | "not_your_turn"
  | "illegal_action"
  | "not_human"
  | "table_full";

export type ServerMessageBody =
  | { type: "welcome"; protocol: number; you: { playerId: string; token: string; seat: number | null; isHost: boolean } }
  | { type: "state"; state: TableState }
  | { type: "hole"; handNo: number; seat: number; cards: CardText[] }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "pong"; id?: number; serverNow: number };

export type ServerMessage = ServerMessageBody & { seq: number };
