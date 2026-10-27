// HUD statistics from finished hands' event logs. See README.md for the definitions.

import type { HandState } from "../engine/engine";

export interface StatCounts {
  hands: number;
  /** Hands with a voluntary preflop call or raise (posting a blind and checking the big blind do not count). */
  vpip: number;
  /** Hands with a preflop raise. */
  pfr: number;
  /** Hands where the seat acted facing exactly one preflop raise from someone else ... */
  threeBetChances: number;
  /** ... and re-raised at that first chance. */
  threeBets: number;
  /** Postflop action counts. */
  bets: number;
  raises: number;
  calls: number;
  folds: number;
  /** Times the seat first responded to a flop c-bet (the preflop raiser's flop bet, not yet raised) ... */
  cbetsFaced: number;
  /** ... and folded. */
  cbetFolds: number;
  /** Hands the seat was still in when the flop was dealt. */
  sawFlop: number;
  /** Hands the seat reached showdown. */
  showdowns: number;
  /** Net result in big blinds. */
  netBb: number;
}

export const emptyCounts = (): StatCounts => ({
  hands: 0,
  vpip: 0,
  pfr: 0,
  threeBetChances: 0,
  threeBets: 0,
  bets: 0,
  raises: 0,
  calls: 0,
  folds: 0,
  cbetsFaced: 0,
  cbetFolds: 0,
  sawFlop: 0,
  showdowns: 0,
  netBb: 0,
});

/** Adds one finished hand to the counts of each seat's label (e.g. its persona id). */
export function recordHand(counts: Map<string, StatCounts>, state: HandState, labelOf: (seat: number) => string): void {
  if (!state.complete) throw new Error("recordHand needs a finished hand");
  const n = state.seatCount;
  const c = Array.from({ length: n }, (_, seat) => {
    const label = labelOf(seat);
    if (!counts.has(label)) counts.set(label, emptyCounts());
    return counts.get(label)!;
  });
  const vpip = new Array(n).fill(false);
  const pfr = new Array(n).fill(false);
  const sawChance = new Array(n).fill(false);
  const folded = new Array(n).fill(false);
  const respondedToCbet = new Array(n).fill(false);
  let preflopRaises = 0;
  let preflopRaiser = -1;
  let cbettor = -1; // set while a flop c-bet stands unraised

  for (const e of state.events) {
    if (e.type === "deal" && e.street === "flop") {
      for (let seat = 0; seat < n; seat++) if (!folded[seat]) c[seat].sawFlop++;
    } else if (e.type === "showdown") {
      c[e.seat].showdowns++;
    } else if (e.type === "action") {
      const k = c[e.seat];
      const aggressive = e.action === "bet" || e.action === "raise";
      if (e.action === "fold") folded[e.seat] = true;
      if (e.street === "preflop") {
        if (!sawChance[e.seat] && preflopRaises === 1 && preflopRaiser !== e.seat) {
          sawChance[e.seat] = true;
          k.threeBetChances++;
          if (aggressive) k.threeBets++;
        }
        if (e.action === "call" || aggressive) vpip[e.seat] = true;
        if (aggressive) {
          pfr[e.seat] = true;
          preflopRaises++;
          preflopRaiser = e.seat;
        }
        continue;
      }
      if (e.action === "bet") k.bets++;
      else if (e.action === "raise") k.raises++;
      else if (e.action === "call") k.calls++;
      else if (e.action === "fold") k.folds++;
      if (e.street === "flop") {
        if (cbettor >= 0 && e.seat !== cbettor && !respondedToCbet[e.seat]) {
          respondedToCbet[e.seat] = true;
          k.cbetsFaced++;
          if (e.action === "fold") k.cbetFolds++;
        }
        if (e.action === "bet" && e.seat === preflopRaiser) cbettor = e.seat;
        else if (e.action === "raise") cbettor = -1;
      }
    }
  }
  for (let seat = 0; seat < n; seat++) {
    const k = c[seat];
    k.hands++;
    if (vpip[seat]) k.vpip++;
    if (pfr[seat]) k.pfr++;
    k.netBb += state.result!.net[seat] / state.bigBlind;
  }
}

export interface HudStats {
  label: string;
  hands: number;
  /** Percentages 0-100. */
  vpip: number;
  pfr: number;
  threeBet: number;
  /** Aggression factor: postflop (bets + raises) / calls. */
  af: number;
  /** Aggression frequency: postflop (bets + raises) / (bets + raises + calls + folds), in %. */
  afq: number;
  foldToCbet: number;
  /** Went to showdown, as a % of hands that saw the flop. */
  wtsd: number;
  /** Net big blinds per 100 hands. */
  bb100: number;
}

const pct = (a: number, b: number): number => (b > 0 ? (100 * a) / b : 0);

export function summarize(counts: Map<string, StatCounts>): HudStats[] {
  return [...counts].map(([label, k]) => ({
    label,
    hands: k.hands,
    vpip: pct(k.vpip, k.hands),
    pfr: pct(k.pfr, k.hands),
    threeBet: pct(k.threeBets, k.threeBetChances),
    af: k.calls > 0 ? (k.bets + k.raises) / k.calls : Infinity,
    afq: pct(k.bets + k.raises, k.bets + k.raises + k.calls + k.folds),
    foldToCbet: pct(k.cbetFolds, k.cbetsFaced),
    wtsd: pct(k.showdowns, k.sawFlop),
    bb100: (100 * k.netBb) / Math.max(1, k.hands),
  }));
}

/** A fixed-width text table of HUD stats. */
export function formatStats(stats: readonly HudStats[]): string {
  const head = ["persona", "hands", "VPIP", "PFR", "3bet", "AF", "AFq", "FtCB", "WTSD", "bb/100"];
  const rows = stats.map((s) => [
    s.label,
    String(s.hands),
    s.vpip.toFixed(1),
    s.pfr.toFixed(1),
    s.threeBet.toFixed(1),
    s.af.toFixed(2),
    s.afq.toFixed(1),
    s.foldToCbet.toFixed(1),
    s.wtsd.toFixed(1),
    s.bb100.toFixed(1),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((x, i) => (i === 0 ? x.padEnd(widths[i]) : x.padStart(widths[i]))).join("  ");
  return [line(head), ...rows.map(line)].join("\n");
}
