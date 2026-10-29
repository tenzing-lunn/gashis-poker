// The Reader: a model per opponent, updated one finished hand at a time. See README.md.
//
//   let reader = createReader();
//   reader = addHand(reader, observe(state, ["me", "bob"], 0));   // pure: returns a new Reader; seat 0 is
//                                                                 // the observer, modeled from its own cards
//   playerReads(reader, "bob", "Bob");      // the most unusual situation reads, as sentences
//   playerStyle(reader, "bob", "Bob");      // closest style and a sentence
//
// Per player it keeps the situation counts (situations.ts) and the summed style log-likelihoods
// (style.ts). Everything else (posteriors, intervals, sentences) is computed from those on demand, so
// the prior weight k and the credible level can be chosen when reading.

import { PERSONA_IDS, type PersonaId } from "../../bots/personas";
import type { ObservedHand } from "./hand";
import { readOutcome, topReads, type OutcomeRead, type RankedRead, type ReadOptions } from "./reads";
import { classifyHand, SITUATIONS } from "./situations";
import { DEFAULT_EPSILON, describeStyle, handDecisions, rankStyles, styleLogLikelihoods, stylePosterior } from "./style";
import { emptySituationCounts, type SituationCounts } from "./truth";

export interface PlayerModel {
  hands: number;
  counts: SituationCounts;
  /** Σ over hands of log L_p, in PERSONA_IDS order. */
  styleLogLik: number[];
}

export interface Reader {
  /** Tremble used in the style likelihood. */
  epsilon: number;
  players: Readonly<Record<string, PlayerModel>>;
}

export const createReader = (options: { epsilon?: number } = {}): Reader => ({ epsilon: options.epsilon ?? DEFAULT_EPSILON, players: {} });

const emptyModel = (): PlayerModel => ({ hands: 0, counts: emptySituationCounts(), styleLogLik: PERSONA_IDS.map(() => 0) });

/** The model of a player (an empty one if never seen). */
export const playerModel = (reader: Reader, id: string): PlayerModel => reader.players[id] ?? emptyModel();

/** A new Reader with one more finished hand seen. Seats whose player id is null are not modeled. */
export function addHand(reader: Reader, hand: ObservedHand): Reader {
  const players = { ...reader.players };
  const observations = classifyHand(hand);
  const decisions = handDecisions(hand);
  hand.players.forEach((id, seat) => {
    if (id === null) return;
    const old = playerModel(reader, id);
    const counts = old.counts.map((c) => c.slice());
    for (const o of observations) if (o.seat === seat) counts[o.situation][o.outcome]++;
    const ll = styleLogLikelihoods(hand, seat, reader.epsilon, decisions);
    players[id] = { hands: old.hands + 1, counts, styleLogLik: old.styleLogLik.map((x, i) => x + ll[i]) };
  });
  return { ...reader, players };
}

/** The read of one outcome ("vsFlopCbet", "fold") for a player. */
export function playerRead(reader: Reader, id: string, situation: string, outcome: string, options: ReadOptions = {}): OutcomeRead {
  const si = SITUATIONS.findIndex((s) => s.id === situation);
  if (si < 0) throw new Error(`Unknown situation ${situation}`);
  const oi = SITUATIONS[si].outcomes.indexOf(outcome);
  if (oi < 0) throw new Error(`Unknown outcome ${outcome} of ${situation}`);
  return readOutcome(playerModel(reader, id).counts[si], si, oi, options);
}

/** The player's most confident ways of differing from a typical player, as sentences. */
export const playerReads = (reader: Reader, id: string, name: string, options: ReadOptions & { limit?: number } = {}): RankedRead[] =>
  topReads(playerModel(reader, id).counts, name, options);

/** The style posterior of a player, the closest style, and the sentence. */
export function playerStyle(reader: Reader, id: string, name: string): { posterior: Record<PersonaId, number>; top: PersonaId; sentence: string } {
  const model = playerModel(reader, id);
  const posterior = stylePosterior(model.styleLogLik);
  return { posterior, top: rankStyles(posterior)[0].style, sentence: describeStyle(posterior, model.hands, name) };
}
