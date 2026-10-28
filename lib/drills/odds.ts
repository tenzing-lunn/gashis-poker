// Pure-arithmetic drills: outs → equity, pot odds, MDF / bluff break-even, EV of a call, speed call/fold.
// Facts per type: outsToEquity 3 (Outs, Unseen, To come); potOdds and mdf 2 (Pot, Bet);
// callEv and speedCallFold 3 (Pot, Bet, Your equity).

import type { Rng } from "../poker/cards";
import { choose } from "../poker/combinatorics";
import type { Answer, Difficulty, Fact, Question } from "./types";
import { POT_ODDS, bb, indistinct, intIn, mistakesOf, num, pct, pick, potAndBet, promptOf, retry, round } from "./util";

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

/** Two [value, message] candidates; when tolerance 1 can't tell them apart, both carry `both` instead. */
const pairOf = (a: [number, string], b: [number, string], both: string): [number, string][] =>
  indistinct(a[0], b[0], 1) ? [[a[0], both], [b[0], both]] : [a, b];

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
  const o = outs, n = unseen;

  const facts: Fact[] = [
    { label: "Outs", value: String(outs) },
    { label: "Unseen", value: `${unseen} cards` },
    { label: "To come", value: cardsToCome === 2 ? "Turn and river" : street === "flop" ? "Turn only" : "River" },
  ];
  const ask =
    cardsToCome === 2
      ? "What's the exact chance, in %, that at least one of the two cards is an out?"
      : "What's the exact chance, in %, that the next card is an out?";

  let hint: string, explanation: string, candidates: [number, string][];
  if (cardsToCome === 2) {
    const miss = 100 - answer;
    hint = "100% minus the chance both cards miss: (UNSEEN − OUTS) / UNSEEN × (UNSEEN − OUTS − 1) / (UNSEEN − 1).";
    explanation =
      `Both miss: ${n - o}/${n} × ${n - o - 1}/${n - 1} = ${pct(miss)}, so 100% − ${pct(miss)} = ${pct(answer)}` +
      ` (rule of 4: ${o} × 4 = ${4 * o}%)`;
    const one = (100 * o) / n, added = one + (100 * o) / (n - 1);
    candidates = [
      ...pairOf(
        [4 * o, `You used the rule of 4 shortcut (${o} × 4 = ${4 * o}%). The exact chance is ${pct(answer)}.`],
        [added, `You added the two cards' chances (${o}/${n} + ${o}/${n - 1} = ${pct(added)}), which counts hitting both twice. Exact: 100% − ${pct(miss)} = ${pct(answer)}.`],
        `You used the rule of 4 (${o} × 4 = ${4 * o}%) or added the two cards' chances (${pct(added)}); both overcount. Exact: 100% − ${pct(miss)} = ${pct(answer)}.`,
      ),
      [one, `That's the chance for one card (${o}/${n} = ${pct(one)}). With two to come, the turn or the river can hit: ${pct(answer)}.`],
    ];
  } else {
    const two = outsEquity(o, n, 2), of52 = (100 * o) / 52;
    hint = "OUTS / UNSEEN.";
    explanation = `OUTS / UNSEEN = ${o}/${n} = ${pct(answer)} (rule of 2: ${o} × 2 = ${2 * o}%)`;
    candidates = [
      ...pairOf(
        [2 * o, `You used the rule of 2 shortcut (${o} × 2 = ${2 * o}%). The exact chance is ${o}/${n} = ${pct(answer)}.`],
        [of52, `You divided by 52 (${pct(of52)}), but only the ${n} unseen cards can come: ${o}/${n} = ${pct(answer)}.`],
        `You used the rule of 2 (${o} × 2 = ${2 * o}%) or divided by 52 (${pct(of52)}). The exact chance is ${o}/${n} = ${pct(answer)}.`,
      ),
      ...pairOf(
        [4 * o, `You used the rule of 4 (${o} × 4 = ${4 * o}%), which is for two cards to come. With one card: ${o}/${n} = ${pct(answer)}.`],
        [two, `That's the chance over two cards (${pct(two)}). Only one card is to come: ${o}/${n} = ${pct(answer)}.`],
        `That's the chance over two cards (${pct(two)}, or ${o} × 4 = ${4 * o}% by the rule of 4). Only one card is to come: ${o}/${n} = ${pct(answer)}.`,
      ),
    ];
  }
  return {
    prompt: promptOf(facts, ask),
    facts,
    ask,
    ...(difficulty === 1 && { hint }),
    params: { difficulty, outs, street, unseen, cardsToCome },
    answer,
    unit: "%",
    tolerance: 1,
    explanation,
    mistakes: mistakesOf(answer, 1, candidates),
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

const potBetFacts = (pot: number, bet: number): Fact[] => [
  { label: "Pot", value: bb(pot) },
  { label: "Bet", value: bb(bet) },
];

export function genPotOdds(rng: Rng, difficulty: Difficulty): Generated<PotBetParams> {
  const { pot, bet } = potAndBet(rng, difficulty);
  const answer = requiredEquity(pot, bet);
  const P = num(pot), B = num(bet), final = num(pot + 2 * bet);
  const facts = potBetFacts(pot, bet);
  const ask = "They bet. What win % do you need for a call to break even?";
  const bp = (100 * bet) / pot, bpb = bluffBreakEven(pot, bet);
  return {
    prompt: promptOf(facts, ask),
    facts,
    ask,
    ...(difficulty === 1 && { hint: `${POT_ODDS}: your call over the final pot.` }),
    params: { difficulty, pot, bet },
    answer,
    unit: "%",
    tolerance: 1,
    explanation: `${POT_ODDS} = ${B} / (${P} + ${B} + ${B}) = ${B} / ${final} = ${pct(answer)}`,
    mistakes: mistakesOf(answer, 1, [
      [bp, `You used BET / POT (${pct(bp)}) instead of ${POT_ODDS} (${pct(answer)}): the final pot holds their bet and your call too.`],
      [bpb, `You used BET / (POT + BET) (${pct(bpb)}), which forgets your own call. The final pot is POT + BET + YOUR CALL: ${B} / ${final} = ${pct(answer)}.`],
      [100 - answer, `${pct(100 - answer)} is how often you can afford to lose. The win % you need is the other side: ${pct(answer)}.`],
    ]),
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
  const P = num(pot), B = num(bet), after = num(pot + bet);
  const facts = potBetFacts(pot, bet);
  const md = mdf(pot, bet), be = bluffBreakEven(pot, bet), odds = requiredEquity(pot, bet), bp = (100 * bet) / pot;
  const base = { facts, params: { difficulty, variant, pot, bet }, unit: "%" as const, tolerance: 1 };
  if (variant === "mdf") {
    const ask =
      "They bet. What is your minimum defense frequency (MDF): how often, in %, must you continue so their bluffs can't profit?";
    return {
      ...base,
      prompt: promptOf(facts, ask),
      ask,
      ...(difficulty === 1 && { hint: "POT / (POT + BET)." }),
      answer: md,
      explanation: `MDF = POT / (POT + BET) = ${P} / (${P} + ${B}) = ${P} / ${after} = ${pct(md)}`,
      mistakes: mistakesOf(md, 1, [
        [be, `That's 100% − MDF, how often a bluff must work: BET / (POT + BET) = ${pct(be)}. Defending is the other side: POT / (POT + BET) = ${pct(md)}.`],
        [odds, `You used pot odds, ${POT_ODDS} = ${pct(odds)}: the win % a call needs, not how often to defend. MDF = POT / (POT + BET) = ${pct(md)}.`],
      ]),
    };
  }
  const ask = "You bet as a pure bluff: you lose if called. How often, in %, must they fold for it to break even?";
  return {
    ...base,
    prompt: promptOf(facts, ask),
    ask,
    ...(difficulty === 1 && { hint: "BET / (POT + BET): what you risk over the pot after your bet." }),
    answer: be,
    explanation: `Break-even fold % = BET / (POT + BET) = ${B} / (${P} + ${B}) = ${B} / ${after} = ${pct(be)}`,
    mistakes: mistakesOf(be, 1, [
      [md, `That's their minimum defense frequency (MDF), POT / (POT + BET) = ${pct(md)}. A bluff needs them to fold BET / (POT + BET) = ${pct(be)}.`],
      [odds, `You used pot odds, ${POT_ODDS} = ${pct(odds)}: that's for calling. A bluff risks BET to win POT: BET / (POT + BET) = ${pct(be)}.`],
      [bp, `You used BET / POT (${pct(bp)}). Compare your risk with the whole pot after your bet: BET / (POT + BET) = ${pct(be)}.`],
    ]),
  };
}

// ---------------------------------------------------------------------------
// callEv

export interface CallEvParams extends PotBetParams {
  /** Your equity in % (integer). */
  equity: number;
}

const randomEquity = (rng: Rng, difficulty: Difficulty): number =>
  difficulty === 1 ? 5 * intIn(rng, 1, 19) : intIn(rng, 1, 99);

const evFacts = (pot: number, bet: number, equity: number): Fact[] => [
  ...potBetFacts(pot, bet),
  { label: "Your equity", value: `${equity}%` },
];

const EV_FORMULA = "EQUITY × (POT + BET + YOUR CALL) − YOUR CALL";

export function genCallEv(rng: Rng, difficulty: Difficulty): Generated<CallEvParams> {
  const { pot, bet, equity, answer } = retry(() => {
    const { pot, bet } = potAndBet(rng, difficulty);
    const equity = randomEquity(rng, difficulty);
    const answer = callEv(pot, bet, equity);
    return Math.abs(answer) <= 100 ? { pot, bet, equity, answer } : null;
  });
  const P = num(pot), B = num(bet), e = equity / 100;
  const facts = evFacts(pot, bet, equity);
  const ask = "What does calling win or lose on average, in bb, compared with folding? No more betting after the call.";
  const back = e * (pot + 2 * bet), noCall = e * (pot + bet) - bet, potOnly = e * pot - bet;
  const bbs = (x: number) => `${round(x)} bb`;
  return {
    prompt: promptOf(facts, ask),
    facts,
    ask,
    ...(difficulty === 1 && { hint: `${EV_FORMULA}.` }),
    params: { difficulty, pot, bet, equity },
    answer,
    unit: "bb",
    tolerance: 0.5,
    explanation:
      `EV (expected value) = ${EV_FORMULA} = ${e} × (${P} + ${B} + ${B}) − ${B} = ` +
      `${round(back)} − ${B} = ${bbs(answer)}`,
    mistakes: mistakesOf(answer, 0.5, [
      [back, `You didn't subtract your call: ${e} × ${num(pot + 2 * bet)} = ${bbs(back)} is what you get back on average. EV = ${round(back)} − ${B} = ${bbs(answer)}.`],
      [noCall, `You left your own call out of the pot: ${e} × (${P} + ${B}) − ${B} = ${bbs(noCall)}. The pot you win is POT + BET + YOUR CALL: ${bbs(answer)}.`],
      [potOnly, `You used only the pot before the bet: ${e} × ${P} − ${B} = ${bbs(potOnly)}. You also win their bet and get your call back: ${bbs(answer)}.`],
      [-answer, `Right size, wrong sign: calling ${answer > 0 ? "wins" : "loses"} ${bbs(Math.abs(answer))} on average.`],
    ]),
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
  // Call or fold first, so each is about half the answers, then an equity on that side of the margin.
  const answer = pick(rng, ["call", "fold"] as const);
  const { pot, bet, equity, required } = retry(() => {
    const { pot, bet } = potAndBet(rng, difficulty);
    const required = requiredEquity(pot, bet);
    const [lo, hi] = answer === "call" ? [Math.ceil(required + margin), 99] : [1, Math.floor(required - margin)];
    return lo <= hi ? { pot, bet, equity: intIn(rng, lo, hi), required } : null;
  });
  const B = num(bet);
  const facts = evFacts(pot, bet, equity);
  const ask = "Call or fold?";
  // Folding a call: explained if the equity was compared with a threshold that forgets the call.
  const bpb = bluffBreakEven(pot, bet), bp = (100 * bet) / pot;
  const need = `You need ${POT_ODDS} = ${pct(required)}.`;
  const wrongFold: [Answer, string][] =
    answer !== "call"
      ? []
      : equity < bpb
        ? [["fold", `Looks like you compared ${equity}% with BET / (POT + BET) (${pct(bpb)}), which forgets your call. ${need}`]]
        : equity < bp && bp < 100
          ? [["fold", `You compared ${equity}% with BET / POT (${pct(bp)}), which leaves their bet and your call out of the pot. ${need}`]]
          : [];
  return {
    prompt: promptOf(facts, ask),
    facts,
    ask,
    ...(difficulty === 1 && { hint: `Call when your equity is at least ${POT_ODDS}.` }),
    params: { difficulty, pot, bet, equity, required },
    answer,
    unit: "action",
    tolerance: 0,
    explanation:
      `You need ${POT_ODDS} = ${B} / ${num(pot + 2 * bet)} = ${pct(required)}; you have ${equity}% ` +
      `${answer === "call" ? "≥" : "<"} ${pct(required)}, so ${answer}`,
    mistakes: mistakesOf(answer, 0, wrongFold),
  };
}
