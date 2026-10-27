import { describe, expect, it } from "vitest";
import { runJob, type JobContext } from "../../workers/solver.worker";
import type { RiverRequest, SolverResponse } from "./worker-protocol";

const REQUEST: RiverRequest = {
  kind: "river",
  id: 7,
  board: "Ks7d2c9h4s",
  oopRange: "AK, KQ, KJ, 99, 77, 22, A9s, 98s, 87s, QQ, JJ, TT, 88",
  ipRange: "AA, KK, AK, KQ, 99, 77, 44, AQs, QJs, JTs, 65s, 86s, T8s, 53s",
  pot: 10,
  stack: 50,
  oopBetSizes: [0.33, 0.75],
  ipBetSizes: [0.33, 0.75],
  raiseSizes: [1],
  allIn: true,
  maxRaises: 1,
  targetPct: 0.3,
  maxIterations: 5000,
};

function context(current: () => boolean = () => true) {
  const posts: SolverResponse[] = [];
  let clock = 0;
  const ctx: JobContext = {
    post: (m) => posts.push(m),
    isCurrent: current,
    sleep: () => Promise.resolve(),
    now: () => (clock += 1),
  };
  return { ctx, posts };
}

describe("solver worker: river jobs", () => {
  it("streams progress and finishes below the target with a full result", async () => {
    const { ctx, posts } = context();
    await runJob(REQUEST, ctx);
    expect(posts.every((m) => m.id === 7 && m.kind === "river")).toBe(true);
    const done = posts[posts.length - 1];
    if (done.kind !== "river" || done.type !== "done") throw new Error(`last message is ${done.type}`);
    const progress = posts.filter((m) => m.type === "progress");
    expect(progress.length).toBeGreaterThan(1);
    const points = posts.flatMap((m) => (m.kind === "river" && m.type !== "error" ? m.points : []));
    // Points are strictly increasing in iteration and end at the result.
    for (let k = 1; k < points.length; k++) expect(points[k].iteration).toBeGreaterThan(points[k - 1].iteration);
    const r = done.result;
    expect(points[points.length - 1]).toEqual({ iteration: r.iterations, exploitabilityPct: r.exploitabilityPct });
    expect(r.stoppedBy).toBe("target");
    expect(r.exploitabilityPct).toBeLessThan(0.3);
    expect(r.potShare[0] + r.potShare[1]).toBeCloseTo(10, 10);
    expect(r.board).toBe("Ks7d2c9h4s");
    expect(r.nodes.length).toBe(r.counts.decision);
    expect(r.rangeCombos[0].length).toBe(r.combos[0]);
    // Root: OOP, reach 1 for every combo, strategies sum to 1.
    const root = r.nodes[0];
    expect(root.player).toBe(0);
    expect(root.history).toEqual([]);
    expect(Array.from(root.reach).every((x) => x === 1)).toBe(true);
    const n = r.combos[0], A = root.actions.length;
    for (let i = 0; i < n; i++) {
      let t = 0;
      for (let a = 0; a < A; a++) t += root.strategy[a * n + i];
      expect(t).toBeCloseTo(1, 5);
    }
    // Links: the check leads to IP's decision, whose parent is the root.
    const ipAfterCheck = r.nodes[root.next[0]];
    expect(ipAfterCheck.player).toBe(1);
    expect(ipAfterCheck.parent).toBe(0);
    expect(ipAfterCheck.history).toEqual(["OOP Check"]);
    expect(r.rangeCombos[1].find((c) => c.label === "KhKd")).toMatchObject({ category: "trips", classIndex: 14 });
  });

  it("stops at max iterations and says so", async () => {
    const { ctx, posts } = context();
    await runJob({ ...REQUEST, targetPct: 1e-9, maxIterations: 40 }, ctx);
    const done = posts[posts.length - 1];
    if (done.kind !== "river" || done.type !== "done") throw new Error("no result");
    expect(done.result.iterations).toBe(40);
    expect(done.result.stoppedBy).toBe("max-iterations");
  });

  it("reports invalid input as an error message", async () => {
    const cases: [Partial<RiverRequest>, RegExp][] = [
      [{ board: "Ks7d2c" }, /exactly 5 cards/],
      [{ board: "Ks7d2c9hKs" }, /Duplicate card Ks/],
      [{ oopRange: "" }, /OOP range is empty/],
      [{ ipRange: "Ks7d" }, /IP range is empty once/],
      [{ ipRange: "AK, XYZ" }, /IP range: Invalid range token/],
      [{ targetPct: 0 }, /Target exploitability/],
    ];
    for (const [over, pattern] of cases) {
      const { ctx, posts } = context();
      await runJob({ ...REQUEST, ...over }, ctx);
      expect(posts).toHaveLength(1);
      const m = posts[0];
      expect(m.type).toBe("error");
      if (m.type === "error") expect(m.message).toMatch(pattern);
    }
  });

  it("a superseded job posts nothing", async () => {
    let yields = 0;
    const { ctx, posts } = context(() => yields === 0);
    ctx.sleep = () => {
      yields++;
      return Promise.resolve();
    };
    await runJob(REQUEST, ctx);
    expect(posts).toHaveLength(0);
  });
});
