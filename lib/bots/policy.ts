// The baseline policy: an explicit mixed strategy over a small set of abstract actions. See README.md.
//
//   const spot = analyzeSpot(persona, view);              // public facts about the decision
//   const p = comboDistribution(spot, combo);             // Float64Array over ABSTRACT_ACTIONS, sums to 1
//   const s = strategyAt(persona, view);                  // the same for all 1,326 combos at once
//   const d = chooseAction(persona, botView, rng);        // sample one action: the only random step
//
// Everything except chooseAction is a pure, deterministic function of (persona, public view, combo).
// How an abstract action becomes chips (spot.concrete) depends only on the public view and the persona,
// never on the combo, so the probability of an observed engine action is a sum over abstract actions,
// which is what range inference (range.ts) relies on.

import { STREETS, type Action, type LegalActions, type Street } from "../engine/engine";
import type { Card, Rng } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO, comboIndex } from "../poker/combinatorics";
import { boardInfo, drawOf, type BoardInfo, type Draw } from "./features";
import type { ByStreet, OpenPosition, Persona } from "./personas";
import { IS_THREE_BET_BLUFF, PREFLOP_PCT } from "./preflop";
import type { BotView, Position, PublicView } from "./view";

/**
 * fold / check / call; bet33, bet66, bet100 = bet that share of the pot when nobody has bet this street;
 * raise = the standard raise for the spot (open, isolate, 3-bet, 4-bet preflop; 3x the bet postflop);
 * allin. A size that would commit 45% or more of the stack becomes the all-in.
 */
export const ABSTRACT_ACTIONS = ["fold", "check", "call", "bet33", "bet66", "bet100", "raise", "allin"] as const;
export type AbstractAction = (typeof ABSTRACT_ACTIONS)[number];
export const ACTION_COUNT = ABSTRACT_ACTIONS.length;

const FOLD = 0, CHECK = 1, CALL = 2, BET33 = 3, RAISE = 6, ALLIN = 7;
const BET_FRACTIONS = [0.33, 0.66, 1];
/** A bet or raise that would put in this share of the stack (raise-to over max raise-to) goes all-in. */
const JAM_SHARE = 0.45;
/** Width of the logistic steps on strength thresholds: smaller is a sharper, less mixed strategy. */
const TEMPERATURE = 0.035;

/** Public facts about one decision, shared by every combo. */
export interface Spot {
  /** The persona whose decision this is. */
  persona: Persona;
  view: PublicView;
  legal: LegalActions;
  street: Street;
  /** 0 preflop .. 3 river. */
  streetIndex: number;
  position: Position;
  /** Live opponents (not folded, all-in or not). */
  opponents: number;
  /** In position: acts after the last raiser preflop, or last among live players postflop. */
  ip: boolean;
  /** Raises this street (preflop: voluntary raises, so 1 = an open, 2 = a 3-bet). */
  raises: number;
  /** Preflop calls before the first raise. */
  limpers: number;
  /** Calls since the last raise this street. */
  callers: number;
  /** The acting seat has raised (bet) this street already. */
  heroRaised: boolean;
  /** Bets plus raises this street (postflop: 2 means a bet was raised). */
  streetBets: number;
  /** Made the last bet or raise of the previous street (preflop raiser on the flop). */
  aggressor: boolean;
  /** Facing a bet: how many streets in a row (counting this one, from the flop) the bettor has bet. */
  barrels: number;
  /** Required equity to call: toCall / (pot + toCall). */
  price: number;
  /** Postflop board features (null preflop). */
  board: BoardInfo | null;
  /** The engine action each abstract action maps to here, or null where it is not legal. */
  concrete: (Action | null)[];
}

const orderFromButton = (seat: number, view: PublicView): number => (seat - view.button - 1 + view.seatCount) % view.seatCount;

/**
 * Everything about a decision that does not depend on the bot's cards. The view's seat must be on the
 * clock. The persona is needed only for its open size.
 */
export function analyzeSpot(persona: Persona, view: PublicView): Spot {
  const legal = view.legal;
  if (legal === null || view.toAct !== view.seat) throw new Error(`Seat ${view.seat} is not on the clock`);
  const seat = view.seat;
  const streetIndex = STREETS.indexOf(view.street);
  let raises = 0, limpers = 0, callers = 0, streetBets = 0, heroRaised = false;
  let lastRaiser = -1;
  const lastAggressor = [-1, -1, -1, -1];
  const betBy: boolean[][] = Array.from({ length: 4 }, () => new Array(view.seatCount).fill(false));
  for (const e of view.events) {
    if (e.type !== "action") continue;
    const si = STREETS.indexOf(e.street);
    const aggressive = e.action === "bet" || e.action === "raise";
    if (aggressive) {
      lastAggressor[si] = e.seat;
      betBy[si][e.seat] = true;
    }
    if (si !== streetIndex) continue;
    if (aggressive) {
      raises++;
      streetBets++;
      callers = 0;
      lastRaiser = e.seat;
      if (e.seat === seat) heroRaised = true;
    } else if (e.action === "call") {
      if (raises === 0) limpers++;
      callers++;
    }
  }

  let opponents = 0;
  let ip = true;
  const mine = orderFromButton(seat, view);
  for (let i = 0; i < view.seatCount; i++) {
    if (i === seat || view.folded[i]) continue;
    opponents++;
    if (streetIndex > 0 && view.stacks[i] > 0 && orderFromButton(i, view) > mine) ip = false;
  }
  if (streetIndex === 0) ip = lastRaiser < 0 ? ip : mine > orderFromButton(lastRaiser, view);

  let barrels = 0;
  if (streetIndex > 0 && legal.toCall > 0 && lastRaiser >= 0) {
    barrels = 1;
    for (let si = streetIndex - 1; si >= 1 && betBy[si][lastRaiser]; si--) barrels++;
  }

  const spot: Spot = {
    persona,
    view,
    legal,
    street: view.street,
    streetIndex,
    position: view.positions[seat],
    opponents,
    ip,
    raises,
    limpers,
    callers,
    heroRaised,
    streetBets,
    aggressor: streetIndex > 0 && lastAggressor[streetIndex - 1] === seat,
    barrels,
    price: legal.toCall / (view.pot + legal.toCall),
    board: streetIndex > 0 ? boardInfo(view.board) : null,
    concrete: [],
  };
  spot.concrete = concreteActions(persona, spot);
  return spot;
}


// ---------------------------------------------------------------------------
// Abstract -> engine actions (depends on the spot and the persona's open size, never on the combo).

function concreteActions(persona: Persona, spot: Spot): (Action | null)[] {
  const la = spot.legal;
  const out: (Action | null)[] = new Array(ACTION_COUNT).fill(null);
  if (la.canFold) out[FOLD] = { type: "fold" };
  if (la.canCheck) out[CHECK] = { type: "check" };
  if (la.canCall) out[CALL] = { type: "call" };
  if (!la.canRaise) return out;
  const fit = (to: number): Action => {
    let x = Math.round(to);
    if (x >= JAM_SHARE * la.maxRaiseTo) x = la.maxRaiseTo;
    return { type: "raise", to: Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, x)) };
  };
  if (la.isBet) BET_FRACTIONS.forEach((f, i) => (out[BET33 + i] = fit(f * spot.view.pot)));
  else out[RAISE] = fit(raiseSize(persona, spot));
  out[ALLIN] = { type: "raise", to: la.maxRaiseTo };
  return out;
}

/** Raise-to total of the "raise" action: open, isolate, 3-bet (3x in position, 4x out), 4-bet (2.3x); 3x postflop. */
function raiseSize(persona: Persona, spot: Spot): number {
  const { view } = spot;
  const bb = view.bigBlind;
  const maxBet = Math.max(...view.bets);
  if (spot.streetIndex > 0) return 3 * maxBet;
  if (spot.raises === 0) {
    const sb = spot.position === "SB" && view.seatCount > 2 ? 0.5 : 0;
    if (spot.limpers === 0 && !spot.legal.canCheck) return (persona.openSize + sb) * bb;
    return (persona.openSize + 1 + spot.limpers + sb) * bb;
  }
  const extra = spot.callers * maxBet; // squeeze: add one raise per caller
  if (spot.raises === 1) return maxBet * (spot.ip ? 3 : 4) + extra;
  if (spot.raises === 2) return maxBet * 2.3 + extra;
  return spot.legal.maxRaiseTo;
}

// ---------------------------------------------------------------------------
// The mixed strategy.

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Smooth step: 0.5 at the threshold, ~0.05 / ~0.95 one tenth below / above it. */
const step = (x: number, threshold: number): number => 1 / (1 + Math.exp(-(x - threshold) / TEMPERATURE));

/**
 * Probability that a combo at preflop percentile `pct` is inside the top `width`, with a linear fringe
 * of mixed play around the cutoff (so ranges are mixed, not hard-edged).
 */
function inTop(pct: number, width: number): number {
  if (width <= 0) return 0;
  const fringe = 0.008 + 0.08 * width;
  return clamp01((width + fringe - pct) / (2 * fringe));
}

/** The persona's action probabilities for one combo, indexed like ABSTRACT_ACTIONS. Sums to 1 over legal actions. */
export function comboDistribution(spot: Spot, combo: number): Float64Array {
  const out = new Float64Array(ACTION_COUNT);
  if (spot.streetIndex === 0) preflop(spot.persona, spot, combo, out);
  else postflop(spot.persona, spot, combo, out);
  return finalize(spot.legal, out);
}

function openWidth(p: Persona, spot: Spot): number {
  if (spot.view.seatCount === 2) return p.huOpen;
  const pos = spot.position;
  return pos === "BB" ? p.open.SB : p.open[pos as OpenPosition];
}

function preflop(p: Persona, spot: Spot, combo: number, out: Float64Array): void {
  const pct = PREFLOP_PCT[combo];
  const { view, legal } = spot;
  const blind = spot.position === "SB" || spot.position === "BB";

  if (spot.raises === 0) {
    if (legal.canCheck) {
      // Big blind in a limped pot: raise or check.
      const r = inTop(pct, 0.8 * p.isoRaise);
      out[RAISE] = r;
      out[CHECK] = 1 - r;
      return;
    }
    const sb = spot.position === "SB" ? 1.15 : 1;
    const raiseWidth = spot.limpers === 0 ? openWidth(p, spot) : p.isoRaise;
    const playWidth = spot.limpers === 0 ? p.limp * sb : Math.max(p.limp, p.isoRaise + 1.5 * p.flat) * sb;
    const r = inTop(pct, raiseWidth);
    const c = (1 - r) * inTop(pct, playWidth);
    out[RAISE] = r;
    out[CALL] = c;
    out[FOLD] = 1 - r - c;
    return;
  }

  if (spot.raises === 1 && !spot.heroRaised) {
    // Facing an open (or an isolation raise over our limp).
    const heroLimped = view.events.some((e) => e.type === "action" && e.seat === view.seat && e.street === "preflop");
    // The big blind defends wider (it has a blind in and closes the action); heads-up wider still.
    const posFactor = spot.position === "BB" ? 2.6 : spot.position === "SB" ? 0.6 : spot.ip ? 1.15 : 0.85;
    const huDefend = view.seatCount === 2 && spot.position === "BB" ? 0.35 * p.huOpen : 0;
    const raiseBb = Math.max(...view.bets) / view.bigBlind;
    const sizeFactor = Math.min(1.2, Math.max(0.3, (2.75 / raiseBb) ** 0.7));
    let flat = (p.flat * posFactor + huDefend) * sizeFactor;
    if (heroLimped) flat = Math.max(flat, 0.7 * p.limp);
    const value = inTop(pct, p.threeBet * (blind ? 0.9 : 1));
    const raise = value + (1 - value) * (IS_THREE_BET_BLUFF[combo] ? p.threeBetBluff : 0);
    const call = (1 - raise) * inTop(pct, p.threeBet + flat);
    out[RAISE] = raise;
    out[CALL] = call;
    out[FOLD] = 1 - raise - call;
    return;
  }

  if (spot.raises === 2) {
    // Facing a 3-bet: as the opener, or cold (squeezed or overcalling).
    let raise: number, call: number;
    if (spot.heroRaised) {
      const value = inTop(pct, p.fourBet);
      raise = value + (1 - value) * (IS_THREE_BET_BLUFF[combo] && pct < 0.12 ? 0.25 * p.threeBetBluff : 0);
      call = (1 - raise) * inTop(pct, p.fourBet + p.callThreeBet * (spot.ip ? 1.2 : 0.85));
    } else {
      raise = inTop(pct, 0.7 * p.fourBet);
      call = (1 - raise) * inTop(pct, 0.55 * (p.fourBet + p.callThreeBet));
    }
    out[RAISE] = raise;
    out[CALL] = call;
    out[FOLD] = 1 - raise - call;
    return;
  }

  // Facing a 4-bet or more: jam, call or fold.
  const jam = inTop(pct, p.jam);
  const call = (1 - jam) * inTop(pct, p.jam + p.callJam);
  out[ALLIN] = jam;
  out[CALL] = call;
  out[FOLD] = 1 - jam - call;
}

/** Strength a draw is worth when deciding to call, on the flop and the turn. */
const DRAW_VALUE: Record<Draw, readonly [number, number]> = {
  none: [0, 0],
  gutshot: [0.5, 0.4],
  straight: [0.68, 0.58],
  flush: [0.72, 0.62],
  combo: [0.86, 0.76],
};

/** Bet-size weights tilted toward bigger sizes (tilt > 0) or smaller ones (tilt < 0), normalized. */
function tiltSizes(sizes: ByStreet, tilt: number): [number, number, number] {
  const w = sizes.map((x, i) => x * Math.exp(1.5 * tilt * (i - 1)));
  const total = w[0] + w[1] + w[2];
  return [w[0] / total, w[1] / total, w[2] / total];
}

function postflop(p: Persona, spot: Spot, combo: number, out: Float64Array): void {
  const info = spot.board!;
  const s = info.strength[combo];
  const st = spot.streetIndex - 1; // 0 flop, 1 turn, 2 river
  const draw = drawOf(info, combo);
  const extra = Math.max(0, spot.opponents - 1);
  const valueAt = p.valueBet[st] + 0.035 * extra;
  const multiway = 0.65 ** extra;

  if (spot.legal.toCall === 0) {
    const value = step(s, valueAt);
    let base = spot.aggressor ? [p.cbet, p.barrel, p.riverBluff][st] : p.stab * (spot.ip ? 1 : 0.6);
    if (spot.aggressor && st === 0) base *= 1 - 0.35 * info.texture.wet;
    // Hands with showdown value bluff less.
    let weight = s < 0.5 ? 1 : s < valueAt - 0.1 ? 0.35 : 0.15;
    if (draw !== "none") {
      base = Math.max(base, p.semibluff * (draw === "gutshot" ? 0.5 : 1));
      weight = 1;
    }
    const bluff = (1 - value) * clamp01(base * weight * multiway);
    const wet = 0.3 * info.texture.wet;
    const valueSizes = tiltSizes(p.sizes, p.sizingTell + wet);
    const bluffSizes = tiltSizes(p.sizes, -p.sizingTell + wet / 2);
    for (let i = 0; i < 3; i++) out[BET33 + i] = value * valueSizes[i] + bluff * bluffSizes[i];
    out[CHECK] = 1 - value - bluff;
    return;
  }

  const facingRaise = spot.streetBets >= 2;
  const callAt =
    p.call[st] +
    0.9 * (spot.price - 0.25) +
    0.04 * extra +
    (facingRaise ? 0.12 : 0) +
    (spot.barrels >= 2 ? p.barrelFold : 0) +
    (st === 2 && facingRaise ? p.riverRaiseFold : 0);
  const callStrength = st < 2 ? Math.max(s, DRAW_VALUE[draw][st]) : s;
  const value = step(s, valueAt + p.raiseGap + (facingRaise ? 0.06 : 0));
  let bluff = 0;
  if (draw !== "none" && st < 2) bluff = 0.35 * p.semibluff * (draw === "gutshot" ? 0.5 : 1);
  else if (s < 0.4) bluff = p.bluffRaise * (st === 2 ? 0.5 : 1);
  if (facingRaise) bluff *= 0.2;
  const raise = value + (1 - value) * clamp01(bluff * multiway);
  const call = (1 - raise) * step(callStrength, callAt);
  out[RAISE] = raise;
  out[CALL] = call;
  out[FOLD] = 1 - raise - call;
}

/** Moves probability off actions that are not legal here (fold -> check, raises -> call/check, ...) and normalizes. */
function finalize(la: LegalActions, out: Float64Array): Float64Array {
  if (!la.canFold) {
    out[CHECK] += out[FOLD];
    out[FOLD] = 0;
  }
  if (!la.canCheck && out[CHECK] > 0) {
    out[la.canFold ? FOLD : CALL] += out[CHECK];
    out[CHECK] = 0;
  }
  if (!la.canCall) {
    out[CHECK] += out[CALL];
    out[CALL] = 0;
  }
  if (la.isBet) {
    out[BET33 + 1] += out[RAISE];
    out[RAISE] = 0;
  } else {
    for (let i = 0; i < 3; i++) {
      out[RAISE] += out[BET33 + i];
      out[BET33 + i] = 0;
    }
  }
  if (!la.canRaise) {
    let r = out[RAISE] + out[ALLIN];
    for (let i = 0; i < 3; i++) r += out[BET33 + i];
    out.fill(0, BET33);
    out[la.canCall ? CALL : CHECK] += r;
  }
  let total = 0;
  for (let i = 0; i < ACTION_COUNT; i++) {
    if (out[i] < 0) out[i] = 0; // rounding
    total += out[i];
  }
  for (let i = 0; i < ACTION_COUNT; i++) out[i] /= total;
  return out;
}

// ---------------------------------------------------------------------------
// Public entry points.

/** The persona's mixed strategy for one combo at the view's decision. */
export function actionDistribution(persona: Persona, view: PublicView, combo: number): Float64Array {
  return comboDistribution(analyzeSpot(persona, view), combo);
}

export interface Strategy {
  spot: Spot;
  actions: readonly AbstractAction[];
  /** The engine action for each abstract action (null where it is not legal here). */
  concrete: (Action | null)[];
  /** probs[combo * ACTION_COUNT + a]; each live combo's row sums to 1, dead combos' rows are all 0. */
  probs: Float64Array;
  /** 1 for combos that use neither a board card nor one of `dead`. */
  live: Uint8Array;
}

/** The persona's strategy for every combo (board cards and `dead` removed) at the view's decision. */
export function strategyAt(persona: Persona, view: PublicView, dead: readonly Card[] = []): Strategy {
  const spot = analyzeSpot(persona, view);
  const isDead = new Uint8Array(52);
  for (const c of view.board) isDead[c] = 1;
  for (const c of dead) isDead[c] = 1;
  const probs = new Float64Array(COMBO_COUNT * ACTION_COUNT);
  const live = new Uint8Array(COMBO_COUNT);
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    if (isDead[COMBO_HI[combo]] || isDead[COMBO_LO[combo]]) continue;
    live[combo] = 1;
    probs.set(comboDistribution(spot, combo), combo * ACTION_COUNT);
  }
  return { spot, actions: ABSTRACT_ACTIONS, concrete: spot.concrete, probs, live };
}

export interface BotDecision {
  action: Action;
  abstract: AbstractAction;
  /** The distribution the action was sampled from. */
  distribution: Float64Array;
}

/** Samples the persona's action for its own hole cards. The rng is the only source of randomness. */
export function chooseAction(persona: Persona, view: BotView, rng: Rng): BotDecision {
  const spot = analyzeSpot(persona, view);
  const distribution = comboDistribution(spot, comboIndex(view.holeCards[0], view.holeCards[1]));
  const u = rng.next();
  let pick = -1;
  let cumulative = 0;
  for (let i = 0; i < ACTION_COUNT; i++) {
    if (distribution[i] <= 0) continue;
    pick = i;
    cumulative += distribution[i];
    if (u < cumulative) break;
  }
  return { action: spot.concrete[pick]!, abstract: ABSTRACT_ACTIONS[pick], distribution };
}

/** Whether two engine actions are the same move (same type, same raise-to). */
export const sameAction = (a: Action, b: Action): boolean =>
  a.type === b.type && (a.type !== "raise" || a.to === (b as { to: number }).to);
