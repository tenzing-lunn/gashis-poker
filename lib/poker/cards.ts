// Card encoding: a card is an integer 0..51, id = rank * 4 + suit.
//   rank 0..12 = 2,3,4,5,6,7,8,9,T,J,Q,K,A   (so higher rank = higher number)
//   suit 0..3  = c,d,h,s
// rank = id >> 2, suit = id & 3. Integers keep hot loops allocation-free and index straight into tables.

export type Card = number;

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "cdhs";

export const rankOf = (card: Card): number => card >> 2;
export const suitOf = (card: Card): number => card & 3;
export const makeCard = (rank: number, suit: number): Card => rank * 4 + suit;

export function parseRank(ch: string): number {
  const r = RANK_CHARS.indexOf(ch.toUpperCase());
  if (r < 0 || ch.length !== 1) throw new Error(`Invalid rank "${ch}"`);
  return r;
}

export function parseCard(text: string): Card {
  if (text.length !== 2) throw new Error(`Invalid card "${text}"`);
  const suit = SUIT_CHARS.indexOf(text[1].toLowerCase());
  if (suit < 0) throw new Error(`Invalid suit in card "${text}"`);
  return makeCard(parseRank(text[0]), suit);
}

export function formatCard(card: Card): string {
  if (!Number.isInteger(card) || card < 0 || card > 51) throw new Error(`Invalid card id ${card}`);
  return RANK_CHARS[card >> 2] + SUIT_CHARS[card & 3];
}

/** Parses "AsKd7h", "As Kd 7h" or "As,Kd,7h". Throws on duplicates. */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/[\s,]+/g, "");
  if (compact.length % 2 !== 0) throw new Error(`Invalid card list "${text}"`);
  const cards: Card[] = [];
  for (let i = 0; i < compact.length; i += 2) cards.push(parseCard(compact.slice(i, i + 2)));
  assertDistinct(cards);
  return cards;
}

export const formatCards = (cards: readonly Card[]): string => cards.map(formatCard).join("");

export const FULL_DECK: readonly Card[] = Object.freeze(Array.from({ length: 52 }, (_, i) => i));

export function assertDistinct(cards: readonly Card[]): void {
  const seen = new Uint8Array(52);
  for (const c of cards) {
    if (!Number.isInteger(c) || c < 0 || c > 51) throw new Error(`Invalid card id ${c}`);
    if (seen[c]) throw new Error(`Duplicate card ${formatCard(c)}`);
    seen[c] = 1;
  }
}

// ---------------------------------------------------------------------------
// Seedable PRNG: xoshiro128** (Blackman & Vigna), seeded through splitmix32.
// 32-bit state words so everything stays in fast int32 math; period 2^128 - 1.

export interface Rng {
  /** Uniform uint32. */
  nextU32(): number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const splitmix = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = splitmix(), b = splitmix(), c = splitmix(), d = splitmix();
  if ((a | b | c | d) === 0) a = 1; // all-zero state is the one fixed point

  const nextU32 = (): number => {
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return result;
  };
  const next = (): number => nextU32() / 4294967296;
  return { nextU32, next, int: (n: number) => Math.floor(next() * n) };
}

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}
