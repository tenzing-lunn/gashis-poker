// Outs arithmetic for module 2. Fractions in [0, 1].

import { formatCard, parseCards, type Card } from "../../../lib/poker/cards";
import { evaluate } from "../../../lib/poker/evaluator";

/** Chance that one card from `unseen` cards is one of `outs`. */
export const oneCard = (outs: number, unseen: number): number => outs / unseen;

/** Chance that at least one of the next two cards is an out: 1 - (U-o)/U * (U-1-o)/(U-1). */
export const twoCards = (outs: number, unseen: number): number =>
  1 - ((unseen - outs) / unseen) * ((unseen - 1 - outs) / (unseen - 1));

/** Odds against, as "x to 1": misses per hit. */
export const oddsAgainst = (p: number): number => (1 - p) / p;

/** Next-card outs for the hero against one known hand: cards that put the hero strictly ahead. */
export function nextCardOuts(hero: string, villain: string, board: string) {
  const H = parseCards(hero), V = parseCards(villain), B = parseCards(board);
  const used = new Set<Card>([...H, ...V, ...B]);
  const ahead: string[] = [];
  const tie: string[] = [];
  for (let c = 0; c < 52; c++) {
    if (used.has(c)) continue;
    const h = evaluate([...H, ...B, c]), v = evaluate([...V, ...B, c]);
    if (h > v) ahead.push(formatCard(c));
    else if (h === v) tie.push(formatCard(c));
  }
  const now = Math.sign(evaluate([...H, ...B]) - evaluate([...V, ...B]));
  return { ahead, tie, unseen: 52 - used.size, now };
}
