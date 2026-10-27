import { describe, expect, it } from "vitest";
import { createRng, parseCards } from "./cards";
import { HAND_CLASSES, comboIndex, combosOfClass } from "./combinatorics";
import { ALL_COMBOS, comboClassName, countCombos, formatCombo, formatRange, parseRange, removeDeadCards } from "./range";

const classes = (text: string) => [...new Set(parseRange(text).map(comboClassName))].sort();
const sameSet = (a: readonly number[], b: readonly number[]) => expect([...new Set(a)].sort((x, y) => x - y)).toEqual([...new Set(b)].sort((x, y) => x - y));

describe("parseRange", () => {
  it("pairs: 22, 22+, 22-55", () => {
    expect(countCombos("22")).toBe(6);
    expect(countCombos("22+")).toBe(78);
    expect(classes("TT+")).toEqual(["AA", "JJ", "KK", "QQ", "TT"]);
    expect(classes("22-55")).toEqual(["22", "33", "44", "55"]);
    sameSet(parseRange("55-22"), parseRange("22-55"));
  });

  it("suited / offsuit / both", () => {
    expect(countCombos("AKs")).toBe(4);
    expect(countCombos("AKo")).toBe(12);
    expect(countCombos("AK")).toBe(16);
  });

  it("rejects reversed rank order in class tokens consistently (specific combos may be in either order)", () => {
    for (const bad of ["KA", "TKs", "TKo", "TK+", "TKs+", "TKs-T7s", "7Ks-TKs", "7Ks-KTs"]) {
      expect(() => parseRange(bad), bad).toThrow();
    }
    sameSet(parseRange("KhAh"), parseRange("AhKh"));
  });

  it("+ climbs the kicker to one below the top card", () => {
    expect(classes("ATs+")).toEqual(["AJs", "AKs", "AQs", "ATs"]);
    expect(classes("K9o+")).toEqual(["K9o", "KJo", "KQo", "KTo"]);
    expect(countCombos("AT+")).toBe(4 * 16);
    expect(countCombos("A2s+")).toBe(12 * 4);
    expect(classes("AKs+")).toEqual(["AKs"]);
  });

  it("kicker runs with a fixed top card", () => {
    expect(classes("KTs-K7s")).toEqual(["K7s", "K8s", "K9s", "KTs"]);
    expect(classes("A5s-A2s")).toEqual(["A2s", "A3s", "A4s", "A5s"]);
    sameSet(parseRange("K7s-KTs"), parseRange("KTs-K7s"));
    expect(countCombos("K9-K6")).toBe(4 * 16);
  });

  it("specific combos, lists, whitespace and duplicates", () => {
    const c = parseRange("AhKh");
    expect(c).toEqual([comboIndex(parseCards("Ah")[0], parseCards("Kh")[0])]);
    expect(formatCombo(c[0])).toBe("AhKh");
    sameSet(parseRange("KhAh"), c);
    expect(countCombos("AKs, AhKh")).toBe(4); // overlap counted once
    expect(countCombos(" QQ+ ,AKs,  AKo ")).toBe(18 + 16);
    expect(countCombos("")).toBe(0);
    expect(countCombos("qq+, ak, t9s")).toBe(18 + 16 + 4);
  });

  it("rejects malformed tokens", () => {
    for (const bad of ["AKx", "A", "AKs++", "KTs-Q7s", "KTs-K7o", "AA-KQ", "AsAs", "AhKH", "XX", "22-"]) {
      expect(() => parseRange(bad), bad).toThrow();
    }
  });
});

describe("card removal", () => {
  it("AK = 16 combos, 12 with an ace dead, 9 with an ace and king of the same suit dead", () => {
    expect(countCombos("AK", parseCards("As"))).toBe(12);
    expect(countCombos("AK", parseCards("AsKs"))).toBe(9);
    expect(countCombos("AK", parseCards("AsKd"))).toBe(9);
    expect(countCombos("AA", parseCards("As"))).toBe(3);
    expect(countCombos("AA", parseCards("AsAh"))).toBe(1);
    expect(countCombos("AKs", parseCards("Ah"))).toBe(3);
    expect(countCombos("AKo", parseCards("Ah"))).toBe(9);
    const live = removeDeadCards(ALL_COMBOS, parseCards("AsKdQh"));
    expect(live.length).toBe(1326 - 3 * 51 + 3); // C(49, 2) = 1176
  });
});

describe("formatRange", () => {
  it("writes canonical compact notation", () => {
    expect(formatRange(parseRange("22-55"))).toBe("55-22");
    expect(formatRange(parseRange("QQ, KK, AA, ATs, AJs, AQs, AKs, AKo"))).toBe("QQ+, ATs+, AKo");
    expect(formatRange(parseRange("ATs+, ATo+"))).toBe("AT+");
    expect(formatRange(parseRange("KTs-K7s, A5s-A2s"))).toBe("A5s-A2s, KTs-K7s");
    expect(formatRange(parseRange("AhKh, 22"))).toBe("22, AhKh");
    expect(formatRange(parseRange("AA, KK, 88"))).toBe("KK+, 88");
    expect(formatRange(parseRange("AA"))).toBe("AA");
    expect(formatRange(parseRange("22+, A2+, K2+, Q2+, J2+, T2+, 92+, 82+, 72+, 62+, 52+, 42+, 32"))).toBe(
      "22+, A2+, K2+, Q2+, J2+, T2+, 92+, 82+, 72+, 62+, 52+, 42+, 32",
    );
    expect(formatRange(removeDeadCards(parseRange("AKs"), parseCards("As")))).toBe("AhKh, AdKd, AcKc");
  });

  it("round-trips: parse(format(parse(x))) = parse(x)", () => {
    const samples = [
      "22+", "QQ+, AKs, AKo", "KK+,AJs+,KQs,AKo, 77-55, 98s, AhKd, 2c2d", "A2s+, K9o-K6o, T9s, 65s",
      "AhKh, AsKs, 7c7d", "22-55, TT+, ATs-A6s, KQ", "",
    ];
    for (const s of samples) sameSet(parseRange(formatRange(parseRange(s))), parseRange(s));
  });

  it("round-trips random combo sets and random class sets", () => {
    const rng = createRng(31337);
    for (let i = 0; i < 300; i++) {
      const p = rng.next();
      const r = ALL_COMBOS.filter(() => rng.next() < p * 0.2);
      sameSet(parseRange(formatRange(r)), r);
      const cls = HAND_CLASSES.filter(() => rng.next() < p).flatMap((h) => combosOfClass(h.hi, h.lo, h.kind));
      const text = formatRange(cls);
      sameSet(parseRange(text), cls);
      expect(text).not.toMatch(/[cdhs][2-9TJQKA][cdhs]/); // whole classes never fall back to specific combos
    }
  });
});
