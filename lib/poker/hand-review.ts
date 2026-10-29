// The end-of-hand review for the result popup: a headline, one "why" line, every hand shown down, and a
// verdict on how lucky the result was (your equity when the last chips went in).
//
// Both tables can build the input: `reviewInputFromEngine` (solo HandState) and `reviewInputFromPublic`
// (a friends table's HandResultPublic plus PublicHand.actions). Decisions:
// - Headline amounts are the hero's net for the hand (what the stack changed by), not the pot collected.
// - Split: the hero shared a pot and won none alone. Headline `SPLIT POT, +n` (`SPLIT POT, EVEN` at 0); with a
//   negative net it reads `YOU LOST n`. A split is neither a win nor a loss for the verdict, so it can only be
//   COIN FLIP or AS EXPECTED.
// - Won / lost otherwise: net > 0 / net < 0 (side pots included: winning the main pot but losing a bigger
//   side pot is a loss).
// - Verdict equity is the hero against every revealed hand on the board of the street the last chips were
//   matched (two or more seats with chips in once uncalled chips are returned; see chipsInStreet), and never
//   later than the street the hero went all-in, whichever pots those hands were in. Exact enumeration on every street: a heads-up
//   preflop all-in (1.7M runouts) takes ~35-45 ms here, under the plan's 50 ms bar for falling back to Monte Carlo.
// - Thresholds use the whole percent shown in the text, so the label always matches the number.
//   Precedence: BAD BEAT > LUCKY WIN > COOLER > COIN FLIP > AS EXPECTED (AHEAD / BEHIND).

import type { HandState, Street } from "../engine/engine";
import type { HandResultPublic, PublicAction } from "../multiplayer/protocol";
import { parseCard, type Card } from "./cards";
import { exactEquity } from "./equity";
import { evaluate, handCategoryIndex } from "./evaluator";
import { nameHand } from "./hand-read";

export interface ReviewAction {
  seat: number;
  street: Street;
  action: "fold" | "check" | "call" | "bet" | "raise";
  /** Chips moved into the pot by this action. */
  amount: number;
  allIn: boolean;
}

export interface ReviewInput {
  heroSeat: number;
  /** Display names by seat (the hero always reads YOU). A missing seat reads `S1`, `S2`.. (1-based). */
  names: Readonly<Record<number, string>>;
  /** The final board. */
  board: readonly Card[];
  /** True when two or more players reached showdown. */
  showdown: boolean;
  /** Hands shown down, the hero's included when the hero reached showdown. Empty without a showdown. */
  revealed: readonly { seat: number; cards: readonly Card[] }[];
  /** Voluntary actions in order (blinds are not actions). */
  actions: readonly ReviewAction[];
  pots: readonly { amount: number; winners: readonly number[]; shares: readonly number[] }[];
  /** Net chips per dealt-in seat. */
  net: readonly { seat: number; amount: number }[];
}

export type VerdictKind = "BAD_BEAT" | "LUCKY_WIN" | "COOLER" | "COIN_FLIP" | "AHEAD" | "BEHIND";

export interface Verdict {
  kind: VerdictKind;
  /** `LUCKY WIN: YOU HAD 19% WHEN THE CHIPS WENT IN ON THE TURN`. */
  text: string;
  /** Hero's equity (pot share, 0..1) against the revealed hands on that street's board. */
  equity: number;
  /** The street the last chips were matched, capped at the hero's all-in street (see chipsInStreet). */
  street: Street;
}

export interface ShownHand {
  seat: number;
  /** `YOU` for the hero. */
  name: string;
  cards: Card[];
  /** `FLUSH, ACE HIGH` (see `nameHand`). */
  hand: string;
}

export interface HandReview {
  /** `YOU WON 1,240`, `YOU LOST 600`, `SPLIT POT, +120`, `YOU FOLDED ON THE FLOP`. */
  headline: string;
  /** `YOUR FLUSH, ACE HIGH BEAT JOSEF'S STRAIGHT, TEN HIGH`, `EVERYONE FOLDED TO YOUR TURN BET`, `YOU FOLDED ON THE FLOP; S2 TOOK 400`. */
  why: string;
  /** Every hand shown down, the hero's first, then by seat. */
  shown: ShownHand[];
  /** Only when the hero reached showdown against at least one revealed hand. */
  verdict: Verdict | null;
}

const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");
const BOARD_AT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
/** `PREFLOP`, `ON THE FLOP`. */
const onStreet = (s: Street): string => (s === "preflop" ? "PREFLOP" : `ON THE ${s.toUpperCase()}`);

export function reviewHand(input: ReviewInput): HandReview {
  const { heroSeat: hero, actions, pots } = input;
  const name = (seat: number): string => (seat === hero ? "YOU" : (input.names[seat] ?? `S${seat + 1}`).toUpperCase());
  const net = input.net.find((n) => n.seat === hero)?.amount ?? 0;

  const shown: ShownHand[] = [...input.revealed]
    .sort((a, b) => (a.seat === hero ? -1 : b.seat === hero ? 1 : a.seat - b.seat))
    .map((r) => ({ seat: r.seat, name: name(r.seat), cards: [...r.cards], hand: nameHand([...r.cards, ...input.board]) }));

  // Folded: the headline says where, the why line who took the chips.
  const fold = actions.find((a) => a.seat === hero && a.action === "fold");
  if (fold) {
    const took = new Map<number, number>();
    for (const p of pots) p.winners.forEach((w, i) => took.set(w, (took.get(w) ?? 0) + p.shares[i]));
    const takers = [...took].map(([seat, amount]) => `${name(seat)} TOOK ${fmt(amount)}`).join(", ");
    return { headline: `YOU FOLDED ${onStreet(fold.street)}`, why: `YOU FOLDED ${onStreet(fold.street)}; ${takers}`, shown, verdict: null };
  }

  const split = pots.some((p) => p.winners.includes(hero) && p.winners.length > 1) && !pots.some((p) => p.winners.length === 1 && p.winners[0] === hero);
  const headline = split && net >= 0
    ? `SPLIT POT, ${net === 0 ? "EVEN" : `+${fmt(net)}`}`
    : net > 0
      ? `YOU WON ${fmt(net)}`
      : net < 0
        ? `YOU LOST ${fmt(-net)}`
        : "YOU BROKE EVEN";

  const heroShown = input.revealed.find((r) => r.seat === hero);
  if (!input.showdown || !heroShown) {
    return { headline, why: uncontested(actions, hero), shown, verdict: null };
  }

  // Showdown: the best hand that beat you, else a hand you tied, else the best hand you beat.
  const value = (r: { cards: readonly Card[] }) => evaluate([...r.cards, ...input.board]);
  const heroValue = value(heroShown);
  const opponents = input.revealed.filter((r) => r.seat !== hero).map((r) => ({ ...r, value: value(r) }));
  const heroHand = shown[0].hand;
  const handOf = (seat: number) => shown.find((s) => s.seat === seat)!.hand;
  const best = (list: typeof opponents) => list.reduce((a, b) => (b.value > a.value ? b : a));
  const kicker = (other: string) => (other === heroHand ? " ON THE KICKER" : "");
  const better = opponents.filter((o) => o.value > heroValue);
  const tied = opponents.filter((o) => o.value === heroValue);
  let why: string;
  if (better.length > 0) {
    const o = best(better);
    why = `${name(o.seat)}'S ${handOf(o.seat)} BEAT YOUR ${heroHand}${kicker(handOf(o.seat))}`;
  } else if (tied.length > 0) {
    why = `YOUR ${heroHand} TIES ${name(tied[0].seat)}'S ${handOf(tied[0].seat)}`;
  } else {
    const o = best(opponents);
    why = `YOUR ${heroHand} BEAT ${name(o.seat)}'S ${handOf(o.seat)}${kicker(handOf(o.seat))}`;
  }

  const outcome = split || net === 0 ? "split" : net > 0 ? "won" : "lost";
  const tripsOrBetter = handCategoryIndex(heroValue) >= 3;
  return { headline, why, shown, verdict: verdict(input, heroShown.cards, opponents, outcome, tripsOrBetter) };
}

/** Why the hero won without a showdown: `EVERYONE FOLDED TO YOUR TURN BET`. */
function uncontested(actions: readonly ReviewAction[], hero: number): string {
  const mine = actions.filter((a) => a.seat === hero);
  if (mine.length === 0) return "EVERYONE FOLDED TO YOUR BIG BLIND";
  const last = mine[mine.length - 1];
  if (last.action !== "bet" && last.action !== "raise") return "EVERYONE ELSE FOLDED";
  const verb = last.allIn ? "ALL-IN" : last.action === "bet" ? "BET" : "RAISE";
  return `EVERYONE FOLDED TO YOUR ${last.street.toUpperCase()} ${verb}`;
}

function verdict(
  input: ReviewInput,
  heroCards: readonly Card[],
  opponents: readonly { cards: readonly Card[] }[],
  outcome: "won" | "lost" | "split",
  tripsOrBetter: boolean,
): Verdict | null {
  if (opponents.length === 0) return null;
  const street = chipsInStreet(input.actions, input.heroSeat);
  const board = input.board.slice(0, BOARD_AT[street]);
  const equity = exactEquity([heroCards, ...opponents.map((o) => o.cards)], board).players[0].equity;
  const pct = Math.round(equity * 100);
  const when = `WHEN THE CHIPS WENT IN ${onStreet(street)}`;
  const had = `YOU HAD ${pct}% ${when}`;

  const kind = classifyVerdict(outcome, pct, tripsOrBetter);
  const text: Record<VerdictKind, string> = {
    BAD_BEAT: `BAD BEAT: ${had}`,
    LUCKY_WIN: `LUCKY WIN: ${had}`,
    COOLER: `COOLER: ${had}`,
    COIN_FLIP: `COIN FLIP: ${had}`,
    AHEAD: `AS EXPECTED: YOU WERE AHEAD (${pct}%) ${when}`,
    BEHIND: `AS EXPECTED: THEY WERE AHEAD (YOU HAD ${pct}%) ${when}`,
  };
  return { kind, text: text[kind], equity, street };
}

/**
 * The street the last chips were matched: the last street on which, once the uncalled part of the biggest
 * contribution is returned, two or more seats still have chips in (preflop by default, as the blinds are not
 * actions). Capped at the street the hero went all-in; preflop when the hero has no actions at all, since a
 * hero at showdown without acting can only have gone all-in posting a blind.
 */
function chipsInStreet(actions: readonly ReviewAction[], hero: number): Street {
  const mine = actions.filter((a) => a.seat === hero);
  if (mine.length === 0) return "preflop";
  let street: Street = "preflop";
  for (const s of ["flop", "turn", "river"] as const) {
    // Only the biggest contribution can have an uncalled part, and it is cut to the second biggest: chips stay
    // matched whenever two or more seats put chips in.
    const seats = new Set(actions.filter((a) => a.street === s && a.amount > 0).map((a) => a.seat));
    if (seats.size >= 2) street = s;
  }
  const allIn = mine.find((a) => a.allIn);
  return allIn && BOARD_AT[allIn.street] < BOARD_AT[street] ? allIn.street : street;
}

/**
 * The verdict for an outcome and the hero's whole-percent equity, first match wins: BAD BEAT (lost, >= 70),
 * LUCKY WIN (won, <= 30), COOLER (lost holding three of a kind or better), COIN FLIP (40-60), AHEAD (> 60), BEHIND.
 */
export function classifyVerdict(outcome: "won" | "lost" | "split", pct: number, tripsOrBetter: boolean): VerdictKind {
  if (outcome === "lost" && pct >= 70) return "BAD_BEAT";
  if (outcome === "won" && pct <= 30) return "LUCKY_WIN";
  if (outcome === "lost" && tripsOrBetter) return "COOLER";
  if (pct >= 40 && pct <= 60) return "COIN_FLIP";
  return pct > 60 ? "AHEAD" : "BEHIND";
}

// ---------------------------------------------------------------------------
// Adapters

/** Solo table: a complete engine hand. */
export function reviewInputFromEngine(state: HandState, heroSeat: number, names: Readonly<Record<number, string>>): ReviewInput {
  const result = state.result;
  if (!result) throw new Error("The hand is not complete");
  const actions: ReviewAction[] = [];
  const revealed: { seat: number; cards: Card[] }[] = [];
  for (const e of state.events) {
    if (e.type === "action") actions.push({ seat: e.seat, street: e.street, action: e.action, amount: e.amount, allIn: e.allIn });
    else if (e.type === "showdown") revealed.push({ seat: e.seat, cards: e.cards });
  }
  return {
    heroSeat,
    names,
    board: state.board,
    showdown: result.showdown,
    revealed,
    actions,
    pots: result.pots,
    net: result.net.map((amount, seat) => ({ seat, amount })),
  };
}

/** Friends table: the hand's result plus its public action list. */
export function reviewInputFromPublic(
  result: HandResultPublic,
  actions: readonly PublicAction[],
  heroSeat: number,
  names: Readonly<Record<number, string>>,
): ReviewInput {
  return {
    heroSeat,
    names,
    board: result.board.map(parseCard),
    showdown: result.showdown,
    revealed: result.revealed.map((r) => ({ seat: r.seat, cards: r.cards.map(parseCard) })),
    actions: actions.map((a) => ({ seat: a.seat, street: a.street, action: a.action, amount: a.amount, allIn: a.allIn })),
    pots: result.pots,
    net: result.net,
  };
}
