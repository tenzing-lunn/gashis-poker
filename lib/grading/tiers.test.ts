import { describe, expect, it } from "vitest";
import { gradeOptions, tierOf, TIER_THRESHOLDS } from "./tiers";

describe("tiers", () => {
  it("bands the loss as a share of the pot", () => {
    expect(tierOf(0)).toBe("best");
    expect(tierOf(TIER_THRESHOLDS.best)).toBe("best");
    expect(tierOf(0.01)).toBe("correct");
    expect(tierOf(0.03)).toBe("correct");
    expect(tierOf(0.05)).toBe("inaccuracy");
    expect(tierOf(0.2)).toBe("mistake");
    expect(tierOf(0.21)).toBe("blunder");
  });

  it("grades exact EVs against the argmax", () => {
    const g = gradeOptions([{ ev: 0, stdErr: 0 }, { ev: 100, stdErr: 0 }, { ev: 98, stdErr: 0 }, { ev: 40, stdErr: 0 }], 1000);
    expect(g.best).toBe(1);
    expect(g.loss).toEqual([100, 0, 2, 60]);
    expect(g.lossPct).toEqual([0.1, 0, 0.002, 0.06]);
    expect(g.tier).toEqual(["mistake", "best", "best", "inaccuracy"]);
  });

  it("does not call noise a mistake: loss shrinks by 2 combined standard errors", () => {
    // Loss 60 = 6% of the pot, but 2 * sqrt(10^2 + 10^2) = 28.3 of it is noise: (60 - 28.3) / 1000 = 3.2%.
    const g = gradeOptions([{ ev: 100, stdErr: 10 }, { ev: 40, stdErr: 10 }, { ev: 99, stdErr: 30 }], 1000);
    expect(g.tier).toEqual(["best", "inaccuracy", "best"]);
    expect(g.loss[1]).toBe(60); // the reported loss is not shrunk
    // The argmax is "best" even when every option is within noise of it.
    expect(gradeOptions([{ ev: 5, stdErr: 50 }, { ev: 6, stdErr: 50 }], 100).tier).toEqual(["best", "best"]);
    expect(() => gradeOptions([], 100)).toThrow();
  });
});
