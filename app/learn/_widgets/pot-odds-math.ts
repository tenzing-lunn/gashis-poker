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
