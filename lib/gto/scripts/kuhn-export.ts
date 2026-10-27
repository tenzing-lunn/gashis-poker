// Prints our CFR+ Kuhn average policy as JSON keyed by OpenSpiel information-state strings:
//   { "iterations": N, "value": v, "exploitability": e, "policy": { "1pb": [P(pass), P(bet)], ... } }
// Test-only (feeds scripts/kuhn_openspiel_crosscheck.py); never bundled.
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs lib/gto/scripts/kuhn-export.ts [iterations]
import { createCfrSolver } from "../cfr";
import { createKuhnGame, toOpenSpielInfoState } from "../kuhn";

const iterations = Number(process.argv[2] ?? 2000);
const game = createKuhnGame();
const solver = createCfrSolver(game, { variant: "cfr+" });
solver.step(iterations);
const avg = solver.averageStrategy();
const report = solver.report();
const policy: Record<string, number[]> = {};
for (const s of game.infoSets) policy[toOpenSpielInfoState(s.key)] = Array.from(avg.subarray(s.offset, s.offset + s.actions.length));
console.log(JSON.stringify({ iterations, value: report.value, exploitability: report.exploitability, policy }, null, 2));
