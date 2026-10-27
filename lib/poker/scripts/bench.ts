// Benchmark: `npm run bench`. Prints evaluator throughput and equity timings.
import { createRng } from "../cards";
import { exactEquity, monteCarloEquity } from "../equity";
import { evaluate7 } from "../evaluator";

const N = 1_000_000;
const rng = createRng(12345);
const hands = new Uint8Array(N * 7);
const picked = new Int32Array(52);
for (let i = 0; i < N; i++) {
  // 7 distinct random cards (rejection against a per-hand stamp).
  for (let k = 0; k < 7; k++) {
    let c: number;
    do c = rng.int(52);
    while (picked[c] === i + 1);
    picked[c] = i + 1;
    hands[i * 7 + k] = c;
  }
}

function run(): number {
  let checksum = 0;
  for (let i = 0, j = 0; i < N; i++, j += 7) {
    checksum += evaluate7(hands[j], hands[j + 1], hands[j + 2], hands[j + 3], hands[j + 4], hands[j + 5], hands[j + 6]);
  }
  return checksum;
}

run(); // warm up the JIT
let best = Infinity, checksum = 0;
for (let round = 0; round < 5; round++) {
  const t0 = performance.now();
  checksum = run();
  best = Math.min(best, performance.now() - t0);
}
const perSec = (N / best) * 1000;
console.log(`random 7-card evaluate7: ${(perSec / 1e6).toFixed(1)}M evals/sec (best of 5 x ${N.toLocaleString()}, checksum ${checksum})`);

for (const [label, hands, board] of [
  ["exact preflop AsAh vs KdKc (1,712,304 boards)", ["AsAh", "KdKc"], ""],
  ["exact preflop 3-way AsAh vs KdKc vs 7s2h", ["AsAh", "KdKc", "7s2h"], ""],
  ["exact flop AsKs vs QhQd on Ts9s2c", ["AsKs", "QhQd"], "Ts9s2c"],
] as const) {
  const t0 = performance.now();
  const r = exactEquity(hands, board);
  const ms = performance.now() - t0;
  const evalsPerSec = (r.samples * hands.length) / ms / 1000;
  console.log(`${label}: ${ms.toFixed(0)} ms, equity ${r.players.map((p) => (100 * p.equity).toFixed(3) + "%").join(" / ")} (${evalsPerSec.toFixed(0)}M incremental evals/sec)`);
}

{
  const t0 = performance.now();
  const r = monteCarloEquity(["QQ+, AKs", "22+, A2s+, KTs+, QJs, AJo+"], { seed: 1 });
  const ms = performance.now() - t0;
  console.log(
    `monte carlo range vs range, ${r.samples.toLocaleString()} trials: ${ms.toFixed(0)} ms, equity ${(100 * r.players[0].equity).toFixed(2)}% ± ${(100 * r.players[0].stdErr).toFixed(2)} (1 SE)`,
  );
}
