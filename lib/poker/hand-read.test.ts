import { describe, expect, it } from "vitest";
import { createRng, formatCards, FULL_DECK, parseCards, shuffle, type Card } from "./cards";
import { evaluate, handCategoryIndex } from "./evaluator";
import { describeStart, nameHand, oddsByRiver, readHand } from "./hand-read";

const read = (hole: string, board: string) => readHand(parseCards(hole), parseCards(board));
const outsText = (cards: Card[]) => formatCards(cards);
const draws = (hole: string, board: string) => read(hole, board).draws.map((d) => [d.kind, d.outs.length]);

describe("describeStart", () => {
  it("names pairs, suited and offsuit hands, high card first", () => {
    expect(describeStart(parseCards("JsJd"))).toBe("POCKET JACKS");
    expect(describeStart(parseCards("6s6h"))).toBe("POCKET SIXES");
    expect(describeStart(parseCards("AsKs"))).toBe("ACE-KING SUITED");
    expect(describeStart(parseCards("7c2d"))).toBe("SEVEN-TWO OFFSUIT");
    expect(describeStart(parseCards("2dAh"))).toBe("ACE-TWO OFFSUIT");
  });

  it("is what readHand says preflop, with no draws or odds", () => {
    expect(read("JsJd", "")).toEqual({ made: "POCKET JACKS", draws: [], outs: 0, pctByRiver: null });
  });
});

describe("nameHand", () => {
  it.each([
    ["As9d2c5h7sJdKc", "HIGH CARD, ACE"],
    ["Js9dJc5h2s", "ONE PAIR, JACKS"],
    ["Ks7dKc7h2s", "TWO PAIR, KINGS AND SEVENS"],
    ["Ks7dKc7h2s2dAc", "TWO PAIR, KINGS AND SEVENS"],
    ["7s7d7cKh2s", "THREE OF A KIND, SEVENS"],
    ["Ts9d8c7h6s", "STRAIGHT, TEN HIGH"],
    ["As2d3c4h5s", "STRAIGHT, FIVE HIGH"],
    ["AsKdQcJhTs", "STRAIGHT, ACE HIGH"],
    ["As9s2s5sJsKd", "FLUSH, ACE HIGH"],
    ["KsKdKc7h7s", "FULL HOUSE, KINGS FULL OF SEVENS"],
    ["KsKdKc7h7s7d2c", "FULL HOUSE, KINGS FULL OF SEVENS"],
    ["AsAdAcAh2s", "FOUR OF A KIND, ACES"],
    ["9s8s7s6s5sTd", "STRAIGHT FLUSH, NINE HIGH"],
    ["As2s3s4s5s", "STRAIGHT FLUSH, FIVE HIGH"],
    ["AsKsQsJsTs", "ROYAL FLUSH"],
  ])("%s is %s", (cards, name) => {
    expect(nameHand(parseCards(cards))).toBe(name);
  });
});

describe("readHand: draws", () => {
  it("finds a flush draw with 9 outs and flop odds by the river", () => {
    const r = read("AsKs", "Qs7s2d");
    expect(r.made).toBe("HIGH CARD, ACE");
    expect(r.draws).toHaveLength(1);
    expect(r.draws[0]).toMatchObject({ kind: "flush", label: "FLUSH DRAW" });
    expect(outsText(r.draws[0].outs)).toBe("2s3s4s5s6s8s9sTsJs");
    expect(r.outs).toBe(9);
    expect(r.pctByRiver).toBeCloseTo((1 - 703 / 1081) * 100, 10); // 1 - C(38,2)/C(47,2) = 34.97%
  });

  it("uses outs / unseen on the turn", () => {
    const r = read("AsKs", "Qs7s2d3c");
    expect(r.outs).toBe(9);
    expect(r.pctByRiver).toBeCloseTo((9 / 46) * 100, 10);
  });

  it("de-duplicates outs shared by a flush draw and an open-ender", () => {
    const r = read("JsTs", "9s8d2s");
    expect(r.draws.map((d) => [d.kind, d.outs.length])).toEqual([
      ["flush", 9],
      ["open-ended", 8],
    ]);
    expect(outsText(r.draws[1].outs)).toBe("7c7d7h7sQcQdQhQs");
    expect(r.outs).toBe(15); // 7s and Qs counted once
    expect(r.pctByRiver).toBeCloseTo((1 - 496 / 1081) * 100, 10); // 1 - C(32,2)/C(47,2) = 54.1%
    expect(r.draws[0].pctByRiver).toBeCloseTo(oddsByRiver(9, 3), 10);
  });

  it("handles the wheel: 2-3-4-5 is open-ended (ace or six), A-2-3-4 is a 4-out gutshot", () => {
    const open = read("2c5d", "3h4sKc");
    expect(open.draws.map((d) => d.kind)).toEqual(["open-ended"]);
    expect(outsText(open.draws[0].outs)).toBe("6c6d6h6sAcAdAhAs");
    const one = read("Ad4c", "2h3sKc");
    expect(one.draws.map((d) => [d.kind, outsText(d.outs)])).toEqual([["gutshot", "5c5d5h5s"]]);
  });

  it("handles broadway: T-J-Q-K is open-ended (nine or ace), J-Q-K-A is a 4-out gutshot", () => {
    const open = read("QdKc", "TsJh2c");
    expect(open.draws.map((d) => d.kind)).toEqual(["open-ended"]);
    expect(outsText(open.draws[0].outs)).toBe("9c9d9h9sAcAdAhAs");
    const one = read("AhKd", "QcJs2h");
    expect(one.draws.map((d) => [d.kind, outsText(d.outs)])).toEqual([["gutshot", "TcTdThTs"]]);
  });

  it("names a double gutshot (two inside ranks) with 8 outs", () => {
    const r = read("9c5d", "7h8sJc"); // 5-_-7-8-9-_-J
    expect(r.draws.map((d) => [d.kind, d.label, outsText(d.outs)])).toEqual([["double-gutshot", "DOUBLE GUTSHOT", "6c6d6h6sTcTdThTs"]]);
    expect(r.outs).toBe(8);
  });

  it("finds an inside gutshot", () => {
    expect(draws("9c5d", "7h8sKc")).toEqual([["gutshot", 4]]); // 6 makes 5-9
  });

  it("excludes draws that are on the board alone", () => {
    // Four spades on the board, none in hand: a spade gives everyone the same flush.
    expect(read("AhKd", "2s7s9sJs").draws).toEqual([]);
    // 5-6-7-8 on the board: a four or a nine makes a straight the hole cards play no part in.
    expect(read("AcAd", "5h6c7d8s").draws).toEqual([]);
    // Three suited on the board plus one in hand is a draw (the hole card plays).
    expect(draws("2s9d", "As7sKs")).toEqual([["flush", 9]]);
    // On the turn, a straight card that puts a fifth diamond on the board makes the board's flush, not your straight.
    const r = read("Tc9c", "8d9d6dJd");
    expect(r.draws.map((d) => [d.kind, outsText(d.outs)])).toEqual([["open-ended", "7c7h7sQcQhQs"]]);
    // A straight the hole card is part of counts.
    expect(draws("9d2c", "5h6c7dKs")).toEqual([["gutshot", 4]]);
  });

  it("lists no straight draw once you have a straight, and no draws once you have a flush", () => {
    expect(read("Ts9d", "8c7h6s").draws).toEqual([]);
    expect(read("Ts9d", "8c7h6s").made).toBe("STRAIGHT, TEN HIGH");
    // A made straight still draws to a flush.
    expect(draws("Ts9s", "8s7s6d")).toEqual([["flush", 9]]);
    expect(read("9s8s", "7s6s2s").draws).toEqual([]);
    expect(read("As9s", "2s5sJs").made).toBe("FLUSH, ACE HIGH");
  });

  it("keeps draws to a stronger hand than two pair or trips", () => {
    const r = read("Ks7s", "Kc7h2s");
    expect(r.made).toBe("TWO PAIR, KINGS AND SEVENS");
    expect(r.draws).toEqual([]);
    expect(draws("7s7d", "7c8s9s")).toEqual([]); // trips; 8-9 with one seven: no 4 in a row, no 4-flush
    expect(read("7s6s", "7c8s9s").draws.map((d) => d.kind)).toEqual(["flush", "open-ended"]); // 6-7-8-9, four spades
  });

  it("shows no draws on the river", () => {
    expect(read("JsTs", "9s8d2s3c4h")).toMatchObject({ draws: [], outs: 0, pctByRiver: null, made: "HIGH CARD, JACK" });
  });

  it("has no odds on the flop or turn when there are no outs", () => {
    expect(read("AsKd", "2c7h9s")).toMatchObject({ draws: [], outs: 0, pctByRiver: null });
    expect(read("AsKd", "2c7h9s4d")).toMatchObject({ draws: [], outs: 0, pctByRiver: null });
  });

  it("rejects bad input", () => {
    expect(() => read("JsTs", "9s8d")).toThrow();
    expect(() => read("JsTs", "Js8d2c")).toThrow();
    expect(() => readHand(parseCards("Js"), [])).toThrow();
  });
});

describe("oddsByRiver", () => {
  it("matches the formulas", () => {
    expect(oddsByRiver(0, 3)).toBe(0);
    expect(oddsByRiver(4, 3)).toBeCloseTo((1 - (43 * 42) / (47 * 46)) * 100, 10); // 16.47%
    expect(oddsByRiver(8, 3)).toBeCloseTo(31.45, 2);
    expect(oddsByRiver(8, 4)).toBeCloseTo((8 / 46) * 100, 10);
  });
});

describe("readHand: brute-force check of the outs", () => {
  // An out is an unseen card after which your best hand is a straight or flush (or straight flush, while you
  // hold less than a flush) of a stronger category than now, that the board plus that card does not equal.
  function bruteOuts(hole: Card[], board: Card[]): Set<Card> {
    const all = [...hole, ...board];
    const now = handCategoryIndex(evaluate(all));
    const out = new Set<Card>();
    for (const x of FULL_DECK) {
      if (all.includes(x)) continue;
      const v = evaluate([...all, x]);
      const cat = handCategoryIndex(v);
      const drawCat = cat === 4 || cat === 5 || (cat === 8 && now < 5);
      if (!drawCat || cat <= now) continue;
      if (board.length + 1 >= 5 && evaluate([...board, x]) === v) continue;
      out.add(x);
    }
    return out;
  }

  it("agrees on 2,000 random flop and turn spots", () => {
    const rng = createRng(77);
    for (let i = 0; i < 2000; i++) {
      const deck = shuffle([...FULL_DECK], rng);
      const hole = deck.slice(0, 2);
      const board = deck.slice(2, 2 + (i % 2 === 0 ? 3 : 4));
      const r = readHand(hole, board);
      const listed = new Set(r.draws.flatMap((d) => d.outs));
      const expected = bruteOuts(hole, board);
      expect([...listed].sort((a, b) => a - b), `${formatCards(hole)} | ${formatCards(board)}`).toEqual([...expected].sort((a, b) => a - b));
      expect(r.outs).toBe(expected.size);
    }
  });
});
