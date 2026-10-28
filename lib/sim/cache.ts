// Result cache for the sim worker: a bounded LRU map plus the canonical key of a request.
//
// Every job is deterministic (seeded sampling, fixed chunk sizes, stopping rules that depend only on the
// running estimate), so a request's answer is a function of its key. The key lists, in a fixed order,
// everything that determines the answer: stacks, button, blinds, actions, board, heroSeat, heroCards,
// the bots' personas (the hero's own entry is ignored by the jobs, so it is keyed as null) and the job
// parameters with their defaults filled in. The id is not part of it.
//
// LRU via Map insertion order: get() re-inserts the entry, set() evicts the oldest past capacity.

import type { Action } from "../engine/engine";
import type { PublicHistory } from "../bots/view";
import { DEFAULT_MAX_RAISES, DEFAULT_PARTICLES, DEFAULT_TRIALS_PER_COMBO } from "../grading/ev";
import { SPOT_DEFAULT_STDERR, SPOT_DEFAULT_TRIALS, type GradeRequest, type SpotRequest } from "./protocol";

export const DEFAULT_CACHE_CAPACITY = 64;

/** Least-recently-used map with a fixed capacity. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(readonly capacity: number = DEFAULT_CACHE_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`Cache capacity must be a positive integer, got ${capacity}`);
  }

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** The value, marked most recently used; undefined on a miss. */
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  /** Stores (or refreshes) the value as most recently used, evicting the least recently used past capacity. */
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value!);
  }

  clear(): void {
    this.map.clear();
  }
}

const actionKey = (a: Action): (string | number)[] => (a.type === "raise" ? ["raise", a.to] : [a.type]);

function historyKey(h: PublicHistory, heroSeat: number, heroCards: readonly number[], personas: readonly unknown[]): unknown[] {
  return [
    h.stacks,
    h.button,
    h.smallBlind,
    h.bigBlind,
    h.actions.map(actionKey),
    h.board,
    heroSeat,
    heroCards,
    personas.map((p, seat) => (seat === heroSeat ? null : (p ?? null))),
  ];
}

/** Canonical cache key of a spot request (defaults filled in; the id ignored). */
export function spotKey(req: SpotRequest): string {
  return JSON.stringify([
    "spot",
    ...historyKey(req.history, req.heroSeat, req.heroCards, req.personas),
    req.maxTrials ?? SPOT_DEFAULT_TRIALS,
    req.targetStdErr ?? SPOT_DEFAULT_STDERR,
    req.seed ?? 1,
  ]);
}

/** Canonical cache key of a grade request (defaults filled in; the id ignored). */
export function gradeKey(req: GradeRequest): string {
  const o = req.options ?? {};
  return JSON.stringify([
    "grade",
    ...historyKey(req.history, req.heroSeat, req.heroCards, req.personas),
    req.chosen ? actionKey(req.chosen) : null,
    o.particles ?? DEFAULT_PARTICLES,
    o.trialsPerCombo ?? DEFAULT_TRIALS_PER_COMBO,
    o.seed ?? 1,
    o.maxRaises ?? DEFAULT_MAX_RAISES,
  ]);
}
