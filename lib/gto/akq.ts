// The [A,K,Q] half-street game (Chen & Ankenman, The Mathematics of Poker): a 3-card deck A > K > Q,
// X and Y each get one card, the pot is P. X checks (no choice); Y bets B or checks; facing a bet X
// calls or folds; then showdown.
//
// Payoffs are zero-sum: each player is treated as having put P/2 into the pot, so a player who wins
// the pot nets +P/2. Player 0 is X, player 1 is Y; the tree's payoffs are to X. Y's expected chips
// counting the pot as dead money (Chen & Ankenman's "pot share") are P/2 + Y's zero-sum value.
//
// Closed form (derived in akqClosedForm below). For P > B the equilibrium is unique:
//   Y bets A, checks K, bluffs Q with  beta = B / (P + B)            (B = 1: 1/(P+1))
//   X calls A, folds Q, calls K with   c    = (P - B) / (P + B)      (B = 1: (P-1)/(P+1))
//   so against Y's bluffing hand X (holding A or K) calls (1 + c)/2 = P / (P + B): the MDF.
//   Value to Y = B (P - B) / (6 (P + B)) per deal.
// For B >= P, Y's bluff can't win enough (it loses B to the ace and wins at most P from the king), so
// K never calls and the value is 0; the equilibrium is no longer unique (see akqClosedForm).

import { createGame, profileFromMap, type Game, type GameNode, type Profile } from "./game";

export const AKQ_CARDS = ["Q", "K", "A"] as const; // index = strength
export const AKQ_Y_ACTIONS = ["check", "bet"] as const;
export const AKQ_X_ACTIONS = ["fold", "call"] as const;

/** Y's info set holding `card` ("Y:A"); X's info set facing a bet holding `card` ("X:K:bet"). */
export const akqYKey = (card: string): string => `Y:${card}`;
export const akqXKey = (card: string): string => `X:${card}:bet`;

function checkParams(pot: number, bet: number): void {
  if (!(pot > 0 && bet > 0 && Number.isFinite(pot) && Number.isFinite(bet))) throw new Error("pot and bet must be positive");
}

/** Builds the AKQ game tree for pot P and bet B (6 equally likely deals, 6 info sets). */
export function createAkqGame(pot: number, bet: number): Game {
  checkParams(pot, bet);
  const half = pot / 2;
  const outcomes: { prob: number; child: GameNode }[] = [];
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      if (x === y) continue;
      const xWins = x > y;
      const facing: GameNode = {
        kind: "decision",
        player: 0,
        infoSet: akqXKey(AKQ_CARDS[x]),
        actions: AKQ_X_ACTIONS,
        children: [
          { kind: "terminal", payoff: -half },
          { kind: "terminal", payoff: xWins ? half + bet : -(half + bet) },
        ],
      };
      outcomes.push({
        prob: 1 / 6,
        child: {
          kind: "decision",
          player: 1,
          infoSet: akqYKey(AKQ_CARDS[y]),
          actions: AKQ_Y_ACTIONS,
          children: [{ kind: "terminal", payoff: xWins ? half : -half }, facing],
        },
      });
    }
  }
  return createGame({ kind: "chance", outcomes });
}

export interface AkqSolution {
  pot: number;
  bet: number;
  /** Y's bluffing frequency with Q. For P = B any value in yBluffRange is an equilibrium; this is its top. */
  yBluff: number;
  /** The equilibrium interval for Y's Q bluff frequency (a single point when P > B). */
  yBluffRange: [number, number];
  /** Y's betting frequency with A (1; for B >= P any frequency is an equilibrium and 1 is reported). */
  yBetA: number;
  /** X's calling frequency with K facing a bet. */
  kCall: number;
  /** X's calling frequency over the hands it can hold when Y bluffs (A always, K at kCall): (1 + kCall)/2. Equals the MDF P/(P+B) when P > B. */
  xCallVsBluff: number;
  /** P(X calls | Y bets), over all deals. */
  xCallGivenBet: number;
  /** Share of Y's bets that are bluffs: beta / (1 + beta) = B / (P + 2B) when P > B. */
  bluffShareOfBets: number;
  /** Y's expected value per deal, zero-sum convention. */
  valueY: number;
  /** Y's expected chips per deal counting the pot as dead money: P/2 + valueY. */
  yPotShare: number;
  /** True when the equilibrium strategy is unique (P > B). */
  unique: boolean;
}

/**
 * Closed-form equilibrium. Derivation (P > B):
 * - Y bets A (betting can only gain: K may call) and checks K (betting K only gets called by A).
 *   X calls with A and folds Q (Q never wins at showdown).
 * - X holding K faces a bet from A (always) or Q (beta); the two are equally likely a priori. Calling
 *   instead of folding loses B against A and wins P + B against Q, so K is indifferent when
 *   -B + beta (P + B) = 0, i.e. beta = B / (P + B).
 * - Y holding Q faces A or K equally. Bluffing instead of checking (which loses the pot anyway) loses
 *   B against A, and against K wins P when K folds and loses B when it calls. Y is indifferent when
 *   -B + (1 - c) P - c B = 0, i.e. c = (P - B) / (P + B).
 * - Value: summing the six deals, everything cancels except Y's profit from K's calls against A,
 *   -c B for X, so Y's value is c B / 6 = B (P - B) / (6 (P + B)).
 * If B >= P, bluffing loses even when K always folds: -B/2 + P/2 <= 0. Then K never calls (c = 0),
 * the value is 0, and for P < B Y never bluffs. At P = B Y is indifferent to bluffing, and any
 * beta <= B/(P+B) = 1/2 (with Y always betting A) keeps K happy to fold: the equilibrium is not unique.
 */
export function akqClosedForm(pot: number, bet: number): AkqSolution {
  checkParams(pot, bet);
  const P = pot, B = bet;
  const unique = P > B;
  const kCall = unique ? (P - B) / (P + B) : 0;
  const yBluff = P >= B ? B / (P + B) : 0;
  const yBluffRange: [number, number] = unique ? [yBluff, yBluff] : [0, yBluff];
  const valueY = (kCall * B) / 6;
  return {
    pot: P,
    bet: B,
    yBluff,
    yBluffRange,
    yBetA: 1,
    kCall,
    xCallVsBluff: (1 + kCall) / 2,
    xCallGivenBet: (kCall + yBluff * (1 + kCall)) / (2 * (1 + yBluff)),
    bluffShareOfBets: yBluff / (1 + yBluff),
    valueY,
    yPotShare: P / 2 + valueY,
    unique,
  };
}

/** The closed-form strategies as a profile of `game` (from createAkqGame with the same P, B). */
export function akqClosedFormProfile(game: Game, pot: number, bet: number): Profile {
  const s = akqClosedForm(pot, bet);
  const y = (b: number) => [1 - b, b];
  return profileFromMap(game, {
    [akqYKey("A")]: y(s.yBetA),
    [akqYKey("K")]: y(0),
    [akqYKey("Q")]: y(s.yBluff),
    [akqXKey("A")]: y(1),
    [akqXKey("K")]: y(s.kCall),
    [akqXKey("Q")]: y(0),
  });
}

/** Reads the same summary numbers off any profile of the AKQ game (e.g. a CFR average strategy). */
export function akqSummary(game: Game, profile: Profile, pot: number, bet: number, valueX: number): AkqSolution {
  const prob = (key: string) => {
    const s = game.infoSets.find((x) => x.key === key);
    if (!s) throw new Error(`Unknown info set ${key}`);
    return profile[s.offset + 1];
  };
  const yBluff = prob(akqYKey("Q")), yBetA = prob(akqYKey("A")), kCall = prob(akqXKey("K")), aCall = prob(akqXKey("A"));
  const qCall = prob(akqXKey("Q")), yBetK = prob(akqYKey("K"));
  // P(call and bet) and P(bet) over the six deals (each 1/6).
  const callAndBet = (yBetA * (kCall + qCall) + yBetK * (aCall + qCall) + yBluff * (aCall + kCall)) / 6;
  const betProb = (2 * (yBetA + yBetK + yBluff)) / 6;
  return {
    pot,
    bet,
    yBluff,
    yBluffRange: [yBluff, yBluff],
    yBetA,
    kCall,
    xCallVsBluff: (aCall + kCall) / 2,
    xCallGivenBet: betProb > 0 ? callAndBet / betProb : 0,
    bluffShareOfBets: yBetA + yBluff > 0 ? yBluff / (yBetA + yBluff) : 0,
    valueY: -valueX,
    yPotShare: pot / 2 - valueX,
    unique: pot > bet,
  };
}
