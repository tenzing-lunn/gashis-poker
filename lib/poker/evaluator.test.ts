import { describe, expect, it } from "vitest";
import { createRng, parseCards, shuffle, FULL_DECK, type Card } from "./cards";
import {
  DISPLACEMENT,
  FLUSH_TABLE,
  HAND_CATEGORIES,
  NONFLUSH_TABLE,
  evaluate,
  evaluate5,
  evaluate6,
  evaluate7,
  evaluateWith,
  handCategory,
  handState,
} from "./evaluator";
import { naiveBest, naiveScore5 } from "./testing/naive-evaluator";

const ev = (s: string) => evaluate(parseCards(s));

function randomHand(rng: ReturnType<typeof createRng>, n: number): Card[] {
  return shuffle([...FULL_DECK], rng).slice(0, n);
}

describe("evaluator: all 2,598,960 five-card hands", () => {
  it("gives the exact category counts and 7462 distinct values", () => {
    const counts = new Array(9).fill(0);
    const seen = new Uint8Array(7463);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              const v = evaluate5(a, b, c, d, e);
              seen[v] = 1;
              counts[HAND_CATEGORIES.indexOf(handCategory(v))]++;
            }
    expect(Object.fromEntries(HAND_CATEGORIES.map((name, i) => [name, counts[i]]))).toEqual({
      "straight flush": 40,
      quads: 624,
      "full house": 3744,
      flush: 5108,
      straight: 10_200,
      trips: 54_912,
      "two pair": 123_552,
      pair: 1_098_240,
      "high card": 1_302_540,
    });
    expect(seen.reduce((s, x) => s + x, 0)).toBe(7462);
    expect(seen[1] && seen[7462]).toBe(1);
  });
});

describe("evaluator: ordering", () => {
  it("wheel is the lowest straight and the lowest straight flush", () => {
    const wheel = ev("Ac2d3h4s5c");
    expect(handCategory(wheel)).toBe("straight");
    expect(wheel).toBeLessThan(ev("2c3d4h5s6c"));
    expect(wheel).toBeGreaterThan(ev("AcAdAhKsQc")); // beats any trips
    const steelWheel = ev("Ah2h3h4h5h");
    expect(handCategory(steelWheel)).toBe("straight flush");
    expect(steelWheel).toBeLessThan(ev("2h3h4h5h6h"));
    expect(steelWheel).toBeGreaterThan(ev("AsAhAdAcKs"));
    expect(ev("ThJhQhKhAh")).toBe(7462);
    expect(ev("2c3d4h5s7c")).toBe(1); // worst hand
    // A-K-Q-J-9 is not a straight; K-A-2-3-4 doesn't wrap.
    expect(handCategory(ev("AcKdQhJs9c"))).toBe("high card");
    expect(handCategory(ev("Kc Ad 2h 3s 4c"))).toBe("high card");
  });

  it("orders hands across and within categories", () => {
    const ladder = [
      "2c3d4h5s7c", "AcKdQhJs9c", "2c2d3h4s5c", "AcAdKhQsJc",
      "2c2d3h3s4c", "AcAdKhKsQc", "2c2d2h3s4c", "AcAdAhKsQc", "Ac2d3h4s5c", "TcJdQhKsAc",
      "2h3h4h5h7h", "AhKhQhJh9h", "2c2d2h3s3c", "AcAdAhKsKc", "2c2d2h2s3c", "AcAdAhAsKc",
      "Ah2h3h4h5h", "ThJhQhKhAh",
    ];
    const values = ladder.map(ev);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    // Kickers matter; suits don't.
    expect(ev("AcAdKhQsJc")).toBeGreaterThan(ev("AcAdKhQsTc"));
    expect(ev("AcAdKhQsJc")).toBe(ev("AhAsKcQdJd"));
    // Two pair: the fifth card plays.
    expect(ev("KcKdQhQs3c")).toBeLessThan(ev("KcKdQhQs4c"));
  });

  it("agrees with an independent naive evaluator on random 5-card pairs", () => {
    const rng = createRng(123);
    for (let i = 0; i < 20_000; i++) {
      const x = randomHand(rng, 5), y = randomHand(rng, 5);
      expect(Math.sign(evaluate(x) - evaluate(y))).toBe(Math.sign(naiveScore5(x) - naiveScore5(y)));
    }
  });
});

describe("evaluator: 6 and 7 cards equal the best 5-card subset", () => {
  function bestSubset(cards: Card[]): number {
    let best = 0;
    const n = cards.length;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++)
          for (let d = c + 1; d < n; d++)
            for (let e = d + 1; e < n; e++) best = Math.max(best, evaluate5(cards[a], cards[b], cards[c], cards[d], cards[e]));
    return best;
  }

  it("random 6- and 7-card hands", () => {
    const rng = createRng(2024);
    for (let i = 0; i < 30_000; i++) {
      const h7 = randomHand(rng, 7);
      const v7 = evaluate7(h7[0], h7[1], h7[2], h7[3], h7[4], h7[5], h7[6]);
      expect(v7).toBe(bestSubset(h7));
      expect(evaluate(h7)).toBe(v7);
      const h6 = h7.slice(0, 6);
      expect(evaluate6(h6[0], h6[1], h6[2], h6[3], h6[4], h6[5])).toBe(bestSubset(h6));
    }
  });

  it("flush-heavy random 7-card hands (5-7 cards of one suit)", () => {
    const rng = createRng(99);
    for (let i = 0; i < 20_000; i++) {
      const suit = rng.int(4);
      const suited = shuffle(FULL_DECK.filter((c) => (c & 3) === suit), rng).slice(0, 5 + rng.int(3));
      const rest = shuffle(FULL_DECK.filter((c) => !suited.includes(c)), rng).slice(0, 7 - suited.length);
      const h = [...suited, ...rest];
      expect(evaluate(h)).toBe(bestSubset(h));
    }
  });

  it("matches the naive best-of-21 evaluator ordering on random 7-card pairs", () => {
    const rng = createRng(5);
    for (let i = 0; i < 3000; i++) {
      const x = randomHand(rng, 7), y = randomHand(rng, 7);
      expect(Math.sign(evaluate(x) - evaluate(y))).toBe(Math.sign(naiveBest(x) - naiveBest(y)));
    }
  });

  it("incremental evaluation (board state + hole cards) equals direct evaluation", () => {
    const rng = createRng(77);
    for (let i = 0; i < 10_000; i++) {
      const h = randomHand(rng, 7);
      const board = h.slice(0, 3 + rng.int(3));
      const hole = h.slice(5, 7);
      expect(evaluateWith(handState(board), ...hole)).toBe(evaluate([...board, ...hole]));
    }
  });

  it("rejects the wrong number of cards", () => {
    expect(() => evaluate(parseCards("AsKs"))).toThrow();
    expect(() => evaluate(parseCards("AsKsQsJsTs9s8s7s"))).toThrow();
  });

  it("evaluate/handState reject duplicate and invalid card ids", () => {
    expect(() => evaluate([51, 51, 0, 1, 2])).toThrow(/Duplicate/);
    expect(() => evaluate([52, 0, 1, 2, 3])).toThrow(/Invalid card/);
    expect(() => evaluate([-1, 0, 1, 2, 3])).toThrow(/Invalid card/);
    expect(() => evaluate([1.5, 0, 4, 8, 12])).toThrow(/Invalid card/);
    expect(() => handState([0, 0])).toThrow(/Duplicate/);
    expect(() => handState([60])).toThrow(/Invalid card/);
    expect(() => handState(parseCards("2c3c4c5c6c7c8c9c"))).toThrow(/at most 7/);
  });

  it("evaluateWith enforces 5-7 distinct, valid cards in total", () => {
    const board = handState(parseCards("AhKhQhJh9h"));
    expect(() => evaluateWith(board, ...parseCards("AsAdKs"))).toThrow(/5-7 cards/);
    expect(() => evaluateWith(handState(parseCards("AhKh")), ...parseCards("Qh"))).toThrow(/5-7 cards/);
    expect(() => evaluateWith(board, ...parseCards("Ah2c"))).toThrow(/Duplicate/);
    expect(() => evaluateWith(board, 0, 0)).toThrow(/Duplicate/);
    expect(() => evaluateWith(board, 52)).toThrow(/Invalid card/);
    expect(handCategory(evaluateWith(handState(parseCards("AhKhQhJs9s")), ...parseCards("AsAd")))).toBe("trips");
    expect(evaluateWith(board, ...parseCards("2c3d"))).toBe(ev("AhKhQhJh9h"));
  });
});

describe("evaluator: tables", () => {
  it("stays well under 1 MB", () => {
    const bytes = NONFLUSH_TABLE.byteLength + DISPLACEMENT.byteLength + FLUSH_TABLE.byteLength;
    expect(bytes).toBeLessThan(400 * 1024);
  });
});
