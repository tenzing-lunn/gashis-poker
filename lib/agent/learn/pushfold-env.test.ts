import { describe, expect, it } from "vitest";
import { RANK_CHARS, createRng } from "../../poker/cards";
import { HAND_CLASSES } from "../../poker/combinatorics";
import { pushFoldExploitability } from "../../gto/pushfold";
import { FEATURE_COUNT, classEquity, classIndexOf, createDealer, sbResult, writeFeatures } from "./pushfold-env";

describe("push/fold environment", () => {
  it("classIndexOf names every one of the 1326 combos correctly", () => {
    const counts = new Array(169).fill(0);
    for (let a = 0; a < 52; a++) {
      for (let b = 0; b < 52; b++) {
        if (a === b) continue;
        const ra = a >> 2, rb = b >> 2;
        const [hi, lo] = ra >= rb ? [ra, rb] : [rb, ra];
        const name = hi === lo ? RANK_CHARS[hi] + RANK_CHARS[lo] : RANK_CHARS[hi] + RANK_CHARS[lo] + ((a & 3) === (b & 3) ? "s" : "o");
        const cls = classIndexOf(a, b);
        expect(HAND_CLASSES[cls].name).toBe(name);
        if (a > b) counts[cls]++;
      }
    }
    expect(counts).toEqual(HAND_CLASSES.map((h) => h.combos));
  });

  it("every class has its own feature vector at a given stack", () => {
    const seen = new Set<string>();
    const x = new Float64Array(FEATURE_COUNT);
    for (let c = 0; c < 169; c++) seen.add(Array.from(writeFeatures(c, 10, x)).join(","));
    expect(seen.size).toBe(169);
  });

  it("the realised reward averages to the solver's exact value (showdown and expected modes)", () => {
    // A fixed, arbitrary pair of strategies: SB shoves classes with index < 100 at 80%, the rest at 20%;
    // BB calls the first 60 classes always and the rest at 10%.
    const push = HAND_CLASSES.map((_, i) => (i < 100 ? 0.8 : 0.2));
    const call = HAND_CLASSES.map((_, i) => (i < 60 ? 1 : 0.1));
    const stack = 8;
    const exact = pushFoldExploitability(stack, push, call).sbValue;
    const rng = createRng(5);
    const dealer = createDealer(rng), d = dealer.deck;
    const n = 400_000;
    for (const mode of ["showdown", "expected"] as const) {
      let sum = 0, sq = 0;
      for (let k = 0; k < n; k++) {
        dealer.dealHoles();
        const i = classIndexOf(d[0], d[1]), j = classIndexOf(d[2], d[3]);
        const shove = rng.next() < push[i], called = shove && rng.next() < call[j];
        const share = !called ? 0 : mode === "showdown" ? dealer.showdown() : classEquity(i, j);
        const r = sbResult(stack, shove, called, share);
        sum += r;
        sq += r * r;
      }
      const mean = sum / n, se = Math.sqrt((sq / n - mean * mean) / n);
      expect(Math.abs(mean - exact), `${mode}: mean ${mean}, exact ${exact}, se ${se}`).toBeLessThan(4 * se);
    }
  });

  it("deals distinct cards, uniformly", () => {
    const dealer = createDealer(createRng(9)), d = dealer.deck;
    const firstCard = new Array(52).fill(0);
    for (let k = 0; k < 52_000; k++) {
      dealer.dealHoles();
      dealer.showdown();
      expect(new Set(d.subarray(0, 9)).size).toBe(9);
      firstCard[d[0]]++;
    }
    // Each card should be SB's first card about 1000 times (sd ~31).
    for (const c of firstCard) expect(Math.abs(c - 1000)).toBeLessThan(160);
  });
});
