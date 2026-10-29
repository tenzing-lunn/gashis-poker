// What you hold, in words: the starting hand, the made hand with its ranks, and the flush and straight
// draws that use a hole card, with their outs and the odds of hitting by the river.
//
//   describeStart(parseCards("JsJd"))            // "POCKET JACKS"
//   readHand(parseCards("AsKs"), parseCards("Qs7s2d"))
//     // { made: "HIGH CARD, ACE", draws: [{ kind: "flush", label: "FLUSH DRAW", outs: [9 cards], ... }], outs: 9, ... }
//
// Outs are counted against the board only (no opponent cards are known), so they are "cards that make
// the draw", not "cards that win".

import { assertDistinct, FULL_DECK, rankOf, suitOf, type Card } from "./cards";
import { choose } from "./combinatorics";
import { evaluate, handCategoryIndex } from "./evaluator";

const RANK_NAMES = ["TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "JACK", "QUEEN", "KING", "ACE"];
const rankName = (r: number): string => RANK_NAMES[r];
const rankPlural = (r: number): string => (r === 4 ? "SIXES" : `${RANK_NAMES[r]}S`);

// Category indices (see evaluator.ts HAND_CATEGORIES).
const STRAIGHT = 4, FLUSH = 5;

/** The starting hand in words: `POCKET JACKS`, `ACE-KING SUITED`, `SEVEN-TWO OFFSUIT`. */
export function describeStart(hole: readonly Card[]): string {
  if (hole.length !== 2) throw new Error(`A starting hand is 2 cards, got ${hole.length}`);
  assertDistinct(hole);
  const hi = Math.max(rankOf(hole[0]), rankOf(hole[1]));
  const lo = Math.min(rankOf(hole[0]), rankOf(hole[1]));
  if (hi === lo) return `POCKET ${rankPlural(hi)}`;
  return `${rankName(hi)}-${rankName(lo)} ${suitOf(hole[0]) === suitOf(hole[1]) ? "SUITED" : "OFFSUIT"}`;
}

/** Top rank of the best straight in a 13-bit rank mask, or -1. The wheel A-2-3-4-5 has top rank 3 (the five). */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    const run = 0x1f << (top - 4);
    if ((mask & run) === run) return top;
  }
  return (mask & 0x100f) === 0x100f ? 3 : -1;
}

/** The 13-bit mask of the straight topped by `top` (the wheel includes the ace). */
const straightMask = (top: number): number => (top === 3 ? 0x100f : 0x1f << (top - 4));

const highestBit = (mask: number): number => 31 - Math.clz32(mask);

const popcount = (x: number): number => {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
};

/**
 * The best hand in 5-7 cards with its ranks: `HIGH CARD, ACE`, `ONE PAIR, JACKS`, `TWO PAIR, KINGS AND SEVENS`,
 * `THREE OF A KIND, SEVENS`, `STRAIGHT, TEN HIGH`, `FLUSH, ACE HIGH`, `FULL HOUSE, KINGS FULL OF SEVENS`,
 * `FOUR OF A KIND, ACES`, `STRAIGHT FLUSH, NINE HIGH`, `ROYAL FLUSH`. Kickers are not named.
 */
export function nameHand(cards: readonly Card[]): string {
  const category = handCategoryIndex(evaluate(cards));
  const counts = new Array<number>(13).fill(0);
  const suitMasks = [0, 0, 0, 0];
  let ranks = 0;
  for (const c of cards) {
    counts[rankOf(c)]++;
    suitMasks[suitOf(c)] |= 1 << rankOf(c);
    ranks |= 1 << rankOf(c);
  }
  // Ranks holding at least n cards, highest first.
  const withCount = (n: number): number[] => {
    const out: number[] = [];
    for (let r = 12; r >= 0; r--) if (counts[r] >= n) out.push(r);
    return out;
  };
  const flushMask = suitMasks.find((m) => popcount(m) >= 5) ?? 0;

  switch (category) {
    case 8: {
      const top = straightTop(flushMask);
      return top === 12 ? "ROYAL FLUSH" : `STRAIGHT FLUSH, ${rankName(top)} HIGH`;
    }
    case 7:
      return `FOUR OF A KIND, ${rankPlural(withCount(4)[0])}`;
    case 6: {
      const trips = withCount(3)[0];
      const pair = withCount(2).find((r) => r !== trips)!;
      return `FULL HOUSE, ${rankPlural(trips)} FULL OF ${rankPlural(pair)}`;
    }
    case 5:
      return `FLUSH, ${rankName(highestBit(flushMask))} HIGH`;
    case 4:
      return `STRAIGHT, ${rankName(straightTop(ranks))} HIGH`;
    case 3:
      return `THREE OF A KIND, ${rankPlural(withCount(3)[0])}`;
    case 2: {
      const [a, b] = withCount(2);
      return `TWO PAIR, ${rankPlural(a)} AND ${rankPlural(b)}`;
    }
    case 1:
      return `ONE PAIR, ${rankPlural(withCount(2)[0])}`;
    default:
      return `HIGH CARD, ${rankName(highestBit(ranks))}`;
  }
}

/**
 * Chance (in percent, 0-100) of hitting one of `outs` by the river, counting only your own cards and the
 * board as seen: on the flop (2 cards to come) `1 - C(unseen - outs, 2) / C(unseen, 2)`, on the turn
 * `outs / unseen`, with unseen = 52 - 2 - board.
 */
export function oddsByRiver(outs: number, boardLength: 3 | 4): number {
  const unseen = 50 - boardLength;
  if (boardLength === 3) return (1 - choose(unseen - outs, 2) / choose(unseen, 2)) * 100;
  return (outs / unseen) * 100;
}

/**
 * - `flush`: four to a flush including a hole card (9 outs).
 * - `open-ended`: four in a row open at both ends, e.g. 5-6-7-8 (8 outs). 2-3-4-5 counts (the ace makes the wheel).
 * - `double-gutshot`: two different inside cards each make a straight, e.g. 5-7-8-9-J (8 outs).
 * - `gutshot`: one rank makes a straight (4 outs). Includes the one-ended A-2-3-4 and J-Q-K-A.
 */
export type DrawKind = "flush" | "open-ended" | "double-gutshot" | "gutshot";

const DRAW_LABEL: Record<DrawKind, string> = {
  flush: "FLUSH DRAW",
  "open-ended": "OPEN-ENDED",
  "double-gutshot": "DOUBLE GUTSHOT",
  gutshot: "GUTSHOT",
};

export interface Draw {
  kind: DrawKind;
  /** `FLUSH DRAW`, `OPEN-ENDED`, `DOUBLE GUTSHOT`, `GUTSHOT`. */
  label: string;
  /** Unseen cards that complete this draw, ascending by card id. */
  outs: Card[];
  /** This draw alone, percent by the river (see `oddsByRiver`). */
  pctByRiver: number;
}

export interface HandRead {
  /** Preflop: the starting hand (`describeStart`). Later: the made hand (`nameHand`); its first part before the comma is the short name. */
  made: string;
  /** Flush draw first, then the straight draw. Empty preflop and on the river. */
  draws: Draw[];
  /** Distinct out cards over all draws (a card counted by two draws counts once). */
  outs: number;
  /** All draws together, percent by the river; null preflop, on the river, and when there are no outs. */
  pctByRiver: number | null;
}

/**
 * Reads your hand on a board of 0 (preflop), 3, 4 or 5 cards. Draws are listed only when they use at least
 * one hole card (a draw on the board alone is everyone's) and only to a category stronger than the one you
 * hold: no flush draw once you have a flush or better, no straight draw once you have a straight or better.
 */
export function readHand(hole: readonly Card[], board: readonly Card[]): HandRead {
  if (hole.length !== 2) throw new Error(`Hole cards are 2 cards, got ${hole.length}`);
  if (![0, 3, 4, 5].includes(board.length)) throw new Error(`Board must be 0, 3, 4 or 5 cards, got ${board.length}`);
  const all = [...hole, ...board];
  assertDistinct(all);
  if (board.length === 0) return { made: describeStart(hole), draws: [], outs: 0, pctByRiver: null };
  const made = nameHand(all);
  if (board.length === 5) return { made, draws: [], outs: 0, pctByRiver: null };

  const boardLength = board.length as 3 | 4;
  const category = handCategoryIndex(evaluate(all));
  const used = new Uint8Array(52);
  for (const c of all) used[c] = 1;
  const unseen = FULL_DECK.filter((c) => !used[c]);
  const draws: Draw[] = [];
  // On the turn an out must not just complete the board's own hand (e.g. a straight card that puts a fifth
  // diamond on the board: everyone plays the board flush). A draw left with no outs is not listed.
  const plays = (x: Card): boolean => boardLength === 3 || evaluate([...all, x]) !== evaluate([...board, x]);
  const addDraw = (kind: DrawKind, candidates: Card[]): void => {
    const outs = candidates.filter(plays);
    if (outs.length > 0) draws.push({ kind, label: DRAW_LABEL[kind], outs, pctByRiver: oddsByRiver(outs.length, boardLength) });
  };

  // Flush draw: exactly four of a suit, at least one of them a hole card. Every unseen card of that suit makes the flush.
  if (category < FLUSH) {
    for (let s = 0; s < 4; s++) {
      const inHole = hole.filter((c) => suitOf(c) === s).length;
      const total = all.filter((c) => suitOf(c) === s).length;
      if (inHole > 0 && total === 4) addDraw("flush", unseen.filter((c) => suitOf(c) === s));
    }
  }

  // Straight draw: ranks not yet held whose card makes a straight. The straight that card makes (the best one
  // you would play) must need a hole card, i.e. not lie entirely within the board plus that card.
  if (category < STRAIGHT) {
    let ranks = 0, boardRanks = 0;
    for (const c of all) ranks |= 1 << rankOf(c);
    for (const c of board) boardRanks |= 1 << rankOf(c);
    const outRanks: number[] = [];
    for (let r = 0; r < 13; r++) {
      const bit = 1 << r;
      if (ranks & bit) continue;
      const top = straightTop(ranks | bit);
      if (top < 0) continue;
      const need = straightMask(top);
      if ((need & (boardRanks | bit)) === need) continue; // board-only straight
      outRanks.push(r);
    }
    if (outRanks.length > 0) {
      const kind: DrawKind = outRanks.length === 1 ? "gutshot" : isOpenEnded(ranks, outRanks) ? "open-ended" : "double-gutshot";
      addDraw(kind, unseen.filter((c) => outRanks.includes(rankOf(c))));
    }
  }

  const outs = new Set(draws.flatMap((d) => d.outs)).size;
  return { made, draws, outs, pctByRiver: outs > 0 ? oddsByRiver(outs, boardLength) : null };
}

// Positions 0..13 along the straight line: 0 is the low ace, k (1..13) is rank k - 1, so 13 is the high ace.
const rankAt = (pos: number): number => (pos === 0 ? 12 : pos - 1);

/** Four held ranks in a row with both neighbours among the out ranks (A-2-3-4 and J-Q-K-A have only one neighbour). */
function isOpenEnded(ranks: number, outRanks: readonly number[]): boolean {
  for (let p = 1; p + 4 <= 13; p++) {
    let run = true;
    for (let k = p; k < p + 4 && run; k++) run = (ranks & (1 << rankAt(k))) !== 0;
    if (run && outRanks.includes(rankAt(p - 1)) && outRanks.includes(rankAt(p + 4))) return true;
  }
  return false;
}
