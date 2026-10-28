// Answer checking: lenient parsing, absolute tolerance for numbers, equality for call/fold, and naming
// the mistake when a wrong answer matches one of the question's known wrong formulas.

import type { Answer, CheckResult, Question, Unit } from "./types";
import { round } from "./util";

// Guards against float noise at the exact tolerance boundary (e.g. 26 vs 25.000000000000004).
const EPS = 1e-9;

/** Parses "28.6", "28.6%", " 12 ", "-3.5 bb", "Call", "c", "f". Returns null if unparseable. */
export function parseInput(input: string, unit: Unit): number | "call" | "fold" | null {
  const s = input.trim().toLowerCase();
  if (unit === "action") {
    if (s === "c" || s === "call") return "call";
    if (s === "f" || s === "fold") return "fold";
    return null;
  }
  const n = s
    .replace(/−/g, "-") // Unicode minus
    .replace(/\s*(%|bb|outs?|combos?)$/, "")
    .trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(n) ? Number(n) : null;
}

export function formatAnswer(answer: Answer, unit: Unit): string {
  if (typeof answer === "string") return answer;
  if (unit === "%") return `${round(answer)}%`;
  if (unit === "bb") return `${round(answer)} bb`;
  return `${answer} ${unit}`;
}

export function check(question: Question, input: string): CheckResult {
  const expected = formatAnswer(question.answer, question.unit);
  const given = parseInput(input, question.unit);
  if (given === null) return { correct: false, expected, given: null };
  if (typeof question.answer === "string" || typeof given === "string") {
    return withMistake({ correct: given === question.answer, expected, given }, question);
  }
  const error = given - question.answer;
  const correct = Math.abs(error) <= question.tolerance + EPS;
  return withMistake({ correct, expected, given, error }, question);
}

/** Adds the first matching known mistake to a wrong result. */
function withMistake(result: CheckResult, question: Question): CheckResult {
  if (result.correct || result.given === null) return result;
  const given = result.given;
  const hit = question.mistakes.find((m) =>
    typeof m.value === "number" && typeof given === "number"
      ? Math.abs(given - m.value) <= m.tolerance + EPS
      : m.value === given,
  );
  return hit ? { ...result, mistake: hit.message } : result;
}
