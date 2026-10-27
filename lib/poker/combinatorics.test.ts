import { describe, expect, it } from "vitest";
import { parseCard } from "./cards";
import {
  COMBO_COUNT,
  HAND_CLASSES,
  choose,
  classOfCombo,
  comboCards,
  comboIndex,
  combosOfClass,
} from "./combinatorics";

describe("choose", () => {
  it("counts starting hands, 5-card hands and 7-card hands", () => {
    expect(choose(52, 2)).toBe(1326);
    expect(choose(52, 5)).toBe(2_598_960);
    expect(choose(52, 7)).toBe(133_784_560);
    expect(choose(48, 5)).toBe(1_712_304);
  });
});

describe("combos", () => {
  it("combo index is a bijection onto 0..1325", () => {
    const seen = new Set<number>();
    for (let a = 0; a < 52; a++) {
      for (let b = 0; b < a; b++) {
        const i = comboIndex(a, b);
        expect(comboIndex(b, a)).toBe(i);
        expect(comboCards(i)).toEqual([a, b]);
        seen.add(i);
      }
    }
    expect(seen.size).toBe(COMBO_COUNT);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(1325);
  });

  it("169 classes: 13 pairs x 6, 78 suited x 4, 78 offsuit x 12 = 1326", () => {
    expect(HAND_CLASSES.length).toBe(169);
    expect(new Set(HAND_CLASSES.map((h) => h.name)).size).toBe(169);
    const kinds = { pair: 0, suited: 0, offsuit: 0 };
    let total = 0;
    const all = new Set<number>();
    for (const h of HAND_CLASSES) {
      kinds[h.kind]++;
      const combos = combosOfClass(h.hi, h.lo, h.kind);
      expect(combos.length).toBe(h.combos);
      for (const c of combos) {
        expect(classOfCombo(c)).toEqual({ hi: h.hi, lo: h.lo, kind: h.kind });
        all.add(c);
      }
      total += h.combos;
    }
    expect(kinds).toEqual({ pair: 13, suited: 78, offsuit: 78 });
    expect(total).toBe(1326);
    expect(all.size).toBe(1326);
    expect(HAND_CLASSES[0].name).toBe("AA");
    expect(HAND_CLASSES[1].name).toBe("AKs");
    expect(HAND_CLASSES[13].name).toBe("AKo");
    expect(HAND_CLASSES[168].name).toBe("22");
  });

  it("classifies specific combos", () => {
    expect(classOfCombo(comboIndex(parseCard("Ks"), parseCard("As")))).toEqual({ hi: 12, lo: 11, kind: "suited" });
    expect(classOfCombo(comboIndex(parseCard("7h"), parseCard("7c")))).toEqual({ hi: 5, lo: 5, kind: "pair" });
  });
});
