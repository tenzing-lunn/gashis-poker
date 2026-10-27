// NOTICE: testing/phe-sample.csv holds 1,200 rows sampled from HenryRLee/PokerHandEvaluator's
// test_data (https://github.com/HenryRLee/PokerHandEvaluator, Copyright 2016-2023 Henry Lee,
// Apache License 2.0). See testing/PHE-SAMPLE-NOTICE.txt and testing/LICENSE-APACHE-2.0.txt.
// PHE ranks 1 (royal flush) .. 7462 (worst); our values run the other way, so ours = 7463 - theirs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCard } from "./cards";
import { evaluate } from "./evaluator";

describe("evaluator vs PokerHandEvaluator fixtures", () => {
  it("agrees on every sampled 5-, 6- and 7-card row", () => {
    const rows = readFileSync(path.join(__dirname, "testing", "phe-sample.csv"), "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(rows.length).toBe(1200);
    const sizes = new Set<number>();
    for (const row of rows) {
      const cols = row.split(",");
      const cards = cols.slice(0, -1).map(parseCard);
      sizes.add(cards.length);
      expect(evaluate(cards), row).toBe(7463 - Number(cols[cols.length - 1]));
    }
    expect([...sizes].sort()).toEqual([5, 6, 7]);
  });

  it("ships with its licence and notice", () => {
    const dir = path.join(__dirname, "testing");
    expect(readFileSync(path.join(dir, "LICENSE-APACHE-2.0.txt"), "utf8")).toMatch(/Apache License\s+Version 2\.0/);
    expect(readFileSync(path.join(dir, "PHE-SAMPLE-NOTICE.txt"), "utf8")).toMatch(/Copyright 2016-2023 Henry Lee/);
  });
});
