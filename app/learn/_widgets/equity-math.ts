// Equity calculator math for module 4: a hand or range against a hand or range, broken down by hand class.
// Runs in the widget's worker (equity.worker.ts); `runEquityJob` takes its `post` / `sleep` as arguments,
// so the same code also runs in Node for checks.
//
// Every compatible pair of hands (one per side, no shared card) is equally likely. A class's weight is its
// share of those pairs, so the overall equity is the weighted average of the per-class equities.

import { parseCards, type Card } from "../../../lib/poker/cards";
import { classOfCombo, COMBO_COUNT, COMBO_HI, COMBO_LO } from "../../../lib/poker/combinatorics";
import { exactEquity, monteCarloEquity } from "../../../lib/poker/equity";
import { comboClassName, parseRange, removeDeadCards } from "../../../lib/poker/range";

export interface EquityQuery {
  hero: string;
  villain: string;
  board: string;
}

export interface ClassRow {
  name: string;
  /** Combos of this class left on the broken-down side. */
  combos: number;
  /** Share of all matchups that involve this class. */
  weight: number;
  /** Hero's equity in those matchups. */
  equity: number;
  /** 95% margin for Monte Carlo, 0 when exact. */
  margin: number;
}

export interface EquityOutcome {
  equity: number;
  win: number;
  tie: number;
  /** 95% margin (1.96 standard errors) for Monte Carlo, 0 when exact. */
  margin: number;
  method: string;
  heroCombos: number;
  villainCombos: number;
  /** Which side the class rows break down: the opponent's when it is a range, else yours; null for hand vs hand. */
  bySide: "villain" | "hero" | null;
  classes: ClassRow[];
}

export type EquityRequest = EquityQuery & { id: number };

export type EquityResponse =
  | { id: number; type: "result"; outcome: EquityOutcome; final: boolean }
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "error"; message: string };

/**
 * Exact enumeration while the work stays under this many board evaluations: a few seconds in a worker at most. The
 * work is (matchups evaluated) × (runouts per matchup + MATCHUP_COST), where before the flop matchups that are the
 * same up to suits are evaluated once. AhQd vs TT+, AQ+ (28 distinct of 45, 48M) is about the largest that fits.
 */
export const EXACT_BUDGET = 50_000_000;
/** Setting up one matchup costs about as much as evaluating this many boards (a river matchup is one board). */
const MATCHUP_COST = 60;
/** Under this the exact count is quick enough (≈ 0.1 s) to skip the Monte Carlo preview. */
const QUICK_BUDGET = 5_000_000;
const MC_TRIALS_PREFLOP = 300_000;
const MC_TRIALS_POSTFLOP = 100_000;
const MIN_CLASS_TRIALS = 2_000;

const cardsOf = (combo: number): Card[] => [COMBO_HI[combo], COMBO_LO[combo]];
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

interface Group {
  name: string;
  order: number;
  /** Distinct combos of the broken-down side in this class. */
  combos: number[];
  pairs: number;
}

interface Prepared {
  board: Card[];
  hero: number[];
  villain: number[];
  matchups: number;
  groups: Group[];
  /** Group index of each combo on the broken-down side, -1 elsewhere. */
  groupOf: Int32Array;
  bySide: "villain" | "hero" | null;
  runouts: number;
  heroCombos: number;
  villainCombos: number;
}

/** Pairs first (AA down), then by top card, then kicker, suited before offsuit: AA, KK, QQ, AKs, AKo. */
function classOrder(combo: number): number {
  const { hi, lo, kind } = classOfCombo(combo);
  return (kind === "pair" ? 0 : 10_000) + (12 - hi) * 100 + (12 - lo) * 2 + (kind === "offsuit" ? 1 : 0);
}

export function prepare(q: EquityQuery): Prepared {
  const board = parseCards(q.board);
  if (board.length !== 0 && (board.length < 3 || board.length > 5)) throw new Error("The board must be empty or have 3, 4 or 5 cards");
  if (new Set(board).size !== board.length) throw new Error("The same card appears twice on the board");
  const hero = removeDeadCards(parseRange(q.hero), board);
  const villain = removeDeadCards(parseRange(q.villain), board);
  if (hero.length === 0) throw new Error("Your side has no hands left after removing the board cards");
  if (villain.length === 0) throw new Error("The opponent's side has no hands left after removing the board cards");

  const bySide = villain.length > 1 ? "villain" : hero.length > 1 ? "hero" : null;
  // Group the broken-down side's combos by class, in class order.
  const side = bySide === "villain" ? villain : bySide === "hero" ? hero : [];
  const byName = new Map<string, Group>();
  for (const c of [...side].sort((x, y) => classOrder(x) - classOrder(y))) {
    const name = comboClassName(c);
    if (!byName.has(name)) byName.set(name, { name, order: classOrder(c), combos: [], pairs: 0 });
  }
  const all = [...byName.values()];
  const groupOfCombo = new Int32Array(COMBO_COUNT).fill(-1);
  for (const c of side) groupOfCombo[c] = all.indexOf(byName.get(comboClassName(c))!);

  // Count the matchups and each class's share without storing them: listMatchups does that once exact is chosen.
  const used = new Uint8Array(COMBO_COUNT);
  let matchups = 0;
  for (const a of hero) {
    const [a1, a2] = cardsOf(a);
    for (const b of villain) {
      const [b1, b2] = cardsOf(b);
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      matchups++;
      const c = bySide === "villain" ? b : a;
      const g = bySide ? groupOfCombo[c] : -1;
      if (g >= 0) {
        all[g].pairs++;
        if (!used[c]) {
          used[c] = 1;
          all[g].combos.push(c);
        }
      }
    }
  }
  if (matchups === 0) throw new Error("The two sides share every card, so no matchup is possible");
  // Drop classes with no compatible matchup (their only combos share a card with the other side) and renumber.
  const groups = all.filter((g) => g.pairs > 0);
  const renumber = all.map((g) => groups.indexOf(g));
  const groupOf = groupOfCombo.map((g) => (g >= 0 ? renumber[g] : -1));

  // When one side is a single hand, its cards are known too, so remove them from the other side's count.
  const heroCombos = villain.length === 1 ? removeDeadCards(hero, cardsOf(villain[0])).length : hero.length;
  const villainCombos = hero.length === 1 ? removeDeadCards(villain, cardsOf(hero[0])).length : villain.length;

  const unseen = 52 - 4 - board.length;
  const toDeal = 5 - board.length;
  let runouts = 1;
  for (let k = 0; k < toDeal; k++) runouts = (runouts * (unseen - k)) / (k + 1);

  return { board, hero, villain, matchups, groups, groupOf, bySide, runouts: Math.round(runouts), heroCombos, villainCombos };
}

/** Compatible matchups, flat: hero combo, villain combo, group index (-1 when there are no groups), ... */
function listMatchups(p: Prepared): Int32Array {
  const flat = new Int32Array(3 * p.matchups);
  let i = 0;
  for (const a of p.hero) {
    const [a1, a2] = cardsOf(a);
    for (const b of p.villain) {
      const [b1, b2] = cardsOf(b);
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      flat[i++] = a;
      flat[i++] = b;
      flat[i++] = p.bySide ? p.groupOf[p.bySide === "villain" ? b : a] : -1;
    }
  }
  return flat;
}

export interface ExactPlan {
  /** Matchups the exact count evaluates: before the flop, one per set that is the same up to suits; null if not worked out. */
  distinct: number | null;
  /** Board evaluations, counting each evaluated matchup's setup as MATCHUP_COST more. */
  cost: number;
  /** The matchups (as from listMatchups), or null when the exact count is over budget. */
  pairs: Int32Array | null;
  /** Before the flop, each matchup's isoKey. */
  keys: string[] | null;
}

/** Whether the exact count fits EXACT_BUDGET, deduping preflop matchups by suits first when that could bring it under. */
export function planExact(p: Prepared): ExactPlan {
  const per = p.runouts + MATCHUP_COST;
  const preflop = p.board.length === 0;
  // Relabelling suits merges at most 24 matchups into one, so past this not even the deduped count fits.
  if (p.matchups > 1 && p.matchups * per > (preflop ? 24 : 1) * EXACT_BUDGET) return { distinct: null, cost: p.matchups * per, pairs: null, keys: null };
  const pairs = listMatchups(p);
  const keys: string[] | null = preflop ? [] : null;
  if (keys) for (let i = 0; i < pairs.length; i += 3) keys.push(isoKey(pairs[i], pairs[i + 1]));
  const distinct = keys ? new Set(keys).size : p.matchups;
  const cost = distinct * per;
  return p.matchups === 1 || cost <= EXACT_BUDGET ? { distinct, cost, pairs, keys } : { distinct, cost, pairs: null, keys: null };
}

const base = (p: Prepared) => ({ heroCombos: p.heroCombos, villainCombos: p.villainCombos, bySide: p.bySide });

/** Monte Carlo, one run per class, trials split by the classes' weights. Seeded, so it repeats exactly. */
export function monteCarloStage(p: Prepared, plan: ExactPlan): EquityOutcome {
  const n = p.matchups;
  const target = p.board.length ? MC_TRIALS_POSTFLOP : MC_TRIALS_PREFLOP;
  let eq = 0, win = 0, tie = 0, variance = 0, trialsUsed = 0;
  const classes: ClassRow[] = p.groups.map((g, i) => {
    const w = g.pairs / n;
    const trials = Math.max(MIN_CLASS_TRIALS, Math.round(target * w));
    const ranges = p.bySide === "villain" ? [p.hero, g.combos] : [g.combos, p.villain];
    const r = monteCarloEquity(ranges, { board: p.board, trials, seed: 1 + i }).players[0];
    eq += w * r.equity;
    win += w * r.win;
    tie += w * r.tie;
    variance += w * w * r.stdErr * r.stdErr;
    trialsUsed += trials;
    return { name: g.name, combos: g.combos.length, weight: w, equity: r.equity, margin: 1.96 * r.stdErr };
  });
  const deals = `${fmt(trialsUsed)} random deals${p.groups.length > 1 ? `, split across the ${p.groups.length} hand classes by weight` : ""}, with a fixed seed (the same deals every time, so the result repeats exactly)`;
  const deduped = plan.distinct !== null && plan.distinct < n ? ` (${fmt(plan.distinct)} distinct up to suits)` : "";
  const size = `${fmt(n)} matchup${n === 1 ? "" : "s"}${deduped} × ${fmt(p.runouts)} runouts`;
  const stillOver = plan.distinct === null && p.board.length === 0 ? ", even with matchups that are the same up to suits counted once" : "";
  return {
    equity: eq,
    win,
    tie,
    margin: 1.96 * Math.sqrt(variance),
    method: plan.pairs
      ? `Monte Carlo preview: ${deals}. The exact count, ${size}, is running and will replace it.`
      : `${size}, counting each matchup's setup as ${MATCHUP_COST} boards, is ${fmt(plan.cost)} boards to evaluate${stillOver}: over the ${fmt(EXACT_BUDGET)} that fit here, so this is Monte Carlo: ${deals}. The true value is within the ± margin about 95% of the time.`,
    ...base(p),
    classes,
  };
}

/** The 24 ways to relabel the four suits. */
const perms = (xs: number[]): number[][] => (xs.length ? xs.flatMap((x) => perms(xs.filter((y) => y !== x)).map((p) => [x, ...p])) : [[]]);
const SUIT_PERMS = perms([0, 1, 2, 3]);

/**
 * Same key for preflop matchups that differ only by relabelling suits (JhJd vs AhAc and JhJd vs AdAs), which
 * have the same equity: the smallest of the 24 relabelled spellings.
 */
function isoKey(a: number, b: number): string {
  let best = "";
  for (const perm of SUIT_PERMS) {
    const m = (c: Card) => (c & ~3) | perm[c & 3];
    const h = [m(COMBO_HI[a]), m(COMBO_LO[a])].sort((x, y) => y - x);
    const v = [m(COMBO_HI[b]), m(COMBO_LO[b])].sort((x, y) => y - x);
    const key = `${h},${v}`;
    if (best === "" || key < best) best = key;
  }
  return best;
}

/**
 * Exact: every runout of every matchup. Yields the number of matchups done after each one. Matchups that are
 * the same up to suits are enumerated once before the flop (JJ vs QQ+, AK: 34 matchups, 15 distinct). A board
 * rarely leaves such symmetries, and a flop matchup is only 990 runouts, so postflop each one is enumerated.
 */
export function* exactStage(p: Prepared, plan: ExactPlan): Generator<number, EquityOutcome> {
  const G = p.groups.length;
  const gEq = new Float64Array(G), gN = new Float64Array(G);
  const cache = new Map<string, { equity: number; win: number; tie: number }>();
  const pairs = plan.pairs!;
  let eq = 0, win = 0, tie = 0, done = 0;
  for (let i = 0; i < pairs.length; i += 3) {
    const a = pairs[i], b = pairs[i + 1], g = pairs[i + 2];
    const key = plan.keys ? plan.keys[i / 3] : "";
    let r = key ? cache.get(key) : undefined;
    if (!r) {
      r = exactEquity([cardsOf(a), cardsOf(b)], p.board).players[0];
      if (key) cache.set(key, r);
    }
    eq += r.equity;
    win += r.win;
    tie += r.tie;
    if (g >= 0) {
      gEq[g] += r.equity;
      gN[g]++;
    }
    yield ++done;
  }
  const n = p.matchups;
  return {
    equity: eq / n,
    win: win / n,
    tie: tie / n,
    margin: 0,
    method:
      n === 1
        ? `Exact: all ${fmt(p.runouts)} runouts enumerated.`
        : `Exact: ${fmt(n)} equally likely matchups × ${fmt(p.runouts)} runouts each.`,
    ...base(p),
    classes: p.groups.map((grp, i) => ({ name: grp.name, combos: grp.combos.length, weight: gN[i] / n, equity: gEq[i] / gN[i], margin: 0 })),
  };
}

export interface JobContext {
  post: (msg: EquityResponse) => void;
  /** False once a newer request has arrived. */
  isCurrent: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const SLICE_MS = 30;

/** Quick Monte Carlo first when the exact count will take a while; then the exact count when it fits the budget. */
export async function runEquityJob(req: EquityRequest, ctx: JobContext): Promise<void> {
  const { id } = req;
  try {
    const p = prepare(req);
    const plan = planExact(p);
    const exact = plan.pairs !== null;
    if (!exact || plan.cost > QUICK_BUDGET) {
      ctx.post({ id, type: "result", outcome: monteCarloStage(p, plan), final: !exact });
      if (!exact) return;
      await ctx.sleep(0);
      if (!ctx.isCurrent()) return;
    }
    const steps = exactStage(p, plan);
    let last = ctx.now();
    for (;;) {
      const s = steps.next();
      if (s.done) {
        ctx.post({ id, type: "result", outcome: s.value, final: true });
        return;
      }
      if (ctx.now() - last > SLICE_MS) {
        ctx.post({ id, type: "progress", done: s.value, total: p.matchups });
        await ctx.sleep(0);
        if (!ctx.isCurrent()) return;
        last = ctx.now();
      }
    }
  } catch (err) {
    if (ctx.isCurrent()) ctx.post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}
