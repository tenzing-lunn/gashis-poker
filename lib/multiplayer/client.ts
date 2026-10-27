// Tiny browser client for the table server. No React; a UI subscribes with `on`.
//
//   const table = connectTable("http://localhost:8787", tableId, { name: "Alice", token: saved });
//   table.on((e) => { if (e.type === "message" && e.msg.type === "welcome") save(e.msg.you.token); });
//   table.sendSit(2); table.sendAct({ type: "call" });
//
// It reconnects with exponential backoff and rejoins with the token from the last `welcome`, so a
// dropped connection gets the same seat (and the hole cards are re-sent). It pings every few seconds
// and reports the round-trip time. It gives up for good, with a `rejected` event, when retrying cannot
// help: the join was refused (name taken or invalid, table full) or the server refuses this origin.

import type { Action } from "../engine/engine";
import type { PersonaId } from "../bots/personas";
import type { CardText, ClientMessage, ErrorCode, ServerMessage, TableState } from "./protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

export type TableClientEvent =
  | { type: "message"; msg: ServerMessage }
  | { type: "status"; status: ConnectionStatus }
  | { type: "latency"; rttMs: number }
  /** Final: the client has stopped (e.g. ask for another nickname and connect again). */
  | { type: "rejected"; code: ErrorCode | "origin_refused"; message: string };

/** Errors in reply to `join` that a retry would only repeat. */
const FATAL_JOIN_ERRORS: ReadonlySet<ErrorCode> = new Set(["name_taken", "bad_name", "malformed", "table_full"]);

export interface TableClient {
  readonly status: ConnectionStatus;
  readonly playerId: string | null;
  /** Reconnect secret for this player at this table; store it (e.g. localStorage) to survive reloads. */
  readonly token: string | null;
  readonly state: TableState | null;
  /** This player's cards for the current hand, if dealt in. */
  readonly hole: { handNo: number; seat: number; cards: CardText[] } | null;
  /** Last measured round trip, ms. */
  readonly rttMs: number | null;
  /** Estimated server clock minus local clock, ms (for showing `deadline` countdowns). */
  readonly clockOffsetMs: number;
  /** Subscribes to events; returns an unsubscribe function. */
  on(listener: (event: TableClientEvent) => void): () => void;
  /** Each send returns false if the socket is not open (nothing is queued). */
  sendSit(seat: number): boolean;
  sendStand(): boolean;
  /** Acts in the current hand (the hand number is filled in from the latest state). */
  sendAct(action: Action): boolean;
  sendAddBot(seat: number, persona: PersonaId): boolean;
  sendRemoveBot(seat: number): boolean;
  sendStart(): boolean;
  ping(): boolean;
  /** Closes for good (no reconnect). */
  close(): void;
}

export interface ConnectOptions {
  name: string;
  token?: string | null;
  /** Default 5000. */
  pingIntervalMs?: number;
  /** For tests or non-browser runtimes. */
  WebSocketImpl?: typeof WebSocket;
}

export function tableSocketUrl(baseUrl: string, tableId: string): string {
  const u = new URL(`/tables/${encodeURIComponent(tableId)}/ws`, baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : u.protocol === "http:" ? "ws:" : u.protocol;
  return u.toString();
}

/** Asks the server for a new table and returns its id. */
export async function createTable(baseUrl: string, seats = 6): Promise<string> {
  const res = await fetch(new URL(`/tables/new?seats=${seats}`, baseUrl));
  if (!res.ok) throw new Error(`Could not create a table (${res.status})`);
  const body = (await res.json()) as { tableId: string };
  return body.tableId;
}

export function connectTable(baseUrl: string, tableId: string, options: ConnectOptions): TableClient {
  const WS = options.WebSocketImpl ?? WebSocket;
  const url = tableSocketUrl(baseUrl, tableId);
  const httpUrl = new URL(`/tables/${encodeURIComponent(tableId)}/ws`, baseUrl);
  const pingEvery = options.pingIntervalMs ?? 5000;
  const listeners = new Set<(e: TableClientEvent) => void>();
  const pending = new Map<number, number>();

  let ws: WebSocket | null = null;
  let status: ConnectionStatus = "connecting";
  let closedByUser = false;
  /** Between sending `join` and its `welcome`. */
  let joining = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pingId = 0;
  let token = options.token ?? null;
  let playerId: string | null = null;
  let state: TableState | null = null;
  let hole: TableClient["hole"] = null;
  let rttMs: number | null = null;
  let clockOffsetMs = 0;

  const emit = (e: TableClientEvent) => {
    for (const l of listeners) l(e);
  };
  const setStatus = (s: ConnectionStatus) => {
    if (s === status) return;
    status = s;
    emit({ type: "status", status: s });
  };
  const raw = (msg: ClientMessage): boolean => {
    if (!ws || ws.readyState !== WS.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  };
  const stop = () => {
    closedByUser = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    const socket = ws;
    ws = null;
    socket?.close(1000);
    setStatus("closed");
  };
  const reject = (code: ErrorCode | "origin_refused", message: string) => {
    stop();
    emit({ type: "rejected", code, message });
  };
  /** A socket that never opened: offline, or refused. Only the origin check answers 403 on this path. */
  const originRefused = (): Promise<boolean> =>
    fetch(httpUrl, { cache: "no-store" }).then(
      (res) => res.status === 403,
      () => false,
    );
  const ping = (): boolean => {
    const id = ++pingId;
    if (!raw({ type: "ping", id })) return false;
    pending.set(id, performance.now());
    return true;
  };

  const onMessage = (data: unknown) => {
    if (typeof data !== "string") return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "welcome":
        joining = false;
        playerId = msg.you.playerId;
        token = msg.you.token;
        attempt = 0;
        ping();
        break;
      case "state":
        state = msg.state;
        if (hole && hole.handNo !== state.handNo) hole = null;
        break;
      case "hole":
        hole = { handNo: msg.handNo, seat: msg.seat, cards: msg.cards };
        break;
      case "pong": {
        const sentAt = msg.id === undefined ? undefined : pending.get(msg.id);
        if (sentAt !== undefined) {
          pending.delete(msg.id!);
          rttMs = performance.now() - sentAt;
          clockOffsetMs = msg.serverNow + rttMs / 2 - Date.now();
          emit({ type: "latency", rttMs });
        }
        break;
      }
    }
    emit({ type: "message", msg });
    // table_full can also come later: the server evicted this watcher to let a seated player back in.
    if (msg.type === "error" && (msg.code === "table_full" || (joining && FATAL_JOIN_ERRORS.has(msg.code)))) {
      reject(msg.code, msg.message);
    }
  };

  const open = () => {
    if (closedByUser) return;
    setStatus("connecting");
    const socket = new WS(url);
    ws = socket;
    let opened = false;
    socket.onopen = () => {
      opened = true;
      joining = true;
      setStatus("open");
      socket.send(JSON.stringify(token ? { type: "join", name: options.name, token } : { type: "join", name: options.name }));
      pingTimer = setInterval(ping, pingEvery);
    };
    socket.onmessage = (ev) => onMessage(ev.data);
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      pending.clear();
      setStatus("closed");
      if (closedByUser) return;
      const retry = () => {
        if (closedByUser) return;
        // Backoff: 0.25s, 0.5s, 1s, ... capped at 8s, with jitter.
        const delay = Math.min(8000, 250 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        attempt += 1;
        reconnectTimer = setTimeout(open, delay);
      };
      if (opened) return retry();
      void originRefused().then((refused) => {
        if (closedByUser) return;
        if (refused) reject("origin_refused", "The table server does not accept connections from this site");
        else retry();
      });
    };
  };
  open();

  return {
    get status() {
      return status;
    },
    get playerId() {
      return playerId;
    },
    get token() {
      return token;
    },
    get state() {
      return state;
    },
    get hole() {
      return hole;
    },
    get rttMs() {
      return rttMs;
    },
    get clockOffsetMs() {
      return clockOffsetMs;
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sendSit: (seat) => raw({ type: "sit", seat }),
    sendStand: () => raw({ type: "stand" }),
    sendAct: (action) => (state ? raw({ type: "act", handNo: state.handNo, action }) : false),
    sendAddBot: (seat, persona) => raw({ type: "addBot", seat, persona }),
    sendRemoveBot: (seat) => raw({ type: "removeBot", seat }),
    sendStart: () => raw({ type: "start" }),
    ping,
    close: stop,
  };
}
