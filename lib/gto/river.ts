// Heads-up river subgame solver: Discounted CFR (Brown & Sandholm 2019, "Solving Imperfect-Information
// Games via Discounted Regret Minimization"), vectorised over hands. Written from the paper and first
// principles; no code from any existing postflop solver (they are all AGPL, see RESEARCH.md §4).
//
// The game
// - A fixed 5-card board. OOP (player 0) holds one combo of its range, IP (player 1) one of its own.
//   Every card-disjoint (OOP combo, IP combo) pair is equally likely: the deal is uniform over the
//   Z compatible pairs, so card removal between the two ranges is exact. Combos that use a board card are
//   dropped from the ranges first.
// - The pot is P bb and both players have S bb behind (the effective stack). OOP acts first: check or bet.
//   Facing a bet or raise: fold, call or raise. Check-check and a call go to showdown.
// - Sizes. A bet of fraction f is f x P. A raise of fraction r is "call, then add r x (pot after the
//   call)", so r = 1 is a pot-sized raise; a raise is never smaller than the previous bet or raise
//   increment (the no-limit minimum). Any amount at or above the stack becomes all-in, the optional
//   all-in action is added to every bet and raise menu, and duplicate amounts are merged. After
//   `maxRaises` raises, or facing an all-in, the only options are fold and call.
//   This is a betting ABSTRACTION: an exact equilibrium of this tree, not of no-limit hold'em with every
//   possible size.
// - Payoffs are zero-sum relative to the pot, as in akq.ts: each player is treated as owning P/2 of it.
//   If player f folds after committing c_f this street, the other player wins P/2 + c_f. At showdown
//   with both players in for c, the winner gets P/2 + c, a tie gets 0. A player's share of the pot in the
//   usual sense ("EV in bb") is P/2 + its zero-sum value, and the two shares add up to P.
//
// Vectorised CFR
// - Each decision node keeps, for each action a and each of the acting player's combos i, a cumulative
//   regret R[a*n + i] and a strategy sum S[a*n + i]. The info set is (node, own combo): the betting history
//   is public, so the node identifies it.
// - A traversal for player p carries p's own reach per combo and the opponent's reach per combo, and
//   returns p's counterfactual value per combo: v[i] = sum over opponent combos j compatible with i of
//   oppReach[j] x payoff_p(i, j). (Values are not divided by Z; the game value is sum_i v[i] / Z.)
// - Terminals cost O(n + m) instead of O(n m). Fold: v[i] = u x (sum of oppReach over j disjoint from i)
//   = u x (total - cardSum[c1] - cardSum[c2] + oppReach[same combo]), by inclusion-exclusion over the two
//   hole cards. Showdown: sort both ranges by hand value once; one ascending sweep accumulates the
//   opponent reach strictly below each of p's combos (minus the combos sharing a card, via per-card
//   sums), one descending sweep the reach strictly above. Equal values are ties and contribute 0.
//   Each combo's 7-card value is computed once, when the game is built.
//
// DCFR (alpha = 1.5, beta = 0, gamma = 2, the paper's recommended setting)
// - Alternating updates: each iteration traverses for OOP, then for IP against OOP's updated strategy.
// - At iteration t, after adding the instantaneous regrets, positive cumulative regrets are multiplied by
//   t^a / (t^a + 1) and negative ones by t^b / (t^b + 1) (= 1/2 for beta = 0).
// - The strategy sum gets the iteration's own-reach-weighted strategy, then is multiplied by
//   (t / (t + 1))^gamma, so iteration t's weight in the final average is proportional to t^gamma.
// - The average strategy converges to a Nash equilibrium; regret matching (positive part, uniform if
//   none is positive) gives the current strategy.
//
// Exploitability is exact, with the same convention as game.ts: NashConv = BR_OOP + BR_IP (each best
// response value in its own payoff, the profile's values cancel), exploitability = NashConv / 2. The best
// responder picks an action per (node, own combo), which is exact because it sees its own cards and the
// whole public history; values come up from the leaves, so deeper choices are already best responses.

import { parseCards, formatCard, type Card } from "../poker/cards";
import { COMBO_COUNT, COMBO_HI, COMBO_LO, comboIndex } from "../poker/combinatorics";
import { evaluateWith, handState } from "../poker/evaluator";
import { parseRange, removeDeadCards } from "../poker/range";

// ---------------------------------------------------------------------------------------------------
// Limits (validated when a game is built)

/**
 * Combos per side after board removal. 1081 = C(47, 2) is every possible hand: terminals cost O(n + m)
 * (sorted sweeps, no n x m matrix), so the range size is limited only through RIVER_MAX_ENTRIES.
 */
export const RIVER_MAX_COMBOS = 1081;
/**
 * Strategy entries (sum over decision nodes of actions x the actor's combos). Regrets, strategy sums and
 * the current strategy take 24 bytes per entry, so this caps the solver at about 36 MB.
 */
export const RIVER_MAX_ENTRIES = 1_500_000;
/** Bet or raise sizes per menu. */
export const RIVER_MAX_SIZES = 4;
/** Raises after the first bet. */
export const RIVER_MAX_RAISES = 3;
/** Decision nodes in the betting tree. */
export const RIVER_MAX_DECISION_NODES = 1000;

export const DCFR_DEFAULTS = { alpha: 1.5, beta: 0, gamma: 2 } as const;

// ---------------------------------------------------------------------------------------------------
// Inputs

export interface RiverSpot {
  /** 5 cards, as text ("Ks7d2c9h4s") or card ids. */
  board: string | readonly Card[];
  /** Range text ("QQ+, AKs") or combo indices. Combos that use a board card are dropped. */
  oopRange: string | readonly number[];
  ipRange: string | readonly number[];
  /** Pot at the start of the river, bb. */
  pot: number;
  /** Effective stack behind, bb. */
  stack: number;
  /** OOP's bet sizes as fractions of the pot. Empty: OOP can only check. */
  oopBetSizes: readonly number[];
  /** IP's bet sizes after a check, as fractions of the pot. */
  ipBetSizes: readonly number[];
  /** Raise sizes as fractions of the pot after calling. */
  raiseSizes: readonly number[];
  /** Adds all-in to every bet and raise menu. */
  allIn: boolean;
  /** Raises allowed after the first bet (0 = bet, then fold or call only). */
  maxRaises: number;
}

// ---------------------------------------------------------------------------------------------------
// The built game

export type RiverActionKind = "check" | "bet" | "fold" | "call" | "raise" | "allin";

export interface RiverAction {
  kind: RiverActionKind;
  /** The actor's total commitment this street after the action (0 for check and fold). */
  amount: number;
  /** e.g. "Check", "Bet 3.3", "Raise to 12", "All-in 50", "Call 3.3", "Fold". */
  label: string;
}

export type RiverNode =
  | {
      kind: "decision";
      id: number;
      player: 0 | 1;
      /** Commitments this street before the action: [OOP, IP]. */
      committed: [number, number];
      actions: RiverAction[];
      children: number[];
      /** Action labels from the root, e.g. ["OOP Check", "IP Bet 7.5"]. */
      history: string[];
      parent: number;
    }
  | { kind: "fold"; id: number; folder: 0 | 1; committed: [number, number]; history: string[]; parent: number }
  | { kind: "showdown"; id: number; committed: [number, number]; history: string[]; parent: number };

export interface RiverTreeCounts {
  decision: number;
  oopDecision: number;
  ipDecision: number;
  fold: number;
  showdown: number;
  total: number;
  /** Sum over decision nodes of the acting player's combo count. */
  infoSets: number;
  /** Sum over decision nodes of actions x the acting player's combo count. */
  entries: number;
}

export interface RiverRangeInfo {
  /** Combo indices (lib/poker), sorted ascending. */
  combos: Int32Array;
  card1: Int32Array;
  card2: Int32Array;
  /** 7-card hand value (1..7462, higher is better). */
  value: Int32Array;
  /** Combo positions sorted by value, ascending. */
  order: Int32Array;
  /** Position of the identical combo in the other player's range, or -1. */
  same: Int32Array;
}

export interface RiverGame {
  readonly board: Card[];
  readonly pot: number;
  readonly stack: number;
  readonly spot: Readonly<RiverSpot>;
  readonly ranges: [RiverRangeInfo, RiverRangeInfo];
  /** Number of card-disjoint (OOP combo, IP combo) pairs. */
  readonly pairs: number;
  /** Node 0 is the root (OOP to act). Children always have larger ids than their parent. */
  readonly nodes: RiverNode[];
  readonly counts: RiverTreeCounts;
}

/**
 * A strategy profile: for every node, the probability of each action for each of the acting player's
 * combos, laid out [a * n + i]; terminals have an empty array.
 */
export type RiverProfile = Float64Array[];

// ---------------------------------------------------------------------------------------------------
// Building

const fmtBB = (x: number): string => {
  const s = x.toFixed(2).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};

const PLAYER_NAME = ["OOP", "IP"] as const;

function checkSizes(name: string, sizes: readonly number[]): void {
  if (!Array.isArray(sizes)) throw new Error(`${name} must be a list of pot fractions`);
  if (sizes.length > RIVER_MAX_SIZES) throw new Error(`${name}: at most ${RIVER_MAX_SIZES} sizes`);
  for (const f of sizes) {
    if (!Number.isFinite(f) || f <= 0 || f > 10) throw new Error(`${name}: each size must be a pot fraction in (0, 10], got ${f}`);
  }
}

function rangeCombos(name: string, range: string | readonly number[], board: readonly Card[]): number[] {
  let combos: number[];
  if (typeof range === "string") {
    try {
      combos = parseRange(range);
    } catch (e) {
      throw new Error(`${name} range: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    for (const c of range) {
      if (!Number.isInteger(c) || c < 0 || c >= COMBO_COUNT) throw new Error(`${name} range: invalid combo index ${c}`);
    }
    combos = Array.from(new Set(range)).sort((a, b) => a - b);
  }
  if (combos.length === 0) throw new Error(`${name} range is empty`);
  const live = removeDeadCards(combos, board);
  if (live.length === 0) throw new Error(`${name} range is empty once combos that use a board card are removed`);
  if (live.length > RIVER_MAX_COMBOS) throw new Error(`${name} range has ${live.length} combos; the limit is ${RIVER_MAX_COMBOS}`);
  return live;
}

function rangeInfo(combos: number[], board: readonly Card[]): Omit<RiverRangeInfo, "same"> {
  const n = combos.length;
  const state = handState(board);
  const card1 = new Int32Array(n), card2 = new Int32Array(n), value = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    card1[i] = COMBO_HI[combos[i]];
    card2[i] = COMBO_LO[combos[i]];
    value[i] = evaluateWith(state, card1[i], card2[i]);
  }
  const order = Int32Array.from(combos.map((_, i) => i).sort((a, b) => value[a] - value[b] || a - b));
  return { combos: Int32Array.from(combos), card1, card2, value, order };
}

/** Parses and validates a spot, removes dead combos, evaluates every combo and builds the betting tree. */
export function buildRiverGame(spot: RiverSpot): RiverGame {
  let board: Card[];
  if (typeof spot.board === "string") {
    try {
      board = parseCards(spot.board);
    } catch (e) {
      throw new Error(`Board: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    board = [...spot.board];
    const seen = new Set<number>();
    for (const c of board) {
      if (!Number.isInteger(c) || c < 0 || c > 51) throw new Error(`Board: invalid card id ${c}`);
      if (seen.has(c)) throw new Error(`Board: duplicate card ${formatCard(c)}`);
      seen.add(c);
    }
  }
  if (board.length !== 5) throw new Error(`Board needs exactly 5 cards, got ${board.length}`);
  if (!Number.isFinite(spot.pot) || spot.pot <= 0) throw new Error("Pot must be a positive number of bb");
  if (!Number.isFinite(spot.stack) || spot.stack <= 0) throw new Error("Stack must be a positive number of bb");
  checkSizes("OOP bet sizes", spot.oopBetSizes);
  checkSizes("IP bet sizes", spot.ipBetSizes);
  checkSizes("Raise sizes", spot.raiseSizes);
  if (!Number.isInteger(spot.maxRaises) || spot.maxRaises < 0 || spot.maxRaises > RIVER_MAX_RAISES) {
    throw new Error(`Max raises must be a whole number from 0 to ${RIVER_MAX_RAISES}`);
  }

  const r0 = rangeInfo(rangeCombos("OOP", spot.oopRange, board), board);
  const r1 = rangeInfo(rangeCombos("IP", spot.ipRange, board), board);
  const pos1 = new Map<number, number>();
  r1.combos.forEach((c, j) => pos1.set(c, j));
  const same0 = Int32Array.from(r0.combos, (c) => pos1.get(c) ?? -1);
  const same1 = new Int32Array(r1.combos.length).fill(-1);
  same0.forEach((j, i) => {
    if (j >= 0) same1[j] = i;
  });

  // Compatible pairs: n0 * n1 minus the pairs sharing a card (inclusion-exclusion over cards).
  const perCard = new Float64Array(52);
  for (let j = 0; j < r1.combos.length; j++) {
    perCard[r1.card1[j]]++;
    perCard[r1.card2[j]]++;
  }
  let pairs = 0;
  for (let i = 0; i < r0.combos.length; i++) pairs += r1.combos.length - perCard[r0.card1[i]] - perCard[r0.card2[i]] + (same0[i] >= 0 ? 1 : 0);
  if (pairs <= 0) throw new Error("The two ranges have no card-disjoint combo pairs");

  const nodes = buildTree(spot);
  const counts: RiverTreeCounts = { decision: 0, oopDecision: 0, ipDecision: 0, fold: 0, showdown: 0, total: nodes.length, infoSets: 0, entries: 0 };
  for (const nd of nodes) {
    if (nd.kind === "decision") {
      counts.decision++;
      if (nd.player === 0) counts.oopDecision++;
      else counts.ipDecision++;
      counts.infoSets += nd.player === 0 ? r0.combos.length : r1.combos.length;
      counts.entries += nd.actions.length * (nd.player === 0 ? r0.combos.length : r1.combos.length);
    } else if (nd.kind === "fold") counts.fold++;
    else counts.showdown++;
  }
  if (counts.entries > RIVER_MAX_ENTRIES) {
    throw new Error(
      `Spot too large: ${r0.combos.length} x ${r1.combos.length} combos over ${counts.decision} decision nodes is ${counts.entries.toLocaleString("en-US")} strategy entries (limit ${RIVER_MAX_ENTRIES.toLocaleString("en-US")}). Use narrower ranges, fewer sizes or fewer raises.`,
    );
  }

  return {
    board,
    pot: spot.pot,
    stack: spot.stack,
    spot: { ...spot },
    ranges: [
      { ...r0, same: same0 },
      { ...r1, same: same1 },
    ],
    pairs,
    nodes,
    counts,
  };
}

/** The betting tree for a spot (no cards involved). */
function buildTree(spot: RiverSpot): RiverNode[] {
  const P = spot.pot, S = spot.stack;
  const EPS = 1e-9;
  const nodes: RiverNode[] = [];

  // Bet / raise amounts (actor's total commitment), capped at the stack, deduplicated, ascending.
  const menu = (amounts: number[], floor: number): { amount: number; allIn: boolean }[] => {
    const out: { amount: number; allIn: boolean }[] = [];
    const add = (x: number) => {
      const a = x >= S - EPS ? S : x;
      if (a <= floor + EPS) return;
      if (out.some((o) => Math.abs(o.amount - a) < 1e-7)) return;
      out.push({ amount: a, allIn: a === S });
    };
    for (const x of amounts) add(x);
    if (spot.allIn) add(S);
    return out.sort((a, b) => a.amount - b.amount);
  };

  // Recursive build; returns the node id. `raises` counts raises after the first bet; `lastInc` is the
  // size of the last bet or raise increment.
  const build = (player: 0 | 1, committed: [number, number], checked: boolean, raises: number, lastInc: number, history: string[], parent: number): number => {
    const id = nodes.length;
    const me = player, opp = (1 - player) as 0 | 1;
    const facing = committed[opp] - committed[me];
    const actions: RiverAction[] = [];
    const node: RiverNode = { kind: "decision", id, player, committed, actions, children: [], history, parent };
    nodes.push(node);
    if (nodes.length > RIVER_MAX_DECISION_NODES * 3) throw new Error("Betting tree is too large; use fewer sizes or raises");
    const name = PLAYER_NAME[me];

    const child = (a: RiverAction, make: (h: string[]) => number) => {
      actions.push(a);
      node.children.push(make([...history, `${name} ${a.label}`]));
    };
    const terminal = (t: { kind: "fold"; folder: 0 | 1 } | { kind: "showdown" }, c: [number, number], h: string[]) => {
      const tid = nodes.length;
      nodes.push(t.kind === "fold" ? { kind: "fold", id: tid, folder: t.folder, committed: c, history: h, parent: id } : { kind: "showdown", id: tid, committed: c, history: h, parent: id });
      return tid;
    };

    if (facing <= EPS) {
      // No bet to face: check, or bet.
      child({ kind: "check", amount: 0, label: "Check" }, (h) => (checked ? terminal({ kind: "showdown" }, committed, h) : build(opp, committed, true, 0, 0, h, id)));
      const sizes = me === 0 ? spot.oopBetSizes : spot.ipBetSizes;
      for (const b of menu(sizes.map((f) => f * P), 0)) {
        const c: [number, number] = [...committed];
        c[me] = b.amount;
        child({ kind: b.allIn ? "allin" : "bet", amount: b.amount, label: b.allIn ? `All-in ${fmtBB(b.amount)}` : `Bet ${fmtBB(b.amount)}` }, (h) => build(opp, c, checked, 0, b.amount, h, id));
      }
    } else {
      const toAmount = committed[opp];
      child({ kind: "fold", amount: committed[me], label: "Fold" }, (h) => terminal({ kind: "fold", folder: me }, committed, h));
      const called: [number, number] = [toAmount, toAmount];
      child({ kind: "call", amount: toAmount, label: `Call ${fmtBB(facing)}` }, (h) => terminal({ kind: "showdown" }, called, h));
      const oppAllIn = toAmount >= S - EPS;
      if (!oppAllIn && raises < spot.maxRaises) {
        const potAfterCall = P + 2 * toAmount;
        const minTo = toAmount + lastInc;
        for (const r of menu(spot.raiseSizes.map((f) => Math.max(toAmount + f * potAfterCall, minTo)), toAmount)) {
          const c: [number, number] = [...committed];
          c[me] = r.amount;
          child(
            { kind: r.allIn ? "allin" : "raise", amount: r.amount, label: r.allIn ? `All-in ${fmtBB(r.amount)}` : `Raise to ${fmtBB(r.amount)}` },
            (h) => build(opp, c, checked, raises + 1, r.amount - toAmount, h, id),
          );
        }
      }
    }
    return id;
  };

  build(0, [0, 0], false, 0, 0, [], -1);
  const decisions = nodes.filter((n) => n.kind === "decision").length;
  if (decisions > RIVER_MAX_DECISION_NODES) throw new Error(`Betting tree has ${decisions} decision nodes; the limit is ${RIVER_MAX_DECISION_NODES}`);
  return nodes;
}

// ---------------------------------------------------------------------------------------------------
// Compiled evaluation kernel shared by the solver, best response and EV

const FOLD = 0, SHOWDOWN = 1, DECISION = 2;

interface Kernel {
  game: RiverGame;
  kind: Uint8Array;
  player: Int8Array;
  /** Fold: payoff to OOP. Showdown: P/2 + c (the winner's gain). */
  stake: Float64Array;
  childStart: Int32Array;
  childCount: Int32Array;
  child: Int32Array;
  n: [number, number];
  /** Per player p, per node: value buffer (n_p), own-reach buffer (n_p), opponent-reach buffer (n_q). */
  val: [Float64Array[], Float64Array[]];
  own: [Float64Array[], Float64Array[]];
  opp: [Float64Array[], Float64Array[]];
  cardSum: Float64Array;
}

function compile(game: RiverGame): Kernel {
  const N = game.nodes.length, half = game.pot / 2;
  const kind = new Uint8Array(N), player = new Int8Array(N), stake = new Float64Array(N);
  const childStart = new Int32Array(N), childCount = new Int32Array(N);
  const childList: number[] = [];
  for (const nd of game.nodes) {
    childStart[nd.id] = childList.length;
    if (nd.kind === "decision") {
      kind[nd.id] = DECISION;
      player[nd.id] = nd.player;
      childCount[nd.id] = nd.children.length;
      childList.push(...nd.children);
    } else if (nd.kind === "fold") {
      kind[nd.id] = FOLD;
      // The folder loses P/2 plus what it put in this street.
      stake[nd.id] = nd.folder === 0 ? -(half + nd.committed[0]) : half + nd.committed[1];
    } else {
      kind[nd.id] = SHOWDOWN;
      stake[nd.id] = half + nd.committed[0];
    }
  }
  const n: [number, number] = [game.ranges[0].combos.length, game.ranges[1].combos.length];
  const bufs = (size: number) => Array.from({ length: N }, () => new Float64Array(size));
  return {
    game,
    kind,
    player,
    stake,
    childStart,
    childCount,
    child: Int32Array.from(childList),
    n,
    val: [bufs(n[0]), bufs(n[1])],
    own: [bufs(n[0]), bufs(n[1])],
    opp: [bufs(n[1]), bufs(n[0])],
    cardSum: new Float64Array(52),
  };
}

/** Player p's counterfactual values at a terminal node, written into out. */
function terminalValues(K: Kernel, v: number, p: number, oppReach: Float64Array, out: Float64Array): void {
  const me = K.game.ranges[p], them = K.game.ranges[1 - p];
  const n = K.n[p], m = K.n[1 - p];
  const cs = K.cardSum;
  const c1 = me.card1, c2 = me.card2, o1 = them.card1, o2 = them.card2;
  if (K.kind[v] === FOLD) {
    const u = p === 0 ? K.stake[v] : -K.stake[v];
    cs.fill(0);
    let total = 0;
    for (let j = 0; j < m; j++) {
      const r = oppReach[j];
      total += r;
      cs[o1[j]] += r;
      cs[o2[j]] += r;
    }
    const same = me.same;
    for (let i = 0; i < n; i++) {
      const s = same[i];
      out[i] = u * (total - cs[c1[i]] - cs[c2[i]] + (s >= 0 ? oppReach[s] : 0));
    }
    return;
  }
  // Showdown: +stake against weaker compatible hands, -stake against stronger ones.
  const stake = K.stake[v];
  const val = me.value, oval = them.value, ord = me.order, oord = them.order;
  cs.fill(0);
  let total = 0, k = 0;
  for (let x = 0; x < n; x++) {
    const i = ord[x], vi = val[i];
    while (k < m && oval[oord[k]] < vi) {
      const j = oord[k++], r = oppReach[j];
      total += r;
      cs[o1[j]] += r;
      cs[o2[j]] += r;
    }
    out[i] = stake * (total - cs[c1[i]] - cs[c2[i]]);
  }
  cs.fill(0);
  total = 0;
  k = m - 1;
  for (let x = n - 1; x >= 0; x--) {
    const i = ord[x], vi = val[i];
    while (k >= 0 && oval[oord[k]] > vi) {
      const j = oord[k--], r = oppReach[j];
      total += r;
      cs[o1[j]] += r;
      cs[o2[j]] += r;
    }
    out[i] -= stake * (total - cs[c1[i]] - cs[c2[i]]);
  }
}

/** Regret matching into out[a*n + i]: positive part of the regrets, uniform where none is positive. */
function regretMatch(regret: Float64Array, A: number, n: number, out: Float64Array): void {
  for (let i = 0; i < n; i++) {
    let pos = 0;
    for (let a = 0; a < A; a++) {
      const r = regret[a * n + i];
      if (r > 0) pos += r;
    }
    if (pos > 0) for (let a = 0; a < A; a++) out[a * n + i] = Math.max(regret[a * n + i], 0) / pos;
    else for (let a = 0; a < A; a++) out[a * n + i] = 1 / A;
  }
}

/** Normalises strategy sums per combo (uniform where a combo's sum is 0). */
function normalise(sum: Float64Array, A: number, n: number): Float64Array {
  const out = new Float64Array(A * n);
  for (let i = 0; i < n; i++) {
    let total = 0;
    for (let a = 0; a < A; a++) total += sum[a * n + i];
    for (let a = 0; a < A; a++) out[a * n + i] = total > 0 ? sum[a * n + i] / total : 1 / A;
  }
  return out;
}

/**
 * Value per combo for player p at node v against `oppReach`, under `profile` for both players, or with
 * p best-responding (mode "br").
 */
function evaluate(K: Kernel, v: number, p: number, oppReach: Float64Array, profile: RiverProfile, br: boolean): Float64Array {
  const out = K.val[p][v];
  const kind = K.kind[v];
  if (kind !== DECISION) {
    terminalValues(K, v, p, oppReach, out);
    return out;
  }
  const A = K.childCount[v], f = K.childStart[v], who = K.player[v];
  const sigma = profile[v];
  if (who === p) {
    const n = K.n[p];
    if (br) out.fill(-Infinity);
    else out.fill(0);
    for (let a = 0; a < A; a++) {
      const cv = evaluate(K, K.child[f + a], p, oppReach, profile, br);
      if (br) for (let i = 0; i < n; i++) out[i] = Math.max(out[i], cv[i]);
      else for (let i = 0; i < n; i++) out[i] += sigma[a * n + i] * cv[i];
    }
    return out;
  }
  const m = K.n[1 - p];
  const acc = new Float64Array(K.n[p]);
  for (let a = 0; a < A; a++) {
    const c = K.child[f + a];
    const r = K.opp[p][c];
    for (let j = 0; j < m; j++) r[j] = oppReach[j] * sigma[a * m + j];
    const cv = evaluate(K, c, p, r, profile, br);
    for (let i = 0; i < acc.length; i++) acc[i] += cv[i];
  }
  out.set(acc);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Reports

export interface RiverReport {
  /** OOP's zero-sum value (bb per deal); IP's is the negative. */
  value: number;
  /** Each player's share of the pot in bb: P/2 + its zero-sum value. They add up to the pot. */
  potShare: [number, number];
  /** Best-response values [OOP vs IP's strategy, IP vs OOP's strategy], each in its own payoff. */
  bestResponseValues: [number, number];
  nashConv: number;
  /** NashConv / 2, bb per deal. */
  exploitability: number;
  /** Exploitability as a percentage of the starting pot. */
  exploitabilityPct: number;
}

const kernels = new WeakMap<RiverGame, Kernel>();
const kernelOf = (game: RiverGame): Kernel => {
  let K = kernels.get(game);
  if (!K) kernels.set(game, (K = compile(game)));
  return K;
};

const ones = (n: number) => new Float64Array(n).fill(1);
const sum = (x: Float64Array) => x.reduce((s, y) => s + y, 0);

/** Exact value, best responses, NashConv and exploitability of a profile. */
export function riverExploitability(game: RiverGame, profile: RiverProfile): RiverReport {
  checkProfile(game, profile);
  const K = kernelOf(game);
  const Z = game.pairs;
  const value = sum(evaluate(K, 0, 0, ones(K.n[1]), profile, false)) / Z;
  const b0 = sum(evaluate(K, 0, 0, ones(K.n[1]), profile, true)) / Z;
  const b1 = sum(evaluate(K, 0, 1, ones(K.n[0]), profile, true)) / Z;
  const nashConv = b0 + b1;
  const half = game.pot / 2;
  return {
    value,
    potShare: [half + value, half - value],
    bestResponseValues: [b0, b1],
    nashConv,
    exploitability: nashConv / 2,
    exploitabilityPct: (100 * nashConv) / 2 / game.pot,
  };
}

/** Player p's zero-sum value under a profile, computed from p's side (a check that the payoffs are zero-sum). */
export function riverValue(game: RiverGame, profile: RiverProfile, p: 0 | 1): number {
  checkProfile(game, profile);
  const K = kernelOf(game);
  return sum(evaluate(K, 0, p, ones(K.n[1 - p]), profile, false)) / game.pairs;
}

function checkProfile(game: RiverGame, profile: RiverProfile): void {
  if (profile.length !== game.nodes.length) throw new Error("Profile does not match the game's tree");
  for (const nd of game.nodes) {
    const want = nd.kind === "decision" ? nd.actions.length * game.ranges[nd.player].combos.length : 0;
    if (profile[nd.id].length !== want) throw new Error(`Profile entry for node ${nd.id} has the wrong length`);
  }
}

/** The uniform profile (every action equally likely for every combo). */
export function uniformRiverProfile(game: RiverGame): RiverProfile {
  return game.nodes.map((nd) => (nd.kind === "decision" ? new Float64Array(nd.actions.length * game.ranges[nd.player].combos.length).fill(1 / nd.actions.length) : new Float64Array(0)));
}

/**
 * Each player's own reach per combo at every node under a profile: the probability that the player's
 * own actions lead there with that combo. Indexed [player][node][combo].
 */
export function riverReach(game: RiverGame, profile: RiverProfile): [Float64Array[], Float64Array[]] {
  checkProfile(game, profile);
  const n = [game.ranges[0].combos.length, game.ranges[1].combos.length];
  const reach: [Float64Array[], Float64Array[]] = [game.nodes.map(() => new Float64Array(n[0])), game.nodes.map(() => new Float64Array(n[1]))];
  reach[0][0].fill(1);
  reach[1][0].fill(1);
  for (const nd of game.nodes) {
    // Parents come before children, so a single pass in id order works.
    if (nd.kind !== "decision") continue;
    const p = nd.player, np = n[p], sigma = profile[nd.id];
    nd.children.forEach((c, a) => {
      for (let i = 0; i < np; i++) reach[p][c][i] = reach[p][nd.id][i] * sigma[a * np + i];
      reach[1 - p][c].set(reach[1 - p][nd.id]);
    });
  }
  return reach;
}

// ---------------------------------------------------------------------------------------------------
// The solver

export interface RiverSolver {
  readonly game: RiverGame;
  readonly iterations: number;
  /** Runs `iterations` more DCFR iterations (default 1). */
  step(iterations?: number): void;
  /** Regret matching's current strategy. */
  currentStrategy(): RiverProfile;
  /** The discounted average strategy (the one that converges to equilibrium). */
  averageStrategy(): RiverProfile;
  /** Exact value, NashConv and exploitability of the average strategy, plus the iteration count. */
  report(): RiverReport & { iterations: number };
}

export function createRiverSolver(game: RiverGame, options: { alpha?: number; beta?: number; gamma?: number } = {}): RiverSolver {
  const alpha = options.alpha ?? DCFR_DEFAULTS.alpha;
  const beta = options.beta ?? DCFR_DEFAULTS.beta;
  const gamma = options.gamma ?? DCFR_DEFAULTS.gamma;
  const K = kernelOf(game);
  const N = game.nodes.length;
  const width = (v: number) => (K.kind[v] === DECISION ? K.childCount[v] * K.n[K.player[v]] : 0);
  const regret: Float64Array[] = Array.from({ length: N }, (_, v) => new Float64Array(width(v)));
  const strategySum: Float64Array[] = Array.from({ length: N }, (_, v) => new Float64Array(width(v)));
  const sigma: Float64Array[] = Array.from({ length: N }, (_, v) => new Float64Array(width(v)));
  let t = 0;
  let posDiscount = 1, negDiscount = 1, sumDiscount = 1;

  // Returns p's counterfactual values at v; ownReach is p's reach, oppReach the opponent's.
  const walk = (v: number, p: number, ownReach: Float64Array, oppReach: Float64Array): Float64Array => {
    const out = K.val[p][v];
    if (K.kind[v] !== DECISION) {
      terminalValues(K, v, p, oppReach, out);
      return out;
    }
    const A = K.childCount[v], f = K.childStart[v], who = K.player[v];
    const s = sigma[v];
    if (who === p) {
      const n = K.n[p];
      regretMatch(regret[v], A, n, s);
      out.fill(0);
      for (let a = 0; a < A; a++) {
        const c = K.child[f + a];
        const r = K.own[p][c];
        for (let i = 0; i < n; i++) r[i] = ownReach[i] * s[a * n + i];
        const cv = walk(c, p, r, oppReach);
        for (let i = 0; i < n; i++) out[i] += s[a * n + i] * cv[i];
      }
      const R = regret[v], S = strategySum[v];
      for (let a = 0; a < A; a++) {
        const cv = K.val[p][K.child[f + a]];
        for (let i = 0; i < n; i++) {
          const k = a * n + i;
          const r = R[k] + cv[i] - out[i];
          R[k] = r * (r > 0 ? posDiscount : negDiscount);
          S[k] = (S[k] + ownReach[i] * s[k]) * sumDiscount;
        }
      }
      return out;
    }
    const m = K.n[1 - p], n = K.n[p];
    regretMatch(regret[v], A, m, s);
    // Children's value buffers are distinct from out, so accumulate after each child returns.
    let first = true;
    for (let a = 0; a < A; a++) {
      const c = K.child[f + a];
      const r = K.opp[p][c];
      for (let j = 0; j < m; j++) r[j] = oppReach[j] * s[a * m + j];
      const cv = walk(c, p, ownReach, r);
      if (first) out.set(cv);
      else for (let i = 0; i < n; i++) out[i] += cv[i];
      first = false;
    }
    return out;
  };

  const iterate = () => {
    t++;
    const ta = Math.pow(t, alpha), tb = Math.pow(t, beta);
    posDiscount = ta / (ta + 1);
    negDiscount = tb / (tb + 1);
    sumDiscount = Math.pow(t / (t + 1), gamma);
    for (let p = 0; p < 2; p++) walk(0, p, ones(K.n[p]), ones(K.n[1 - p]));
  };

  const current = (): RiverProfile =>
    game.nodes.map((nd, v) => {
      if (nd.kind !== "decision") return new Float64Array(0);
      const out = new Float64Array(width(v));
      regretMatch(regret[v], nd.actions.length, K.n[nd.player], out);
      return out;
    });
  const average = (): RiverProfile =>
    game.nodes.map((nd, v) => (nd.kind === "decision" ? normalise(strategySum[v], nd.actions.length, K.n[nd.player]) : new Float64Array(0)));

  return {
    game,
    get iterations() {
      return t;
    },
    step(iterations = 1) {
      for (let i = 0; i < iterations; i++) iterate();
    },
    currentStrategy: current,
    averageStrategy: average,
    report: () => ({ ...riverExploitability(game, average()), iterations: t }),
  };
}

/** Solves until exploitability falls below `targetPct` % of the pot (checked every `checkEvery` iterations) or `maxIterations`. */
export function solveRiver(
  game: RiverGame,
  { targetPct = 0.3, maxIterations = 10_000, checkEvery = 25 }: { targetPct?: number; maxIterations?: number; checkEvery?: number } = {},
): { solver: RiverSolver; report: RiverReport & { iterations: number } } {
  const solver = createRiverSolver(game);
  let report = solver.report();
  while (solver.iterations < maxIterations) {
    solver.step(Math.min(checkEvery, maxIterations - solver.iterations));
    report = solver.report();
    if (report.exploitabilityPct < targetPct) break;
  }
  return { solver, report };
}

// ---------------------------------------------------------------------------------------------------
// Helpers for display

/** Position in HAND_CLASSES (row-major 13x13, A..2 from the top-left) of a combo's class. */
export function comboClassIndex(combo: number): number {
  const a = COMBO_HI[combo], b = COMBO_LO[combo];
  const hi = a >> 2, lo = b >> 2;
  if (hi === lo) return (12 - hi) * 13 + (12 - hi);
  if ((a & 3) === (b & 3)) return (12 - hi) * 13 + (12 - lo); // suited: above the diagonal
  return (12 - lo) * 13 + (12 - hi); // offsuit: below it
}

export const comboLabel = (combo: number): string => formatCard(COMBO_HI[combo]) + formatCard(COMBO_LO[combo]);

/** Index of a two-card combo in a player's range, or -1. */
export function rangePosition(game: RiverGame, player: 0 | 1, a: Card, b: Card): number {
  const c = comboIndex(a, b);
  const combos = game.ranges[player].combos;
  let lo = 0, hi = combos.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (combos[mid] === c) return mid;
    if (combos[mid] < c) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
