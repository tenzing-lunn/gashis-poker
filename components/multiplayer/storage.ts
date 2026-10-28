// Where the table server is, and what the browser remembers between visits (all best-effort:
// storage can be blocked, so every access is wrapped).

import { isTableCode, normalizeTableCode } from "@/lib/multiplayer/code";

/** Base URL of the table server (table-server/). Set NEXT_PUBLIC_TABLE_SERVER_URL for a deploy. */
export const TABLE_SERVER_URL = process.env.NEXT_PUBLIC_TABLE_SERVER_URL || "http://localhost:8787";

const NICKNAME_KEY = "gp.nickname";
const tokenKey = (tableId: string) => `gp.table.${tableId}.token`;

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the page still works, it just forgets.
  }
}

export const loadNickname = (): string => get(NICKNAME_KEY) ?? "";
export const saveNickname = (name: string): void => set(NICKNAME_KEY, name);

/** The reconnect token for this table, so a refresh gets the same seat back. */
export const loadToken = (tableId: string): string | null => get(tokenKey(tableId));
export const saveToken = (tableId: string, token: string): void => set(tokenKey(tableId), token);

/**
 * The table code (uppercase) from what someone typed or pasted: the code in any case (spaces or a hyphen
 * inside are fine, `abc-def`), or a table link containing `/play/t/<code>`. Null when there is none.
 */
export function parseTableId(text: string): string | null {
  const t = text.trim();
  const link = /\/play\/t\/([a-z]+)(?:$|[/?#])/i.exec(t);
  if (link) return normalizeTableCode(link[1]);
  return /^[a-z\s-]+$/i.test(t) ? normalizeTableCode(t.replace(/[\s-]+/g, "")) : null;
}

/** A route's table code: strict, uppercase (lib/multiplayer/code.ts). */
export const isTableId = isTableCode;
