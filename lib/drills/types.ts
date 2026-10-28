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

/** One record line shown above the question, e.g. {label: "Pot", value: "60 bb"}. */
export interface Fact {
  label: string;
  value: string;
}

/** A known wrong answer: what a common wrong formula gives, and the message naming it. */
export interface Mistake {
  value: number | "call" | "fold";
  /** Absolute tolerance for numeric values. */
  tolerance: number;
  message: string;
}

export interface Question<P = unknown> {
  type: DrillType;
  /** `${type}:${seed}`. */
  id: string;
  /** Plain-text form of `facts` + `ask`, one per line: self-contained and unambiguous. */
  prompt: string;
  /**
   * Record lines shown above the question, in order. The count is fixed per drill type (see each
   * generator). Cards are written like "A♥ K♦" (T for ten).
   */
  facts: Fact[];
  /** One short question line, sentence case, no formula give-away. */
  ask: string;
  /** Formula hint shown muted under the question: difficulty 1 formula drills only. */
  hint?: string;
  /** equityEstimate only: how to estimate it at the table, shown after answering. */
  estimate?: string;
  /** Common wrong answers, each outside the correct tolerance band and apart from those with other messages. */
  mistakes: Mistake[];
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
  /** Set only when wrong and the answer matches a known mistake (first match wins). */
  mistake?: string;
}
