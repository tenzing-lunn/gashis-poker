// countOuts: both hands face up, you behind; count next cards that put you strictly ahead ("outs"),
// or that improve your hand category without putting you strictly ahead ("dirty").
// Facts (4): You, Them, Board (3 or 4 cards), Now.

import type { Card, Rng } from "../poker/cards";
import { HAND_CATEGORIES, evaluate, handCategory, handCategoryIndex } from "../poker/evaluator";
import type { Difficulty, Fact, Question } from "./types";
import { capitalize, cardText, deal, hole, mistakesOf, pick, promptOf, retry, showCards } from "./util";

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

/** What one unseen next card does for you. */
export interface NextCard {
  card: Card;
  /** Your category index after it. */
  category: number;
  ahead: boolean;
  tie: boolean;
  /** Raises your hand category. */
  improves: boolean;
}

export function nextCards(hero: Card[], villain: Card[], board: Card[]): NextCard[] {
  const heroCat = handCategoryIndex(evaluate([...hero, ...board]));
  const used = new Set([...hero, ...villain, ...board]);
  const out: NextCard[] = [];
  for (let c = 0; c < 52; c++) {
    if (used.has(c)) continue;
    const h = evaluate([...hero, ...board, c]), v = evaluate([...villain, ...board, c]);
    const category = handCategoryIndex(h);
    out.push({ card: c, category, ahead: h > v, tie: h === v, improves: category > heroCat });
  }
  return out;
}

const isDirty = (n: NextCard): boolean => !n.ahead && n.improves;

/** The unseen next cards that count for `variant`, with you currently behind. */
export function countOutCards(hero: Card[], villain: Card[], board: Card[], variant: "outs" | "dirty"): Card[] {
  return nextCards(hero, villain, board)
    .filter(variant === "outs" ? (n) => n.ahead : isDirty)
    .map((n) => n.card);
}

/** "Straight: 6♣ 6♦ · Pair: 8♣ 8♦": grouped by your resulting hand, strongest first. */
function grouped(cards: NextCard[]): string {
  const cats = [...new Set(cards.map((n) => n.category))].sort((a, b) => b - a);
  return cats
    .map((cat) => `${capitalize(HAND_CATEGORIES[cat])}: ${showCards(cards.filter((n) => n.category === cat).map((n) => n.card))}`)
    .join(" · ");
}

export function genCountOuts(rng: Rng, difficulty: Difficulty): Omit<Question<CountOutsParams>, "type" | "id"> {
  const variant = difficulty === 1 ? "outs" : pick(rng, ["outs", "dirty"] as const);
  const street = difficulty < 3 ? "flop" : pick(rng, ["flop", "turn"] as const);
  const boardSize = street === "flop" ? 3 : 4;

  const { hero, villain, board, next, cards } = retry(() => {
    const dealt = deal(rng, 4 + boardSize);
    const hero = hole(dealt.slice(0, 2)), villain = hole(dealt.slice(2, 4)), board = dealt.slice(4);
    if (evaluate([...hero, ...board]) >= evaluate([...villain, ...board])) return null; // you must be behind
    const next = nextCards(hero, villain, board);
    const cards = next.filter(variant === "outs" ? (n) => n.ahead : isDirty);
    return cards.length >= 1 && cards.length <= 20 ? { hero, villain, board, next, cards } : null;
  });

  const unseen = 52 - 4 - boardSize;
  const turn = street === "flop" ? "turn" : "river";
  const heroNow = handCategory(evaluate([...hero, ...board]));
  const villainNow = handCategory(evaluate([...villain, ...board]));
  const facts: Fact[] = [
    { label: "You", value: showCards(hero) },
    { label: "Them", value: showCards(villain) },
    { label: "Board", value: showCards(board) },
    { label: "Now", value: `Behind: ${heroNow} vs ${villainNow}` },
  ];
  const ask =
    variant === "outs"
      ? `How many of the ${unseen} unseen cards would put you strictly ahead on the ${turn}? Ties don't count.`
      : `Dirty outs: how many of the ${unseen} unseen cards would improve your hand on the ${turn} ` +
        `(say pair to two pair) but still leave you behind or tied?`;

  const outs = next.filter((n) => n.ahead), dirty = next.filter(isDirty), ties = next.filter((n) => n.tie);
  const improving = next.filter((n) => n.improves);
  const answer = cards.length;
  const dirtyCards = showCards(dirty.map((n) => n.card)), tieCards = showCards(ties.map((n) => n.card));
  const candidates: [number, string][] =
    variant === "outs"
      ? dirty.length === ties.length
        ? // Same count either way: name both slips rather than guess which one was made.
          [[answer + dirty.length, `You also counted the ${dirty.length} dirty outs, cards that improve your hand but leave you behind or tied (${dirtyCards}), or the ${ties.length} cards that only tie (${tieCards}). Only the ${answer} cards that put you ahead count.`]]
        : [
            [answer + dirty.length, `You also counted ${dirty.length} dirty outs, cards that improve your hand but leave you behind or tied (${dirtyCards}). Only the ${answer} cards that put you ahead count.`],
            [answer + ties.length, `You also counted ${ties.length} cards that only tie (${tieCards}). Ties don't count as outs.`],
          ]
      : [
          [outs.length, `That's the clean outs, cards that put you ahead. Dirty outs improve your hand but leave you behind or tied: ${answer}.`],
          [improving.length, `You counted every card that improves your hand (${improving.length}), including the ${improving.length - answer} that put you ahead. Dirty outs leave you behind or tied: ${answer}.`],
        ];

  return {
    prompt: promptOf(facts, ask),
    facts,
    ask,
    params: {
      difficulty,
      variant,
      street,
      hero: cardText(hero),
      villain: cardText(villain),
      board: cardText(board),
      unseen,
    },
    answer,
    unit: "outs",
    tolerance: 0,
    explanation:
      `${variant === "outs" ? "Cards that put you ahead" : "Cards that improve your hand but don't put you ahead"} ` +
      `(${answer}): ${grouped(cards)}`,
    mistakes: mistakesOf(answer, 0, candidates.filter(([v]) => v > 0)),
  };
}
