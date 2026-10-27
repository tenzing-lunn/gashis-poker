// Geometric bet sizing: the single pot fraction f that, bet and called on each of n streets,
// puts exactly the effective stack S into a pot that starts at P.
// Each bet-and-call turns pot p into p + 2fp = p(1 + 2f), so after n streets the pot is P(1 + 2f)^n,
// and that must equal P + 2S. Solving: f = ((1 + 2S/P)^(1/n) - 1) / 2.

export interface StreetRow {
  bet: number;
  potAfter: number;
  stackAfter: number;
}

export function geometricFraction(pot: number, stack: number, streets: number): number {
  return (Math.pow(1 + (2 * stack) / pot, 1 / streets) - 1) / 2;
}

export function geometricPlan(pot: number, stack: number, streets: number): { fraction: number; rows: StreetRow[] } {
  const fraction = geometricFraction(pot, stack, streets);
  const rows: StreetRow[] = [];
  let p = pot, s = stack;
  for (let i = 0; i < streets; i++) {
    const bet = i === streets - 1 ? s : fraction * p; // last bet is the rest of the stack (same value, no rounding drift)
    p += 2 * bet;
    s -= bet;
    rows.push({ bet, potAfter: p, stackAfter: Math.max(0, s) });
  }
  return { fraction, rows };
}
