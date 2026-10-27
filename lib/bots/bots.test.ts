import { describe, expect, it } from "vitest";
import { applyAction, createHand, legalActions, type Action, type HandState } from "../engine/engine";
import { createRng, parseCard, parseCards } from "../poker/cards";
import { COMBO_COUNT, comboIndex, HAND_CLASSES } from "../poker/combinatorics";
import { boardInfo, drawOf, straightOuts } from "./features";
import { MANIAC, MICRO, PERSONA_IDS, PERSONAS, TAG, type Persona } from "./personas";
import { ABSTRACT_ACTIONS, ACTION_COUNT, actionDistribution, chooseAction, strategyAt } from "./policy";
import { PREFLOP_ORDER, PREFLOP_PCT, topRange } from "./preflop";
import { inferRange } from "./range";
import { playHand } from "./simulate";
import { emptyCounts, recordHand, summarize, type StatCounts } from "./stats";
import { botView, publicHistory, publicView, replay, seatPositions } from "./view";

const ALL = PERSONA_IDS.map((id) => PERSONAS[id]);
const combo = (text: string) => {
  const [a, b] = parseCards(text);
  return comboIndex(a, b);
};

/** Mixed tables of 2-6 bots with some uneven stacks, for tests that need many real decisions. */
function randomTable(rng: ReturnType<typeof createRng>) {
  const n = 2 + rng.int(5);
  const personas: Persona[] = Array.from({ length: n }, () => ALL[rng.int(ALL.length)]);
  const stacks = Array.from({ length: n }, () => (rng.next() < 0.7 ? 10_000 : 300 + rng.int(20_000)));
  return { personas, stacks, button: rng.int(n) };
}

/** Plays a hand from scripted actions on a fixed deck (hole cards dealt one at a time from the button's left). */
function scripted(stacks: number[], deckText: string, actions: Action[]): HandState {
  let s = createHand({ stacks, button: 0 }, { deck: parseCards(deckText) });
  for (const a of actions) s = applyAction(s, a);
  return s;
}

describe("views", () => {
  it("expose only public information plus the seat's own cards", () => {
    const s = createHand({ stacks: [10_000, 10_000, 10_000], button: 0 }, { seed: 3 });
    const v = publicView(s, 1);
    expect(Object.keys(v)).not.toContain("deck");
    expect(Object.keys(v)).not.toContain("holeCards");
    const text = JSON.stringify(v);
    expect(text).not.toContain('"deck"');
    expect(text).not.toContain('"holeCards"');
    const b = botView(s, 2);
    expect(b.holeCards).toEqual(s.holeCards[2]);
    expect(Object.keys(b).sort()).toEqual([...Object.keys(v), "holeCards"].sort());
    // Legal actions only for the seat on the clock (seat 0, the button, acts first 3-handed).
    expect(publicView(s, 0).legal).toEqual(legalActions(s));
    expect(v.legal).toBeNull();
    // Copies, not references into the state.
    v.stacks[0] = -1;
    v.board.push(0);
    expect(s.stacks[0]).toBe(10_000);
    expect(s.board).toEqual([]);
  });

  it("names positions", () => {
    expect(seatPositions(6, 0)).toEqual(["BTN", "SB", "BB", "UTG", "HJ", "CO"]);
    expect(seatPositions(2, 1)).toEqual(["BB", "BTN"]);
    expect(seatPositions(9, 8)).toEqual(["SB", "BB", "UTG", "MP", "MP", "LJ", "HJ", "CO", "BTN"]);
    expect(seatPositions(3, 2)).toEqual(["SB", "BB", "BTN"]);
  });

  it("replay rebuilds every view from the public history alone", () => {
    const rng = createRng(11);
    for (let h = 0; h < 40; h++) {
      const table = randomTable(rng);
      const seed = rng.nextU32();
      // Record the real views as the hand is played.
      let s = createHand(table, { seed });
      const real: string[] = [];
      const actRng = createRng(seed);
      while (!s.complete) {
        const seat = legalActions(s)!.seat;
        real.push(JSON.stringify(publicView(s, seat)));
        s = applyAction(s, chooseAction(table.personas[seat], botView(s, seat), actRng).action);
      }
      const { decisions, board } = replay(publicHistory(s));
      expect(decisions.map((d) => JSON.stringify(d.view))).toEqual(real);
      expect(board).toEqual(s.board);
    }
  });
});

describe("preflop ranking", () => {
  it("orders all 169 classes once, strongest first", () => {
    expect(new Set(PREFLOP_ORDER).size).toBe(169);
    expect(PREFLOP_ORDER.slice().sort()).toEqual(HAND_CLASSES.map((c) => c.name).sort());
    expect(PREFLOP_ORDER[0]).toBe("AA");
    expect(PREFLOP_ORDER[168]).toBe("72o");
    expect(PREFLOP_PCT[combo("AsAh")]).toBeLessThan(PREFLOP_PCT[combo("KsKh")]);
    expect(PREFLOP_PCT[combo("7s2h")]).toBeGreaterThan(0.99);
  });

  it("gives sensible top-X% ranges", () => {
    expect(topRange(0.025)).toBe("JJ+, AQs+");
    expect(topRange(0.05)).toBe("TT+, AJs+, AQo+, KQs");
    const btn = topRange(0.42);
    expect(btn).toContain("22+");
    expect(btn).toContain("A2+");
  });
});

describe("postflop features", () => {
  it("finds draws", () => {
    const info = boardInfo(parseCards("9h8h2c"));
    expect(drawOf(info, combo("AhKh"))).toBe("flush");
    expect(drawOf(info, combo("TcJd"))).toBe("straight");
    expect(drawOf(info, combo("Jh7c"))).toBe("gutshot"); // 7-8-9-J needs a T
    expect(drawOf(info, combo("ThJh"))).toBe("combo");
    expect(drawOf(info, combo("QcTd"))).toBe("gutshot");
    expect(drawOf(info, combo("AcKd"))).toBe("none");
    expect(drawOf(boardInfo(parseCards("9h8h2c3d4s")), combo("AhKh"))).toBe("none"); // river
    expect(straightOuts(0b1111)).toBe(2); // 2345: A or 6
    expect(straightOuts(0b11111)).toBe(-1);
  });

  it("ranks made hands as percentiles", () => {
    const info = boardInfo(parseCards("AsKdQh7c2s"));
    expect(info.strength[combo("JcTd")]).toBeGreaterThan(0.99); // the nut straight
    expect(info.strength[combo("4c3d")]).toBeLessThan(0.05);
    expect(info.strength[combo("AsKd")]).toBe(0); // uses board cards: dead
    expect(info.texture.paired).toBe(false);
    expect(boardInfo(parseCards("8h8d8s")).texture.paired).toBe(true);
    expect(() => boardInfo(parseCards("8h8d"))).toThrow();
  });
});

describe("strategy", () => {
  it("is a distribution over legal actions for every live combo, and matches the single-combo policy", () => {
    const rng = createRng(5);
    const failures: string[] = [];
    let checked = 0;
    for (let h = 0; h < 60; h++) {
      const table = randomTable(rng);
      let s = createHand(table, { seed: rng.nextU32() });
      while (!s.complete) {
        const seat = legalActions(s)!.seat;
        const persona = table.personas[seat];
        const view = publicView(s, seat);
        const st = strategyAt(persona, view);
        for (let a = 0; a < ACTION_COUNT; a++) {
          // Every concrete action the policy can choose is accepted by the engine.
          if (st.concrete[a]) expect(() => applyAction(s, st.concrete[a]!)).not.toThrow();
        }
        for (let c = 0; c < COMBO_COUNT; c++) {
          if (!st.live[c]) {
            if (view.board.length === 0) failures.push("a preflop combo is dead");
            continue;
          }
          let sum = 0;
          for (let a = 0; a < ACTION_COUNT; a++) {
            const p = st.probs[c * ACTION_COUNT + a];
            if (!(p >= 0)) failures.push(`negative probability ${p}`);
            if (p > 0 && !st.concrete[a]) failures.push(`probability on illegal ${ABSTRACT_ACTIONS[a]}`);
            sum += p;
          }
          if (Math.abs(sum - 1) > 1e-9) failures.push(`row sums to ${sum}`);
          checked++;
        }
        const own = comboIndex(s.holeCards[seat][0], s.holeCards[seat][1]);
        expect(Array.from(actionDistribution(persona, view, own))).toEqual(
          Array.from(st.probs.subarray(own * ACTION_COUNT, (own + 1) * ACTION_COUNT)),
        );
        s = applyAction(s, chooseAction(persona, botView(s, seat), rng).action);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(300_000);
  });

  it("removes dead cards", () => {
    const s = createHand({ stacks: [10_000, 10_000], button: 0 }, { seed: 1 });
    const st = strategyAt(TAG, publicView(s, 0), [parseCard("As")]);
    expect(st.live[combo("AsKs")]).toBe(0);
    expect(st.live[combo("AhKs")]).toBe(1);
    expect(st.live.reduce((a, b) => a + b, 0)).toBe(COMBO_COUNT - 51);
  });

  it("plays sensible preflop strategies", () => {
    // Folded to the TAG on the button (6-max): AA always raises, 72o always folds.
    let s = createHand({ stacks: new Array(6).fill(10_000), button: 0 }, { seed: 1 });
    for (let i = 0; i < 3; i++) s = applyAction(s, { type: "fold" }); // UTG, HJ, CO
    const st = strategyAt(TAG, publicView(s, 0));
    const raise = ABSTRACT_ACTIONS.indexOf("raise");
    const fold = ABSTRACT_ACTIONS.indexOf("fold");
    expect(st.probs[combo("AsAh") * ACTION_COUNT + raise]).toBe(1);
    expect(st.probs[combo("7s2h") * ACTION_COUNT + fold]).toBe(1);
    expect(st.concrete[raise]).toEqual({ type: "raise", to: 250 });
    // The station limps hands the TAG raises or folds.
    const station = strategyAt(PERSONAS.station, publicView(s, 0));
    expect(station.probs[combo("Kc9d") * ACTION_COUNT + ABSTRACT_ACTIONS.indexOf("call")]).toBeGreaterThan(0.9);
  });

  it("makes the micro persona a river underbluffer that is sticky on the flop and folds to turn barrels", () => {
    // Heads-up, button 0 opens and bets flop and turn; the big blind calls. Holes go BB, BTN, BB, BTN.
    const deck = "2c3d4h5s Kh7d2s 9c Qd";
    const line: Action[] = [
      { type: "raise", to: 250 },
      { type: "call" },
      { type: "check" },
      { type: "raise", to: 165 },
      { type: "call" },
      { type: "check" },
      { type: "raise", to: 400 },
      { type: "call" },
      { type: "check" },
    ];
    /** Average probability of `actions` over live combos (optionally only those weaker than `maxStrength`). */
    const average = (p: Persona, steps: number, seat: number, actions: string[], maxStrength = 1) => {
      const st = strategyAt(p, publicView(scripted([10_000, 10_000], deck, line.slice(0, steps)), seat));
      let total = 0, n = 0;
      for (let c = 0; c < COMBO_COUNT; c++) {
        if (!st.live[c] || st.spot.board!.strength[c] > maxStrength) continue;
        n++;
        for (const a of actions) total += st.probs[c * ACTION_COUNT + ABSTRACT_ACTIONS.indexOf(a as never)];
      }
      return total / n;
    };
    const bets = ["bet33", "bet66", "bet100", "allin"];
    // River, checked to the button with the bottom 30% of hands (air): the micro almost never bluffs.
    expect(average(MICRO, 9, 0, bets, 0.3)).toBeLessThan(0.05);
    expect(average(TAG, 9, 0, bets, 0.3)).toBeGreaterThan(0.15);
    expect(average(MANIAC, 9, 0, bets, 0.3)).toBeGreaterThan(average(TAG, 9, 0, bets, 0.3));
    // Facing the flop c-bet the micro folds less than the TAG; facing the turn barrel it folds more.
    expect(average(MICRO, 4, 1, ["fold"])).toBeLessThan(average(TAG, 4, 1, ["fold"]) - 0.05);
    expect(average(MICRO, 7, 1, ["fold"])).toBeGreaterThan(average(TAG, 7, 1, ["fold"]) + 0.05);
  });
});

describe("determinism", () => {
  it("replays the same hand from the same seed", () => {
    const rng = createRng(99);
    for (let h = 0; h < 50; h++) {
      const table = randomTable(rng);
      const seed = rng.nextU32();
      expect(JSON.stringify(playHand(table, seed))).toBe(JSON.stringify(playHand(table, seed)));
    }
    const table = { personas: ALL, stacks: new Array(6).fill(10_000), button: 0 };
    const hands = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(playHand(table, i))));
    expect(hands.size).toBe(20);
  });
});

describe("range inference", () => {
  it("always keeps the bot's true hand, at every point of the hand", () => {
    const rng = createRng(2026);
    let ranges = 0;
    let narrowed = 0;
    for (let h = 0; h < 250; h++) {
      const table = randomTable(rng);
      const s = playHand(table, rng.nextU32());
      const history = publicHistory(s);
      for (let seat = 0; seat < s.seatCount; seat++) {
        const truth = comboIndex(s.holeCards[seat][0], s.holeCards[seat][1]);
        const range = inferRange(table.personas[seat], history, seat);
        ranges++;
        expect(range[truth]).toBeGreaterThan(0);
        expect(Math.abs(range.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-9);
        if (range[truth] > 1 / 1000) narrowed++;
        // Mid-hand too: the range after a random prefix of the actions.
        const upTo = rng.int(history.actions.length + 1);
        expect(inferRange(table.personas[seat], history, seat, { upTo })[truth]).toBeGreaterThan(0);
      }
    }
    expect(ranges).toBeGreaterThan(900);
    // The posterior is informative: the true combo is usually well above the uniform 1/1326.
    expect(narrowed / ranges).toBeGreaterThan(0.5);
  });

  it("is the normalized product of the bot's action probabilities", () => {
    // Folded to the TAG on the button, it opens; the range is the opening strategy, normalized.
    let s = createHand({ stacks: new Array(6).fill(10_000), button: 0 }, { seed: 4 });
    for (let i = 0; i < 3; i++) s = applyAction(s, { type: "fold" });
    const st = strategyAt(TAG, publicView(s, 0));
    s = applyAction(s, { type: "raise", to: 250 });
    const range = inferRange(TAG, publicHistory(s), 0);
    const raise = ABSTRACT_ACTIONS.indexOf("raise");
    let total = 0;
    for (let c = 0; c < COMBO_COUNT; c++) total += st.probs[c * ACTION_COUNT + raise];
    for (const c of [combo("AsAh"), combo("Ts9s"), combo("7s2h"), combo("Kd8c")]) {
      expect(range[c]).toBeCloseTo(st.probs[c * ACTION_COUNT + raise] / total, 12);
    }
    expect(range[combo("7s2h")]).toBe(0);
    // Dead cards are removed and the rest renormalized.
    const withDead = inferRange(TAG, publicHistory(s), 0, { dead: parseCards("AsAh") });
    expect(withDead[combo("AsKs")]).toBe(0);
    expect(withDead[combo("AdAc")]).toBeGreaterThan(range[combo("AdAc")]);
  });

  it("rejects actions the persona never takes", () => {
    let s = createHand({ stacks: new Array(6).fill(10_000), button: 0 }, { seed: 4 });
    for (let i = 0; i < 3; i++) s = applyAction(s, { type: "fold" });
    s = applyAction(s, { type: "raise", to: 777 }); // not a TAG open size
    expect(() => inferRange(TAG, publicHistory(s), 0)).toThrow(/never does/);
  });
});

describe("stats", () => {
  it("counts VPIP, PFR, 3-bets, c-bets and showdowns", () => {
    // 3-handed, button 0: seat 0 opens, seat 1 (SB) 3-bets, seat 2 (BB) folds, seat 0 calls.
    // Flop: SB (the preflop raiser) c-bets, button folds.
    const s = scripted([10_000, 10_000, 10_000], "2c3d4h5s6c7d Kh7c2s 9c Qd", [
      { type: "raise", to: 250 },
      { type: "raise", to: 900 },
      { type: "fold" },
      { type: "call" },
      { type: "raise", to: 600 },
      { type: "fold" },
    ]);
    const counts = new Map<string, StatCounts>();
    recordHand(counts, s, (seat) => `s${seat}`);
    expect(counts.get("s0")).toMatchObject({ hands: 1, vpip: 1, pfr: 1, threeBetChances: 0, sawFlop: 1, cbetsFaced: 1, cbetFolds: 1, folds: 1 });
    expect(counts.get("s1")).toMatchObject({ vpip: 1, pfr: 1, threeBetChances: 1, threeBets: 1, bets: 1, showdowns: 0 });
    expect(counts.get("s2")).toMatchObject({ vpip: 0, pfr: 0, threeBetChances: 0, sawFlop: 0 });
    const hud = summarize(counts);
    expect(hud.find((x) => x.label === "s1")!.threeBet).toBe(100);
    expect(emptyCounts().hands).toBe(0);
  });
});
