// Guards the checked-in bot sheet tables: BOT_STATS must equal a fresh, seeded measurement, and every
// persona must have copy. If a bot change moves the stats, the failure prints the new BOT_STATS to paste.
import { describe, expect, it } from "vitest";
import { PERSONA_IDS, PERSONAS, type PersonaId } from "@/lib/bots/personas";
import { topRange } from "@/lib/bots/preflop";
import { simulate } from "@/lib/bots/simulate";
import { recordHand, summarize, type StatCounts } from "@/lib/bots/stats";
import { BOT_COPY, BOT_STATS, BOT_STATS_SAMPLE, OPEN_POSITIONS, shortRange, type BotStats } from "./bot-profiles";

const round = (x: number, places: number) => Number(x.toFixed(places));

function measure(): Record<PersonaId, BotStats> {
  const counts = new Map<string, StatCounts>();
  simulate(
    { personas: PERSONA_IDS.map((id) => PERSONAS[id]), hands: BOT_STATS_SAMPLE.hands, seed: BOT_STATS_SAMPLE.seed, shuffleSeats: true },
    (s, personas) => recordHand(counts, s, (seat) => personas[seat].id),
  );
  const out = {} as Record<PersonaId, BotStats>;
  for (const s of summarize(counts)) {
    out[s.label as PersonaId] = {
      vpip: round(s.vpip, 1),
      pfr: round(s.pfr, 1),
      threeBet: round(s.threeBet, 1),
      af: round(s.af, 2),
      foldToCbet: round(s.foldToCbet, 1),
      wtsd: round(s.wtsd, 1),
    };
  }
  return out;
}

function source(stats: Record<PersonaId, BotStats>): string {
  const rows = PERSONA_IDS.map((id) => {
    const fields = Object.entries(stats[id]).map(([k, v]) => `${k}: ${v}`).join(", ");
    return `  ${id}: { ${fields} },`;
  });
  return `export const BOT_STATS: Readonly<Record<PersonaId, BotStats>> = {\n${rows.join("\n")}\n};`;
}

describe("bot profiles", () => {
  it("BOT_STATS equals a fresh seeded measurement", () => {
    expect(BOT_STATS_SAMPLE.seats).toBe(PERSONA_IDS.length);
    const fresh = measure();
    const same = PERSONA_IDS.every((id) => JSON.stringify(fresh[id]) === JSON.stringify(BOT_STATS[id]));
    expect(same, `BOT_STATS is stale. Paste into components/table/bot-profiles.ts:\n${source(fresh)}`).toBe(true);
  }, 20_000); // ~3 s on an idle machine, 9-14 s measured under heavy load

  it("every persona has copy and sane stats", () => {
    for (const id of PERSONA_IDS) {
      const c = BOT_COPY[id];
      expect(c.short).toBe(id.toUpperCase()); // matches the seat names from botNames
      for (const text of [c.title, c.style, c.beat]) expect(text.length).toBeGreaterThan(0);
      const s = BOT_STATS[id];
      for (const v of [s.vpip, s.pfr, s.threeBet, s.foldToCbet, s.wtsd]) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of [s.vpip, s.pfr, s.threeBet, s.foldToCbet, s.wtsd]) expect(v).toBeLessThanOrEqual(100);
      expect(s.pfr).toBeLessThanOrEqual(s.vpip);
      expect(Number.isFinite(s.af)).toBe(true);
    }
  });

  it("shortRange cuts at a token boundary", () => {
    for (const id of PERSONA_IDS) {
      for (const width of [...OPEN_POSITIONS.map((pos) => PERSONAS[id].open[pos]), PERSONAS[id].huOpen]) {
        const full = topRange(width);
        const short = shortRange(width, 40);
        expect(short.length).toBeLessThanOrEqual(40);
        if (short === full) continue;
        expect(short.endsWith(", …")).toBe(true);
        expect(full.startsWith(short.slice(0, -3))).toBe(true);
        expect(full[short.length - 3]).toBe(","); // the cut falls between tokens
      }
    }
  });
});
