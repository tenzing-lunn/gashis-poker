// A table's settings and their defaults. Kept apart from room.ts so the browser can show them (the
// friends page) without loading the game engine.

import type { TableConfigPublic } from "./protocol";

export interface RoomConfig extends TableConfigPublic {
  /**
   * After a hand ends while the host is here (connected, not sitting out): the next hand waits for the host's
   * `next`, or is dealt this long after the hand ended anyway, so a host who walks off can't freeze the table, ms.
   */
  hostWaitMs: number;
  /** After a hand ends with no host here to click: the next hand is dealt this long after (the result popup's length), ms. */
  resultMs: number;
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

/** The turn clocks a new table may have, in seconds (the friends page's TIMER choices). */
export const TURN_SECOND_CHOICES = [20, 30, 45, 60] as const;

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  seats: 6,
  smallBlind: 50,
  bigBlind: 100,
  startingStack: 10_000,
  turnMs: 20_000,
  hostWaitMs: 60_000,
  resultMs: 7_000,
  botDelayMinMs: 300,
  botDelayMaxMs: 900,
  maxTimeouts: 2,
  rateLimit: 20,
  rateWindowMs: 1_000,
  idleMs: 2 * 60 * 60_000,
};
