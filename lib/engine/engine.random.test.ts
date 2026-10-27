// 100,000 seeded random hands: chips are conserved at every step, illegal actions are always rejected,
// every pot and side pot matches an independent recomputation from contributions, and every hand ends.
import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "../poker/cards";
import { evaluate } from "../poker/evaluator";
import { applyAction, createHand, legalActions, pots, potTotal, type Action, type HandState, type LegalActions } from "./engine";

const HANDS = 100_000;
const MAX_STEPS = 2_000;

interface SimplePot {
  amount: number;
  eligible: number[];
}

/**
 * Side pots the textbook way: for each contribution level, the layer above the previous level holds
 * min(contribution, level) - min(contribution, previous) from everyone; it belongs to the live players
 * who reached the level. Adjacent layers with the same owners are one pot.
 */
function simplePots(collected: number[], pending: number[], live: boolean[]): SimplePot[] {
  const levels = [...new Set(collected.filter((c) => c > 0))].sort((a, b) => a - b);
  const out: SimplePot[] = [];
  let previous = 0;
  for (const level of levels) {
    const amount = collected.reduce((sum, c) => sum + Math.min(c, level) - Math.min(c, previous), 0);
    const eligible = live.flatMap((isLive, seat) => (isLive && pending[seat] >= level ? [seat] : []));
    const last = out[out.length - 1];
    if (last && last.eligible.join() === eligible.join()) last.amount += amount;
    else out.push({ amount, eligible });
    previous = level;
  }
  return out;
}

/** Expected final stacks, settled independently from the engine's contributions and the cards. */
function settle(s: HandState): number[] {
  const n = s.seatCount;
  const live = s.folded.map((f) => !f);
  const order = Array.from({ length: n }, (_, k) => (s.button + 1 + k) % n);
  const final = s.startingStacks.map((st, seat) => st - s.committed[seat]);
  const liveCount = live.filter(Boolean).length;
  if (liveCount === 1) {
    final[live.indexOf(true)] += s.committed.reduce((a, b) => a + b, 0);
    return final;
  }
  const value = live.map((isLive, seat) => (isLive ? evaluate([...s.holeCards[seat], ...s.board]) : -1));
  // Players who are beaten in every pot they could win drop out, then pots are rebuilt.
  const first = simplePots(s.committed, s.committed, live);
  const contending = live.map(
    (isLive, seat) =>
      isLive && first.some((p) => p.eligible.includes(seat) && p.eligible.every((o) => value[o] <= value[seat])),
  );
  for (const pot of simplePots(s.committed, s.committed, contending)) {
    const best = Math.max(...pot.eligible.map((seat) => value[seat]));
    const winners = order.filter((seat) => pot.eligible.includes(seat) && value[seat] === best);
    const share = Math.floor(pot.amount / winners.length);
    winners.forEach((seat, i) => (final[seat] += share + (i === 0 ? pot.amount - share * winners.length : 0)));
  }
  return final;
}

function randomTable(rng: Rng) {
  const n = 2 + rng.int(8);
  const bigBlind = [2, 10, 100, 100, 50, 7][rng.int(6)];
  const smallBlind = Math.max(1, Math.floor(bigBlind / (rng.next() < 0.8 ? 2 : 3)));
  const equal = rng.next() < 0.3;
  const stacks = Array.from({ length: n }, () => {
    if (equal) return 100 * bigBlind;
    const r = rng.next();
    if (r < 0.12) return 1 + rng.int(bigBlind); // at most a big blind
    if (r < 0.45) return bigBlind + rng.int(6 * bigBlind);
    if (r < 0.75) return 6 * bigBlind + rng.int(60 * bigBlind);
    return 60 * bigBlind + rng.int(240 * bigBlind);
  });
  return { stacks, button: rng.int(n), smallBlind, bigBlind };
}

function randomLegal(rng: Rng, la: LegalActions, raisesThisStreet: number): Action {
  const r = rng.next();
  if (la.canFold && r < 0.2) return { type: "fold" };
  if (la.canRaise && r > 1 - 0.35 * 0.6 ** raisesThisStreet) {
    const { minRaiseTo: lo, maxRaiseTo: hi } = la;
    const pick = rng.int(4);
    const to = pick === 0 ? lo : pick === 1 ? hi : lo + rng.int(hi - lo + 1);
    return { type: "raise", to };
  }
  return { type: la.canCheck ? "check" : "call" };
}

/** Actions that must be rejected in this spot. */
function illegalActions(rng: Rng, s: HandState, la: LegalActions): Action[] {
  const bad: Action[] = [];
  if (!la.canFold) bad.push({ type: "fold" });
  if (!la.canCheck) bad.push({ type: "check" });
  if (!la.canCall) bad.push({ type: "call" });
  const maxBet = Math.max(...s.bets);
  if (!la.canRaise) bad.push({ type: "raise", to: s.stacks[la.seat] + s.bets[la.seat] }, { type: "raise", to: maxBet + 1 });
  else {
    bad.push({ type: "raise", to: la.maxRaiseTo + 1 + rng.int(3) }, { type: "raise", to: la.minRaiseTo + 0.5 });
    if (la.minRaiseTo > maxBet + 1) bad.push({ type: "raise", to: la.minRaiseTo - 1 - rng.int(la.minRaiseTo - maxBet - 1) });
  }
  return bad;
}

function checkInvariants(s: HandState, total: number, fail: (msg: string) => void): void {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  if (sum(s.stacks) + sum(s.committed) !== total) fail("chips not conserved");
  for (let i = 0; i < s.seatCount; i++) {
    if (s.stacks[i] < 0 || s.bets[i] < 0 || s.bets[i] > s.committed[i]) fail(`bad amounts at seat ${i}`);
  }
  const collected = s.committed.map((c, i) => c - s.bets[i]);
  const expected = simplePots(collected, s.committed, s.folded.map((f) => !f));
  const got = pots(s);
  if (JSON.stringify(got) !== JSON.stringify(expected)) fail(`pots ${JSON.stringify(got)} != ${JSON.stringify(expected)}`);
  if (sum(got.map((p) => p.amount)) + sum(s.bets) !== potTotal(s)) fail("pots + bets != pot total");
  const la = legalActions(s)!;
  if (s.folded[la.seat] || s.stacks[la.seat] === 0) fail("a folded or all-in player is on the clock");
  if (la.canRaise) {
    const maxBet = Math.max(...s.bets);
    const full = maxBet + Math.max(s.maxIncrement, s.bigBlind);
    if (la.minRaiseTo > la.maxRaiseTo) fail("min raise above max");
    if (la.minRaiseTo !== Math.min(full, la.maxRaiseTo)) fail("min raise is not a full raise (or the all-in)");
    if (la.maxRaiseTo !== s.stacks[la.seat] + s.bets[la.seat]) fail("max raise is not the all-in");
  }
}

describe(`${HANDS.toLocaleString("en-US")} random hands`, () => {
  it("conserve chips, reject illegal actions, build correct pots and always finish", () => {
    const rng = createRng(20261027);
    const failures: string[] = [];
    let decisions = 0;
    let illegalTried = 0;
    let showdowns = 0;
    let sidePotHands = 0;
    for (let h = 0; h < HANDS && failures.length < 5; h++) {
      const table = randomTable(rng);
      const total = table.stacks.reduce((a, b) => a + b, 0);
      let s = createHand(table, { seed: rng.nextU32() });
      const fail = (msg: string) => failures.push(`hand ${h} step ${steps}: ${msg} ${JSON.stringify(table)}`);
      let steps = 0;
      let raises = 0;
      let street = s.street;
      while (!s.complete && failures.length === 0) {
        if (++steps > MAX_STEPS) {
          fail("did not finish");
          break;
        }
        checkInvariants(s, total, fail);
        if (pots(s).length > 1) sidePotHands++;
        const la = legalActions(s)!;
        if (rng.next() < 0.1) {
          for (const bad of illegalActions(rng, s, la)) {
            illegalTried++;
            let accepted = false;
            try {
              applyAction(s, bad);
              accepted = true;
            } catch {
              // expected
            }
            if (accepted) fail(`accepted illegal ${JSON.stringify(bad)} with ${JSON.stringify(la)}`);
          }
        }
        if (s.street !== street) {
          street = s.street;
          raises = 0;
        }
        const action = randomLegal(rng, la, raises);
        if (action.type === "raise") raises++;
        s = applyAction(s, action);
        decisions++;
      }
      if (failures.length > 0) break;
      const result = s.result!;
      if (result.showdown) showdowns++;
      if (s.stacks.reduce((a, b) => a + b, 0) !== total) fail("final chips not conserved");
      if (result.net.reduce((a, b) => a + b, 0) !== 0) fail("net does not sum to zero");
      const sorted = s.committed.slice().sort((a, b) => b - a);
      if (sorted[0] !== sorted[1]) fail("an uncalled bet was left in the pot");
      if (result.showdown && s.board.length !== 5) fail("showdown without a full board");
      const expected = settle(s);
      if (JSON.stringify(result.finalStacks) !== JSON.stringify(expected)) {
        fail(`final stacks ${JSON.stringify(result.finalStacks)} != ${JSON.stringify(expected)}`);
      }
      if (h < 200 && JSON.parse(JSON.stringify(s)).result.finalStacks.join() !== s.stacks.join()) fail("not serializable");
    }
    expect(failures).toEqual([]);
    expect(decisions).toBeGreaterThan(HANDS * 3);
    expect(illegalTried).toBeGreaterThan(50_000);
    expect(showdowns).toBeGreaterThan(HANDS / 10);
    expect(sidePotHands).toBeGreaterThan(1_000);
  }, 120_000);

  it("never mutates the state it is given", () => {
    const rng = createRng(7);
    for (let h = 0; h < 300; h++) {
      let s = createHand(randomTable(rng), { seed: h });
      while (!s.complete) {
        const before = JSON.stringify(s);
        const next = applyAction(s, randomLegal(rng, legalActions(s)!, 0));
        expect(JSON.stringify(s)).toBe(before);
        s = next;
      }
    }
  });
});
