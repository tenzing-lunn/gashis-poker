// Builds lib/gto/data/preflop-matrix.ts: for every pair of the 169 hand classes (SB class i, BB class j),
//   n_ij = number of card-disjoint (combo of i, combo of j) pairs, and
//   E_ij = SB's all-in preflop equity averaged over those n_ij pairs, each computed EXACTLY by
//          exactEquity (all 1,712,304 boards).
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs lib/gto/scripts/build-preflop-matrix.ts
//
// Work saved:
// - Only i < j is computed: E_ji = 1 - E_ij (two players' equities sum to 1), and E_ii = 1/2 exactly
//   (the ordered pairs (a, b) and (b, a) of one class both occur and their equities sum to 1).
// - Suit isomorphism: relabelling suits doesn't change equity, so each combo pair is mapped to the
//   smallest encoding over the 24 suit permutations and both seat orders (a seat swap turns E into
//   1 - E). Each distinct matchup is enumerated once.
// - The distinct matchups are farmed out to node:worker_threads, one per core, from a shared queue.
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { exactEquity } from "../../poker/equity";
import { COMBO_HI, COMBO_LO, HAND_CLASSES, combosOfClass } from "../../poker/combinatorics";

const K = 169;
const CHUNK = 64;

function workerLoop(): void {
  // Messages: Int32Array of [a, b, c, d] card quads; reply with each quad's first-hand equity.
  parentPort!.on("message", (msg: { id: number; quads: Int32Array }) => {
    const { id, quads } = msg;
    const out = new Float64Array(quads.length / 4);
    for (let k = 0; k < out.length; k++) {
      const q = 4 * k;
      out[k] = exactEquity([[quads[q], quads[q + 1]], [quads[q + 2], quads[q + 3]]]).players[0].equity;
    }
    parentPort!.postMessage({ id, out });
  });
}

const PERMS: number[][] = [];
(function permute(prefix: number[], rest: number[]) {
  if (!rest.length) PERMS.push(prefix);
  rest.forEach((s, i) => permute([...prefix, s], [...rest.slice(0, i), ...rest.slice(i + 1)]));
})([], [0, 1, 2, 3]);

/** Encodes an ordered matchup (hand 1 = {a, b}, hand 2 = {c, d}) with each hand's cards sorted high first. */
function encode(a: number, b: number, c: number, d: number): number {
  const h1 = a > b ? a * 52 + b : b * 52 + a;
  const h2 = c > d ? c * 52 + d : d * 52 + c;
  return h1 * 2704 + h2;
}

/** Smallest encoding over suit relabellings and seat orders; negative when the minimum has the seats swapped. */
function canonical(a: number, b: number, c: number, d: number): number {
  let best = Infinity, swapped = false;
  for (const p of PERMS) {
    const pa = (a & ~3) | p[a & 3], pb = (b & ~3) | p[b & 3], pc = (c & ~3) | p[c & 3], pd = (d & ~3) | p[d & 3];
    const k1 = encode(pa, pb, pc, pd), k2 = encode(pc, pd, pa, pb);
    if (k1 < best) { best = k1; swapped = false; }
    if (k2 < best) { best = k2; swapped = true; }
  }
  // +1 so that key 0 can still carry a sign.
  return swapped ? -(best + 1) : best + 1;
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const classCombos = HAND_CLASSES.map((h) => combosOfClass(h.hi, h.lo, h.kind));

  // Every card-disjoint unordered combo pair with i < j, as (class pair, canonical matchup, swapped?).
  const keyIndex = new Map<number, number>();
  const reps: number[] = []; // canonical matchups' cards, 4 per matchup
  const pairCell: number[] = [], pairRep: number[] = [], pairSwap: number[] = [];
  const n = new Float64Array(K * K);
  for (let i = 0; i < K; i++) {
    for (let j = i; j < K; j++) {
      for (const x of classCombos[i]) {
        for (const y of classCombos[j]) {
          const a = COMBO_HI[x], b = COMBO_LO[x], c = COMBO_HI[y], d = COMBO_LO[y];
          if (a === c || a === d || b === c || b === d) continue;
          n[i * K + j]++;
          if (i === j) continue;
          const key = canonical(a, b, c, d);
          const abs = Math.abs(key);
          let r = keyIndex.get(abs);
          if (r === undefined) {
            r = reps.length / 4;
            keyIndex.set(abs, r);
            // Decode the canonical representative's cards.
            const k = abs - 1, h1 = Math.floor(k / 2704), h2 = k % 2704;
            reps.push(Math.floor(h1 / 52), h1 % 52, Math.floor(h2 / 52), h2 % 52);
          }
          pairCell.push(i * K + j);
          pairRep.push(r);
          pairSwap.push(key < 0 ? 1 : 0);
        }
      }
    }
  }
  const matchups = reps.length / 4;
  console.log(`${pairCell.length.toLocaleString()} unordered combo pairs across classes -> ${matchups.toLocaleString()} distinct matchups (${((performance.now() - t0) / 1000).toFixed(1)} s)`);

  // Enumerate the distinct matchups in parallel.
  const threads = availableParallelism();
  const equity = new Float64Array(matchups);
  let next = 0, done = 0;
  const repCards = Int32Array.from(reps);
  const t1 = performance.now();
  await new Promise<void>((resolve, reject) => {
    let active = threads;
    for (let w = 0; w < threads; w++) {
      const worker = new Worker(new URL(import.meta.url));
      const feed = () => {
        if (next >= matchups) {
          void worker.terminate();
          if (--active === 0) resolve();
          return;
        }
        const id = next, count = Math.min(CHUNK, matchups - next);
        next += count;
        worker.postMessage({ id, quads: repCards.slice(4 * id, 4 * (id + count)) });
      };
      worker.on("message", ({ id, out }: { id: number; out: Float64Array }) => {
        equity.set(out, id);
        done += out.length;
        if (done % (CHUNK * 100) < out.length) {
          const s = (performance.now() - t1) / 1000;
          console.log(`  ${done.toLocaleString()} / ${matchups.toLocaleString()} matchups, ${s.toFixed(0)} s elapsed, ~${((s / done) * (matchups - done)).toFixed(0)} s left`);
        }
        feed();
      });
      worker.on("error", reject);
      feed();
    }
  });
  const enumSeconds = (performance.now() - t1) / 1000;

  // Aggregate into the class matrix (upper triangle; the loader mirrors it).
  const sum = new Float64Array(K * K);
  for (let p = 0; p < pairCell.length; p++) {
    const e = equity[pairRep[p]];
    sum[pairCell[p]] += pairSwap[p] ? 1 - e : e;
  }
  const E = new Float64Array(K * K);
  for (let i = 0; i < K; i++) {
    E[i * K + i] = 0.5;
    for (let j = i + 1; j < K; j++) E[i * K + j] = sum[i * K + j] / n[i * K + j];
  }
  let total = 0;
  for (let i = 0; i < K; i++) for (let j = i; j < K; j++) total += i === j ? n[i * K + j] : 2 * n[i * K + j];

  const out = new URL("../data/preflop-matrix.ts", import.meta.url);
  const totalSeconds = (performance.now() - t0) / 1000;
  const source = encodePreflopMatrix(E, n, {
    note: `${matchups.toLocaleString()} distinct matchups enumerated exactly on ${threads} threads in ${enumSeconds.toFixed(0)} s (${totalSeconds.toFixed(0)} s total).`,
  });
  writeFileSync(out, source);
  console.log(`ordered combo pairs: ${total.toLocaleString()} (expect 1,624,350)`);
  console.log(`enumeration ${enumSeconds.toFixed(1)} s on ${threads} threads, total ${totalSeconds.toFixed(1)} s; wrote ${fileURLToPath(out)} (${source.length.toLocaleString()} bytes)`);
}

/**
 * Source text of data/preflop-matrix.ts (format documented in ../preflop-matrix.ts). Lives here, not
 * in the loader, because the loader imports the data file this script creates.
 */
function encodePreflopMatrix(E: Float64Array, n: Float64Array, meta: { note: string }): string {
  const scale = 1e9; // < 2^32, so E = 1 still fits a Uint32
  const triangle = (K * (K + 1)) / 2;
  const eq = Buffer.alloc(4 * triangle), pr = Buffer.alloc(triangle);
  let t = 0;
  for (let i = 0; i < K; i++) {
    for (let j = i; j < K; j++, t++) {
      eq.writeUInt32LE(Math.round(E[i * K + j] * scale), 4 * t);
      pr[t] = n[i * K + j];
    }
  }
  const lines = (s: string) => (s.match(/.{1,100}/g) ?? []).map((l) => `    "${l}",`).join("\n");
  const classOrder = HAND_CLASSES.map((h) => h.name).join(",");
  return `// Generated by lib/gto/scripts/build-preflop-matrix.ts. Do not edit; the format is documented in lib/gto/preflop-matrix.ts.
// ${meta.note}
import type { PreflopMatrixData } from "../preflop-matrix";

export const PREFLOP_MATRIX_DATA: PreflopMatrixData = {
  classOrder: ${JSON.stringify(classOrder)},
  equityScale: ${scale},
  note: ${JSON.stringify(meta.note)},
  equity: [
${lines(eq.toString("base64"))}
  ].join(""),
  pairs: [
${lines(pr.toString("base64"))}
  ].join(""),
};
`;
}

// Entry point last, so every module-level constant above is initialised first.
if (isMainThread) void main();
else workerLoop();
