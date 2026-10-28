// Benchmark for lib/grading: gradeDecision on scripted heads-up and 3-way spots. Run:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs lib/grading/scripts/bench.ts
import { STATION, TAG } from "../../bots/personas";
import { gradeDecision } from "../grade";
import { scenario, type Step } from "../test-helpers";

const HU: Step[] = ["raise", "call", "check", "bet33", "call", "check", "check", "check", "bet66"];
const spots: [string, () => ReturnType<typeof scenario>][] = [
  ["heads-up river, facing a bet", () => scenario([10_000, 10_000], 0, 1, "9h8h", "Ks9d4c7h2s", [TAG, TAG], HU)],
  ["heads-up river, first to act", () => scenario([10_000, 10_000], 0, 1, "9h8h", "Ks9d4c7h2s", [TAG, TAG], HU.slice(0, 7))],
  ["heads-up turn, first to act", () => scenario([10_000, 10_000], 0, 1, "9h8h", "Ks9d4c7h", [TAG, TAG], HU.slice(0, 5))],
  ["heads-up flop, first to act", () => scenario([10_000, 10_000], 0, 1, "9h8h", "Ks9d4c", [TAG, TAG], HU.slice(0, 2))],
  ["heads-up preflop, facing an open", () => scenario([10_000, 10_000], 0, 1, "9h8h", "", [TAG, TAG], HU.slice(0, 1))],
  ["3-way flop, checked to the hero", () => scenario([10_000, 10_000, 10_000], 0, 0, "Ah9h", "Ks9d4c", [TAG, TAG, STATION], ["raise", "call", "call", "check", "check"])],
  ["3-way preflop, hero opens on the button", () => scenario([10_000, 10_000, 10_000], 0, 0, "Ah9h", "", [TAG, TAG, STATION], [])],
];

for (const [label, make] of spots) {
  const sc = make();
  const times: number[] = [];
  for (let rep = 0; rep < 4; rep++) {
    const t = performance.now();
    gradeDecision({ ...sc, options: { seed: rep + 1 } });
    times.push(performance.now() - t);
  }
  const warm = times.slice(1).sort((a, b) => a - b)[1];
  console.log(`${label.padEnd(42)} cold ${times[0].toFixed(0).padStart(5)} ms   warm ${warm.toFixed(0).padStart(5)} ms`);
}
