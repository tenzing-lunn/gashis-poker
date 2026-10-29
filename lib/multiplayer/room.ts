// One poker table: every rule of the multiplayer game, as a pure class with no platform code.
//
// The Durable Object in table-server/src/table.ts is a thin adapter around it: it forwards socket
// events and alarms, implements `send` / `setAlarm`, and stores `serialize()` after each change.
// Tests drive it the same way with a fake clock and fake sockets (room.test.ts).
//
// The server is authoritative. Only this class holds the HandState (deck and every hole card). Clients
// get a public snapshot (`state`), their own cards (`hole`, only on their own connections) and, once a
// hand is over, the cards of the players who reached showdown.
//
// Timing uses one alarm: the next due event is either the player on the clock (a human's deadline or a
// bot's think delay) or the next deal after a finished hand. `onAlarm` handles whatever is due and the
// room asks for the next alarm through `setAlarm`.
//
// Between hands the host deals: the next hand waits for the host's `next`, with a `hostWaitMs` backstop.
// With no host here to click (disconnected or sitting out), it is dealt `resultMs` after the hand ended
// instead (see nextHandDue).
//
// A table nobody is connected to for `idleMs` closes: `closed` turns true and the platform wipes its
// storage, so the table code can be reused and a stale link says the table is gone.

import {
  applyAction,
  createHand,
  IllegalActionError,
  legalActions,
  type LegalActions,
  potTotal,
  seatToAct,
  type Action,
  type HandState,
} from "../engine/engine";
import { PERSONAS, type PersonaId } from "../bots/personas";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "./config";
import { chooseAction } from "../bots/policy";
import { botView } from "../bots/view";
import { createRng, formatCard, FULL_DECK, type Card } from "../poker/cards";
import { handCategory } from "../poker/evaluator";
import {
  parseClientMessage,
  PROTOCOL_VERSION,
  sanitizeName,
  type ClientMessage,
  type ErrorCode,
  type FinalRow,
  type HandResultPublic,
  type PublicAction,
  type PublicHand,
  type SeatInfo,
  type ServerMessage,
  type ServerMessageBody,
  type TableState,
} from "./protocol";

export interface RoomDeps {
  /** Epoch ms. */
  now(): number;
  send(connId: string, msg: ServerMessage): void;
  /** Closes a connection from the server side with a WebSocket close code (the room has already forgotten it). */
  close(connId: string, code: number, reason: string): void;
  /** Ask for `onAlarm` at epoch ms `at`, replacing any earlier request; null cancels. */
  setAlarm(at: number | null): void;
  /** Uniform uint32. Shuffles, tokens, ids and bot decisions all come from here (use a CSPRNG in production). */
  random(): number;
}

export { DEFAULT_ROOM_CONFIG, type RoomConfig } from "./config";

export const MIN_TABLE_SEATS = 2;
export const MAX_TABLE_SEATS = 8;

/** The `seats` query parameter of /tables/new (default 6); null when it is not a seat count. */
export function parseSeatsParam(raw: string | null): number | null {
  if (raw === null) return 6;
  return /^[2-8]$/.test(raw) ? Number(raw) : null;
}
/** Most player records (seated or watching) a table keeps; past it the longest-gone watcher is dropped. */
const MAX_PLAYERS = 200;
/** Most open connections (sockets) a table keeps. */
export const MAX_CONNECTIONS = 64;
/**
 * Sockets accepted past MAX_CONNECTIONS while some watcher could be evicted: room for a seated player or
 * the host to get back in when watchers fill the table. Anyone else is turned away when they join.
 */
const EXTRA_CONNECTIONS = 8;
/** A connection that has not joined within this long is closed, ms. */
const JOIN_TIMEOUT_MS = 15_000;
/** How long the host may be disconnected before the host role moves on, ms. */
const HOST_GRACE_MS = 30_000;
/** After an alarm throws, the next one is at least this far off, doubling per failure up to the max, ms. */
const ALARM_BACKOFF_MS = 1_000;
const ALARM_BACKOFF_MAX_MS = 30_000;

interface Player {
  id: string;
  /** Secret that reclaims this player on reconnect. Empty for bots. */
  token: string;
  name: string;
  kind: "human" | "bot";
  persona: PersonaId | null;
  seat: number | null;
  /** Chips: at the table while seated, and kept after standing up so re-sitting restores them. */
  stack: number;
  /** When the player last sat down, epoch ms (host succession goes to the longest seated). */
  seatedAt: number;
  /** When the player joined or their last connection closed, epoch ms. */
  lastSeen: number;
  sittingOut: boolean;
  timeouts: number;
  /** Stood up or removed mid-hand: acts check/fold automatically and leaves when the hand ends. */
  leaving: boolean;
  /** Chips bought in so far: the first buy-in and every rebuy (the table's final net is stack minus this). */
  buyIns: number;
  /** Bots: the human this bot stands in for (it plays their chips), or null. */
  replaces: string | null;
  /** Bots: the human was away when replaced, so they get the seat back on returning. */
  reclaimable: boolean;
  /** What happens when the seat frees (see unseat); null for a plain stand. */
  exit: Exit | null;
}

/**
 * Why a seat is being given up. `leave` / `remove`: the human left or the host took them out; the seat
 * remembers their chips for a bot. `bot`: the host put a bot in with their chips. `reclaim` (bots): the
 * human it stands in for came back and takes the seat at the end of the hand.
 */
type Exit = { kind: "leave" } | { kind: "remove"; away: boolean } | { kind: "bot"; persona: PersonaId; away: boolean } | { kind: "reclaim" };

/**
 * A seat someone gave up with chips, kept for a bot the host may put in with those chips. `away`: they left,
 * or were away when the host took them out, so they get the seat back from that bot on returning; false when
 * the host took them out while they were at the table.
 */
interface Vacated {
  id: string;
  away: boolean;
}

/** A bot that left the table, kept for the final results. */
interface RetiredBot {
  name: string;
  /** The human it stood in for (its result counts as theirs), or null. */
  replaces: string | null;
  stack: number;
  buyIns: number;
}

interface HandRecord {
  no: number;
  state: HandState;
  /** Table seat of each engine seat. */
  seats: number[];
  actions: PublicAction[];
  /** When the seat on the clock must (human) or will (bot) act. Null once the hand is complete. */
  turnDue: number | null;
}

interface Conn {
  playerId: string | null;
  /** Epoch ms; unjoined connections are closed JOIN_TIMEOUT_MS after this. */
  openedAt: number;
  /** Recent message times, for rate limiting (not persisted). */
  times: number[];
}

export interface RoomSnapshot {
  /** 2; version 1 snapshots may lack conns[].openedAt and players[].lastSeen / seatedAt. */
  v: 1 | 2;
  config: RoomConfig;
  seq: number;
  players: Player[];
  seats: (string | null)[];
  conns: { id: string; playerId: string | null; openedAt: number }[];
  started: boolean;
  hostId: string | null;
  button: number | null;
  handNo: number;
  hand: HandRecord | null;
  lastResult: HandResultPublic | null;
  /** Missing in older snapshots, which kept `nextHandAt` (the deal time) instead. */
  handEndedAt?: number | null;
  /**
   * When the next hand is due, or null. Older snapshots kept only this (restored as the hand's end); newer ones
   * still write it so an older build restoring them finds a number or null. Restore prefers `handEndedAt`.
   */
  nextHandAt?: number | null;
  /** Missing in older snapshots. */
  idleSince?: number | null;
  /** Missing in older snapshots. */
  /** Older snapshots of this branch kept only the player id (counted as `away`). */
  vacated?: (Vacated | string | null)[];
  retired?: RetiredBot[];
  ending?: boolean;
  ended?: { rows: FinalRow[] } | null;
}

/** Set while `restore` constructs a room, so the constructor leaves scheduling to restore. */
let restoring = false;

export class TableRoom {
  private readonly deps: RoomDeps;
  private config: RoomConfig;
  private seq: number;
  private players = new Map<string, Player>();
  private seats: (string | null)[];
  private conns = new Map<string, Conn>();
  private started = false;
  private hostId: string | null = null;
  private button: number | null = null;
  private handNo = 0;
  private hand: HandRecord | null = null;
  private lastResult: HandResultPublic | null = null;
  /** When the last hand ended, epoch ms, while the next one is pending (see nextHandDue); else null. */
  private handEndedAt: number | null = null;
  /** Per seat: the human who left it (or was taken out) with chips a bot can take over. */
  private vacated: (Vacated | null)[];
  private retired: RetiredBot[] = [];
  /** The host ended the table: it closes when no hand is running. */
  private ending = false;
  private ended: { rows: FinalRow[] } | null = null;
  /** Since when the table has had no connection, epoch ms; null while anyone is connected. */
  private idleSince: number | null;
  /**
   * While anyone is connected: a wake-up idleMs out (not persisted), so that sockets lost without a close
   * event (a deploy restarts the object) are noticed. The platform's constructor then syncs connections
   * with the sockets that are really open, and the idle clock starts.
   */
  private backstopAt: number | null = null;
  private isClosed = false;

  private broadcastPending = false;
  private persistPending = false;
  private alarmAt: number | null | undefined = undefined;
  /** Consecutive alarms that threw, and the earliest the next alarm may fire meanwhile (not persisted). */
  private alarmFailures = 0;
  private alarmNotBefore: number | null = null;

  constructor(deps: RoomDeps, config: Partial<RoomConfig> = {}) {
    this.deps = deps;
    this.config = { ...DEFAULT_ROOM_CONFIG, ...config };
    const n = this.config.seats;
    if (!Number.isInteger(n) || n < MIN_TABLE_SEATS || n > MAX_TABLE_SEATS) {
      throw new Error(`A table has ${MIN_TABLE_SEATS}-${MAX_TABLE_SEATS} seats, got ${n}`);
    }
    this.seats = new Array(n).fill(null);
    this.vacated = new Array(n).fill(null);
    this.idleSince = deps.now();
    // Starting from the clock keeps `seq` increasing even across a restore that lost a few un-persisted
    // pongs (see restore): the clock advances far faster than messages are sent.
    this.seq = deps.now();
    this.persistPending = true;
    // The idle deadline of a table nobody has opened yet (restore schedules once it is filled in).
    if (!restoring) this.schedule();
  }

  // -------------------------------------------------------------------------
  // Platform events

  /**
   * Registers a new socket. False (nothing registered) when the table is full: MAX_CONNECTIONS, or up to
   * EXTRA_CONNECTIONS more while a watcher could make room for a returning player (see join).
   */
  onConnect(connId: string): boolean {
    if (!this.conns.has(connId)) {
      const n = this.conns.size;
      if (n >= MAX_CONNECTIONS && (n >= MAX_CONNECTIONS + EXTRA_CONNECTIONS || this.evictableConn() === undefined)) return false;
      this.addConn(connId);
      this.schedule(); // its join deadline
    }
    return true;
  }

  onClose(connId: string): void {
    if (!this.conns.has(connId)) return;
    this.dropConn(connId);
    this.flush();
  }

  onMessage(connId: string, raw: unknown): void {
    let conn = this.conns.get(connId);
    if (!conn) {
      // A socket the room never registered (onConnect should have): only adopted while there is room.
      if (this.conns.size >= MAX_CONNECTIONS) {
        this.error(connId, "table_full", "This table is full");
        this.deps.close(connId, 4001, "Table full");
        return;
      }
      conn = this.addConn(connId);
    }
    try {
      const now = this.deps.now();
      const windowStart = now - this.config.rateWindowMs;
      while (conn.times.length > 0 && conn.times[0] <= windowStart) conn.times.shift();
      if (conn.times.length >= this.config.rateLimit) {
        this.error(connId, "rate_limited", "Too many messages; slow down");
        return;
      }
      conn.times.push(now);

      const msg = parseClientMessage(raw);
      if (!msg) this.error(connId, "malformed", "Malformed message");
      else this.handle(connId, conn, msg);
    } finally {
      // Even if handling threw part-way: tell everyone what did change and keep the alarm armed.
      this.flush();
    }
  }

  onAlarm(): void {
    this.alarmAt = undefined; // the platform alarm has fired; always re-arm below
    if (this.isClosed) return;
    if (this.idleSince !== null && this.deps.now() >= this.idleSince + this.config.idleMs) {
      this.isClosed = true;
      this.deps.setAlarm(null);
      this.alarmAt = null;
      return;
    }
    if (this.backstopAt !== null && this.deps.now() >= this.backstopAt) this.backstopAt = this.deps.now() + this.config.idleMs;
    let ok = false;
    try {
      for (let guard = 0; guard < 1000; guard++) {
        const now = this.deps.now();
        const h = this.hand;
        const dealAt = this.nextHandDue();
        if (h && !h.state.complete && h.turnDue !== null && now >= h.turnDue) this.turnDue();
        else if (dealAt !== null && now >= dealAt) this.nextHand();
        else break;
      }
      const now = this.deps.now();
      for (const [id, c] of [...this.conns]) {
        if (c.playerId === null && now >= c.openedAt + JOIN_TIMEOUT_MS) {
          this.conns.delete(id);
          this.persistPending = true;
          this.deps.close(id, 4000, "Join timed out");
        }
      }
      ok = true;
    } finally {
      // A handler that throws leaves its event due: back off instead of refiring it at once, forever.
      if (ok) {
        this.alarmFailures = 0;
        this.alarmNotBefore = null;
      } else {
        this.alarmFailures += 1;
        this.alarmNotBefore = this.deps.now() + Math.min(ALARM_BACKOFF_MAX_MS, ALARM_BACKOFF_MS * 2 ** (this.alarmFailures - 1));
      }
      this.flush();
    }
  }

  /** Reconciles connections after a restore with the sockets that are actually still open. */
  syncConnections(liveConnIds: readonly string[]): void {
    const live = new Set(liveConnIds);
    for (const id of [...this.conns.keys()]) if (!live.has(id)) this.dropConn(id);
    for (const id of live) if (!this.conns.has(id)) this.addConn(id);
    this.flush();
  }

  /**
   * The table is over (it sat empty for `idleMs`, or the host ended it): the platform should delete
   * everything it stored.
   */
  get closed(): boolean {
    return this.isClosed;
  }

  /** True once if anything worth persisting changed since the last call. */
  consumeDirty(): boolean {
    const d = this.persistPending;
    this.persistPending = false;
    return d;
  }

  // -------------------------------------------------------------------------
  // Persistence

  serialize(): RoomSnapshot {
    return structuredCloneJson({
      v: 2,
      config: this.config,
      seq: this.seq,
      players: [...this.players.values()],
      seats: this.seats,
      conns: [...this.conns].map(([id, c]) => ({ id, playerId: c.playerId, openedAt: c.openedAt })),
      started: this.started,
      hostId: this.hostId,
      button: this.button,
      handNo: this.handNo,
      hand: this.hand,
      lastResult: this.lastResult,
      handEndedAt: this.handEndedAt,
      nextHandAt: this.nextHandDue(),
      idleSince: this.idleSince,
      vacated: this.vacated,
      retired: this.retired,
      ending: this.ending,
      ended: this.ended,
    });
  }

  static restore(snapshot: RoomSnapshot, deps: RoomDeps): TableRoom {
    if (snapshot.v !== 1 && snapshot.v !== 2) throw new Error(`Unknown room snapshot version ${String(snapshot.v)}`);
    const s = structuredCloneJson(snapshot);
    restoring = true;
    let room: TableRoom;
    try {
      room = new TableRoom(deps, s.config);
    } finally {
      restoring = false;
    }
    const now = deps.now();
    // Version 1 snapshots may lack these times: count from the restore rather than compute NaN deadlines.
    const time = (t: number | undefined): number => (typeof t === "number" && Number.isFinite(t) ? t : now);
    room.seq = Math.max(s.seq, now);
    room.players = new Map(
      s.players.map((p) => [
        p.id,
        {
          ...p,
          lastSeen: time(p.lastSeen),
          seatedAt: time(p.seatedAt),
          // Older snapshots lack these: count one buy-in for anyone holding chips.
          buyIns: p.buyIns ?? (p.stack > 0 || p.seat !== null ? s.config.startingStack : 0),
          replaces: p.replaces ?? null,
          reclaimable: p.reclaimable ?? false,
          exit: p.exit ?? null,
        },
      ]),
    );
    room.seats = s.seats;
    room.conns = new Map(s.conns.map((c) => [c.id, { playerId: c.playerId, openedAt: time(c.openedAt), times: [] }]));
    room.started = s.started;
    room.hostId = s.hostId;
    room.button = s.button;
    room.handNo = s.handNo;
    room.hand = s.hand;
    room.lastResult = s.lastResult;
    room.handEndedAt = s.handEndedAt !== undefined ? s.handEndedAt : (s.nextHandAt ?? null);
    room.idleSince = s.idleSince !== undefined ? s.idleSince : room.conns.size === 0 ? now : null;
    room.vacated = (s.vacated ?? new Array(s.config.seats).fill(null)).map((v) => (typeof v === "string" ? { id: v, away: true } : v));
    room.retired = s.retired ?? [];
    room.ending = s.ending ?? false;
    room.ended = s.ended ?? null;
    // Saved between the last state and the wipe: finish the close.
    if (room.ended) room.isClosed = true;
    room.persistPending = false;
    room.schedule();
    return room;
  }

  /** Test and debugging hook: the full hidden hand (deck and all hole cards). Never send this to a client. */
  debugHand(): { no: number; seats: readonly number[]; state: HandState } | null {
    return this.hand ? { no: this.hand.no, seats: this.hand.seats, state: this.hand.state } : null;
  }

  /** The public snapshot every client receives. */
  publicState(): TableState {
    const h = this.hand;
    const live = h !== null && !h.state.complete;
    const engineSeatOf = (tableSeat: number): number => (h ? h.seats.indexOf(tableSeat) : -1);
    const seats = this.seats.map((pid, seat): SeatInfo | null => {
      const p = pid ? this.players.get(pid) : undefined;
      if (!p) return null;
      const e = engineSeatOf(seat);
      const info: SeatInfo = {
        playerId: p.id,
        name: p.name,
        kind: p.kind,
        persona: p.persona,
        stack: live && e >= 0 ? h.state.stacks[e] : p.stack,
        connected: p.kind === "bot" || this.isConnected(p.id),
        sittingOut: p.sittingOut,
        inHand: live && e >= 0,
        leaving: p.leaving,
      };
      const stood = p.replaces ? this.players.get(p.replaces) : undefined;
      if (stood) {
        info.replaces = stood.name;
        info.replacesId = stood.id;
        if (p.reclaimable) info.reclaimable = true;
        if (p.exit?.kind === "reclaim") info.reclaiming = true;
      }
      return info;
    });
    const toAct = live ? h.seats[seatToAct(h.state)!] : null;
    const toActPlayer = toAct !== null ? this.playerAt(toAct) : undefined;
    return {
      config: {
        seats: this.config.seats,
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
        startingStack: this.config.startingStack,
        turnMs: this.config.turnMs,
      },
      started: this.started,
      hostId: this.hostId,
      seats,
      button: this.button,
      handNo: this.handNo,
      hand: h ? publicHand(h) : null,
      toAct,
      deadline: toActPlayer && toActPlayer.kind === "human" && h ? h.turnDue : null,
      nextHandAt: this.nextHandDue(),
      waitingForHost: this.waitingForHost(),
      lastResult: this.lastResult,
      serverNow: this.deps.now(),
      ending: this.ending,
      ended: this.ended,
      vacated: this.vacated.map((v) => {
        const p = v ? this.players.get(v.id) : undefined;
        return p && p.seat === null && p.stack > 0 ? { name: p.name, stack: p.stack } : null;
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Client messages

  private handle(connId: string, conn: Conn, msg: ClientMessage): void {
    if (msg.type === "ping") {
      this.sendTo(connId, msg.id === undefined ? { type: "pong", serverNow: this.deps.now() } : { type: "pong", id: msg.id, serverNow: this.deps.now() });
      return;
    }
    if (msg.type === "join") {
      this.join(connId, conn, msg.name, msg.token, msg.sit === true);
      return;
    }
    const player = conn.playerId ? this.players.get(conn.playerId) : undefined;
    if (!player) {
      this.error(connId, "not_joined", "Send join first");
      return;
    }
    switch (msg.type) {
      case "sit":
        return this.sit(connId, player, msg.seat);
      case "stand":
        return this.stand(connId, player);
      case "act":
        return this.act(connId, player, msg.handNo, msg.action);
      case "addBot":
        return this.addBot(connId, player, msg.seat, msg.persona);
      case "removeBot":
        return this.removeBot(connId, player, msg.seat);
      case "start":
        return this.start(connId, player);
      case "leave":
        return this.leave(player);
      case "replaceWithBot":
        return this.replaceWithBot(connId, player, msg.seat, msg.persona);
      case "removePlayer":
        return this.removePlayer(connId, player, msg.seat);
      case "endTable":
        return this.endTable(connId, player);
      case "next":
        return this.next(connId, player);
    }
  }

  private join(connId: string, conn: Conn, rawName: string, token: string | undefined, sit: boolean): void {
    if (conn.playerId) {
      this.error(connId, "already_joined", "Already joined");
      return;
    }
    const name = sanitizeName(rawName);
    let player = token ? [...this.players.values()].find((p) => p.kind === "human" && p.token === token) : undefined;
    if (this.conns.size > MAX_CONNECTIONS) {
      // Over the cap: a seated player or the host coming back takes the oldest watcher's place; anyone
      // else is turned away. (A returning player with nobody to evict stays, within EXTRA_CONNECTIONS.)
      if (player && (player.seat !== null || player.id === this.hostId)) {
        const victim = this.evictableConn(connId);
        if (victim !== undefined) this.kick(victim);
      } else {
        this.kick(connId);
        return;
      }
    }
    if (player) {
      if (name && !this.nameTaken(name, player)) player.name = name;
      // Back after a bot took the seat while they were away: they get it back (or keep it, if the bot has
      // not sat down yet).
      if (player.seat !== null) this.cancelPendingBot(player);
      else this.reclaim(player);
    } else {
      if (!name) {
        this.error(connId, "bad_name", "Nickname must be 1-16 characters");
        return;
      }
      if (this.nameTaken(name, null)) {
        this.error(connId, "name_taken", "That nickname is taken at this table");
        return;
      }
      if (this.players.size >= MAX_PLAYERS && !this.forgetIdlePlayer()) {
        this.error(connId, "table_full", "This table has too many players");
        return;
      }
      player = {
        id: this.randomHex(2),
        token: this.randomHex(4), // 128 bits
        name,
        kind: "human",
        persona: null,
        seat: null,
        stack: 0,
        seatedAt: 0,
        lastSeen: this.deps.now(),
        sittingOut: false,
        timeouts: 0,
        leaving: false,
        buyIns: 0,
        replaces: null,
        reclaimable: false,
        exit: null,
      };
      this.players.set(player.id, player);
      this.hostId ??= player.id;
      if (sit) {
        const free = this.seats.indexOf(null);
        if (free >= 0) this.seatPlayer(player, free);
      }
    }
    conn.playerId = player.id;
    this.sendTo(connId, {
      type: "welcome",
      protocol: PROTOCOL_VERSION,
      you: { playerId: player.id, token: player.token, seat: player.seat, isHost: this.hostId === player.id },
    });
    this.sendHole(player, connId);
    this.changed();
    this.tryDeal();
  }

  private sit(connId: string, player: Player, seat: number): void {
    if (seat >= this.config.seats) return this.error(connId, "bad_seat", `Seats are 0-${this.config.seats - 1}`);
    if (player.seat === seat) {
      if (!player.sittingOut && !player.leaving) return this.error(connId, "already_seated", "Already in that seat");
      // Back before the bot the host put in while they were away sat down: they keep the seat.
      const back = player.exit?.kind === "bot" && player.exit.away;
      if (player.exit && player.exit.kind !== "leave" && !back) return this.error(connId, "bad_seat", "The host took you out of this seat");
      // Sitting in again at one's own seat: back from sitting out, or cancelling a stand.
      player.sittingOut = false;
      player.leaving = false;
      player.exit = null;
      player.timeouts = 0;
      this.changed();
      this.tryDeal();
      return;
    }
    if (player.seat !== null) return this.error(connId, "already_seated", "Stand up first");
    // A bot standing in for this player since they went away holds their chips: that seat is theirs again,
    // and they don't buy in fresh at another one.
    const standIn = this.reclaimableBotFor(player);
    if (standIn) {
      if (standIn.seat === seat && this.reclaim(player, seat)) return this.tryDeal();
      return this.error(connId, "bad_seat", `Your chips are in S${standIn.seat! + 1}: sit there to take them back`);
    }
    // A bot the host put in while this player was present plays their chips: no second stack.
    const holder = this.botHolding(player);
    if (holder) return this.error(connId, "bad_seat", `The host gave your chips to the bot in S${holder.seat! + 1}`);
    if (this.seats[seat] !== null) return this.error(connId, "seat_taken", "That seat is taken");
    this.seatPlayer(player, seat);
    this.tryDeal();
  }

  private stand(connId: string, player: Player): void {
    if (player.seat === null) return this.error(connId, "not_seated", "Not seated");
    this.leaveSeat(player);
  }

  private act(connId: string, player: Player, handNo: number, action: Action): void {
    const h = this.hand;
    if (!h || h.state.complete) return this.error(connId, "not_in_hand", "No hand in progress");
    if (handNo !== h.no) return this.error(connId, "stale_hand", `Hand ${handNo} is not the current hand (${h.no})`);
    if (player.seat === null || !h.seats.includes(player.seat)) return this.error(connId, "not_in_hand", "Not in this hand");
    if (h.seats[seatToAct(h.state)!] !== player.seat) return this.error(connId, "not_your_turn", "Not your turn");
    const la = legalActions(h.state)!;
    try {
      this.applyHandAction(action, false);
    } catch (e) {
      // The engine's message names engine seats, not table seats: describe it from the legal actions.
      if (e instanceof IllegalActionError) return this.error(connId, "illegal_action", illegalActionMessage(action, la));
      throw e;
    }
    player.timeouts = 0;
    player.sittingOut = false;
  }

  private addBot(connId: string, player: Player, seat: number, persona: PersonaId): void {
    if (!this.isHost(player)) return this.error(connId, "not_host", "Only the host can add bots");
    if (seat >= this.config.seats) return this.error(connId, "bad_seat", `Seats are 0-${this.config.seats - 1}`);
    if (this.seats[seat] !== null) return this.error(connId, "seat_taken", "That seat is taken");
    // A seat someone left with chips: the bot plays those chips for them.
    const v = this.vacated[seat];
    const left = v ? this.players.get(v.id) : undefined;
    if (v && left && left.seat === null && left.stack > 0) this.seatBotFor(left, seat, persona, v.away);
    else this.seatPlayer(this.newBot(persona), seat);
    this.tryDeal();
  }

  private newBot(persona: PersonaId): Player {
    const bot: Player = {
      id: this.randomHex(2),
      token: "",
      name: PERSONAS[persona].name,
      kind: "bot",
      persona,
      seat: null,
      stack: 0,
      seatedAt: 0,
      lastSeen: 0,
      sittingOut: false,
      timeouts: 0,
      leaving: false,
      buyIns: 0,
      replaces: null,
      reclaimable: false,
      exit: null,
    };
    this.players.set(bot.id, bot);
    return bot;
  }

  /** A bot takes `human`'s chips into `seat` (free now) and stands in for them; `away`: they may reclaim it. */
  private seatBotFor(human: Player, seat: number, persona: PersonaId, away: boolean): void {
    const bot = this.newBot(persona);
    bot.stack = human.stack;
    human.stack = 0;
    bot.replaces = human.id;
    bot.reclaimable = away;
    this.seatPlayer(bot, seat);
  }

  /**
   * `human` is back (or sits at `onlySeat`) while a bot they may reclaim holds their seat: the bot leaves at
   * the end of the hand it is in, or now, and the human sits there with its chips. False when there is none.
   */
  private reclaim(human: Player, onlySeat?: number): boolean {
    if (human.kind !== "human" || human.seat !== null) return false;
    const bot = this.reclaimableBotFor(human);
    if (!bot || (onlySeat !== undefined && bot.seat !== onlySeat)) return false;
    const h = this.hand;
    if (h && !h.state.complete && h.seats.includes(bot.seat!)) {
      // The bot plays out this hand (it doesn't fold it for leaving); nextHand swaps them.
      bot.exit = { kind: "reclaim" };
      this.changed();
    } else {
      this.swapBack(bot, human);
    }
    return true;
  }

  /** The seated bot playing `human`'s chips that they may take back, if any. */
  private reclaimableBotFor(human: Player): Player | undefined {
    for (const b of this.players.values()) if (b.kind === "bot" && b.replaces === human.id && b.reclaimable && b.seat !== null) return b;
    return undefined;
  }

  /** Any seated bot playing `human`'s chips, reclaimable or not. */
  private botHolding(human: Player): Player | undefined {
    for (const b of this.players.values()) if (b.kind === "bot" && b.replaces === human.id && b.seat !== null) return b;
    return undefined;
  }

  /** `player` is back while still in the seat a bot was to take over (they were away): the bot never sits. */
  private cancelPendingBot(player: Player): void {
    if (player.exit?.kind !== "bot" || !player.exit.away) return;
    player.exit = null;
    player.leaving = false;
    this.changed();
  }

  private swapBack(bot: Player, human: Player): void {
    const seat = bot.seat!;
    this.seats[seat] = null;
    this.players.delete(bot.id);
    human.stack += bot.stack;
    human.buyIns += bot.buyIns;
    this.seatPlayer(human, seat);
  }

  private removeBot(connId: string, player: Player, seat: number): void {
    if (!this.isHost(player)) return this.error(connId, "not_host", "Only the host can remove bots");
    const bot = seat < this.config.seats ? this.playerAt(seat) : undefined;
    if (!bot || bot.kind !== "bot") return this.error(connId, "bad_seat", "No bot in that seat");
    this.leaveSeat(bot);
  }

  /** Stands the player up for good (after the hand if dealt in); a host who leaves hands the role on at once. */
  private leave(player: Player): void {
    if (player.seat !== null) {
      player.exit = { kind: "leave" };
      this.leaveSeat(player);
    }
    if (this.isHost(player)) this.passHost(player);
  }

  private hostTarget(connId: string, player: Player, seat: number, what: string): Player | null {
    if (!this.isHost(player)) {
      this.error(connId, "not_host", `Only the host can ${what}`);
      return null;
    }
    const target = seat < this.config.seats ? this.playerAt(seat) : undefined;
    if (!target) {
      this.error(connId, "bad_seat", "Nobody sits there");
      return null;
    }
    if (target.kind !== "human") {
      this.error(connId, "not_human", "That seat holds a bot");
      return null;
    }
    if (target === player) {
      this.error(connId, "bad_seat", "Use LEAVE for your own seat");
      return null;
    }
    return target;
  }

  private replaceWithBot(connId: string, player: Player, seat: number, persona: PersonaId): void {
    const target = this.hostTarget(connId, player, seat, "put a bot in");
    if (!target) return;
    // Away (gone, sitting out or on the way out): they get the seat back when they return. A player taken out
    // while at the table does not.
    target.exit = { kind: "bot", persona, away: this.isAway(target) };
    this.leaveSeat(target);
    this.tryDeal();
  }

  private removePlayer(connId: string, player: Player, seat: number): void {
    const target = this.hostTarget(connId, player, seat, "remove a player");
    if (!target) return;
    target.exit = { kind: "remove", away: this.isAway(target) };
    this.leaveSeat(target);
  }

  /** Gone, sitting out or on the way out: a player the host replaces then may take the seat back. */
  private isAway(p: Player): boolean {
    return !this.isConnected(p.id) || p.sittingOut || p.leaving;
  }

  private endTable(connId: string, player: Player): void {
    if (!this.isHost(player)) return this.error(connId, "not_host", "Only the host can end the table");
    if (this.ending) return;
    this.ending = true;
    this.changed();
    const h = this.hand;
    if (!h || h.state.complete) this.endNow();
  }

  /** Host: deals the next hand now. Ignored unless a hand has ended and the next is pending (a late or second click). */
  private next(connId: string, player: Player): void {
    if (!this.isHost(player)) return this.error(connId, "not_host", "Only the host can deal the next hand");
    if (this.handEndedAt === null) return;
    this.nextHand();
  }

  private start(connId: string, player: Player): void {
    if (!this.isHost(player)) return this.error(connId, "not_host", "Only the host can start");
    if (this.started) return this.error(connId, "already_started", "Already started");
    this.started = true;
    this.changed();
    this.tryDeal();
  }

  // -------------------------------------------------------------------------
  // Seats

  private seatPlayer(player: Player, seat: number): void {
    this.seats[seat] = player.id;
    player.seat = seat;
    player.seatedAt = this.deps.now();
    // Re-sitting keeps the chips the player stood up with; only a busted (or new) player buys in fresh.
    if (player.stack <= 0) this.buyIn(player);
    player.sittingOut = false;
    player.timeouts = 0;
    player.leaving = false;
    player.exit = null;
    this.vacated[seat] = null;
    if (player.kind === "human") {
      // Their chips go where they sit: no seat keeps them for a bot, and no bot hands a seat back to them.
      this.vacated = this.vacated.map((v) => (v?.id === player.id ? null : v));
      for (const b of this.players.values()) if (b.replaces === player.id && b.exit?.kind === "reclaim") b.exit = null;
    }
    this.changed();
  }

  private buyIn(player: Player): void {
    player.stack = this.config.startingStack;
    player.buyIns += this.config.startingStack;
  }

  /**
   * Stands a player up now, or at the end of the hand if they were dealt into it (even if folded: the
   * seat stays reserved so nobody can sit into a hand, and its cards, mid-way).
   */
  private leaveSeat(player: Player): void {
    const h = this.hand;
    const e = h && player.seat !== null ? h.seats.indexOf(player.seat) : -1;
    if (h && !h.state.complete && e >= 0) {
      player.leaving = true;
      this.changed();
      if (seatToAct(h.state) === e) this.applyHandAction(this.autoAction(), true);
      return;
    }
    this.unseat(player);
  }

  private unseat(player: Player): void {
    const seat = player.seat;
    const exit = player.exit;
    if (seat !== null) this.seats[seat] = null;
    player.seat = null;
    player.leaving = false;
    player.sittingOut = false;
    player.timeouts = 0;
    player.exit = null;
    if (player.kind === "bot") {
      this.players.delete(player.id);
      if (seat !== null) this.retireBot(player, seat);
    } else if (seat !== null && exit?.kind === "bot") {
      this.seatBotFor(player, seat, exit.persona, exit.away);
    } else if (seat !== null && exit && player.stack > 0) {
      this.vacated[seat] = { id: player.id, away: exit.kind === "leave" || (exit.kind === "remove" && exit.away) };
    }
    this.changed();
  }

  /**
   * A bot leaves the table. One that stood in for a human who is not seated hands the chips back to them
   * (and the seat remembers them for another bot); any other is kept for the final results.
   */
  private retireBot(bot: Player, seat: number): void {
    const human = bot.replaces ? this.players.get(bot.replaces) : undefined;
    if (human && human.seat === null) {
      human.stack += bot.stack;
      human.buyIns += bot.buyIns;
      if (human.stack > 0) this.vacated[seat] = { id: human.id, away: bot.reclaimable };
    } else {
      this.retired.push({ name: bot.name, replaces: human ? human.id : null, stack: bot.stack, buyIns: bot.buyIns });
    }
  }

  // -------------------------------------------------------------------------
  // Hands

  private tryDeal(): void {
    if (!this.started || this.handEndedAt !== null || (this.hand && !this.hand.state.complete)) return;
    const n = this.config.seats;
    const eligible: number[] = [];
    let humanPresent = false;
    for (let seat = 0; seat < n; seat++) {
      const p = this.playerAt(seat);
      if (!p || p.sittingOut || p.leaving || p.stack <= 0) continue;
      eligible.push(seat);
      if (p.kind === "human" && this.isConnected(p.id)) humanPresent = true;
    }
    // Bots never play on their own: with no connected human seated, the table waits (and stops alarms).
    if (eligible.length < 2 || !humanPresent) return;

    const prev = this.button ?? n - 1;
    let buttonIdx = 0;
    for (let k = 1; k <= n; k++) {
      const i = eligible.indexOf((prev + k) % n);
      if (i >= 0) {
        buttonIdx = i;
        break;
      }
    }
    const deck = this.shuffledDeck();
    const state = createHand(
      {
        stacks: eligible.map((seat) => this.playerAt(seat)!.stack),
        button: buttonIdx,
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
      },
      { deck },
    );
    this.handNo += 1;
    this.button = eligible[buttonIdx];
    this.hand = { no: this.handNo, state, seats: eligible, actions: [], turnDue: null };
    for (const seat of eligible) this.sendHole(this.playerAt(seat)!);
    this.changed();
    this.startTurn();
  }

  /** Sets the clock for whoever acts next, acting at once for players who are sitting out or leaving. */
  private startTurn(): void {
    const h = this.hand!;
    if (h.state.complete) {
      this.finishHand();
      return;
    }
    const e = seatToAct(h.state)!;
    const p = this.playerAt(h.seats[e])!;
    if (p.sittingOut || p.leaving) {
      this.applyHandAction(this.autoAction(), true);
      return;
    }
    const now = this.deps.now();
    if (p.kind === "bot") {
      const { botDelayMinMs: lo, botDelayMaxMs: hi } = this.config;
      h.turnDue = now + lo + (this.deps.random() % (hi - lo + 1));
    } else {
      h.turnDue = now + this.config.turnMs;
    }
  }

  /**
   * The seat on the clock does `action`. Throws IllegalActionError (state unchanged) if it isn't legal.
   * `timedOut`: the server acts because the player's turn clock ran out.
   */
  private applyHandAction(action: Action, auto: boolean, timedOut = false): void {
    const h = this.hand!;
    const before = h.state.events.length;
    const next = applyAction(h.state, action);
    h.state = next;
    for (let i = before; i < next.events.length; i++) {
      const ev = next.events[i];
      if (ev.type !== "action") continue;
      const pa: PublicAction = {
        seat: h.seats[ev.seat],
        street: ev.street,
        action: ev.action,
        amount: ev.amount,
        to: ev.to,
        allIn: ev.allIn,
      };
      if (auto) pa.auto = true;
      if (timedOut) pa.timedOut = true;
      h.actions.push(pa);
    }
    this.changed();
    this.startTurn();
  }

  /** Check if free, else fold. */
  private autoAction(): Action {
    const la = legalActions(this.hand!.state)!;
    return la.canCheck ? { type: "check" } : { type: "fold" };
  }

  /** The seat on the clock is due: a bot acts, a human has timed out. */
  private turnDue(): void {
    const h = this.hand!;
    const e = seatToAct(h.state)!;
    const p = this.playerAt(h.seats[e])!;
    if (p.kind === "bot" && p.persona) {
      // Only the bot's decision is guarded: applyHandAction goes on to start the next turn (or finish the
      // hand), and an error there must not be answered by auto-acting whoever is on the clock by then.
      let action: Action;
      let auto = false;
      try {
        action = chooseAction(PERSONAS[p.persona], botView(h.state, e), createRng(this.deps.random())).action;
        applyAction(h.state, action); // dry run: throws if the bot chose something illegal
      } catch {
        action = this.autoAction();
        auto = true;
      }
      this.applyHandAction(action, auto);
      return;
    }
    p.timeouts += 1;
    if (p.timeouts >= this.config.maxTimeouts) p.sittingOut = true;
    this.applyHandAction(this.autoAction(), true, true);
  }

  private finishHand(): void {
    const h = this.hand!;
    const r = h.state.result!;
    h.turnDue = null;
    h.seats.forEach((seat, e) => {
      const p = this.playerAt(seat);
      if (p) p.stack = r.finalStacks[e];
    });
    const revealed: HandResultPublic["revealed"] = [];
    if (r.showdown) {
      r.values.forEach((v, e) => {
        if (v !== null) revealed.push({ seat: h.seats[e], cards: h.state.holeCards[e].map(formatCard), category: handCategory(v) });
      });
    }
    this.lastResult = {
      handNo: h.no,
      board: h.state.board.map(formatCard),
      showdown: r.showdown,
      pots: r.pots.map((pot) => ({ amount: pot.amount, winners: pot.winners.map((e) => h.seats[e]), shares: pot.shares.slice() })),
      net: r.net.map((amount, e) => ({ seat: h.seats[e], amount })),
      revealed,
    };
    this.handEndedAt = this.deps.now();
    this.changed();
  }

  /**
   * Between hands, the next hand waits for the host's `next` while the host is here (connected and not
   * sitting out) and the table is not ending.
   */
  private waitingForHost(): boolean {
    return this.handEndedAt !== null && !this.ending && this.hostHere();
  }

  /**
   * When the pending next hand is dealt (unless the host's `next` comes first), epoch ms; null when none is
   * pending. Waiting for the host: the backstop, `hostWaitMs` after the hand ended. Otherwise `resultMs` after
   * the later of the hand's end and the host's leaving (a host who drops mid-wait gets the popup's length to
   * come back, as on a page reload, and waits again once back), never past the backstop.
   */
  private nextHandDue(): number | null {
    const end = this.handEndedAt;
    if (end === null) return null;
    const backstop = end + this.config.hostWaitMs;
    if (this.waitingForHost()) return backstop;
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    const from = host && !this.ending ? Math.max(end, host.lastSeen) : end;
    return Math.min(backstop, from + this.config.resultMs);
  }

  /** The host is connected and not sitting out, so someone can click NEXT. */
  private hostHere(): boolean {
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    return host !== undefined && !host.sittingOut && this.isConnected(host.id);
  }

  private nextHand(): void {
    this.handEndedAt = null;
    for (const p of [...this.players.values()]) {
      if (p.seat === null) continue;
      if (p.leaving) this.unseat(p);
      else if (p.exit?.kind === "reclaim") {
        const human = p.replaces ? this.players.get(p.replaces) : undefined;
        if (human && human.seat === null) this.swapBack(p, human);
        else p.exit = null;
      } else if (p.stack <= 0) this.buyIn(p); // play money: automatic rebuy
    }
    this.hand = null;
    this.changed();
    if (this.ending) return this.endNow();
    this.tryDeal();
  }

  /** Everyone's chips and net, merging a bot that stood in for a human into that human's row. */
  private finalRows(): FinalRow[] {
    const extra = new Map<string, { stack: number; buyIns: number }>();
    const standsIn = (replaces: string | null): replaces is string => replaces !== null && this.players.has(replaces);
    const add = (id: string, stack: number, buyIns: number) => {
      const e = extra.get(id) ?? { stack: 0, buyIns: 0 };
      extra.set(id, { stack: e.stack + stack, buyIns: e.buyIns + buyIns });
    };
    for (const p of this.players.values()) if (p.kind === "bot" && standsIn(p.replaces)) add(p.replaces, p.stack, p.buyIns);
    for (const r of this.retired) if (standsIn(r.replaces)) add(r.replaces, r.stack, r.buyIns);
    const rows: FinalRow[] = [];
    for (const p of this.players.values()) {
      if (p.kind === "human") {
        const e = extra.get(p.id);
        const buyIns = p.buyIns + (e?.buyIns ?? 0);
        if (buyIns === 0) continue; // only watched
        const stack = p.stack + (e?.stack ?? 0);
        rows.push({ name: p.name, kind: "human", stack, net: stack - buyIns });
      } else if (!standsIn(p.replaces)) {
        rows.push({ name: p.name, kind: "bot", stack: p.stack, net: p.stack - p.buyIns });
      }
    }
    for (const r of this.retired) if (!standsIn(r.replaces)) rows.push({ name: r.name, kind: "bot", stack: r.stack, net: r.stack - r.buyIns });
    return rows.sort((a, b) => b.stack - a.stack);
  }

  /** Ends the table (no hand running): everyone gets the final state, every socket closes, `closed` turns true. */
  private endNow(): void {
    this.ended = { rows: this.finalRows() };
    this.handEndedAt = null;
    if (this.hand) this.hand.turnDue = null;
    this.changed();
    this.broadcast();
    for (const id of [...this.conns.keys()]) this.deps.close(id, 4002, "Table ended");
    this.conns.clear();
    this.isClosed = true;
    this.alarmAt = null;
    this.deps.setAlarm(null);
  }

  // -------------------------------------------------------------------------
  // Output

  private sendTo(connId: string, body: ServerMessageBody): void {
    this.seq += 1;
    this.deps.send(connId, { ...body, seq: this.seq } as ServerMessage);
  }

  private error(connId: string, code: ErrorCode, message: string): void {
    this.sendTo(connId, { type: "error", code, message });
  }

  /** Sends a player their hole cards for the live hand, on one connection or all of theirs. */
  private sendHole(player: Player, onlyConn?: string): void {
    const h = this.hand;
    if (!h || h.state.complete || player.kind !== "human" || player.seat === null) return;
    const e = h.seats.indexOf(player.seat);
    if (e < 0) return;
    const body: ServerMessageBody = { type: "hole", handNo: h.no, seat: player.seat, cards: h.state.holeCards[e].map(formatCard) };
    for (const [id, c] of this.conns) {
      if (c.playerId === player.id && (onlyConn === undefined || onlyConn === id)) this.sendTo(id, body);
    }
  }

  private changed(): void {
    this.broadcastPending = true;
    this.persistPending = true;
  }

  private flush(): void {
    this.checkHost();
    this.broadcast();
    this.schedule();
  }

  private broadcast(): void {
    if (this.broadcastPending) {
      this.broadcastPending = false;
      const state = this.publicState();
      for (const [id, c] of this.conns) if (c.playerId) this.sendTo(id, { type: "state", state });
    }
  }

  private schedule(): void {
    if (this.isClosed) return;
    // Every change to the connections ends here (onConnect, flush), so the idle clock is kept here too.
    if (this.conns.size === 0 && this.idleSince === null) {
      this.idleSince = this.deps.now();
      this.persistPending = true;
    } else if (this.conns.size > 0 && this.idleSince !== null) {
      this.idleSince = null;
      this.persistPending = true;
    }
    const h = this.hand;
    const dues: number[] = [];
    if (this.conns.size === 0) this.backstopAt = null;
    else this.backstopAt ??= this.deps.now() + this.config.idleMs;
    if (this.idleSince !== null) dues.push(this.idleSince + this.config.idleMs);
    if (this.backstopAt !== null) dues.push(this.backstopAt);
    const game = h && !h.state.complete && h.turnDue !== null ? h.turnDue : this.nextHandDue();
    if (game !== null) dues.push(game);
    for (const c of this.conns.values()) if (c.playerId === null) dues.push(c.openedAt + JOIN_TIMEOUT_MS);
    const hostDue = this.hostDeadline();
    if (hostDue !== null && hostDue > this.deps.now()) dues.push(hostDue);
    let due = dues.length > 0 ? Math.min(...dues) : null;
    if (due !== null && this.alarmNotBefore !== null) due = Math.max(due, this.alarmNotBefore);
    if (due !== this.alarmAt) {
      this.alarmAt = due;
      this.deps.setAlarm(due);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers

  private playerAt(seat: number): Player | undefined {
    const id = this.seats[seat];
    return id ? this.players.get(id) : undefined;
  }

  private isConnected(playerId: string): boolean {
    for (const c of this.conns.values()) if (c.playerId === playerId) return true;
    return false;
  }

  private isHost(player: Player): boolean {
    return player.id === this.hostId;
  }

  private addConn(connId: string): Conn {
    const conn: Conn = { playerId: null, openedAt: this.deps.now(), times: [] };
    this.conns.set(connId, conn);
    this.persistPending = true;
    return conn;
  }

  private dropConn(connId: string): void {
    const conn = this.conns.get(connId);
    this.conns.delete(connId);
    const p = conn?.playerId ? this.players.get(conn.playerId) : undefined;
    if (p && !this.isConnected(p.id)) p.lastSeen = this.deps.now();
    this.changed();
  }

  /**
   * A nickname looks like a bot persona's or any other player's the table still remembers (connected or
   * not, until forgetIdlePlayer drops them), ignoring case, compatibility forms and common look-alikes.
   */
  private nameTaken(name: string, self: Player | null): boolean {
    const key = nameSkeleton(name);
    if (Object.values(PERSONAS).some((persona) => nameSkeleton(persona.name) === key)) return true;
    for (const p of this.players.values()) if (p !== self && nameSkeleton(p.name) === key) return true;
    return false;
  }

  /** The oldest joined connection of a human who is neither seated nor the host (but not `except`). */
  private evictableConn(except?: string): string | undefined {
    for (const [id, c] of this.conns) {
      const p = c.playerId && id !== except ? this.players.get(c.playerId) : undefined;
      if (p && p.kind === "human" && p.seat === null && p.id !== this.hostId) return id;
    }
    return undefined;
  }

  /** Turns a connection away because the table is full. */
  private kick(connId: string): void {
    this.error(connId, "table_full", "This table is full");
    if (this.conns.get(connId)?.playerId) this.dropConn(connId);
    else {
      this.conns.delete(connId); // nobody saw it join: nothing to broadcast
      this.persistPending = true;
    }
    this.deps.close(connId, 4001, "Table full");
  }

  /** Drops the record of the watcher who never bought in and has been gone longest (their token stops working). */
  private forgetIdlePlayer(): boolean {
    let oldest: Player | undefined;
    for (const p of this.players.values()) {
      // Anyone who bought in stays: their chips (or a bot's standing in for them) count in the final results.
      if (p.kind !== "human" || p.seat !== null || p.id === this.hostId || p.buyIns > 0 || this.isConnected(p.id)) continue;
      if (!oldest || p.lastSeen < oldest.lastSeen) oldest = p;
    }
    if (!oldest) return false;
    this.players.delete(oldest.id);
    this.persistPending = true;
    return true;
  }

  /** When an absent host hands over: HOST_GRACE_MS after they left (seated or not). Null while connected. */
  private hostDeadline(): number | null {
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    if (!host || this.isConnected(host.id)) return null;
    return host.lastSeen + HOST_GRACE_MS;
  }

  /** Passes the host role to the longest-seated connected human once the host's deadline has passed. */
  private checkHost(): void {
    const due = this.hostDeadline();
    if (due === null || this.deps.now() < due) return;
    this.passHost(this.hostId ? this.players.get(this.hostId) : undefined);
  }

  /** Hands the host role from `from` to the longest-seated connected human, if there is one. */
  private passHost(from: Player | undefined): void {
    let next: Player | undefined;
    for (const p of this.players.values()) {
      if (p.kind !== "human" || p.seat === null || p.leaving || p === from || p.id === this.hostId || !this.isConnected(p.id)) continue;
      if (!next || p.seatedAt < next.seatedAt) next = p;
    }
    if (!next) return;
    this.hostId = next.id;
    this.changed();
  }

  private randomHex(words: number): string {
    let s = "";
    for (let i = 0; i < words; i++) s += (this.deps.random() >>> 0).toString(16).padStart(8, "0");
    return s;
  }

  private shuffledDeck(): Card[] {
    const deck = FULL_DECK.slice();
    for (let i = deck.length - 1; i > 0; i--) {
      // Rejection sampling: an unbiased index in [0, i].
      const bound = i + 1;
      const limit = 0x1_0000_0000 - (0x1_0000_0000 % bound);
      let r = this.deps.random() >>> 0;
      while (r >= limit) r = this.deps.random() >>> 0;
      const j = r % bound;
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
}

/** Why `action` was refused, in table terms (the engine's own messages name engine seats). */
function illegalActionMessage(action: Action, la: LegalActions): string {
  const chips = (n: number) => n.toLocaleString("en-US");
  switch (action.type) {
    case "fold":
      return "There is no bet to fold to; check instead";
    case "check":
      return `You can't check: ${chips(la.toCall)} to call`;
    case "call":
      return "There is nothing to call; check instead";
    case "raise":
      if (!la.canRaise) return "You can't raise here";
      return `${la.isBet ? "Bet" : "Raise"} must be between ${chips(la.minRaiseTo)} and ${chips(la.maxRaiseTo)}`;
  }
}

function publicHand(h: HandRecord): PublicHand {
  const s = h.state;
  const la = legalActions(s);
  return {
    handNo: h.no,
    button: h.seats[s.button],
    smallBlindSeat: h.seats[s.smallBlindSeat],
    bigBlindSeat: h.seats[s.bigBlindSeat],
    smallBlind: s.smallBlind,
    bigBlind: s.bigBlind,
    street: s.street,
    board: s.board.map(formatCard),
    pot: potTotal(s),
    players: h.seats.map((seat, e) => ({
      seat,
      stack: s.stacks[e],
      bet: s.bets[e],
      committed: s.committed[e],
      folded: s.folded[e],
      allIn: !s.folded[e] && s.stacks[e] === 0,
    })),
    actions: h.actions.slice(),
    legal: la
      ? {
          seat: h.seats[la.seat],
          toCall: la.toCall,
          callAmount: la.callAmount,
          canFold: la.canFold,
          canCheck: la.canCheck,
          canCall: la.canCall,
          canRaise: la.canRaise,
          minRaiseTo: la.minRaiseTo,
          maxRaiseTo: la.maxRaiseTo,
          isBet: la.isBet,
        }
      : null,
    complete: s.complete,
  };
}

const structuredCloneJson = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Latin look-alikes from other scripts (after NFKC), mapped to the Latin letter they imitate. */
const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  "\u0410": "A", "\u0430": "a", "\u0412": "B", "\u0432": "b", "\u0415": "E", "\u0435": "e", "\u0401": "E", "\u0451": "e",
  "\u041a": "K", "\u043a": "k", "\u041c": "M", "\u043c": "m", "\u041d": "H", "\u043d": "h", "\u041e": "O", "\u043e": "o",
  "\u0420": "P", "\u0440": "p", "\u0421": "C", "\u0441": "c", "\u0422": "T", "\u0442": "t", "\u0423": "Y", "\u0443": "y",
  "\u0425": "X", "\u0445": "x", "\u0406": "I", "\u0456": "i", "\u0407": "I", "\u0457": "i", "\u0408": "J", "\u0458": "j",
  "\u0405": "S", "\u0455": "s", "\u04bb": "h", "\u0501": "d", "\u04c0": "I", "\u04cf": "l", "\u051b": "q", "\u051d": "w",
  // Greek
  "\u0391": "A", "\u03b1": "a", "\u0392": "B", "\u03b2": "b", "\u0395": "E", "\u03b5": "e", "\u0396": "Z", "\u0397": "H",
  "\u0399": "I", "\u03b9": "i", "\u039a": "K", "\u03ba": "k", "\u039c": "M", "\u039d": "N", "\u03bd": "v", "\u039f": "O",
  "\u03bf": "o", "\u03a1": "P", "\u03c1": "p", "\u03a4": "T", "\u03c4": "t", "\u03a5": "Y", "\u03c5": "u", "\u03a7": "X",
  "\u03c7": "x",
};

/** What two nicknames are compared on: NFKC, look-alikes mapped to Latin, then case-folded. */
function nameSkeleton(name: string): string {
  return Array.from(name.normalize("NFKC"), (ch) => LOOKALIKES[ch] ?? ch)
    .join("")
    .toLowerCase();
}
