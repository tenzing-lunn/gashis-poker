// Where the table server is, and what the browser remembers between visits (all best-effort:
// storage can be blocked, so every access is wrapped).

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

/** A table id (64 hex characters) from a pasted link or a bare id; null when there is none. */
export function parseTableId(text: string): string | null {
  const m = /(?:^|[^0-9a-f])([0-9a-f]{64})(?:$|[^0-9a-f])/i.exec(text.trim());
  return m ? m[1].toLowerCase() : null;
}

export const isTableId = (s: string): boolean => /^[0-9a-f]{64}$/.test(s);

/** `TABLE 7F3A`: the first four characters of the id, for titles. */
export const shortTableId = (tableId: string): string => tableId.slice(0, 4).toUpperCase();
