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
import { Blank, BoxButton, Line, Screen, Tag, TextButton } from "@/components/doc";

/**
 * Renders "A♥ K♦"-style cards inside text, kept in their own case and drawn in ink (suit carried by the glyph).
 * Display only: rank T is written 10, as on cards and in lessons (DESIGN.md §4.3).
 */
function CardText({ text }: { text: string }) {
  return (
    <>
      {text.split(/([2-9TJQKA][♣♦♥♠])/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="whitespace-nowrap normal-case">
            {part[0] === "T" ? `10${part.slice(1)}` : part}
            {"\uFE0E"}
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
    <>
      <Line className="uppercase">
        <span>Drill</span>
      </Line>
      <Line as="div" role="group" aria-label="Drill type">
        <span className="flex flex-wrap gap-x-[2ch]">
          {DRILL_TYPES.map((t) => (
            <TextButton
              key={t}
              pressed={t === type}
              onClick={() => {
                setType(t);
                next(t, difficulty);
              }}
            >
              {DRILL_LABELS[t]}
            </TextButton>
          ))}
        </span>
      </Line>
      <Line as="div" role="group" aria-label="Difficulty">
        <span className="uppercase">Difficulty</span>
        <span className="flex gap-x-[1ch]">
          {([1, 2, 3] as const).map((d) => (
            <TextButton
              key={d}
              pressed={d === difficulty}
              onClick={() => {
                setDifficulty(d);
                if (type) next(type, d);
              }}
            >
              {d}
            </TextButton>
          ))}
        </span>
      </Line>
      <Line as="p" className="uppercase">
        <span>Session:</span>
        <span>
          {tally.correct} / {tally.attempted} correct
          {tally.attempted > 0 && ` · ${(tally.ms / tally.attempted / 1000).toFixed(1)} s per answer`}
        </span>
      </Line>
      <Blank />

      {!question ? (
        <Screen aria-label="Question">
          <Line center className="uppercase text-muted">
            <span>Pick a drill type to start.</span>
          </Line>
        </Screen>
      ) : (
        <Screen as="section" aria-label="Question">
          <form onSubmit={onSubmit}>
            <Line center className="uppercase">
              <span>FIG. 1: {DRILL_LABELS[question.type]}</span>
            </Line>
            <Line as="p">
              <span className="max-w-[72ch]">
                <CardText text={question.prompt} />
              </span>
            </Line>
            <Blank />

            {isAction ? (
              <Line>
                <span className="flex flex-wrap gap-x-[2ch]">
                  {(["call", "fold"] as const).map((a) => (
                    <BoxButton key={a} disabled={!!result} onClick={() => answer(a)}>
                      {a}
                    </BoxButton>
                  ))}
                </span>
              </Line>
            ) : (
              <Line>
                <span className="flex flex-wrap items-baseline gap-x-[2ch]">
                  <span className="uppercase" aria-hidden="true">
                    Answer
                  </span>
                  <span className="flex items-baseline gap-x-[1ch]">
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      readOnly={!!result}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label="Your answer"
                      className="u w-[12ch]!"
                    />
                    <span className="text-muted uppercase">{question.unit}</span>
                  </span>
                  {!result && (
                    <button type="submit" className="apply cta">
                      Check
                    </button>
                  )}
                </span>
                {question.tolerance > 0 && <span className="text-muted uppercase">±{question.tolerance} accepted</span>}
              </Line>
            )}

            {unreadable && !result && (
              <Line as="p">
                <span>
                  <Tag>Couldn&apos;t read that. Type a number, like 28.6.</Tag>
                </span>
              </Line>
            )}

            {result && (
              <>
                <Blank />
                <Line as="p" className="uppercase">
                  <span className={result.correct ? "text-green" : "text-red"}>
                    {result.correct ? "Correct" : "Wrong"}
                    {" — "}answer: {result.expected}
                  </span>
                </Line>
                <Line as="p">
                  <span className="max-w-[72ch] text-muted">
                    <CardText text={question.explanation} />
                  </span>
                </Line>
                <Blank />
                <Line>
                  <button ref={nextRef} type="submit" className="apply cta">
                    Next (Enter)
                  </button>
                </Line>
              </>
            )}
          </form>
        </Screen>
      )}
    </>
  );
}
