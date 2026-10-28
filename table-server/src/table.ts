// The table Durable Object: a thin adapter from Durable Object events, storage and the alarm to
// TableRoom (lib/multiplayer/room.ts), where all the rules live.
//
// - One object per table. It holds the hand in memory and talks to players over hibernatable
//   WebSockets (each socket is tagged with its connection id, so sends work after a wake-up).
// - After every event the room's snapshot is written to SQLite if anything changed, so hibernation or
//   eviction never loses the hand. Outgoing messages are held by the output gate until that write is
//   durable.
// - The single alarm is multiplexed by the room (turn clock, bot think time, next deal, idle close).
// - The worker reaches the object by table code (`idFromName`), so any request for a well-formed code
//   wakes an object. One that was never created stores nothing, and answers 404. A table that sat empty
//   for 2 hours wipes its storage the same way, which frees its code.

import { DurableObject } from "cloudflare:workers";
import { MAX_TABLE_SEATS, MIN_TABLE_SEATS, TableRoom, type RoomDeps, type RoomSnapshot } from "../../lib/multiplayer/room";

export interface Env {
  TABLES: DurableObjectNamespace<PokerTable>;
  /** Allowed browser origins, comma-separated (the deployed site). */
  ALLOWED_ORIGIN?: string;
  /** More allowed origins for local development only, e.g. http://localhost:3000 (set by `npm run dev`). */
  DEV_ORIGINS?: string;
}

interface Attachment {
  connId: string;
}

export class PokerTable extends DurableObject<Env> {
  private room: TableRoom | null = null;

  private readonly deps: RoomDeps = {
    now: () => Date.now(),
    send: (connId, msg) => {
      const text = JSON.stringify(msg);
      for (const ws of this.ctx.getWebSockets(connId)) {
        try {
          ws.send(text);
        } catch {
          // The socket is closing; webSocketClose will tell the room.
        }
      }
    },
    close: (connId, code, reason) => {
      for (const ws of this.ctx.getWebSockets(connId)) {
        try {
          ws.close(code, reason);
        } catch {
          // Already closed.
        }
      }
    },
    setAlarm: (at) => {
      void (at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(at));
    },
    random: () => crypto.getRandomValues(new Uint32Array(1))[0],
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Only read: creating the schema here would store something for every code anyone tries.
    const exists = ctx.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room'").toArray().length > 0;
    const row = exists ? ctx.storage.sql.exec<{ data: string }>("SELECT data FROM room WHERE id = 1").toArray()[0] : undefined;
    if (row) {
      this.room = TableRoom.restore(JSON.parse(row.data) as RoomSnapshot, this.deps);
      const live = ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Attachment | null)?.connId);
      this.room.syncConnections(live.filter((id): id is string => typeof id === "string"));
      this.save();
    }
  }

  /** Called by the worker for a freshly drawn code. False when a live table already holds the code. */
  async init(options: { seats: number }): Promise<boolean> {
    if (this.room) return false;
    const seats = Math.min(MAX_TABLE_SEATS, Math.max(MIN_TABLE_SEATS, Math.floor(options.seats)));
    this.room = new TableRoom(this.deps, { seats });
    this.save();
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.room) return new Response("No such table", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const connId = crypto.randomUUID();
    // At the cap a socket may still open (a returning player can evict a watcher); see TableRoom.join.
    if (!this.room.onConnect(connId)) return new Response("This table has too many connections", { status: 503 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [connId]);
    server.serializeAttachment({ connId } satisfies Attachment);
    this.save();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const connId = this.connIdOf(ws);
    if (!this.room || !connId) return;
    // An exception in one message must not lose the changes made before it or kill the object.
    try {
      this.room.onMessage(connId, typeof message === "string" ? message : null);
    } catch (e) {
      console.error("webSocketMessage failed", e);
    } finally {
      this.save();
    }
    await this.wipeIfClosed();
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.disconnect(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.disconnect(ws);
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    // The room re-arms the alarm even when handling throws (see TableRoom.onAlarm).
    try {
      this.room.onAlarm();
    } catch (e) {
      console.error("alarm failed", e);
    } finally {
      this.save();
    }
    await this.wipeIfClosed();
  }

  /**
   * Once the room is over (empty for too long, or ended by the host): forget the table entirely, so its
   * code answers 404 and can be drawn again.
   */
  private async wipeIfClosed(): Promise<void> {
    if (!this.room?.closed) return;
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private disconnect(ws: WebSocket): void {
    const connId = this.connIdOf(ws);
    if (!this.room || !connId) return;
    this.room.onClose(connId);
    this.save();
  }

  private connIdOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.connId ?? null;
  }

  private save(): void {
    if (!this.room || !this.room.consumeDirty()) return;
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)");
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO room (id, data) VALUES (1, ?)", JSON.stringify(this.room.serialize()));
  }
}
