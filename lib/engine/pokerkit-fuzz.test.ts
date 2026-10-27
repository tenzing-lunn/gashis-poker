// Differential fuzz: replays hands generated through pokerkit 0.7.7 (MIT, test-only; see
// oracle/gen_pokerkit_fixtures.py for the format) and checks that the engine agrees at every decision:
// street, actor, legal actions, min/max raise-to, bets, stacks, pots (amount and eligibility), total pot,
// and final stacks.
//
// Rerun on fresh hands without committing them:
//   python lib/engine/oracle/gen_pokerkit_fixtures.py --hands 20000 --seed 99 --out /tmp/big.json
//   ENGINE_FUZZ_FIXTURE=/tmp/big.json npx vitest run lib/engine/pokerkit-fuzz.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyAction, createHand, legalActions, pots, potTotal, STREETS, type Action, type HandState } from "./engine";

type PkPot = [number, number[]];
type Dev = [number, string, number?, number?];
type Step = [
  street: number,
  board: number,
  actor: number,
  canFold: number,
  call: number,
  canRaise: number,
  minTo: number | null,
  maxTo: number | null,
  bets: number[],
  stacks: number[],
  pots: PkPot[],
  total: number,
  action: "f" | "c" | number,
  dev?: Dev,
];
interface FixtureHand {
  n: number;
  button: number;
  seatOfPk: number[];
  sb: number;
  bb: number;
  stacks: number[];
  deck: number[];
  steps: Step[];
  final: number[];
}

const fixturePath = process.env.ENGINE_FUZZ_FIXTURE ?? path.join(__dirname, "oracle", "pokerkit-hands.json");
const usingDefault = !process.env.ENGINE_FUZZ_FIXTURE;

/** Returns a description of every disagreement in one hand (empty when the engine matches pokerkit). */
function replay(hand: FixtureHand): { problems: string[]; devSteps: number } {
  const problems: string[] = [];
  const { n, seatOfPk } = hand;
  const toSeats = (pkArray: readonly number[]): number[] => {
    const bySeat = new Array<number>(n);
    pkArray.forEach((v, k) => (bySeat[seatOfPk[k]] = v));
    return bySeat;
  };
  const check = (label: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`${label}: engine ${JSON.stringify(got)}, pokerkit ${JSON.stringify(want)}`);
    }
  };

  for (let k = 0; k < n; k++) check(`seatOfPk[${k}]`, seatOfPk[k], (hand.button + 1 + k) % n);
  let state: HandState = createHand(
    { stacks: toSeats(hand.stacks), button: hand.button, smallBlind: hand.sb, bigBlind: hand.bb },
    { deck: hand.deck },
  );
  let devSteps = 0;
  for (let i = 0; i < hand.steps.length && problems.length === 0; i++) {
    const [street, board, actor, canFold, call, canRaise, minTo, maxTo, bets, stacks, pkPots, total, action, dev] =
      hand.steps[i];
    const at = (what: string) => `step ${i} ${what}`;
    const la = legalActions(state);
    if (la === null) {
      problems.push(at("engine says the hand is over"));
      break;
    }
    check(at("street"), state.street, STREETS[street]);
    check(at("board size"), state.board.length, board);
    check(at("actor"), la.seat, seatOfPk[actor]);
    check(at("canFold"), la.canFold, canFold === 1);
    check(at("call amount"), la.callAmount, call);
    if (dev) devSteps++;
    const wantRaise = dev ? dev[0] === 1 : canRaise === 1;
    check(at("canRaise"), la.canRaise, wantRaise);
    if (wantRaise) {
      check(at("minRaiseTo"), la.minRaiseTo, dev ? dev[2] : minTo);
      check(at("maxRaiseTo"), la.maxRaiseTo, dev ? dev[3] : maxTo);
    }
    check(at("bets"), state.bets, toSeats(bets));
    check(at("stacks"), state.stacks, toSeats(stacks));
    const wantPots = pkPots.map(([amount, eligible]) => ({
      amount,
      eligible: eligible.map((pk) => seatOfPk[pk]).sort((a, b) => a - b),
    }));
    check(at("pots"), pots(state), wantPots);
    check(at("total pot"), potTotal(state), total);
    if (problems.length > 0) break;

    const act: Action =
      action === "f" ? { type: "fold" } : action === "c" ? { type: la.canCheck ? "check" : "call" } : { type: "raise", to: action };
    try {
      state = applyAction(state, act);
    } catch (err) {
      problems.push(at(`engine rejected ${JSON.stringify(act)}: ${(err as Error).message}`));
    }
  }
  if (problems.length === 0) {
    if (!state.complete) problems.push("pokerkit's hand ended but the engine's did not");
    else check("final stacks", state.result!.finalStacks, toSeats(hand.final));
  }
  return { problems, devSteps };
}

describe(`engine vs pokerkit (${usingDefault ? "committed fixture" : fixturePath})`, () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { hands: FixtureHand[] };

  it("replays every hand with identical actors, legal actions, bets, stacks, pots and final stacks", () => {
    const failures: string[] = [];
    let decisions = 0;
    let devSteps = 0;
    for (let h = 0; h < fixture.hands.length; h++) {
      const result = replay(fixture.hands[h]);
      decisions += fixture.hands[h].steps.length;
      devSteps += result.devSteps;
      if (result.problems.length > 0 && failures.length < 10) failures.push(`hand ${h}: ${result.problems.join("; ")}`);
      else if (result.problems.length > 0) failures.push(`hand ${h}`);
    }
    console.log(
      `pokerkit fuzz: ${fixture.hands.length} hands, ${decisions} decisions, ${devSteps} Rule 96 deviation points, ` +
        `${failures.length} mismatching hands`,
    );
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures.length).toBe(0);
    if (usingDefault) {
      expect(fixture.hands.length).toBe(2000);
      expect(devSteps).toBeGreaterThan(0); // the strict Rule 96 cases are exercised
    }
  }, 600_000);

  it("covers the edge cases it is meant to", () => {
    const hands = fixture.hands;
    const sizes = new Set(hands.map((h) => h.n));
    for (const n of [2, 3, 4, 5, 6]) expect(sizes.has(n)).toBe(true);
    // A stack below the big blind, a side pot, and an all-in raise smaller than the minimum raise.
    expect(hands.some((h) => h.stacks.some((s) => s < h.bb))).toBe(true);
    expect(hands.some((h) => h.steps.some((s) => s[10].length > 1))).toBe(true);
    expect(
      hands.some((h) =>
        h.steps.some((s) => typeof s[12] === "number" && s[6] !== null && s[6] === s[7] && s[12] === s[7] && s[6] < Math.max(...s[8]) + h.bb),
      ),
    ).toBe(true);
  });
});
