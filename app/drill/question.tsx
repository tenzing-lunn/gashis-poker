"use client";

import { useId, type CSSProperties, type FormEvent, type Ref } from "react";
import { DRILL_LABELS, type Difficulty } from "@/lib/drills/meta";
import { ROUND_MS } from "@/lib/drills/round";
import type { CheckResult, Question } from "@/lib/drills/types";
import { Legend, Line, Tag } from "@/components/doc";
import { cx } from "@/components/doc/cx";
import { CardText } from "./card-text";
import { MOBILE_LINES } from "./line-budget";
import { LessonLink } from "./picker";
import { clockText } from "./use-round-clock";

const ACTIONS = [
  { value: "call", label: "[C] Call" },
  { value: "fold", label: "[F] Fold" },
] as const;

export type Pick = (typeof ACTIONS)[number]["value"];

type QuestionBodyProps = {
  question: Question;
  difficulty: Difficulty;
  /** 1-based number of this question in the round. */
  number: number;
  /** Milliseconds left in the round. */
  left: number;
  input: string;
  result: CheckResult | null;
  picked: Pick | null;
  unreadable: boolean;
  onInput: (value: string) => void;
  onAnswer: (value: string) => void;
  onNext: () => void;
  formRef: Ref<HTMLFormElement>;
  fieldRef: Ref<HTMLInputElement>;
  nextRef: Ref<HTMLButtonElement>;
};

/**
 * One question inside the round's band. Everything above the answer line has a fixed height per drill type
 * (fixed fact count, one ask line, one hint line; on phones a reserved line count per type and difficulty,
 * see line-budget.ts), and the feedback below it has a reserved height, so the CHECK / NEXT button never
 * moves between questions.
 */
export function QuestionBody({
  question,
  difficulty,
  number,
  left,
  input,
  result,
  picked,
  unreadable,
  onInput,
  onAnswer,
  onNext,
  formRef,
  fieldRef,
  nextRef,
}: QuestionBodyProps) {
  const ids = useId();
  const isAction = question.unit === "action";
  const showsBb = question.unit === "bb" || question.facts.some((f) => /\bbb\b/i.test(f.value));
  const [factLines, askLines] = MOBILE_LINES[question.type][difficulty - 1];
  const progress = (
    <>
      Q {number} ·{" "}
      <span role="timer" aria-live="off">
        {clockText(left)}
      </span>
    </>
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (result) onNext();
    else onAnswer(input);
  }

  return (
    // Focused (not CALL) when a call/fold question opens, so a stray Enter answers nothing; Tab reaches CALL.
    <form ref={formRef} tabIndex={-1} onSubmit={onSubmit} className="outline-none">
      <Line center className="uppercase">
        <span>
          FIG. 1: {DRILL_LABELS[question.type]}
          {/* Phones: Q and clock move onto the bar line below, so this line never wraps. */}
          <span className="max-[679px]:hidden"> · {progress}</span>
          <span className="sr-only" aria-live="polite">
            {left <= 60_000 ? "One minute left." : ""}
          </span>
        </span>
      </Line>
      <div className="l">
        <span className="uppercase min-[680px]:hidden">{progress}</span>
        <span aria-hidden="true" className="relative flex-1 self-center border-b border-dotted border-muted">
          <span
            className="absolute -top-px left-0 h-[3px] bg-ink forced-color-adjust-none forced-colors:bg-[CanvasText]"
            style={{ width: `${(100 * left) / ROUND_MS}%` }}
          />
        </span>
      </div>

      {/* Phones: the label column fits the label and the value wraps beside it; the block reserves the most
          lines this type and difficulty can take (line-budget.ts), so values that wrap don't move the answer. */}
      <div
        className="max-[679px]:min-h-[calc(var(--lh)*var(--lines)*1em)]"
        style={{ "--lines": factLines } as CSSProperties}
      >
        {question.facts.map((f, i) => (
          <div
            key={i}
            className="l tx max-w-[60ch] grid-cols-[minmax(0,1fr)_auto]! max-[679px]:grid-cols-[auto_minmax(0,1fr)]!"
          >
            <span>{f.label}</span>
            <span className="text-right normal-case tabular-nums">
              <CardText text={f.value} />
            </span>
          </div>
        ))}
      </div>
      {/* Ask and hint share a block of at least 3 lines (the longest ask plus hint fits at desktop width). On
          phones the block reserves the most lines this type and difficulty can take, and mdf's LEARN link wraps
          onto a line of its own instead of squeezing the ask. */}
      <div
        className="l min-h-[calc(var(--lh)*3em)]! max-[679px]:min-h-[calc(var(--lh)*var(--lines)*1em)]!"
        style={{ "--lines": askLines } as CSSProperties}
      >
        <p className="min-w-0 flex-[1_1_0] max-[679px]:basis-full">
          <CardText text={question.ask} />
          {question.hint && (
            <span className="block text-muted">
              <CardText text={question.hint} />
            </span>
          )}
        </p>
        {question.type === "mdf" && <LessonLink type="mdf" />}
      </div>

      {isAction ? (
        <Line>
          <span className="flex flex-wrap gap-x-[2ch]">
            {ACTIONS.map(({ value, label }) => {
              const mine = picked === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={result ? mine : undefined}
                  aria-disabled={result && mine ? true : undefined}
                  disabled={!!result && !mine}
                  className={cx(
                    "apply",
                    mine && result && "cursor-default text-paper!",
                    mine && result && (result.correct ? "border-green! bg-green!" : "border-red! bg-red!"),
                    // Forced colors drop the fill: the pick inverts like any pressed control (the verdict word stays).
                    mine &&
                      result &&
                      "forced-colors:border-[Highlight]! forced-colors:bg-[Highlight]! forced-colors:text-[HighlightText]! forced-colors:forced-color-adjust-none",
                  )}
                  onClick={() => onAnswer(value)}
                >
                  {label}
                </button>
              );
            })}
            {/* Always drawn (hidden until answered) so answering doesn't rewrap this line. */}
            <button ref={nextRef} type="submit" disabled={!result} className={cx("apply cta", !result && "invisible")}>
              Next →
            </button>
          </span>
          {showsBb && <span className="text-muted uppercase">BB = big blinds</span>}
        </Line>
      ) : (
        <Line>
          <span className="flex flex-wrap items-baseline gap-x-[2ch]">
            <span className="flex items-baseline gap-x-[1ch]">
              <span className="uppercase max-[679px]:hidden" aria-hidden="true">
                Answer
              </span>
              <input
                ref={fieldRef}
                value={input}
                onChange={(e) => {
                  // Once graded the field keeps its value (and focus, so a soft keyboard stays up for the next one).
                  if (result) return;
                  onInput(e.target.value.replace(question.unit === "bb" ? /[^0-9.,-]/g : /[^0-9.,]/g, ""));
                }}
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Your answer, in ${question.unit}`}
                aria-invalid={unreadable || undefined}
                aria-describedby={cx(question.tolerance > 0 && `${ids}-tol`, unreadable && `${ids}-err`) || undefined}
                className="u w-[8ch]!"
              />
              <span className="text-muted uppercase">{question.unit}</span>
            </span>
            {question.tolerance > 0 && (
              <span id={`${ids}-tol`} className="text-muted uppercase">
                ±{question.tolerance} accepted
              </span>
            )}
            {/* Both labels share one grid cell, so the button is as wide as the longer one and never wraps. */}
            <button ref={nextRef} type="submit" className="apply cta inline-grid! whitespace-nowrap text-center">
              <span className={cx("col-start-1 row-start-1", result && "invisible")}>Check</span>
              <span className={cx("col-start-1 row-start-1", !result && "invisible")}>Next →</span>
            </button>
          </span>
          {showsBb && <span className="text-muted uppercase">BB = big blinds</span>}
        </Line>
      )}

      {/* Reserved height: the verdict line, then mistake, worked explanation and estimate in a block of at least
          4 lines. Both are always drawn, so line numbers stay put; only an unusually long block grows downward. */}
      <div aria-live="polite">
        <Line as="p" className="uppercase">
          {unreadable && !result ? (
            <span>
              <Tag id={`${ids}-err`}>TYPE A NUMBER, E.G. 28.6</Tag>
            </span>
          ) : result ? (
            <span className={result.correct ? "text-green" : "text-red"}>
              {result.correct ? "Correct" : "Wrong"} — answer: {result.expected}
            </span>
          ) : null}
        </Line>
        <div className="l min-h-[calc(var(--lh)*4em)]!">
          {result && (
            <span className="max-w-[72ch]">
              {result.mistake && (
                <span className="block">
                  <CardText text={result.mistake} />
                </span>
              )}
              <span className="block text-muted">
                <CardText text={question.explanation} />
              </span>
              {question.estimate && (
                <span className="block text-muted">
                  <CardText text={question.estimate} />
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      <Legend className="keys uppercase">
        <span>
          Keys: {isAction ? "C call · F fold · Enter next" : "Enter check / next"} · Esc end round
        </span>
      </Legend>
    </form>
  );
}
