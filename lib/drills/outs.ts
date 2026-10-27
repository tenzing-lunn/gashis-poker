// countOuts: both hands face up, hero behind; count next cards that put hero strictly ahead ("outs"),
// or that improve hero's hand category without putting hero strictly ahead ("dirty").

import type { Card, Rng } from "../poker/cards";
import { evaluate, handCategory, handCategoryIndex } from "../poker/evaluator";
import type { Difficulty, Question } from "./types";
import { cardText, deal, hole, pick, retry, showCards } from "./util";

export interface CountOutsParams {
  difficulty: Difficulty;
  variant: "outs" | "dirty";
  street: "flop" | "turn";
  hero: string;
  villain: string;
  board: string;
  /** 52 − 4 hole cards − board cards. */
  unseen: number;
}

/** The unseen next cards that count for `variant`, with hero currently behind. */
export function countOutCards(hero: Card[], villain: Card[], board: Card[], variant: "outs" | "dirty"): Card[] {
  const heroCat = handCategoryIndex(evaluate([...hero, ...board]));
  const used = new Set([...hero, ...villain, ...board]);
  const out: Card[] = [];
  for (let c = 0; c < 52; c++) {
    if (used.has(c)) continue;
    const h = evaluate([...hero, ...board, c]);
    const ahead = h > evaluate([...villain, ...board, c]);
    if (variant === "outs" ? ahead : !ahead && handCategoryIndex(h) > heroCat) out.push(c);
  }
  return out;
}

export function genCountOuts(rng: Rng, difficulty: Difficulty): Omit<Question<CountOutsParams>, "type" | "id"> {
  const variant = difficulty === 1 ? "outs" : pick(rng, ["outs", "dirty"] as const);
  const street = difficulty < 3 ? "flop" : pick(rng, ["flop", "turn"] as const);
  const boardSize = street === "flop" ? 3 : 4;

  const { hero, villain, board, cards } = retry(() => {
    const dealt = deal(rng, 4 + boardSize);
    const hero = hole(dealt.slice(0, 2)), villain = hole(dealt.slice(2, 4)), board = dealt.slice(4);
    if (evaluate([...hero, ...board]) >= evaluate([...villain, ...board])) return null; // hero must be behind
    const cards = countOutCards(hero, villain, board, variant);
    return cards.length >= 1 && cards.length <= 20 ? { hero, villain, board, cards } : null;
  });

  const unseen = 52 - 4 - boardSize;
  const next = street === "flop" ? "turn" : "river";
  const heroNow = handCategory(evaluate([...hero, ...board]));
  const villainNow = handCategory(evaluate([...villain, ...board]));
  const spot =
    `Hero has ${showCards(hero)}. Villain has ${showCards(villain)} (both hands face up). ` +
    `${street === "flop" ? "Flop" : "Turn"}: ${showCards(board)}. Hero is behind (${heroNow} vs ${villainNow}). `;
  const question =
    variant === "outs"
      ? `Of the ${unseen} unseen cards, how many would put hero strictly ahead of villain (better best-5-card hand) ` +
        `if dealt as the ${next}? Ties don't count.`
      : `Of the ${unseen} unseen cards, how many are dirty outs: cards that, dealt as the ${next}, raise hero's hand ` +
        `category (e.g. pair → two pair) but still leave hero NOT strictly ahead of villain (behind or tied)?`;

  return {
    prompt: spot + question,
    params: {
      difficulty,
      variant,
      street,
      hero: cardText(hero),
      villain: cardText(villain),
      board: cardText(board),
      unseen,
    },
    answer: cards.length,
    unit: "outs",
    tolerance: 0,
    explanation:
      `${variant === "outs" ? "Cards that put hero ahead" : "Cards that improve hero but don't put hero ahead"} ` +
      `(${cards.length}): ${showCards(cards)}`,
  };
}
