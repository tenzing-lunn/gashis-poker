import { describe, expect, it } from "vitest";
import { isTableId, parseTableId, shortTableId } from "./storage";

const ID = "a".repeat(32) + "0123456789abcdef0123456789ABCDEF";

describe("parseTableId", () => {
  it("takes a bare id or the id out of a pasted link", () => {
    const id = ID.toLowerCase();
    expect(parseTableId(id)).toBe(id);
    expect(parseTableId(`  ${ID}  `)).toBe(id);
    expect(parseTableId(`https://example.com/play/t/${id}`)).toBe(id);
    expect(parseTableId(`http://localhost:3000/play/t/${id}?x=1#y`)).toBe(id);
  });
  it("refuses anything that is not a 64-character hex id", () => {
    expect(parseTableId("")).toBeNull();
    expect(parseTableId("abc")).toBeNull();
    expect(parseTableId(ID.slice(1))).toBeNull();
    expect(parseTableId(`${ID}0`)).toBeNull();
    expect(parseTableId(ID.replace("a", "g"))).toBeNull();
  });
  it("checks route ids strictly and shortens them for titles", () => {
    expect(isTableId(ID.toLowerCase())).toBe(true);
    expect(isTableId(ID)).toBe(false);
    expect(shortTableId(ID.toLowerCase())).toBe("AAAA");
  });
});
