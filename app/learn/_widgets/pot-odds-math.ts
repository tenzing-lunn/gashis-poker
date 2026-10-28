// Pot odds and the EV of a call for module 3. P = pot before the bet, B = the bet you face,
// e = your equity as a fraction. No more betting after the call.

/** Equity a call needs to break even: B / (P + 2B). */
export const requiredEquity = (P: number, B: number): number => B / (P + 2 * B);

/** EV of calling, relative to folding: e(P + B) - (1 - e)B. */
export const callEV = (e: number, P: number, B: number): number => e * (P + B) - (1 - e) * B;

/** Pot odds "x to 1": what you can win (P + B) per unit you risk (B). */
export const potOddsRatio = (P: number, B: number): number => (P + B) / B;

/** Extra chips you must win later when you hit, to make the call break even: B(1 - e)/e - (P + B). */
export const impliedOddsNeeded = (e: number, P: number, B: number): number => (B * (1 - e)) / e - (P + B);

/** Unseen cards from your own view (module 2): 46 on the turn (one card to come), 47 on the flop (two to come). */
export const unseenFor = (toCome: 1 | 2): number => (toCome === 1 ? 46 : 47);

/**
 * Equity from outs, assuming every out wins and nothing else does: outs / U for one card, 1 - (U-o)/U * (U-1-o)/(U-1)
 * for two. The same formulas as outs-math.ts `oneCard` / `twoCards`, repeated here because importing that file pulls
 * in the hand evaluator, whose lookup tables take ~40 ms to build, on a page that never evaluates a hand.
 */
export function outsEquity(outs: number, toCome: 1 | 2): number {
  const u = unseenFor(toCome);
  return toCome === 1 ? outs / u : 1 - ((u - outs) / u) * ((u - 1 - outs) / (u - 1));
}
