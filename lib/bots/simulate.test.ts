// Bots against bots through the engine: the engine throws on any illegal action, so finishing every
// hand proves the bots only ever chose legal actions. Tables of 2-9 seats (mostly 2-6), random
// personas, uneven and short stacks, several blind sizes.
import { describe, expect, it } from "vitest";
import type { HandState } from "../engine/engine";
import { createRng, type Rng } from "../poker/cards";
import { PERSONA_IDS, PERSONAS } from "./personas";
import { playHand, simulate } from "./simulate";

const HANDS = 25_000;

function randomTable(rng: Rng) {
  const n = rng.next() < 0.85 ? 2 + rng.int(5) : 7 + rng.int(3);
  const bigBlind = [100, 100, 2, 10, 7][rng.int(5)];
  const smallBlind = Math.max(1, Math.floor(bigBlind / 2));
  const equal = rng.next() < 0.3;
  const stacks = Array.from({ length: n }, () => {
    if (equal) return 100 * bigBlind;
    const r = rng.next();
    if (r < 0.1) return 1 + rng.int(2 * bigBlind); // a blind or two
    if (r < 0.35) return 2 * bigBlind + rng.int(25 * bigBlind);
    if (r < 0.75) return 25 * bigBlind + rng.int(100 * bigBlind);
    return 125 * bigBlind + rng.int(300 * bigBlind);
  });
  const personas = Array.from({ length: n }, () => PERSONAS[PERSONA_IDS[rng.int(PERSONA_IDS.length)]]);
  return { personas, stacks, button: rng.int(n), smallBlind, bigBlind };
}

describe(`${HANDS.toLocaleString("en-US")} bot hands`, () => {
  it("never take an illegal action and always finish with chips conserved", () => {
    const rng = createRng(424242);
    let actions = 0, showdowns = 0, allIns = 0, sidePots = 0, raises = 0;
    const seats = new Set<number>();
    for (let h = 0; h < HANDS; h++) {
      const table = randomTable(rng);
      seats.add(table.stacks.length);
      let s: HandState;
      try {
        s = playHand(table, rng.nextU32());
      } catch (e) {
        throw new Error(`hand ${h} ${JSON.stringify({ ...table, personas: table.personas.map((p) => p.id) })}: ${e}`);
      }
      const total = table.stacks.reduce((a, b) => a + b, 0);
      expect(s.complete).toBe(true);
      expect(s.stacks.reduce((a, b) => a + b, 0)).toBe(total);
      for (const e of s.events) {
        if (e.type !== "action") continue;
        actions++;
        if (e.allIn) allIns++;
        if (e.action === "raise" || e.action === "bet") raises++;
      }
      if (s.result!.showdown) showdowns++;
      if (s.result!.pots.length > 1) sidePots++;
    }
    expect([...seats].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(actions).toBeGreaterThan(HANDS * 4);
    expect(raises).toBeGreaterThan(HANDS / 2);
    expect(showdowns).toBeGreaterThan(HANDS / 10);
    expect(allIns).toBeGreaterThan(HANDS / 10);
    expect(sidePots).toBeGreaterThan(200);
  }, 120_000);

  it("simulate rotates the button, resets stacks and is reproducible", () => {
    const personas = [PERSONAS.tag, PERSONAS.station, PERSONAS.maniac];
    const run = () => {
      const out: string[] = [];
      simulate({ personas, hands: 30, seed: 9, shuffleSeats: true }, (s, ps) => {
        expect(s.startingStacks).toEqual([10_000, 10_000, 10_000]);
        expect(ps.slice().sort((a, b) => a.id.localeCompare(b.id))).toEqual(personas.slice().sort((a, b) => a.id.localeCompare(b.id)));
        out.push(`${s.button}:${JSON.stringify(s.result)}`);
      });
      return out;
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.slice(0, 4).map((x) => x.split(":")[0])).toEqual(["0", "1", "2", "0"]);
  });
});
