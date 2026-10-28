// The "why" behind a graded decision: one or two plain sentences that name the concept and link the
// lesson that teaches it. Pure text over a GradeResult (see ev.ts for what each number means).
//
// The concept follows the numbers of the option being explained (or of the best option, when the
// explained one lost to a bet or raise it should have made; the sentence then opens by naming that
// option: "Raising to 24.7 bb was better: …"):
//   call / fold, facing a bet:   heads-up on the river with a hand below 80% → bluff-catching (module 8):
//                                equity vs the betting range against requiredEquity; otherwise pot odds
//                                (module 3), with the call's showdown equity. Folding when the call is +EV
//                                stays a pot-odds lesson even if a raise was better still.
//   bet / raise / all-in:        P = pot before the decision, f = the next bot's immediate fold rate
//                                (multiway: P(everyone folds)). If the option wins ≥ 50% of the pots that
//                                reach showdown → value betting (module 7): you get called by worse. If the
//                                hero is ahead now (≥ 50%) but not when called, and the option does no
//                                better than the best of check / call / fold → value betting too: worse
//                                hands fold. Otherwise → fold equity (module 8): alpha = B / (P + B), the fold rate a pure
//                                bluff of B needs, against f (it breaks even when f·P = (1 − f)·B). B = to − heroStreetBet,
//                                the chips the hero adds (postflop first bet: to; preflop big blind: to − bigBlind;
//                                facing a bet, P already includes the bot's bet and the hero's own chips in).
//   check:                       explained through the best bet: if it was a clear mistake not to bet, the
//                                bet's own reason; else why betting is not better: with ≥ 50% equity, worse
//                                hands don't call (value betting); below, the bluff doesn't get enough folds.
// Second sentence: a blocker note when the hero's cards remove a lot of a heads-up bot's range
// (blockedShare ≥ 1.3 × uniformShare and at least 2.5 points more), else, for an inaccuracy or worse, the EV
// of whichever of the explained and best options the first sentence did not state.
// A caveat accompanies results whose model is "ev-now": before the river the EVs assume the hand checks
// down after this street (equity realization, module 4); on the river they are sampled estimates.
//
// Numbers: percents with one decimal ("28.6%"), EVs in bb with one decimal and a sign ("+3.2 bb",
// "−0.4 bb", real minus sign). Near-ties (tier best or correct) are never called errors.

import { formatBb } from "./candidates";
import type { GradedOption, GradeResult, Tier } from "./types";

export type ConceptId =
  | "pot-odds"
  | "bluff-catching"
  | "fold-equity"
  | "value-betting"
  | "blockers"
  | "equity-realization"
  | "ranges";

export interface LessonRef {
  slug: string;
  module: number;
  title: string;
  /** Exact "## " heading text of the section in content/NN-slug.mdx. */
  section: string;
}

export const CONCEPTS: Readonly<Record<ConceptId, { name: string; lesson: LessonRef }>> = {
  "pot-odds": {
    name: "Pot odds",
    lesson: { slug: "pot-odds", module: 3, title: "Pot odds & EV", section: "The equity a call needs" },
  },
  "bluff-catching": {
    name: "Bluff-catching",
    lesson: { slug: "exploitation", module: 8, title: "Exploitation", section: "The EV of calling a bluff-catcher" },
  },
  "fold-equity": {
    name: "Fold equity",
    lesson: { slug: "exploitation", module: 8, title: "Exploitation", section: "The EV of a bluff" },
  },
  "value-betting": {
    name: "Value betting",
    lesson: { slug: "postflop", module: 7, title: "Postflop", section: "The continuation bet, and two shapes of betting range" },
  },
  blockers: {
    name: "Blockers",
    lesson: { slug: "combinatorics", module: 1, title: "Combinatorics", section: "Card removal" },
  },
  "equity-realization": {
    name: "Equity realization",
    lesson: { slug: "equity", module: 4, title: "Equity & ranges", section: "Equity realization" },
  },
  ranges: {
    name: "Equity vs a range",
    lesson: { slug: "equity", module: 4, title: "Equity & ranges", section: "Why you play against ranges, not hands" },
  },
};

export interface Why {
  concept: ConceptId;
  lesson: LessonRef;
  /** One or two sentences. */
  sentences: string[];
  /** E.g. "Best: +3.2 bb", "Correct: +2.9 bb, 0.3 bb behind Call (3.3 bb)", "Mistake: −2.4 bb (11.0% of the pot) vs Call (3.3 bb)". */
  verdict: string;
  /** Present iff result.model is "ev-now". */
  caveat: string | null;
  /** Further concepts the sentences or caveat touch ("blockers", "equity-realization"). */
  also: ConceptId[];
}

/** Thresholds for the concept choice (see the header). */
export const WHY_THRESHOLDS = { bluffCatchMax: 0.8, valueShowdown: 0.5, blockerRatio: 1.3, blockerMargin: 0.025 } as const;

// ---------------------------------------------------------------------------
// Formatting

const MINUS = "−";

/** A fraction as a percent with one decimal: 0.2857 → "28.6%". */
export function formatPct(x: number): string {
  return `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
}

/** Big blinds with one decimal and a sign: "+3.2 bb", "−0.4 bb", "0.0 bb". */
export function formatEvBb(bb: number): string {
  const v = Math.round(bb * 10) / 10;
  if (v === 0) return "0.0 bb";
  return `${v > 0 ? "+" : MINUS}${Math.abs(v).toFixed(1)} bb`;
}

/** Big blinds with one decimal, no sign: "6.6 bb". */
const amountBb = (bb: number): string => `${(Math.round(bb * 10) / 10).toFixed(1)} bb`;

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

const TIER_NAMES: Record<Tier, string> = { best: "Best", correct: "Correct", inaccuracy: "Inaccuracy", mistake: "Mistake", blunder: "Blunder" };

// ---------------------------------------------------------------------------

interface Ctx {
  r: GradeResult;
  bb: number;
  headsUp: boolean;
  /** "the bot" or its name; multiway "the bots". */
  who: string;
  whose: string;
  /** "the bot's range" / "the bots' ranges". */
  range: string;
  ev: (o: GradedOption) => string;
  /** "earns +3.2 bb" or "is worth −1.1 bb". */
  earns: (o: GradedOption) => string;
}

interface Primary {
  concept: ConceptId;
  text: string;
  /** Options whose EV the sentence states. */
  cites: GradedOption[];
}

/** How the passive options read as a subject. */
const PASSIVE: Partial<Record<GradedOption["kind"], string>> = { fold: "folding", check: "checking", call: "calling" };

const isAggressive = (o: GradedOption): boolean => o.kind === "bet" || o.kind === "raise" || o.kind === "allin";
const noun = (o: GradedOption): string => (o.kind === "bet" ? "the bet" : o.kind === "raise" ? "the raise" : "the all-in");
const gerund = (o: GradedOption): string => (o.kind === "bet" ? "betting" : o.kind === "raise" ? "raising" : "going all-in");

const calledWhen = (c: Ctx, o: GradedOption): string =>
  c.headsUp ? `when ${c.who} calls your ${lower(o.label)}` : `when your ${lower(o.label)} gets called`;

/** The option as a subject that opens a sentence, by its size as in its label ("Raising to 24.7 bb"), without the label's percent. */
function doing(c: Ctx, o: GradedOption): string {
  const to = o.action.type === "raise" ? formatBb(o.action.to, c.bb) : "";
  return o.kind === "bet" ? `Betting ${to}` : o.kind === "raise" ? `Raising to ${to}` : `Going all-in (${to})`;
}

/** The next bot's immediate fold rate heads-up; multiway, P(everyone folds) in the option's tree. */
function foldRate(c: Ctx, o: GradedOption): number {
  if (!c.headsUp) return o.foldEquity;
  return o.responses.reduce((s, x) => s + (x.action.type === "fold" ? x.prob : 0), 0);
}

/** Chips the hero adds with a bet or raise: the raise-to total minus what the hero already has in on this street. */
function risk(c: Ctx, o: GradedOption): number {
  if (o.action.type !== "raise") throw new Error(`${o.label} is not a bet or raise`);
  return o.action.to - c.r.heroStreetBet;
}

const isValue = (o: GradedOption): boolean => Number.isFinite(o.showdownEquity) && o.showdownEquity >= WHY_THRESHOLDS.valueShowdown;

/**
 * The reason a bet or raise earns (or loses) what it does. With `instead`, `o` is a better option than the one
 * asked about, and the sentence opens by naming it ("Raising to 24.7 bb was better: …").
 */
function aggressive(c: Ctx, o: GradedOption, instead = false): Primary {
  const lead = instead ? `${doing(c, o)} was better: ` : "";
  const when = instead ? (c.headsUp ? `when ${c.who} calls` : "when it gets called") : calledWhen(c, o);
  const it = instead ? "it" : noun(o);
  /** Opens the sentence: capitalized on its own, lower-case after the lead. */
  const open = (s: string): string => (instead ? lead + lower(s) : capital(s));
  if (isValue(o)) {
    return { concept: "value-betting", text: `${open(when)}, you win ${formatPct(o.showdownEquity)} at showdown, so ${it} ${c.earns(o)}.`, cites: [o] };
  }
  const passive = Math.max(...c.r.options.filter((x) => !isAggressive(x)).map((x) => x.ev));
  if (Number.isFinite(o.showdownEquity) && c.r.heroEquity >= 0.5 && o.ev <= passive) {
    // Ahead now but behind the hands that call, and no better than checking or calling: worse hands fold.
    return {
      concept: "value-betting",
      text: `${open("you")} have ${formatPct(c.r.heroEquity)} now, but ${when} you win only ${formatPct(o.showdownEquity)}, since worse hands fold; ${it} ${c.earns(o)}.`,
      cites: [o],
    };
  }
  const f = foldRate(c, o);
  const folder = c.headsUp ? c.who : "everyone";
  const b = risk(c, o);
  const alpha = b / (c.r.pot + b);
  const again = c.headsUp ? "it folds" : "they all fold";
  return {
    concept: "fold-equity",
    text:
      `${open("risking")} ${amountBb(b / c.bb)} to win ${amountBb(c.r.pot / c.bb)}, a bluff breaks even if ${folder} folds ${formatPct(alpha)}; ` +
      `${again} ${f < alpha ? "only " : ""}${formatPct(f)}, so ${it} ${c.earns(o)}.`,
    cites: [o],
  };
}

/** Call or fold, from the call's numbers. */
function facingBet(c: Ctx, o: GradedOption, call: GradedOption): Primary {
  const { r } = c;
  const req = r.requiredEquity!;
  const tail = o.kind === "fold" ? (call.ev > 0 ? " and folding gives that up" : " and folding costs nothing") : "";
  if (c.headsUp && r.street === "river" && r.heroEquity < WHY_THRESHOLDS.bluffCatchMax) {
    return {
      concept: "bluff-catching",
      text: `On the river you win ${formatPct(r.heroEquity)} against ${c.whose} betting range and a call needs ${formatPct(req)}, so calling ${c.earns(call)}${tail}.`,
      cites: o.kind === "fold" ? [call, o] : [call],
    };
  }
  const e = Number.isFinite(call.showdownEquity) ? call.showdownEquity : r.heroEquity;
  const link = (e >= req) === (call.ev >= 0) ? "so" : "and";
  return {
    concept: "pot-odds",
    text:
      `You needed ${formatPct(req)} equity to call; against ${c.headsUp ? "this range" : "these ranges"} you have ` +
      `${e < req ? "only " : ""}${formatPct(e)}, ${link} calling ${c.earns(call)}${tail}.`,
    cites: o.kind === "fold" ? [call, o] : [call],
  };
}

/** Checking, explained through the best bet (`bet`). */
function checking(c: Ctx, o: GradedOption, bet: GradedOption): Primary {
  const { r } = c;
  if (bet.ev > o.ev && (o.tier === "inaccuracy" || o.tier === "mistake" || o.tier === "blunder")) return aggressive(c, bet, true);
  const verb = o.ev >= bet.ev ? "beats" : "is about as good as";
  const versus = `checking (${c.ev(o)}) ${verb} ${gerund(bet)} (${c.ev(bet)})`;
  if (r.heroEquity >= 0.5 && Number.isFinite(bet.showdownEquity)) {
    const sd = bet.showdownEquity;
    const when = calledWhen(c, bet);
    return {
      concept: "value-betting",
      text: `You have ${formatPct(r.heroEquity)} against ${c.range}, but ${when} you win ${sd < r.heroEquity ? "only " : ""}${formatPct(sd)}, so ${versus}.`,
      cites: [o, bet],
    };
  }
  const f = foldRate(c, bet);
  const folder = c.headsUp ? c.who : "everyone";
  const b = risk(c, bet);
  const alpha = b / (r.pot + b);
  return {
    concept: "fold-equity",
    text: `A bluff with ${lower(bet.label)} needs ${folder} to fold ${formatPct(alpha)}; ${c.headsUp ? "it folds" : "they all fold"} ${f < alpha ? "only " : ""}${formatPct(f)}, so ${versus}.`,
    cites: [o, bet],
  };
}

function verdictOf(r: GradeResult, o: GradedOption, index: number, bb: number): string {
  const name = TIER_NAMES[o.tier];
  if (index === r.best) return `${name}: ${formatEvBb(o.evBb)}`;
  const best = r.options[r.best];
  if (o.tier === "best" || o.tier === "correct") return `${name}: ${formatEvBb(o.evBb)}, ${amountBb(o.loss / bb)} behind ${best.label}`;
  return `${name}: ${formatEvBb(-o.loss / bb)} (${formatPct(o.lossPct)} of the pot) vs ${best.label}`;
}

/**
 * Explains option `index` (default: the chosen option, else the best) of a graded decision.
 * `personaNames[seat]`, when given, names a heads-up bot in the sentences (default "the bot").
 */
export function explain(result: GradeResult, index?: number, context?: { personaNames?: (string | null)[] }): Why {
  const r = result;
  const i = index ?? r.chosen ?? r.best;
  const o = r.options[i];
  if (!o) throw new Error(`No option ${i}`);
  const bb = r.bigBlind;
  const headsUp = r.ranges.length === 1;
  const name = headsUp ? context?.personaNames?.[r.ranges[0].seat] ?? null : null;
  const who = headsUp ? name ?? "the bot" : "the bots";
  const c: Ctx = {
    r,
    bb,
    headsUp,
    who,
    whose: headsUp ? `${who}'s` : "the bots'",
    range: headsUp ? `${who}'s range` : "the bots' ranges",
    ev: (x) => formatEvBb(x.evBb),
    earns: (x) => (Math.round(x.evBb * 10) > 0 ? `earns ${formatEvBb(x.evBb)}` : `is worth ${formatEvBb(x.evBb)}`),
  };
  const best = r.options[r.best];
  const lost = o.tier === "inaccuracy" || o.tier === "mistake" || o.tier === "blunder";
  const call = r.options.find((x) => x.kind === "call");
  const bets = r.options.filter(isAggressive);
  const topBet = bets.length > 0 ? bets.reduce((a, x) => (x.ev > a.ev ? x : a)) : null;

  let p: Primary;
  if (isAggressive(o)) p = aggressive(c, o);
  else if (o.kind === "check") {
    p = topBet
      ? checking(c, o, topBet)
      : { concept: "ranges", text: `You have ${formatPct(r.heroEquity)} against ${c.range}, and checking ${c.earns(o)}.`, cites: [o] };
  } else if (call && r.requiredEquity !== null) {
    const foldWithPlusCall = o.kind === "fold" && call.ev > 0;
    p = lost && isAggressive(best) && !foldWithPlusCall ? aggressive(c, best, true) : facingBet(c, o, call);
  } else p = aggressive(c, best, best !== o);

  const sentences = [p.text];
  const also: ConceptId[] = [];
  const blocker = headsUp ? r.blockers.find((x) => x.seat === r.ranges[0].seat) : undefined;
  if (
    blocker &&
    blocker.blockedShare >= WHY_THRESHOLDS.blockerRatio * blocker.uniformShare &&
    blocker.blockedShare - blocker.uniformShare >= WHY_THRESHOLDS.blockerMargin
  ) {
    sentences.push(
      `Blockers matter here: ${formatPct(blocker.blockedShare)} of ${c.whose} likely hands use one of your cards, against ${formatPct(blocker.uniformShare)} for a random range.`,
    );
    also.push("blockers");
  } else if (lost) {
    const missing = [o, best].filter((x) => !p.cites.includes(x));
    if (missing.length > 0) {
      const said = missing.map((x) => `${PASSIVE[x.kind] ?? lower(x.label)} ${c.earns(x)}`).join(" and ");
      sentences.push(`${capital(said)}.`);
    }
  }

  let caveat: string | null = null;
  if (r.model === "ev-now") {
    if (r.street === "river") caveat = "These EVs are estimates from sampled bot hands, so small gaps between options may be noise.";
    else {
      caveat = "These EVs assume the hand checks down after this street; later betting changes how much of your equity you realize.";
      also.push("equity-realization");
    }
  }

  return { concept: p.concept, lesson: CONCEPTS[p.concept].lesson, sentences, verdict: verdictOf(r, o, i, bb), caveat, also };
}
