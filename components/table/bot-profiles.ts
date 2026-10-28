// What the bot info sheet says about each persona: plain-words copy, measured stats and opening ranges.
// Not a client module, so server components can import the copy too (e.g. a setup row's style line).
//
// BOT_STATS is checked in, never simulated on page load. bot-profiles.test.ts regenerates it from
// lib/bots (BOT_STATS_SAMPLE) and fails if it drifts; the failure message prints the new table to paste.

import type { OpenPosition, PersonaId } from "@/lib/bots/personas";
import { topRange } from "@/lib/bots/preflop";

export type BotCopy = {
  /** Short name, as on the seats: `NIT`, `STATION`. */
  short: string;
  /** Full style name: `CALLING STATION`. */
  title: string;
  /** The style in one plain sentence (from the persona's `intent`). */
  style: string;
  /** How to beat it, as advice (the `intent`'s "Teaches …" part). */
  beat: string;
};

export const BOT_COPY: Readonly<Record<PersonaId, BotCopy>> = {
  nit: {
    short: "NIT",
    title: "Nit",
    style: "Plays very few hands, rarely bluffs and folds to pressure.",
    beat: "Steal its blinds, and when it bets or raises, believe it and fold.",
  },
  tag: {
    short: "TAG",
    title: "Tight-aggressive (TAG)",
    style: "A solid regular: plays few hands, more in late position, and bets and raises with them.",
    beat: "The baseline: no big leak to attack, so play solid poker and pick your spots.",
  },
  lag: {
    short: "LAG",
    title: "Loose-aggressive (LAG)",
    style: "Plays many hands, re-raises often and keeps betting with bluffs on later streets.",
    beat: "Call it down lighter: many of its bets are bluffs.",
  },
  station: {
    short: "STATION",
    title: "Calling station",
    style: "Limps and calls with almost anything, rarely raises or bluffs.",
    beat: "Bet your good hands for value, even thin ones, and don't bluff it.",
  },
  maniac: {
    short: "MANIAC",
    title: "Maniac",
    style: "Raises and re-raises constantly and bluffs on every street.",
    beat: "Call it down with decent hands and let it bluff into your strong ones.",
  },
  micro: {
    short: "MICRO",
    title: "Micro-stakes regular",
    style: "The typical low-stakes player: calls too much before and on the flop, then folds to more pressure.",
    beat: "Keep betting the turn and river after it calls the flop, and believe its big river bets: they are almost always strong.",
  },
};

/** The MIXED setup option: each bot's style is drawn at random. */
export const MIXED_COPY: BotCopy = {
  short: "MIXED",
  title: "Mixed",
  style: "Each bot gets one of the six styles at random when the session starts.",
  beat: "Open a bot's seat at the table to see which style it has.",
};

export type BotStats = {
  /** % of hands it puts money in voluntarily (VPIP). */
  vpip: number;
  /** % of hands it raises before the flop (PFR). */
  pfr: number;
  /** % of chances it re-raises a single raise (3-BET). */
  threeBet: number;
  /** Bets and raises per call after the flop (AF). */
  af: number;
  /** % of flop c-bets it folds to (FOLD TO C-BET). */
  foldToCbet: number;
  /** % of flops seen that reach showdown (WTSD). */
  wtsd: number;
};

/** How BOT_STATS was measured: lib/bots/simulate, one of each persona reseated every hand, 100 bb stacks. */
export const BOT_STATS_SAMPLE = { hands: 6_000, seed: 1, seats: 6 } as const;

export const BOT_STATS: Readonly<Record<PersonaId, BotStats>> = {
  nit: { vpip: 9.9, pfr: 7.4, threeBet: 2.5, af: 1.96, foldToCbet: 63.6, wtsd: 39.6 },
  tag: { vpip: 19.4, pfr: 14.3, threeBet: 6.4, af: 2.35, foldToCbet: 51.8, wtsd: 36.4 },
  lag: { vpip: 30.5, pfr: 22.6, threeBet: 12.2, af: 3.73, foldToCbet: 50.3, wtsd: 36 },
  station: { vpip: 46.5, pfr: 3.9, threeBet: 0.9, af: 0.33, foldToCbet: 32.9, wtsd: 50.6 },
  maniac: { vpip: 59.4, pfr: 41.9, threeBet: 20.7, af: 10.04, foldToCbet: 47.3, wtsd: 33.5 },
  micro: { vpip: 38.6, pfr: 7.8, threeBet: 2.8, af: 0.95, foldToCbet: 40.7, wtsd: 34.9 },
};

/** The 6-max positions that can open (the big blind never raises first in). */
export const OPEN_POSITIONS: readonly OpenPosition[] = ["UTG", "HJ", "CO", "BTN", "SB"];

/** `topRange(width)` cut at a token boundary to at most `max` characters, ending in `…` when cut. */
export function shortRange(width: number, max: number): string {
  const full = topRange(width);
  if (full.length <= max) return full;
  const tokens = full.split(", ");
  let out = "";
  for (const t of tokens) {
    const next = out ? `${out}, ${t}` : t;
    if (next.length + 3 > max) break; // room for ", …"
    out = next;
  }
  return out ? `${out}, …` : "…";
}
