// Full calibration run of the situation reads (results table in ../README.md).
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs lib/agent/read/scripts/calibrate.ts [sessions]
// For each persona, `sessions` (default 1,000) seeded heads-up sessions of 400 hands vs TAG; coverage of
// the 90% intervals at 25, 100 and 400 hands, pooled and per persona, for a sweep of prior weights k,
// with and without the boundary rule (reads.ts), then per persona, per situation, per (persona,
// situation) and the weakest of those cells at DEFAULT_K.

import { PERSONA_IDS, type PersonaId } from "../../../bots/personas";
import { coverage, coverageRate, pool, sessionSeed, sessionSnapshots, type Coverage } from "../calibration";
import { DEFAULT_K } from "../reads";
import { SITUATIONS } from "../situations";
import { isMainThread, runJobs, serveJobs } from "./parallel";

const CHECKPOINTS = [25, 100, 400];
const KS = [1, 2, 3, 4, 5, 8, 12];
const CHUNK = 100;

interface Job {
  persona: PersonaId;
  from: number;
  to: number;
}
/** result[variant][checkpoint][situation]; variants are KS with the boundary rule, then KS strict. */
type Result = Coverage[][][];

function run(job: Job): Result {
  const snaps: ReturnType<typeof sessionSnapshots>[] = [];
  for (let s = job.from; s < job.to; s++) snaps.push(sessionSnapshots(job.persona, CHECKPOINTS, sessionSeed(job.persona, s)));
  const variants = [...KS.map((k) => ({ k })), ...KS.map((k) => ({ k, strict: true }))];
  return variants.map((v) => CHECKPOINTS.map((_, i) => coverage(job.persona, snaps.map((x) => x[i]), v)));
}

const fmt = (c: Coverage): string => `${(100 * coverageRate(c)).toFixed(1)}%`;

async function main() {
  const sessions = Number(process.argv[2] ?? 1000);
  const jobs: Job[] = [];
  for (const persona of PERSONA_IDS) for (let from = 0; from < sessions; from += CHUNK) jobs.push({ persona, from, to: Math.min(sessions, from + CHUNK) });
  const results = await runJobs<Job, Result>(import.meta.url, jobs);

  // Sum chunks: cov[persona][variant][checkpoint][situation].
  const cov = new Map<PersonaId, Coverage[][][]>();
  results.forEach((r, j) => {
    const p = jobs[j].persona;
    const acc = cov.get(p);
    if (!acc) cov.set(p, r);
    else r.forEach((v, vi) => v.forEach((cp, ci) => cp.forEach((c, si) => {
      acc[vi][ci][si] = pool([acc[vi][ci][si], c]);
    })));
  });
  const at = (p: PersonaId, vi: number, ci: number) => pool(cov.get(p)![vi][ci]);
  const all = (vi: number, ci: number) => pool(PERSONA_IDS.map((p) => at(p, vi, ci)));
  const kIndex = KS.indexOf(DEFAULT_K);

  console.log(`\n${sessions} sessions per persona, heads-up vs TAG, 90% intervals. Pooled coverage (statements):\n`);
  console.log(`| k | ${CHECKPOINTS.map((c) => `${c} hands`).join(" | ")} | strict equal-tailed: ${CHECKPOINTS.join(" / ")} |`);
  console.log(`|---|${CHECKPOINTS.map(() => "---").join("|")}|---|`);
  KS.forEach((k, vi) =>
    console.log(
      `| ${k}${k === DEFAULT_K ? " (default)" : ""} | ${CHECKPOINTS.map((_, ci) => fmt(all(vi, ci))).join(" | ")} | ` +
        `${CHECKPOINTS.map((_, ci) => fmt(all(KS.length + vi, ci))).join(" / ")} |`,
    ),
  );
  console.log(`\nStatements counted: ${CHECKPOINTS.map((c, ci) => `${c} hands: ${all(kIndex, ci).total}`).join(", ")}\n`);

  console.log(`Per persona at k = ${DEFAULT_K}:\n`);
  console.log(`| persona | ${CHECKPOINTS.map((c) => `${c} hands`).join(" | ")} |`);
  console.log(`|---|${CHECKPOINTS.map(() => "---").join("|")}|`);
  for (const p of PERSONA_IDS) console.log(`| ${p} | ${CHECKPOINTS.map((_, ci) => fmt(at(p, kIndex, ci))).join(" | ")} |`);

  console.log(`\nPer situation at k = ${DEFAULT_K}, pooled over personas (coverage, statements):\n`);
  console.log(`| situation | ${CHECKPOINTS.map((c) => `${c} hands`).join(" | ")} |`);
  console.log(`|---|${CHECKPOINTS.map(() => "---").join("|")}|`);
  SITUATIONS.forEach((sit, si) => {
    const cells = CHECKPOINTS.map((_, ci) => {
      const c = pool(PERSONA_IDS.map((p) => cov.get(p)![kIndex][ci][si]));
      return c.total ? `${fmt(c)} (${c.total})` : "–";
    });
    console.log(`| ${sit.id} | ${cells.join(" | ")} |`);
  });

  console.log(`\nPer persona and situation at k = ${DEFAULT_K} (coverage, statements; strict equal-tailed in brackets):\n`);
  console.log(`| persona | situation | ${CHECKPOINTS.map((c) => `${c} hands`).join(" | ")} |`);
  console.log(`|---|---|${CHECKPOINTS.map(() => "---").join("|")}|`);
  const cells: { label: string; checkpoint: number; c: Coverage; strict: Coverage }[] = [];
  for (const p of PERSONA_IDS) {
    SITUATIONS.forEach((sit, si) => {
      const row = CHECKPOINTS.map((cp, ci) => {
        const c = cov.get(p)![kIndex][ci][si];
        const strict = cov.get(p)![KS.length + kIndex][ci][si];
        if (c.total === 0) return "–";
        cells.push({ label: `| ${p} | ${sit.id}`, checkpoint: cp, c, strict });
        return `${fmt(c)} (${c.total}) [${fmt(strict)}]`;
      });
      if (row.some((x) => x !== "–")) console.log(`| ${p} | ${sit.id} | ${row.join(" | ")} |`);
    });
  }

  // The weakest cells with at least MIN_CELL statements (fewer is mostly noise).
  const MIN_CELL = 100;
  console.log(`\nWeakest 12 (persona, situation, checkpoint) cells at k = ${DEFAULT_K}, at least ${MIN_CELL} statements:\n`);
  console.log(`| persona | situation | hands | coverage | strict | statements |`);
  console.log(`|---|---|---|---|---|---|`);
  cells
    .filter((x) => x.c.total >= MIN_CELL)
    .sort((x, y) => coverageRate(x.c) - coverageRate(y.c))
    .slice(0, 12)
    .forEach((x) => console.log(`${x.label} | ${x.checkpoint} | ${fmt(x.c)} | ${fmt(x.strict)} | ${x.c.total} |`));
}

if (isMainThread) await main();
else serveJobs(run);
