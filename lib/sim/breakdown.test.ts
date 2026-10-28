import { describe, expect, it } from "vitest";
import { parseCards, type Card } from "../poker/cards";
import { COMBO_COUNT, HAND_CLASSES, comboIndex } from "../poker/combinatorics";
import { parseRange } from "../poker/range";
import { BUCKETS, COMBO_CLASS, classFrequencies, classShares, handBuckets, topCombos, type Bucket } from "./breakdown";

const cards = (s: string): Card[] => parseCards(s);
const combo = (s: string): number => {
  const [a, b] = parseCards(s);
  return comboIndex(a, b);
};
const weightsOf = (entries: [string, number][]): Float64Array => {
  const w = new Float64Array(COMBO_COUNT);
  for (const [text, x] of entries) for (const c of parseRange(text)) w[c] = x;
  return w;
};
const classIndex = (name: string): number => HAND_CLASSES.findIndex((k) => k.name === name);
/** Bucket of a single combo on a board. */
const bucketOf = (hole: string, board: string): Bucket => {
  const { buckets } = handBuckets(weightsOf([[hole, 1]]), cards(board));
  expect(buckets).toHaveLength(1);
  return buckets[0].bucket;
};

describe("classShares / classFrequencies", () => {
  it("maps every combo to its class", () => {
    expect(COMBO_CLASS[combo("AsAh")]).toBe(0);
    expect(COMBO_CLASS[combo("AsKs")]).toBe(1);
    expect(COMBO_CLASS[combo("AsKd")]).toBe(13);
    expect(COMBO_CLASS[combo("2c2d")]).toBe(168);
  });

  it("shares sum to 1 and follow combo counts for a uniform range", () => {
    const s = classShares(new Float64Array(COMBO_COUNT).fill(2));
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(s[classIndex("AA")]).toBeCloseTo(6 / 1326, 14);
    expect(s[classIndex("AKs")]).toBeCloseTo(4 / 1326, 14);
    expect(s[classIndex("AKo")]).toBeCloseTo(12 / 1326, 14);
    const r = classShares(weightsOf([["QQ", 1], ["AKs", 2]]));
    expect(r[classIndex("QQ")]).toBeCloseTo(6 / 14, 14);
    expect(r[classIndex("AKs")]).toBeCloseTo(8 / 14, 14);
  });

  it("frequencies are relative to the heaviest combo and skip blocked combos", () => {
    const w = weightsOf([["AA", 1], ["KK", 0.5], ["AKs", 0.25]]);
    w[combo("KsKh")] = 0; // one KK combo missing
    const f = classFrequencies(w, cards("Ad"));
    expect(f[classIndex("AA")]).toBeCloseTo(1, 14); // the 3 live AA combos all at the max
    expect(f[classIndex("KK")]).toBeCloseTo((5 * 0.5) / 6, 14);
    expect(f[classIndex("AKs")]).toBeCloseTo(0.25, 14); // AdKd blocked, the other 3 at 0.25
    expect(f[classIndex("72o")]).toBe(0);
    for (const x of f) expect(x >= 0 && x <= 1).toBe(true);
    expect(() => classFrequencies(weightsOf([["AdKd", 1]]), cards("Ad"))).toThrow(/empty/);
  });
});

describe("handBuckets", () => {
  it("classifies made hands, pairs and draws", () => {
    const cases: [string, string, Bucket][] = [
      ["9h8h", "Th7h6h", "straight flush"],
      ["7c7d", "7h7sKd", "quads"],
      ["KcKd", "Kh7s7d", "full house"],
      ["AhJh", "Th7h2h", "flush"],
      ["9c8d", "Th7s6d", "straight"],
      ["7c7d", "Kh7s2d", "set"],
      ["Ac7d", "7h7sKd", "trips"],
      ["Kc7d", "Kh7s2d", "two pair"],
      ["AcAd", "Kh7s2d", "overpair"],
      ["AcKd", "Kh7s2d", "top pair"],
      ["Ac7d", "Kh7s2d", "middle pair"],
      ["9c9d", "Kh7s2d", "middle pair"],
      ["Ac2h", "Kh7s2d", "weak pair"],
      ["5c5d", "Kh7s2d", "weak pair"],
      ["AhQh", "Kh7h2d", "flush draw"],
      ["9h8h", "Th7h2d", "flush draw"], // combo draw counts as a flush draw
      ["9c8d", "Th7s2d", "straight draw"],
      ["9c6d", "Th7s2d", "gutshot"],
      ["AcQd", "Jh7s2d", "overcards"],
      ["4c3d", "Kh9s8d", "air"],
      // paired board: only the hole cards' own pairs count
      ["Kc2h", "7h7s2d", "weak pair"],
      ["9c9d", "7h7s2d", "overpair"],
      ["5c5d", "7h7s2d", "weak pair"],
      ["AcKd", "7h7s2d", "overcards"],
      // board trips / two pair on board
      ["Ac5d", "KhKsKd", "air"],
      ["AcQd", "KhKs7d7c", "air"], // Q is below the top board rank
      ["AcQd", "JhJs7d7c", "overcards"],
      ["Ac2d", "KhKs7d7c2h", "weak pair"],
      // a board straight puts everyone in "straight"
      ["AcAd", "5h6s7d8c9h", "straight"],
      // river: no draws
      ["AhQh", "Jh7h2d3c4s", "overcards"],
    ];
    for (const [hole, board, bucket] of cases) expect(bucketOf(hole, board), `${hole} on ${board}`).toBe(bucket);
  });

  it("shares sum to 1, sorted descending, and `draws` counts draws under made hands too", () => {
    const board = cards("Kh7h2d");
    const w = weightsOf([["AhQh", 1], ["KcKd", 1], ["AcKc", 2], ["AhKs", 1], ["9h8h", 1]]);
    const r = handBuckets(w, board);
    expect(r.buckets.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 12);
    for (let i = 1; i < r.buckets.length; i++) expect(r.buckets[i - 1].share).toBeGreaterThanOrEqual(r.buckets[i].share);
    const get = (b: Bucket) => r.buckets.find((x) => x.bucket === b)?.share ?? 0;
    expect(get("top pair")).toBeCloseTo(3 / 6, 12);
    expect(get("set")).toBeCloseTo(1 / 6, 12);
    expect(get("flush draw")).toBeCloseTo(2 / 6, 12);
    // AhQh and 9h8h hold four hearts; AhKs has only three.
    expect(r.draws).toBeCloseTo(2 / 6, 12);
    expect(r.buckets.every((b) => BUCKETS.includes(b.bucket) && b.share > 0)).toBe(true);
  });

  it("removes board cards from the range and needs a postflop board", () => {
    const r = handBuckets(weightsOf([["KhKd", 5], ["AcAd", 1]]), cards("Kh7s2d"));
    expect(r.buckets).toEqual([{ bucket: "overpair", share: 1 }]);
    expect(() => handBuckets(new Float64Array(COMBO_COUNT).fill(1), [])).toThrow(/3-5/);
  });
});

describe("topCombos", () => {
  it("returns the heaviest combos with labels and normalized shares", () => {
    const w = weightsOf([["AsKs", 4], ["QcQd", 3], ["7s6s", 1], ["2c2d", 2]]);
    const top = topCombos(w, 3);
    expect(top.map((t) => t.label)).toEqual(["AsKs", "QdQc", "2d2c"]);
    expect(top[0].share).toBeCloseTo(0.4, 14);
    expect(top[0].combo).toBe(combo("AsKs"));
    expect(topCombos(w, 10)).toHaveLength(4);
    expect(topCombos(w, 0)).toEqual([]);
  });
});
