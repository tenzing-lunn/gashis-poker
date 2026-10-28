import { afterEach, describe, expect, it, vi } from "vitest";
import { createRng, formatCard, type Rng } from "../poker/cards";
import type { Action } from "../engine/engine";
import type { ServerMessage, TableState } from "./protocol";
import { DEFAULT_ROOM_CONFIG, MAX_CONNECTIONS, parseSeatsParam, TableRoom, type RoomConfig, type RoomDeps } from "./room";
import { connectTable, type TableClientEvent } from "./client";

const T0 = 1_800_000_000_000;

type Sent = { conn: string; msg: ServerMessage };

/** A fake platform: clock, alarm, seeded randomness and sockets that record everything sent. */
class Harness {
  t: number;
  alarm: number | null = null;
  /** How many times the room called setAlarm. */
  alarmSets = 0;
  calls = 0;
  /** Fault injection: the random() call that brings `calls` to this number throws. */
  throwAt: number | null = null;
  readonly sent: Sent[] = [];
  /** Connections the room closed, and the close code it gave each. */
  readonly closed: string[] = [];
  readonly closeCodes = new Map<string, number>();
  room!: TableRoom;
  /** Card strings each connection was legitimately dealt, by hand number. */
  dealt = new Map<string, Map<number, Set<string>>>();
  playerOf = new Map<string, string>();
  privacyChecks = 0;

  constructor(
    readonly seed: number,
    config: Partial<RoomConfig> = {},
    restoreFrom?: { snapshot: ReturnType<TableRoom["serialize"]>; t: number; calls: number },
  ) {
    this.rng = createRng(seed);
    this.t = restoreFrom?.t ?? T0;
    if (restoreFrom) {
      for (let i = 0; i < restoreFrom.calls; i++) this.random();
      this.room = TableRoom.restore(restoreFrom.snapshot, this.deps);
    } else {
      this.room = new TableRoom(this.deps, config);
    }
  }

  private rng: Rng;
  private random(): number {
    this.calls++;
    if (this.calls === this.throwAt) throw new Error("injected failure");
    return this.rng.nextU32();
  }

  readonly deps: RoomDeps = {
    now: () => this.t,
    send: (conn, msg) => this.onSend(conn, msg),
    close: (conn, code) => {
      this.closed.push(conn);
      this.closeCodes.set(conn, code);
    },
    setAlarm: (at) => {
      this.alarm = at;
      this.alarmSets++;
    },
    random: () => this.random(),
  };

  connect(conn: string): boolean {
    return this.room.onConnect(conn);
  }
  send(conn: string, msg: unknown): void {
    this.room.onMessage(conn, typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  close(conn: string): void {
    this.room.onClose(conn);
  }

  /** Moves the clock forward, firing the alarm whenever it falls due. */
  advance(ms: number): void {
    const target = this.t + ms;
    while (this.alarm !== null && this.alarm <= target) {
      this.t = Math.max(this.t, this.alarm);
      this.room.onAlarm();
    }
    this.t = target;
  }
  /** Fires the pending alarm now (jumping the clock to it). */
  fire(): void {
    if (this.alarm === null) throw new Error("No alarm pending");
    this.t = Math.max(this.t, this.alarm);
    this.room.onAlarm();
  }

  of(conn: string): ServerMessage[] {
    return this.sent.filter((s) => s.conn === conn).map((s) => s.msg);
  }
  private latest = new Map<string, ServerMessage>();
  lastOf<T extends ServerMessage["type"]>(conn: string, type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.latest.get(`${conn}/${type}`) as Extract<ServerMessage, { type: T }> | undefined;
  }
  state(conn: string): TableState {
    const s = this.lastOf(conn, "state");
    if (!s) throw new Error(`No state for ${conn}`);
    return s.state;
  }

  /** Privacy check on every outgoing message, against the hidden hand at the moment it is sent. */
  private onSend(conn: string, msg: ServerMessage): void {
    const copy0 = JSON.parse(JSON.stringify(msg)) as ServerMessage;
    this.sent.push({ conn, msg: copy0 });
    this.latest.set(`${conn}/${msg.type}`, copy0);
    if (msg.type === "welcome") this.playerOf.set(conn, msg.you.playerId);
    const hand = this.room?.debugHand();
    if (!hand) return;
    const { state: hs, no, seats } = hand;

    if (msg.type === "hole") {
      // Only to a connection whose player sits in that seat, and only that seat's cards.
      const st = this.room.publicState();
      expect(st.seats[msg.seat]?.playerId).toBe(this.playerOf.get(conn));
      expect(msg.handNo).toBe(no);
      expect(msg.cards).toEqual(hs.holeCards[seats.indexOf(msg.seat)].map(formatCard));
      let byHand = this.dealt.get(conn);
      if (!byHand) this.dealt.set(conn, (byHand = new Map()));
      byHand.set(no, new Set(msg.cards));
      return;
    }

    const mine = this.dealt.get(conn)?.get(no) ?? new Set<string>();
    const forbidden = new Set<string>();
    const showdownSeats = new Set<number>();
    if (hs.complete && hs.result!.showdown) hs.result!.values.forEach((v, e) => v !== null && showdownSeats.add(e));
    hs.holeCards.forEach((cards, e) => {
      if (showdownSeats.has(e)) return;
      for (const c of cards) if (!mine.has(formatCard(c))) forbidden.add(formatCard(c));
    });
    // Undealt cards: everything after the hole cards that is not (yet) on the board.
    const n = hs.seatCount;
    for (let k = hs.board.length; k < 5; k++) forbidden.add(formatCard(hs.deck[2 * n + k]));
    for (let k = 2 * n + 5; k < hs.deck.length; k++) forbidden.add(formatCard(hs.deck[k]));

    const copy = JSON.parse(JSON.stringify(msg)) as ServerMessage;
    let last = null;
    if (copy.type === "state") {
      last = copy.state.lastResult;
      copy.state.lastResult = null;
    }
    const json = JSON.stringify(copy);
    for (const c of forbidden) expect(json.includes(`"${c}"`), `${c} leaked to ${conn} in ${json.slice(0, 200)}`).toBe(false);
    this.privacyChecks++;

    // lastResult belongs to the current hand once it is complete, else to an earlier one.
    if (last && last.handNo === no) {
      expect(hs.complete).toBe(true);
      const expected = [...showdownSeats].map((e) => ({ seat: seats[e], cards: hs.holeCards[e].map(formatCard) }));
      expect(last.revealed.map((r) => ({ seat: r.seat, cards: r.cards }))).toEqual(expected);
      const lastJson = JSON.stringify({ ...last, revealed: [] });
      for (const c of forbidden) expect(lastJson.includes(`"${c}"`)).toBe(false);
    }
  }
}

/** A simple deterministic human: check, call small bets, sometimes min-raise, else fold. */
function humanAction(st: TableState, salt: number): Action {
  const la = st.hand!.legal!;
  const k = (st.handNo * 7 + st.hand!.actions.length * 13 + salt) % 10;
  if (la.canRaise && k === 0) return { type: "raise", to: la.minRaiseTo };
  if (la.canCheck) return { type: "check" };
  if (la.toCall <= 400 || k < 6) return { type: "call" };
  return { type: "fold" };
}

/** Lets the humans in `humans` (conn -> seat) act whenever it is their turn; otherwise advances time. */
function step(h: Harness, humans: Record<string, number>, salt = 0): void {
  const conns = Object.keys(humans);
  const st = h.state(conns[0]);
  if (st.hand && !st.hand.complete && st.toAct !== null) {
    const conn = conns.find((c) => humans[c] === st.toAct);
    if (conn) {
      h.send(conn, { type: "act", handNo: st.handNo, action: humanAction(st, salt) });
      return;
    }
  }
  h.fire();
}

function setupTable(seed: number, bots: { seat: number; persona: string }[], config: Partial<RoomConfig> = {}): Harness {
  const h = new Harness(seed, { seats: 6, ...config });
  h.connect("a");
  h.connect("b");
  h.send("a", { type: "join", name: "Alice" });
  h.send("b", { type: "join", name: "  Bob  " });
  h.send("a", { type: "sit", seat: 0 });
  h.send("b", { type: "sit", seat: 3 });
  for (const b of bots) h.send("a", { type: "addBot", ...b });
  h.send("a", { type: "start" });
  return h;
}

const stripSeq = (snap: ReturnType<TableRoom["serialize"]>) => ({ ...snap, seq: 0 });

describe("TableRoom", () => {
  it("plays 200 hands with 2 humans and bots, conserving chips, never leaking cards", () => {
    const h = setupTable(1, [
      { seat: 1, persona: "tag" },
      { seat: 2, persona: "maniac" },
      { seat: 4, persona: "station" },
    ]);
    expect(h.state("b").seats[3]?.name).toBe("Bob");
    const humans = { a: 0, b: 3 };
    let checkedHands = 0;
    let lastChecked = 0;
    for (let i = 0; i < 200_000 && checkedHands < 200; i++) {
      step(h, humans);
      const st = h.state("a");
      if (st.hand && !st.hand.complete) {
        // Per seat: chips behind + chips in = starting stack of the hand.
        const hs = h.room.debugHand()!.state;
        st.hand.players.forEach((p, e) => expect(p.stack + p.committed).toBe(hs.startingStacks[e]));
      }
      if (st.lastResult && st.lastResult.handNo > lastChecked && st.hand?.complete) {
        const r = st.lastResult;
        lastChecked = r.handNo;
        expect(r.net.reduce((a, x) => a + x.amount, 0)).toBe(0);
        const hs = h.room.debugHand()!.state;
        const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        expect(total(hs.result!.finalStacks)).toBe(total(hs.startingStacks));
        for (const { seat, amount } of r.net) {
          const e = st.hand.players.findIndex((p) => p.seat === seat);
          expect(st.seats[seat]!.stack).toBe(hs.startingStacks[e] + amount);
        }
        expect(r.pots.reduce((a, p) => a + p.amount, 0)).toBe(total(hs.committed));
        checkedHands++;
      }
    }
    expect(checkedHands).toBe(200);
    expect(h.privacyChecks).toBeGreaterThan(1000);
    // Both humans got their hole cards every hand they were dealt in.
    expect(h.of("a").filter((m) => m.type === "hole").length).toBeGreaterThanOrEqual(190);
    // seq strictly increases per connection.
    for (const c of ["a", "b"]) {
      const seqs = h.of(c).map((m) => m.seq);
      for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  }, 60_000);

  it("never reveals folded or uncontested hands, and reveals showdown hands after the hand", () => {
    const h = setupTable(5, [{ seat: 1, persona: "station" }]);
    let sawShowdown = false;
    let sawFoldWin = false;
    for (let i = 0; i < 20_000 && !(sawShowdown && sawFoldWin); i++) {
      step(h, { a: 0, b: 3 }, 3);
      const r = h.state("a").lastResult;
      if (r?.showdown) sawShowdown = true;
      if (r && !r.showdown) {
        sawFoldWin = true;
        expect(r.revealed).toEqual([]);
      }
    }
    expect(sawShowdown && sawFoldWin).toBe(true);
  }, 60_000);

  it("rejects out-of-turn, stale, illegal, malformed and non-host messages without changing state", () => {
    const h = setupTable(2, []);
    const st = h.state("a");
    expect(st.handNo).toBe(1);
    const toAct = st.toAct!;
    const [actor, other] = toAct === 0 ? ["a", "b"] : ["b", "a"];
    const la = st.hand!.legal!;
    const before = stripSeq(h.room.serialize());
    const cases: [string, unknown, string][] = [
      [other, { type: "act", handNo: 1, action: { type: "call" } }, "not_your_turn"],
      [actor, { type: "act", handNo: 0, action: { type: "call" } }, "stale_hand"],
      [actor, { type: "act", handNo: 2, action: { type: "call" } }, "stale_hand"],
      [actor, { type: "act", handNo: 1, action: { type: "raise", to: la.minRaiseTo - 1 } }, "illegal_action"],
      [actor, { type: "act", handNo: 1, action: { type: "raise", to: la.maxRaiseTo + 1 } }, "illegal_action"],
      [actor, { type: "act", handNo: 1, action: { type: "check" } }, "illegal_action"],
      [actor, "{not json", "malformed"],
      [actor, { type: "act", handNo: 1, action: { type: "raise", to: "300" } }, "malformed"],
      [actor, { type: "teleport" }, "malformed"],
      [actor, [1, 2], "malformed"],
      ["b", { type: "start" }, "not_host"],
      ["b", { type: "addBot", seat: 5, persona: "tag" }, "not_host"],
      ["a", { type: "start" }, "already_started"],
      ["a", { type: "sit", seat: 3 }, "already_seated"],
      ["a", { type: "join", name: "Again" }, "already_joined"],
    ];
    for (const [conn, msg, code] of cases) {
      h.send(conn, msg);
      const last = h.of(conn).at(-1)!;
      expect(last.type, JSON.stringify(msg)).toBe("error");
      expect((last as Extract<ServerMessage, { type: "error" }>).code).toBe(code);
    }
    expect(stripSeq(h.room.serialize())).toEqual(before);

    h.connect("c");
    h.send("c", { type: "sit", seat: 5 });
    expect(h.lastOf("c", "error")?.code).toBe("not_joined");
    h.send("c", { type: "join", name: "   " });
    expect(h.lastOf("c", "error")?.code).toBe("bad_name");
    h.send("c", { type: "join", name: "x".repeat(17) });
    expect(h.lastOf("c", "error")?.code).toBe("bad_name");
    h.send("c", { type: "join", name: "<b>Eve\u0000</b>" });
    expect(h.lastOf("c", "welcome")?.you.isHost).toBe(false);
    h.send("c", { type: "sit", seat: 0 });
    expect(h.lastOf("c", "error")?.code).toBe("seat_taken");
    h.send("c", { type: "sit", seat: 6 });
    expect(h.lastOf("c", "error")?.code).toBe("bad_seat");

    // A legal action goes through.
    h.send(actor, { type: "act", handNo: 1, action: { type: "call" } });
    expect(h.state("a").hand!.actions.at(-1)).toMatchObject({ seat: toAct, action: "call" });
  });

  it("rate-limits each connection", () => {
    const h = setupTable(3, []);
    h.advance(1001);
    const start = h.of("a").length;
    for (let i = 0; i < 25; i++) h.send("a", { type: "ping", id: i });
    const got = h.of("a").slice(start);
    expect(got.filter((m) => m.type === "pong").length).toBe(20);
    expect(got.filter((m) => m.type === "error" && m.code === "rate_limited").length).toBe(5);
    h.advance(1001);
    h.send("a", { type: "ping", id: 99 });
    expect(h.of("a").at(-1)).toMatchObject({ type: "pong", id: 99 });
  });

  it("auto-checks or folds on timeout and sits a player out after 2 timeouts", () => {
    const h = setupTable(4, [{ seat: 1, persona: "station" }]);
    const timeouts = () => h.state("b").hand?.actions.filter((x) => x.auto && x.seat === 0) ?? [];
    let total = 0;
    // Alice never acts; Bob plays. Alice should time out twice and then be sitting out.
    for (let i = 0; i < 5000 && !h.state("a").seats[0]!.sittingOut; i++) {
      const st = h.state("b");
      if (st.hand && !st.hand.complete && st.toAct === 0) {
        const la = st.hand.legal!;
        const n = st.hand.actions.length;
        expect(st.deadline! - h.t).toBeGreaterThan(19_000);
        h.advance(st.deadline! - h.t - 1);
        expect(h.state("b").hand!.actions.length).toBe(n);
        h.advance(1);
        const auto = timeouts().at(-1)!;
        expect(auto.action).toBe(la.canCheck ? "check" : "fold");
        total++;
        continue;
      }
      step(h, { b: 3 });
    }
    expect(total).toBe(2);
    expect(h.state("a").seats[0]!.sittingOut).toBe(true);
    // Play on: Alice is no longer dealt in, even though her seat is kept.
    const handNo = h.state("a").handNo;
    for (let i = 0; i < 200 && h.state("a").handNo < handNo + 2; i++) step(h, { b: 3 });
    expect(h.state("a").hand!.players.map((p) => p.seat)).not.toContain(0);
    expect(h.state("a").seats[0]!.name).toBe("Alice");
    // Sitting back in at her own seat brings her back next hand.
    h.send("a", { type: "sit", seat: 0 });
    expect(h.state("a").seats[0]!.sittingOut).toBe(false);
    const n2 = h.state("a").handNo;
    for (let i = 0; i < 500 && h.state("a").handNo < n2 + 1; i++) step(h, { a: 0, b: 3 });
    expect(h.state("a").hand!.players.map((p) => p.seat)).toContain(0);
  });

  it("keeps a disconnected player's seat on the clock and restores it on reconnect with the token", () => {
    const h = setupTable(6, [{ seat: 1, persona: "tag" }]);
    const welcome = h.lastOf("a", "welcome")!;
    const hole = h.lastOf("a", "hole")!;
    expect(hole.handNo).toBe(1);
    h.close("a");
    expect(h.state("b").seats[0]).toMatchObject({ name: "Alice", connected: false });
    // Her clock still runs: if she is due, she gets auto-acted after 20s.
    h.connect("a2");
    h.send("a2", { type: "join", name: "", token: welcome.you.token });
    const w2 = h.lastOf("a2", "welcome")!;
    expect(w2.you).toEqual({ ...welcome.you, seat: 0 });
    expect(h.lastOf("a2", "hole")).toMatchObject({ handNo: 1, seat: 0, cards: hole.cards });
    expect(h.state("b").seats[0]).toMatchObject({ connected: true });
    // A wrong token is just a new player.
    h.connect("x");
    h.send("x", { type: "join", name: "Mallory", token: "f".repeat(32) });
    expect(h.lastOf("x", "welcome")!.you.playerId).not.toBe(welcome.you.playerId);
    expect(h.lastOf("x", "hole")).toBeUndefined();

    // Disconnected players time out like anyone else.
    h.close("a2");
    for (let i = 0; i < 2000 && !h.state("b").seats[0]!.sittingOut; i++) step(h, { b: 3 });
    expect(h.state("b").seats[0]!.sittingOut).toBe(true);
  });

  it("does not deal with only bots and disconnected humans, and stands players up", () => {
    const h = setupTable(8, [{ seat: 1, persona: "nit" }]);
    h.send("b", { type: "stand" });
    expect(h.state("a").seats[3]).toMatchObject({ leaving: true });
    for (let i = 0; i < 100 && h.state("a").seats[3]; i++) step(h, { a: 0 });
    expect(h.state("a").seats[3]).toBeNull();
    h.send("a", { type: "removeBot", seat: 1 });
    for (let i = 0; i < 100 && h.state("a").seats[1]; i++) step(h, { a: 0 });
    expect(h.state("a").seats[1]).toBeNull();
    // Alone at the table: no hand, and no alarm but the idle backstop hours away.
    const backstop = DEFAULT_ROOM_CONFIG.idleMs / 2;
    for (let i = 0; i < 10 && h.alarm !== null && h.alarm < h.t + backstop; i++) h.fire();
    expect(h.state("a").hand).toBeNull();
    expect(h.alarm).toBeGreaterThan(h.t + backstop);
  });

  it("keeps a folded player's seat reserved until the hand ends", () => {
    const h = setupTable(9, [
      { seat: 1, persona: "station" },
      { seat: 2, persona: "station" },
    ]);
    h.connect("c");
    h.send("c", { type: "join", name: "Carol" });
    // Bob stands up at once (he is folded when his turn comes); nobody may take his seat mid-hand.
    h.send("b", { type: "stand" });
    const bobFolded = () => {
      const d = h.room.debugHand()!;
      return d.no === 1 && d.state.folded[d.seats.indexOf(3)];
    };
    for (let i = 0; i < 50 && !bobFolded(); i++) step(h, { a: 0 });
    expect(bobFolded()).toBe(true);
    expect(h.room.debugHand()!.state.complete).toBe(false);
    h.send("c", { type: "sit", seat: 3 });
    expect(h.lastOf("c", "error")?.code).toBe("seat_taken");
    expect(h.lastOf("c", "hole")).toBeUndefined();
    for (let i = 0; i < 100 && !h.state("a").hand!.complete; i++) step(h, { a: 0 });
    h.fire(); // next hand
    expect(h.state("a").seats[3]).toBeNull();
    h.send("c", { type: "sit", seat: 3 });
    expect(h.state("c").seats[3]?.name).toBe("Carol");
  });

  it("forgets the longest-gone watchers instead of filling up, keeping seated players and the host", () => {
    const h = new Harness(10, { seats: 6 });
    h.connect("host");
    h.send("host", { type: "join", name: "Host" });
    const host = h.lastOf("host", "welcome")!.you;
    h.connect("bob");
    h.send("bob", { type: "join", name: "Bob" });
    h.send("bob", { type: "sit", seat: 1 });
    const bob = h.lastOf("bob", "welcome")!.you;
    h.close("bob");
    h.close("host");
    let first: { playerId: string; token: string } | undefined;
    for (let i = 0; i < 300; i++) {
      const c = `w${i}`;
      h.connect(c);
      h.send(c, { type: "join", name: `W${i}` });
      const w = h.lastOf(c, "welcome");
      expect(w, `join ${i}: ${JSON.stringify(h.lastOf(c, "error"))}`).toBeDefined();
      first ??= w!.you;
      h.close(c);
      h.t += 1;
    }
    expect(h.room.serialize().players.length).toBeLessThanOrEqual(200);
    // The first watcher was dropped: their token now just makes a new player.
    h.connect("w0b");
    h.send("w0b", { type: "join", name: "W0", token: first!.token });
    expect(h.lastOf("w0b", "welcome")!.you.playerId).not.toBe(first!.playerId);
    // The host and the seated (disconnected) player were kept.
    h.connect("host2");
    h.send("host2", { type: "join", name: "", token: host.token });
    expect(h.lastOf("host2", "welcome")!.you).toMatchObject({ playerId: host.playerId, isHost: true });
    h.connect("bob2");
    h.send("bob2", { type: "join", name: "", token: bob.token });
    expect(h.lastOf("bob2", "welcome")!.you).toMatchObject({ playerId: bob.playerId, seat: 1 });
  });

  it("keeps a player's chips when they stand up and re-sit; only a busted player buys in again", () => {
    const h = setupTable(11, [{ seat: 1, persona: "maniac" }]);
    for (let i = 0; i < 5000; i++) {
      const st = h.state("a");
      if (st.hand?.complete && st.seats[0]!.stack !== 10_000 && st.seats[0]!.stack > 0) break;
      step(h, { a: 0, b: 3 });
    }
    const st = h.state("a");
    expect(st.hand!.complete).toBe(true);
    const stack = st.seats[0]!.stack;
    h.send("a", { type: "stand" });
    expect(h.state("a").seats[0]).toBeNull();
    h.send("a", { type: "sit", seat: 5 });
    expect(h.state("a").seats[5]).toMatchObject({ name: "Alice", stack });

    h.send("a", { type: "stand" });
    const snapshot = h.room.serialize();
    snapshot.players.find((p) => p.name === "Alice")!.stack = 0;
    const r = new Harness(11, {}, { snapshot, t: h.t, calls: h.calls });
    r.send("a", { type: "sit", seat: 5 });
    expect(r.state("a").seats[5]).toMatchObject({ name: "Alice", stack: 10_000 });
  });

  it("rejects a nickname that another player or a bot persona uses", () => {
    const h = new Harness(12, { seats: 6 });
    h.connect("a");
    h.send("a", { type: "join", name: "Alice" });
    h.connect("b");
    h.send("b", { type: "join", name: "Bob" });
    h.connect("c");
    for (const name of ["alice", " BOB ", "Nit", "calling STATION"]) {
      h.send("c", { type: "join", name });
      expect(h.of("c").at(-1), name).toMatchObject({ type: "error", code: "name_taken" });
    }
    // A watcher who has left keeps the name while the table remembers them.
    h.close("b");
    h.send("c", { type: "join", name: "bob" });
    expect(h.of("c").at(-1)).toMatchObject({ type: "error", code: "name_taken" });
    h.send("c", { type: "join", name: "Carol" });
    expect(h.lastOf("c", "welcome")).toBeDefined();
    expect(h.state("c").hostId).toBe(h.lastOf("a", "welcome")!.you.playerId);
  });

  it("describes illegal actions in table terms, not engine seats", () => {
    const h = setupTable(2, []);
    const st = h.state("a");
    const actor = st.toAct === 0 ? "a" : "b";
    expect(st.hand!.legal).toMatchObject({ minRaiseTo: 200, maxRaiseTo: 10_000, toCall: 50 });
    h.send(actor, { type: "act", handNo: 1, action: { type: "raise", to: 10_001 } });
    expect(h.lastOf(actor, "error")).toMatchObject({ code: "illegal_action", message: "Raise must be between 200 and 10,000" });
    h.send(actor, { type: "act", handNo: 1, action: { type: "check" } });
    expect(h.lastOf(actor, "error")).toMatchObject({ code: "illegal_action", message: "You can't check: 50 to call" });
    expect(JSON.stringify(h.of(actor))).not.toMatch(/Seat \d/);
  });

  it("guards only a bot's decision: an error after its action does not auto-act the next seat", () => {
    const h = setupTable(13, [
      { seat: 1, persona: "station" },
      { seat: 2, persona: "station" },
    ]);
    let threw = false;
    for (let i = 0; i < 5000 && !threw; i++) {
      const st = h.state("a");
      if (st.hand && !st.hand.complete && (st.toAct === 1 || st.toAct === 2)) {
        const n = st.hand.actions.length;
        // Call 1 is the bot's decision; call 2 would be the next bot's think delay.
        h.throwAt = h.calls + 2;
        try {
          h.fire();
        } catch {
          threw = true;
        }
        h.throwAt = null;
        if (!threw) continue;
        const after = h.state("a");
        expect(after.hand!.actions.length).toBe(n + 1);
        expect(after.hand!.actions.at(-1)).toMatchObject({ seat: st.toAct });
        expect(after.hand!.actions.at(-1)!.auto).toBeUndefined();
        const next = after.toAct!;
        expect([1, 2]).toContain(next);
        // The room recovers: the next bot acts on its own when the (re-armed) alarm fires.
        expect(h.alarm).not.toBeNull();
        h.fire();
        expect(h.state("a").hand!.actions.at(n + 1)).toMatchObject({ seat: next });
        expect(h.state("a").hand!.actions.at(n + 1)!.auto).toBeUndefined();
        continue;
      }
      step(h, { a: 0, b: 3 });
    }
    expect(threw).toBe(true);
  });

  it("still broadcasts and re-arms the alarm when handling a message throws part-way", () => {
    const h = setupTable(14, [{ seat: 1, persona: "station" }]);
    let threw = false;
    for (let i = 0; i < 5000 && !threw; i++) {
      const st = h.state("b");
      if (st.hand && !st.hand.complete && st.toAct === 0) {
        const n = st.hand.actions.length;
        const la = st.hand.legal!;
        h.throwAt = h.calls + 1; // the bot's think delay, after Alice's action is applied
        try {
          h.send("a", { type: "act", handNo: st.handNo, action: la.canCheck ? { type: "check" } : { type: "call" } });
        } catch {
          threw = true;
        }
        h.throwAt = null;
        if (!threw) continue;
        expect(h.state("b").hand!.actions.length).toBe(n + 1);
        expect(h.state("b").hand!.actions.at(-1)).toMatchObject({ seat: 0 });
        expect(h.state("b").toAct).toBe(1);
        expect(h.alarm).not.toBeNull();
        h.fire();
        expect(h.state("b").hand!.actions.at(n + 1)).toMatchObject({ seat: 1 });
        continue;
      }
      step(h, { a: 0, b: 3 });
    }
    expect(threw).toBe(true);
  });

  it("caps connections per table and closes sockets that never join", () => {
    const h = new Harness(15, { seats: 6 });
    for (let i = 0; i < 64; i++) expect(h.connect(`c${i}`)).toBe(true);
    expect(h.connect("extra")).toBe(false);
    h.send("c0", { type: "join", name: "Alice" });
    h.advance(14_999);
    expect(h.closed).toEqual([]);
    h.advance(1);
    expect(h.closed).toHaveLength(63);
    expect(h.closed).not.toContain("c0");
    expect(h.connect("extra")).toBe(true);
    h.send("c0", { type: "ping", id: 1 });
    expect(h.of("c0").at(-1)).toMatchObject({ type: "pong", id: 1 });
  });

  it("hands the host role to the longest-seated connected human when the host leaves", () => {
    const h = new Harness(16, { seats: 6 });
    for (const [c, name] of [
      ["a", "Alice"],
      ["b", "Bob"],
      ["c", "Carol"],
    ]) {
      h.connect(c);
      h.send(c, { type: "join", name });
    }
    const id = (c: string) => h.lastOf(c, "welcome")!.you.playerId;
    h.send("a", { type: "sit", seat: 0 });
    h.t += 1;
    h.send("c", { type: "sit", seat: 2 });
    h.t += 1;
    h.send("b", { type: "sit", seat: 1 });
    // A seated host who drops has 30 s to come back.
    h.close("a");
    h.advance(29_000);
    expect(h.state("b").hostId).toBe(id("a"));
    h.connect("a2");
    h.send("a2", { type: "join", name: "", token: h.lastOf("a", "welcome")!.you.token });
    h.advance(10_000);
    expect(h.state("b").hostId).toBe(id("a"));
    h.close("a2");
    h.advance(29_999);
    expect(h.state("b").hostId).toBe(id("a"));
    h.advance(1);
    expect(h.state("b").hostId).toBe(id("c")); // Carol sat down before Bob
    // A host who stands up and leaves gets the same grace.
    h.send("c", { type: "stand" });
    h.close("c");
    expect(h.state("b").hostId).toBe(id("c"));
    h.advance(30_000);
    expect(h.state("b").hostId).toBe(id("b"));
    h.send("b", { type: "start" });
    expect(h.state("b").started).toBe(true);
  });

  it("serialize() -> restore() mid-hand resumes identically", () => {
    const mk = () =>
      setupTable(7, [
        { seat: 1, persona: "lag" },
        { seat: 2, persona: "micro" },
      ]);
    const a = mk();
    const humans = { a: 0, b: 3 };
    for (let i = 0; i < 40; i++) step(a, humans);
    // Get to a point mid-hand.
    while (!a.state("a").hand || a.state("a").hand!.complete) step(a, humans);
    const snapshot = JSON.parse(JSON.stringify(a.room.serialize()));
    const b = new Harness(7, {}, { snapshot, t: a.t, calls: a.calls });
    b.playerOf = new Map(a.playerOf);
    b.dealt = new Map([...a.dealt].map(([k, v]) => [k, new Map(v)]));
    b.alarm = a.alarm;
    const startA = a.sent.length;
    const stateAtRestore = a.state("a");
    // Same inputs to both from here on: the humans act on the latest state each harness sent.
    const drive = (h: Harness, from: number) => {
      let st = stateAtRestore;
      for (let i = 0; i < 300; i++) {
        const latest = h.sent.slice(from).filter((x) => x.conn === "a" && x.msg.type === "state").at(-1);
        if (latest) st = (latest.msg as Extract<ServerMessage, { type: "state" }>).state;
        if (st.hand && !st.hand.complete && (st.toAct === 0 || st.toAct === 3)) {
          h.send(st.toAct === 0 ? "a" : "b", { type: "act", handNo: st.handNo, action: humanAction(st, 1) });
        } else h.fire();
      }
    };
    drive(a, startA);
    drive(b, 0);
    // Identical apart from seq, which jumps forward on restore (it never repeats; see TableRoom.restore).
    const noSeq = (xs: Sent[]) => xs.map(({ conn, msg }) => ({ conn, msg: { ...msg, seq: 0 } }));
    expect(noSeq(b.sent)).toEqual(noSeq(a.sent.slice(startA)));
    expect(b.sent[0].msg.seq).toBeGreaterThan(a.sent[startA - 1].msg.seq);
    expect(stripSeq(b.room.serialize())).toEqual(stripSeq(a.room.serialize()));
    expect(a.state("a").handNo).toBeGreaterThan(stateAtRestore.handNo + 3);
  });
});

describe("TableRoom hardening", () => {
  it("lets a seated player or the host back in at the connection cap by evicting the oldest watcher", () => {
    const h = new Harness(17, { seats: 6 });
    h.connect("host");
    h.send("host", { type: "join", name: "Host" });
    const host = h.lastOf("host", "welcome")!.you;
    h.connect("f");
    h.send("f", { type: "join", name: "Friend" });
    h.send("f", { type: "sit", seat: 1 });
    const friend = h.lastOf("f", "welcome")!.you;
    for (let i = 0; i < MAX_CONNECTIONS - 2; i++) {
      h.connect(`q${i}`);
      h.send(`q${i}`, { type: "join", name: `q${i}` });
    }
    expect(h.room.serialize().conns).toHaveLength(MAX_CONNECTIONS);
    // A newcomer's socket opens, but nobody may be evicted for them: turned away on join.
    expect(h.connect("new")).toBe(true);
    h.send("new", { type: "join", name: "Newcomer" });
    expect(h.lastOf("new", "error")?.code).toBe("table_full");
    expect(h.lastOf("new", "welcome")).toBeUndefined();
    expect(h.closeCodes.get("new")).toBe(4001);
    // The friend drops and a watcher takes the freed slot; the friend still gets back in.
    h.close("f");
    h.connect("grab");
    h.send("grab", { type: "join", name: "Grabber" });
    expect(h.connect("f2")).toBe(true);
    h.send("f2", { type: "join", name: "", token: friend.token });
    expect(h.lastOf("f2", "welcome")!.you).toMatchObject({ playerId: friend.playerId, seat: 1 });
    expect(h.closed).toEqual(["new", "q0"]);
    expect(h.lastOf("q0", "error")?.code).toBe("table_full");
    expect(h.closeCodes.get("q0")).toBe(4001);
    // So does an unseated host.
    h.close("host");
    h.connect("grab2");
    h.send("grab2", { type: "join", name: "Grabber2" });
    expect(h.connect("host2")).toBe(true);
    h.send("host2", { type: "join", name: "", token: host.token });
    expect(h.lastOf("host2", "welcome")!.you).toMatchObject({ playerId: host.playerId, isHost: true });
    expect(h.closed).toEqual(["new", "q0", "q1"]);
    expect(h.room.serialize().conns).toHaveLength(MAX_CONNECTIONS);
    // Sockets past the cap stay bounded, and a message on an unknown connection does not register it.
    let accepted = 0;
    for (let i = 0; i < 50; i++) if (h.connect(`x${i}`)) accepted++;
    expect(accepted).toBe(8);
    h.send("ghost", { type: "join", name: "Ghost" });
    expect(h.lastOf("ghost", "welcome")).toBeUndefined();
    expect(h.room.serialize().conns).toHaveLength(MAX_CONNECTIONS + accepted);
  });

  it("gives an unseated host the same 30 s grace as a seated one", () => {
    const h = new Harness(18, { seats: 6 });
    h.connect("h");
    h.send("h", { type: "join", name: "Host" });
    h.connect("f");
    h.send("f", { type: "join", name: "Friend" });
    h.send("f", { type: "sit", seat: 1 });
    const host = h.lastOf("h", "welcome")!.you;
    // A page refresh: gone for a moment, back with the token, still host.
    h.close("h");
    expect(h.state("f").hostId).toBe(host.playerId);
    h.advance(5_000);
    expect(h.state("f").hostId).toBe(host.playerId);
    h.connect("h2");
    h.send("h2", { type: "join", name: "", token: host.token });
    expect(h.lastOf("h2", "welcome")!.you.isHost).toBe(true);
    // Gone for good: the role moves on once the grace runs out.
    h.close("h2");
    h.advance(29_999);
    expect(h.state("f").hostId).toBe(host.playerId);
    h.advance(1);
    expect(h.state("f").hostId).toBe(h.lastOf("f", "welcome")!.you.playerId);
  });

  it("restores a version 1 snapshot without timestamps to finite deadlines", () => {
    const h = new Harness(19, { seats: 6 });
    h.connect("h");
    h.send("h", { type: "join", name: "Host" });
    h.send("h", { type: "sit", seat: 0 });
    h.connect("f");
    h.send("f", { type: "join", name: "Friend" });
    h.send("f", { type: "sit", seat: 1 });
    h.connect("u"); // never joins
    h.close("h");
    const old = h.room.serialize() as unknown as { v: number; players: Record<string, unknown>[]; conns: Record<string, unknown>[] };
    old.v = 1;
    for (const p of old.players) {
      delete p.lastSeen;
      delete p.seatedAt;
    }
    for (const c of old.conns) delete c.openedAt;
    const r = new Harness(19, {}, { snapshot: old as unknown as ReturnType<TableRoom["serialize"]>, t: h.t + 1000, calls: h.calls });
    expect(Number.isFinite(r.alarm)).toBe(true);
    expect(r.alarm!).toBeGreaterThan(r.t);
    const snap = r.room.serialize();
    expect(snap.v).toBe(2);
    for (const p of snap.players) expect([p.lastSeen, p.seatedAt].every(Number.isFinite)).toBe(true);
    // The unjoined socket still times out and the absent host still hands over.
    r.advance(30_000);
    expect(r.closed).toEqual(["u"]);
    expect(r.room.publicState().hostId).toBe(h.lastOf("f", "welcome")!.you.playerId);
  });

  it("rejects look-alike nicknames and names of players who left, but keeps a returning player's own name", () => {
    const h = new Harness(20, { seats: 6 });
    h.connect("a");
    h.send("a", { type: "join", name: "Alice" });
    h.connect("b");
    h.send("b", { type: "join", name: "Bob" });
    const bob = h.lastOf("b", "welcome")!.you;
    h.close("b");
    h.connect("c");
    // Cyrillic A, fullwidth, Cyrillic i, Cyrillic o, a left player's name, Cyrillic i in a persona, Greek Tau, Cyrillic a.
    for (const name of ["\u0410lice", "\uff21\uff2c\uff29\uff23\uff25", "Al\u0456ce", "b\u043eb", "BOB", "N\u0456t", "\u03a4AG", "M\u0430niac"]) {
      h.send("c", { type: "join", name });
      expect(h.of("c").at(-1), name).toMatchObject({ type: "error", code: "name_taken" });
    }
    h.send("c", { type: "join", name: "\uff23\uff41\uff52\uff4f\uff4c" }); // fullwidth "Carol"
    expect(h.lastOf("c", "welcome")).toBeDefined();
    h.send("c", { type: "sit", seat: 2 });
    expect(h.state("c").seats[2]?.name).toBe("Carol");
    // Bob, back with his token, keeps his name.
    h.connect("b2");
    h.send("b2", { type: "join", name: "Bob", token: bob.token });
    expect(h.lastOf("b2", "welcome")!.you.playerId).toBe(bob.playerId);
    h.send("b2", { type: "sit", seat: 3 });
    expect(h.state("b2").seats[3]?.name).toBe("Bob");
  });

  it("backs the alarm off while a due event keeps throwing, and resets once it succeeds", () => {
    const h = setupTable(21, [{ seat: 1, persona: "station" }]);
    const room = h.room as unknown as { turnDue(): void };
    const failing = () => {
      room.turnDue = () => {
        throw new Error("injected failure");
      };
    };
    const fireFailing = (): number => {
      expect(() => h.fire()).toThrow("injected failure");
      return h.alarm! - h.t;
    };
    failing();
    const delays = Array.from({ length: 7 }, fireFailing);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    Reflect.deleteProperty(room, "turnDue");
    const n = h.state("a").hand!.actions.length;
    h.fire();
    expect(h.state("a").hand!.actions.length).toBe(n + 1);
    failing();
    expect(fireFailing()).toBe(1_000);
  });

  it("seats a new player who joins with sit in the lowest free seat, and leaves them watching when full", () => {
    const h = new Harness(21, { seats: 3 });
    for (const c of ["a", "b", "c", "d"]) h.connect(c);
    h.send("a", { type: "join", name: "Alice", sit: true });
    expect(h.lastOf("a", "welcome")?.you.seat).toBe(0);
    h.send("b", { type: "join", name: "Bob", sit: true });
    expect(h.lastOf("b", "welcome")?.you.seat).toBe(1);
    h.send("a", { type: "addBot", seat: 2, persona: "tag" });
    h.send("c", { type: "join", name: "Carol", sit: true });
    expect(h.lastOf("c", "welcome")?.you.seat).toBeNull();
    expect(h.lastOf("c", "error")).toBeUndefined();
    expect(h.state("c").seats.map((s) => s?.name)).toEqual(["Alice", "Bob", "TAG"]);
    // Without sit nobody is seated (the default stays as before).
    h.send("d", { type: "join", name: "Dan" });
    expect(h.lastOf("d", "welcome")?.you.seat).toBeNull();
  });

  it("does not reseat a returning player who stood, even when they rejoin with sit", () => {
    const h = new Harness(22, { seats: 4 });
    h.connect("a");
    h.send("a", { type: "join", name: "Alice", sit: true });
    const token = h.lastOf("a", "welcome")!.you.token;
    h.send("a", { type: "stand" });
    h.close("a");
    h.connect("a2");
    h.send("a2", { type: "join", name: "Alice", token, sit: true });
    expect(h.lastOf("a2", "welcome")?.you.seat).toBeNull();
    expect(h.state("a2").seats.every((s) => s === null)).toBe(true);
  });

  it("refuses a join whose sit is not a boolean", () => {
    const h = new Harness(23);
    h.connect("a");
    h.send("a", { type: "join", name: "Alice", sit: "yes" });
    expect(h.lastOf("a", "error")?.code).toBe("malformed");
    expect(h.lastOf("a", "welcome")).toBeUndefined();
  });

  it("closes a table nobody has connected to for idleMs", () => {
    const h = new Harness(24, { idleMs: 60_000 });
    expect(h.alarm).toBe(T0 + 60_000);
    expect(h.room.closed).toBe(false);
    h.advance(59_999);
    expect(h.room.closed).toBe(false);
    h.advance(1);
    expect(h.room.closed).toBe(true);
    expect(h.alarm).toBeNull();
    // A closed room asks for nothing more.
    h.room.onAlarm();
    expect(h.alarm).toBeNull();
  });

  it("stops the idle clock while anyone is connected and restarts it when the last one leaves", () => {
    const h = new Harness(25, { idleMs: 60_000 });
    h.advance(30_000);
    h.connect("a");
    h.send("a", { type: "join", name: "Alice", sit: true });
    // While someone is here only the backstop wake-up is due, idleMs after they connected.
    expect(h.alarm).toBe(T0 + 30_000 + 60_000);
    h.advance(10 * 60_000);
    expect(h.room.closed).toBe(false);
    const closedAt = h.t;
    h.close("a");
    // The host hand-over (30 s) is due first; the idle close comes idleMs after the last one left.
    h.advance(59_999);
    expect(h.room.closed).toBe(false);
    expect(h.alarm).toBe(closedAt + 60_000);
    h.advance(1);
    expect(h.room.closed).toBe(true);
  });

  it("does not close while an unjoined socket is open", () => {
    const h = new Harness(27, { idleMs: 60_000 });
    h.advance(59_000);
    h.connect("b"); // closed by the join timeout 15 s later, which restarts the idle clock
    h.advance(15_000);
    expect(h.room.closed).toBe(false);
    expect(h.alarm).toBe(T0 + 59_000 + 15_000 + 60_000);
  });

  it("wakes up while connected so sockets lost without a close event start the idle clock", () => {
    const h = new Harness(28, { idleMs: 60_000 });
    h.connect("a");
    h.send("a", { type: "join", name: "Alice", sit: true });
    expect(h.alarm).not.toBeNull();
    expect(h.alarm!).toBeLessThanOrEqual(h.t + 60_000);
    // Still connected when it fires: it only moves another idleMs out.
    h.advance(h.alarm! - h.t);
    expect(h.room.closed).toBe(false);
    expect(h.alarm).toBe(h.t + 60_000);
    // The platform finds no socket really open (e.g. after a deploy): the idle clock starts now.
    h.advance(h.alarm! - h.t);
    h.room.syncConnections([]);
    const since = h.t;
    expect(h.room.serialize().idleSince).toBe(since);
    h.advance(since + 60_000 - 1 - h.t);
    expect(h.room.closed).toBe(false);
    h.advance(1);
    expect(h.room.closed).toBe(true);
  });

  it("asks for exactly one alarm when restored", () => {
    const h = new Harness(29, { idleMs: 60_000 });
    h.connect("a");
    h.send("a", { type: "join", name: "Alice", sit: true });
    const r = new Harness(29, {}, { snapshot: h.room.serialize(), t: h.t + 1_000, calls: h.calls });
    expect(r.alarmSets).toBe(1);
    expect(r.alarm).toBe(r.t + 60_000);
  });

  it("keeps the idle clock across serialize() -> restore()", () => {
    const h = new Harness(26, { idleMs: 60_000 });
    h.connect("a");
    h.send("a", { type: "join", name: "Alice" });
    h.advance(5_000);
    h.close("a");
    const since = h.t;
    h.advance(20_000);
    const snap = h.room.serialize();
    expect(snap.idleSince).toBe(since);
    const r = new Harness(26, {}, { snapshot: snap, t: h.t, calls: h.calls });
    r.advance(since + 60_000 - 1 - r.t);
    expect(r.room.closed).toBe(false);
    r.advance(1);
    expect(r.room.closed).toBe(true);
  });

  it("accepts only 2-8 as the seats parameter", () => {
    expect(parseSeatsParam(null)).toBe(6);
    for (const s of ["2", "5", "8"]) expect(parseSeatsParam(s)).toBe(Number(s));
    for (const s of ["", "1", "9", "abc", "2.5", "-3", "1e1", "0x4", " 3", "3 ", "6.0", "06", "+6", "6e0", "\u0663"]) {
      expect(parseSeatsParam(s), JSON.stringify(s)).toBeNull();
    }
  });
});

/** A WebSocket stand-in the tests open, feed and drop by hand. */
class FakeSocket {
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }
  close(): void {
    this.end();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: object): void {
    this.onmessage?.({ data: JSON.stringify({ seq: 1, ...msg }) });
  }
  end(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("connectTable", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeSocket.all = [];
  });
  const start = () => {
    const events: TableClientEvent[] = [];
    const c = connectTable("http://t.test", "abc", { name: "Alice", WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    c.on((e) => events.push(e));
    return { c, events };
  };
  const welcome = { type: "welcome", protocol: 1, you: { playerId: "p", token: "tok", seat: null, isHost: true } };

  it("reconnects after a dropped connection but stops after a fatal join error", async () => {
    vi.useFakeTimers();
    const { c } = start();
    FakeSocket.all[0].open();
    FakeSocket.all[0].receive(welcome);
    FakeSocket.all[0].receive({ type: "error", code: "malformed", message: "Malformed message" }); // after joining: not fatal
    FakeSocket.all[0].end();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].open();
    expect(FakeSocket.all[1].sent[0]).toEqual({ type: "join", name: "Alice", token: "tok" });
    c.close();

    for (const code of ["name_taken", "bad_name", "malformed", "table_full"]) {
      FakeSocket.all = [];
      const { c: c2, events } = start();
      FakeSocket.all[0].open();
      FakeSocket.all[0].receive({ type: "error", code, message: "no" });
      FakeSocket.all[0].end(); // the server may close it as well
      await vi.advanceTimersByTimeAsync(60_000);
      expect(FakeSocket.all, code).toHaveLength(1);
      expect(events.filter((e) => e.type === "rejected"), code).toEqual([{ type: "rejected", code, message: "no" }]);
      expect(c2.status).toBe("closed");
    }
  });

  it("gives up when the server refuses the origin, but keeps retrying while offline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new TypeError("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { events } = start();
    FakeSocket.all[0].end(); // never opened: offline
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    fetchMock.mockImplementation(async () => new Response("Origin not allowed", { status: 403 }));
    FakeSocket.all[1].end();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "rejected", code: "origin_refused" });
  });
});
