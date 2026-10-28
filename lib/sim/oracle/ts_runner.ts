// Judge's driver: exposes lib/sim to lib/sim/oracle/check.py. Reads a JSON list of tasks, writes a JSON
// list of results (same order). Cards are ints (rank*4+suit). Weights are 1326-entry arrays.
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs \
//          lib/sim/oracle/ts_runner.ts <tasks.json> <out.json>
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON plumbing for the Python judge */
import { readFileSync, writeFileSync } from "node:fs";
import { comboEquities, equityVsRange, liveWeights, startEquityVsRange } from "../weighted-equity";
import { multiwayEquity, sampleJoint } from "../multiway";
import { classShares, handBuckets, COMBO_CLASS } from "../breakdown";

const [inPath, outPath] = process.argv.slice(2);
const tasks = JSON.parse(readFileSync(inPath, "utf8")) as any[];
const W = (a: (number | string)[]) => Float64Array.from(a, Number); // "NaN"/"Infinity" strings allowed
const arr = (f: Float64Array) => Array.from(f, (x) => (Number.isNaN(x) ? null : x));
const tryIt = (f: () => unknown) => {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
};

const run = (t: any): unknown => {
  switch (t.op) {
    case "hu": {
      const w = W(t.weights);
      const r = equityVsRange(t.hero, w, t.board, { dead: t.dead });
      const ce = comboEquities(t.hero, t.board, w, { dead: t.dead });
      return { r, ce: { equity: arr(ce.equity), win: arr(ce.win), tie: arr(ce.tie), exact: ce.exact, samplesPerCombo: ce.samplesPerCombo } };
    }
    case "eq": // equityVsRange only (preflop MC or exact)
      return tryIt(() => equityVsRange(t.hero, W(t.weights), t.board, { dead: t.dead, trials: t.trials, seed: t.seed }));
    case "ceq": // comboEquities only
      return tryIt(() => {
        const ce = comboEquities(t.hero, t.board, W(t.weights), { dead: t.dead, trialsPerCombo: t.trialsPerCombo, seed: t.seed });
        return { equity: arr(ce.equity), stdErr: Array.from(ce.stdErr), exact: ce.exact };
      });
    case "live":
      return tryIt(() => Array.from(liveWeights(W(t.weights), t.blocked)));
    case "progressive": {
      const w = W(t.weights);
      const opts = { dead: t.dead, trials: t.trials, seed: t.seed };
      const one = equityVsRange(t.hero, w, t.board, opts);
      const out: any[] = [];
      for (const chunks of t.chunkings as number[][]) {
        const run = startEquityVsRange(t.hero, w, t.board, opts);
        let earlyThrows: boolean | null = null;
        let i = 0, calls = 0;
        while (!run.done && calls < 1e7) {
          const u = chunks[i++ % chunks.length];
          const done = run.step(u);
          calls++;
          if (earlyThrows === null && !done && t.board.length >= 3) earlyThrows = tryIt(() => run.result()).ok === false;
        }
        out.push({ result: run.result(), calls, earlyThrows, extraStep: run.step(5) });
      }
      return { one, out };
    }
    case "mw":
      return tryIt(() => multiwayEquity(t.hero, t.ranges.map(W), t.board, { dead: t.dead, trials: t.trials, seed: t.seed }));
    case "joint":
      return tryIt(() => {
        const r = sampleJoint(t.ranges.map(W), t.blocked, t.count, t.seed);
        return { combos: r.combos.map((c) => Array.from(c)), acceptance: r.acceptance };
      });
    case "classShares":
      return { shares: Array.from(classShares(W(t.weights))), comboClass: Array.from(COMBO_CLASS) };
    case "buckets":
      return tryIt(() => handBuckets(W(t.weights), t.board));
    case "time": {
      const w = W(t.weights);
      const c0 = performance.now();
      equityVsRange(t.hero, w, t.board); // cold
      const cold = performance.now() - c0;
      const times: number[] = [];
      let res: any = null;
      for (let i = 0; i < t.reps; i++) {
        const t0 = performance.now();
        res = equityVsRange(t.hero, w, t.board);
        times.push(performance.now() - t0);
      }
      return { cold, times, combos: res.combos };
    }
    default:
      throw new Error(`unknown op ${t.op}`);
  }
};

writeFileSync(outPath, JSON.stringify(tasks.map(run)));
