// Test-only helpers for lib/grading: scripted hands and an independent EV oracle.
//
// The oracle values an option by playing the tree through the engine with REAL cards, one hand per
// particle: bot probabilities from analyzeSpot + comboDistribution (not strategyAt), terminals settled by
// the engine itself (finalStacks, side pots, uncalled bets, odd chips) and, for a street that closes before
// the river, every remaining runout dealt for real and checked down. Only the hero's candidate list is
// shared with the code under test. It is slow and meant for small particle sets and tables where nobody
// has folded before the decision street closes (folded players' cards would block runouts).

import { applyAction, createHand, legalActions, type Action, type HandState } from "../engine/engine";
import { FULL_DECK, parseCards, type Card } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO } from "../poker/combinatorics";
import { exactEquity } from "../poker/equity";
import { evaluate } from "../poker/evaluator";
import { TAG, type Persona } from "../bots/personas";
import { ABSTRACT_ACTIONS, analyzeSpot, comboDistribution, sameAction, type AbstractAction } from "../bots/policy";
import { publicHistory, publicView, type PublicHistory } from "../bots/view";
import { candidatesAt } from "./candidates";
import { stateFromHistory } from "./state";

/** A deck dealing `holes[seat]` to each listed seat and `board` (padded) as the board; other cards are filler. */
export function dealDeck(n: number, button: number, holes: Map<number, readonly Card[]>, board: readonly Card[]): Card[] {
  const used = new Uint8Array(52);
  const mark = (c: Card) => {
    if (used[c]) throw new Error(`Card ${c} dealt twice`);
    used[c] = 1;
  };
  for (const h of holes.values()) h.forEach(mark);
  board.forEach(mark);
  const filler = FULL_DECK.filter((c) => !used[c]);
  let f = 0;
  const deck = new Array<Card>(2 * n + 5);
  for (let seat = 0; seat < n; seat++) {
    const k = (seat - button - 1 + n) % n;
    const h = holes.get(seat);
    deck[k] = h ? h[0] : filler[f++];
    deck[k + n] = h ? h[1] : filler[f++];
  }
  for (let j = 0; j < 5; j++) deck[2 * n + j] = j < board.length ? board[j] : filler[f++];
  return deck;
}

export type Step = AbstractAction | Action;

/** Plays scripted steps: an abstract action is resolved with the acting seat's persona (spot.concrete). */
export function playScript(
  config: { stacks: number[]; button: number; smallBlind?: number; bigBlind?: number },
  personas: readonly Persona[],
  deck: readonly Card[],
  steps: readonly Step[],
): HandState {
  let s = createHand(config, { deck });
  for (const step of steps) {
    const seat = s.toAct[0];
    let action: Action;
    if (typeof step === "string") {
      const spot = analyzeSpot(personas[seat], publicView(s, seat));
      const a = spot.concrete[ABSTRACT_ACTIONS.indexOf(step)];
      if (!a) throw new Error(`Seat ${seat} cannot ${step} here`);
      action = a;
    } else action = step;
    s = applyAction(s, action);
  }
  return s;
}

export interface Scenario {
  history: PublicHistory;
  /** The decision state rebuilt from the history (placeholder hole cards). */
  state: HandState;
  heroSeat: number;
  heroCards: [Card, Card];
  personas: (Persona | null)[];
}

/**
 * Scripts a hand on a fixed board ("Ks9d4c...", padded) with the hero's cards dealt, and returns the
 * hero's decision. The hero's scripted abstract actions use TAG's sizes; `bots[heroSeat]` is ignored.
 */
export function scenario(
  stacks: number[],
  button: number,
  heroSeat: number,
  heroText: string,
  boardText: string,
  bots: readonly Persona[],
  steps: readonly Step[],
): Scenario {
  const [a, b] = parseCards(heroText);
  const heroCards: [Card, Card] = [a, b];
  const deck = dealDeck(stacks.length, button, new Map([[heroSeat, heroCards]]), parseCards(boardText));
  const played = playScript({ stacks, button }, bots.map((p, seat) => (seat === heroSeat ? TAG : p)), deck, steps);
  const history = publicHistory(played);
  const state = stateFromHistory(history);
  if (legalActions(state)?.seat !== heroSeat) throw new Error(`Seat ${heroSeat} is not on the clock after the script`);
  return { history, state, heroSeat, heroCards, personas: bots.map((p, seat) => (seat === heroSeat ? null : p)) };
}

export interface OracleInput {
  history: PublicHistory;
  heroSeat: number;
  heroCards: readonly [Card, Card];
  personas: readonly (Persona | null)[];
  /** Live bot seats; particles[i][k] is seats[k]'s combo in particle i. */
  seats: readonly number[];
  particles: readonly (readonly number[])[];
  weights: readonly number[];
  maxRaises: number;
}

/** EV of `option` by brute force (see the header). */
export function oracleEV(input: OracleInput, option: Action): number {
  const { history, heroSeat: hero, heroCards, seats, particles, weights } = input;
  const n = history.stacks.length;
  const config = { stacks: history.stacks, button: history.button, smallBlind: history.smallBlind, bigBlind: history.bigBlind };
  const holesOf = (i: number): Map<number, Card[]> => {
    const holes = new Map<number, Card[]>([[hero, [heroCards[0], heroCards[1]]]]);
    seats.forEach((seat, k) => holes.set(seat, [COMBO_HI[particles[i][k]], COMBO_LO[particles[i][k]]]));
    return holes;
  };
  const build = (i: number, board: readonly Card[], path: readonly Action[]): HandState => {
    let s = createHand(config, { deck: dealDeck(n, history.button, holesOf(i), board) });
    for (const a of [...history.actions, ...path]) s = applyAction(s, a);
    return s;
  };
  const root = particles.map((_, i) => build(i, history.board, []));
  const street = root[0].street;
  const stackNow = root[0].stacks[hero];

  const raisesOn = (s: HandState): number =>
    s.events.filter((e) => e.type === "action" && e.street === s.street && (e.action === "bet" || e.action === "raise")).length;

  const settle = (i: number, s: HandState, path: readonly Action[]): number => {
    if (s.folded[hero]) return s.stacks[hero] - stackNow;
    if (s.complete) return s.result!.finalStacks[hero] - stackNow;
    // Closed before the river: deal every remaining runout for real and check down.
    const used = new Uint8Array(52);
    for (const [, h] of holesOf(i)) h.forEach((c) => (used[c] = 1));
    history.board.forEach((c) => (used[c] = 1));
    const rest = FULL_DECK.filter((c) => !used[c]);
    const toDeal = 5 - history.board.length;
    let total = 0, count = 0;
    const rec = (start: number, chosen: Card[]): void => {
      if (chosen.length === toDeal) {
        let t = build(i, [...history.board, ...chosen], path);
        while (!t.complete) t = applyAction(t, legalActions(t)!.canCheck ? { type: "check" } : { type: "call" });
        total += t.result!.finalStacks[hero] - stackNow;
        count++;
        return;
      }
      for (let j = start; j < rest.length; j++) rec(j + 1, [...chosen, rest[j]]);
    };
    rec(0, []);
    return total / count;
  };

  const node = (states: HandState[], reach: number[], path: Action[]): number[] => {
    const s0 = states[0];
    if (s0.complete || s0.street !== street || s0.folded[hero]) return states.map((s, i) => reach[i] * settle(i, s, path));
    const seat = s0.toAct[0];
    if (seat === hero) {
      let opts = candidatesAt(s0).map((c) => c.action);
      if (raisesOn(s0) >= input.maxRaises) opts = opts.filter((a) => a.type !== "raise");
      let best: number[] | null = null, bestScore = -Infinity;
      for (const a of opts) {
        const v = node(states.map((s) => applyAction(s, a)), reach, [...path, a]);
        const score = v.reduce((acc, x, i) => acc + weights[i] * x, 0);
        if (score > bestScore) {
          bestScore = score;
          best = v;
        }
      }
      return best!;
    }
    const k = seats.indexOf(seat);
    const spot = analyzeSpot(input.personas[seat]!, publicView(s0, seat));
    const out = new Array<number>(states.length).fill(0);
    const done: Action[] = [];
    spot.concrete.forEach((action) => {
      if (!action || done.some((d) => sameAction(d, action))) return;
      done.push(action);
      const child = states.map((_, i) => {
        const dist = comboDistribution(spot, particles[i][k]);
        let p = 0;
        spot.concrete.forEach((b, a) => {
          if (b && sameAction(b, action)) p += dist[a];
        });
        return reach[i] * p;
      });
      if (!child.some((x) => x > 0)) return;
      const v = node(states.map((s) => applyAction(s, action)), child, [...path, action]);
      v.forEach((x, i) => (out[i] += x));
    });
    return out;
  };

  const v = node(root.map((s) => applyAction(s, option)), particles.map(() => 1), [option]);
  return v.reduce((acc, x, i) => acc + weights[i] * x, 0);
}

/** Exact per-combo equity (pot share) for every combo with weight > 0, via exactEquity. NaN elsewhere. */
export function exactComboEquities(hero: readonly Card[], board: readonly Card[], weights: Float64Array) {
  const equity = new Float64Array(COMBO_COUNT).fill(NaN);
  for (let c = 0; c < COMBO_COUNT; c++) {
    if (!(weights[c] > 0)) continue;
    equity[c] = exactEquity([[...hero], [COMBO_HI[c], COMBO_LO[c]]], [...board]).players[0].equity;
  }
  return { equity, stdErr: new Float64Array(COMBO_COUNT), exact: true };
}

/** River pot share by direct 7-card comparison. */
export function riverEquities(hero: readonly Card[], board: readonly Card[], weights: Float64Array): Float64Array {
  const h = evaluate([...hero, ...board]);
  const eq = new Float64Array(COMBO_COUNT).fill(NaN);
  for (let c = 0; c < COMBO_COUNT; c++) {
    if (!(weights[c] > 0)) continue;
    const v = evaluate([COMBO_HI[c], COMBO_LO[c], ...board]);
    eq[c] = h > v ? 1 : h === v ? 0.5 : 0;
  }
  return eq;
}
