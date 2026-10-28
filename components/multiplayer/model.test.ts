import { describe, expect, it } from "vitest";
import { TableRoom, type RoomDeps } from "@/lib/multiplayer/room";
import type { ServerMessage, TableState } from "@/lib/multiplayer/protocol";
import { createRng, parseCard } from "@/lib/poker/cards";
import { emptyLog, updateLog } from "./log";
import { clockText, cycleNext, heroLegal, heroSeatOf, modelFromState, secondsLeft, tableInputFromState, waitingText, type HoleMsg } from "./model";

const T0 = 1_800_000_000_000;

/** A table room on a fake clock with fake sockets; each connection keeps its messages like the browser does. */
class Table {
  t = T0;
  alarm: number | null = null;
  room: TableRoom;
  private rng = createRng(11);
  /** Per connection: latest state, hole cards by hand number, player id, every state seen. */
  conns = new Map<string, { state: TableState | null; holes: Map<number, HoleMsg>; playerId: string | null; states: TableState[] }>();
  /** Called on every state a connection receives (with the holes it had at that moment). */
  onState: ((conn: string, state: TableState, holes: Map<number, HoleMsg>, playerId: string | null) => void) | null = null;

  constructor(seats: number) {
    const deps: RoomDeps = {
      now: () => this.t,
      send: (conn, msg) => this.receive(conn, JSON.parse(JSON.stringify(msg)) as ServerMessage),
      close: () => {},
      setAlarm: (at) => (this.alarm = at),
      random: () => this.rng.nextU32(),
    };
    this.room = new TableRoom(deps, { seats, betweenHandsMs: 1000 });
  }

  private receive(conn: string, msg: ServerMessage) {
    const c = this.conns.get(conn)!;
    if (msg.type === "welcome") c.playerId = msg.you.playerId;
    if (msg.type === "hole") c.holes.set(msg.handNo, { handNo: msg.handNo, seat: msg.seat, cards: msg.cards });
    if (msg.type === "state") {
      c.state = msg.state;
      c.states.push(msg.state);
      this.onState?.(conn, msg.state, new Map(c.holes), c.playerId);
    }
  }

  join(conn: string, name: string) {
    this.conns.set(conn, { state: null, holes: new Map(), playerId: null, states: [] });
    this.room.onConnect(conn);
    this.send(conn, { type: "join", name });
  }
  send(conn: string, msg: unknown) {
    this.room.onMessage(conn, JSON.stringify(msg));
  }
  fire() {
    this.t = Math.max(this.t, this.alarm!);
    this.room.onAlarm();
  }
  get state(): TableState {
    return this.room.publicState();
  }
}

/** Two humans (A in seat 0, B in seat 2) and two bots at a 5-seat table, started. */
function fourHanded(): Table {
  const t = new Table(5);
  t.join("a", "Ana");
  t.join("b", "Ben");
  t.send("a", { type: "sit", seat: 0 });
  t.send("b", { type: "sit", seat: 2 });
  t.send("a", { type: "addBot", seat: 1, persona: "tag" });
  t.send("a", { type: "addBot", seat: 3, persona: "station" });
  return t;
}

/** Plays until `hands` hands have finished: humans call/check (sometimes raise or fold), bots on alarms. */
function play(t: Table, hands: number, rng = createRng(5)) {
  t.send("a", { type: "start" });
  for (let guard = 0; guard < 20_000 && t.state.handNo <= hands; guard++) {
    const s = t.state;
    const h = s.hand;
    const human = s.toAct === 0 ? "a" : s.toAct === 2 ? "b" : null;
    if (h && !h.complete && human && h.legal) {
      const r = rng.int(10);
      const l = h.legal;
      const action =
        r === 0 && l.canFold ? { type: "fold" } : r === 1 && l.canRaise ? { type: "raise", to: l.minRaiseTo } : l.canCheck ? { type: "check" } : { type: "call" };
      t.send(human, { type: "act", handNo: h.handNo, action });
    } else {
      t.fire();
    }
  }
}

describe("modelFromState", () => {
  it("shows a player only their own hole cards and the server's showdown reveals", () => {
    const t = fourHanded();
    let checked = 0;
    let showdowns = 0;
    t.onState = (_conn, state, holes, playerId) => {
      const hand = state.hand;
      const hero = heroSeatOf(state, playerId);
      const hole = hand ? (holes.get(hand.handNo) ?? null) : null;
      const m = modelFromState(state, hole, playerId);
      const truth = t.room.debugHand();
      expect(m.seats).toHaveLength(5);
      expect(m.heroSeat).toBe(hero);
      if (!hand) return;
      const result = state.lastResult?.handNo === hand.handNo ? state.lastResult : null;
      for (const s of m.seats) {
        const dealt = hand.players.some((p) => p.seat === s.seat);
        if (!dealt) {
          expect(s.holeCards).toBeNull();
        } else if (s.seat === hero) {
          // Own cards, exactly as dealt by the server.
          expect(truth?.no).toBe(hand.handNo);
          const e = truth!.seats.indexOf(s.seat);
          expect(s.holeCards).toEqual(truth!.state.holeCards[e]);
        } else if (hand.complete && result?.showdown && result.revealed.some((r) => r.seat === s.seat)) {
          const r = result.revealed.find((x) => x.seat === s.seat)!;
          expect(s.holeCards).toEqual(r.cards.map(parseCard));
          expect(s.revealed).toBe(true);
          showdowns++;
        } else {
          expect(s.holeCards).toBe("hidden");
        }
      }
      checked++;
    };
    play(t, 40);
    expect(checked).toBeGreaterThan(500);
    expect(showdowns).toBeGreaterThan(5);
  });

  it("never shows the next hand's cards on the finished hand, nor last hand's on the new one", () => {
    const t = fourHanded();
    play(t, 3);
    const c = t.conns.get("a")!;
    const s = c.state!;
    const other = s.hand!.handNo + 1;
    const wrongHole: HoleMsg = { handNo: other, seat: 0, cards: ["As", "Ah"] };
    const m = modelFromState(s, wrongHole, c.playerId);
    if (s.hand!.players.some((p) => p.seat === 0)) expect(m.seats[0].holeCards).toBe("hidden");
    // A hole for another seat is ignored too.
    const seatMismatch: HoleMsg = { handNo: s.hand!.handNo, seat: 2, cards: ["As", "Ah"] };
    expect(modelFromState(s, seatMismatch, c.playerId).seats[2].holeCards).not.toEqual([parseCard("As"), parseCard("Ah")]);
  });

  it("draws blinds, the button, the seat on the clock and the pot from the public hand", () => {
    const t = fourHanded();
    t.send("a", { type: "start" });
    const s = t.conns.get("b")!.state!;
    const h = s.hand!;
    const m = modelFromState(s, t.conns.get("b")!.holes.get(h.handNo) ?? null, t.conns.get("b")!.playerId);
    expect(m.handNo).toBe(1);
    expect(m.street).toBe("preflop");
    expect(m.seats[h.button].isButton).toBe(true);
    expect(m.seats[h.smallBlindSeat].lastAction).toBe("SB 50");
    expect(m.seats[h.bigBlindSeat].lastAction).toBe("BB 100");
    expect(m.pot).toBe(150);
    expect(m.toAct).toBe(s.toAct);
    expect(m.seats[s.toAct!].turn).toBe(true);
    expect(m.seats[1].name).toBe("TAG");
    expect(m.seats[3].name).toBe("STATION");
    expect(m.seats[0].name).toBe("ANA");
    expect(m.seats[4].kind).toBe("empty");
    expect(m.seated).toBe(4);
    // Strip: a row per dealt-in seat, the blinds marked.
    expect(m.strip.rows.map((r) => r.seat)).toEqual([0, 1, 2, 3]);
    expect(m.strip.rows.find((r) => r.seat === h.bigBlindSeat)!.marks[0].letter).toBe("b");
  });

  it("shows each winner's net result, matching the server's", () => {
    const t = fourHanded();
    const seen: number[] = [];
    t.onState = (conn, state, holes, playerId) => {
      const h = state.hand;
      if (conn !== "a" || !h?.complete || state.lastResult?.handNo !== h.handNo || seen.includes(h.handNo)) return;
      seen.push(h.handNo);
      const m = modelFromState(state, holes.get(h.handNo) ?? null, playerId);
      const winners = new Set(state.lastResult.pots.flatMap((p) => p.winners));
      for (const s of m.seats) {
        if (winners.has(s.seat)) {
          const net = state.lastResult.net.find((x) => x.seat === s.seat)!.amount;
          expect(s.win).toBe(true);
          expect(s.net).toBe(net);
        } else {
          expect(s.win).toBe(false);
        }
      }
      expect(m.complete).toBe(true);
      expect(m.toAct).toBeNull();
      expect(m.street).toBe(state.lastResult.showdown ? "showdown" : "over");
      // Strip ends with SHOW and a W per winner.
      expect(m.strip.labels.at(-1)?.label).toBe("SHOW");
      for (const w of winners) expect(m.strip.rows.find((r) => r.seat === w)!.marks.some((k) => k.letter === "W")).toBe(true);
    };
    play(t, 15);
    expect(seen.length).toBeGreaterThanOrEqual(15);
  });

  it("infers board deals for the strip from street changes and the board", () => {
    const t = fourHanded();
    let dealsChecked = 0;
    t.onState = (conn, state) => {
      const h = state.hand;
      if (conn !== "a" || !h) return;
      const input = tableInputFromState(state, null, null)!;
      const deals = input.timeline.filter((e) => e.kind === "deal").map((e) => (e as { street: string }).street);
      const expected = ["flop", "turn", "river"].slice(0, h.board.length === 0 ? 0 : h.board.length - 2);
      expect(deals).toEqual(expected);
      dealsChecked++;
    };
    play(t, 10);
    expect(dealsChecked).toBeGreaterThan(50);
  });

  it("before the first hand: everyone seated with their stack, no cards", () => {
    const t = fourHanded();
    const c = t.conns.get("a")!;
    const m = modelFromState(c.state!, null, c.playerId);
    expect(m.handNo).toBe(0);
    expect(m.seats[0].stack).toBe(10_000);
    expect(m.seats[0].isHero).toBe(true);
    expect(m.seats.every((s) => s.holeCards === null)).toBe(true);
    expect(m.seats[4].kind).toBe("empty");
  });

  it("marks a player sitting out once the next hand deals without them", () => {
    const t = fourHanded();
    play(t, 2);
    // Ben times out twice in a row -> sitting out.
    for (let guard = 0; guard < 2000 && !t.state.seats[2]!.sittingOut; guard++) {
      const s = t.state;
      if (s.toAct === 0 && s.hand?.legal) t.send("a", { type: "act", handNo: s.hand.handNo, action: s.hand.legal.canCheck ? { type: "check" } : { type: "call" } });
      else t.fire();
    }
    expect(t.state.seats[2]!.sittingOut).toBe(true);
    for (let guard = 0; guard < 2000 && t.state.hand?.players.some((p) => p.seat === 2); guard++) {
      const s = t.state;
      if (s.toAct === 0 && s.hand?.legal) t.send("a", { type: "act", handNo: s.hand.handNo, action: { type: "fold" } });
      else t.fire();
    }
    const b = t.conns.get("b")!;
    const m = modelFromState(b.state!, null, b.playerId);
    expect(m.seats[2].out).toBe(true);
    expect(m.seats[2].lastAction).toBe("SITTING OUT");
    expect(m.seats[2].holeCards).toBeNull();
    expect(heroLegal(b.state!, b.playerId)).toBeNull();
  });
});

describe("heroLegal", () => {
  it("is the public legal actions only on the hero's own turn", () => {
    const t = fourHanded();
    t.send("a", { type: "start" });
    for (let guard = 0; guard < 200; guard++) {
      const s = t.state;
      if (s.toAct === 0 || s.toAct === 2) break;
      t.fire();
    }
    const s = t.state;
    const actor = s.toAct === 0 ? "a" : "b";
    const idle = actor === "a" ? "b" : "a";
    expect(heroLegal(s, t.conns.get(actor)!.playerId)).toEqual(s.hand!.legal);
    expect(heroLegal(s, t.conns.get(idle)!.playerId)).toBeNull();
    expect(heroLegal(s, null)).toBeNull();
  });
});

describe("turn clock", () => {
  it("counts down from the server deadline with the clock offset", () => {
    expect(secondsLeft(null, 0, 0)).toBeNull();
    expect(secondsLeft(20_000, 0, 0)).toBe(20);
    expect(secondsLeft(20_000, 6_500, 0)).toBe(14);
    // Local clock 1 s behind the server.
    expect(secondsLeft(20_000, 5_500, 1_000)).toBe(14);
    expect(secondsLeft(20_000, 30_000, 0)).toBe(0);
    expect(clockText(14)).toBe("TIME 00:14");
    expect(clockText(75)).toBe("TIME 01:15");
  });
});

describe("hand log", () => {
  it("logs each hand's blinds, actions, deals and result once, in order", () => {
    const t = fourHanded();
    let log = emptyLog();
    let now = 0;
    const rows: typeof log.rows = [];
    t.onState = (conn, state) => {
      if (conn !== "a" || state.hand?.handNo !== 1) return;
      now += 37;
      const before = log.count;
      log = updateLog(log, state, now);
      rows.push(...log.rows.filter((r) => Number(r.key) >= before));
    };
    play(t, 1);
    const texts = rows.map((r) => r.text);
    expect(texts[0]).toMatch(/^HAND 000001 {2}BUTTON S\d$/);
    expect(texts[1]).toMatch(/^S\d SB 50$/);
    expect(texts[2]).toMatch(/^S\d BB 100$/);
    expect(texts.some((x) => / WINS [\d,]+$/.test(x))).toBe(true);
    // Every action of hand 1 appears exactly once.
    const h1 = t.conns.get("a")!.states.filter((s) => s.hand?.handNo === 1).at(-1)!.hand!;
    expect(texts.filter((x) => /^S\d (FOLD|CHECK|CALL|BET|RAISE|ALL-IN)/.test(x))).toHaveLength(h1.actions.length);
    const flop = texts.findIndex((x) => x.startsWith("FLOP "));
    if (h1.board.length >= 3) expect(flop).toBeGreaterThan(2);
    expect(rows[0].t).toBe(0);
    expect(rows.at(-1)!.t).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("keeps the last 20 rows with unique keys and returns the same log when nothing changed", () => {
    const t = fourHanded();
    let log = emptyLog();
    t.onState = (conn, state) => {
      if (conn === "a") log = updateLog(log, state, 0);
    };
    play(t, 6);
    expect(log.rows).toHaveLength(20);
    expect(new Set(log.rows.map((r) => r.key)).size).toBe(20);
    const s = t.conns.get("a")!.state!;
    expect(updateLog(log, s, 5)).toBe(log);
    // Cards are written as glyphs.
    const deal = log.rows.find((r) => /^(FLOP|TURN|RIVER) /.test(r.text));
    if (deal) expect(deal.text).toMatch(/[♣♦♥♠]/);
  });
});

describe("cycleNext", () => {
  it("moves to the next option and wraps around", () => {
    const xs = ["nit", "tag", "lag"] as const;
    expect(cycleNext(xs, "nit")).toBe("tag");
    expect(cycleNext(xs, "lag")).toBe("nit");
  });
});

describe("waitingText", () => {
  it("says what the table waits for before the first deal", () => {
    const t = new Table(4);
    t.join("a", "Ana");
    t.join("b", "Ben");
    t.send("a", { type: "sit", seat: 0 });
    expect(waitingText(t.state, true)).toBe("WAITING FOR A SECOND PLAYER");
    expect(waitingText(t.state, false)).toBe("WAITING FOR THE HOST");
    t.send("b", { type: "sit", seat: 1 });
    expect(waitingText(t.state, true)).toBe("PRESS START ABOVE");
    t.send("b", { type: "stand" });
    t.send("a", { type: "start" });
    expect(t.state.started).toBe(true);
    expect(t.state.hand).toBeNull();
    expect(waitingText(t.state, true)).toBe("WAITING FOR PLAYERS");
  });
});
