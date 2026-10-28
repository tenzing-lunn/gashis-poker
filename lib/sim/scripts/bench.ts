// Benchmark for lib/sim: exact flop/turn/river equity vs a full (~1,000-combo) weighted range, preflop
// Monte Carlo, per-combo equities and multiway sampling. Run:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs lib/sim/scripts/bench.ts
import { createRng, parseCards, type Card } from "../../poker/cards";
import { COMBO_COUNT } from "../../poker/combinatorics";
import { multiwayEquity } from "../multiway";
import { comboEquities, equityVsRange } from "../weighted-equity";

const rng = createRng(7);
const randomWeights = (): Float64Array => {
  const w = new Float64Array(COMBO_COUNT);
  for (let c = 0; c < COMBO_COUNT; c++) w[c] = 0.05 + rng.next();
  return w;
};
const hero = parseCards("AsKs") as [Card, Card];

const time = (label: string, f: () => string, reps = 5): void => {
  const t0 = performance.now();
  f(); // the first (cold, unoptimized) call is reported too
  const cold = performance.now() - t0;
  let best = Infinity, out = "";
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    out = f();
    best = Math.min(best, performance.now() - t0);
  }
  console.log(`${label}: ${best.toFixed(1)} ms (best of ${reps}; cold ${cold.toFixed(1)} ms), ${out}`);
};

for (const [street, board] of [["flop", "Ts9s2c"], ["turn", "Ts9s2c7h"], ["river", "Ts9s2c7h3d"]] as const) {
  const b = parseCards(board);
  const w = randomWeights();
  const combos = equityVsRange(hero, w, b).combos;
  time(`exact ${street} equityVsRange vs ${combos} combos`, () => {
    const r = equityVsRange(hero, w, b);
    return `equity ${(100 * r.equity).toFixed(3)}%, ${r.samples} runouts/combo`;
  });
  time(`exact ${street} comboEquities vs ${combos} combos`, () => {
    const r = comboEquities(hero, b, w);
    return `${r.samplesPerCombo} runouts/combo`;
  });
}

{
  const w = randomWeights();
  time("preflop MC equityVsRange, 200k trials", () => {
    const r = equityVsRange(hero, w, [], { seed: 1 });
    return `equity ${(100 * r.equity).toFixed(2)}% ± ${(100 * r.stdErr).toFixed(2)} (${r.combos} combos)`;
  }, 3);
  time("preflop MC comboEquities, 200 boards x 1,225 combos", () => {
    const r = comboEquities(hero, [], w, { seed: 1 });
    return `${r.samplesPerCombo} boards/combo`;
  }, 3);
}

{
  const b = parseCards("Ts9s2c");
  const ranges = [randomWeights(), randomWeights(), randomWeights()];
  time("multiway flop, hero vs 3 ranges, 100k trials", () => {
    const r = multiwayEquity(hero, ranges, b, { seed: 1 });
    return `hero ${(100 * r.players[0].equity).toFixed(2)}% ± ${(100 * r.players[0].stdErr).toFixed(2)}, acceptance ${r.acceptance.toFixed(3)}`;
  }, 3);
}
