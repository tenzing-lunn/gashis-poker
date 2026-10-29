import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pushFoldExploitability } from "../../gto/pushfold";
import { createPushFoldTrainer, loadPushFoldPolicy, type PushFoldCheckpoint } from "./pushfold-learner";

describe("C1 push/fold learner", () => {
  it("is reproducible: the same seed gives identical weights, another seed different ones", () => {
    const run = (seed: number) => {
      const t = createPushFoldTrainer({ seed, totalEpisodes: 100_000 });
      t.train(100_000);
      return t.weights().map((w) => Array.from(w));
    };
    const a = run(4), b = run(4), c = run(5);
    expect(a).toEqual(b);
    expect(a[0]).not.toEqual(c[0]);
  }, 30_000);

  it("a short run (1.5M episodes, all stacks 2-25 bb) gets 10 bb exploitability from ~0.55 bb to <= 0.08 bb", () => {
    // The full run (scripts/train-pushfold.ts, 20M episodes) reaches <= 0.02 bb at 5, 10, 15 and 20 bb; this
    // reduced run checks the same loop learns, with a looser bound (it measured 0.054 bb when written).
    const t = createPushFoldTrainer({ seed: 1, totalEpisodes: 1_500_000 });
    const before = t.report(10).exploitability;
    t.train(1_500_000);
    const after = t.report(10).exploitability;
    expect(before).toBeGreaterThan(0.3);
    expect(after).toBeLessThan(0.08);
  }, 60_000);

  it("the committed checkpoint is within 0.02 bb of Nash at 5, 10, 15 and 20 bb", () => {
    const path = fileURLToPath(new URL("./checkpoints/pushfold-c1.json", import.meta.url));
    const checkpoint = JSON.parse(readFileSync(path, "utf8")) as PushFoldCheckpoint;
    const policy = loadPushFoldPolicy(checkpoint);
    for (const stack of [5, 10, 15, 20]) {
      const { push, call } = policy.strategy(stack);
      const r = pushFoldExploitability(stack, push, call);
      expect(r.exploitability, `${stack} bb`).toBeLessThanOrEqual(0.02);
      expect(r.exploitability).toBeCloseTo(checkpoint.exploitability[stack], 12);
    }
  });
});
