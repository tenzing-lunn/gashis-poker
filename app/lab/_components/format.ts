// Number formatting for the Lab. Fixed "en-US" so server and client render identical text (no hydration drift).

const cache = new Map<number, Intl.NumberFormat>();
function nf(digits: number): Intl.NumberFormat {
  let f = cache.get(digits);
  if (!f) cache.set(digits, (f = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f;
}

const MINUS = "−";

/** 12,345.68 */
export function fmt(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  const s = nf(digits).format(Math.abs(x));
  return x < 0 && s.replace(/[0.,]/g, "") !== "" ? MINUS + s : s;
}

/** +1.23 / −1.23 / 0.00 */
export function fmtSigned(x: number, digits = 2): string {
  const s = fmt(x, digits);
  return x > 0 && s.replace(/[0.,]/g, "") !== "" ? "+" + s : s;
}

/** 0.1234 -> "12.3%" */
export const pct = (x: number, digits = 1): string => fmt(100 * x, digits) + "%";

/**
 * Scientific notation split for rendering with a real superscript: { mantissa: "2.14", exp: "−6" }
 * (exp null when plain decimals read better, for 0.001 <= |x| < 1000).
 */
export function sciParts(x: number, digits = 2): { mantissa: string; exp: string | null } {
  if (!Number.isFinite(x)) return { mantissa: "—", exp: null };
  if (x === 0) return { mantissa: "0", exp: null };
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e3) return { mantissa: fmt(x, Math.max(digits, a < 0.01 ? 4 : a < 1 ? 3 : 2)), exp: null };
  const [m, e] = x.toExponential(digits).split("e");
  return { mantissa: m.replace("-", MINUS), exp: String(Number(e)).replace("-", MINUS) };
}

/** Exponent of a power of ten as display text: 1e-3 -> "−3". */
export const decadeExponent = (v: number): string => String(Math.round(Math.log10(v))).replace("-", MINUS);

/** Axis labels for round numbers: 1, 10, 100, 1k, 10k, 100k, 1M */
export function compact(x: number): string {
  if (x >= 1e6) return `${fmt(x / 1e6, x % 1e6 ? 1 : 0)}M`;
  if (x >= 1e3) return `${fmt(x / 1e3, x % 1e3 ? 1 : 0)}k`;
  return String(x);
}

export const ms = (t: number): string => (t < 10 ? `${fmt(t, 1)} ms` : `${fmt(t, 0)} ms`);
