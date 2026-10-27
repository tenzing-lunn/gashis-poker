import { describe, expect, it } from "vitest";
import { bluffBreakEven, callEv, mdf, outsEquity, requiredEquity } from "./odds";

// Worked numbers from RESEARCH.md §2.
describe("odds formulas", () => {
  it("pot odds: 50 into 100 needs 25%", () => {
    expect(requiredEquity(100, 50)).toBe(25);
  });

  it("60% pot bet: MDF 62.5%, bluff needs 37.5% folds", () => {
    expect(mdf(100, 60)).toBe(62.5);
    expect(bluffBreakEven(100, 60)).toBe(37.5);
  });

  it("outs flop→river: 9 → 35.0%, 15 → 54.1%, 20 → 67.5%", () => {
    expect(outsEquity(9, 47, 2).toFixed(1)).toBe("35.0");
    expect(outsEquity(15, 47, 2).toFixed(1)).toBe("54.1");
    expect(outsEquity(20, 47, 2).toFixed(1)).toBe("67.5");
    expect(outsEquity(9, 47, 2)).toBeCloseTo(100 * (1 - (38 / 47) * (37 / 46)), 12);
  });

  it("one card to come is outs / unseen", () => {
    expect(outsEquity(9, 46, 1)).toBeCloseTo((100 * 9) / 46, 12);
  });

  it("EV of a call: e·(P+2B) − B", () => {
    expect(callEv(100, 50, 40)).toBe(30);
    expect(callEv(100, 50, 25)).toBe(0); // break-even at the pot-odds price
    expect(callEv(100, 50, 0)).toBe(-50);
  });
});
