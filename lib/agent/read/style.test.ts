// The style likelihood against an independent brute-force reference, its exactness against
// inferRange at ε = 0, off-policy actions, and a quick learning check.
import { describe, expect, it } from "vitest";
import { applyAction, createHand, legalActions, seatToAct, type Action, type HandState } from "../../engine/engine";
import { createRng, type Card } from "../../poker/cards";
import { comboIndex } from "../../poker/combinatorics";
import { PERSONA_IDS, PERSONAS, TAG, type Persona } from "../../bots/personas";
import { chooseAction, strategyAt } from "../../bots/policy";
import { inferRange } from "../../bots/range";
import { playHand } from "../../bots/simulate";
import { botView, publicHistory, replay } from "../../bots/view";
import { observe } from "./hand";
import { addHand, createReader, playerStyle } from "./reader";
import { comboWeights, deadCards, handDecisions, styleLogLikelihoods } from "./style";

const ALL = PERSONA_IDS.map((id) => PERSONAS[id]);

/** Seeded mixed tables: 2-6 seats, random personas, mostly 100 bb with some uneven stacks. */
function hands(count: number, seed: number): { state: HandState; personas: Persona[] }[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => {
    const n = 2 + rng.int(5);
    const personas = Array.from({ length: n }, () => ALL[rng.int(ALL.length)]);
    const stacks = Array.from({ length: n }, () => (rng.next() < 0.75 ? 10_000 : 500 + rng.int(15_000)));
    return { state: playHand({ personas, stacks, button: rng.int(n) }, rng.nextU32()), personas };
  });
}

/**
 * Brute-force reference, sharing no code with style.ts: enumerate the seat's possible hole cards card
 * by card, multiply strategyAt rows (summed over the abstract actions whose engine action is the
 * nearest to the observed one, mixed with the tremble) and average, or take the shown combo (or
 * `ownCards`, the seat's cards when it is the observer).
 */
function referenceLogLik(persona: Persona, state: HandState, seat: number, known: readonly Card[], epsilon: number, ownCards?: readonly Card[]): number {
  const { decisions } = replay(publicHistory(state));
  const mine = decisions.filter((d) => d.seat === seat);
  if (mine.length === 0) return 0;
  const shows = state.events.flatMap((e) => (e.type === "showdown" ? [e] : []));
  const dead = new Set<number>([...state.board, ...known]);
  for (const e of shows) if (e.seat !== seat) e.cards.forEach((c) => dead.add(c));
  const own = shows.find((e) => e.seat === seat);
  const rows = mine.map((d) => {
    const st = strategyAt(persona, d.view);
    const key = (a: Action) => (a.type === "raise" ? `raise ${a.to}` : a.type);
    let match = st.concrete.flatMap((c, a) => (c && key(c) === key(d.action) ? [a] : []));
    if (match.length === 0 && d.action.type === "raise") {
      const to = d.action.to;
      const sizes = st.concrete.flatMap((c) => (c?.type === "raise" ? [c.to] : [])).sort((x, y) => Math.abs(x - to) - Math.abs(y - to) || x - y);
      match = st.concrete.flatMap((c, a) => (c?.type === "raise" && c.to === sizes[0] ? [a] : []));
    }
    const distinct = new Set(st.concrete.flatMap((c) => (c ? [key(c)] : []))).size;
    return { st, match, distinct };
  });
  const product = (a: Card, b: Card) => {
    const combo = comboIndex(a, b);
    let p = 1;
    for (const { st, match, distinct } of rows) {
      let sum = 0;
      for (const x of match) sum += st.probs[combo * 8 + x];
      p *= (1 - epsilon) * sum + epsilon / distinct;
    }
    return p;
  };
  if (ownCards) return Math.log(product(ownCards[0], ownCards[1]));
  if (own) return Math.log(product(own.cards[0], own.cards[1]));
  let total = 0;
  let count = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      if (dead.has(a) || dead.has(b)) continue;
      total += product(a, b);
      count++;
    }
  }
  return Math.log(total / count);
}

describe("style likelihood", () => {
  it("matches the brute-force reference to 1e-9, with showdowns and known observer cards", () => {
    let checked = 0;
    let shownSeats = 0;
    for (const { state } of hands(50, 11)) {
      const observer = state.button; // knows its own two cards
      const hand = observe(state, state.holeCards.map((_, s) => `p${s}`), observer);
      const decisions = handDecisions(hand);
      for (let seat = 0; seat < state.seatCount; seat++) {
        if (seat === observer) continue;
        if (state.events.some((e) => e.type === "showdown" && e.seat === seat)) shownSeats++;
        for (const epsilon of [0.01, 0.1]) {
          const mine = styleLogLikelihoods(hand, seat, epsilon, decisions);
          PERSONA_IDS.forEach((id, i) => {
            const ref = referenceLogLik(PERSONAS[id], state, seat, state.holeCards[observer], epsilon);
            expect(Math.abs(mine[i] - ref)).toBeLessThan(1e-9);
            checked++;
          });
        }
      }
    }
    expect(shownSeats).toBeGreaterThan(10);
    expect(checked).toBeGreaterThan(1000);
  }, 30_000);

  it("models the observer's own seat from its known cards, as if shown", () => {
    let checked = 0;
    for (const { state } of hands(40, 13)) {
      const observer = state.button;
      const hand = observe(state, state.holeCards.map((_, s) => `p${s}`), observer);
      const decisions = handDecisions(hand);
      if (!decisions.some((d) => d.seat === observer)) continue;
      const cards = state.holeCards[observer];
      const combo = comboIndex(cards[0], cards[1]);
      // The same hand with the observer's cards shown at showdown and nothing known.
      const shownHand = { ...hand, observer: undefined, known: [], events: [...hand.events, { type: "showdown" as const, seat: observer, cards: cards.slice(), value: 0 }] };
      const mine = styleLogLikelihoods(hand, observer, 0.01, decisions);
      const shown = styleLogLikelihoods(shownHand, observer, 0.01, decisions);
      expect(deadCards(hand, observer)).not.toContain(cards[0]);
      expect(deadCards(hand, observer)).not.toContain(cards[1]);
      PERSONA_IDS.forEach((id, i) => {
        expect(Number.isFinite(mine[i])).toBe(true);
        expect(Math.abs(mine[i] - shown[i])).toBeLessThan(1e-12);
        expect(Math.abs(mine[i] - referenceLogLik(PERSONAS[id], state, observer, [], 0.01, cards))).toBeLessThan(1e-9);
        // The true combo keeps positive weight among the observer's possible hands.
        expect(comboWeights(PERSONAS[id], decisions, observer, deadCards(hand, observer))[combo]).toBeGreaterThan(0);
      });
      // Every other seat still has the observer's cards dead.
      for (let seat = 0; seat < state.seatCount; seat++) if (seat !== observer) expect(deadCards(hand, seat)).toEqual(expect.arrayContaining(cards));
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  }, 30_000);

  it("with ε = 0 gives inferRange's posterior over hole cards", () => {
    let compared = 0;
    for (const { state, personas } of hands(60, 12)) {
      const observer = 0;
      const hand = observe(state, state.holeCards.map((_, s) => `p${s}`), observer);
      const decisions = handDecisions(hand);
      for (let seat = 1; seat < state.seatCount; seat++) {
        if (!decisions.some((d) => d.seat === seat)) continue;
        const dead = deadCards(hand, seat);
        for (const persona of ALL) {
          let range: Float64Array;
          try {
            range = inferRange(persona, publicHistory(state), seat, { dead });
          } catch {
            // Another persona's size, which inferRange rejects; the true persona never throws.
            expect(persona).not.toBe(personas[seat]);
            continue;
          }
          const w = comboWeights(persona, decisions, seat, dead, 0);
          const total = w.reduce((a, b) => a + b, 0);
          let worst = 0;
          for (let c = 0; c < w.length; c++) worst = Math.max(worst, Math.abs(w[c] / total - range[c]));
          expect(worst).toBeLessThan(1e-12);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(200);
  }, 30_000);

  it("survives off-policy, odd-sized actions without zeroing any persona", () => {
    // Heads-up, then the bots play it out:
    // A: the button opens to 2.2 bb, the big blind calls, leads the flop for 37% pot, gets raised 2.9x, calls.
    // B: the button min-raises, the big blind calls and leads 198 into 400: exactly halfway between the
    //    33% (132) and 66% (264) bets, so the nearest size is a tie (broken toward the smaller).
    const scripts: Action[][] = [
      [{ type: "raise", to: 220 }, { type: "call" }, { type: "raise", to: 163 }, { type: "raise", to: 473 }, { type: "call" }],
      [{ type: "raise", to: 200 }, { type: "call" }, { type: "raise", to: 198 }],
    ];
    scripts.forEach((script, i) => {
      let s = createHand({ stacks: [10_000, 10_000], button: 0 }, { seed: 5 + i });
      for (const a of script) s = applyAction(s, a);
      const rng = createRng(9);
      while (!s.complete) s = applyAction(s, chooseAction(TAG, botView(s, seatToAct(s)!), rng).action);
      expect(legalActions(s)).toBeNull();

      const hand = observe(s, ["button", "bigBlind"]);
      expect(() => inferRange(TAG, publicHistory(s), i === 0 ? 0 : 1)).toThrow(/never does/);
      for (const seat of [0, 1]) {
        const ll = styleLogLikelihoods(hand, seat);
        PERSONA_IDS.forEach((id, k) => {
          expect(Number.isFinite(ll[k])).toBe(true);
          expect(Math.abs(ll[k] - referenceLogLik(PERSONAS[id], s, seat, [], 0.01))).toBeLessThan(1e-9);
        });
      }
      let reader = createReader();
      for (let h = 0; h < 20; h++) reader = addHand(reader, hand);
      for (const id of ["button", "bigBlind"]) {
        for (const p of Object.values(playerStyle(reader, id, "B").posterior)) expect(p).toBeGreaterThan(0);
      }
    });
  });

  it("names a calling station within 100 hands", () => {
    let reader = createReader();
    const rng = createRng(3);
    for (let h = 0; h < 100; h++) {
      const state = playHand({ personas: [PERSONAS.station, TAG], stacks: [10_000, 10_000], button: h % 2 }, rng.nextU32());
      reader = addHand(reader, observe(state, ["bob", null], 1));
    }
    const style = playerStyle(reader, "bob", "Bob");
    expect(style.top).toBe("station");
    expect(style.posterior.station).toBeGreaterThan(0.9);
    expect(style.sentence).toMatch(/^After 100 hands: \d+% that Bob plays closest to a calling station \(the closest of six bot styles/);
  });
});
