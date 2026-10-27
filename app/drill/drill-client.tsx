"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  DRILL_LABELS,
  DRILL_TYPES,
  check,
  generate,
  type CheckResult,
  type Difficulty,
  type DrillType,
  type Question,
} from "@/lib/drills";

/** Renders "A♥ K♦"-style cards inside text, with hearts and diamonds in red. */
function CardText({ text }: { text: string }) {
  return (
    <>
      {text.split(/([2-9TJQKA][♣♦♥♠])/).map((part, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className={`font-mono font-semibold ${part.endsWith("♥") || part.endsWith("♦") ? "text-red-600" : ""}`}
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// Event-handler-only helpers (kept outside the component: they are impure).
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const now = () => Date.now();

const pill = (active: boolean) =>
  `rounded border px-3 py-1.5 text-sm ${
    active ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
  }`;

export default function DrillClient() {
  const [type, setType] = useState<DrillType | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [question, setQuestion] = useState<Question | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [tally, setTally] = useState({ attempted: 0, correct: 0, ms: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Questions are only generated in event handlers (random seed), never during render: no hydration mismatch.
  function next(t: DrillType, d: Difficulty) {
    setQuestion(generate(t, randomSeed(), d));
    setInput("");
    setResult(null);
    setUnreadable(false);
    setStartedAt(now());
  }

  function answer(value: string) {
    if (!question || result) return;
    const r = check(question, value);
    // A typo shouldn't cost the question: ask again instead of grading it.
    if (r.given === null) {
      setUnreadable(true);
      return;
    }
    setUnreadable(false);
    setResult(r);
    setTally((s) => ({
      attempted: s.attempted + 1,
      correct: s.correct + (r.correct ? 1 : 0),
      ms: s.ms + (now() - startedAt),
    }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (result && type) next(type, difficulty);
    else if (input.trim()) answer(input);
  }

  useEffect(() => {
    if (result) nextRef.current?.focus();
    else inputRef.current?.focus();
  }, [question, result]);

  const isAction = question?.unit === "action";

  return (
    <div className="mt-6 space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {DRILL_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={pill(t === type)}
              onClick={() => {
                setType(t);
                next(t, difficulty);
              }}
            >
              {DRILL_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Difficulty</span>
          {([1, 2, 3] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={pill(d === difficulty)}
              onClick={() => {
                setDifficulty(d);
                if (type) next(type, d);
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </section>

      <p className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
        Session: {tally.correct} / {tally.attempted} correct
        {tally.attempted > 0 && ` · ${(tally.ms / tally.attempted / 1000).toFixed(1)} s per answer`}
      </p>

      {!question ? (
        <p className="rounded border border-dashed border-zinc-300 p-6 text-zinc-500 dark:border-zinc-700">
          Pick a drill type to start.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 rounded border border-zinc-300 p-5 dark:border-zinc-700">
          <p className="text-lg leading-relaxed">
            <CardText text={question.prompt} />
          </p>

          {isAction ? (
            <div className="flex gap-3">
              {(["call", "fold"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={!!result}
                  onClick={() => answer(a)}
                  className="rounded bg-zinc-900 px-5 py-2 font-medium capitalize text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-black"
                >
                  {a}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                readOnly={!!result}
                inputMode="decimal"
                autoComplete="off"
                aria-label="Your answer"
                className="w-40 rounded border border-zinc-300 bg-transparent px-3 py-2 tabular-nums dark:border-zinc-700"
              />
              <span className="text-zinc-500">{question.unit}</span>
              {!result && (
                <button type="submit" className="rounded bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-black">
                  Check
                </button>
              )}
              {question.tolerance > 0 && <span className="text-sm text-zinc-500">±{question.tolerance} accepted</span>}
            </div>
          )}

          {unreadable && !result && (
            <p className="text-sm text-amber-600">Couldn&apos;t read that. Type a number, like 28.6.</p>
          )}

          {result && (
            <div className="space-y-2">
              <p className={`font-semibold ${result.correct ? "text-green-600" : "text-red-600"}`}>
                {result.correct ? "Correct" : "Wrong"}
                {" — "}answer: {result.expected}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                <CardText text={question.explanation} />
              </p>
              <button
                ref={nextRef}
                type="submit"
                className="rounded border border-zinc-900 px-4 py-2 dark:border-zinc-100"
              >
                Next (Enter)
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
