// Tabular counterfactual regret minimisation on a Game tree.
//
// - "cfr":  vanilla CFR (Zinkevich et al. 2007). Simultaneous updates, regret matching, uniform average.
// - "cfr+": CFR+ (Tammelin 2014; Tammelin, Burch, Johanson & Bowling 2015). Alternating updates,
//           regret-matching+ (cumulative regrets clipped at 0 after every iteration) and a linearly
//           weighted average (iteration t has weight t).
// In both, the AVERAGE strategy converges to a Nash equilibrium; the current strategy need not.
//
// The solver is an object you step in chunks, so a worker can run N iterations, read the
// exploitability of the average strategy, post progress, and continue.

import { exploitability, type ExploitabilityReport, type Game, type Profile } from "./game";

export type CfrVariant = "cfr" | "cfr+";

export interface CfrSolver {
  readonly game: Game;
  readonly variant: CfrVariant;
  /** Iterations completed so far. */
  readonly iterations: number;
  /** Runs `iterations` more iterations (default 1). */
  step(iterations?: number): void;
  /** The strategy regret matching would play next. */
  currentStrategy(): Profile;
  /** The (weighted) average strategy: the one that converges to equilibrium. */
  averageStrategy(): Profile;
  /** Exact value / NashConv / exploitability of the average strategy, plus the iteration count. */
  report(): ExploitabilityReport & { iterations: number };
}

const TERMINAL = 0, CHANCE = 1;

export function createCfrSolver(game: Game, options: { variant?: CfrVariant } = {}): CfrSolver {
  const variant = options.variant ?? "cfr+";
  const plus = variant === "cfr+";
  const { kind, info, payoff, first, count, child, prob } = game.tree;
  const sets = game.infoSets;
  const offset = Int32Array.from(sets, (s) => s.offset);
  const owner = Int8Array.from(sets, (s) => s.player);
  const width = Int32Array.from(sets, (s) => s.actions.length);

  const regret = new Float64Array(game.size);
  const strategySum = new Float64Array(game.size);
  const current = new Float64Array(game.size);
  const childValue = new Float64Array(child.length); // scratch, indexed by child edge
  let t = 0;

  // Regret matching: play actions in proportion to positive regret; uniform if none is positive.
  const updateCurrent = (): void => {
    for (let k = 0; k < sets.length; k++) {
      const off = offset[k], n = width[k];
      let pos = 0;
      for (let a = 0; a < n; a++) if (regret[off + a] > 0) pos += regret[off + a];
      for (let a = 0; a < n; a++) current[off + a] = pos > 0 ? Math.max(regret[off + a], 0) / pos : 1 / n;
    }
  };

  // Returns the value of node v to player p. rp = p's own reach, ro = chance x opponent reach.
  let p = 0, sign = 1, weight = 1;
  const walk = (v: number, rp: number, ro: number): number => {
    const k = kind[v];
    if (k === TERMINAL) return sign * payoff[v];
    const f = first[v], n = count[v];
    let sum = 0;
    if (k === CHANCE) {
      for (let i = 0; i < n; i++) sum += prob[f + i] * walk(child[f + i], rp, ro * prob[f + i]);
      return sum;
    }
    const s = info[v], off = offset[s];
    if (owner[s] !== p) {
      // No pruning on the opponent's zero-probability actions: the average strategy is weighted by the
      // player's OWN reach, so p's info sets below them still need their strategy sums. Skipping them
      // freezes the average at info sets the opponent has stopped reaching (seen in an earlier, six-deal AKQ game at
      // P = B, where X's call-with-A froze at 50% and stayed exploitable).
      for (let i = 0; i < n; i++) {
        const q = current[off + i];
        if (q > 0 || rp > 0) sum += q * walk(child[f + i], rp, ro * q);
      }
      return sum;
    }
    for (let i = 0; i < n; i++) {
      const cv = walk(child[f + i], rp * current[off + i], ro);
      childValue[f + i] = cv;
      sum += current[off + i] * cv;
    }
    for (let i = 0; i < n; i++) {
      regret[off + i] += ro * (childValue[f + i] - sum);
      strategySum[off + i] += weight * rp * current[off + i];
    }
    return sum;
  };

  const traverse = (player: number): void => {
    p = player;
    sign = player === 0 ? 1 : -1;
    walk(0, 1, 1);
  };

  const iterate = (): void => {
    t++;
    if (plus) {
      weight = t;
      for (let player = 0; player < 2; player++) {
        updateCurrent();
        traverse(player);
        for (let k = 0; k < sets.length; k++) {
          if (owner[k] !== player) continue;
          for (let a = offset[k]; a < offset[k] + width[k]; a++) if (regret[a] < 0) regret[a] = 0;
        }
      }
    } else {
      weight = 1;
      updateCurrent();
      traverse(0);
      traverse(1);
    }
  };

  const normalise = (src: Float64Array): Profile => {
    const out = new Float64Array(game.size);
    for (let k = 0; k < sets.length; k++) {
      const off = offset[k], n = width[k];
      let total = 0;
      for (let a = 0; a < n; a++) total += src[off + a];
      for (let a = 0; a < n; a++) out[off + a] = total > 0 ? src[off + a] / total : 1 / n;
    }
    return out;
  };

  updateCurrent();
  const solver: CfrSolver = {
    game,
    variant,
    get iterations() {
      return t;
    },
    step(iterations = 1) {
      for (let i = 0; i < iterations; i++) iterate();
      updateCurrent();
    },
    currentStrategy: () => Float64Array.from(current),
    averageStrategy: () => normalise(strategySum),
    report: () => ({ ...exploitability(game, solver.averageStrategy()), iterations: t }),
  };
  return solver;
}
