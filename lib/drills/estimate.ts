// equityEstimate: your exact all-in equity vs one hand (preflop or flop) or vs a range (flop or turn),
// graded within ±5 percentage points. Everything is full enumeration; no Monte Carlo.
// Facts (3): You, Them (a hand, or a range with its live combo count), Board ("None yet (preflop)" preflop).

import { rankOf, type Card, type Rng } from "../poker/cards";
import { comboCards } from "../poker/combinatorics";
import { exactEquity } from "../poker/equity";
import { evaluate } from "../poker/evaluator";
import { removeDeadCards } from "../poker/range";
import type { Difficulty, Fact, Question } from "./types";
import { cardText, deal, hole, intIn, mistakesOf, pct, pick, promptOf, randomRange, retry, showCards } from "./util";

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
  /** Villain combos compatible with your hand and the board (each equally likely). */
  combos: number;
}

export type EquityEstimateParams = HandEquityParams | RangeEquityParams;

/** Raw combos allowed in a villain range: keeps generation well under ~300 ms. */
const MAX_RANGE_COMBOS = 100;

/** Your exact equity (%) vs a range: the plain mean over compatible combos; `win` is the mean win %. */
export function rangeEquity(
  hero: Card[],
  range: readonly number[],
  board: Card[],
): { equity: number; win: number; per: number[] } {
  const live = removeDeadCards(range, [...hero, ...board]);
  const results = live.map((c) => exactEquity([hero, comboCards(c)], board).players[0]);
  const mean = (xs: number[]) => (100 * xs.reduce((a, b) => a + b, 0)) / xs.length;
  return {
    equity: mean(results.map((r) => r.equity)),
    win: mean(results.map((r) => r.win)),
    per: results.map((r) => 100 * r.equity),
  };
}

const allIn = (street: string): string =>
  street === "preflop"
    ? "All in before the flop, all five cards to come."
    : street === "flop"
      ? "All in on the flop, turn and river to come."
      : "All in on the turn, river to come.";

const ASK_EQUITY = "What's your equity, in % (wins plus half of ties)?";

type Generated = Omit<Question<EquityEstimateParams>, "type" | "id">;

export function genEquityEstimate(rng: Rng, difficulty: Difficulty): Generated {
  const variant = difficulty === 1 ? "hand" : difficulty === 2 ? pick(rng, ["hand", "range"] as const) : pick(rng, ["hand", "range", "range"] as const);
  return variant === "hand" ? handSpot(rng, difficulty) : rangeSpot(rng, difficulty);
}

/** Their equity and wins-only: the two common wrong answers. */
const equityMistakes = (answer: number, win: number, tie: number) =>
  mistakesOf(answer, 5, [
    [100 - answer, `You gave their equity (${pct(100 - answer)}). Yours is 100% − ${pct(100 - answer)} = ${pct(answer)}.`],
    [win, `You counted only wins (${pct(win)}). Split pots count half: ${pct(win)} + ${pct(tie)} / 2 = ${pct(answer)}.`],
  ]);

function handSpot(rng: Rng, difficulty: Difficulty): Generated {
  const street = difficulty === 2 ? "flop" : pick(rng, ["preflop", "flop"] as const);
  const dealt = deal(rng, street === "preflop" ? 4 : 7);
  const hero = hole(dealt.slice(0, 2)), villain = hole(dealt.slice(2, 4)), board = dealt.slice(4);
  const result = exactEquity([hero, villain], board);
  const { win, tie, equity } = result.players[0];
  const answer = 100 * equity;
  const facts: Fact[] = [
    { label: "You", value: showCards(hero) },
    { label: "Them", value: showCards(villain) },
    { label: "Board", value: street === "preflop" ? "None yet (preflop)" : showCards(board) },
  ];
  const ask = `${allIn(street)} ${ASK_EQUITY}`;
  return {
    prompt: promptOf(facts, ask),
    facts,
    ask,
    estimate: street === "preflop" ? preflopEstimate(hero, villain, answer) : flopEstimate(hero, villain, board, answer),
    params: { difficulty, variant: "hand", street, hero: cardText(hero), villain: cardText(villain), board: cardText(board) },
    answer,
    unit: "%",
    tolerance: 5,
    explanation:
      `Exact over ${result.samples.toLocaleString("en-US")} runouts: win ${pct(100 * win)} + ` +
      `tie ${pct(100 * tie)} / 2 = ${pct(answer)}`,
    mistakes: equityMistakes(answer, 100 * win, 100 * tie),
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
  const n = live.length;
  const facts: Fact[] = [
    { label: "You", value: showCards(hero) },
    { label: "Them", value: `${range} (${n} combo${n === 1 ? "" : "s"})` },
    { label: "Board", value: showCards(board) },
  ];
  const ask = `${allIn(street)} Each of their ${n} possible hands is equally likely. ${ASK_EQUITY}`;
  return {
    prompt: promptOf(facts, ask),
    facts,
    ask,
    estimate: rangeEstimate(hero, live, board, answer),
    params: { difficulty, variant: "range", street, hero: cardText(hero), range, board: cardText(board), combos: n },
    answer,
    unit: "%",
    tolerance: 5,
    explanation: `Mean of your exact equity against each of their ${n} combos = ${pct(answer)} (from ${pct(lo)} to ${pct(hi)})`,
    // Mean tie % = 2 × (mean equity − mean win).
    mistakes: equityMistakes(answer, result.win, 2 * (answer - result.win)),
  };
}

// ---------------------------------------------------------------------------
// How to estimate it at the table

const exact = (x: number): string => `Exact: ${x.toFixed(1)}%.`;

/** Flop, one known hand: next-card outs for whoever is behind, then the rule of 4. */
export function flopEstimate(hero: Card[], villain: Card[], board: Card[], answer: number): string {
  const used = new Set([...hero, ...villain, ...board]);
  let mine = 0, theirs = 0;
  for (let c = 0; c < 52; c++) {
    if (used.has(c)) continue;
    const h = evaluate([...hero, ...board, c]), v = evaluate([...villain, ...board, c]);
    if (h > v) mine++;
    else if (v > h) theirs++;
  }
  const now = Math.sign(evaluate([...hero, ...board]) - evaluate([...villain, ...board]));
  let guess: number, text: string;
  if (now < 0) {
    guess = 4 * mine;
    text = `You're behind with ${mine} out${mine === 1 ? "" : "s"}: ${mine} × 4 ≈ ${guess}%.`;
  } else if (now > 0) {
    guess = 100 - 4 * theirs;
    text = `You're ahead; they have ${theirs} out${theirs === 1 ? "" : "s"}: 100 − ${theirs} × 4 ≈ ${guess}%.`;
  } else {
    guess = 50 + 2 * (mine - theirs);
    text = `You're tied now. ${mine} cards put you ahead, ${theirs} put them ahead: 50 + 2 × (${mine} − ${theirs}) ≈ ${guess}%.`;
  }
  const off = Math.abs(guess - answer);
  const rough =
    off > 5
      ? ` The shortcut is off by ${Math.round(off)} points here: it ignores two-card draws, redraws and split pots.`
      : "";
  return `${text} ${exact(answer)}${rough}`;
}

/** A preflop matchup class, named from the favourite's side, with the usual equity band for that side. */
interface MatchupClass {
  name: string;
  /** Name from the underdog's side. */
  under: string;
  lo: number;
  hi: number;
}

// Bands: the 10th–90th percentile of exact equity over two seeded samples of 80–120 random matchups per
// class (full enumeration), rounded outward. The text says "usually" and flags spots outside the band.
const CLASSES = {
  samePair: { name: "Same pair", under: "Same pair", lo: 50, hi: 50 },
  sameRanks: { name: "Same two ranks", under: "Same two ranks", lo: 47, hi: 53 },
  pairVsPair: { name: "Bigger pair vs smaller pair", under: "Smaller pair vs bigger pair", lo: 80, hi: 83 },
  pairVs2Over: { name: "Pair vs two overcards", under: "Two overcards vs a pair", lo: 49, hi: 56 },
  pairVs1Over: { name: "Pair vs one overcard", under: "One overcard vs a pair", lo: 67, hi: 73 },
  pairVs2Under: { name: "Pair vs two undercards", under: "Two undercards vs a pair", lo: 80, hi: 88 },
  pairVsSharedLow: {
    name: "Pair vs a hand holding one of its cards and a smaller card (like AA vs AK)",
    under: "One card of their pair plus a smaller card (like AK vs AA)",
    lo: 86,
    hi: 94,
  },
  pairVsSharedHigh: {
    name: "Pair vs a hand holding one of its cards and an overcard (like 88 vs A8)",
    under: "One card of their pair plus an overcard (like A8 vs 88)",
    lo: 62,
    hi: 70,
  },
  dominates: {
    name: "Same card, better kicker (like AK vs AQ)",
    under: "Same card, worse kicker (like AQ vs AK)",
    lo: 68,
    hi: 76,
  },
  dominates89: {
    name: "Same card, better kicker of 8 or 9 (like K9 vs K4)",
    under: "Same card, worse kicker (like K4 vs K9)",
    lo: 64,
    hi: 72,
  },
  dominatesSmall: {
    name: "Same card, better kicker of 7 or less (like 76 vs 74)",
    under: "Same card, worse kicker (like 74 vs 76)",
    lo: 53,
    hi: 66,
  },
  twoOverTwo: { name: "Two higher cards vs two lower (like AK vs QJ)", under: "Two lower cards vs two higher (like QJ vs AK)", lo: 61, hi: 70 },
  interleaved: {
    name: "Highest and third card vs second and fourth (like AQ vs KJ)",
    under: "Second and fourth card vs highest and third (like KJ vs AQ)",
    lo: 59,
    hi: 67,
  },
  outside: {
    name: "Highest and lowest card vs the two in between (like A2 vs KQ)",
    under: "Two middle cards vs highest and lowest (like KQ vs A2)",
    lo: 53,
    hi: 61,
  },
} satisfies Record<string, MatchupClass>;

/** The class of a heads-up preflop matchup, and whether `a` is the side the class is named from. */
export function matchupClass(a: Card[], b: Card[]): { cls: MatchupClass; favourite: boolean } {
  const [a1, a2] = a.map(rankOf).sort((x, y) => y - x);
  const [b1, b2] = b.map(rankOf).sort((x, y) => y - x);
  const flip = (r: { cls: MatchupClass; favourite: boolean }) => ({ cls: r.cls, favourite: !r.favourite });
  const ap = a1 === a2, bp = b1 === b2;
  if (ap && bp) return a1 === b1 ? { cls: CLASSES.samePair, favourite: true } : { cls: CLASSES.pairVsPair, favourite: a1 > b1 };
  if (bp) return flip(matchupClass(b, a));
  if (ap) {
    if (b1 === a1 || b2 === a1) {
      const other = b1 === a1 ? b2 : b1;
      return { cls: other < a1 ? CLASSES.pairVsSharedLow : CLASSES.pairVsSharedHigh, favourite: true };
    }
    const over = Number(b1 > a1) + Number(b2 > a1);
    return { cls: [CLASSES.pairVs2Under, CLASSES.pairVs1Over, CLASSES.pairVs2Over][over], favourite: true };
  }
  if (a1 === b1 && a2 === b2) return { cls: CLASSES.sameRanks, favourite: true };
  const shared = [a1, a2].find((r) => r === b1 || r === b2);
  if (shared !== undefined) {
    const ak = a1 === shared ? a2 : a1, bk = b1 === shared ? b2 : b1;
    const kicker = Math.max(ak, bk);
    const cls = kicker >= 8 ? CLASSES.dominates : kicker >= 6 ? CLASSES.dominates89 : CLASSES.dominatesSmall;
    return { cls, favourite: ak > bk };
  }
  // No shared rank: the order of the four ranks, top down, says who holds which.
  if (b1 > a1) return flip(matchupClass(b, a));
  const order = b1 > a2 ? (b2 > a2 ? "outside" : "interleaved") : "twoOverTwo";
  return { cls: CLASSES[order], favourite: true };
}

export function preflopEstimate(hero: Card[], villain: Card[], answer: number): string {
  const { cls, favourite } = matchupClass(hero, villain);
  const name = favourite ? cls.name : cls.under;
  const lo = favourite ? cls.lo : 100 - cls.hi, hi = favourite ? cls.hi : 100 - cls.lo;
  const band = lo === hi ? `${lo}%` : `${lo}–${hi}%`;
  const inBand = answer >= lo - 0.05 && answer <= hi + 0.05;
  return (
    `${name}: usually about ${band} for you. ${exact(answer)}` +
    (inBand ? "" : " This one is outside the usual band: suits and straight chances move it.")
  );
}

/** Range spots: how many of their combos you're ahead of right now, then the exact mean. */
export function rangeEstimate(hero: Card[], live: readonly number[], board: Card[], answer: number): string {
  const mine = evaluate([...hero, ...board]);
  let ahead = 0, tied = 0;
  for (const c of live) {
    const theirs = evaluate([...comboCards(c), ...board]);
    if (mine > theirs) ahead++;
    else if (mine === theirs) tied++;
  }
  const tiedText = tied ? `, tied with ${tied}` : "";
  return `You're ahead of ${ahead} of ${live.length} combos now${tiedText}. Exact mean: ${answer.toFixed(1)}%.`;
}
