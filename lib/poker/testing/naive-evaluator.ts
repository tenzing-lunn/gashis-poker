// Deliberately simple, slow evaluator used only as an independent oracle in tests.
// It shares no code with evaluator.ts: sort by (count, rank), check flush/straight directly.

import type { Card } from "../cards";

/** Comparable score of exactly 5 cards (higher = stronger). */
export function naiveScore5(cards: readonly Card[]): number {
  const ranks = cards.map((c) => c >> 2).sort((a, b) => b - a);
  const flush = cards.every((c) => (c & 3) === (cards[0] & 3));
  const unique = [...new Set(ranks)];
  let straightTop = -1;
  if (unique.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightTop = ranks[0];
    else if (ranks.join() === "12,3,2,1,0") straightTop = 3; // wheel: five-high
  }
  const groups = unique
    .map((r) => ({ r, n: ranks.filter((x) => x === r).length }))
    .sort((a, b) => b.n - a.n || b.r - a.r);
  const shape = groups.map((g) => g.n).join("");

  let cat: number;
  if (straightTop >= 0 && flush) cat = 8;
  else if (shape === "41") cat = 7;
  else if (shape === "32") cat = 6;
  else if (flush) cat = 5;
  else if (straightTop >= 0) cat = 4;
  else if (shape === "311") cat = 3;
  else if (shape === "221") cat = 2;
  else if (shape === "2111") cat = 1;
  else cat = 0;

  const tiebreak = straightTop >= 0 ? [straightTop] : groups.map((g) => g.r);
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 16 + (tiebreak[i] ?? 0);
  return score;
}

/** Best 5-card score among all 5-card subsets of 5-7 cards. */
export function naiveBest(cards: readonly Card[]): number {
  let best = -1;
  const n = cards.length;
  const pick: Card[] = [];
  const rec = (start: number): void => {
    if (pick.length === 5) {
      best = Math.max(best, naiveScore5(pick));
      return;
    }
    for (let i = start; i <= n - (5 - pick.length); i++) {
      pick.push(cards[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return best;
}

/** Exact equity by brute force with the naive evaluator (slow; use on flop/turn/river only). */
export function naiveExactEquity(hands: Card[][], board: Card[], dead: Card[] = []): number[] {
  const used = new Set([...hands.flat(), ...board, ...dead]);
  const deck = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  const equity = new Array<number>(hands.length).fill(0);
  let total = 0;
  const runout: Card[] = [];
  const rec = (start: number): void => {
    if (board.length + runout.length === 5) {
      const scores = hands.map((h) => naiveBest([...h, ...board, ...runout]));
      const best = Math.max(...scores);
      const winners = scores.filter((s) => s === best).length;
      scores.forEach((s, p) => {
        if (s === best) equity[p] += 1 / winners;
      });
      total++;
      return;
    }
    for (let i = start; i < deck.length; i++) {
      runout.push(deck[i]);
      rec(i + 1);
      runout.pop();
    }
  };
  rec(0);
  return equity.map((e) => e / total);
}
