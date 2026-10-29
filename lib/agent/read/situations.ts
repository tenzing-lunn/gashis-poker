// The situations the Reader counts, and the classifier that finds them in a finished hand's public
// event log. See README.md for the table of definitions.
//
// A situation is a kind of decision with a few mutually exclusive outcomes ("facing a flop c-bet: fold /
// call / raise"). Each one is defined only from public facts at the player's own decision point: the
// street, who raised preflop, who bet earlier, whether anyone has bet yet this street. A player meets
// each situation at most once per hand (always the first decision that fits), so with hands dealt
// independently every observation of a situation is an independent draw from that player's outcome
// frequencies there. That is what makes the Dirichlet–multinomial counting in reads.ts exact.
//
// Two situations are not decisions:
// - riverBluff: a river bet (outcome "bet" of riverBet: first to act or checked to) whose cards
//   were shown at showdown is a "bluff" if its strength percentile on the final board (features.ts: the share of other live combos
//   it beats, ties half) is below BLUFF_LINE = 0.5, else "value". Only river bets that reach showdown
//   are ever classified (a bet that wins at once is never shown), so the rate is "bluffs among river
//   bets that got to showdown", which is not the bluff share of all river bets: bluffs that are raised
//   and fold never show. Calibration measures the truth the same way, so the read is honest about
//   what it estimates.
// - showdown: every hand the player saw the flop in (was not folded when it was dealt), outcome
//   "showdown" if the player was shown down at the end.

import type { HandEvent } from "../../engine/engine";
import { comboIndex } from "../../poker/combinatorics";
import { boardInfo } from "../../bots/features";
import { seatPositions } from "../../bots/view";
import { finalBoard, type ObservedHand } from "./hand";

/** Strength percentile below which a shown river bet counts as a bluff. */
export const BLUFF_LINE = 0.5;

export interface Situation {
  id: string;
  /** Short name for tables. */
  title: string;
  outcomes: readonly string[];
  /** The count noun, singular and plural: "After 23 <flop c-bets faced>". */
  spot: readonly [string, string];
  /** What the player does, per outcome: "Bob <folds> between 48% and 79% of the time". */
  verbs: readonly string[];
  /** Where: "Bob folds <facing a flop c-bet> more often than a typical player". */
  context: string;
}

export const SITUATIONS: readonly Situation[] = [
  {
    id: "openEarly",
    title: "unopened, early position",
    outcomes: ["raise", "limp", "fold"],
    spot: ["unopened pot in early position", "unopened pots in early position"],
    verbs: ["raises", "limps", "folds"],
    context: "first in from early position (UTG to HJ)",
  },
  {
    id: "openLate",
    title: "unopened, CO / BTN",
    outcomes: ["raise", "limp", "fold"],
    spot: ["unopened pot on the button or cutoff", "unopened pots on the button or cutoff"],
    verbs: ["raises", "limps", "folds"],
    context: "first in on the button or cutoff",
  },
  {
    id: "openSmallBlind",
    title: "unopened, small blind",
    outcomes: ["raise", "limp", "fold"],
    spot: ["unopened pot in the small blind", "unopened pots in the small blind"],
    verbs: ["raises", "limps", "folds"],
    context: "first in from the small blind",
  },
  {
    id: "bbVsLimp",
    title: "big blind vs limp",
    outcomes: ["raise", "check"],
    spot: ["limped pot in the big blind", "limped pots in the big blind"],
    verbs: ["raises", "checks"],
    context: "in the big blind after a limp",
  },
  {
    id: "vsOpen",
    title: "facing an open",
    outcomes: ["3-bet", "call", "fold"],
    spot: ["open faced", "opens faced"],
    verbs: ["3-bets", "calls", "folds"],
    context: "facing an open",
  },
  {
    id: "vs3bet",
    title: "opener facing a 3-bet",
    outcomes: ["4-bet", "call", "fold"],
    spot: ["3-bet faced after opening", "3-bets faced after opening"],
    verbs: ["4-bets", "calls", "folds"],
    context: "facing a 3-bet after opening",
  },
  {
    id: "flopCbet",
    title: "flop c-bet chance",
    outcomes: ["bet", "check"],
    spot: ["flop as the preflop raiser", "flops as the preflop raiser"],
    verbs: ["c-bets", "checks"],
    context: "on the flop as the preflop raiser",
  },
  {
    id: "flopStab",
    title: "unbet flop, not the raiser",
    outcomes: ["bet", "check"],
    spot: ["unbet flop when not the preflop raiser", "unbet flops when not the preflop raiser"],
    verbs: ["bets", "checks"],
    context: "on an unbet flop when not the preflop raiser",
  },
  {
    id: "vsFlopCbet",
    title: "facing a flop c-bet",
    outcomes: ["fold", "call", "raise"],
    spot: ["flop c-bet faced", "flop c-bets faced"],
    verbs: ["folds", "calls", "raises"],
    context: "facing a flop c-bet",
  },
  {
    id: "turnBarrel",
    title: "turn after c-betting",
    outcomes: ["bet", "check"],
    spot: ["turn after c-betting the flop", "turns after c-betting the flop"],
    verbs: ["bets again", "checks"],
    context: "on the turn after c-betting the flop",
  },
  {
    id: "vsTurnBarrel",
    title: "facing a turn barrel",
    outcomes: ["fold", "call", "raise"],
    spot: ["turn barrel faced", "turn barrels faced"],
    verbs: ["folds", "calls", "raises"],
    context: "facing a second barrel on the turn",
  },
  {
    // Mixes out-of-position leads (first to act) with bets when checked to; not split.
    id: "riverBet",
    title: "river, first to act or checked to",
    outcomes: ["bet", "check"],
    spot: ["river when first to act or checked to", "rivers when first to act or checked to"],
    verbs: ["bets", "checks"],
    context: "on the river when first to act or checked to",
  },
  {
    id: "vsRiverBet",
    title: "facing a river bet",
    outcomes: ["fold", "call", "raise"],
    spot: ["river bet faced", "river bets faced"],
    verbs: ["folds", "calls", "raises"],
    context: "facing a river bet",
  },
  {
    id: "riverBluff",
    title: "shown river bets",
    outcomes: ["bluff", "value"],
    spot: ["river bet shown down", "river bets shown down"],
    verbs: ["is bluffing", "has a value hand"],
    context: "with a river bet that gets to showdown",
  },
  {
    id: "showdown",
    title: "showdown after the flop",
    outcomes: ["showdown", "no showdown"],
    spot: ["flop seen", "flops seen"],
    verbs: ["goes to showdown", "gives up before showdown"],
    context: "after seeing the flop",
  },
];

export const SITUATION_COUNT = SITUATIONS.length;
const S = Object.fromEntries(SITUATIONS.map((s, i) => [s.id, i])) as Record<string, number>;

/** One outcome of one situation for one seat. */
export interface Observation {
  seat: number;
  situation: number;
  outcome: number;
}

const EARLY = new Set(["UTG", "MP", "LJ", "HJ"]);

/**
 * Every situation each seat met in a finished hand, with its outcome. Reads only the public event log
 * (and the final board and shown cards in it).
 */
export function classifyHand(hand: ObservedHand): Observation[] {
  return classifyEvents(hand.stacks.length, hand.button, hand.events, finalBoard(hand));
}

export function classifyEvents(n: number, button: number, events: readonly HandEvent[], board: readonly number[]): Observation[] {
  const out: Observation[] = [];
  const add = (seat: number, situation: number, outcome: number) => out.push({ seat, situation, outcome });
  const positions = seatPositions(n, button);
  const bigBlindSeat = n === 2 ? (button + 1) % n : (button + 2) % n;

  const folded = new Array<boolean>(n).fill(false);
  const sawFlop = new Array<boolean>(n).fill(false);
  const actedPre = new Array<boolean>(n).fill(false);
  const riverBet = new Array<boolean>(n).fill(false);
  let openerFaced3bet = false;
  let preRaises = 0;
  let limpers = 0;
  let opener = -1;
  let preAggressor = -1;
  let cbettor = -1; // made the flop c-bet
  let flopAggressor = -1; // last bet or raise on the flop
  // Per street (postflop): bets + raises so far, the last bettor, and each seat's progress.
  let streetBets = 0;
  let bettor = -1;
  let acted = new Array<boolean>(n).fill(false);
  let responded = new Array<boolean>(n).fill(false);
  const shown = new Map<number, number[]>();

  for (const e of events) {
    if (e.type === "deal") {
      if (e.street === "flop") for (let s = 0; s < n; s++) sawFlop[s] = !folded[s];
      streetBets = 0;
      bettor = -1;
      acted = new Array<boolean>(n).fill(false);
      responded = new Array<boolean>(n).fill(false);
      continue;
    }
    if (e.type === "showdown") {
      shown.set(e.seat, e.cards);
      continue;
    }
    if (e.type !== "action") continue;
    const s = e.seat;
    const aggressive = e.action === "bet" || e.action === "raise";

    if (e.street === "preflop") {
      if (!actedPre[s]) {
        if (preRaises === 0) {
          if (s === bigBlindSeat) add(s, S.bbVsLimp, aggressive ? 0 : 1);
          else if (limpers === 0) {
            const group = positions[s] === "SB" ? S.openSmallBlind : EARLY.has(positions[s]) ? S.openEarly : S.openLate;
            add(s, group, aggressive ? 0 : e.action === "call" ? 1 : 2);
          }
        } else if (preRaises === 1) add(s, S.vsOpen, aggressive ? 0 : e.action === "call" ? 1 : 2);
      } else if (s === opener && preRaises === 2 && !openerFaced3bet) {
        openerFaced3bet = true;
        add(s, S.vs3bet, aggressive ? 0 : e.action === "call" ? 1 : 2);
      }
      actedPre[s] = true;
      if (e.action === "call" && preRaises === 0) limpers++;
      if (aggressive) {
        preRaises++;
        if (preRaises === 1) opener = s;
        preAggressor = s;
      }
    } else {
      if (!acted[s] && streetBets === 0) {
        const outcome = aggressive ? 0 : 1;
        if (e.street === "flop") add(s, s === preAggressor ? S.flopCbet : S.flopStab, outcome);
        else if (e.street === "turn") {
          if (s === cbettor && flopAggressor === s) add(s, S.turnBarrel, outcome);
        } else {
          add(s, S.riverBet, outcome);
          if (aggressive) riverBet[s] = true;
        }
      } else if (streetBets === 1 && !responded[s] && s !== bettor) {
        responded[s] = true;
        const outcome = e.action === "fold" ? 0 : e.action === "call" ? 1 : 2;
        if (e.street === "flop") {
          if (bettor === preAggressor) add(s, S.vsFlopCbet, outcome);
        } else if (e.street === "turn") {
          if (bettor === cbettor && flopAggressor === bettor) add(s, S.vsTurnBarrel, outcome);
        } else add(s, S.vsRiverBet, outcome);
      }
      acted[s] = true;
      if (aggressive) {
        if (e.street === "flop") {
          if (streetBets === 0 && s === preAggressor) cbettor = s;
          flopAggressor = s;
        }
        streetBets++;
        bettor = s;
      }
    }
    if (e.action === "fold") folded[s] = true;
  }

  for (let s = 0; s < n; s++) {
    if (sawFlop[s]) add(s, S.showdown, shown.has(s) ? 0 : 1);
    const cards = shown.get(s);
    if (riverBet[s] && cards) {
      const strength = boardInfo(board).strength[comboIndex(cards[0], cards[1])];
      add(s, S.riverBluff, strength < BLUFF_LINE ? 0 : 1);
    }
  }
  return out;
}
