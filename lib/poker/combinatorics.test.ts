import { describe, expect, it } from "vitest";
import { choose } from "./combinatorics";

describe("choose", () => {
  it("counts starting hands, 5-card hands and 7-card hands", () => {
    expect(choose(52, 2)).toBe(1326);
    expect(choose(52, 5)).toBe(2_598_960);
    expect(choose(52, 7)).toBe(133_784_560);
  });
});
