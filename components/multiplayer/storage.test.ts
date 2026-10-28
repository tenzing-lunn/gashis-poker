import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTableId, loadRecentTables, parseTableId, RECENT_TABLES, saveRecentTable } from "./storage";

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

describe("recent tables", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the most recent first, once each, up to the limit", () => {
    expect(loadRecentTables()).toEqual([]);
    saveRecentTable("AAAAAA", 1);
    saveRecentTable("BBBBBB", 2);
    saveRecentTable("AAAAAA", 3);
    expect(loadRecentTables()).toEqual([
      { code: "AAAAAA", at: 3 },
      { code: "BBBBBB", at: 2 },
    ]);
    for (const [i, c] of ["CCCCCC", "DDDDDD", "EEEEEE", "FFFFFF", "GGGGGG"].entries()) saveRecentTable(c, 10 + i);
    const codes = loadRecentTables().map((t) => t.code);
    expect(codes).toHaveLength(RECENT_TABLES);
    expect(codes[0]).toBe("GGGGGG");
    expect(codes).not.toContain("BBBBBB");
  });
  it("ignores junk in storage", () => {
    window.localStorage.setItem("gp.tables", "not json");
    expect(loadRecentTables()).toEqual([]);
    window.localStorage.setItem("gp.tables", JSON.stringify([{ code: "abc", at: 1 }, null, { code: "HHHHHH", at: 5 }]));
    expect(loadRecentTables()).toEqual([{ code: "HHHHHH", at: 5 }]);
  });
});
