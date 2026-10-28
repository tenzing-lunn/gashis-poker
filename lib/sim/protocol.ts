// Typed messages between the Practice page and lib/sim/sim.worker.ts.
//
// Same scheme as lib/gto/worker-protocol.ts: every request carries an `id` chosen by the page and every
// response echoes it, so the page drops responses of a run it has replaced. The worker runs one job at
// a time; a new request or a "cancel" supersedes the running job at its next yield (about every
// SLICE_MS of work), after which that job posts nothing more.
//
// Everything here is structured-clone-able: cards and combos are numbers, ranges are Float64Arrays,
// bots are named by PersonaId (the worker looks the Persona up), never by a Persona object.
//
// spot:  "ranges" (every live bot's posterior and its summaries), then "equity" messages (a rough small
//        Monte Carlo first, then refined estimates; the last one equals result.equity), then "done".
// grade: multiway, one "progress" with a coarse GradeResult (few particles), then "done" with the full one.
//        Heads-up: "done" only.
// A cache hit posts "done" alone, with `cached: true` and the stored result (which is self-contained).
// Any invalid request or failure becomes a single "error".
//
// Types only (plus a few constants), so importing this file costs the main bundle nothing.

import type { Action, Street } from "../engine/engine";
import type { Card } from "../poker/cards";
import type { PersonaId } from "../bots/personas";
import type { PublicHistory } from "../bots/view";
import type { GradeOptions, GradeResult } from "../grading/types";
import type { Bucket } from "./breakdown";

// ---------------------------------------------------------------------------------------------------
// Requests

/** Hero's equity and every live bot's range at a moment of a hand (hero need not be on the clock). */
export interface SpotRequest {
  kind: "spot";
  id: number;
  history: PublicHistory;
  heroSeat: number;
  heroCards: [Card, Card];
  /** Persona per seat; the hero's entry is ignored (null by convention). Every live bot needs one. */
  personas: (PersonaId | null)[];
  /** Monte Carlo cap (preflop heads-up and multiway), 1 .. SPOT_MAX_TRIALS. Default SPOT_DEFAULT_TRIALS. */
  maxTrials?: number;
  /** Monte Carlo stops once hero's equity stdErr is at most this (> 0). Default SPOT_DEFAULT_STDERR. */
  targetStdErr?: number;
  /** Default 1. */
  seed?: number;
}

/** Grade the hero's decision (hero must be on the clock). Mirrors GradeInput with PersonaIds. */
export interface GradeRequest {
  kind: "grade";
  id: number;
  history: PublicHistory;
  heroSeat: number;
  heroCards: [Card, Card];
  /** Persona per seat; null at heroSeat. */
  personas: (PersonaId | null)[];
  chosen?: Action;
  options?: GradeOptions;
}

export interface CancelRequest {
  kind: "cancel";
  id: number;
}

export type SimRequest = SpotRequest | GradeRequest | CancelRequest;
export type SimJobKind = Exclude<SimRequest["kind"], "cancel">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A job request without its id (the page's hook assigns one). */
export type SimJob = DistributiveOmit<Exclude<SimRequest, CancelRequest>, "id">;
export type JobFor<K extends SimJobKind> = Extract<SimJob, { kind: K }>;

/** Spot Monte Carlo defaults and limits. */
export const SPOT_DEFAULT_TRIALS = 200_000;
export const SPOT_MAX_TRIALS = 2_000_000;
export const SPOT_DEFAULT_STDERR = 0.002;
/** Trials of the first, rough equity estimate. */
export const SPOT_ROUGH_TRIALS = 1500;
/** Grade: particles of the multiway coarse pass. */
export const GRADE_COARSE_PARTICLES = 200;
export const GRADE_MAX_PARTICLES = 20_000;

// ---------------------------------------------------------------------------------------------------
// Payloads

export interface SpotRange {
  seat: number;
  persona: PersonaId;
  /** inferRange posterior with the hero's cards removed; sums to 1. */
  weights: Float64Array;
  /** classShares(weights): 169 classes, sums to 1. */
  classShares: Float64Array;
  /** classFrequencies(weights, board + hero cards): heat-map intensity 0..1 per class. */
  classFrequencies: Float64Array;
  /** handBuckets(weights, board); null preflop. */
  buckets: { buckets: { bucket: Bucket; share: number }[]; draws: number } | null;
}

export interface SpotEquity {
  /** "rough": the quick first estimate; "refined": running or final estimate. */
  stage: "rough" | "refined";
  /** players[0] is the hero, then the live bots in seat order (same order as SpotResult.ranges). */
  players: { seat: number; equity: number; win: number; tie: number; stdErr: number }[];
  /** Exact enumeration (heads-up postflop, final only); stdErr 0. */
  exact: boolean;
  /** Exact: runouts per combo; Monte Carlo: trials. */
  samples: number;
}

export interface SpotResult {
  street: Street;
  board: Card[];
  /** Chips in the middle (collected pots plus outstanding bets). */
  pot: number;
  heroSeat: number;
  ranges: SpotRange[];
  /** Final equity (stage "refined"). */
  equity: SpotEquity;
}

// ---------------------------------------------------------------------------------------------------
// Responses

export type SimResponse =
  | { id: number; kind: "spot"; type: "ranges"; ranges: SpotRange[] }
  | { id: number; kind: "spot"; type: "equity"; equity: SpotEquity }
  | { id: number; kind: "spot"; type: "done"; result: SpotResult; cached: boolean }
  | { id: number; kind: "grade"; type: "progress"; result: GradeResult; particles: number }
  | { id: number; kind: "grade"; type: "done"; result: GradeResult; cached: boolean }
  | { [K in SimJobKind]: { id: number; kind: K; type: "error"; message: string } }[SimJobKind];

export type ResponseFor<K extends SimJobKind> = Extract<SimResponse, { kind: K }>;
