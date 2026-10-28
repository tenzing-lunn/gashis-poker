"use client";

import type { Ref } from "react";
import { DIFFICULTY_LABELS, DRILL_LABELS, type Difficulty, type DrillType } from "@/lib/drills/meta";
import { summarize, type RoundAnswer } from "@/lib/drills/round";
import { Blank, Legend, Line, Tx } from "@/components/doc";
import { CardText } from "./card-text";

// Record values sit flush right so numbers of different length line up on their last digit.
const RIGHT = "[&_.tx>:last-child]:text-right [&_.tx>:last-child]:tabular-nums";

type SummaryProps = {
  type: DrillType;
  difficulty: Difficulty;
  answers: RoundAnswer[];
  /** Best score before this round (null when there is none or storage is blocked). */
  best: number | null;
  /** A RETRY MISSES round: its score is not a best. */
  retry: boolean;
  next: DrillType;
  headingRef: Ref<HTMLHeadingElement>;
  onAgain: () => void;
  onRetry: (misses: RoundAnswer[]) => void;
  onNext: () => void;
};

/** End-of-round record: score, accuracy, median time, best, and the misses with both answers. */
export function Summary({ type, difficulty, answers, best, retry, next, headingRef, onAgain, onRetry, onNext }: SummaryProps) {
  const s = summarize(answers);
  const isBest = !retry && s.correct > 0 && (best === null || s.correct > best);
  return (
    <>
      {/* Focused when the round ends (not AGAIN, so an Enter held from the last answer can't skip the record). */}
      <h2 ref={headingRef} tabIndex={-1} className="l c uppercase outline-none">
        <span>FIG. 1: {DRILL_LABELS[type]} · round over</span>
      </h2>
      <Blank />
      <div className={`max-w-[60ch] ${RIGHT}`}>
        <Tx label="Score" value={s.correct} />
        <Tx label="Attempted" value={s.attempted} />
        <Tx label="Accuracy" value={`${Math.round(s.accuracy)}%`} />
        <Tx label="Median time" value={s.medianMs === null ? "--" : `${(s.medianMs / 1000).toFixed(1)} s`} />
        <Tx
          label={`Best, ${DIFFICULTY_LABELS[difficulty]}`}
          value={isBest ? `${s.correct} new` : best === null ? "--" : best}
        />
      </div>
      {s.misses.length > 0 && (
        <>
          <Blank />
          <div className={`max-w-[60ch] ${RIGHT}`}>
            <Tx
              label="Missed"
              value={
                <span className="flex justify-between gap-x-[2ch] text-muted">
                  <span>Yours</span>
                  <span>Right</span>
                </span>
              }
            />
            {s.misses.map((m, i) => (
              <Tx
                key={i}
                label={
                  <>
                    {m.facts.map((f, j) => (
                      <span key={j}>
                        {j > 0 && " · "}
                        {f.label}{" "}
                        <span className="normal-case">
                          <CardText text={f.value} />
                        </span>
                      </span>
                    ))}
                    {/* The two MDF questions share their facts; the ask tells a defense miss from a bluff miss. */}
                    {m.type === "mdf" && m.ask && <span className="block text-muted normal-case">{m.ask}</span>}
                  </>
                }
                value={
                  <span className="flex justify-between gap-x-[2ch]">
                    <span className="text-red">{m.given}</span>
                    <span>{m.expected}</span>
                  </span>
                }
              />
            ))}
          </div>
        </>
      )}
      <Blank />
      <Line>
        <span className="flex flex-wrap gap-x-[2ch] gap-y-[0.5em]">
          <button type="button" className="apply cta" onClick={onAgain}>
            Again →
          </button>
          {s.misses.length > 0 && (
            <button type="button" className="apply" onClick={() => onRetry(s.misses)}>
              Retry misses →
            </button>
          )}
          <button type="button" className="apply" onClick={onNext}>
            Next drill: {DRILL_LABELS[next]} →
          </button>
        </span>
      </Line>
      <Legend className="keys uppercase">
        <span>Keys: Enter again</span>
      </Legend>
    </>
  );
}
