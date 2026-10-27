// Each persona is measurably different. Seeded simulations, HUD stats per persona, assertions with
// clear margins, and the tables are printed (run with --silent=false to see them).
import { describe, expect, it } from "vitest";
import { PERSONA_IDS, PERSONAS, type PersonaId } from "./personas";
import { simulate } from "./simulate";
import { formatStats, recordHand, summarize, type HudStats, type StatCounts } from "./stats";

const SIX_MAX_HANDS = 6_000; // one of each persona at the table, reseated every hand
const HU_HANDS = 300; // per ordered pairing: each persona plays 6 x 300 = 1,800 hands heads-up

const ALL = PERSONA_IDS.map((id) => PERSONAS[id]);

function byId(stats: HudStats[]): Record<PersonaId, HudStats> {
  return Object.fromEntries(stats.map((s) => [s.label, s])) as Record<PersonaId, HudStats>;
}

describe("persona stats", () => {
  it("6-max: one of each persona at the table", () => {
    const counts = new Map<string, StatCounts>();
    simulate({ personas: ALL, hands: SIX_MAX_HANDS, seed: 1, shuffleSeats: true }, (s, personas) =>
      recordHand(counts, s, (seat) => personas[seat].id),
    );
    const list = PERSONA_IDS.map((id) => summarize(counts).find((s) => s.label === id)!);
    console.log(`6-max, ${SIX_MAX_HANDS} hands, each persona in every hand:\n${formatStats(list)}`);
    const s = byId(list);
    const others = (id: PersonaId) => PERSONA_IDS.filter((x) => x !== id).map((x) => s[x]);

    // VPIP: nit lowest, maniac highest, TAG < LAG, station and micro loose.
    for (const o of others("nit")) expect(s.nit.vpip).toBeLessThan(o.vpip - 5);
    for (const o of others("maniac")) expect(s.maniac.vpip).toBeGreaterThan(o.vpip + 8);
    expect(s.tag.vpip).toBeLessThan(s.lag.vpip - 5);
    expect(s.station.vpip).toBeGreaterThan(40);
    expect(s.micro.vpip).toBeGreaterThan(s.lag.vpip + 3);

    // PFR: the raising styles climb nit < TAG < LAG < maniac; the passive ones raise least.
    expect(s.nit.pfr).toBeLessThan(s.tag.pfr - 4);
    expect(s.tag.pfr).toBeLessThan(s.lag.pfr - 4);
    for (const o of others("maniac")) expect(s.maniac.pfr).toBeGreaterThan(o.pfr + 10);
    expect(s.station.pfr).toBeLessThan(s.nit.pfr);
    expect(s.micro.pfr).toBeLessThan(s.tag.pfr - 4);

    // Loose-passive: a big VPIP - PFR gap; the aggressive styles raise most hands they play.
    expect(s.station.vpip - s.station.pfr).toBeGreaterThan(30);
    expect(s.micro.vpip - s.micro.pfr).toBeGreaterThan(20);
    for (const id of ["nit", "tag", "lag"] as const) expect(s[id].vpip - s[id].pfr).toBeLessThan(10);

    // 3-bet % climbs with aggression.
    expect(s.nit.threeBet).toBeLessThan(s.tag.threeBet - 2);
    expect(s.tag.threeBet).toBeLessThan(s.lag.threeBet - 2);
    expect(s.lag.threeBet).toBeLessThan(s.maniac.threeBet - 4);
    expect(s.station.threeBet).toBeLessThan(2);

    // Aggression factor: maniac highest, station lowest, micro passive.
    for (const o of others("maniac")) expect(s.maniac.af).toBeGreaterThan(o.af * 1.5);
    for (const o of others("station")) expect(s.station.af).toBeLessThan(o.af * 0.6);
    expect(s.micro.af).toBeLessThan(s.tag.af * 0.6);
    expect(s.tag.af).toBeLessThan(s.lag.af);

    // The station goes to showdown most and folds least to c-bets.
    for (const o of others("station")) expect(s.station.wtsd).toBeGreaterThan(o.wtsd + 5);
    for (const o of others("station")) expect(s.station.foldToCbet).toBeLessThan(o.foldToCbet);
  });

  it("heads-up: every persona against every persona", () => {
    const counts = new Map<string, StatCounts>();
    PERSONA_IDS.forEach((id, i) =>
      PERSONA_IDS.forEach((opp, j) =>
        simulate({ personas: [PERSONAS[id], PERSONAS[opp]], hands: HU_HANDS, seed: 100 + 6 * i + j }, (s) =>
          recordHand(counts, s, (seat) => (seat === 0 ? id : "opponent")),
        ),
      ),
    );
    counts.delete("opponent");
    const list = PERSONA_IDS.map((id) => summarize(counts).find((s) => s.label === id)!);
    console.log(`Heads-up, ${HU_HANDS} hands per pairing (${6 * HU_HANDS} per persona):\n${formatStats(list)}`);
    const s = byId(list);
    const others = (id: PersonaId) => PERSONA_IDS.filter((x) => x !== id).map((x) => s[x]);

    for (const o of others("nit")) expect(s.nit.vpip).toBeLessThan(o.vpip - 5);
    for (const o of others("maniac")) expect(s.maniac.vpip).toBeGreaterThan(o.vpip + 8);
    expect(s.tag.vpip).toBeLessThan(s.lag.vpip - 5);
    expect(s.nit.pfr).toBeLessThan(s.tag.pfr - 8);
    expect(s.tag.pfr).toBeLessThan(s.lag.pfr - 4);
    expect(s.lag.pfr).toBeLessThan(s.maniac.pfr - 4);
    for (const o of others("station")) expect(s.station.pfr).toBeLessThan(o.pfr - 5);
    expect(s.station.vpip - s.station.pfr).toBeGreaterThan(30);
    expect(s.micro.vpip - s.micro.pfr).toBeGreaterThan(20);
    for (const o of others("maniac")) expect(s.maniac.af).toBeGreaterThan(o.af * 1.5);
    for (const o of others("station")) expect(s.station.af).toBeLessThan(o.af * 0.7);
  });
});
