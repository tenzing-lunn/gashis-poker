// Range notation <-> sets of concrete combos.
//
// A range is a sorted array of unique combo indices (see combinatorics.ts). Supported tokens,
// comma-separated, whitespace ignored, ranks case-insensitive:
//   22  22+  22-55            pairs, pairs and better, a run of pairs (either order)
//   AKs AKo AK                suited, offsuit, both
//   ATs+ ATo+ AT+             kicker climbs to one below the top card: ATs, AJs, AQs, AKs
//   KTs-K7s A5o-A2o K9-K6     kicker run with a fixed top card (either order)
//   AhKh                      one specific combo (cards in either order)
// Class tokens must put the higher rank first: "TKs", "KA" and "TKs-T7s" are rejected.

import { RANK_CHARS, formatCard, parseCard, parseRank, type Card } from "./cards";
import {
  COMBO_COUNT,
  COMBO_HI,
  COMBO_LO,
  classOfCombo,
  comboIndex,
  combosOfClass,
  handClassName,
  type HandClassKind,
} from "./combinatorics";

export type Range = readonly number[];

const R = "[2-9TJQKA]";
const SPECIFIC = new RegExp(`^(${R}[cdhs])(${R}[cdhs])$`, "i");
const PAIR = new RegExp(`^(${R})(${R})(\\+)?$`, "i");
const PAIR_RUN = new RegExp(`^(${R})(${R})-(${R})(${R})$`, "i");
const NONPAIR = new RegExp(`^(${R})(${R})([so])?(\\+)?$`, "i");
const NONPAIR_RUN = new RegExp(`^(${R})(${R})([so])?-(${R})(${R})([so])?$`, "i");

const kindsFor = (suffix: string | undefined): HandClassKind[] =>
  suffix === undefined ? ["suited", "offsuit"] : suffix.toLowerCase() === "s" ? ["suited"] : ["offsuit"];

function addClass(out: Set<number>, hi: number, lo: number, kinds: HandClassKind[]): void {
  for (const kind of kinds) for (const c of combosOfClass(hi, lo, kind)) out.add(c);
}

function parseToken(token: string, out: Set<number>): void {
  let m: RegExpMatchArray | null;
  if ((m = token.match(SPECIFIC))) {
    // Suits must be lowercase in a specific combo ("AhKh"); "AhKH" is rejected rather than guessed.
    if (!/[cdhs]$/.test(m[1]) || !/[cdhs]$/.test(m[2])) throw new Error(`Invalid combo "${token}"`);
    out.add(comboIndex(parseCard(m[1]), parseCard(m[2])));
    return;
  }
  if ((m = token.match(PAIR)) && m[1].toUpperCase() === m[2].toUpperCase()) {
    const r = parseRank(m[1]);
    for (let p = r; p <= (m[3] ? 12 : r); p++) addClass(out, p, p, ["pair"]);
    return;
  }
  if ((m = token.match(PAIR_RUN)) && m[1].toUpperCase() === m[2].toUpperCase() && m[3].toUpperCase() === m[4].toUpperCase()) {
    const a = parseRank(m[1]), b = parseRank(m[3]);
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) addClass(out, p, p, ["pair"]);
    return;
  }
  if ((m = token.match(NONPAIR))) {
    const hi = parseRank(m[1]), lo = parseRank(m[2]);
    if (hi <= lo) throw new Error(`Invalid token "${token}": put the higher rank first (e.g. KTs, not TKs)`);
    for (let k = lo; k <= (m[4] ? hi - 1 : lo); k++) addClass(out, hi, k, kindsFor(m[3]));
    return;
  }
  if ((m = token.match(NONPAIR_RUN))) {
    const a1 = parseRank(m[1]), b1 = parseRank(m[2]), a2 = parseRank(m[4]), b2 = parseRank(m[5]);
    const sameSuffix = (m[3] ?? "").toLowerCase() === (m[6] ?? "").toLowerCase();
    if (a1 !== a2 || a1 <= b1 || a2 <= b2 || !sameSuffix) {
      throw new Error(`Invalid run "${token}": write it as e.g. KTs-K7s (same top card, same suffix)`);
    }
    for (let k = Math.min(b1, b2); k <= Math.max(b1, b2); k++) addClass(out, a1, k, kindsFor(m[3]));
    return;
  }
  throw new Error(`Invalid range token "${token}"`);
}

/** Parses range notation into a sorted array of unique combo indices. */
export function parseRange(text: string): number[] {
  const out = new Set<number>();
  for (const raw of text.split(",")) {
    const token = raw.replace(/\s+/g, "");
    if (token) parseToken(token, out);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/** Card removal: drops every combo that uses a dead card. */
export function removeDeadCards(range: Range, dead: readonly Card[]): number[] {
  const isDead = new Uint8Array(52);
  for (const c of dead) isDead[c] = 1;
  return range.filter((combo) => !isDead[COMBO_HI[combo]] && !isDead[COMBO_LO[combo]]);
}

export function countCombos(range: Range | string, dead: readonly Card[] = []): number {
  const combos = typeof range === "string" ? parseRange(range) : range;
  return dead.length ? removeDeadCards(combos, dead).length : new Set(combos).size;
}

export const formatCombo = (combo: number): string => formatCard(COMBO_HI[combo]) + formatCard(COMBO_LO[combo]);

// ---------------------------------------------------------------------------
// Formatting: canonical compact notation.

/** Splits a sorted list of kicker ranks into maximal runs of consecutive ranks. */
function runs(ranks: number[]): number[][] {
  const out: number[][] = [];
  for (const r of ranks) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === r - 1) last.push(r);
    else out.push([r]);
  }
  return out;
}

/**
 * Formats a combo set compactly: full classes become class tokens (with "+" and "-" runs),
 * partial classes are listed as specific combos. Order: pairs high->low, then non-pairs by top
 * card high->low (suffix-less tokens, then suited, then offsuit), then specific combos.
 * parseRange(formatRange(r)) is always the same set as r.
 */
export function formatRange(range: Range): string {
  const has = new Uint8Array(COMBO_COUNT);
  for (const c of range) has[c] = 1;
  const full = (hi: number, lo: number, kind: HandClassKind): boolean => combosOfClass(hi, lo, kind).every((c) => has[c]);

  const tokens: string[] = [];
  const covered = new Uint8Array(COMBO_COUNT);
  const cover = (hi: number, lo: number, kind: HandClassKind) => {
    for (const c of combosOfClass(hi, lo, kind)) covered[c] = 1;
  };

  // Pairs, as runs from the top: "QQ+", "99-66", "22".
  const pairRanks: number[] = [];
  for (let r = 0; r < 13; r++) {
    if (full(r, r, "pair")) {
      pairRanks.push(r);
      cover(r, r, "pair");
    }
  }
  for (const run of runs(pairRanks).reverse()) {
    const lo = RANK_CHARS[run[0]].repeat(2), hi = RANK_CHARS[run[run.length - 1]].repeat(2);
    tokens.push(run[run.length - 1] === 12 && run.length > 1 ? `${lo}+` : run.length === 1 ? lo : `${hi}-${lo}`);
  }

  // Non-pairs, per top card: kicker runs for suited and offsuit separately ("ATs+", "KTo-K7o");
  // a run that appears in both is written once without a suffix ("AT+").
  for (let hi = 12; hi >= 1; hi--) {
    const kickers = (kind: HandClassKind): string[] => {
      const ranks: number[] = [];
      for (let lo = 0; lo < hi; lo++) {
        if (full(hi, lo, kind)) {
          ranks.push(lo);
          cover(hi, lo, kind);
        }
      }
      return runs(ranks)
        .reverse()
        .map((run) => {
          const low = run[0], high = run[run.length - 1];
          const name = (k: number) => RANK_CHARS[hi] + RANK_CHARS[k];
          if (high === hi - 1 && run.length > 1) return `${name(low)}%+`;
          return run.length === 1 ? `${name(low)}%` : `${name(high)}%-${name(low)}%`;
        });
    };
    const suited = kickers("suited"), offsuit = kickers("offsuit");
    for (const t of suited) if (offsuit.includes(t)) tokens.push(t.replace(/%/g, ""));
    for (const t of suited) if (!offsuit.includes(t)) tokens.push(t.replace(/%/g, "s"));
    for (const t of offsuit) if (!suited.includes(t)) tokens.push(t.replace(/%/g, "o"));
  }

  // Leftover combos from partial classes, strongest first.
  const leftovers = range.filter((c) => !covered[c]);
  leftovers.sort((a, b) => COMBO_HI[b] - COMBO_HI[a] || COMBO_LO[b] - COMBO_LO[a]);
  for (const c of new Set(leftovers)) tokens.push(formatCombo(c));

  return tokens.join(", ");
}

/** Name of the class a combo belongs to, e.g. "AKs". */
export function comboClassName(combo: number): string {
  const { hi, lo, kind } = classOfCombo(combo);
  return handClassName(hi, lo, kind);
}

/** All 1326 combos. */
export const ALL_COMBOS: Range = Object.freeze(Array.from({ length: COMBO_COUNT }, (_, i) => i));
