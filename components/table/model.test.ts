import { describe, expect, it } from "vitest";
import { applyAction, createHand, legalActions, seatToAct, type HandState } from "@/lib/engine/engine";
import { PERSONA_IDS, PERSONAS } from "@/lib/bots/personas";
import { chooseAction } from "@/lib/bots/policy";
import { botView, publicView, seatPositions } from "@/lib/bots/view";
import { createRng, parseCards } from "@/lib/poker/cards";
import { HAND_CATEGORIES } from "@/lib/poker/evaluator";
import {
  SEAT_CHARS,
  bbText,
  buildModel,
  categoryPhrase,
  dealtPositions,
  emptyTableModel,
  modelFromHand,
  modelFromPublicView,
  seatAct,
  seatCategory,
  seatMeta,
  seatPoints,
  shortLabels,
  type SeatModel,
  type TableInput,
  type TableModel,
} from "./model";
import { checkRaise, contestedPot, priceLine, type ControlsLegal } from "./play-controls";
import { statusText } from "./status-block";
import { nameParts, seatSentence } from "./poker-table";
import { stripLeft } from "./action-strip";

const names = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? "YOU" : `BOT${i}`));

/** Every state of `hands` bot hands at 2-8 seats. */
function* botStates(hands: number, seed: number): Generator<HandState> {
  const rng = createRng(seed);
  for (let h = 0; h < hands; h++) {
    const n = 2 + (h % 7);
    const stacks = Array.from({ length: n }, () => 1000 + rng.int(19000));
    let s = createHand({ stacks, button: h % n }, { seed: rng.nextU32() });
    yield s;
    while (!s.complete) {
      const seat = seatToAct(s)!;
      const persona = PERSONAS[PERSONA_IDS[(seat + h) % PERSONA_IDS.length]];
      s = applyAction(s, chooseAction(persona, botView(s, seat), rng).action);
      yield s;
    }
  }
}

/** The state with `deck` and every foreign hole-card slot booby-trapped. */
function guarded(state: HandState, hero: number | null): HandState {
  const hole = new Proxy(state.holeCards, {
    get(target, key, recv) {
      if (typeof key === "string" && /^\d+$/.test(key) && Number(key) !== hero) {
        throw new Error(`read hole cards of seat ${key}`);
      }
      return Reflect.get(target, key, recv);
    },
  });
  return new Proxy(state, {
    get(target, key, recv) {
      if (key === "deck") throw new Error("read state.deck");
      if (key === "holeCards") return hole;
      return Reflect.get(target, key, recv);
    },
  });
}

function assertNoLeak(state: HandState, m: TableModel, hero: number | null) {
  const shown = new Set(state.events.flatMap((e) => (e.type === "showdown" ? [e.seat] : [])));
  for (const seat of m.seats) {
    if (seat.seat === hero) {
      expect(seat.holeCards).toEqual(state.holeCards[hero]);
    } else if (state.complete && state.result!.showdown && shown.has(seat.seat)) {
      expect(seat.holeCards).toEqual(state.holeCards[seat.seat]);
      expect(seat.revealed).toBe(true);
    } else {
      expect(seat.holeCards).toBe("hidden");
    }
  }
}

describe("modelFromHand", () => {
  it("never exposes a non-hero hole card before showdown, and never reads the deck", () => {
    let steps = 0;
    for (const state of botStates(140, 7)) {
      for (const hero of [0, null]) {
        const m = modelFromHand(guarded(state, hero), hero, names(state.seatCount), { handNo: 1 });
        assertNoLeak(state, m, hero);
        if (!state.complete) {
          for (const s of m.seats) if (s.seat !== hero) expect(s.holeCards).toBe("hidden");
        }
      }
      steps++;
    }
    expect(steps).toBeGreaterThan(1000);
  });

  it("shows blinds, the seat to act and the dealer", () => {
    const s = createHand({ stacks: [10000, 10000, 10000, 10000], button: 1 }, { seed: 3 });
    const m = modelFromHand(s, 0, names(4), { handNo: 42 });
    expect(m.seats[2].lastAction).toBe("SB 50");
    expect(m.seats[3].lastAction).toBe("BB 100");
    expect(m.seats[1].isButton).toBe(true);
    expect(m.toAct).toBe(0);
    expect(m.seats[0].turn && m.seats[0].isHero).toBe(true);
    expect(m.seats.filter((x) => x.turn)).toHaveLength(1);
    expect(m.pot).toBe(150);
    expect(m.board).toEqual([]);
  });
});

describe("modelFromPublicView", () => {
  it("shows only the viewer's cards and showdown reveals", () => {
    for (const state of botStates(70, 11)) {
      const seat = state.seatCount - 1;
      const m = modelFromPublicView(publicView(state, seat), state.holeCards[seat], names(state.seatCount), { handNo: 1 });
      assertNoLeak(state, m, seat);
    }
  });
});

describe("emptyTableModel", () => {
  it("seats everyone with no cards", () => {
    const m = emptyTableModel([{ name: "YOU", kind: "human" }, null, { name: "TAG", kind: "bot" }], [10000, 0, 10000], {
      heroSeat: 0,
      smallBlind: 50,
      bigBlind: 100,
    });
    expect(m.seated).toBe(2);
    expect(m.seats[1].kind).toBe("empty");
    expect(m.seats.every((s) => s.holeCards === null && !s.turn)).toBe(true);
  });
});

describe("seatPoints", () => {
  it("reproduces the 8-seat coordinates of DESIGN.md §4.2", () => {
    const want = [
      [33.54, 86.03],
      [10.27, 64.92],
      [10.27, 35.08],
      [33.54, 13.97],
      [66.46, 13.97],
      [89.73, 35.08],
      [89.73, 64.92],
      [66.46, 86.03],
    ];
    seatPoints(8).forEach((p, i) => {
      expect(p.left).toBeCloseTo(want[i][0], 2);
      expect(p.top).toBeCloseTo(want[i][1], 2);
    });
  });

  it("keeps every seat of a 2-8 seat table inside the figure, distinct, hero at the bottom", () => {
    for (const layout of ["wide", "tall"] as const) {
      for (let n = 2; n <= 8; n++) {
        const pts = seatPoints(n, layout);
        expect(pts).toHaveLength(n);
        for (const p of pts) {
          expect(p.left).toBeGreaterThanOrEqual(5);
          expect(p.left).toBeLessThanOrEqual(95);
          expect(p.top).toBeGreaterThanOrEqual(5);
          expect(p.top).toBeLessThanOrEqual(95);
        }
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            expect(Math.hypot(pts[i].left - pts[j].left, pts[i].top - pts[j].top)).toBeGreaterThan(15);
          }
        }
        // hero: bottom row, at or left of center
        expect(pts[0].top).toBeGreaterThan(75);
        expect(pts[0].left).toBeLessThanOrEqual(50);
        if (n === 2) expect(pts[1].top).toBeLessThan(20);
      }
    }
  });

  // Seat and board boxes in px from the CSS of globals.css §4 (Source Code Pro: 1ch = 0.6em; border-box).
  // Seat: width 14ch at 11px (12ch at 9.5px on mobile); padding 3+3, hole min-height + 4px margin,
  // three 1.35 lines (who, meta, act) and the bar (4px + 2px margins). Board: 5 cards + 4 gaps, a 4px
  // gap and the 1.3-line pot under it. Figure width = viewport - sheet padding (measured), height from
  // the aspect-ratio rules: 2/1 > 860px, 2/1 but at least 368px tall 680-860px, 3/4 < 680px, 3/5 <= 400px.
  const seatBox = (fs: number, ch: number, hole: number) => ({ w: ch * 0.6 * fs, h: 6 + hole + 4 + 3 * 1.35 * fs + 8 });
  const MID_MIN_H = 368;
  const WIDE_SEAT = seatBox(11, 14, 37);
  const WIDE_BOARD = { w: 5 * 42 + 4 * 5, h: 58 + 4 + 15.6 };
  const TALL_SEAT = seatBox(9.5, 12, 28);
  const TALL_BOARD = { w: 5 * 28 + 4 * 3, h: 40 + 4 + 13 };
  const VIEWPORTS = [
    { vw: 320, w: 256, aspect: 3 / 5, minH: 0, layout: "tall", seat: TALL_SEAT, board: TALL_BOARD },
    { vw: 375, w: 311, aspect: 3 / 5, minH: 0, layout: "tall", seat: TALL_SEAT, board: TALL_BOARD },
    { vw: 500, w: 436, aspect: 3 / 4, minH: 0, layout: "tall", seat: TALL_SEAT, board: TALL_BOARD },
    { vw: 681, w: 593, aspect: 2, minH: MID_MIN_H, layout: "wide", seat: WIDE_SEAT, board: WIDE_BOARD },
    { vw: 700, w: 612, aspect: 2, minH: MID_MIN_H, layout: "wide", seat: WIDE_SEAT, board: WIDE_BOARD },
    { vw: 800, w: 712, aspect: 2, minH: MID_MIN_H, layout: "wide", seat: WIDE_SEAT, board: WIDE_BOARD },
    { vw: 820, w: 732, aspect: 2, minH: MID_MIN_H, layout: "wide", seat: WIDE_SEAT, board: WIDE_BOARD },
    { vw: 1440, w: 776, aspect: 2, minH: 0, layout: "wide", seat: WIDE_SEAT, board: WIDE_BOARD },
  ] as const;
  const figHeight = (v: (typeof VIEWPORTS)[number]) => Math.max(v.w / v.aspect, v.minH);

  it("keeps seat boxes off each other, the board and the figure edge at 320-1440px for 2-8 seats", () => {
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const apart = (a: Box, b: Box) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
    for (const v of VIEWPORTS) {
      const W = v.w;
      const H = figHeight(v);
      // In % of the figure.
      const sw = (100 * v.seat.w) / W / 2;
      const sh = (100 * v.seat.h) / H / 2;
      const board: Box = {
        x0: 50 - (50 * v.board.w) / W,
        x1: 50 + (50 * v.board.w) / W,
        y0: 50 - (50 * v.board.h) / H,
        y1: 50 + (50 * v.board.h) / H,
      };
      for (let n = 2; n <= 8; n++) {
        const boxes = seatPoints(n, v.layout).map((p) => ({ x0: p.left - sw, x1: p.left + sw, y0: p.top - sh, y1: p.top + sh }));
        boxes.forEach((b, i) => {
          const where = `${v.vw}px, ${n} seats, S${i + 1}`;
          expect(b.x0, where).toBeGreaterThanOrEqual(0);
          expect(b.y0, where).toBeGreaterThanOrEqual(0);
          expect(b.x1, where).toBeLessThanOrEqual(100);
          expect(b.y1, where).toBeLessThanOrEqual(100);
          expect(apart(b, board), `${where} vs board`).toBe(true);
          for (let j = i + 1; j < n; j++) expect(apart(b, boxes[j]), `${where} vs S${j + 1}`).toBe(true);
        });
      }
    }
  });

  // 800x600 (N8): the table header (a half-line gap + 3 lines), the figure with its 0.5em margins, the status
  // line, the price line and the controls (buttons + presets, two lines at this width) fit in 600px.
  it("fits the table header through the controls in an 800x600 viewport", () => {
    const LINE = 27;
    const v = VIEWPORTS.find((x) => x.vw === 800)!;
    const band = 7.5 + 3 * LINE + 2 * 7.5 + figHeight(v) + 4 * LINE;
    expect(band).toBeLessThanOrEqual(600);
  });
});

describe("seat meta and bar", () => {
  it("shows stack and BB depth from before the first deal, with the bar as the share of table chips", () => {
    const empty = emptyTableModel([{ name: "YOU", kind: "human" }, { name: "TAG", kind: "bot" }, null], [10000, 30000, 0], {
      heroSeat: 0,
      smallBlind: 50,
      bigBlind: 100,
    });
    expect(empty.seats.map((x) => x.bbDepth)).toEqual([100, 300, null]);
    expect(empty.seats.map((x) => x.metaPct)).toEqual([25, 75, null]);
    expect(empty.seats.map((x) => x.barFraction)).toEqual([0.25, 0.75, 0]);
    expect(seatMeta(empty.seats[0], SEAT_CHARS.wide)).toEqual({ head: "10,000  ", tail: "100 BB" });
    expect(seatMeta(empty.seats[2], SEAT_CHARS.wide)).toEqual({ head: "--", tail: "" });
    for (const state of botStates(40, 5)) {
      const m = modelFromHand(state, 0, names(state.seatCount), { handNo: 1 });
      for (const seat of m.seats) {
        expect(seat.metaPct).not.toBeNull();
        expect(seat.barFraction).toBeCloseTo(seat.metaPct! / 100, 10);
      }
    }
  });

  it("counts committed chips only while the hand is live", () => {
    for (const state of botStates(60, 9)) {
      if (!state.complete) continue;
      const m = modelFromHand(state, 0, names(state.seatCount), { handNo: 1 });
      const total = state.stacks.reduce((a, b) => a + b, 0);
      m.seats.forEach((seat, i) => expect(seat.metaPct).toBe(Math.round((100 * state.stacks[i]) / total)));
    }
  });

  it("gives winners and showdown losers their net result, and showdown hands their category", () => {
    let showdowns = 0;
    for (const state of botStates(60, 13)) {
      if (!state.complete) continue;
      const m = modelFromHand(state, 0, names(state.seatCount), { handNo: 1 });
      for (const seat of m.seats) {
        const net = state.result!.net[seat.seat];
        const text = net < 0 ? `-${Math.abs(net).toLocaleString("en-US")}` : `+${net.toLocaleString("en-US")}`;
        if (seat.category) {
          showdowns++;
          expect(seat.net).toBe(net);
          expect(seat.lastAction).toBe(seatCategory(seat.category));
          expect(seatMeta(seat, SEAT_CHARS.wide).tail).toBe(text);
        } else if (seat.win) {
          expect(seat.net).toBe(net);
          expect(seat.lastAction).toBe("WINS");
        } else {
          expect(seat.net).toBeNull();
          expect(seat.lastAction).toBe("FOLD");
        }
      }
    }
    expect(showdowns).toBeGreaterThan(10);
  });

  it("writes BB depth as whole BBs from 10 up, one decimal below, rounded down", () => {
    expect(bbText(100)).toBe("100 BB");
    expect(bbText(62.7)).toBe("62 BB");
    expect(bbText(10)).toBe("10 BB");
    expect(bbText(9.99)).toBe("9.9 BB");
    expect(bbText(0.5)).toBe("0.5 BB");
    expect(bbText(0)).toBe("0 BB");
    expect(bbText(12345.6)).toBe("12,345 BB");
  });

  it("keeps the meta and hand-end action text inside the seat box (14ch wide, 12ch tall)", () => {
    const fits = (seat: SeatModel) => {
      for (const w of [SEAT_CHARS.wide, SEAT_CHARS.tall]) {
        const { head, tail } = seatMeta(seat, w);
        expect(head.length + tail.length, `${head}${tail} in ${w}ch`).toBeLessThanOrEqual(w);
      }
    };
    for (const state of botStates(80, 21)) {
      const m = modelFromHand(state, 0, names(state.seatCount), { handNo: 1 });
      for (const seat of m.seats) {
        fits(seat);
        if (state.complete) expect(seat.lastAction.length, seat.lastAction).toBeLessThanOrEqual(SEAT_CHARS.tall);
      }
    }
    const base = modelFromHand(createHand({ stacks: [10000, 10000], button: 0 }, { seed: 1 }), 0, names(2), { handNo: 1 }).seats[0];
    for (const stack of [0, 5, 950, 10000, 99999, 123456, 1234567, 98765432]) {
      for (const net of [null, 0, 1783, -100, -98765, 1234567]) {
        fits({ ...base, stack, bbDepth: stack / 100, net });
      }
    }
    expect(seatMeta({ ...base, stack: 21750, net: 1783 }, SEAT_CHARS.wide)).toEqual({ head: "21,750  ", tail: "+1,783" });
    expect(seatMeta({ ...base, stack: 10000, bbDepth: 100, net: null }, SEAT_CHARS.tall)).toEqual({ head: "10,000 ", tail: "100BB" });
    // The engine's own names (HAND_CATEGORIES), as the adapters upper-case them.
    for (const c of HAND_CATEGORIES.map((x) => x.toUpperCase())) expect(seatCategory(c).length, c).toBeLessThanOrEqual(SEAT_CHARS.tall);
    expect(seatCategory("TRIPS")).toBe("TRIPS");
    expect(seatCategory("STRAIGHT FLUSH")).toBe("STR FLUSH");
  });
});

describe("seat lines fit the seat box", () => {
  it("shortens a long action: RAISE TO 10,000 reads RAISE 10,000, then the amount goes compact", () => {
    expect(seatAct("RAISE TO 10,000", SEAT_CHARS.wide)).toBe("RAISE 10,000");
    expect(seatAct("RAISE TO 10,000", SEAT_CHARS.tall)).toBe("RAISE 10,000");
    expect(seatAct("RAISE TO 1,100", SEAT_CHARS.wide)).toBe("RAISE TO 1,100");
    expect(seatAct("RAISE TO 1,100", SEAT_CHARS.tall)).toBe("RAISE 1,100");
    expect(seatAct("ALL-IN 10,000", SEAT_CHARS.wide)).toBe("ALL-IN 10,000");
    expect(seatAct("ALL-IN 10,000", SEAT_CHARS.tall)).toBe("ALL-IN 10.0K");
    expect(seatAct("RAISE TO 1,234,567", SEAT_CHARS.tall)).toBe("RAISE 1.2M");
    expect(seatAct("SITTING OUT", SEAT_CHARS.tall)).toBe("SITTING OUT");
    for (const verb of ["SB", "BB", "CALL", "BET", "RAISE TO", "ALL-IN"]) {
      for (const n of [1, 950, 10000, 123456, 1234567, 98765432]) {
        const text = `${verb} ${n.toLocaleString("en-US")}`;
        for (const w of [SEAT_CHARS.wide, SEAT_CHARS.tall]) {
          const t = seatAct(text, w);
          expect(t.length, `${text} in ${w}ch`).toBeLessThanOrEqual(w);
          expect(t[0]).toBe(verb[0]);
        }
      }
    }
    for (const state of botStates(40, 23)) {
      for (const seat of modelFromHand(state, 0, names(state.seatCount), { handNo: 1 }).seats) {
        for (const w of [SEAT_CHARS.wide, SEAT_CHARS.tall]) expect(seatAct(seat.lastAction, w).length).toBeLessThanOrEqual(w);
      }
    }
  });

  it("keeps a -N suffix whole when the name is cut", () => {
    expect(nameParts("STATION-2")).toEqual(["STATION", "-2"]);
    expect(nameParts("TAG-12")).toEqual(["TAG", "-12"]);
    expect(nameParts("TAG")).toEqual(["TAG", ""]);
    expect(nameParts("ANNA-MARIE")).toEqual(["ANNA-MARIE", ""]);
    expect(nameParts("-2")).toEqual(["-2", ""]);
    expect(nameParts("")).toEqual(["", ""]);
  });
});

describe("away seats", () => {
  it("flags a disconnected player (SeatSource.away) and says so; solo never sets it", () => {
    const m = emptyTableModel(
      [{ name: "TENZING", kind: "human", away: true }, { name: "BEA", kind: "human" }, { name: "TAG", kind: "bot" }, null],
      [10000, 10000, 10000, 0],
      { heroSeat: 1, smallBlind: 50, bigBlind: 100 },
    );
    expect(m.seats.map((x) => x.away)).toEqual([true, false, false, false]);
    expect(seatSentence(m.seats[0])).toBe("Seat 1, TENZING, 10,000 chips, 100 big blinds, away");
    expect(seatSentence(m.seats[1])).not.toMatch(/away/);
    for (const state of botStates(10, 29)) {
      expect(modelFromHand(state, 0, names(state.seatCount), { handNo: 1 }).seats.some((x) => x.away)).toBe(false);
    }
  });
});

describe("hand result", () => {
  // Heads-up, button 0: seat 1 gets deck cards 0 and 2, seat 0 (hero, small blind) cards 1 and 3, then the board.
  type Move = Parameters<typeof applyAction>[1];
  const headsUp = (deck: string, moves: Move[]) => {
    let s = createHand({ stacks: [10000, 10000], button: 0 }, { deck: parseCards(deck) });
    for (const a of moves) s = applyAction(s, a);
    expect(s.complete).toBe(true);
    return s;
  };
  const checkDown: Move[] = [{ type: "call" }, { type: "check" }, ...Array<Move>(6).fill({ type: "check" })];
  const seatNames = ["YOU", "LAG"];

  it("is null while the hand runs", () => {
    const s = createHand({ stacks: [10000, 10000], button: 0 }, { seed: 4 });
    expect(modelFromHand(s, 0, seatNames, { handNo: 1 }).result).toBeNull();
  });

  it("hero wins at showdown: YOU WIN, the amount and the hand", () => {
    const s = headsUp("Kc As Kd Ah 2c 7d 9h Js 3s", checkDown);
    const m = modelFromHand(s, 0, seatNames, { handNo: 1 });
    expect(m.result).toMatchObject({ showdown: true, split: false, heroNet: 100 });
    expect(m.result!.winners).toEqual([{ seat: 0, label: "S1", name: "YOU", amount: 200, net: 100, category: "PAIR", isHero: true }]);
    expect(m.result!.text).toBe("YOU WIN 200 WITH A PAIR");
    expect(m.result!.short).toBe("YOU WIN 200 · PAIR");
    expect(statusText(m, false)).toBe("YOU WIN 200 WITH A PAIR");
  });

  it("hero loses at showdown: the winner, its hand, and what the hero lost", () => {
    const s = headsUp("As Kc Ah Kd 2c 7d 9h Js 3s", checkDown);
    const m = modelFromHand(s, 0, seatNames, { handNo: 1 });
    expect(m.result!.text).toBe("S2 LAG WINS 200 WITH A PAIR · YOU LOSE 100");
    expect(m.result!.short).toBe("S2 WINS 200 · PAIR · YOU -100");
    expect(m.result!.heroNet).toBe(-100);
    // A spectator sees the same winner and no loss line.
    expect(modelFromHand(s, null, seatNames, { handNo: 1 }).result!.text).toBe("S2 LAG WINS 200 WITH A PAIR");
    // Multiplayer models are built from the same input.
    const pv = modelFromPublicView(publicView(s, 0), s.holeCards[0], seatNames, { handNo: 1 });
    expect(pv.result!.text).toBe("S2 LAG WINS 200 WITH A PAIR · YOU LOSE 100");
    // Both showdown seats show their hand and their net.
    expect(m.seats.map((x) => [x.lastAction, x.net])).toEqual([
      ["PAIR", -100],
      ["PAIR", 100],
    ]);
  });

  it("everyone folded: the winner and no hand", () => {
    const s = headsUp("As Kc Ah Kd 2c 7d 9h Js 3s", [{ type: "fold" }]);
    const m = modelFromHand(s, 0, seatNames, { handNo: 1 });
    expect(m.result).toMatchObject({ showdown: false, split: false });
    expect(m.result!.text).toBe(`S2 LAG WINS ${m.result!.winners[0].amount.toLocaleString("en-US")} · EVERYONE ELSE FOLDED`);
    expect(m.result!.short).toBe(`S2 WINS ${m.result!.winners[0].amount.toLocaleString("en-US")} · OTHERS FOLDED`);
    expect(m.seats[1].lastAction).toBe("WINS");
    expect(m.seats[0].lastAction).toBe("FOLD");
  });

  it("split pot: both winners and the equal share", () => {
    const s = headsUp("2c 2d 3d 3c As Ks Qs Js Ts", checkDown);
    const m = modelFromHand(s, 0, seatNames, { handNo: 1 });
    expect(m.result!.split).toBe(true);
    expect(m.result!.text).toBe("SPLIT POT: YOU AND S2 LAG EACH WIN 100 WITH A STRAIGHT FLUSH");
    expect(m.result!.short).toBe("YOU, S2 WIN 100 EACH · STR FLUSH");
    expect(modelFromHand(s, null, ["BEA", "LAG"], { handNo: 1 }).result!.text).toBe(
      "SPLIT POT: S1 BEA AND S2 LAG EACH WIN 100 WITH A STRAIGHT FLUSH",
    );
  });

  it("odd-chip split pot: every winner shares the pot, even with unequal shares", () => {
    // 4 seats, button 0: S2 small blind folds, the other three check down a royal flush on the board.
    let s = createHand({ stacks: [10000, 10000, 10000, 10000], button: 0 }, { deck: parseCards("2c 3c 4c 5c 2d 3d 4d 5d As Ks Qs Js Ts") });
    for (const a of [{ type: "call" }, { type: "call" }, { type: "fold" }, { type: "check" }, ...Array<Move>(9).fill({ type: "check" })] as Move[]) {
      s = applyAction(s, a);
    }
    expect(s.complete).toBe(true);
    const m = modelFromHand(s, 0, ["YOU", "SB", "LAG", "NIT"], { handNo: 1 });
    const shares = m.result!.winners.map((w) => w.amount);
    expect(new Set(shares).size).toBe(2); // 350 does not split three ways evenly
    expect(shares.reduce((a, b) => a + b, 0)).toBe(350);
    expect(m.result!.split).toBe(true);
    expect(m.result!.text).toBe("SPLIT POT: YOU, S3 LAG AND S4 NIT SHARE 350 WITH A STRAIGHT FLUSH");
    expect(m.result!.short).toBe("YOU, S3, S4 SHARE 350 · STR FLUSH");

    // Without pot indices (the multiplayer adapter), shares within an odd chip still read as a split.
    const seats = ["YOU", "LAG", "NIT"].map((name) => ({ name, kind: "bot" as const }));
    const input = (amounts: number[]): TableInput => ({
      handNo: 1,
      seats,
      button: 0,
      smallBlind: 50,
      bigBlind: 100,
      street: "river",
      board: parseCards("As Ks Qs Js Ts"),
      pot: 0,
      stacks: [10000, 10000, 10000],
      committed: [100, 100, 100],
      folded: [false, false, false],
      inHand: [true, true, true],
      toAct: null,
      complete: true,
      showdown: true,
      timeline: [{ kind: "end", winners: amounts.map((amount, seat) => ({ seat, amount })) }],
      holeCards: [null, null, null],
      revealed: [false, false, false],
      categories: ["STRAIGHT FLUSH", "STRAIGHT FLUSH", "STRAIGHT FLUSH"],
      heroSeat: null,
    });
    expect(buildModel(input([116, 118, 116])).result!.text).toBe("SPLIT POT: S1 YOU, S2 LAG AND S3 NIT SHARE 350 WITH A STRAIGHT FLUSH");
    expect(buildModel(input([100, 100, 100])).result!.text).toBe("SPLIT POT: S1 YOU, S2 LAG AND S3 NIT EACH WIN 100 WITH A STRAIGHT FLUSH");
    expect(buildModel(input([100, 400])).result).toMatchObject({
      split: false,
      text: "S1 YOU WINS 100 WITH A STRAIGHT FLUSH · S2 LAG WINS 400 WITH A STRAIGHT FLUSH",
    });
  });

  it("side pot: a hero who wins a side pot but loses overall sees the net", () => {
    // 3 seats, button 0 (first to act). S2 holds aces and is all-in for less; the hero's kings beat S3's queens.
    let s = createHand({ stacks: [1000, 800, 1000], button: 0 }, { deck: parseCards("As Qc Kc Ah Qd Kd 2c 7d 9h Js 3s") });
    for (const a of [{ type: "raise", to: 1000 }, { type: "call" }, { type: "call" }] as Move[]) s = applyAction(s, a);
    expect(s.complete).toBe(true);
    const m = modelFromHand(s, 0, ["YOU", "NIT", "LAG"], { handNo: 1 });
    expect(m.result).toMatchObject({ split: false, heroNet: -600 });
    expect(m.result!.text).toBe("YOU WIN 400 WITH A PAIR · S2 NIT WINS 2,400 WITH A PAIR · YOU NET -600");
    expect(m.result!.short).toBe("YOU WIN 400 · PAIR · S2 WINS 2,400 · PAIR · YOU -600");
  });

  it("names every winner of every finished bot hand with the amounts awarded", () => {
    for (const state of botStates(60, 17)) {
      if (!state.complete) continue;
      const m = modelFromHand(state, 0, names(state.seatCount), { handNo: 1 });
      const won = new Map<number, number>();
      for (const e of state.events) if (e.type === "award") e.winners.forEach((w, k) => won.set(w, (won.get(w) ?? 0) + e.shares[k]));
      expect(new Map(m.result!.winners.map((w) => [w.seat, w.amount]))).toEqual(won);
      expect(m.result!.heroNet).toBe(state.result!.net[0]);
      expect(m.result!.split).toBe(state.result!.pots.some((p) => p.winners.length > 1));
      expect(m.result!.text).toMatch(/^(SPLIT POT: |YOU WIN |S\d )/);
      // The mobile form (13px at 375px: 39 characters) fits one line for one pot under 10,000 and up to 3 winners.
      const one = state.result!.pots.length === 1 && m.result!.winners.length <= 3 && m.pot < 10000;
      if (one) expect(m.result!.short.length, m.result!.short).toBeLessThanOrEqual(39);
    }
    expect(categoryPhrase("TRIPS")).toBe("THREE OF A KIND");
    expect(categoryPhrase("TWO PAIR")).toBe("TWO PAIR");
  });
});

describe("checkRaise", () => {
  const legal: ControlsLegal = {
    toCall: 100,
    callAmount: 100,
    canFold: true,
    canCheck: false,
    canCall: true,
    canRaise: true,
    minRaiseTo: 200,
    maxRaiseTo: 9700,
    isBet: false,
  };
  it("passes amounts in range and rejects the rest instead of clamping", () => {
    expect(checkRaise("200", legal)).toEqual({ to: 200, error: null });
    expect(checkRaise("9700", legal)).toEqual({ to: 9700, error: null });
    expect(checkRaise("12003", legal)).toEqual({ to: null, error: "MAX 9,700 (ALL-IN)" });
    expect(checkRaise("99999999", legal)).toEqual({ to: null, error: "MAX 9,700 (ALL-IN)" });
    for (const v of ["", "1", "50", "199"]) expect(checkRaise(v, legal)).toEqual({ to: null, error: "MIN 200" });
    expect(checkRaise("1,200", legal)).toEqual({ to: 1200, error: null });
  });
});

describe("priceLine", () => {
  it("says the call, the pot and the equity it needs, module 3's B / (P + 2B)", () => {
    expect(priceLine(300, 1200)).toEqual({
      short: "TO CALL 300 INTO 1,200 → NEED 20.0%",
      text: "TO CALL 300 INTO 1,200 → NEED 20.0% EQUITY",
      need: 20,
      ratio: "4 TO 1",
      brief: "TO CALL 300 → NEED 20%",
    });
    // Mobile: whole percents from 10% up, one decimal below; with STACK it fits a 375px line (39 characters).
    expect(priceLine(100, 150)!.brief).toBe("TO CALL 100 → NEED 40%");
    expect(priceLine(50, 950)!.brief).toBe("TO CALL 50 → NEED 5.0%");
    expect(`${priceLine(9950, 20000)!.brief}  STACK 50,000`.length).toBeLessThanOrEqual(39);
    // Module 3's examples: pot P, bet B; the pot shown already holds the bet.
    for (const [P, B, need, ratio] of [
      [100, 50, 25, "3 TO 1"],
      [100, 100, 100 / 3, "2 TO 1"],
      [100, 200, 40, "1.5 TO 1"],
      [300, 100, 20, "4 TO 1"],
    ] as const) {
      const p = priceLine(B, P + B)!;
      expect(p.need).toBeCloseTo(need, 10);
      expect(p.need).toBeCloseTo((100 * B) / (P + 2 * B), 10);
      expect(p.ratio).toBe(ratio);
      expect(p.text).not.toMatch(/POT ODDS/);
    }
    expect(priceLine(0, 1200)).toBeNull();
  });

  it("prices an all-in call for less against the pot it can win, not the whole bet", () => {
    // Heads-up, the hero (button) limps with 1,000 and has 900 behind; S2 bets 5,000 into 200.
    let s = createHand({ stacks: [1000, 10000], button: 0 }, { seed: 3 });
    for (const a of [{ type: "call" }, { type: "check" }, { type: "raise", to: 5000 }] as const) s = applyAction(s, a);
    const legal = legalActions(s)!;
    expect(legal.callAmount).toBe(900);
    const contested = contestedPot(s.committed, 0, legal.callAmount);
    expect(contested).toBe(2000);
    const p = priceLine(legal.callAmount, contested - legal.callAmount)!;
    expect(p.short).toBe("TO CALL 900 INTO 1,100 → NEED 45.0%");
    expect(p.ratio).toBe("1.2 TO 1");
    // Each opponent is capped separately at what the hero will have in.
    expect(contestedPot([100, 2000, 300], 0, 400)).toBe(500 + 500 + 300);
    // A call that matches the bet plays for the whole pot plus the call.
    expect(contestedPot([100, 300, 300], 0, 200)).toBe(700 + 200);
  });
});

describe("action strip", () => {
  // 3 seats, button 0: S2 small blind, S3 big blind. Seat 2 holds aces and wins at showdown.
  const deck = parseCards("7c As Kc 2d Ah Qd 3s 8h 9d Jc 4h");
  let s = createHand({ stacks: [10000, 3000, 10000], button: 0 }, { deck });
  const lines: HandState[] = [s];
  const play = (a: Parameters<typeof applyAction>[1]) => {
    s = applyAction(s, a);
    lines.push(s);
  };
  play({ type: "call" }); // S1 calls
  play({ type: "call" }); // S2 completes
  play({ type: "check" }); // S3 checks
  play({ type: "raise", to: 200 }); // flop: S2 bets
  play({ type: "raise", to: 600 }); // S3 raises
  play({ type: "fold" }); // S1 folds
  play({ type: "raise", to: 2900 }); // S2 all-in
  play({ type: "call" }); // S3 calls, runout

  it("maps engine events to b X C B R A F W", () => {
    expect(s.complete).toBe(true);
    const m = modelFromHand(s, 0, names(3), { handNo: 1 });
    const letters = m.strip.rows.map((r) => r.marks.map((x) => x.letter).join(""));
    expect(letters).toEqual(["CF", "bCBA", "bXRCW"]);
    expect(m.seats[2].win).toBe(true);
    expect(m.seats[2].net).toBe(s.result!.net[2]);
    expect(m.seats[2].lastAction).toBe(seatCategory(m.seats[2].category!));
    expect(m.seats[2].net).toBeGreaterThan(0);
    expect(m.seats[0].out).toBe(true);
    expect(m.seats[0].lastAction).toBe("FOLD");
    expect(m.street).toBe("showdown");
    expect(m.seats[1].holeCards).toEqual(parseCards("7c2d"));
  });

  it("orders marks and labels in time, with W at the end", () => {
    const m = modelFromHand(s, 0, names(3), { handNo: 1 });
    expect(m.strip.labels.map((l) => l.label)).toEqual(["PRE", "FLOP", "TURN", "RIVER", "SHOW"]);
    const ats = m.strip.labels.map((l) => l.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(ats[ats.length - 1]).toBe(1);
    for (const r of m.strip.rows) {
      const xs = r.marks.map((x) => x.at);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    }
    const s1 = m.strip.rows[0];
    expect(s1.lineTo).toBe(s1.marks[1].at); // the folded seat's line stops at its fold
    expect(m.strip.rows[2].marks.at(-1)).toMatchObject({ letter: "W", at: 1 });
  });

  it("shortens street labels to initials when they crowd, as on the reference", () => {
    const m = modelFromHand(s, 0, names(3), { handNo: 1 }); // all-in runout: FLOP TURN RIVER SHOW one tick apart
    const at = (l: string) => m.strip.labels.find((x) => x.label === l)!.at;
    expect(at("SHOW") - at("RIVER")).toBeLessThan(0.15);
    // 320px phone: the track is ~200px at 13px type. FLOP keeps its room (the flop was bet and raised).
    const narrow = shortLabels(m.strip.labels, 200, 0.6 * 13);
    const text = m.strip.labels.map((l, k) => (narrow[k] ? l.label[0] : l.label));
    expect(text).toEqual(["PRE", "FLOP", "T", "R", "S"]);
    // A tighter track shortens FLOP too.
    expect(shortLabels(m.strip.labels, 60, 0.6 * 13).slice(1)).toEqual([true, true, true, true]);
    // Wide track: everything has room.
    expect(shortLabels(m.strip.labels, 5000, 6.6).every((x) => !x)).toBe(true);
    // Rule: neighbours closer than half of each label plus a space.
    expect(shortLabels([{ label: "FLOP", at: 0.5 }, { label: "TURN", at: 0.6 }], 100, 2)).toEqual([false, false]); // 10 >= 10
    expect(shortLabels([{ label: "FLOP", at: 0.5 }, { label: "TURN", at: 0.6 }], 99, 2)).toEqual([true, true]);
    // Measured where they are drawn: SHOW at the end sits half its width (plus its paper) inside the track.
    expect(shortLabels([{ label: "RIVER", at: 0.8 }, { label: "SHOW", at: 1 }], 100, 2)).toEqual([false, false]); // 95.4 - 80 >= 10
    expect(shortLabels([{ label: "RIVER", at: 0.85 }, { label: "SHOW", at: 1 }], 100, 2)).toEqual([true, true]); // 95.4 - 85 < 10
  });

  it("keeps every label and letter inside the line: the ends are clamped, not centered past them", () => {
    expect(stripLeft(0.5, 4)).toBe("clamp(2.3ch, 50%, calc(100% - 2.3ch))");
    expect(stripLeft(1, 1)).toBe("clamp(0.8ch, 100%, calc(100% - 0.8ch))"); // W ends flush with the line
    expect(stripLeft(0, 3)).toBe("clamp(1.8ch, 0%, calc(100% - 1.8ch))");
  });

  it("gives each mark its action in words, for the tooltip", () => {
    const m = modelFromHand(s, 0, names(3), { handNo: 1 });
    const texts = m.strip.rows.map((r) => r.marks.map((x) => x.text));
    expect(texts[0]).toEqual(["CALL 100", "FOLD"]);
    expect(texts[1]).toEqual(["SB 50", "CALL 100", "BET 200", "ALL-IN 2,900"]);
    expect(texts[2]).toEqual(["BB 100", "CHECK", "RAISE TO 600", "CALL 2,900", `WINS ${s.result!.won[2].toLocaleString("en-US")}`]);
  });

  it("projects future streets while the hand is live", () => {
    const m = modelFromHand(lines[3], 0, names(3), { handNo: 1 }); // flop just dealt
    const future = m.strip.labels.filter((l) => l.future).map((l) => l.label);
    expect(future).toEqual(["TURN", "RIVER", "SHOW"]);
    expect(m.strip.now).toBeGreaterThan(0);
    expect(m.strip.now).toBeLessThan(1);
    expect(m.strip.labels.every((l) => l.at <= 1)).toBe(true);
  });
});

describe("positions", () => {
  it("labels every seat of a 6-max hand from the button: BTN SB BB UTG HJ CO", () => {
    for (let button = 0; button < 6; button++) {
      const st = createHand({ stacks: new Array(6).fill(10000), button }, { seed: button + 1 });
      const m = modelFromHand(st, 0, names(6), { handNo: 1 });
      const at = (k: number) => m.seats[(button + k) % 6].position;
      expect([0, 1, 2, 3, 4, 5].map(at)).toEqual(["BTN", "SB", "BB", "UTG", "HJ", "CO"]);
      expect(m.seats.map((x) => x.position)).toEqual(seatPositions(6, button));
      expect(m.seats[button].isButton).toBe(true);
    }
  });

  it("matches the engine's positions at every table size, and heads-up is BTN against BB", () => {
    for (let n = 2; n <= 8; n++) {
      const st = createHand({ stacks: new Array(n).fill(10000), button: n - 1 }, { seed: n });
      expect(modelFromHand(st, 0, names(n), { handNo: 3 }).seats.map((x) => x.position)).toEqual(publicView(st, 0).positions);
    }
    const hu = createHand({ stacks: [10000, 10000], button: 1 }, { seed: 9 });
    expect(modelFromHand(hu, 0, names(2), { handNo: 1 }).seats.map((x) => x.position)).toEqual(["BB", "BTN"]);
  });

  it("counts only the seats dealt in (multiplayer: empty and sitting-out seats are skipped)", () => {
    const seats = [
      { name: "ANA", kind: "human" as const },
      null,
      { name: "BEA", kind: "human" as const },
      { name: "TAG", kind: "bot" as const },
      { name: "CAL", kind: "human" as const }, // sitting out
      null,
    ];
    const inHand = [true, false, true, true, false, false];
    expect(dealtPositions({ seats, inHand, button: 2, handNo: 7 })).toEqual(["BB", null, "BTN", "SB", null, null]);
    // Four dealt in from the button on seat 6: BTN SB BB CO, skipping the empty seat 2 and seat 5 sitting out.
    expect(
      dealtPositions({ seats: [...seats.slice(0, 5), { name: "DEE", kind: "human" }], inHand: [true, false, true, true, false, true], button: 5, handNo: 7 }),
    ).toEqual(["SB", null, "BB", "CO", null, "BTN"]);
    // A button that is not dealt in: the last dealt-in seat before it takes BTN, so SB and BB follow it.
    expect(dealtPositions({ seats, inHand, button: 4, handNo: 7 })).toEqual(["SB", null, "BB", "BTN", null, null]);
  });

  it("is null before the first deal and for seats not dealt in", () => {
    const m = emptyTableModel([{ name: "YOU", kind: "human" }, { name: "TAG", kind: "bot" }, null], [10000, 10000, 0], {
      heroSeat: 0,
      smallBlind: 50,
      bigBlind: 100,
    });
    expect(m.seats.map((x) => x.position)).toEqual([null, null, null]);
    expect(dealtPositions({ seats: [{ name: "A", kind: "human" }, null], inHand: [true, false], button: 0, handNo: 1 })).toEqual([null, null]);
  });

  it("says the position in the hero's status and in every seat's sentence", () => {
    // 6 seats, button 2: the hero in seat 0 is HJ and acts after UTG (seat 5).
    let st = createHand({ stacks: new Array(6).fill(10000), button: 2 }, { seed: 4 });
    st = applyAction(st, { type: "fold" });
    const m = modelFromHand(st, 0, names(6), { handNo: 1 });
    expect(m.seats[0].position).toBe("HJ");
    expect(statusText(m, true, 100)).toBe("YOUR TURN (HJ) · TO CALL 100");
    expect(statusText(m, true, 0)).toBe("YOUR TURN (HJ)");
    expect(seatSentence(m.seats[0])).toMatch(/^Seat 1, YOU \(you\), hijack, /);
    expect(seatSentence(m.seats[2])).toMatch(/^Seat 3, BOT2, on the button \(dealer\), /);
    expect(seatSentence(m.seats[4])).toMatch(/^Seat 5, BOT4, big blind, /);
    // Positions are at most 3 characters: `S8 ` + a name + ` BTN` leaves the name at least 6 of the seat's 13ch.
    for (let n = 2; n <= 9; n++) for (const p of seatPositions(n, 0)) expect(p.length).toBeLessThanOrEqual(3);
  });
});
