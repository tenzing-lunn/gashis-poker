import { describe, expect, it } from "vitest";
import { DEFAULT_PARTICLES } from "../grading/ev";
import { gradeKey, LruCache, spotKey } from "./cache";
import { SPOT_DEFAULT_TRIALS, type GradeRequest, type SpotRequest } from "./protocol";

const HISTORY = { stacks: [10_000, 10_000], button: 0, smallBlind: 50, bigBlind: 100, actions: [{ type: "raise" as const, to: 250 }], board: [] };
const SPOT: SpotRequest = { kind: "spot", id: 1, history: HISTORY, heroSeat: 1, heroCards: [0, 5], personas: ["tag", null] };
const GRADE: GradeRequest = { kind: "grade", id: 1, history: HISTORY, heroSeat: 1, heroCards: [0, 5], personas: ["tag", null] };

describe("LruCache", () => {
  it("evicts the least recently used entry past capacity", () => {
    const c = new LruCache<number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBe(1); // a is now the most recent; b is the oldest
    c.set("d", 4);
    expect(c.size).toBe(3);
    expect(c.has("b")).toBe(false);
    expect([c.get("a"), c.get("c"), c.get("d")]).toEqual([1, 3, 4]);
    c.set("c", 30); // refresh: a is now the oldest
    c.set("e", 5);
    expect(c.has("a")).toBe(false);
    expect(c.get("c")).toBe(30);
    expect(c.get("zzz")).toBeUndefined();
    c.clear();
    expect(c.size).toBe(0);
  });

  it("defaults to 64 entries and rejects a bad capacity", () => {
    const c = new LruCache<number>();
    for (let i = 0; i < 100; i++) c.set(String(i), i);
    expect(c.size).toBe(64);
    expect(c.has("35")).toBe(false);
    expect(c.has("36")).toBe(true);
    expect(() => new LruCache(0)).toThrow(/capacity/);
  });
});

describe("cache keys", () => {
  it("ignore the id and the hero's own persona entry, and fill in defaults", () => {
    const k = spotKey(SPOT);
    expect(spotKey({ ...SPOT, id: 99 })).toBe(k);
    expect(spotKey({ ...SPOT, personas: ["tag", "nit"] })).toBe(k);
    expect(spotKey({ ...SPOT, maxTrials: SPOT_DEFAULT_TRIALS, seed: 1 })).toBe(k);
    expect(gradeKey({ ...GRADE, options: { particles: DEFAULT_PARTICLES } })).toBe(gradeKey(GRADE));
  });

  it("change with everything that determines the answer", () => {
    const k = spotKey(SPOT);
    const variants: Partial<SpotRequest>[] = [
      { history: { ...HISTORY, stacks: [10_000, 9_000] } },
      { history: { ...HISTORY, button: 1 } },
      { history: { ...HISTORY, bigBlind: 200 } },
      { history: { ...HISTORY, actions: [{ type: "raise", to: 300 }] } },
      { history: { ...HISTORY, actions: [{ type: "call" }] } },
      { heroCards: [0, 6] },
      { heroSeat: 0, personas: [null, "tag"] },
      { personas: ["lag", null] },
      { maxTrials: 1000 },
      { targetStdErr: 0.01 },
      { seed: 2 },
    ];
    const keys = new Set(variants.map((v) => spotKey({ ...SPOT, ...v })));
    expect(keys.size).toBe(variants.length);
    expect(keys.has(k)).toBe(false);

    const g = gradeKey(GRADE);
    expect(g).not.toBe(k.replace('"spot"', '"grade"'));
    expect(gradeKey({ ...GRADE, chosen: { type: "call" } })).not.toBe(g);
    expect(gradeKey({ ...GRADE, chosen: { type: "raise", to: 750 } })).not.toBe(gradeKey({ ...GRADE, chosen: { type: "raise", to: 800 } }));
    expect(gradeKey({ ...GRADE, options: { maxRaises: 2 } })).not.toBe(g);
    expect(gradeKey({ ...GRADE, options: { trialsPerCombo: 50 } })).not.toBe(g);
  });
});
