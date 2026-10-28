// Smoke test against a running table server (default http://localhost:8787):
//   cd table-server && npm run dev        # in another terminal
//   node scripts/smoke.mjs [baseUrl] [hands]
//
// Creates a table, connects two players (plus one bot), sits them, starts, plays a few hands with
// check/call, and prints round-trip latency for pings and for actions (act sent -> state received).
// Uses Node 22's global WebSocket.

const BASE = process.argv[2] ?? "http://localhost:8787";
const HANDS = Number(process.argv[3] ?? 5);
// An allowed origin: `npm run dev` allows http://localhost:3000; against a deploy, set SMOKE_ORIGIN.
const ORIGIN = process.env.SMOKE_ORIGIN ?? "http://localhost:3000";

const fail = (msg) => {
  console.error("SMOKE FAIL:", msg);
  process.exit(1);
};
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const f = (x) => x.toFixed(2);
  return `n=${s.length} min=${f(s[0])} median=${f(q(0.5))} p95=${f(q(0.95))} max=${f(s[s.length - 1])} ms`;
};


// Tables are created from an allowed browser origin only.
const noOrigin = await fetch(`${BASE}/tables/new?seats=6`);
if (noOrigin.status !== 403) fail(`/tables/new without Origin -> ${noOrigin.status}, expected 403`);
const res = await fetch(`${BASE}/tables/new?seats=6`, { headers: { Origin: ORIGIN } });
if (!res.ok) fail(`/tables/new -> ${res.status}`);
if (res.headers.get("access-control-allow-origin") !== ORIGIN) fail("missing CORS header");
const { tableId } = await res.json();
console.log("table", tableId);
if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(tableId)) fail(`table code ${tableId} is not 6 letters from the code alphabet`);
// A well-formed code nobody holds, and a malformed one, are both "no such table".
for (const code of ["ZZZZZZ", tableId.toLowerCase()]) {
  const r = await fetch(`${BASE}/tables/${code}/ws`, { headers: { Origin: ORIGIN } });
  if (code !== tableId && r.status !== 404) fail(`/tables/${code}/ws -> ${r.status}, expected 404`);
}
const wsUrl = `${BASE.replace(/^http/, "ws")}/tables/${tableId}/ws`;

// Origin is enforced on the upgrade: a foreign site's socket never opens.
await new Promise((resolve) => {
  const evil = new WebSocket(wsUrl, { headers: { Origin: "https://evil.example" } });
  evil.onopen = () => fail("a socket from a foreign origin was accepted");
  evil.onerror = () => resolve();
  evil.onclose = () => resolve();
});

function player(name) {
  const p = { name, ws: null, state: null, welcome: null, hole: new Map(), seq: 0, waiters: [], received: [] };
  p.ws = new WebSocket(wsUrl, { headers: { Origin: ORIGIN } });
  p.ws.onmessage = (ev) => {
    const at = performance.now();
    const msg = JSON.parse(ev.data);
    if (msg.seq <= p.seq) fail(`${name}: seq went from ${p.seq} to ${msg.seq}`);
    p.seq = msg.seq;
    p.received.push(ev.data);
    if (msg.type === "welcome") p.welcome = msg.you;
    if (msg.type === "state") p.state = msg.state;
    if (msg.type === "hole") p.hole.set(msg.handNo, msg.cards);
    if (msg.type === "error") console.log(`  ${name} error:`, msg.code, msg.message);
    for (const w of [...p.waiters]) {
      if (w.pred(msg)) {
        p.waiters.splice(p.waiters.indexOf(w), 1);
        w.resolve({ msg, at });
      }
    }
  };
  p.opened = new Promise((resolve, reject) => {
    p.ws.onopen = resolve;
    p.ws.onerror = (e) => reject(new Error(`${name}: socket error ${e.message ?? ""}`));
  });
  p.send = (msg) => p.ws.send(JSON.stringify(msg));
  p.wait = (pred, ms = 30_000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${name}: timed out waiting`)), ms);
      p.waiters.push({ pred, resolve: (v) => (clearTimeout(t), resolve(v)) });
    });
  return p;
}

const alice = player("alice");
const bob = player("bob");
await Promise.all([alice.opened, bob.opened]);

const join = async (p, seat) => {
  const w = p.wait((m) => m.type === "welcome");
  p.send({ type: "join", name: p.name });
  await w;
  const s = p.wait((m) => m.type === "state" && m.state.seats[seat]?.playerId === p.welcome.playerId);
  p.send({ type: "sit", seat });
  await s;
};
await join(alice, 0);
await join(bob, 1);
if (!alice.welcome.isHost || bob.welcome.isHost) fail("host should be the first joiner");
alice.send({ type: "addBot", seat: 2, persona: "station" });
await alice.wait((m) => m.type === "state" && m.state.seats[2]?.kind === "bot");

// Ping round trips.
const pingRtts = [];
for (const p of [alice, bob]) {
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    const w = p.wait((m) => m.type === "pong" && m.id === i);
    p.send({ type: "ping", id: i });
    const { at } = await w;
    pingRtts.push(at - t0);
  }
}

// Play.
const actRtts = [];
const t0 = performance.now();
alice.send({ type: "start" });
const players = [alice, bob];
const seatOf = (p) => (p === alice ? 0 : 1);
let finished = 0;
let lastHand = 0;
await new Promise((resolve, reject) => {
  const onState = async () => {
    try {
      const st = alice.state;
      if (st.lastResult && st.lastResult.handNo > lastHand && st.hand?.complete) {
        lastHand = st.lastResult.handNo;
        finished++;
        const net = st.lastResult.net.map((x) => `seat${x.seat}:${x.amount > 0 ? "+" : ""}${x.amount}`).join(" ");
        const total = st.seats.filter(Boolean).reduce((a, s) => a + s.stack, 0);
        console.log(`hand ${lastHand} done: board ${st.lastResult.board.join(" ")} ${net} (table chips ${total})`);
        if (st.lastResult.net.reduce((a, x) => a + x.amount, 0) !== 0) fail("chips not conserved");
        if (finished >= HANDS) return resolve();
      }
      if (!st.hand || st.hand.complete || st.toAct === null) return;
      const p = players.find((x) => seatOf(x) === st.toAct);
      const key = `${st.handNo}:${st.hand.actions.length}`;
      if (!p || p.busy === key) return;
      p.busy = key;
      const la = st.hand.legal;
      const action = la.canCheck ? { type: "check" } : { type: "call" };
      const before = st.hand.actions.length;
      const handNo = st.handNo;
      const w = p.wait((m) => m.type === "state" && (m.state.handNo !== handNo || m.state.hand.actions.length > before));
      const start = performance.now();
      p.send({ type: "act", handNo, action });
      const { at } = await w;
      actRtts.push(at - start);
    } catch (e) {
      reject(e);
    }
  };
  for (const p of players) {
    const orig = p.ws.onmessage;
    p.ws.onmessage = (ev) => {
      orig(ev);
      if (p === alice && JSON.parse(ev.data).type === "state") onState();
    };
  }
  setTimeout(() => reject(new Error("game timed out")), 120_000);
});
const elapsed = (performance.now() - t0) / 1000;

// Privacy: alice never saw bob's hole cards for a hand that did not reach showdown with bob.
for (const [handNo, cards] of bob.hole) {
  const leaked = alice.received.filter((raw) => {
    const m = JSON.parse(raw);
    if (m.type === "state") {
      const r = m.state.lastResult;
      if (r && r.handNo === handNo && r.revealed.some((x) => x.seat === 1)) return false;
      m.state.lastResult = null;
    }
    return cards.some((c) => JSON.stringify(m).includes(`"${c}"`) && !(alice.hole.get(handNo) ?? []).includes(c));
  });
  // Card strings recur across hands, so only flag messages about this hand.
  const sameHand = leaked.filter((raw) => {
    const m = JSON.parse(raw);
    return (m.type === "state" && m.state.handNo === handNo) || (m.type === "hole" && m.handNo === handNo);
  });
  if (sameHand.length) fail(`bob's hand ${handNo} cards leaked to alice`);
}

// Reconnect with the token restores the seat and re-sends hole cards if in a hand.
const token = alice.welcome.token;
alice.ws.close();
const alice2 = player("alice2");
await alice2.opened;
const w = alice2.wait((m) => m.type === "welcome");
alice2.send({ type: "join", name: "", token });
const { msg: welcome } = await w;
if (welcome.you.playerId !== alice.welcome.playerId || welcome.you.seat !== 0) fail("reconnect did not restore the seat");

console.log(`\n${finished} hands in ${elapsed.toFixed(1)}s (includes 3s pauses between hands and bot think time)`);
console.log("ping RTT          ", stats(pingRtts));
console.log("act -> state RTT  ", stats(actRtts));
console.log("SMOKE OK");
alice2.ws.close();
bob.ws.close();
process.exit(0);
