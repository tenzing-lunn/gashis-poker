// Small two-player zero-sum extensive-form games as explicit trees, plus exact evaluation:
// expected value, best response, NashConv and exploitability. Kuhn poker and the AKQ game are built on it.
//
// Conventions
// - Players are 0 and 1. Terminal payoffs are to player 0; player 1 receives the negative (zero-sum).
// - An info set is identified by a string key. Every decision node with the same key must belong to the
//   same player and offer the same actions (checked when the game is built). Games must have perfect
//   recall, which all the poker games here do.
// - A strategy profile is one Float64Array holding, for every info set, a probability per action, laid
//   out at InfoSet.offset. One array covers both players.
// - NashConv(sigma) = sum over players p of [BR value for p against sigma_-p] - [p's value under sigma].
//   In a zero-sum game the values cancel, so NashConv = BR_0 + BR_1 (each in that player's own payoff).
//   Exploitability = NashConv / 2 (OpenSpiel's convention): the average amount a best responder wins.
//   Both are 0 exactly at a Nash equilibrium.

export type GameNode = TerminalNode | ChanceNode | DecisionNode;

export interface TerminalNode {
  kind: "terminal";
  /** Payoff to player 0. */
  payoff: number;
}

export interface ChanceNode {
  kind: "chance";
  /** Probabilities must sum to 1. */
  outcomes: { prob: number; child: GameNode }[];
}

export interface DecisionNode {
  kind: "decision";
  player: 0 | 1;
  infoSet: string;
  actions: readonly string[];
  children: GameNode[];
}

export interface InfoSet {
  key: string;
  player: 0 | 1;
  actions: readonly string[];
  /** Index of this info set's first action in a profile array. */
  offset: number;
}

/** A profile: per-action probabilities for every info set, at InfoSet.offset. */
export type Profile = Float64Array;

// Compiled tree: flat arrays, so traversals index instead of chasing object shapes.
const TERMINAL = 0, CHANCE = 1, DECISION = 2;

export interface Game {
  readonly infoSets: readonly InfoSet[];
  /** Total number of actions over all info sets = length of a profile. */
  readonly size: number;
  /** @internal compiled tree */
  readonly tree: CompiledTree;
}

interface CompiledTree {
  kind: Uint8Array;
  /** Decision: info-set index. */
  info: Int32Array;
  /** Terminal: payoff to player 0. */
  payoff: Float64Array;
  /** Children of node v are child[first[v] .. first[v] + count[v]). */
  first: Int32Array;
  count: Int32Array;
  child: Int32Array;
  /** Chance: probability of each child edge (aligned with `child`). */
  prob: Float64Array;
  /** Decision nodes of each info set's player, deepest info sets first (for best response). */
  infoOrder: Int32Array;
  /** Nodes of each info set. */
  infoNodes: number[][];
}

/** Indexes a game tree: assigns info sets, checks consistency, flattens the tree. */
export function createGame(root: GameNode): Game {
  const infoSets: InfoSet[] = [];
  const infoIndex = new Map<string, number>();
  const infoDepth: number[] = [];
  const infoNodes: number[][] = [];
  const kind: number[] = [], info: number[] = [], payoff: number[] = [], first: number[] = [], count: number[] = [];
  const child: number[] = [], prob: number[] = [];
  let size = 0;

  // Breadth-first so each node's children are contiguous in `child`.
  const queue: { node: GameNode; depth: number }[] = [{ node: root, depth: 0 }];
  for (let v = 0; v < queue.length; v++) {
    const { node, depth } = queue[v];
    payoff.push(0);
    info.push(-1);
    first.push(child.length);
    if (node.kind === "terminal") {
      kind.push(TERMINAL);
      payoff[v] = node.payoff;
      count.push(0);
      continue;
    }
    if (node.kind === "chance") {
      kind.push(CHANCE);
      const total = node.outcomes.reduce((s, o) => s + o.prob, 0);
      if (Math.abs(total - 1) > 1e-9) throw new Error(`Chance probabilities sum to ${total}, not 1`);
      count.push(node.outcomes.length);
      for (const o of node.outcomes) {
        child.push(queue.length);
        prob.push(o.prob);
        queue.push({ node: o.child, depth: depth + 1 });
      }
      continue;
    }
    kind.push(DECISION);
    if (node.actions.length < 1 || node.actions.length !== node.children.length) {
      throw new Error(`Info set "${node.infoSet}": actions and children differ in length`);
    }
    let k = infoIndex.get(node.infoSet);
    if (k === undefined) {
      k = infoSets.length;
      infoIndex.set(node.infoSet, k);
      infoSets.push({ key: node.infoSet, player: node.player, actions: [...node.actions], offset: size });
      infoDepth.push(depth);
      infoNodes.push([]);
      size += node.actions.length;
    } else {
      const s = infoSets[k];
      if (s.player !== node.player || s.actions.join("\u0000") !== node.actions.join("\u0000")) {
        throw new Error(`Info set "${node.infoSet}" has inconsistent player or actions`);
      }
      infoDepth[k] = Math.max(infoDepth[k], depth);
    }
    info[v] = k;
    infoNodes[k].push(v);
    count.push(node.children.length);
    for (const c of node.children) {
      child.push(queue.length);
      prob.push(0);
      queue.push({ node: c, depth: depth + 1 });
    }
  }

  const infoOrder = Int32Array.from(infoSets.map((_, k) => k).sort((a, b) => infoDepth[b] - infoDepth[a]));
  return {
    infoSets,
    size,
    tree: {
      kind: Uint8Array.from(kind),
      info: Int32Array.from(info),
      payoff: Float64Array.from(payoff),
      first: Int32Array.from(first),
      count: Int32Array.from(count),
      child: Int32Array.from(child),
      prob: Float64Array.from(prob),
      infoOrder,
      infoNodes,
    },
  };
}

/** The uniform random profile. */
export function uniformProfile(game: Game): Profile {
  const p = new Float64Array(game.size);
  for (const s of game.infoSets) p.fill(1 / s.actions.length, s.offset, s.offset + s.actions.length);
  return p;
}

/** Builds a profile from { infoSetKey: [prob per action] }. Info sets left out are uniform. */
export function profileFromMap(game: Game, map: Readonly<Record<string, readonly number[]>>): Profile {
  const p = uniformProfile(game);
  for (const s of game.infoSets) {
    const probs = map[s.key];
    if (!probs) continue;
    if (probs.length !== s.actions.length) throw new Error(`Info set "${s.key}" needs ${s.actions.length} probabilities`);
    probs.forEach((x, a) => (p[s.offset + a] = x));
  }
  return p;
}

/** { infoSetKey: [prob per action] } for a profile. */
export function profileToMap(game: Game, profile: Profile): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const s of game.infoSets) out[s.key] = Array.from(profile.subarray(s.offset, s.offset + s.actions.length));
  return out;
}

/** Expected payoff to player 0 when both players follow `profile`. */
export function expectedValue(game: Game, profile: Profile): number {
  const t = game.tree, sets = game.infoSets;
  const value = (v: number): number => {
    const k = t.kind[v];
    if (k === TERMINAL) return t.payoff[v];
    let sum = 0;
    const f = t.first[v], n = t.count[v];
    if (k === CHANCE) {
      for (let i = 0; i < n; i++) sum += t.prob[f + i] * value(t.child[f + i]);
    } else {
      const off = sets[t.info[v]].offset;
      for (let i = 0; i < n; i++) {
        const p = profile[off + i];
        if (p > 0) sum += p * value(t.child[f + i]);
      }
    }
    return sum;
  };
  return value(0);
}

export interface BestResponse {
  /** The best responder's expected payoff (in its own terms: player 1's is minus player 0's). */
  value: number;
  /** A pure best-response profile for `player`; the opponent's entries are copied from the input profile. */
  profile: Profile;
}

/**
 * Exact best response for `player` against the opponent's part of `profile`.
 * The responder can't see the opponent's private information, so the choice is made per info set:
 * action value = sum over the info set's nodes h of (opponent and chance reach of h) x (value below h).
 * Info sets are resolved deepest first, so the values below an info set already use the best response.
 */
export function bestResponse(game: Game, profile: Profile, player: 0 | 1): BestResponse {
  const t = game.tree, sets = game.infoSets;
  const nodes = t.kind.length;
  const sign = player === 0 ? 1 : -1;

  // Reach of every node through chance and the opponent only.
  const reach = new Float64Array(nodes);
  reach[0] = 1;
  for (let v = 0; v < nodes; v++) {
    const f = t.first[v], n = t.count[v], k = t.kind[v];
    for (let i = 0; i < n; i++) {
      let p = 1;
      if (k === CHANCE) p = t.prob[f + i];
      else if (k === DECISION && sets[t.info[v]].player !== player) p = profile[sets[t.info[v]].offset + i];
      reach[t.child[f + i]] = reach[v] * p;
    }
  }

  const br = Float64Array.from(profile);
  // Value to `player` of the subtree at v, using `br` for the responder (deeper info sets are already fixed).
  const value = (v: number): number => {
    const k = t.kind[v];
    if (k === TERMINAL) return sign * t.payoff[v];
    const f = t.first[v], n = t.count[v];
    let sum = 0;
    if (k === CHANCE) {
      for (let i = 0; i < n; i++) sum += t.prob[f + i] * value(t.child[f + i]);
      return sum;
    }
    const off = sets[t.info[v]].offset;
    for (let i = 0; i < n; i++) {
      const p = br[off + i];
      if (p > 0) sum += p * value(t.child[f + i]);
    }
    return sum;
  };

  for (const k of t.infoOrder) {
    const s = sets[k];
    if (s.player !== player) continue;
    let bestA = 0, bestV = -Infinity;
    for (let a = 0; a < s.actions.length; a++) {
      let q = 0;
      for (const v of t.infoNodes[k]) if (reach[v] > 0) q += reach[v] * value(t.child[t.first[v] + a]);
      if (q > bestV + 1e-15) {
        bestV = q;
        bestA = a;
      }
    }
    br.fill(0, s.offset, s.offset + s.actions.length);
    br[s.offset + bestA] = 1;
  }
  return { value: value(0), profile: br };
}

export interface ExploitabilityReport {
  /** Player 0's expected payoff under the profile. */
  value: number;
  /** Best-response values: [player 0 vs sigma_1, player 1 vs sigma_0], each in that player's own payoff. */
  bestResponseValues: [number, number];
  /** Sum of the two best-response gains; 0 at equilibrium. */
  nashConv: number;
  /** NashConv / 2. */
  exploitability: number;
}

/** Exact NashConv and exploitability of a profile (see the conventions at the top of this file). */
export function exploitability(game: Game, profile: Profile): ExploitabilityReport {
  const value = expectedValue(game, profile);
  const b0 = bestResponse(game, profile, 0).value;
  const b1 = bestResponse(game, profile, 1).value;
  const nashConv = b0 - value + (b1 + value);
  return { value, bestResponseValues: [b0, b1], nashConv, exploitability: nashConv / 2 };
}
