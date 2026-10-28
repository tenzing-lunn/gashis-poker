// The AKQ half-street game as module 5 teaches it: a 3-card deck A > K > Q and a pot of P.
// The caller always holds the K. The bettor holds the A or the Q, each with probability 1/2, and
// knows which. The bettor checks (showdown for the pot) or bets B; facing a bet, the caller folds
// (the bettor takes the pot) or calls (showdown for P + 2B). Only the bettor can bet.
//
// EVs are counted from now on, with the pot as dead money that belongs to nobody yet, so the bettor's
// EV plus the caller's EV is P. The tree's payoffs must be zero-sum, so each player is treated as
// owning P/2 of the pot: the tree pays player 0 (the bettor) its dead-money payoff minus P/2, and an
// EV is the zero-sum value plus P/2. Player 1 is the caller.
//
// Closed form (derived in akqClosedForm below), unique for all P, B > 0:
//   the bettor always bets the A (a value bet) and bluffs the Q with  b = B / (P + B)
//   the caller's K (a bluff-catcher) calls with                      c = P / (P + B)
//   bluffs are a share s = b / (1 + b) = B / (P + 2B) of all bets
//   bettor's EV = (P + cB) / 2, caller's EV = P - bettor's EV.     (P = B = 10: 7.5 and 2.5)

import { createGame, expectedValue, profileFromMap, type Game, type GameNode, type Profile } from "./game";

export const AKQ_BETTOR_ACTIONS = ["check", "bet"] as const;
export const AKQ_CALLER_ACTIONS = ["fold", "call"] as const;

/** The bettor's info set holding `card` ("bettor:A", "bettor:Q"); the caller's K facing a bet. */
export const akqBettorKey = (card: "A" | "Q"): string => `bettor:${card}`;
export const AKQ_CALLER_KEY = "caller:K:bet";

function checkParams(pot: number, bet: number): void {
  if (!(pot > 0 && bet > 0 && Number.isFinite(pot) && Number.isFinite(bet))) throw new Error("pot and bet must be positive");
}

/** Builds the AKQ game tree for pot P and bet B (2 equally likely deals, 3 info sets). */
export function createAkqGame(pot: number, bet: number): Game {
  checkParams(pot, bet);
  const half = pot / 2;
  // Dead-money payoff to the bettor, shifted by P/2 to make the game zero-sum.
  const leaf = (bettorChips: number): GameNode => ({ kind: "terminal", payoff: bettorChips - half });
  const deal = (card: "A" | "Q"): GameNode => {
    const wins = card === "A";
    return {
      kind: "decision",
      player: 0,
      infoSet: akqBettorKey(card),
      actions: AKQ_BETTOR_ACTIONS,
      children: [
        leaf(wins ? pot : 0),
        {
          kind: "decision",
          player: 1,
          infoSet: AKQ_CALLER_KEY,
          actions: AKQ_CALLER_ACTIONS,
          children: [leaf(pot), leaf(wins ? pot + bet : -bet)],
        },
      ],
    };
  };
  return createGame({
    kind: "chance",
    outcomes: [
      { prob: 1 / 2, child: deal("A") },
      { prob: 1 / 2, child: deal("Q") },
    ],
  });
}

export interface AkqSolution {
  pot: number;
  bet: number;
  /** How often the bettor bets the A (1 at equilibrium). */
  aBet: number;
  /** How often the bettor bluffs the Q: b. */
  qBluff: number;
  /** How often the caller's K calls a bet: c. */
  kCall: number;
  /** Share of the bettor's bets that are bluffs: s. */
  bluffShare: number;
  /** Bettor's EV per deal, the pot counted as dead money. */
  bettorEv: number;
  /** Caller's EV per deal: P - bettorEv. */
  callerEv: number;
}

/**
 * Bettor's EV per deal when the bettor always bets the A, bluffs the Q with b and the K calls with c:
 * the A wins P + cB, the Q wins b((1 - c)P - cB) (checking it wins 0), each with probability 1/2.
 */
export function akqBettorEv(pot: number, bet: number, qBluff: number, kCall: number): number {
  return (pot + kCall * bet + qBluff * akqBluffEv(pot, bet, kCall)) / 2;
}

/** EV of bluffing the Q against a K that calls with c, relative to checking it (0): (1 - c)P - cB. */
export const akqBluffEv = (pot: number, bet: number, kCall: number): number => (1 - kCall) * pot - kCall * bet;

/**
 * EV of calling with the K facing a bet, relative to folding (0), when the Q bluffs with b and the A
 * always bets: s(P + B) - (1 - s)B with bluff share s = b / (1 + b).
 */
export function akqCallEv(pot: number, bet: number, qBluff: number): number {
  const s = qBluff / (1 + qBluff);
  return s * (pot + bet) - (1 - s) * bet;
}

/**
 * Closed-form equilibrium. Derivation:
 * - The A bets: it wins P + cB against P for checking, and c > 0. The Q's check wins nothing.
 * - The K is indifferent when the bluff share s of bets makes calling break even:
 *   s(P + B) - (1 - s)B = 0, so s = B / (P + 2B). With bets = 1/2 (A) + b/2 (Q), s = b / (1 + b),
 *   so b = B / (P + B).
 * - The Q is indifferent when bluffing breaks even: (1 - c)P - cB = 0, so c = P / (P + B).
 * - The Q's EV is then 0 either way, so the bettor's EV is the A's half: (P + cB) / 2.
 * Both frequencies are strictly between 0 and 1 for any P, B > 0, so the equilibrium is unique.
 */
export function akqClosedForm(pot: number, bet: number): AkqSolution {
  checkParams(pot, bet);
  const P = pot, B = bet;
  const qBluff = B / (P + B);
  const kCall = P / (P + B);
  const bettorEv = (P + kCall * B) / 2;
  return { pot: P, bet: B, aBet: 1, qBluff, kCall, bluffShare: B / (P + 2 * B), bettorEv, callerEv: P - bettorEv };
}

/** The closed-form strategies as a profile of `game` (from createAkqGame with the same P, B). */
export function akqClosedFormProfile(game: Game, pot: number, bet: number): Profile {
  const s = akqClosedForm(pot, bet);
  const mix = (p: number) => [1 - p, p];
  return profileFromMap(game, {
    [akqBettorKey("A")]: mix(s.aBet),
    [akqBettorKey("Q")]: mix(s.qBluff),
    [AKQ_CALLER_KEY]: mix(s.kCall),
  });
}

/** Reads the same summary numbers off any profile of the AKQ game (e.g. a CFR+ average strategy). */
export function akqSummary(game: Game, profile: Profile, pot: number, bet: number): AkqSolution {
  const prob = (key: string) => {
    const s = game.infoSets.find((x) => x.key === key);
    if (!s) throw new Error(`Unknown info set ${key}`);
    return profile[s.offset + 1];
  };
  const aBet = prob(akqBettorKey("A")), qBluff = prob(akqBettorKey("Q")), kCall = prob(AKQ_CALLER_KEY);
  const bettorEv = expectedValue(game, profile) + pot / 2;
  return {
    pot,
    bet,
    aBet,
    qBluff,
    kCall,
    bluffShare: aBet + qBluff > 0 ? qBluff / (aBet + qBluff) : 0,
    bettorEv,
    callerEv: pot - bettorEv,
  };
}
