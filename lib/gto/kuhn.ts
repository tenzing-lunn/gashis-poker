// Kuhn poker (Kuhn 1950), with the same rules as OpenSpiel's `kuhn_poker`:
// a 3-card deck J < Q < K, each player antes 1 and gets one card. Player 0 acts first: pass or bet 1.
//   pass, pass  -> showdown for the antes (+-1)
//   pass, bet   -> player 0 passes (folds, -1) or bets (calls; showdown +-2)
//   bet         -> player 1 passes (folds, player 0 +1) or bets (calls; showdown +-2)
// Payoffs are to player 0 in chips. The game value for player 0 is -1/18.
//
// Info-set keys: the acting player's card letter followed by the action history, with p = pass
// (check or fold) and b = bet (bet or call): player 0 has "J", "Q", "K", "Jpb", "Qpb", "Kpb";
// player 1 has "Jp", "Jb", "Qp", "Qb", "Kp", "Kb". Every info set has actions [pass, bet] in that
// order, which are OpenSpiel's action ids 0 and 1. toOpenSpielInfoState swaps the letter for
// OpenSpiel's card number (J=0, Q=1, K=2): "Qpb" -> "1pb".

import { createGame, profileFromMap, type DecisionNode, type Game, type GameNode, type Profile } from "./game";

export const KUHN_CARDS = ["J", "Q", "K"] as const;
export const KUHN_ACTIONS = ["pass", "bet"] as const;

function decision(player: 0 | 1, card: number, history: string, pass: GameNode, bet: GameNode): DecisionNode {
  return { kind: "decision", player, infoSet: KUHN_CARDS[card] + history, actions: KUHN_ACTIONS, children: [pass, bet] };
}

const showdown = (c0: number, c1: number, stake: number): GameNode => ({ kind: "terminal", payoff: c0 > c1 ? stake : -stake });
const fold = (payoff: number): GameNode => ({ kind: "terminal", payoff });

function deal(c0: number, c1: number): GameNode {
  return decision(
    0,
    c0,
    "",
    decision(1, c1, "p", showdown(c0, c1, 1), decision(0, c0, "pb", fold(-1), showdown(c0, c1, 2))),
    decision(1, c1, "b", fold(1), showdown(c0, c1, 2)),
  );
}

/** Builds the Kuhn poker game tree (6 equally likely deals, 12 info sets). */
export function createKuhnGame(): Game {
  const outcomes: { prob: number; child: GameNode }[] = [];
  for (let c0 = 0; c0 < 3; c0++) for (let c1 = 0; c1 < 3; c1++) if (c0 !== c1) outcomes.push({ prob: 1 / 6, child: deal(c0, c1) });
  return createGame({ kind: "chance", outcomes });
}

/** Game value to player 0 at any equilibrium. */
export const KUHN_VALUE = -1 / 18;

/** Our info-set key -> OpenSpiel's kuhn_poker information state string ("Qpb" -> "1pb"). */
export function toOpenSpielInfoState(key: string): string {
  const card = KUHN_CARDS.indexOf(key[0] as (typeof KUHN_CARDS)[number]);
  if (card < 0 || !/^(|p|b|pb)$/.test(key.slice(1))) throw new Error(`Not a Kuhn info set: "${key}"`);
  return card + key.slice(1);
}

/**
 * Kuhn's equilibrium family, as P(bet) per info set ("bet" = bet or call), for alpha in [0, 1/3]:
 *   player 0: bets J with alpha, never bets Q, bets K with 3*alpha; after pass-bet folds J,
 *             calls Q with alpha + 1/3, always calls K.
 *   player 1: facing a bet calls only with Q (1/3) and K; after a pass bets J with 1/3 (a bluff),
 *             checks Q, bets K.
 * Player 1's strategy is the same for every alpha (it is player 1's unique equilibrium strategy).
 */
export function kuhnEquilibriumBetProbs(alpha: number): Record<string, number> {
  if (!(alpha >= 0 && alpha <= 1 / 3)) throw new Error(`alpha must be in [0, 1/3], got ${alpha}`);
  return {
    J: alpha, Q: 0, K: 3 * alpha,
    Jpb: 0, Qpb: alpha + 1 / 3, Kpb: 1,
    Jb: 0, Qb: 1 / 3, Kb: 1,
    Jp: 1 / 3, Qp: 0, Kp: 1,
  };
}

/** The analytic equilibrium for a given alpha as a profile of `game` (from createKuhnGame). */
export function kuhnEquilibriumProfile(game: Game, alpha: number): Profile {
  const bet = kuhnEquilibriumBetProbs(alpha);
  return profileFromMap(game, Object.fromEntries(Object.entries(bet).map(([k, b]) => [k, [1 - b, b]])));
}

/**
 * The alpha of the family member closest to a player-0 strategy: alpha is read off P(bet J),
 * K's bet (/3) and Q's call after pass-bet (- 1/3), averaged and clamped to [0, 1/3].
 * Useful for showing where CFR landed within the family.
 */
export function kuhnAlpha(game: Game, profile: Profile): number {
  const bet = (key: string) => {
    const s = game.infoSets.find((x) => x.key === key);
    if (!s) throw new Error(`Unknown info set ${key}`);
    return profile[s.offset + 1];
  };
  const est = (bet("J") + bet("K") / 3 + (bet("Qpb") - 1 / 3)) / 3;
  return Math.min(1 / 3, Math.max(0, est));
}
