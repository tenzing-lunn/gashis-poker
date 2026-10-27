"use client";

import { useId, useState, type ReactNode } from "react";

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
    <section className="my-8 rounded-lg border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">Check yourself</p>
      <div className="mb-3 [&>p]:my-1">{question}</div>
      {choices ? (
        <div role="radiogroup" className="flex flex-col gap-2">
          {choices.map((c, i) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={picked === i}
              onClick={() => setPicked(i)}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                picked === i
                  ? i === answer
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                    : "border-red-400 bg-red-50 dark:bg-red-950/40"
                  : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(text.replace(/[%,\s]/g, ""));
            if (text.trim() !== "" && Number.isFinite(n)) setSubmitted(n);
          }}
        >
          <label htmlFor={id} className="sr-only">
            Your answer
          </label>
          <input
            id={id}
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-28 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono tabular-nums dark:border-zinc-700 dark:bg-zinc-950"
          />
          {unit && <span className="text-sm text-zinc-500">{unit}</span>}
          <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            Check
          </button>
        </form>
      )}
      {value !== null && (
        <div className="mt-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
          <p className={`font-semibold ${correct ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {correct ? "Correct." : choices ? "Not quite." : `Not quite. The answer is ${answer}${unit ? ` ${unit}` : ""}.`}
          </p>
          <div className="mt-1 [&>p]:my-1">{children}</div>
        </div>
      )}
    </section>
  );
}
