// Kuhn poker and a small vanilla CFR solver for it. Pure functions plus one mutable solver state.
//
// The game: a deck of three cards J < Q < K. Each player antes 1 and gets one card; the third card
// is unseen. Player 1 checks or bets 1. After a check, player 2 checks (showdown for the pot of 2)
// or bets 1, and then player 1 calls or folds. After a bet, player 2 calls or folds.
//
// Every decision point is an "information set": what the player to act knows, i.e. their own card
// plus the betting so far. There are 12, each with two actions: 0 = pass (check or fold),
// 1 = bet (bet or call). A strategy is the probability of action 1 at each of the 12 sets.

export const CARD_NAMES = ["J", "Q", "K"] as const;

/** Information-set layout: index = group * 3 + card. */
export const INFO_GROUPS = [
  { player: 1, history: "", label: "P1 first action", pass: "check", bet: "bet" },
  { player: 1, history: "pb", label: "P1 after check, bet", pass: "fold", bet: "call" },
  { player: 2, history: "p", label: "P2 after a check", pass: "check", bet: "bet" },
  { player: 2, history: "b", label: "P2 facing a bet", pass: "fold", bet: "call" },
] as const;

export const INFO_SET_COUNT = 12;

const groupOf: Record<string, number> = { "": 0, pb: 1, p: 2, b: 3 };

/** Strategy: probability of "bet/call" at each of the 12 information sets. */
export type Strategy = number[];

const DEALS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1],
];

/** Payoff to player 1 at a terminal history, or null if the history is not terminal. */
function terminalPayoff(h: string, c1: number, c2: number): number | null {
  const showdown = c1 > c2 ? 1 : -1;
  switch (h) {
    case "pp": return showdown; // check, check: win the other player's ante
    case "bp": return 1; // P1 bets, P2 folds
    case "pbp": return -1; // P1 checks, P2 bets, P1 folds
    case "bb":
    case "pbb": return 2 * showdown; // a bet was called: ante + bet
    default: return null;
  }
}

/** Expected payoff to player 1 when both players follow `s`, averaged over the 6 equally likely deals. */
export function gameValue(s: Strategy): number {
  let total = 0;
  for (const [c1, c2] of DEALS) total += valueAt("", c1, c2, s);
  return total / DEALS.length;
}

function valueAt(h: string, c1: number, c2: number, s: Strategy): number {
  const t = terminalPayoff(h, c1, c2);
  if (t !== null) return t;
  const g = groupOf[h];
  const card = INFO_GROUPS[g].player === 1 ? c1 : c2;
  const pBet = s[g * 3 + card];
  return (1 - pBet) * valueAt(h + "p", c1, c2, s) + pBet * valueAt(h + "b", c1, c2, s);
}

/**
 * The most a best-responding opponent can earn against `s`. Each player has only 6 information
 * sets, so a best response is found by trying all 2^6 = 64 pure strategies.
 * Returns the best value for player 1 (against s's player-2 half) and for player 2 (against s's player-1 half).
 */
export function bestResponseValues(s: Strategy): { p1: number; p2: number } {
  let best1 = -Infinity, best2 = -Infinity;
  for (let mask = 0; mask < 64; mask++) {
    const t1 = s.slice(), t2 = s.slice();
    for (let k = 0; k < 6; k++) {
      t1[k] = (mask >> k) & 1; // player 1's sets are 0..5
      t2[6 + k] = (mask >> k) & 1; // player 2's sets are 6..11
    }
    best1 = Math.max(best1, gameValue(t1));
    best2 = Math.max(best2, -gameValue(t2));
  }
  return { p1: best1, p2: best2 };
}

/**
 * Exploitability: on average over the two seats, how much more than the game value a perfect
 * opponent wins against this strategy pair. Zero exactly at a Nash equilibrium.
 * (best response value for P1 − v) + (best response value for P2 − (−v)), halved.
 */
export function exploitability(s: Strategy): number {
  const br = bestResponseValues(s);
  return (br.p1 + br.p2) / 2;
}

export const KUHN_VALUE = -1 / 18;

// ---------------------------------------------------------------------------
// CFR (counterfactual regret minimization), vanilla, enumerating all 6 deals each iteration.

export interface CfrState {
  iterations: number;
  /** Cumulative regret for [pass, bet] at each information set. */
  regret: Float64Array;
  /** Cumulative probability of each action, weighted by how often the player reaches the set. */
  strategySum: Float64Array;
}

export function createCfrState(): CfrState {
  return { iterations: 0, regret: new Float64Array(24), strategySum: new Float64Array(24) };
}

/** Regret matching: play each action in proportion to its positive cumulative regret (uniform if none). */
export function currentStrategyAt(state: CfrState, i: number): [number, number] {
  const a = Math.max(state.regret[2 * i], 0), b = Math.max(state.regret[2 * i + 1], 0);
  const sum = a + b;
  return sum > 0 ? [a / sum, b / sum] : [0.5, 0.5];
}

/** The average strategy over all iterations so far. This is the part that converges to equilibrium. */
export function averageStrategy(state: CfrState): Strategy {
  const out: number[] = [];
  for (let i = 0; i < INFO_SET_COUNT; i++) {
    const a = state.strategySum[2 * i], b = state.strategySum[2 * i + 1];
    out.push(a + b > 0 ? b / (a + b) : 0.5);
  }
  return out;
}

/**
 * Returns the value of history h for player 1, and adds regrets. r1 and r2 are the probabilities
 * that player 1 and player 2 play to reach h (chance is the same for every deal, so it is left out).
 */
function cfr(state: CfrState, cur: Float64Array, h: string, c1: number, c2: number, r1: number, r2: number): number {
  const t = terminalPayoff(h, c1, c2);
  if (t !== null) return t;
  const g = groupOf[h];
  const player = INFO_GROUPS[g].player;
  const i = g * 3 + (player === 1 ? c1 : c2);
  const pPass = cur[2 * i], pBet = cur[2 * i + 1];
  const reachSelf = player === 1 ? r1 : r2;
  const reachOpp = player === 1 ? r2 : r1;

  const vPass = player === 1 ? cfr(state, cur, h + "p", c1, c2, r1 * pPass, r2) : cfr(state, cur, h + "p", c1, c2, r1, r2 * pPass);
  const vBet = player === 1 ? cfr(state, cur, h + "b", c1, c2, r1 * pBet, r2) : cfr(state, cur, h + "b", c1, c2, r1, r2 * pBet);
  const v = pPass * vPass + pBet * vBet;

  // Values above are for player 1; flip the sign for player 2.
  const sign = player === 1 ? 1 : -1;
  // Regret of an action: how much better it would have done than the mix actually played,
  // weighted by how likely the opponent's play was to bring us here.
  state.regret[2 * i] += reachOpp * sign * (vPass - v);
  state.regret[2 * i + 1] += reachOpp * sign * (vBet - v);
  state.strategySum[2 * i] += reachSelf * pPass;
  state.strategySum[2 * i + 1] += reachSelf * pBet;
  return v;
}

/**
 * Runs n CFR iterations in place. Each iteration fixes the current (regret-matching) strategy,
 * plays it through every deal, then the regrets it added decide the next iteration's strategy.
 */
export function runIterations(state: CfrState, n: number): void {
  const cur = new Float64Array(24);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < INFO_SET_COUNT; i++) {
      const [a, b] = currentStrategyAt(state, i);
      cur[2 * i] = a;
      cur[2 * i + 1] = b;
    }
    for (const [c1, c2] of DEALS) cfr(state, cur, "", c1, c2, 1, 1);
    state.iterations++;
  }
}

/**
 * The equilibrium family (Kuhn, 1950): player 1 bets J with some β in [0, 1/3] (often called α), bets K with 3β,
 * never bets Q, calls with Q at β + 1/3; player 2's strategy is unique.
 */
export function equilibriumFor(beta: number): Strategy {
  return [
    beta, 0, 3 * beta, // P1 first action: J, Q, K
    0, beta + 1 / 3, 1, // P1 after check-bet: J, Q, K
    1 / 3, 0, 1, // P2 after a check: J, Q, K
    0, 1 / 3, 1, // P2 facing a bet: J, Q, K
  ];
}
