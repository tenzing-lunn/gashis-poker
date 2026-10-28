// The hero's options at a decision, with labels.
//
// fold (only when facing a bet: the engine forbids folding when checking is free), check or call, and
// when raising is legal:
//   first bet of a street: 33%, 66% and 100% of the pot, and all-in;
//   facing a bet (preflop the blinds count as one): the min-raise, a pot-size raise and all-in.
// A pot-size raise is "call, then raise by the pot after the call": to = maxBet + pot + toCall, where the
// pot already includes every outstanding bet. Every size is rounded to a chip and clamped to
// [minRaiseTo, maxRaiseTo]; a size that reaches maxRaiseTo is the all-in; duplicates are dropped.
// Amounts are raise-to totals for the street, like the engine's.

import { legalActions, potTotal, type Action, type HandState, type LegalActions } from "../engine/engine";
import { sameAction } from "../bots/policy";
import type { OptionKind } from "./types";

export interface Candidate {
  action: Action;
  label: string;
  kind: OptionKind;
}

/** First-bet sizes as fractions of the pot. */
export const BET_SIZES: readonly number[] = [0.33, 0.66, 1];

/** Chips as big blinds, at most one decimal: "6.6 bb", "24 bb". */
export function formatBb(chips: number, bigBlind: number): string {
  return `${Math.round((chips / bigBlind) * 10) / 10} bb`;
}

/**
 * Label and kind of an action for the seat on the clock with legal actions `la`, where `pot` is the
 * total pot including outstanding bets. Throws if the action is not legal there.
 */
export function describeAction(action: Action, la: LegalActions, pot: number, bigBlind: number): Candidate {
  switch (action.type) {
    case "fold":
      if (!la.canFold) throw new Error("Folding is not legal here: checking is free");
      return { action, label: "Fold", kind: "fold" };
    case "check":
      if (!la.canCheck) throw new Error(`Checking is not legal here: facing ${la.toCall} to call`);
      return { action, label: "Check", kind: "check" };
    case "call":
      if (!la.canCall) throw new Error("Calling is not legal here: there is nothing to call");
      return { action, label: `Call (${formatBb(la.callAmount, bigBlind)})`, kind: "call" };
    case "raise": {
      const to = action.to;
      if (!la.canRaise || !Number.isInteger(to) || to < la.minRaiseTo || to > la.maxRaiseTo) {
        throw new Error(`Raising to ${to} is not legal here`);
      }
      if (to === la.maxRaiseTo) return { action, label: `All-in (${formatBb(to, bigBlind)})`, kind: "allin" };
      if (la.isBet) return { action, label: `Bet ${Math.round((100 * to) / pot)}% (${formatBb(to, bigBlind)})`, kind: "bet" };
      return { action, label: `Raise to ${formatBb(to, bigBlind)}`, kind: "raise" };
    }
    default:
      throw new Error(`Unknown action ${JSON.stringify(action)}`);
  }
}

/**
 * The standard options (see the header) for the seat on the clock: fold, check/call, sizes ascending,
 * all-in. `maxBet` is the biggest bet on the street; `pot` includes outstanding bets.
 */
export function candidates(la: LegalActions, pot: number, maxBet: number, bigBlind: number): Candidate[] {
  const out: Candidate[] = [];
  const add = (a: Action): void => {
    if (!out.some((c) => sameAction(c.action, a))) out.push(describeAction(a, la, pot, bigBlind));
  };
  if (la.canFold) add({ type: "fold" });
  if (la.canCheck) add({ type: "check" });
  if (la.canCall) add({ type: "call" });
  if (la.canRaise) {
    const sizes = la.isBet ? BET_SIZES.map((f) => f * pot) : [la.minRaiseTo, maxBet + pot + la.toCall];
    for (const to of sizes) add({ type: "raise", to: Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, Math.round(to))) });
    add({ type: "raise", to: la.maxRaiseTo });
  }
  return out;
}

/** candidates() for the seat on the clock in a state. Throws if the hand is over. */
export function candidatesAt(s: HandState): Candidate[] {
  const la = legalActions(s);
  if (la === null) throw new Error("The hand is over");
  return candidates(la, potTotal(s), Math.max(...s.bets), s.bigBlind);
}

/** describeAction() for the seat on the clock in a state. */
export function describeActionAt(s: HandState, action: Action): Candidate {
  const la = legalActions(s);
  if (la === null) throw new Error("The hand is over");
  return describeAction(action, la, potTotal(s), s.bigBlind);
}
