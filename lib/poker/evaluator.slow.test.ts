// Slow: enumerates all 133,784,560 seven-card hands (~1-3 s in Node). Run with `npm run test:slow`.
import { describe, expect, it } from "vitest";
import { CARD_HI, CARD_KEY, CARD_LO, CARD_SUIT, HAND_CATEGORIES, evaluateState, handCategoryIndex } from "./evaluator";

describe.skipIf(!process.env.POKER_SLOW)("evaluator: all 133,784,560 seven-card hands (slow)", () => {
  it("gives the known category counts and 4824 distinct values", () => {
    const byValue = new Float64Array(7463);
    const K = CARD_KEY, S = CARD_SUIT, L = CARD_LO, H = CARD_HI;
    for (let a = 0; a < 52; a++) {
      const ka = K[a], sa = S[a], la = L[a], ha = H[a];
      for (let b = a + 1; b < 52; b++) {
        const kb = ka + K[b], sb = sa + S[b], lb = la | L[b], hb = ha | H[b];
        for (let c = b + 1; c < 52; c++) {
          const kc = kb + K[c], sc = sb + S[c], lc = lb | L[c], hc = hb | H[c];
          for (let d = c + 1; d < 52; d++) {
            const kd = kc + K[d], sd = sc + S[d], ld = lc | L[d], hd = hc | H[d];
            for (let e = d + 1; e < 52; e++) {
              const ke = kd + K[e], se = sd + S[e], le = ld | L[e], he = hd | H[e];
              for (let f = e + 1; f < 52; f++) {
                const kf = ke + K[f], sf = se + S[f], lf = le | L[f], hf = he | H[f];
                for (let g = f + 1; g < 52; g++) byValue[evaluateState(kf + K[g], sf + S[g], lf | L[g], hf | H[g])]++;
              }
            }
          }
        }
      }
    }
    const counts = new Array(9).fill(0);
    let distinct = 0, total = 0;
    for (let v = 1; v <= 7462; v++) {
      if (byValue[v] === 0) continue;
      distinct++;
      total += byValue[v];
      counts[handCategoryIndex(v)] += byValue[v];
    }
    expect(total).toBe(133_784_560);
    expect(Object.fromEntries(HAND_CATEGORIES.map((name, i) => [name, counts[i]]))).toEqual({
      "straight flush": 41_584,
      quads: 224_848,
      "full house": 3_473_184,
      flush: 4_047_644,
      straight: 6_180_020,
      trips: 6_461_620,
      "two pair": 31_433_400,
      pair: 58_627_800,
      "high card": 23_294_460,
    });
    expect(distinct).toBe(4824);
  }, 120_000);
});
