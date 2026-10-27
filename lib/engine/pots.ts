// Main and side pots, and how a finished hand's pots are split. See README.md.
//
// A pot is built from contribution "levels": every distinct amount a player has put in. The layer
// between two consecutive levels holds (level - previous level) from each player who reached it, and
// belongs to the live players whose contribution reaches it. Consecutive layers with the same eligible
// players merge into one pot, and empty layers are skipped. This is exactly pokerkit's State.pots.

export interface Pot {
  amount: number;
  /** Seats that can win this pot, ascending. */
  eligible: number[];
}

/**
 * Pots from per-seat contributions.
 * `collected` is what each seat has put in on finished streets (layers are built from this);
 * `pending` adds the current street's outstanding bets (eligibility is judged from this, like pokerkit);
 * `live[seat]` is false once the seat has folded.
 */
export function buildPots(collected: readonly number[], pending: readonly number[], live: readonly boolean[]): Pot[] {
  const levels = [...new Set(collected)].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of collected) if (c >= level) amount += level - previous;
    const eligible: number[] = [];
    for (let seat = 0; seat < live.length; seat++) if (live[seat] && pending[seat] >= level) eligible.push(seat);
    while (pots.length > 0 && sameSeats(pots[pots.length - 1].eligible, eligible)) amount += pots.pop()!.amount;
    if (amount > 0) pots.push({ amount, eligible });
    previous = level;
  }
  return pots;
}

const sameSeats = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((seat, i) => seat === b[i]);

export interface PotAward extends Pot {
  /** Seats with the best hand among `eligible` (just the last live player if everyone else folded). */
  winners: number[];
  /** Chips each winner receives, parallel to `winners`. */
  shares: number[];
}

/**
 * Splits a finished hand's pots.
 *
 * `committed[seat]` is each seat's final contribution (uncalled bets already returned), `live[seat]`
 * is false for folded seats, and `values[seat]` is the evaluator value (higher wins) of each live seat's
 * best hand; it may be null when only one seat is live. `oddChipOrder` lists the seats clockwise
 * starting left of the button.
 *
 * Like pokerkit, live players who cannot win any pot (beaten in every pot they are eligible for) drop
 * out before the pots are built, which can merge two side pots into one; then each pot goes to the best
 * hands among its eligible seats, split evenly, and the whole remainder of an uneven split goes to the
 * first winner in `oddChipOrder` (the winner closest to the button's left).
 */
export function awardPots(
  committed: readonly number[],
  live: readonly boolean[],
  values: readonly (number | null)[],
  oddChipOrder: readonly number[],
): PotAward[] {
  let contenders = live.slice();
  if (contenders.filter(Boolean).length > 1) {
    const pots = buildPots(committed, committed, contenders);
    const best = pots.map((pot) => Math.max(...pot.eligible.map((seat) => values[seat]!)));
    contenders = contenders.map(
      (isLive, seat) => isLive && pots.some((pot, i) => pot.eligible.includes(seat) && values[seat]! >= best[i]),
    );
  }
  const rank = new Array<number>(live.length);
  oddChipOrder.forEach((seat, i) => (rank[seat] = i));
  return buildPots(committed, committed, contenders).map((pot) => {
    let winners: number[];
    // Cannot happen with legal play: the biggest contributor never folds.
    if (pot.eligible.length === 0) throw new Error(`Pot of ${pot.amount} has no eligible player`);
    if (pot.eligible.length === 1) winners = pot.eligible.slice();
    else {
      const top = Math.max(...pot.eligible.map((seat) => values[seat]!));
      winners = pot.eligible.filter((seat) => values[seat] === top);
    }
    winners.sort((a, b) => rank[a] - rank[b]);
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;
    return { ...pot, winners, shares: winners.map((_, i) => share + (i === 0 ? remainder : 0)) };
  });
}
