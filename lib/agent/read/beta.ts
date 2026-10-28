// The Beta distribution's CDF and quantiles, exactly (to ~1e-12), with no dependencies. See README.md.
//
// The CDF of Beta(a, b) is the regularized incomplete beta function
//   I_x(a, b) = B(x; a, b) / B(a, b),   B(x; a, b) = ∫_0^x t^(a-1) (1-t)^(b-1) dt.
// We evaluate it with the standard continued fraction (Numerical Recipes §6.4, modified Lentz):
//   I_x(a, b) = x^a (1-x)^b / (a B(a, b)) · 1 / (1 + d1 / (1 + d2 / (1 + ...)))
//   d_{2m+1} = -(a+m)(a+b+m) x / ((a+2m)(a+2m+1)),   d_{2m} = m(b-m) x / ((a+2m-1)(a+2m)),
// which converges fast for x < (a+1)/(a+b+2); above that we use I_x(a, b) = 1 - I_{1-x}(b, a).
// log B(a, b) comes from a Lanczos log-gamma (g = 7, 9 terms; relative error ~1e-15).
//
// The quantile (inverse CDF) solves I_x(a, b) = p by bisection on [0, 1] polished with Newton steps
// (the density is the derivative), keeping every Newton step inside the current bracket, so it
// cannot diverge. It stops when the bracket or the Newton step is below 1e-15 relative to x (relative,
// because with a small shape parameter the quantile can be far below 1e-10).

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log Γ(x) for x > 0. */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x); // reflection
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log B(a, b) = log Γ(a) + log Γ(b) - log Γ(a + b). */
export const logBeta = (a: number, b: number): number => logGamma(a) + logGamma(b) - logGamma(a + b);

/** Continued fraction for I_x(a, b) (modified Lentz). */
function betaFraction(x: number, a: number, b: number): number {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let num = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + num * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + num / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    num = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + num * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + num / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

/** The regularized incomplete beta function I_x(a, b): the CDF of Beta(a, b) at x. a, b > 0. */
export function betaCdf(x: number, a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) throw new Error(`Beta parameters must be positive, got ${a}, ${b}`);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(x, a, b)) / a : 1 - (front * betaFraction(1 - x, b, a)) / b;
}

/** Density of Beta(a, b) at x in (0, 1). */
const betaPdf = (x: number, a: number, b: number): number =>
  Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBeta(a, b));

/** The p-quantile of Beta(a, b): the x with I_x(a, b) = p. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (!(p >= 0 && p <= 1)) throw new Error(`Probability must be in [0, 1], got ${p}`);
  if (p === 0) return 0;
  if (p === 1) return 1;
  if (p > 0.5) return 1 - betaQuantile(1 - p, b, a); // solve in the tail with the finer resolution
  let lo = 0;
  let hi = 1;
  let x = a / (a + b);
  for (let i = 0; i < 300 && hi - lo > 1e-15 * hi; i++) {
    const f = betaCdf(x, a, b) - p;
    if (f === 0) return x;
    if (f < 0) lo = x;
    else hi = x;
    const pdf = betaPdf(x, a, b);
    const newton = pdf > 0 && Number.isFinite(pdf) ? x - f / pdf : NaN;
    if (newton > lo && newton < hi) {
      if (Math.abs(newton - x) <= 1e-15 * x) return newton; // Newton has converged
      x = newton;
    } else x = (lo + hi) / 2;
  }
  return x;
}
