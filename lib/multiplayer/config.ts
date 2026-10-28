// A table's settings and their defaults. Kept apart from room.ts so the browser can show them (the
// friends page) without loading the game engine.

import type { TableConfigPublic } from "./protocol";

export interface RoomConfig extends TableConfigPublic {
  /** Pause after a hand ends, ms. */
  betweenHandsMs: number;
  botDelayMinMs: number;
  botDelayMaxMs: number;
  /** Consecutive timeouts before a player is marked sitting out. */
  maxTimeouts: number;
  /** Messages allowed per connection per `rateWindowMs`. */
  rateLimit: number;
  rateWindowMs: number;
  /** A table with no connection for this long closes, ms. */
  idleMs: number;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  seats: 6,
  smallBlind: 50,
  bigBlind: 100,
  startingStack: 10_000,
  turnMs: 20_000,
  betweenHandsMs: 3_000,
  botDelayMinMs: 300,
  botDelayMaxMs: 900,
  maxTimeouts: 2,
  rateLimit: 20,
  rateWindowMs: 1_000,
  idleMs: 2 * 60 * 60_000,
};
