// Style posterior: which of the six bot personas a player plays most like. See README.md.
//
// For one hand and one seat, the likelihood of the seat's actions under persona p is
//
//   L_p = (1/|C|) Σ_{c ∈ C} Π_d q_p(a_d | c)            (cards not shown)
//   L_p = Π_d q_p(a_d | c*)                               (cards c* shown at showdown)
//
// where C is every combo that uses no final-board card and no card the observer knows (its own hole
// cards and any other seat's shown cards), d runs over the seat's decisions (rebuilt from the public
// history with replay), and q_p(a | c) is the probability that p, holding c, takes the observed engine
// action a at that decision:
//
//   q_p(a | c) = (1 − ε) Σ_{x ∈ M_p(a)} P_p(x | c) + ε / K_p
//
// - P_p(x | c) is persona p's probability of abstract action x (comboDistribution, the row strategyAt
//   returns). M_p(a) is every abstract action whose concrete action under p is the one nearest to a:
//   the same action if p has it (several abstract actions can map to one engine action, exactly as in
//   inferRange), otherwise, for a bet or raise of an odd size, p's bet or raise with the closest raise-to
//   total in chips (ties to the smaller). So a human's 2.2x open counts as p's open, whatever p's size.
// - The observer's own seat (hand.observer) counts as shown: c* is its known hole cards, which are
//   dead cards for every other seat.
// - ε is a tremble (default 1%): with probability ε the player picks uniformly among p's K_p distinct
//   legal engine actions. It keeps one action that p never takes from zeroing p for good; with ε = 0
//   and actions p does take, the combo weights Π_d q_p(a_d | c) are exactly inferRange's (normalized).
//
// It ignores what other unshown players' actions say about their cards (card removal), as inferRange
// does. Hands are independent, so log-likelihoods add up across hands; with a uniform prior over the
// six personas, P(p | hands) ∝ exp(Σ log L_p). For a person this is the closest of six styles, not a
// claim that they play like any of them.

import type { Action } from "../../engine/engine";
import { FULL_DECK } from "../../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO, comboIndex } from "../../poker/combinatorics";
import { PERSONA_IDS, PERSONAS, type Persona, type PersonaId } from "../../bots/personas";
import { ACTION_COUNT, analyzeSpot, comboDistribution, sameAction, type Spot } from "../../bots/policy";
import { replay, type Decision } from "../../bots/view";
import { finalBoard, historyOf, shownCards, type ObservedHand } from "./hand";

export const DEFAULT_EPSILON = 0.01;

/** Abstract actions whose concrete action under the spot's persona is the nearest match to `action`. */
export function nearestActions(spot: Spot, action: Action): number[] {
  const exact: number[] = [];
  for (let a = 0; a < ACTION_COUNT; a++) {
    const c = spot.concrete[a];
    if (c && sameAction(c, action)) exact.push(a);
  }
  if (exact.length > 0 || action.type !== "raise") return exact;
  // An odd size: the persona's raise-to total closest in chips (ties to the smaller one).
  let nearest = -1;
  for (const c of spot.concrete) {
    if (c?.type !== "raise") continue;
    const d = Math.abs(c.to - action.to), best = Math.abs(nearest - action.to);
    if (nearest < 0 || d < best || (d === best && c.to < nearest)) nearest = c.to;
  }
  return spot.concrete.flatMap((c, a) => (c?.type === "raise" && c.to === nearest ? [a] : []));
}

/** Number of distinct legal engine actions among the spot's abstract actions. */
export function distinctActions(spot: Spot): number {
  const seen: Action[] = [];
  for (const c of spot.concrete) if (c && !seen.some((s) => sameAction(s, c))) seen.push(c);
  return seen.length;
}

/** The seat's decisions in the hand (views rebuilt from the public history). */
export const handDecisions = (hand: ObservedHand): Decision[] => replay(historyOf(hand)).decisions;

/**
 * Cards that cannot be in `seat`'s hand: the final board, the observer's known cards (unless `seat` is
 * the observer), other seats' shown cards.
 */
export function deadCards(hand: ObservedHand, seat: number): number[] {
  const dead = [...finalBoard(hand), ...(seat === hand.observer ? [] : (hand.known ?? []))];
  shownCards(hand).forEach((cards, s) => {
    if (cards && s !== seat) dead.push(...cards);
  });
  return dead;
}

/** The seat's hole cards when they are known: shown at showdown, or the observer's own; else null. */
export function knownHoleCards(hand: ObservedHand, seat: number): readonly number[] | null {
  const shown = shownCards(hand)[seat];
  if (shown) return shown;
  return seat === hand.observer && hand.known?.length === 2 ? hand.known : null;
}

/**
 * Π_d q_p(a_d | c) for every combo c (0 for combos using a dead card): the unnormalized posterior over
 * the seat's hole cards under persona p, before using any shown cards.
 */
export function comboWeights(
  persona: Persona,
  decisions: readonly Decision[],
  seat: number,
  dead: readonly number[],
  epsilon: number = DEFAULT_EPSILON,
): Float64Array {
  const isDead = new Uint8Array(52);
  for (const c of dead) isDead[c] = 1;
  const w = new Float64Array(COMBO_COUNT);
  for (let c = 0; c < COMBO_COUNT; c++) if (!isDead[COMBO_HI[c]] && !isDead[COMBO_LO[c]]) w[c] = 1;
  for (const d of decisions) {
    if (d.seat !== seat) continue;
    const spot = analyzeSpot(persona, d.view);
    const match = nearestActions(spot, d.action);
    const tremble = epsilon / distinctActions(spot);
    for (let c = 0; c < COMBO_COUNT; c++) {
      if (w[c] === 0) continue;
      const dist = comboDistribution(spot, c);
      let p = 0;
      for (const a of match) p += dist[a];
      w[c] *= (1 - epsilon) * p + tremble;
    }
  }
  return w;
}

/** log L_p for each persona (in PERSONA_IDS order) for one seat of one hand. */
export function styleLogLikelihoods(
  hand: ObservedHand,
  seat: number,
  epsilon: number = DEFAULT_EPSILON,
  decisions: readonly Decision[] = handDecisions(hand),
): number[] {
  if (!decisions.some((d) => d.seat === seat)) return PERSONA_IDS.map(() => 0);
  const dead = deadCards(hand, seat);
  const shown = knownHoleCards(hand, seat);
  const shownCombo = shown ? comboIndex(shown[0], shown[1]) : -1;
  return PERSONA_IDS.map((id) => {
    // Shown (or the observer's own cards): every other card is "dead", so only that combo is computed.
    const w = comboWeights(PERSONAS[id], decisions, seat, shown ? FULL_DECK.filter((c) => !shown.includes(c)) : dead, epsilon);
    if (shown) return Math.log(w[shownCombo]);
    let sum = 0;
    for (let c = 0; c < COMBO_COUNT; c++) sum += w[c];
    return Math.log(sum / liveCount(dead));
  });
}

function liveCount(dead: readonly number[]): number {
  const isDead = new Uint8Array(52);
  for (const c of dead) isDead[c] = 1;
  let live = 0;
  for (let c = 0; c < COMBO_COUNT; c++) if (!isDead[COMBO_HI[c]] && !isDead[COMBO_LO[c]]) live++;
  return live;
}

/** Posterior over the personas from summed log-likelihoods, uniform prior. */
export function stylePosterior(logLik: readonly number[]): Record<PersonaId, number> {
  const max = Math.max(...logLik);
  const w = logLik.map((x) => Math.exp(x - max));
  const total = w.reduce((a, b) => a + b, 0);
  return Object.fromEntries(PERSONA_IDS.map((id, i) => [id, w[i] / total])) as Record<PersonaId, number>;
}

export const STYLE_NAMES: Readonly<Record<PersonaId, string>> = {
  nit: "a nit",
  tag: "a tight-aggressive regular (TAG)",
  lag: "a loose-aggressive player (LAG)",
  station: "a calling station",
  maniac: "a maniac",
  micro: "a loose-passive low-stakes regular",
};

/** The most likely style first. */
export function rankStyles(posterior: Readonly<Record<PersonaId, number>>): { style: PersonaId; probability: number }[] {
  return PERSONA_IDS.map((style) => ({ style, probability: posterior[style] })).sort((a, b) => b.probability - a.probability);
}

/** "After 40 hands: 93% that Bob plays closest to a calling station (the closest of six bot styles, ...)." */
export function describeStyle(posterior: Readonly<Record<PersonaId, number>>, hands: number, name: string): string {
  const [top] = rankStyles(posterior);
  return (
    `After ${hands} hand${hands === 1 ? "" : "s"}: ${Math.round(100 * top.probability)}% that ${name} plays closest to ${STYLE_NAMES[top.style]} ` +
    `(the closest of six bot styles; a person may not play exactly like any of them).`
  );
}
