// Shared drill shapes. A question is fully defined by (type, seed, difficulty): regenerating with the
// same three gives the identical question. Difficulty is stored in every question's params.

export type DrillType =
  | "countOuts"
  | "outsToEquity"
  | "potOdds"
  | "mdf"
  | "comboCount"
  | "callEv"
  | "equityEstimate"
  | "speedCallFold";

export type Difficulty = 1 | 2 | 3;

export type Answer = number | "call" | "fold";

export type Unit = "outs" | "%" | "combos" | "bb" | "action";

export interface Question<P = unknown> {
  type: DrillType;
  /** `${type}:${seed}`. */
  id: string;
  /** What the user sees: self-contained and unambiguous. Cards are written like "A♥ K♦". */
  prompt: string;
  /** Structured inputs (cards as strings like "AhKd", numbers), enough to re-derive the answer. */
  params: P;
  /** Exact, unrounded answer. Percentages are percent numbers (28.571428..., not 0.2857). */
  answer: Answer;
  unit: Unit;
  /** Absolute tolerance the checker accepts (0 for exact integer and action answers). */
  tolerance: number;
  /** One line: the formula with the actual numbers and the result. */
  explanation: string;
}

export interface CheckResult {
  correct: boolean;
  /** The exact answer, formatted for display. */
  expected: string;
  /** Parsed input, or null if it couldn't be parsed. */
  given: number | string | null;
  /** given − answer, for numeric answers that parsed. */
  error?: number;
}
