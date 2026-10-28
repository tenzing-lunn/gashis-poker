// Math judge's TS bridge for lib/grading/oracle/judge.py. JSON lines on stdin -> JSON lines on stdout.
// It exposes only (a) the engine (public state after a public action list, built from this file's OWN
// placeholder deal), (b) the bots' policy tables (strategyAt) and (c) gradeDecision itself (the code under
// test). All math (posteriors, equities, the tree recursion, pots, candidates, tiers) is redone in Python.
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs \
//          lib/grading/oracle/ts_rpc.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON plumbing for the Python judge */
import { createInterface } from "node:readline";
import { applyAction, createHand, legalActions, potTotal, type Action, type HandState } from "../../engine/engine";
import { createRng, shuffle, FULL_DECK } from "../../poker/cards";
import { PERSONAS, type Persona, type PersonaId } from "../../bots/personas";
import { chooseAction, strategyAt } from "../../bots/policy";
import { botView, publicHistory, publicView, type PublicHistory } from "../../bots/view";
import { gradeDecision } from "../grade";
import { gradeOptions } from "../tiers";

const P = (id: PersonaId | null): Persona | null => (id ? PERSONAS[id] : null);

/** Own placeholder state: hole cards are drawn (seeded) from cards not on the board and not `avoid`. */
function buildState(h: PublicHistory, extra: Action[], avoid: number[], seed: number): HandState {
  const n = h.stacks.length;
  const used = new Set<number>([...h.board, ...avoid]);
  const rng = createRng(seed);
  const filler = shuffle(FULL_DECK.filter((c) => !used.has(c)), rng);
  const deck = filler.slice(0, 2 * n);
  const rest = filler.slice(2 * n);
  for (let k = 0; k < 5; k++) deck.push(k < h.board.length ? h.board[k] : rest[k]);
  let s = createHand({ stacks: h.stacks, button: h.button, smallBlind: h.smallBlind, bigBlind: h.bigBlind }, { deck });
  for (const a of [...h.actions, ...extra]) s = applyAction(s, a);
  return s;
}

function nodeInfo(s: HandState, heroCards: number[], personas: (PersonaId | null)[], wantStrategy: boolean) {
  const la = legalActions(s);
  const out: any = {
    street: s.street,
    complete: s.complete,
    boardLen: s.board.length,
    stacks: s.stacks,
    bets: s.bets,
    committed: s.committed,
    folded: s.folded,
    startingStacks: s.startingStacks,
    bigBlind: s.bigBlind,
    pot: potTotal(s),
    la,
    streetActions: s.events
      .filter((e) => e.type === "action" && e.street === s.street)
      .map((e: any) => ({ seat: e.seat, action: e.action })),
  };
  if (wantStrategy && la && personas[la.seat]) {
    const st = strategyAt(P(personas[la.seat])!, publicView(s, la.seat), heroCards);
    out.concrete = st.concrete;
    out.probs = Array.from(st.probs);
  }
  return out;
}

/** Plays hands with bots in every seat and records each decision of `heroSeat` (public history only). */
function gen(t: any) {
  const spots: any[] = [];
  for (const cfg of t.configs) {
    const personas: Persona[] = cfg.personas.map((id: PersonaId) => PERSONAS[id]);
    for (let k = 0; k < cfg.hands; k++) {
      const seed = cfg.seed + k;
      let s = createHand({ stacks: cfg.stacks, button: cfg.button }, { seed });
      const rng = createRng((seed ^ 0x2545f491) >>> 0);
      while (!s.complete) {
        const la = legalActions(s)!;
        if (la.seat === cfg.hero) {
          spots.push({
            cfg: cfg.name,
            seed,
            history: publicHistory(s),
            heroSeat: cfg.hero,
            heroCards: s.holeCards[cfg.hero],
            personas: cfg.personas.map((id: PersonaId, i: number) => (i === cfg.hero ? null : id)),
            street: s.street,
            live: s.folded.filter((f) => !f).length,
            toCall: la.toCall,
            realHole: s.holeCards,
            realDeck: s.deck,
          });
        }
        s = applyAction(s, chooseAction(personas[la.seat], botView(s, la.seat), rng).action);
      }
    }
  }
  return spots;
}

function grade(t: any) {
  const r = gradeDecision({
    history: t.history,
    heroSeat: t.heroSeat,
    heroCards: t.heroCards,
    personas: t.personas.map(P),
    chosen: t.chosen,
    options: t.options,
  });
  const nan = (x: number) => (Number.isNaN(x) ? null : x);
  return {
    ...r,
    heroEquity: r.heroEquity,
    ranges: r.ranges.map((x) => ({ seat: x.seat, persona: x.persona, weights: Array.from(x.weights) })),
    options: r.options.map((o) => ({ ...o, showdownEquity: nan(o.showdownEquity) })),
  };
}

function run(t: any): unknown {
  switch (t.op) {
    case "gen":
      return gen(t);
    case "grade":
      return grade(t);
    case "node": {
      const s = buildState(t.history, t.path ?? [], t.heroCards, t.seed ?? 12345);
      return nodeInfo(s, t.heroCards, t.personas, t.strategy !== false);
    }
    case "lik": {
      // Every past decision of `seat`: the strategy table (no dead cards) and the observed action.
      const h: PublicHistory = t.history;
      let s = buildState({ ...h, actions: [] }, [], [], 777);
      const out: any[] = [];
      for (const a of h.actions) {
        const la = legalActions(s)!;
        if (la.seat === t.seat) {
          const st = strategyAt(PERSONAS[t.persona as PersonaId], publicView(s, t.seat), []);
          out.push({ concrete: st.concrete, probs: Array.from(st.probs), action: a });
        }
        s = applyAction(s, a);
      }
      return out;
    }
    case "redeal": {
      // The spot's public history replayed on a different real deal: hero keeps its cards, the board dealt
      // so far is kept, the bots' hole cards and the undealt deck are reshuffled.
      const sp = t.spot;
      const h: PublicHistory = sp.history;
      const n = h.stacks.length;
      const used = new Set<number>([...h.board, ...sp.heroCards, ...sp.realHole.flat()]);
      const rest = shuffle(FULL_DECK.filter((c) => !used.has(c)), createRng(t.seed));
      const hole: number[][] = Array.from({ length: n }, (_, i) => (i === sp.heroSeat ? sp.heroCards.slice() : [rest.pop()!, rest.pop()!]));
      const deck: number[] = new Array(2 * n);
      for (let j = 0; j < 2 * n; j++) deck[j] = hole[(h.button + 1 + (j % n)) % n][Math.floor(j / n)];
      for (let k = 0; k < 5; k++) deck.push(k < h.board.length ? h.board[k] : rest.pop()!);
      let s = createHand({ stacks: h.stacks, button: h.button, smallBlind: h.smallBlind, bigBlind: h.bigBlind }, { deck });
      for (const a of h.actions) s = applyAction(s, a);
      return { history: publicHistory(s), heroCards: s.holeCards[sp.heroSeat], realHole: s.holeCards, realDeck: s.deck };
    }
    case "tiers":
      return gradeOptions(t.options, t.pot);
    default:
      throw new Error(`unknown op ${t.op}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let res: unknown;
  try {
    res = { ok: true, value: run(JSON.parse(line)) };
  } catch (e) {
    res = { ok: false, error: String((e as Error).stack ?? e) };
  }
  process.stdout.write(JSON.stringify(res) + "\n");
});
