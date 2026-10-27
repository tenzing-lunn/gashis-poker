// equityEstimate: hero's exact all-in equity vs one hand (preflop or flop) or vs a range (flop or turn),
// graded within ±5 percentage points. Everything is full enumeration; no Monte Carlo.

import type { Card, Rng } from "../poker/cards";
import { comboCards } from "../poker/combinatorics";
import { exactEquity } from "../poker/equity";
import { removeDeadCards } from "../poker/range";
import type { Difficulty, Question } from "./types";
import { cardText, deal, hole, intIn, pick, randomRange, retry, round, showCards } from "./util";

export interface HandEquityParams {
  difficulty: Difficulty;
  variant: "hand";
  street: "preflop" | "flop";
  hero: string;
  villain: string;
  /** "" preflop. */
  board: string;
}

export interface RangeEquityParams {
  difficulty: Difficulty;
  variant: "range";
  street: "flop" | "turn";
  hero: string;
  range: string;
  board: string;
  /** Villain combos compatible with hero's hand and the board (each equally likely). */
  combos: number;
}

export type EquityEstimateParams = HandEquityParams | RangeEquityParams;

/** Raw combos allowed in a villain range: keeps generation well under ~300 ms. */
const MAX_RANGE_COMBOS = 100;

/** Hero's exact equity (%) vs a range: the plain mean over compatible villain combos. */
export function rangeEquity(hero: Card[], range: readonly number[], board: Card[]): { equity: number; per: number[] } {
  const live = removeDeadCards(range, [...hero, ...board]);
  const per = live.map((c) => 100 * exactEquity([hero, comboCards(c)], board).players[0].equity);
  return { equity: per.reduce((a, b) => a + b, 0) / per.length, per };
}

const streetLabel = (street: string, board: Card[]): string =>
  street === "preflop"
    ? "preflop (all five board cards to come)"
    : street === "flop"
      ? `on the flop ${showCards(board)} (turn and river to come)`
      : `on the turn ${showCards(board)} (river to come)`;

type Generated = Omit<Question<EquityEstimateParams>, "type" | "id">;

export function genEquityEstimate(rng: Rng, difficulty: Difficulty): Generated {
  const variant = difficulty === 1 ? "hand" : difficulty === 2 ? pick(rng, ["hand", "range"] as const) : pick(rng, ["hand", "range", "range"] as const);
  return variant === "hand" ? handSpot(rng, difficulty) : rangeSpot(rng, difficulty);
}

function handSpot(rng: Rng, difficulty: Difficulty): Generated {
  const street = difficulty === 2 ? "flop" : pick(rng, ["preflop", "flop"] as const);
  const dealt = deal(rng, street === "preflop" ? 4 : 7);
  const hero = hole(dealt.slice(0, 2)), villain = hole(dealt.slice(2, 4)), board = dealt.slice(4);
  const result = exactEquity([hero, villain], board);
  const { win, tie, equity } = result.players[0];
  const answer = 100 * equity;
  return {
    prompt:
      `Hero ${showCards(hero)} vs villain ${showCards(villain)}, all-in ${streetLabel(street, board)}. ` +
      `What is hero's equity, in % (wins plus half of ties)? Graded within ±5.`,
    params: { difficulty, variant: "hand", street, hero: cardText(hero), villain: cardText(villain), board: cardText(board) },
    answer,
    unit: "%",
    tolerance: 5,
    explanation:
      `Exact over ${result.samples.toLocaleString("en-US")} runouts: win ${round(100 * win)}% + ` +
      `tie ${round(100 * tie)}%/2 = ${round(answer)}%`,
  };
}

function rangeSpot(rng: Rng, difficulty: Difficulty): Generated {
  const street = difficulty === 2 ? "flop" : pick(rng, ["flop", "turn"] as const);
  const { hero, board, range, live, result } = retry(() => {
    const { tokens, combos } = randomRange(rng, intIn(rng, 1, 3), ["single", "plus", "run"], MAX_RANGE_COMBOS);
    const dealt = deal(rng, street === "flop" ? 5 : 6);
    const hero = hole(dealt.slice(0, 2)), board = dealt.slice(2);
    const live = removeDeadCards(combos, dealt);
    if (live.length === 0) return null;
    return { hero, board, range: tokens.join(", "), live, result: rangeEquity(hero, live, board) };
  });
  const answer = result.equity;
  const lo = Math.min(...result.per), hi = Math.max(...result.per);
  return {
    prompt:
      `Hero ${showCards(hero)} is all-in ${streetLabel(street, board)} vs villain's range ${range}. ` +
      `Every villain combo that doesn't use hero's or the board's cards is equally likely (${live.length} combos). ` +
      `What is hero's equity, in % (wins plus half of ties)? Graded within ±5.`,
    params: {
      difficulty,
      variant: "range",
      street,
      hero: cardText(hero),
      range,
      board: cardText(board),
      combos: live.length,
    },
    answer,
    unit: "%",
    tolerance: 5,
    explanation:
      `Mean of exact equity vs each of ${live.length} villain combos = ${round(answer)}% ` +
      `(ranging ${round(lo)}%–${round(hi)}%)`,
  };
}
