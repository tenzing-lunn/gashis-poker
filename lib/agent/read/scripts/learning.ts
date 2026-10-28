// Learning speed of the style posterior (results table in ../README.md).
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs lib/agent/read/scripts/learning.ts [sessions]
// For each persona, `sessions` (default 300) seeded heads-up sessions of 500 hands vs TAG, watched by
// the TAG seat. Prints hands seen -> share of sessions whose top style is the true persona, and the
// mean posterior on the true persona, then the first checkpoint at which the share reaches 90%.

import { PERSONA_IDS, type PersonaId } from "../../../bots/personas";
import { styleSession } from "../calibration";
import { isMainThread, runJobs, serveJobs } from "./parallel";

const CHECKPOINTS = [5, 10, 15, 20, 30, 40, 50, 60, 75, 100, 125, 150, 200, 300, 400, 500];
const CHUNK = 10;
/** Disjoint from the calibration and measurement seeds. */
const seedOf = (persona: PersonaId, s: number) => 5_000_000 + 100_000 * PERSONA_IDS.indexOf(persona) + s;

interface Job {
  persona: PersonaId;
  from: number;
  to: number;
}

function run(job: Job): number[][][] {
  const out: number[][][] = [];
  for (let s = job.from; s < job.to; s++) out.push(styleSession(job.persona, CHECKPOINTS, seedOf(job.persona, s)));
  return out;
}

async function main() {
  const sessions = Number(process.argv[2] ?? 300);
  const jobs: Job[] = [];
  for (const persona of PERSONA_IDS) for (let from = 0; from < sessions; from += CHUNK) jobs.push({ persona, from, to: Math.min(sessions, from + CHUNK) });
  const results = await runJobs<Job, number[][][]>(import.meta.url, jobs);
  const byPersona = new Map<PersonaId, number[][][]>();
  results.forEach((r, j) => byPersona.set(jobs[j].persona, [...(byPersona.get(jobs[j].persona) ?? []), ...r]));

  const top = new Map<PersonaId, number[]>();
  const mean = new Map<PersonaId, number[]>();
  for (const p of PERSONA_IDS) {
    const i = PERSONA_IDS.indexOf(p);
    const runs = byPersona.get(p)!;
    top.set(p, CHECKPOINTS.map((_, ci) => runs.filter((r) => r[ci].every((x, j) => j === i || x < r[ci][i])).length / runs.length));
    mean.set(p, CHECKPOINTS.map((_, ci) => runs.reduce((a, r) => a + r[ci][i], 0) / runs.length));
  }
  const pc = (x: number) => `${Math.round(100 * x)}%`;
  console.log(`\n${sessions} sessions per persona, heads-up vs TAG. P(true persona is the top style) (mean posterior on it):\n`);
  console.log(`| hands | ${PERSONA_IDS.join(" | ")} |`);
  console.log(`|---|${PERSONA_IDS.map(() => "---").join("|")}|`);
  CHECKPOINTS.forEach((c, ci) => console.log(`| ${c} | ${PERSONA_IDS.map((p) => `${pc(top.get(p)![ci])} (${pc(mean.get(p)![ci])})`).join(" | ")} |`));
  console.log("\nFirst checkpoint with P(top) >= 90% (and whether it stays >= 90% at every later checkpoint):\n");
  for (const p of PERSONA_IDS) {
    const t = top.get(p)!;
    const ci = t.findIndex((x) => x >= 0.9);
    console.log(`- ${p}: ${ci < 0 ? `not reached by ${CHECKPOINTS.at(-1)}` : `${CHECKPOINTS[ci]} hands${t.slice(ci).every((x) => x >= 0.9) ? "" : " (dips below later)"}`}`);
  }
}

if (isMainThread) await main();
else serveJobs(run);
