// Typed messages between the /lab page and workers/solver.worker.ts.
//
// Every request carries an `id` chosen by the page; every response echoes it, so the page can drop
// responses that belong to a run it has since replaced or stopped. A worker runs one job at a time:
// a new request (or a "cancel") supersedes the running job at its next yield point. Hard cancellation
// is `worker.terminate()` and a fresh worker.
//
// Types only (plus a few tiny constants), so importing this file costs the main bundle nothing.

import type { CfrVariant } from "./cfr";
import type { RiverActionKind, RiverTreeCounts } from "./river";

// ---------------------------------------------------------------------------------------------------
// Requests

export interface KuhnRequest {
  kind: "kuhn";
  id: number;
  variant: CfrVariant;
  /** Total CFR iterations, 1 .. KUHN_MAX_ITERATIONS. */
  iterations: number;
  /** Delay between convergence checkpoints in ms, so a human can watch it converge. 0 = full speed. */
  paceMs: number;
}

export interface AkqRequest {
  kind: "akq";
  id: number;
  pot: number;
  bet: number;
  /** CFR+ iterations. */
  iterations: number;
}

export interface PushFoldRequest {
  kind: "pushfold";
  id: number;
  /** Effective stack in bb, 1 .. 30. */
  stack: number;
}

export interface VarianceRequest {
  kind: "variance";
  id: number;
  /** bb/100 */
  winRate: number;
  /** bb/100 */
  stdDev: number;
  hands: number;
  runs: number;
  seed: number;
}

/** A river subgame (lib/gto/river.ts), solved by DCFR. Sizes are pot fractions; the worker validates everything. */
export interface RiverRequest {
  kind: "river";
  id: number;
  /** 5 cards, e.g. "Ks7d2c9h4s". */
  board: string;
  oopRange: string;
  ipRange: string;
  /** bb */
  pot: number;
  /** Effective stack behind, bb. */
  stack: number;
  oopBetSizes: number[];
  ipBetSizes: number[];
  /** Fractions of the pot after calling. */
  raiseSizes: number[];
  allIn: boolean;
  maxRaises: number;
  /** Stop once exploitability is below this percentage of the pot. */
  targetPct: number;
  /** 1 .. RIVER_MAX_ITERATIONS */
  maxIterations: number;
}

export interface CancelRequest {
  kind: "cancel";
  id: number;
}

export type SolverRequest = KuhnRequest | AkqRequest | PushFoldRequest | VarianceRequest | RiverRequest | CancelRequest;
export type SolverJobKind = Exclude<SolverRequest["kind"], "cancel">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A job request without its id (the page's hook assigns one). */
export type SolverJob = DistributiveOmit<Exclude<SolverRequest, CancelRequest>, "id">;
export type JobFor<K extends SolverJobKind> = Extract<SolverJob, { kind: K }>;

export const KUHN_MAX_ITERATIONS = 1_000_000;
/** Product hands x runs the variance tool accepts (about 5–7 s of work). */
export const VARIANCE_MAX_HANDS_X_RUNS = 200_000_000;
export const RIVER_MAX_ITERATIONS = 20_000;

// ---------------------------------------------------------------------------------------------------
// Payloads

/** One convergence checkpoint of the CFR average strategy. */
export interface KuhnPoint {
  iteration: number;
  /** NashConv / 2 of the average strategy, chips per hand. */
  exploitability: number;
  /** Player 0's expected value under the average strategy, chips per hand (equilibrium: -1/18). */
  value: number;
}

/** P(bet or call) per Kuhn info set key ("J", "Qpb", ...). */
export type KuhnBetProbs = Record<string, number>;

export interface KuhnResult {
  variant: CfrVariant;
  iterations: number;
  exploitability: number;
  nashConv: number;
  value: number;
  /** Average strategy, P(bet/call) per info set. */
  strategy: KuhnBetProbs;
  /** kuhnAlpha of the average strategy: where in Kuhn's family it landed. */
  alpha: number;
  timeMs: number;
}

/** CFR+'s numbers for the AKQ game, in the same shape as akqClosedForm's (minus the range). */
export interface AkqCfrResult {
  pot: number;
  bet: number;
  iterations: number;
  yBluff: number;
  yBetA: number;
  kCall: number;
  xCallVsBluff: number;
  xCallGivenBet: number;
  bluffShareOfBets: number;
  valueY: number;
  yPotShare: number;
  exploitability: number;
  timeMs: number;
}

export interface PushFoldResult {
  stack: number;
  /** P(SB shoves) per class, HAND_CLASSES order (row-major 13x13). */
  push: number[];
  /** P(BB calls) per class. */
  call: number[];
  sbValue: number;
  nashConv: number;
  exploitability: number;
  pushFraction: number;
  callFraction: number;
  iterations: number;
  pushRange: string;
  callRange: string;
  timeMs: number;
}

export interface VarianceSummary {
  mean: number;
  sd: number;
  belowZero: number;
  interval95: [number, number];
}

export interface VarianceResultMessage {
  winRate: number;
  stdDev: number;
  hands: number;
  runs: number;
  seed: number;
  histogram: { min: number; binWidth: number; counts: number[] };
  pathHands: number[];
  paths: number[][];
  simulated: VarianceSummary;
  analytic: VarianceSummary;
  drawdown: { mean: number; median: number; p95: number; max: number };
  timeMs: number;
}

/** One convergence checkpoint of the river solver's average strategy. */
export interface RiverPoint {
  iteration: number;
  /** Exploitability (NashConv / 2) as a percentage of the starting pot. */
  exploitabilityPct: number;
}

/** Tree and range sizes, known as soon as the spot is built. */
export interface RiverTreeInfo {
  counts: RiverTreeCounts;
  /** Live combos per player after board removal: [OOP, IP]. */
  combos: [number, number];
  /** Card-disjoint (OOP, IP) combo pairs. */
  pairs: number;
}

export interface RiverComboView {
  /** lib/poker combo index. */
  combo: number;
  /** e.g. "AhKd" */
  label: string;
  /** HAND_CLASSES index (13x13 grid, row-major from AA). */
  classIndex: number;
  /** 7-card hand value with the board, 1..7462 (higher is better). */
  value: number;
  /** e.g. "two pair" */
  category: string;
}

export interface RiverNodeView {
  /** Node id in the solver's tree (decision nodes only are listed). */
  id: number;
  player: 0 | 1;
  /** Action labels from the root, e.g. ["OOP Check", "IP Bet 7.5"]. */
  history: string[];
  /** Commitments this street before acting: [OOP, IP]. */
  committed: [number, number];
  actions: { kind: RiverActionKind; amount: number; label: string }[];
  /** For each action, the index in `nodes` of the decision node it leads to, or -1 (fold / showdown). */
  next: number[];
  /** Index in `nodes` of the parent decision node, or -1 at the root. */
  parent: number;
  /** Average strategy of the acting player, [a * n + i] over that player's combos. */
  strategy: Float32Array;
  /** The acting player's own reach per combo under the average strategy. */
  reach: Float32Array;
}

export interface RiverResult extends RiverTreeInfo {
  board: string;
  pot: number;
  stack: number;
  iterations: number;
  /** OOP's zero-sum value, bb per deal (IP's is the negative). */
  value: number;
  /** Each player's share of the pot (P/2 + zero-sum value); they add up to the pot. */
  potShare: [number, number];
  nashConv: number;
  exploitability: number;
  exploitabilityPct: number;
  /** Why the run ended. */
  stoppedBy: "target" | "max-iterations";
  targetPct: number;
  rangeCombos: [RiverComboView[], RiverComboView[]];
  /** Decision nodes; nodes[0] is the root. */
  nodes: RiverNodeView[];
  timeMs: number;
}

// ---------------------------------------------------------------------------------------------------
// Responses

export type SolverResponse =
  | { id: number; kind: "kuhn"; type: "progress"; points: KuhnPoint[]; iterations: number; strategy: KuhnBetProbs }
  | { id: number; kind: "kuhn"; type: "done"; points: KuhnPoint[]; result: KuhnResult }
  | { id: number; kind: "akq"; type: "done"; result: AkqCfrResult }
  | { id: number; kind: "pushfold"; type: "progress"; stack: number; iterations: number; nashConv: number }
  | { id: number; kind: "pushfold"; type: "done"; result: PushFoldResult }
  | { id: number; kind: "variance"; type: "done"; result: VarianceResultMessage }
  | { id: number; kind: "river"; type: "progress"; tree: RiverTreeInfo; points: RiverPoint[]; iterations: number }
  | { id: number; kind: "river"; type: "done"; tree: RiverTreeInfo; points: RiverPoint[]; result: RiverResult }
  | { [K in SolverJobKind]: { id: number; kind: K; type: "error"; message: string } }[SolverJobKind];

export type ResponseFor<K extends SolverJobKind> = Extract<SolverResponse, { kind: K }>;
