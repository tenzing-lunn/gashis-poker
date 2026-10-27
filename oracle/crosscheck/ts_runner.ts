// Thin driver that exposes the builder's lib/poker API to the Python cross-checker.
// Usage: node --import <repo>/lib/poker/scripts/register-ts.mjs ts_runner.ts <job.json> <out.json>
// A job is {op, ...args}; the output is JSON (or a binary file for op "all5").
import { readFileSync, writeFileSync } from "node:fs";
import { parseCard } from "../../lib/poker/cards";
import { formatCombo, formatRange, parseRange, removeDeadCards } from "../../lib/poker/range";
import { comboIndex } from "../../lib/poker/combinatorics";
import { exactEquity, monteCarloEquity } from "../../lib/poker/equity";
import {
  CARD_HI, CARD_KEY, CARD_LO, CARD_SUIT, evaluate, evaluate5, evaluate6, evaluate7, evaluateState, handCategory,
} from "../../lib/poker/evaluator";

const [jobPath, outPath] = process.argv.slice(2);
const job = JSON.parse(readFileSync(jobPath, "utf8"));
const cards = (s: string) => s.match(/../g)!.map(parseCard);
const tryIt = <T>(f: () => T): { ok: true; value: T } | { ok: false; error: string } => {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
};

let out: unknown;
switch (job.op) {
  case "categories": // category name of every value 1..7462
    out = Array.from({ length: 7462 }, (_, i) => handCategory(i + 1));
    break;
  case "all5": { // evaluate5 over all C(52,5) in lexicographic order -> Uint16 binary
    const buf = new Uint16Array(2_598_960);
    let i = 0;
    for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++)
      for (let d = c + 1; d < 52; d++) for (let e = d + 1; e < 52; e++) buf[i++] = evaluate5(a, b, c, d, e);
    writeFileSync(outPath, Buffer.from(buf.buffer));
    process.exit(0);
  }
  // falls through (unreachable)
  case "hist7": { // value histogram over all 133,784,560 seven-card hands (own loop, not the builder's test)
    const h = new Float64Array(7463);
    const K = CARD_KEY, S = CARD_SUIT, L = CARD_LO, H = CARD_HI;
    for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++)
      for (let d = c + 1; d < 52; d++) for (let e = d + 1; e < 52; e++) {
        const k5 = K[a] + K[b] + K[c] + K[d] + K[e], s5 = S[a] + S[b] + S[c] + S[d] + S[e];
        const l5 = L[a] | L[b] | L[c] | L[d] | L[e], h5 = H[a] | H[b] | H[c] | H[d] | H[e];
        for (let f = e + 1; f < 52; f++) for (let g = f + 1; g < 52; g++)
          h[evaluateState(k5 + K[f] + K[g], s5 + S[f] + S[g], l5 | L[f] | L[g], h5 | H[f] | H[g])]++;
      }
    out = Array.from(h);
    break;
  }
  case "eval": // [cardString] -> [evaluate(), evaluateN()]
    out = (job.hands as string[]).map((s) => {
      const c = cards(s);
      const pos = c.length === 5 ? evaluate5(c[0], c[1], c[2], c[3], c[4])
        : c.length === 6 ? evaluate6(c[0], c[1], c[2], c[3], c[4], c[5])
        : evaluate7(c[0], c[1], c[2], c[3], c[4], c[5], c[6]);
      return [evaluate(c), pos];
    });
    break;
  case "exact":
    out = (job.spots as { hands: string[]; board: string; dead: string }[]).map((s) =>
      tryIt(() => exactEquity(s.hands, s.board, s.dead)));
    break;
  case "mc":
    out = (job.spots as { ranges: string[]; board: string; dead: string; seed: number; trials?: number }[]).map((s) =>
      tryIt(() => {
        const t0 = performance.now();
        const r = monteCarloEquity(s.ranges, { board: s.board, dead: s.dead, seed: s.seed, trials: s.trials });
        return { ...r, ms: performance.now() - t0 };
      }));
    break;
  case "parse": // range text -> combos (as strings)
    out = (job.texts as string[]).map((t) => tryIt(() => parseRange(t).map(formatCombo)));
    break;
  case "roundtrip": // text -> parse -> format -> parse
    out = (job.texts as string[]).map((t) => tryIt(() => {
      const a = parseRange(t);
      const f = formatRange(a);
      return { formatted: f, combos: parseRange(f).map(formatCombo), original: a.map(formatCombo) };
    }));
    break;
  case "formatSets": // explicit combo sets -> format -> parse
    out = (job.sets as string[][]).map((set) => tryIt(() => {
      const r = [...new Set(set.map((s) => comboIndex(parseCard(s.slice(0, 2)), parseCard(s.slice(2)))))].sort((x, y) => x - y);
      const f = formatRange(r);
      return { formatted: f, combos: parseRange(f).map(formatCombo) };
    }));
    break;
  case "removeDead":
    out = (job.items as { text: string; dead: string }[]).map((it) =>
      tryIt(() => removeDeadCards(parseRange(it.text), it.dead ? cards(it.dead) : []).map(formatCombo)));
    break;
  case "bench": { // independent throughput check: own hand generator, checksum cross-checked
    const N = job.n as number;
    let x = 0x2545f491;
    const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % 52; };
    const hands = new Uint8Array(N * 7);
    const stamp = new Int32Array(52);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 7; k++) {
        let c: number;
        do c = rnd(); while (stamp[c] === i + 1);
        stamp[c] = i + 1;
        hands[i * 7 + k] = c;
      }
    }
    const pass = () => {
      let sum = 0;
      for (let j = 0; j < N * 7; j += 7) sum += evaluate7(hands[j], hands[j + 1], hands[j + 2], hands[j + 3], hands[j + 4], hands[j + 5], hands[j + 6]);
      return sum;
    };
    pass();
    const times: number[] = [];
    let sum = 0;
    for (let r = 0; r < 5; r++) { const t0 = performance.now(); sum = pass(); times.push(performance.now() - t0); }
    let check = 0; // slow path over the same hands: array API
    for (let j = 0; j < N * 7; j += 7) check += evaluate(Array.from(hands.subarray(j, j + 7)));
    out = { n: N, bestMs: Math.min(...times), times, sum, check };
    break;
  }
  default:
    throw new Error(`unknown op ${job.op}`);
}
writeFileSync(outPath, JSON.stringify(out));
