"use client";

import { use, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Blank, Choice, Line, TextButton } from "@/components/doc";
import { LessonSlug, recordCorrect, registerCheck } from "./progress";

interface CheckProps {
  question: ReactNode;
  /** Multiple choice: the options, with `answer` the index of the right one. */
  choices?: string[];
  /** Index into `choices`, or the numeric answer when there are no choices. */
  answer: number;
  /** Numeric answers: accepted distance from `answer`. */
  tolerance?: number;
  /** Shown after the input, e.g. "%" or "combos". */
  unit?: string;
  /** Shown after the first wrong answer, e.g. "Did you use P + B instead of P + 2B?" */
  hint?: ReactNode;
  /** The explanation, revealed once the check is solved, missed twice, or given up. */
  children: ReactNode;
}

/** The interactive check at the end of a lesson: two tries, then see the working. */
export function Check({ question, choices, answer, tolerance = 0, unit, hint, children }: CheckProps) {
  const id = useId();
  const slug = use(LessonSlug);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [misses, setMisses] = useState<number[]>([]);
  const [solved, setSolved] = useState(false);
  const [shown, setShown] = useState(false);

  // Stable per check within a lesson: the question when it is text, else the choices, plus the answer.
  const key = `${answer}:${typeof question === "string" ? question : (choices?.join("|") ?? "")}`;
  useEffect(() => {
    if (slug) registerCheck(slug, key);
  }, [slug, key]);

  const revealed = solved || shown || misses.length >= 2;
  const answerText = choices ? choices[answer] : `${answer}${unit ? ` ${unit}` : ""}`;

  function attempt(value: number) {
    if (revealed) return;
    const right = choices ? value === answer : Math.abs(value - answer) <= tolerance + 1e-9;
    if (right) {
      setSolved(true);
      if (slug) recordCorrect(slug, key);
      feedbackRef.current?.focus();
    } else if (!misses.includes(value)) {
      // Resubmitting a value already marked wrong is a no-op, so it cannot use up the retry.
      setMisses([...misses, value]);
      // The second miss disables Check; keep focus on the answer that replaces it.
      if (misses.length >= 1) feedbackRef.current?.focus();
    }
  }

  let feedback: ReactNode = null;
  if (solved) feedback = <span className="text-green">Correct.</span>;
  else if (misses.length >= 2) feedback = <span className="text-red">Not quite. The answer is {answerText}.</span>;
  else if (shown) feedback = <span>The answer is {answerText}.</span>;
  else if (misses.length === 1) feedback = <span className="text-red">Not quite. Try again.</span>;

  return (
    <section>
      <Blank />
      <Line as="div">
        <span className="min-w-0 max-w-[72ch]">{question}</span>
      </Line>
      {choices ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (picked !== null) attempt(picked);
          }}
        >
          <div role="radiogroup" aria-label="Choices">
            {choices.map((c, i) => {
              const mark = revealed && i === answer ? "text-green" : misses.includes(i) ? "text-red" : "";
              return (
                <Line key={c}>
                  <Choice
                    name={id}
                    checked={picked === i}
                    onChange={() => {
                      if (!revealed) setPicked(i);
                    }}
                    className={`normal-case! ${mark}`}
                  >
                    {c}
                  </Choice>
                </Line>
              );
            })}
          </div>
          <Line>
            <button type="submit" className="apply cta" disabled={revealed}>
              Check
            </button>
          </Line>
        </form>
      ) : (
        <form
          className="l"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(text.replace(/[%,\s]/g, ""));
            if (text.trim() !== "" && Number.isFinite(n)) attempt(n);
          }}
        >
          <span className="flex flex-wrap items-baseline gap-x-[2ch]">
            <span className="flex items-baseline gap-x-[1ch]">
              <label htmlFor={id} className="sr-only">
                Your answer
              </label>
              <input
                id={id}
                inputMode="decimal"
                value={text}
                readOnly={revealed}
                onChange={(e) => setText(e.target.value)}
                className="u w-[12ch]! tabular-nums"
              />
              {unit && <span className="text-muted">{unit}</span>}
            </span>
            <button type="submit" className="apply cta" disabled={revealed}>
              Check
            </button>
          </span>
        </form>
      )}
      <div ref={feedbackRef} tabIndex={-1} aria-live="polite" className="outline-none">
        {feedback && (
          <Line as="p" className="uppercase">
            {feedback}
          </Line>
        )}
        {hint && !revealed && misses.length === 1 && (
          <Line as="p">
            <span className="min-w-0 max-w-[72ch]">{hint}</span>
          </Line>
        )}
      </div>
      {!revealed && (
        <Line>
          <TextButton
            className="uppercase"
            onClick={() => {
              setShown(true);
              feedbackRef.current?.focus();
            }}
          >
            [Show answer]
          </TextButton>
        </Line>
      )}
      {revealed && <div>{children}</div>}
    </section>
  );
}
