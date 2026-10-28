"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Action } from "@/lib/engine/engine";
import type { PersonaId } from "@/lib/bots/personas";
import { connectTable, type ConnectionStatus, type RejectCode, type TableClient } from "@/lib/multiplayer/client";
import type { TableState } from "@/lib/multiplayer/protocol";
import { emptyLog, updateLog, type HandLog } from "./log";
import type { HoleMsg } from "./model";
import { loadToken, saveToken, TABLE_SERVER_URL } from "./storage";

export interface TableView {
  status: ConnectionStatus;
  /** The socket has been open at least once (a later drop reads RECONNECTING). */
  everOpen: boolean;
  state: TableState | null;
  /** This player's hole cards by hand number (the next hand's arrive before its state). */
  holes: Record<number, HoleMsg>;
  playerId: string | null;
  rttMs: number | null;
  clockOffsetMs: number;
  /** Latest non-fatal server error; `at` tells repeats apart. */
  error: { message: string; at: number } | null;
  /** When a click last could not be sent because the socket was not open. */
  notSentAt: number | null;
  log: HandLog;
}

const initialView = (): TableView => ({
  status: "connecting",
  everOpen: false,
  state: null,
  holes: {},
  playerId: null,
  rttMs: null,
  clockOffsetMs: 0,
  error: null,
  notSentAt: null,
  log: emptyLog(),
});

export interface TableActions {
  sit(seat: number): void;
  stand(): void;
  act(action: Action): void;
  addBot(seat: number, persona: PersonaId): void;
  removeBot(seat: number): void;
  start(): void;
}

/**
 * Connects to one table as `name` (reusing the stored token so a refresh keeps the seat) and keeps a
 * React view of it. `onRejected` fires once if the server refuses the join for good.
 * Remount (change `key`) to connect again under another name.
 */
export function useTable(
  tableId: string,
  name: string,
  onRejected: (code: RejectCode, message: string) => void,
): { view: TableView; actions: TableActions } {
  const [view, setView] = useState<TableView>(initialView);
  const clientRef = useRef<TableClient | null>(null);
  const rejectedRef = useRef(onRejected);
  useEffect(() => {
    rejectedRef.current = onRejected;
  });

  useEffect(() => {
    const client = connectTable(TABLE_SERVER_URL, tableId, { name, token: loadToken(tableId), sit: true });
    clientRef.current = client;
    const off = client.on((e) => {
      if (e.type === "status") {
        setView((v) => ({ ...v, status: e.status, everOpen: v.everOpen || e.status === "open" }));
      } else if (e.type === "latency") {
        setView((v) => ({ ...v, rttMs: e.rttMs, clockOffsetMs: client.clockOffsetMs }));
      } else if (e.type === "rejected") {
        rejectedRef.current(e.code, e.message);
      } else {
        const msg = e.msg;
        if (msg.type === "welcome") {
          saveToken(tableId, msg.you.token);
          setView((v) => ({ ...v, playerId: msg.you.playerId }));
        } else if (msg.type === "hole") {
          setView((v) => {
            // Keep this hand's and the next one's; older hands are over.
            const holes: Record<number, HoleMsg> = { [msg.handNo]: { handNo: msg.handNo, seat: msg.seat, cards: msg.cards } };
            for (const k of Object.keys(v.holes)) if (Number(k) >= msg.handNo - 1 && Number(k) !== msg.handNo) holes[Number(k)] = v.holes[Number(k)];
            return { ...v, holes };
          });
        } else if (msg.type === "state") {
          const now = performance.now();
          setView((v) => ({ ...v, state: msg.state, log: updateLog(v.log, msg.state, now) }));
        } else if (msg.type === "error") {
          const at = performance.now();
          setView((v) => ({ ...v, error: { message: msg.message, at } }));
        }
      }
    });
    return () => {
      off();
      client.close();
      clientRef.current = null;
    };
  }, [tableId, name]);

  const actions = useMemo<TableActions>(() => {
    // Nothing is queued while the socket is down; the view says so instead of dropping the click silently.
    const send = (f: (c: TableClient) => boolean) => {
      const c = clientRef.current;
      if (c && f(c)) return;
      const at = performance.now();
      setView((v) => ({ ...v, notSentAt: at }));
    };
    return {
      sit: (seat) => send((c) => c.sendSit(seat)),
      stand: () => send((c) => c.sendStand()),
      act: (action) => send((c) => c.sendAct(action)),
      addBot: (seat, persona) => send((c) => c.sendAddBot(seat, persona)),
      removeBot: (seat) => send((c) => c.sendRemoveBot(seat)),
      start: () => send((c) => c.sendStart()),
    };
  }, []);

  return { view, actions };
}
