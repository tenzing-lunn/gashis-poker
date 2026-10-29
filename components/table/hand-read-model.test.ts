import { describe, expect, it } from "vitest";
import { applyAction, createHand } from "@/lib/engine/engine";
import { parseCards } from "@/lib/poker/cards";
import { readHand } from "@/lib/poker/hand-read";
import { heroRead, narrowReadText, panelView, popupSecondsLeft, RESULT_MS } from "./hand-read-model";
import { modelFromHand, type TableModel } from "./model";

const names = ["YOU", "BOT1", "BOT2"];

/** A live 3-seat hand with the hero's cards and the board set by hand. */
function live(hole: string, board: string): TableModel {
  const m = modelFromHand(createHand({ stacks: [10000, 10000, 10000], button: 0 }, { seed: 7 }), 0, names, { handNo: 1 });
  const seats = m.seats.map((s, i) => (i === 0 ? { ...s, holeCards: parseCards(hole) } : s));
  return { ...m, seats, board: parseCards(board) };
}

describe("heroRead", () => {
  it("reads the hero's cards against the board", () => {
    expect(heroRead(live("AsKs", ""))).toEqual(readHand(parseCards("AsKs"), []));
    expect(heroRead(live("9h8h", "Th7c2h"))).toEqual(readHand(parseCards("9h8h"), parseCards("Th7c2h")));
    expect(heroRead(live("9h8h", "Th7c2hJd5s"))).toEqual(readHand(parseCards("9h8h"), parseCards("Th7c2hJd5s")));
  });

  it("is null when watching, before the first hand, between hands and after a fold", () => {
    const m = live("AsKs", "Qs7s2d");
    expect(heroRead({ ...m, heroSeat: null })).toBeNull();
    expect(heroRead({ ...m, handNo: 0 })).toBeNull();
    expect(heroRead({ ...m, complete: true })).toBeNull();
    expect(heroRead({ ...m, seats: m.seats.map((s, i) => (i === 0 ? { ...s, out: true } : s)) })).toBeNull();
    expect(heroRead({ ...m, seats: m.seats.map((s, i) => (i === 0 ? { ...s, holeCards: "hidden" as const } : s)) })).toBeNull();
  });

  it("goes away once the hero folds in a real hand", () => {
    let s = createHand({ stacks: [10000, 10000, 10000], button: 0 }, { seed: 7 });
    // Button (the hero) acts first three-handed preflop.
    s = applyAction(s, { type: "fold" });
    expect(heroRead(modelFromHand(s, 0, names, { handNo: 1 }))).toBeNull();
  });
});

describe("narrowReadText", () => {
  it("is the starting hand preflop and the made hand on the river", () => {
    expect(narrowReadText(readHand(parseCards("JsJd"), []))).toBe("POCKET JACKS");
    expect(narrowReadText(readHand(parseCards("KsKd"), parseCards("Kh7c7d2s3h")))).toBe("FULL HOUSE, KINGS FULL OF SEVENS");
  });

  it("is the whole made hand when there is nothing to draw to", () => {
    expect(narrowReadText(readHand(parseCards("KsKd"), parseCards("7c7d2s")))).toBe("TWO PAIR, KINGS AND SEVENS");
  });

  it("gives the short made hand, total outs and odds, then the draws (names last, so truncation only cuts names)", () => {
    const one = readHand(parseCards("AsKs"), parseCards("Qs7s2d"));
    expect(narrowReadText(one)).toBe(`HIGH CARD · 9 OUTS ${Math.round(one.pctByRiver!)}% · FLUSH DRAW`);
    const combo = readHand(parseCards("9h8h"), parseCards("Th7c2h"));
    expect(narrowReadText(combo)).toBe(`HIGH CARD · 15 OUTS ${Math.round(combo.pctByRiver!)}% · FLUSH DRAW + OPEN-ENDED`);
    const pairCombo = readHand(parseCards("9h8h"), parseCards("9c7h6h"));
    expect(narrowReadText(pairCombo)).toMatch(/^ONE PAIR · \d+ OUTS \d+% · FLUSH DRAW \+ OPEN-ENDED$/);
  });
});

describe("panelView", () => {
  it("has no draws section preflop or on the river", () => {
    expect(panelView(readHand(parseCards("AsKs"), []), 0)).toEqual({ title: "STARTING HAND", made: "ACE-KING SUITED", draws: null, total: null });
    const river = panelView(readHand(parseCards("AsKs"), parseCards("Qs7s2dJh3c")), 5);
    expect(river.draws).toBeNull();
    expect(river.total).toBeNull();
  });

  it("lists each draw, and a total only for more than one", () => {
    const one = panelView(readHand(parseCards("AsKs"), parseCards("Qs7s2d")), 3);
    expect(one.draws).toHaveLength(1);
    expect(one.draws![0]).toMatchObject({ label: "FLUSH DRAW", outs: "9 OUTS" });
    expect(one.total).toBeNull();
    const combo = readHand(parseCards("9h8h"), parseCards("Th7c2h"));
    const two = panelView(combo, 3);
    expect(two.draws!.map((d) => d.label)).toEqual(["FLUSH DRAW", "OPEN-ENDED"]);
    expect(two.total).toEqual({ label: "TOTAL", outs: "15 OUTS", pct: `${Math.round(combo.pctByRiver!)}%` });
  });

  it("has an empty draws list on the flop or turn with nothing to draw to", () => {
    expect(panelView(readHand(parseCards("KsKd"), parseCards("7c7d2s")), 3).draws).toEqual([]);
  });
});

describe("popupSecondsLeft", () => {
  it("counts down whole seconds from 7 to 0", () => {
    expect(RESULT_MS).toBe(7000);
    expect(popupSecondsLeft(0)).toBe(7);
    expect(popupSecondsLeft(999)).toBe(7);
    expect(popupSecondsLeft(1000)).toBe(6);
    expect(popupSecondsLeft(6999)).toBe(1);
    expect(popupSecondsLeft(7000)).toBe(0);
    expect(popupSecondsLeft(9000)).toBe(0);
  });
});
