// The precomputed 169x169 heads-up preflop matrix: for SB class i and BB class j (HAND_CLASSES order),
//   pairs[i*169 + j]  = n_ij, the number of card-disjoint (SB combo, BB combo) pairs, and
//   equity[i*169 + j] = E_ij, SB's all-in equity averaged over those pairs (ties count half).
// Built offline by scripts/build-preflop-matrix.ts with exact enumeration; never recomputed at runtime.
//
// Storage (data/preflop-matrix.ts): the upper triangle i <= j, row-major, as base64 strings:
// equity as little-endian Uint32 E * 1e9, pairs as Uint8. The lower triangle follows from
// E_ji = 1 - E_ij and n_ji = n_ij.

import { HAND_CLASSES } from "../poker/combinatorics";
import { PREFLOP_MATRIX_DATA } from "./data/preflop-matrix";

export const CLASS_COUNT = 169;
/** Sum over all class pairs of n_ij: 1326 SB combos x 1225 disjoint BB combos. */
export const TOTAL_COMBO_PAIRS = 1326 * 1225;
export const TRIANGLE = (CLASS_COUNT * (CLASS_COUNT + 1)) / 2;

export interface PreflopMatrixData {
  /** Comma-separated class names, to catch a class-order mismatch. */
  classOrder: string;
  equityScale: number;
  /** base64 of Uint32 little-endian round(E_ij * equityScale), upper triangle i <= j. */
  equity: string;
  /** base64 of Uint8 n_ij, upper triangle i <= j. */
  pairs: string;
  note: string;
}

export interface PreflopMatrix {
  /** E_ij, full 169x169 row-major: SB class i (row) vs BB class j (column). */
  equity: Float64Array;
  /** n_ij, full 169x169 row-major. */
  pairs: Float64Array;
}

export const classOrder = (): string => HAND_CLASSES.map((h) => h.name).join(",");

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Decodes stored data into full matrices. Exported for tests; the app uses preflopMatrix(). */
export function decodePreflopMatrix(data: PreflopMatrixData): PreflopMatrix {
  if (data.classOrder !== classOrder()) throw new Error("Preflop matrix was built with a different class order");
  const eq = fromBase64(data.equity), pr = fromBase64(data.pairs);
  if (eq.length !== 4 * TRIANGLE || pr.length !== TRIANGLE) throw new Error("Preflop matrix data has the wrong size");
  const view = new DataView(eq.buffer, eq.byteOffset, eq.byteLength);
  const equity = new Float64Array(CLASS_COUNT * CLASS_COUNT), pairs = new Float64Array(CLASS_COUNT * CLASS_COUNT);
  let t = 0;
  for (let i = 0; i < CLASS_COUNT; i++) {
    for (let j = i; j < CLASS_COUNT; j++, t++) {
      const e = view.getUint32(4 * t, true) / data.equityScale;
      equity[i * CLASS_COUNT + j] = e;
      equity[j * CLASS_COUNT + i] = 1 - e;
      pairs[i * CLASS_COUNT + j] = pairs[j * CLASS_COUNT + i] = pr[t];
    }
  }
  return { equity, pairs };
}

let cached: PreflopMatrix | undefined;

/** The matrix, decoded once (a few ms) and shared. Treat the arrays as read-only. */
export function preflopMatrix(): PreflopMatrix {
  return (cached ??= decodePreflopMatrix(PREFLOP_MATRIX_DATA));
}
