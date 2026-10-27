"use client";

import { useId, useState, type ReactNode } from "react";
import { Blank, Choice, Line } from "@/components/doc";

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
  /** The explanation, revealed after an attempt. */
  children: ReactNode;
}

/** The interactive check at the end of a lesson: answer first, then see the working. */
export function Check({ question, choices, answer, tolerance = 0, unit, children }: CheckProps) {
  const id = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState<number | null>(null);

  const value = choices ? picked : submitted;
  const correct = value !== null && (choices ? value === answer : Math.abs(value - answer) <= tolerance + 1e-9);

  return (
    <section>
      <Blank />
      <Line as="div">
        <span className="min-w-0 max-w-[72ch]">{question}</span>
      </Line>
      {choices ? (
        <div role="radiogroup" aria-label="Choices">
          {choices.map((c, i) => (
            <Line key={c}>
              <Choice
                name={id}
                checked={picked === i}
                onChange={() => setPicked(i)}
                className={`normal-case! ${picked === i ? (i === answer ? "text-green" : "text-red") : ""}`}
              >
                {c}
              </Choice>
            </Line>
          ))}
        </div>
      ) : (
        <form
          className="l"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(text.replace(/[%,\s]/g, ""));
            if (text.trim() !== "" && Number.isFinite(n)) setSubmitted(n);
          }}
        >
          <span className="flex flex-wrap items-baseline gap-x-[2ch]">
            <span className="flex items-baseline gap-x-[1ch]">
              <label htmlFor={id} className="sr-only">
                Your answer
              </label>
              <input id={id} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} className="u w-[12ch]! tabular-nums" />
              {unit && <span className="text-muted">{unit}</span>}
            </span>
            <button type="submit" className="apply cta">
              Check
            </button>
          </span>
        </form>
      )}
      {value !== null && (
        <div>
          <Line as="p" className="uppercase">
            <span className={correct ? "text-green" : "text-red"}>
              {correct ? "Correct." : choices ? "Not quite." : `Not quite. The answer is ${answer}${unit ? ` ${unit}` : ""}.`}
            </span>
          </Line>
          {children}
        </div>
      )}
    </section>
  );
}
