import { describe, expect, it } from "vitest";
import { createRng } from "../poker/cards";
import { COMBO_HI, COMBO_LO, HAND_CLASSES, combosOfClass } from "../poker/combinatorics";
import { exactEquity } from "../poker/equity";
import { CLASS_COUNT, TOTAL_COMBO_PAIRS, preflopMatrix } from "./preflop-matrix";

const K = CLASS_COUNT;
const { equity, pairs } = preflopMatrix();
const combos = HAND_CLASSES.map((h) => combosOfClass(h.hi, h.lo, h.kind));

/** Exact E_ij recomputed live: every disjoint combo pair, deduplicated by suit relabelling. */
function liveEquity(i: number, j: number): { n: number; e: number } {
  const perms: number[][] = [];
  const permute = (pre: number[], rest: number[]): void => {
    if (!rest.length) perms.push(pre);
    rest.forEach((s, k) => permute([...pre, s], [...rest.slice(0, k), ...rest.slice(k + 1)]));
  };
  permute([], [0, 1, 2, 3]);
  const cache = new Map<string, number>();
  let n = 0, sum = 0;
  for (const x of combos[i]) {
    for (const y of combos[j]) {
      const cards = [COMBO_HI[x], COMBO_LO[x], COMBO_HI[y], COMBO_LO[y]];
      if (new Set(cards).size < 4) continue;
      n++;
      // Canonical key: the smallest relabelling (hands kept in seat order, each hand's cards sorted).
      let key = "";
      for (const p of perms) {
        const m = cards.map((c) => (c & ~3) | p[c & 3]);
        const k = [Math.max(m[0], m[1]), Math.min(m[0], m[1]), Math.max(m[2], m[3]), Math.min(m[2], m[3])].join(",");
        if (key === "" || k < key) key = k;
      }
      let e = cache.get(key);
      if (e === undefined) {
        const c = key.split(",").map(Number);
        e = exactEquity([[c[0], c[1]], [c[2], c[3]]]).players[0].equity;
        cache.set(key, e);
      }
      sum += e;
    }
  }
  return { n, e: sum / n };
}

describe("preflop matrix data file", () => {
  it("n_ij: symmetric, matches live combo counting, and sums to 1326 x 1225", () => {
    let total = 0;
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) {
        const n = pairs[i * K + j];
        expect(n).toBe(pairs[j * K + i]);
        total += n;
      }
    }
    expect(total).toBe(TOTAL_COMBO_PAIRS);
    expect(TOTAL_COMBO_PAIRS).toBe(1_624_350);
    // Spot-check the counting rule: each AA combo leaves exactly one disjoint AA; each AKs leaves 3 other AKs.
    const idx = (name: string) => HAND_CLASSES.findIndex((h) => h.name === name);
    expect(pairs[idx("AA") * K + idx("AA")]).toBe(6);
    expect(pairs[idx("AKs") * K + idx("AKs")]).toBe(12);
    expect(pairs[idx("AKs") * K + idx("QJo")]).toBe(48);
    expect(pairs[idx("AKo") * K + idx("KK")]).toBe(12 * 3); // each AKo leaves 3 kings: C(3,2) = 3
  });

  it("E_ij: in [0, 1], E_ii = 1/2, E_ij + E_ji = 1", () => {
    for (let i = 0; i < K; i++) {
      expect(equity[i * K + i]).toBe(0.5);
      for (let j = 0; j < K; j++) {
        const e = equity[i * K + j];
        expect(e >= 0 && e <= 1).toBe(true);
        expect(e + equity[j * K + i]).toBeCloseTo(1, 12);
      }
    }
  });

  it("reproduces well-known equities: AA vs a random hand 85.2%, 32o vs a random hand 32.3%, AA vs KK 81.95%", () => {
    const vsRandom = (name: string) => {
      const i = HAND_CLASSES.findIndex((h) => h.name === name);
      let w = 0, e = 0;
      for (let j = 0; j < K; j++) {
        w += pairs[i * K + j];
        e += pairs[i * K + j] * equity[i * K + j];
      }
      return e / w;
    };
    expect(vsRandom("AA")).toBeCloseTo(0.852, 3);
    expect(vsRandom("32o")).toBeCloseTo(0.323, 3);
    expect(equity[0 * K + 14]).toBeCloseTo(0.8195, 4);
  });

  it("matches live exact enumeration on 6 random class pairs and AA vs KK (to 1e-8)", () => {
    const rng = createRng(2026);
    const picks: [number, number][] = [[0, 14]]; // AA vs KK
    while (picks.length < 7) {
      const i = rng.int(K), j = rng.int(K);
      if (i !== j) picks.push([i, j]);
    }
    for (const [i, j] of picks) {
      const live = liveEquity(i, j);
      const tag = `${HAND_CLASSES[i].name} vs ${HAND_CLASSES[j].name}`;
      expect(pairs[i * K + j], tag).toBe(live.n);
      expect(Math.abs(equity[i * K + j] - live.e), tag).toBeLessThan(1e-8);
    }
  });
});
