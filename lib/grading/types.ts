// Types for grading a hero decision against the bots. See ev.ts for the math.
//
// Chips are integers in the engine; EVs are expectations, so they are fractional. Fractions (equity,
// fold equity, loss share) are in [0, 1], not percents.

import type { Action, Street } from "../engine/engine";
import type { Card } from "../poker/cards";
import type { Persona, PersonaId } from "../bots/personas";
import type { PublicHistory } from "../bots/view";

export interface GradeOptions {
  /** Multiway: joint holdings sampled from the bots' posteriors (default 2,000). */
  particles?: number;
  /** Heads-up preflop: Monte Carlo boards per bot combo (default 200). */
  trialsPerCombo?: number;
  /** Seed for every sampled quantity (default 1). Same input + seed gives the identical result. */
  seed?: number;
  /**
   * Bets plus raises on the street after which the hero may no longer raise at a later decision in the
   * tree (default 4: bet, raise, 3-bet, 4-bet). Bots' own raises are never pruned.
   */
  maxRaises?: number;
}

export interface GradeInput {
  /** Hero (heroSeat) is on the clock after history.actions. */
  history: PublicHistory;
  heroSeat: number;
  heroCards: readonly [Card, Card];
  /** Persona per seat; null at heroSeat. */
  personas: readonly (Persona | null)[];
  /** Hero's actual action, graded alongside the candidates (added if not already one of them). */
  chosen?: Action;
  options?: GradeOptions;
}

export type Tier = "best" | "correct" | "inaccuracy" | "mistake" | "blunder";

export type OptionKind = "fold" | "check" | "call" | "bet" | "raise" | "allin";

export interface GradedOption {
  action: Action;
  label: string;
  kind: OptionKind;
  /** E[hero's final stack] - hero's stack now, chips; evBb = ev / bigBlind. */
  ev: number;
  evBb: number;
  /** Standard error of `ev`, chips (0 when nothing was sampled). */
  stdErr: number;
  /** "exact": no later betting and exact equities; "ev-now": assumes the hand checks down after this street. */
  model: "exact" | "ev-now";
  /** Best EV minus this EV, chips (>= 0) and as a fraction of the pot before the decision. */
  loss: number;
  lossPct: number;
  tier: Tier;
  /** P(every bot folds before showdown) under this option's tree. */
  foldEquity: number;
  /** Immediate responses of the next bot to act, grouped by concrete action; probs sum to 1 (empty if no bot acts next). */
  responses: { label: string; action: Action; prob: number }[];
  /** Hero's share of the contested chips in the pots that reach showdown (reach-weighted); NaN if none. */
  showdownEquity: number;
}

export interface GradeResult {
  street: Street;
  board: Card[];
  pot: number;
  toCall: number;
  bigBlind: number;
  heroSeat: number;
  /** Chips the hero already has in on this street before acting (preflop: the blind posted), i.e. bets[heroSeat]. */
  heroStreetBet: number;
  /**
   * Facing a bet: c / (contested pot after calling), c = chips the call adds. Equals toCall / (pot + toCall)
   * unless the hero is calling all-in for less (then the unmatched part of the bet is excluded). Else null.
   */
  requiredEquity: number | null;
  /** Hero's check-down equity vs the field right now (exact heads-up postflop). */
  heroEquity: number;
  heroEquityStdErr: number;
  ranges: { seat: number; persona: PersonaId; weights: Float64Array }[];
  /**
   * Per live bot: share of its range inferred WITHOUT removing the hero's cards that uses a hero card, and the
   * same share for a uniform range over combos not on the board (for blocker explanations).
   */
  blockers: { seat: number; blockedShare: number; uniformShare: number }[];
  options: GradedOption[];
  /** Index of the max-EV option. */
  best: number;
  /** Index of `input.chosen` in options, or null. */
  chosen: number | null;
  /** "exact" if every option is exact; else "ev-now". */
  model: "exact" | "ev-now";
}

/**
 * Who the bots are at showdown: a set of weighted "particles", each a joint holding of every live bot,
 * plus hero's pot share against any subset of them. Heads-up the particles are all of the bot's live
 * combos with their posterior weights; multiway they are joint draws from the posterior (weight 1/N).
 */
export interface ShowdownModel {
  /** Live bot seats at the decision; column k of `combos` and bit k of a mask belong to seats[k]. */
  seats: readonly number[];
  /** combos[k][i]: hole-card combo (0..1325) of seats[k] in particle i. */
  combos: readonly ArrayLike<number>[];
  /** Particle weights, summing to 1. */
  weights: Float64Array;
  /**
   * Hero's pot share per particle against the bots in `mask` (bit k = seats[k]); hero wins ties' 1/k.
   * mask must be non-zero. The array is cached and must not be modified.
   */
  share(mask: number): Float64Array;
  /** Per-particle standard error of share(mask) when the particles are exact but the shares were sampled
   *  (heads-up preflop); null when shares are exact or the model is itself a sample. */
  shareStdErr: ((mask: number) => Float64Array) | null;
  /** Shares are exact (no runout sampling). */
  exactShares: boolean;
  /** Particles are a random sample: an EV's stdErr is the payoff's standard deviation over particles / sqrt(N). */
  sampled: boolean;
}
