import { describe, expect, it } from "vitest";
import { claimFreshCode, isTableCode, normalizeTableCode, randomTableCode, TABLE_CODE_ALPHABET, TABLE_CODE_LENGTH } from "./code";

/** A deterministic uint32 source (xorshift32). */
function rng(seed = 1): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

describe("table code alphabet", () => {
  it("has 23 distinct letters and no look-alikes", () => {
    expect(TABLE_CODE_ALPHABET).toHaveLength(23);
    expect(new Set(TABLE_CODE_ALPHABET).size).toBe(23);
    for (const c of "ILO01") expect(TABLE_CODE_ALPHABET).not.toContain(c);
    expect(TABLE_CODE_LENGTH).toBe(6);
  });
});

describe("isTableCode / normalizeTableCode", () => {
  it("accepts six alphabet letters, strict uppercase", () => {
    expect(isTableCode("ABCDEF")).toBe(true);
    expect(isTableCode("abcdef")).toBe(false);
    expect(isTableCode(" ABCDEF")).toBe(false);
  });
  it("normalizes any case and surrounding spaces", () => {
    expect(normalizeTableCode("abcdef")).toBe("ABCDEF");
    expect(normalizeTableCode("  kQmXwD \n")).toBe("KQMXWD");
  });
  it("refuses the wrong length and letters outside the alphabet", () => {
    for (const bad of ["", "ABCDE", "ABCDEFG", "ABCDEI", "ABCDEL", "ABCDEO", "ABCDE1", "ABC0EF", "ABC-EF", "a".repeat(64)]) {
      expect(normalizeTableCode(bad)).toBeNull();
    }
  });
});

describe("randomTableCode", () => {
  it("always gives a valid code", () => {
    const r = rng(42);
    for (let i = 0; i < 2000; i++) expect(isTableCode(randomTableCode(r))).toBe(true);
  });
  it("skips values in the biased top range", () => {
    // 0xffffffff is above the rejection limit; 0 maps to "A".
    const values = [0xffffffff, 0, 0, 0, 0, 0, 0];
    expect(randomTableCode(() => values.shift()!)).toBe("AAAAAA");
  });
});

describe("claimFreshCode", () => {
  it("draws again when a code is held by a live table (forced collision)", async () => {
    const tried: string[] = [];
    const code = await claimFreshCode(async (c) => {
      tried.push(c);
      return tried.length === 3;
    }, rng(7));
    expect(tried).toHaveLength(3);
    expect(new Set(tried).size).toBe(3);
    expect(code).toBe(tried[2]);
    expect(isTableCode(code)).toBe(true);
  });
  it("refuses the same code twice when the source repeats it", async () => {
    const live = new Set<string>();
    const repeat = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
    const claim = async (c: string) => (live.has(c) ? false : (live.add(c), true));
    const r = () => repeat.shift() ?? 2;
    expect(await claimFreshCode(claim, r)).toBe("AAAAAA");
    expect(await claimFreshCode(claim, r)).toBe("BBBBBB");
  });
  it("throws when every try is refused", async () => {
    let calls = 0;
    await expect(
      claimFreshCode(async () => {
        calls++;
        return false;
      }, rng(3), 5),
    ).rejects.toThrow(/No free table code/);
    expect(calls).toBe(5);
  });
});
