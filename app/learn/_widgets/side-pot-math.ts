// Main pot and side pots from each player's total chips put in during a hand.

export interface Contribution {
  name: string;
  /** Total chips this player put in over the whole hand. */
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Players who can win this pot (did not fold and put in at least this layer). */
  eligible: string[];
}

export interface PotSplit {
  pots: Pot[];
  /** Chips nobody matched, handed back to the one player who put them in. */
  returned: { name: string; amount: number } | null;
}

/**
 * First, chips that nobody else matched (an uncalled bet) go back to the player who put them in.
 * Then the pots are built layer by layer. Each distinct amount put in by a player still in the hand
 * is a layer boundary; a layer holds every player's chips between the previous boundary and this
 * one, and only the players still in the hand who reached the boundary can win it. Folded players'
 * chips stay in the pots, but they cannot win them.
 */
export function splitPots(players: readonly Contribution[]): PotSplit {
  const adj = players.map((p) => ({ ...p, amount: Math.max(0, p.amount) }));
  let returned: PotSplit["returned"] = null;
  const byAmount = [...adj].sort((a, b) => b.amount - a.amount);
  const top = byAmount[0];
  if (top && !top.folded) {
    const second = byAmount[1]?.amount ?? 0;
    if (top.amount > second) {
      returned = { name: top.name, amount: top.amount - second };
      top.amount = second;
    }
  }

  const live = adj.filter((p) => !p.folded && p.amount > 0);
  const levels = [...new Set(live.map((p) => p.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of adj) amount += Math.max(0, Math.min(p.amount, level) - prev);
    pots.push({ amount, eligible: live.filter((p) => p.amount >= level).map((p) => p.name) });
    prev = level;
  }
  // Chips a folded player put in above the highest live amount (rare) join the last pot.
  const extra = adj.reduce((s, p) => s + Math.max(0, p.amount - prev), 0);
  if (extra > 0 && pots.length) pots[pots.length - 1].amount += extra;
  return { pots, returned };
}
