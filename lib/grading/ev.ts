// EV of each hero option vs the bots, by walking the current street's game tree.
//
// EV(option) = E[hero's final stack] - hero's stack now. Folding now is 0; winning the pot uncontested is
// the whole pot (the hero's earlier chips are sunk). The expectation is over the bots' hidden cards
// (their exact Bayesian posteriors, lib/bots/range.ts), their mixed strategies and the runout.
//
// The bots' holdings are "particles" (ShowdownModel): heads-up, every live combo of the bot with its
// posterior weight; multiway, joint draws from the joint posterior with weight 1/N. Each node of the tree
// carries a reach vector over particles, reach_i = P(the actions so far | particle i):
//   bot node:  for each concrete action (abstract actions that map to the same engine action are grouped,
//              as in inferRange), child reach_i = reach_i * sum of that group's probabilities for the bot's
//              combo in particle i (strategyAt, the very distribution the bot samples from);
//   hero node: (the hero acts again on this street, e.g. after betting and being raised) the hero picks
//              the option with the largest sum_i w_i * value_i, which is the max of the conditional EV
//              given the node (a best response; the hero doesn't know the particle). Once the street has
//              `maxRaises` bets and raises, the hero may only fold, check or call;
//   terminal:  every bot folded: hero gets every chip committed (card-independent);
//              hero folded: hero keeps what is behind;
//              the street's betting closed, or everyone is all in: the pot layers (main and side pots,
//              lib/engine/pots buildPots over the final contributions after uncalled bets are returned)
//              are split by showdown: hero gets amount * share(eligible bots) of each layer hero is
//              eligible for. share is hero's pot share (ties split 1/k, odd chips ignored).
// Each terminal's value is (chips behind + chips won) - stack now; EV = sum_i w_i sum_terminals reach_i * value_i.
//
// A closed street before the river is valued as if the hand checks down from there ("ev-now": it ignores
// later betting). The engine deals the next street from placeholder cards at that point; we stop before
// reading any of them, and for all-in runouts we read only the contributions, never the engine's winners.
//
// Errors: multiway, EV is a mean over N particles, so stdErr = sd(per-particle payoff) / sqrt(N) (runout
// sampling inside a particle's share is part of that payoff). Heads-up preflop, the particles are exact but
// each combo's equity is Monte Carlo; EV is linear in those equities (best-response choices held fixed), so
// Var = sum_c (w_c * coef_c * stdErr_c)^2 with coef_c = sum over showdown terminals of reach_c * contested chips.

import { applyAction, legalActions, potTotal, type Action, type HandState, type Street } from "../engine/engine";
import { buildPots } from "../engine/pots";
import { createRng, type Card } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO } from "../poker/combinatorics";
import { CARD_HI, CARD_KEY, CARD_LO, CARD_SUIT, evaluateState, handState } from "../poker/evaluator";
import type { Persona } from "../bots/personas";
import { ACTION_COUNT, sameAction, strategyAt } from "../bots/policy";
import { inferRange } from "../bots/range";
import { publicView } from "../bots/view";
import { candidatesAt, describeActionAt, type Candidate } from "./candidates";
import { stateFromHistory, streetRaises } from "./state";
import { gradeOptions } from "./tiers";
import type { GradedOption, GradeInput, GradeOptions, GradeResult, ShowdownModel } from "./types";

// Local aliases for hot loops (see the bundler note in lib/poker/equity.ts).
const KEY = CARD_KEY, SUIT = CARD_SUIT, LO = CARD_LO, HI = CARD_HI, C_HI = COMBO_HI, C_LO = COMBO_LO;
const evalState = evaluateState;
const NA = ACTION_COUNT;

export const DEFAULT_PARTICLES = 2000;
export const DEFAULT_TRIALS_PER_COMBO = 200;
export const DEFAULT_MAX_RAISES = 4;
/** Multiway particle model: sampled runouts per particle on the flop and preflop (turn and river are enumerated). */
export const FLOP_RUNOUTS = 32;
export const PREFLOP_RUNOUTS = 16;

// ---------------------------------------------------------------------------
// Showdown models

/**
 * Heads-up model: particles = the bot's combos with weight > 0, weighted by the (normalized) posterior.
 * `eq.equity[c]` is hero's pot share vs combo c (e.g. comboEquities from lib/sim/weighted-equity.ts);
 * `eq.stdErr` its per-combo standard error (ignored when `eq.exact`).
 */
export function headsUpModel(
  seat: number,
  weights: Float64Array,
  eq: { equity: Float64Array; stdErr: Float64Array; exact: boolean },
): ShowdownModel {
  let total = 0, count = 0;
  for (let c = 0; c < COMBO_COUNT; c++) {
    if (weights[c] > 0) {
      total += weights[c];
      count++;
    }
  }
  if (count === 0) throw new Error(`Seat ${seat}'s range is empty`);
  const combos = new Int16Array(count);
  const w = new Float64Array(count);
  const share = new Float64Array(count);
  const se = new Float64Array(count);
  for (let c = 0, i = 0; c < COMBO_COUNT; c++) {
    if (!(weights[c] > 0)) continue;
    const e = eq.equity[c];
    if (!(e >= 0 && e <= 1)) throw new Error(`No equity for combo ${c} of seat ${seat}`);
    combos[i] = c;
    w[i] = weights[c] / total;
    share[i] = e;
    se[i] = eq.exact ? 0 : eq.stdErr[c];
    i++;
  }
  return {
    seats: [seat],
    combos: [combos],
    weights: w,
    share: () => share,
    shareStdErr: eq.exact ? null : () => se,
    exactShares: eq.exact,
    sampled: false,
  };
}

/**
 * Multiway model from joint holdings: combos[k][i] is seats[k]'s combo in particle i (e.g. sampleJoint from
 * lib/sim/multiway.ts). Weight 1/N each. Hero's share vs any subset of the bots is computed over the
 * remaining runouts with every particle's cards removed: all of them on the turn and river (exact),
 * `runouts` uniform samples per particle on the flop (default FLOP_RUNOUTS) and preflop (PREFLOP_RUNOUTS),
 * seeded. Folded players' unknown cards are not removed (same convention as inferRange).
 */
export function particleModel(
  heroCards: readonly [Card, Card],
  board: readonly Card[],
  seats: readonly number[],
  combos: readonly ArrayLike<number>[],
  options: { seed?: number; runouts?: number } = {},
): ShowdownModel {
  const m = seats.length;
  if (m === 0 || m > 8 || combos.length !== m) throw new Error("particleModel needs 1-8 seats, one combo column each");
  const n = combos[0].length;
  if (n === 0 || combos.some((col) => col.length !== n)) throw new Error("Every seat needs the same number (> 0) of particles");
  const toDeal = 5 - board.length;
  const exact = toDeal <= 1;
  const runouts = exact ? 0 : options.runouts ?? (toDeal === 2 ? FLOP_RUNOUTS : PREFLOP_RUNOUTS);
  const base = new Uint8Array(52);
  for (const c of [...heroCards, ...board]) {
    if (base[c]) throw new Error("Hero's cards and the board overlap");
    base[c] = 1;
  }
  const deckSize = 52 - 2 - board.length - 2 * m;
  const R = exact ? (toDeal === 0 ? 1 : deckSize) : runouts;
  const P = m + 1;
  const vals = new Int32Array(n * R * P);
  const b = handState(board);
  const hk = KEY[heroCards[0]] + KEY[heroCards[1]], hs = SUIT[heroCards[0]] + SUIT[heroCards[1]];
  const hl = LO[heroCards[0]] | LO[heroCards[1]], hh = HI[heroCards[0]] | HI[heroCards[1]];
  const ck = new Int32Array(m), cs = new Int32Array(m), cl = new Int32Array(m), ch = new Int32Array(m);
  const used = new Uint8Array(52);
  const avail = new Int32Array(52);
  const rng = createRng((options.seed ?? 1) ^ 0x5bd1e995);

  for (let i = 0; i < n; i++) {
    used.set(base);
    for (let k = 0; k < m; k++) {
      const combo = combos[k][i];
      const x = C_HI[combo], y = C_LO[combo];
      if (used[x] || used[y]) throw new Error(`Particle ${i}: seat ${seats[k]}'s cards collide with another known card`);
      used[x] = used[y] = 1;
      ck[k] = KEY[x] + KEY[y];
      cs[k] = SUIT[x] + SUIT[y];
      cl[k] = LO[x] | LO[y];
      ch[k] = HI[x] | HI[y];
    }
    let a = 0;
    for (let c = 0; c < 52; c++) if (!used[c]) avail[a++] = c;
    for (let r = 0; r < R; r++) {
      let key = b.key, suits = b.suits, lo = b.lo, hi = b.hi;
      if (exact) {
        if (toDeal === 1) {
          const c = avail[r];
          key += KEY[c];
          suits += SUIT[c];
          lo |= LO[c];
          hi |= HI[c];
        }
      } else {
        // Partial Fisher-Yates: the first toDeal slots become a uniform sample of distinct cards.
        for (let j = 0; j < toDeal; j++) {
          const pick = j + rng.int(a - j);
          const c = avail[pick];
          avail[pick] = avail[j];
          avail[j] = c;
          key += KEY[c];
          suits += SUIT[c];
          lo |= LO[c];
          hi |= HI[c];
        }
      }
      const o = (i * R + r) * P;
      vals[o] = evalState(key + hk, suits + hs, lo | hl, hi | hh);
      for (let k = 0; k < m; k++) vals[o + 1 + k] = evalState(key + ck[k], suits + cs[k], lo | cl[k], hi | ch[k]);
    }
  }

  const cache = new Map<number, Float64Array>();
  const share = (mask: number): Float64Array => {
    let out = cache.get(mask);
    if (out) return out;
    if (mask <= 0 || mask >= 1 << m) throw new Error(`Invalid seat mask ${mask}`);
    out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let r = 0; r < R; r++) {
        const o = (i * R + r) * P;
        const v = vals[o];
        let beaten = false, ties = 0;
        for (let k = 0; k < m; k++) {
          if (!((mask >> k) & 1)) continue;
          const u = vals[o + 1 + k];
          if (u > v) {
            beaten = true;
            break;
          }
          if (u === v) ties++;
        }
        if (!beaten) sum += 1 / (1 + ties);
      }
      out[i] = sum / R;
    }
    cache.set(mask, out);
    return out;
  };

  return {
    seats: seats.slice(),
    combos: combos.slice(),
    weights: new Float64Array(n).fill(1 / n),
    share,
    shareStdErr: null,
    exactShares: exact,
    sampled: true,
  };
}

// ---------------------------------------------------------------------------
// The tree

const CONTINUES = 1, CARD_DEPENDENT = 2, BOT_ACTED = 4;

/** Reach-weighted sums per particle, accumulated over a subtree's terminals. */
interface Acc {
  value: Float64Array;
  /** Reach of "every bot folded" terminals. */
  foldOut: Float64Array;
  /** Reach * contested chips (layers shared with a bot) at showdown terminals, and reach * hero's expected share of them. */
  sdChips: Float64Array;
  sdWon: Float64Array;
  flags: number;
}

const newAcc = (n: number): Acc => ({
  value: new Float64Array(n),
  foldOut: new Float64Array(n),
  sdChips: new Float64Array(n),
  sdWon: new Float64Array(n),
  flags: 0,
});

function addInto(acc: Acc, sub: Acc): void {
  for (let i = 0; i < acc.value.length; i++) {
    acc.value[i] += sub.value[i];
    acc.foldOut[i] += sub.foldOut[i];
    acc.sdChips[i] += sub.sdChips[i];
    acc.sdWon[i] += sub.sdWon[i];
  }
  acc.flags |= sub.flags;
}

const dot = (a: Float64Array, b: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

interface Ctx {
  hero: number;
  heroCards: readonly [Card, Card];
  personas: readonly (Persona | null)[];
  model: ShowdownModel;
  street: Street;
  maxRaises: number;
  heroStart: number;
  stackNow: number;
  /** seat -> model column, -1 for the hero and seats folded at the decision. */
  col: Int32Array;
  w: Float64Array;
  n: number;
}

type Capture = (action: Action, prob: number, s: HandState) => void;

function visit(ctx: Ctx, s: HandState, reach: Float64Array, acc: Acc, capture?: Capture): void {
  if (s.complete || s.street !== ctx.street || s.folded[ctx.hero]) return terminal(ctx, s, reach, acc);
  const seat = s.toAct[0];
  if (seat === ctx.hero) return heroNode(ctx, s, reach, acc);
  botNode(ctx, s, seat, reach, acc, capture);
}

function terminal(ctx: Ctx, s: HandState, reach: Float64Array, acc: Acc): void {
  const { n, hero } = ctx;
  const baseValue = ctx.heroStart - s.committed[hero] - ctx.stackNow;
  const value = acc.value;
  if (s.folded[hero]) {
    for (let i = 0; i < n; i++) value[i] += reach[i] * baseValue;
    return;
  }
  const live = s.folded.map((f) => !f);
  if (live.filter(Boolean).length === 1) {
    const v = baseValue + s.committed.reduce((x, y) => x + y, 0);
    for (let i = 0; i < n; i++) {
      value[i] += reach[i] * v;
      acc.foldOut[i] += reach[i];
    }
    return;
  }
  if (!s.complete) acc.flags |= CONTINUES;
  let fixed = baseValue;
  const amounts: number[] = [];
  const shares: Float64Array[] = [];
  for (const pot of buildPots(s.committed, s.committed, live)) {
    if (!pot.eligible.includes(hero)) continue;
    let mask = 0;
    for (const seat of pot.eligible) if (seat !== hero) mask |= 1 << ctx.col[seat];
    if (mask === 0) fixed += pot.amount;
    else {
      amounts.push(pot.amount);
      shares.push(ctx.model.share(mask));
    }
  }
  if (amounts.length > 0) acc.flags |= CARD_DEPENDENT;
  let contested = 0;
  for (const a of amounts) contested += a;
  for (let i = 0; i < n; i++) {
    const r = reach[i];
    if (r === 0) continue;
    let won = 0;
    for (let j = 0; j < amounts.length; j++) won += amounts[j] * shares[j][i];
    value[i] += r * (fixed + won);
    acc.sdChips[i] += r * contested;
    acc.sdWon[i] += r * won;
  }
}

function heroNode(ctx: Ctx, s: HandState, reach: Float64Array, acc: Acc): void {
  let options = candidatesAt(s);
  if (streetRaises(s) >= ctx.maxRaises) options = options.filter((c) => c.action.type !== "raise");
  let best: Acc | null = null;
  let bestScore = -Infinity;
  for (const c of options) {
    const sub = newAcc(ctx.n);
    visit(ctx, applyAction(s, c.action), reach, sub);
    const score = dot(ctx.w, sub.value);
    if (score > bestScore) {
      bestScore = score;
      best = sub;
    }
  }
  addInto(acc, best!);
}

function botNode(ctx: Ctx, s: HandState, seat: number, reach: Float64Array, acc: Acc, capture?: Capture): void {
  const k = ctx.col[seat];
  const persona = ctx.personas[seat];
  if (k < 0 || !persona) throw new Error(`Seat ${seat} acts but has no range or persona`);
  const st = strategyAt(persona, publicView(s, seat), ctx.heroCards);
  const probs = st.probs;
  const combos = ctx.model.combos[k];
  const { n, w } = ctx;
  const groups: { action: Action; abstract: number[] }[] = [];
  st.concrete.forEach((action, a) => {
    if (!action) return;
    const g = groups.find((x) => sameAction(x.action, action));
    if (g) g.abstract.push(a);
    else groups.push({ action, abstract: [a] });
  });
  acc.flags |= BOT_ACTED;
  for (const g of groups) {
    const child = new Float64Array(n);
    let mass = 0;
    for (let i = 0; i < n; i++) {
      const r = reach[i];
      if (r === 0) continue;
      const row = combos[i] * NA;
      let p = 0;
      for (const a of g.abstract) p += probs[row + a];
      child[i] = r * p;
      mass += w[i] * child[i];
    }
    if (!(mass > 0)) continue;
    const next = applyAction(s, g.action);
    capture?.(g.action, mass, s);
    visit(ctx, next, child, acc);
  }
}

// ---------------------------------------------------------------------------
// Options

export interface TreeSpot {
  /** The decision state (hero on the clock), e.g. stateFromHistory(history). */
  state: HandState;
  heroSeat: number;
  heroCards: readonly [Card, Card];
  personas: readonly (Persona | null)[];
  maxRaises?: number;
}

export type OptionValue = Omit<GradedOption, "loss" | "lossPct" | "tier">;

/** Values each candidate against the model (see the header). Candidates must be legal at the decision. */
export function evaluateOptions(spot: TreeSpot, model: ShowdownModel, options: readonly Candidate[]): OptionValue[] {
  const s = spot.state;
  const la = legalActions(s);
  if (la === null || la.seat !== spot.heroSeat) throw new Error(`Seat ${spot.heroSeat} is not on the clock`);
  const col = new Int32Array(s.seatCount).fill(-1);
  model.seats.forEach((seat, k) => (col[seat] = k));
  for (let seat = 0; seat < s.seatCount; seat++) {
    if (seat !== spot.heroSeat && !s.folded[seat] && col[seat] < 0) throw new Error(`Live seat ${seat} is missing from the model`);
  }
  const n = model.weights.length;
  const ctx: Ctx = {
    hero: spot.heroSeat,
    heroCards: spot.heroCards,
    personas: spot.personas,
    model,
    street: s.street,
    maxRaises: spot.maxRaises ?? DEFAULT_MAX_RAISES,
    heroStart: s.startingStacks[spot.heroSeat],
    stackNow: s.stacks[spot.heroSeat],
    col,
    w: model.weights,
    n,
  };
  const ones = new Float64Array(n).fill(1);
  const bb = s.bigBlind;
  const allMask = (1 << model.seats.length) - 1;

  return options.map((c) => {
    const acc = newAcc(n);
    const responses: OptionValue["responses"] = [];
    visit(ctx, applyAction(s, c.action), ones, acc, (action, prob, at) => {
      responses.push({ label: describeActionAt(at, action).label, action, prob });
    });
    const ev = dot(ctx.w, acc.value);
    let stdErr = 0;
    if (model.sampled) {
      let ss = 0;
      for (let i = 0; i < n; i++) ss += (acc.value[i] - ev) ** 2;
      stdErr = n > 1 ? Math.sqrt(ss / (n - 1) / n) : 0;
    } else if (model.shareStdErr && acc.flags & CARD_DEPENDENT) {
      const se = model.shareStdErr(allMask);
      let v = 0;
      for (let i = 0; i < n; i++) v += (ctx.w[i] * acc.sdChips[i] * se[i]) ** 2;
      stdErr = Math.sqrt(v);
    }
    const exact =
      !(acc.flags & CONTINUES) &&
      (model.exactShares || !(acc.flags & CARD_DEPENDENT)) &&
      !(model.sampled && acc.flags & (CARD_DEPENDENT | BOT_ACTED));
    const sdChips = dot(ctx.w, acc.sdChips);
    return {
      action: c.action,
      label: c.label,
      kind: c.kind,
      ev,
      evBb: ev / bb,
      stdErr,
      model: exact ? "exact" : "ev-now",
      foldEquity: dot(ctx.w, acc.foldOut),
      responses,
      showdownEquity: sdChips > 0 ? dot(ctx.w, acc.sdWon) / sdChips : NaN,
    };
  });
}

// ---------------------------------------------------------------------------
// Grading

/** What a model builder gets: the live bots at the decision and their posteriors (hero's cards removed). */
export interface ModelRequest {
  state: HandState;
  heroSeat: number;
  heroCards: readonly [Card, Card];
  board: readonly Card[];
  seats: readonly number[];
  ranges: readonly Float64Array[];
  options: Required<GradeOptions>;
}

export type ModelBuilder = (req: ModelRequest) => ShowdownModel;

/** gradeDecision with an injected showdown model (lib/grading/grade.ts builds it from lib/sim). */
export function gradeWithModel(input: GradeInput, buildModel: ModelBuilder): GradeResult {
  const { history, heroSeat, heroCards, personas } = input;
  const options: Required<GradeOptions> = {
    particles: input.options?.particles ?? DEFAULT_PARTICLES,
    trialsPerCombo: input.options?.trialsPerCombo ?? DEFAULT_TRIALS_PER_COMBO,
    seed: input.options?.seed ?? 1,
    maxRaises: input.options?.maxRaises ?? DEFAULT_MAX_RAISES,
  };
  const state = stateFromHistory(history);
  const la = legalActions(state);
  if (la === null || la.seat !== heroSeat) throw new Error(`Seat ${heroSeat} is not on the clock`);
  const board = state.board.slice();
  const known = new Uint8Array(52);
  for (const c of [...heroCards, ...board]) {
    if (!Number.isInteger(c) || c < 0 || c > 51 || known[c]) throw new Error("Hero's cards must be two valid cards not on the board");
    known[c] = 1;
  }

  const seats: number[] = [];
  for (let seat = 0; seat < state.seatCount; seat++) if (seat !== heroSeat && !state.folded[seat]) seats.push(seat);
  const personaOf = (seat: number): Persona => {
    const p = personas[seat];
    if (!p) throw new Error(`Seat ${seat} is live but has no persona`);
    return p;
  };
  const ranges = seats.map((seat) => inferRange(personaOf(seat), history, seat, { dead: heroCards }));
  const model = buildModel({ state, heroSeat, heroCards, board, seats, ranges, options });

  const pot = potTotal(state);
  const cands = candidatesAt(state);
  let chosen: number | null = null;
  if (input.chosen) {
    chosen = cands.findIndex((c) => sameAction(c.action, input.chosen!));
    if (chosen < 0) {
      cands.push(describeActionAt(state, input.chosen));
      chosen = cands.length - 1;
    }
  }
  const spot: TreeSpot = { state, heroSeat, heroCards, personas, maxRaises: options.maxRaises };
  const values = evaluateOptions(spot, model, cands);
  const graded = gradeOptions(values, pot);
  const gradedOptions: GradedOption[] = values.map((v, i) => ({
    ...v,
    loss: graded.loss[i],
    lossPct: graded.lossPct[i],
    tier: graded.tier[i],
  }));

  // Check-down equity vs the whole field now.
  const w = model.weights;
  const sh = model.share((1 << seats.length) - 1);
  const heroEquity = dot(w, sh);
  let heroEquityStdErr = 0;
  if (model.sampled) {
    let ss = 0;
    for (let i = 0; i < w.length; i++) ss += (sh[i] - heroEquity) ** 2;
    heroEquityStdErr = w.length > 1 ? Math.sqrt(ss / (w.length - 1) / w.length) : 0;
  } else if (model.shareStdErr) {
    const se = model.shareStdErr(1);
    let v = 0;
    for (let i = 0; i < w.length; i++) v += (w[i] * se[i]) ** 2;
    heroEquityStdErr = Math.sqrt(v);
  }

  // Blockers: how much of the range the hero's cards remove, vs a uniform range.
  const onBoard = new Uint8Array(52);
  for (const c of board) onBoard[c] = 1;
  const isHero = new Uint8Array(52);
  isHero[heroCards[0]] = isHero[heroCards[1]] = 1;
  let uniformAll = 0, uniformBlocked = 0;
  for (let c = 0; c < COMBO_COUNT; c++) {
    if (onBoard[C_HI[c]] || onBoard[C_LO[c]]) continue;
    uniformAll++;
    if (isHero[C_HI[c]] || isHero[C_LO[c]]) uniformBlocked++;
  }
  const blockers = seats.map((seat) => {
    const raw = inferRange(personaOf(seat), history, seat);
    let blocked = 0;
    for (let c = 0; c < COMBO_COUNT; c++) if (isHero[C_HI[c]] || isHero[C_LO[c]]) blocked += raw[c];
    return { seat, blockedShare: blocked, uniformShare: uniformBlocked / uniformAll };
  });

  let requiredEquity: number | null = null;
  if (la.canCall) {
    const heroTotal = state.committed[heroSeat] + la.callAmount;
    let contested = 0;
    for (let seat = 0; seat < state.seatCount; seat++) contested += seat === heroSeat ? heroTotal : Math.min(state.committed[seat], heroTotal);
    requiredEquity = la.callAmount / contested;
  }

  return {
    street: state.street,
    board,
    pot,
    toCall: la.toCall,
    bigBlind: state.bigBlind,
    heroSeat,
    heroStreetBet: state.bets[heroSeat],
    requiredEquity,
    heroEquity,
    heroEquityStdErr,
    ranges: seats.map((seat, k) => ({ seat, persona: personaOf(seat).id, weights: ranges[k] })),
    blockers,
    options: gradedOptions,
    best: graded.best,
    chosen,
    model: gradedOptions.every((o) => o.model === "exact") ? "exact" : "ev-now",
  };
}
