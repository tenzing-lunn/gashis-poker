// Bots playing each other through the engine. See README.md.

import { applyAction, createHand, DEFAULT_BIG_BLIND, DEFAULT_SMALL_BLIND, seatToAct, type HandState } from "../engine/engine";
import { createRng, shuffle } from "../poker/cards";
import type { Persona } from "./personas";
import { chooseAction } from "./policy";
import { botView } from "./view";

export interface TableSetup {
  /** Persona in each seat. */
  personas: readonly Persona[];
  stacks: readonly number[];
  button: number;
  smallBlind?: number;
  bigBlind?: number;
}

/**
 * Plays one hand to the end. The seed fixes both the deal and every bot decision, so the same table and
 * seed always give the identical hand.
 */
export function playHand(table: TableSetup, seed: number): HandState {
  if (table.personas.length !== table.stacks.length) throw new Error("Need one persona per seat");
  let s = createHand(
    { stacks: table.stacks, button: table.button, smallBlind: table.smallBlind, bigBlind: table.bigBlind },
    { seed },
  );
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  while (!s.complete) {
    const seat = seatToAct(s)!;
    s = applyAction(s, chooseAction(table.personas[seat], botView(s, seat), rng).action);
  }
  return s;
}

export interface SimulateOptions {
  /** Persona in each seat (2-9 seats). */
  personas: readonly Persona[];
  hands: number;
  seed: number;
  /** Starting stack of each seat every hand. Default: 100 big blinds each. */
  stacks?: readonly number[];
  smallBlind?: number;
  bigBlind?: number;
  /** Reseat the personas at random every hand (default false: fixed seats). The button always rotates. */
  shuffleSeats?: boolean;
}

/**
 * Plays `hands` independent hands (stacks reset every hand, like a cash game with auto top-up) and
 * calls `onHand` with each finished hand and the personas by seat.
 */
export function simulate(options: SimulateOptions, onHand: (state: HandState, personas: readonly Persona[]) => void): void {
  const n = options.personas.length;
  const bigBlind = options.bigBlind ?? DEFAULT_BIG_BLIND;
  const smallBlind = options.smallBlind ?? (options.bigBlind === undefined ? DEFAULT_SMALL_BLIND : Math.max(1, Math.floor(bigBlind / 2)));
  const stacks = options.stacks ?? new Array(n).fill(100 * bigBlind);
  const master = createRng(options.seed);
  for (let h = 0; h < options.hands; h++) {
    const personas = options.shuffleSeats ? shuffle(options.personas.slice(), master) : options.personas;
    const state = playHand({ personas, stacks, button: h % n, smallBlind, bigBlind }, master.nextU32());
    onHand(state, personas);
  }
}
