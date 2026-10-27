// Pure-arithmetic drills: outs → equity, pot odds, MDF / bluff break-even, EV of a call, speed call/fold.

import type { Rng } from "../poker/cards";
import { choose } from "../poker/combinatorics";
import type { Difficulty, Question } from "./types";
import { intIn, num, pick, potAndBet, retry, round } from "./util";

type Generated<P> = Omit<Question<P>, "type" | "id">;

// ---------------------------------------------------------------------------
// Formulas (all results in percent, or bb for EV)

/** Chance to hit at least one of `outs` among `unseen` cards with `k` cards to come: 1 − C(n−o,k)/C(n,k). */
export const outsEquity = (outs: number, unseen: number, k: number): number =>
  100 * (1 - choose(unseen - outs, k) / choose(unseen, k));

/** Equity needed to call bet B into pot P: B / (P + 2B). */
export const requiredEquity = (pot: number, bet: number): number => (100 * bet) / (pot + 2 * bet);

/** Minimum defense frequency vs bet B into pot P: P / (P + B). */
export const mdf = (pot: number, bet: number): number => (100 * pot) / (pot + bet);

/** Fold frequency a 0-equity bluff of B into P needs to break even: B / (P + B). */
export const bluffBreakEven = (pot: number, bet: number): number => (100 * bet) / (pot + bet);

/** EV (bb) of calling B into P with equity e% vs folding, at showdown: e·(P + 2B) − B. */
export const callEv = (pot: number, bet: number, equityPct: number): number =>
  (equityPct * (pot + 2 * bet)) / 100 - bet;

// ---------------------------------------------------------------------------
// outsToEquity

export interface OutsToEquityParams {
  difficulty: Difficulty;
  outs: number;
  street: "flop" | "turn";
  /** 47 on the flop, 46 on the turn. */
  unseen: number;
  /** 1 or 2 (2 only from the flop). */
  cardsToCome: 1 | 2;
}

export function genOutsToEquity(rng: Rng, difficulty: Difficulty): Generated<OutsToEquityParams> {
  const outs = difficulty === 1 ? intIn(rng, 2, 9) : difficulty === 2 ? intIn(rng, 1, 15) : intIn(rng, 1, 20);
  const spots: [OutsToEquityParams["street"], 1 | 2][] = [["flop", 2], ["turn", 1]];
  if (difficulty > 1) spots.push(["flop", 1]);
  const [street, cardsToCome] = pick(rng, spots);
  const unseen = street === "flop" ? 47 : 46;
  const answer = outsEquity(outs, unseen, cardsToCome);

  const when =
    cardsToCome === 2
      ? " and two cards to come (turn and river). What is the exact probability, in %, that at least one of them is an out?"
      : street === "flop"
        ? ". What is the exact probability, in %, that the turn (the next card only) is an out?"
        : ". What is the exact probability, in %, that the river is an out?";
  const prompt = `You have ${outs} outs on the ${street}, with ${unseen} unseen cards${when}`;

  const miss = choose(unseen - outs, cardsToCome), all = choose(unseen, cardsToCome);
  const rule = cardsToCome === 2 ? `rule of 4: 4×${outs} = ${4 * outs}%` : `rule of 2: 2×${outs} = ${2 * outs}%`;
  const explanation =
    `1 − C(${unseen - outs},${cardsToCome})/C(${unseen},${cardsToCome}) = 1 − ${miss}/${all} = ${round(answer)}%` +
    ` (${rule})`;
  return {
    prompt,
    params: { difficulty, outs, street, unseen, cardsToCome },
    answer,
    unit: "%",
    tolerance: 1,
    explanation,
  };
}

// ---------------------------------------------------------------------------
// potOdds

export interface PotBetParams {
  difficulty: Difficulty;
  /** Pot in bb before the bet. */
  pot: number;
  /** Bet in bb. */
  bet: number;
}

export function genPotOdds(rng: Rng, difficulty: Difficulty): Generated<PotBetParams> {
  const { pot, bet } = potAndBet(rng, difficulty);
  const answer = requiredEquity(pot, bet);
  return {
    prompt:
      `The pot is ${num(pot)} bb. Villain bets ${num(bet)} bb. What equity, in %, do you need for a call to ` +
      `break even (your call divided by the final pot)?`,
    params: { difficulty, pot, bet },
    answer,
    unit: "%",
    tolerance: 1,
    explanation: `B/(P+2B) = ${num(bet)}/(${num(pot)} + 2×${num(bet)}) = ${num(bet)}/${num(pot + 2 * bet)} = ${round(answer)}%`,
  };
}

// ---------------------------------------------------------------------------
// mdf

export interface MdfParams extends PotBetParams {
  variant: "mdf" | "bluff";
}

export function genMdf(rng: Rng, difficulty: Difficulty): Generated<MdfParams> {
  const variant = pick(rng, ["mdf", "bluff"] as const);
  const { pot, bet } = potAndBet(rng, difficulty);
  const P = num(pot), B = num(bet);
  if (variant === "mdf") {
    const answer = mdf(pot, bet);
    return {
      prompt:
        `The pot is ${P} bb. Villain bets ${B} bb. What is your minimum defense frequency (MDF), in %: how often ` +
        `must you continue so that a bluff with 0% equity can't profit?`,
      params: { difficulty, variant, pot, bet },
      answer,
      unit: "%",
      tolerance: 1,
      explanation: `MDF = P/(P+B) = ${P}/(${P} + ${B}) = ${P}/${num(pot + bet)} = ${round(answer)}%`,
    };
  }
  const answer = bluffBreakEven(pot, bet);
  return {
    prompt:
      `The pot is ${P} bb. You bet ${B} bb as a pure bluff (0% equity if called). How often, in %, must villain ` +
      `fold for the bluff to break even?`,
    params: { difficulty, variant, pot, bet },
    answer,
    unit: "%",
    tolerance: 1,
    explanation: `Break-even fold % = B/(P+B) = ${B}/(${P} + ${B}) = ${B}/${num(pot + bet)} = ${round(answer)}%`,
  };
}

// ---------------------------------------------------------------------------
// callEv

export interface CallEvParams extends PotBetParams {
  /** Hero's equity in % (integer). */
  equity: number;
}

const randomEquity = (rng: Rng, difficulty: Difficulty): number =>
  difficulty === 1 ? 5 * intIn(rng, 1, 19) : intIn(rng, 1, 99);

export function genCallEv(rng: Rng, difficulty: Difficulty): Generated<CallEvParams> {
  const { pot, bet, equity, answer } = retry(() => {
    const { pot, bet } = potAndBet(rng, difficulty);
    const equity = randomEquity(rng, difficulty);
    const answer = callEv(pot, bet, equity);
    return Math.abs(answer) <= 100 ? { pot, bet, equity, answer } : null;
  });
  const P = num(pot), B = num(bet);
  return {
    prompt:
      `The pot is ${P} bb. Villain bets ${B} bb. Your equity is ${equity}%. What is the EV of calling, in bb, ` +
      `compared with folding (EV 0)? Assume no more betting: the hand goes straight to showdown.`,
    params: { difficulty, pot, bet, equity },
    answer,
    unit: "bb",
    tolerance: 0.5,
    explanation:
      `EV = e·(P+2B) − B = ${equity / 100} × (${P} + 2×${B}) − ${B} = ` +
      `${round((equity * (pot + 2 * bet)) / 100)} − ${B} = ${round(answer)} bb`,
  };
}

// ---------------------------------------------------------------------------
// speedCallFold

export interface SpeedCallFoldParams extends CallEvParams {
  /** B/(P+2B) in %, for reference. */
  required: number;
}

export function genSpeedCallFold(rng: Rng, difficulty: Difficulty): Generated<SpeedCallFoldParams> {
  // Minimum distance from the break-even equity: never a near-tie, tighter at higher difficulty.
  const margin = difficulty === 1 ? 10 : difficulty === 2 ? 6 : 3;
  const { pot, bet, equity, required } = retry(() => {
    const { pot, bet } = potAndBet(rng, difficulty);
    const required = requiredEquity(pot, bet);
    const equity = intIn(rng, 1, 99);
    return Math.abs(equity - required) >= margin ? { pot, bet, equity, required } : null;
  });
  const answer = equity >= required ? "call" : "fold";
  const P = num(pot), B = num(bet);
  return {
    prompt: `Pot ${P} bb · Bet ${B} bb · Equity ${equity}% — call or fold?`,
    params: { difficulty, pot, bet, equity, required },
    answer,
    unit: "action",
    tolerance: 0,
    explanation:
      `Need B/(P+2B) = ${B}/${num(pot + 2 * bet)} = ${round(required)}%; you have ${equity}% ` +
      `${answer === "call" ? "≥" : "<"} ${round(required)}% → ${answer}`,
  };
}
