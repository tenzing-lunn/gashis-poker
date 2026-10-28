import { describe, expect, it } from "vitest";
import { isTableId, parseTableId } from "./storage";

describe("parseTableId", () => {
  it("takes a code typed in any case, with spaces or a hyphen inside", () => {
    expect(parseTableId("KQMXWD")).toBe("KQMXWD");
    expect(parseTableId("kqmxwd")).toBe("KQMXWD");
    expect(parseTableId("  KqMxWd \n")).toBe("KQMXWD");
    expect(parseTableId("kqm xwd")).toBe("KQMXWD");
    expect(parseTableId("KQM-XWD")).toBe("KQMXWD");
  });
  it("takes the code out of a pasted link", () => {
    expect(parseTableId("https://gashis-poker.vercel.app/play/t/KQMXWD")).toBe("KQMXWD");
    expect(parseTableId("http://localhost:3002/play/t/kqmxwd?x=1#y")).toBe("KQMXWD");
    expect(parseTableId("  localhost:3002/play/t/KQMXWD/  ")).toBe("KQMXWD");
  });
  it("refuses anything that is not a code", () => {
    for (const bad of ["", "abc", "KQMXW", "KQMXWDA", "KQMXWI", "KQMXWL", "KQMXWO", "KQMXW1", "a".repeat(64), "join KQMXWD", "https://example.com/play/t/KQMXWDX", "https://example.com/KQMXWD"]) {
      expect(parseTableId(bad), bad).toBeNull();
    }
  });
  it("checks route codes strictly", () => {
    expect(isTableId("KQMXWD")).toBe(true);
    expect(isTableId("kqmxwd")).toBe(false);
    expect(isTableId("a".repeat(64))).toBe(false);
  });
});
