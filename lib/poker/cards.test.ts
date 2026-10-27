import { describe, expect, it } from "vitest";
import { FULL_DECK, createRng, formatCard, formatCards, parseCard, parseCards, rankOf, shuffle, suitOf } from "./cards";

describe("cards", () => {
  it("encodes id = rank * 4 + suit and round-trips all 52 cards", () => {
    expect(parseCard("2c")).toBe(0);
    expect(parseCard("As")).toBe(51);
    expect(parseCard("Th")).toBe(8 * 4 + 2);
    for (const c of FULL_DECK) expect(parseCard(formatCard(c))).toBe(c);
    expect(rankOf(parseCard("Kd"))).toBe(11);
    expect(suitOf(parseCard("Kd"))).toBe(1);
  });

  it("parses card lists with or without separators", () => {
    expect(formatCards(parseCards("AsKd7h"))).toBe("AsKd7h");
    expect(parseCards("As Kd, 7h")).toEqual(parseCards("AsKd7h"));
    expect(parseCards("")).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => parseCard("1s")).toThrow();
    expect(() => parseCard("Ax")).toThrow();
    expect(() => parseCards("AsAs")).toThrow(/Duplicate/);
    expect(() => parseCards("AsK")).toThrow();
  });

  it("PRNG is reproducible and roughly uniform", () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const xs = Array.from({ length: 5 }, () => a.nextU32());
    expect(Array.from({ length: 5 }, () => b.nextU32())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.nextU32())).not.toEqual(xs);

    const rng = createRng(7);
    const buckets = new Array(52).fill(0);
    const n = 520_000;
    for (let i = 0; i < n; i++) buckets[rng.int(52)]++;
    // Each bucket ~ Binomial(n, 1/52): mean 10000, sd ~ 99. 6 sd is a very loose bound.
    for (const k of buckets) expect(Math.abs(k - 10_000)).toBeLessThan(600);
  });

  it("shuffle is a permutation", () => {
    const deck = shuffle([...FULL_DECK], createRng(1));
    expect([...deck].sort((x, y) => x - y)).toEqual([...FULL_DECK]);
  });
});
