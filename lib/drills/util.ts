// Helpers shared by the generators: seeded picks, dealing, number/card formatting, pot+bet spots,
// and random range strings built only from tokens lib/poker's parser accepts.

import { FULL_DECK, RANK_CHARS, formatCard, shuffle, type Card, type Rng } from "../poker/cards";
import { parseRange } from "../poker/range";
import type { Difficulty } from "./types";

export const pick = <T>(rng: Rng, items: readonly T[]): T => items[rng.int(items.length)];

/** Uniform integer in [lo, hi]. */
export const intIn = (rng: Rng, lo: number, hi: number): number => lo + rng.int(hi - lo + 1);

/** Calls `attempt` until it returns a value. Deterministic for a seeded rng; throws if it never succeeds. */
export function retry<T>(attempt: () => T | null, tries = 10_000): T {
  for (let i = 0; i < tries; i++) {
    const result = attempt();
    if (result !== null) return result;
  }
  throw new Error("Drill generator gave up: no valid spot found");
}

/** Two hole cards, higher card first (display order only). */
export const hole = (cards: readonly Card[]): Card[] => [...cards].sort((a, b) => b - a);

/** `n` distinct random cards not in `used`. */
export function deal(rng: Rng, n: number, used: readonly Card[] = []): Card[] {
  const deck = FULL_DECK.filter((c) => !used.includes(c));
  return shuffle(deck, rng).slice(0, n);
}

const SUIT_SYMBOLS = "♣♦♥♠";

/** Display form for prompts: "A♥ K♦". */
export const showCards = (cards: readonly Card[]): string =>
  cards.map((c) => RANK_CHARS[c >> 2] + SUIT_SYMBOLS[c & 3]).join(" ");

/** Params form: "AhKd". */
export const cardText = (cards: readonly Card[]): string => cards.map(formatCard).join("");

/** Pot/bet numbers come in 0.5 steps, so String() prints them exactly ("12.5", "30"). */
export const num = (x: number): string => String(x);

/** Display rounding for explanations and expected answers (the stored answer stays exact). */
export const round = (x: number, digits = 2): string => String(Number(x.toFixed(digits)));

export const BET_FRACTIONS = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.5, 2] as const;

/** A pot (bb) and a bet that is a realistic fraction of it, rounded to 0.5 bb. */
export function potAndBet(rng: Rng, difficulty: Difficulty): { pot: number; bet: number } {
  const pot =
    difficulty === 1 ? 10 * intIn(rng, 1, 10) : difficulty === 2 ? intIn(rng, 4, 120) : intIn(rng, 6, 400) / 2;
  const fraction = pick(rng, difficulty === 1 ? [0.5, 0.75, 1] : BET_FRACTIONS);
  const bet = Math.max(0.5, Math.round(pot * fraction * 2) / 2);
  return { pot, bet };
}

// ---------------------------------------------------------------------------
// Random ranges

export type TokenStyle = "single" | "plus" | "run";

/** One range token, e.g. "QQ", "88+", "55-77", "AKs", "ATo+", "KTs-K8s", "QJ". */
export function randomToken(rng: Rng, styles: readonly TokenStyle[]): string {
  const style = pick(rng, styles);
  const kind = pick(rng, ["pair", "suited", "offsuit", "any"] as const);
  const R = (r: number) => RANK_CHARS[r];
  if (kind === "pair") {
    if (style === "single") return R(intIn(rng, 0, 12)).repeat(2);
    if (style === "plus") return R(intIn(rng, 4, 11)).repeat(2) + "+";
    const lo = intIn(rng, 0, 10);
    return `${R(lo).repeat(2)}-${R(intIn(rng, lo + 1, Math.min(12, lo + 3))).repeat(2)}`;
  }
  const sfx = kind === "suited" ? "s" : kind === "offsuit" ? "o" : "";
  if (style === "single") {
    const hi = intIn(rng, 1, 12);
    return R(hi) + R(intIn(rng, 0, hi - 1)) + sfx;
  }
  if (style === "plus") {
    // Kicker climbs from lo to hi - 1, so lo <= hi - 2 gives at least two classes.
    const hi = intIn(rng, 9, 12);
    return R(hi) + R(intIn(rng, Math.max(0, hi - 6), hi - 2)) + sfx + "+";
  }
  const hi = intIn(rng, 8, 12);
  const k1 = intIn(rng, 1, hi - 1);
  const k2 = intIn(rng, Math.max(0, k1 - 3), k1 - 1);
  return `${R(hi)}${R(k1)}${sfx}-${R(hi)}${R(k2)}${sfx}`;
}

/** `count` tokens whose combo sets don't overlap, with at most `maxCombos` combos in total. */
export function randomRange(
  rng: Rng,
  count: number,
  styles: readonly TokenStyle[],
  maxCombos = Infinity,
): { tokens: string[]; combos: number[] } {
  return retry(() => {
    const tokens: string[] = [];
    const combos = new Set<number>();
    for (let tries = 0; tokens.length < count && tries < 50; tries++) {
      const token = randomToken(rng, styles);
      const own = parseRange(token);
      if (own.some((c) => combos.has(c)) || combos.size + own.length > maxCombos) continue;
      tokens.push(token);
      for (const c of own) combos.add(c);
    }
    return tokens.length === count ? { tokens, combos: [...combos].sort((a, b) => a - b) } : null;
  });
}
