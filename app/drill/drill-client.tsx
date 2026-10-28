"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DRILL_TYPES,
  START_HERE,
  check,
  formatAnswer,
  generate,
  parseDrillType,
  type Answer,
  type CheckResult,
  type Difficulty,
  type DrillType,
  type Question,
  type RoundAnswer,
} from "@/lib/drills";
import { Blank } from "@/components/doc";
import { cx } from "@/components/doc/cx";
import { loadBest, saveBest } from "./best";
import { Picker } from "./picker";
import { QuestionBody, type Pick } from "./question";
import { Summary } from "./summary";
import { useRoundClock } from "./use-round-clock";

// Event-handler-only helpers (kept outside the component: they are impure).
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const now = () => Date.now();
const narrow = () => window.matchMedia("(max-width: 679px)").matches;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "28,6" → "28.6"; "1,326" → "1326". */
const normalize = (s: string) => s.replace(/,(?=\d{3}(?!\d))/g, "").replace(",", ".");

/** After a round ends, Enter / AGAIN wait this long, so a key meant for the last question can't skip the summary. */
const SUMMARY_HOLD_MS = 400;

/** `retry`: a RETRY MISSES round, whose score is never saved as a best. */
type Round = { type: DrillType; difficulty: Difficulty; over: boolean; retry: boolean };
type Served = { question: Question; seed: number; difficulty: Difficulty };
type Queued = { seed: number; difficulty: Difficulty };

/** Reads `?type=` (inside the page's Suspense boundary) and hands it to the drill. */
export default function DrillClient() {
  return <Drill requested={parseDrillType(useSearchParams().get("type"))} />;
}

/** The drill page body. Also the prerendered fallback (requested = null), so the static shell shows the picker. */
export function Drill({ requested }: { requested: DrillType | null }) {
  const selected = requested ?? START_HERE;
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [round, setRound] = useState<Round | null>(null);
  const [served, setServed] = useState<Served | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [answers, setAnswers] = useState<RoundAnswer[]>([]);
  const [best, setBest] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const shownAt = useRef(0);
  const endedAt = useRef(0);
  // START takes focus only for a deep link (?type=) and on return from CHANGE: a plain /drill visit keeps the
  // page's normal reading order (nav, heading), and START is still the first control after the intro.
  const focusStart = useRef(requested !== null);
  const bandRef = useRef<HTMLElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const running = !!round && !round.over;
  const clock = useRoundClock(running, endRound);

  // Questions are only generated in event handlers (random seed), never during render: no hydration mismatch.
  // Queued misses (RETRY MISSES) are served first, then fresh questions.
  function serve(type: DrillType, d: Difficulty, q: Queued[]) {
    const [head, ...rest] = q;
    const seed = head?.seed ?? randomSeed();
    const qd = head?.difficulty ?? d;
    setServed({ question: generate(type, seed, qd), seed, difficulty: qd });
    setQueue(rest);
    setInput("");
    setResult(null);
    setPicked(null);
    setUnreadable(false);
    shownAt.current = now();
  }

  function startRound(type: DrillType, d: Difficulty = difficulty, retry: RoundAnswer[] = []) {
    // The URL names the drill so the page can be shared or bookmarked; replace, so Back still leaves the page.
    if (type !== selected) window.history.replaceState(null, "", `?type=${type}`);
    setRound({ type, difficulty: d, over: false, retry: retry.length > 0 });
    setAnswers([]);
    clock.start();
    serve(
      type,
      d,
      retry.map((a) => ({ seed: a.seed, difficulty: a.difficulty })),
    );
  }

  // At 0:00 (or ESC) an answered question counts; an open one is dropped (it was never added to answers).
  function endRound() {
    if (!round || round.over) return;
    const correct = answers.filter((a) => a.correct).length;
    const prev = loadBest(round.type, round.difficulty);
    if (!round.retry && correct > 0 && (prev === null || correct > prev)) saveBest(round.type, round.difficulty, correct);
    setBest(prev);
    setRound({ ...round, over: true });
    endedAt.current = now();
  }

  function again() {
    if (round && now() - endedAt.current >= SUMMARY_HOLD_MS) startRound(round.type);
  }

  function answer(value: string) {
    if (!served || !round || round.over || result) return;
    // Past 0:00 but before the clock's next tick: the round is over, this answer doesn't count.
    if (clock.expired()) {
      endRound();
      return;
    }
    const r = check(served.question, normalize(value));
    // A typo shouldn't cost the question: ask again instead of grading it.
    if (r.given === null) {
      setUnreadable(true);
      fieldRef.current?.select();
      return;
    }
    setUnreadable(false);
    setResult(r);
    if (value === "call" || value === "fold") setPicked(value);
    const { question, seed } = served;
    setAnswers((a) => [
      ...a,
      {
        id: question.id,
        seed,
        type: question.type,
        difficulty: served.difficulty,
        correct: r.correct,
        ms: now() - shownAt.current,
        given: formatAnswer(r.given as Answer, question.unit),
        expected: r.expected,
        facts: question.facts,
        ask: question.ask,
      },
    ]);
  }

  // Keys: ESC ends the round; C / F answer a call/fold question (not with modifiers, not while typing elsewhere);
  // on the summary, Enter outside a control is AGAIN. A held key (auto-repeat) never answers, skips or restarts.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!round) return;
    const enter = e.key === "Enter";
    if (round.over) {
      if (!enter || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat || now() - endedAt.current < SUMMARY_HOLD_MS) e.preventDefault();
      else if (!(e.target instanceof Element && e.target.closest("button, a, input, textarea, select, [contenteditable]"))) {
        e.preventDefault();
        again();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (!e.repeat) endRound();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const openAction = !result && served?.question.unit === "action";
    if (enter) {
      // An open call/fold question is answered with C / F (or a Tab-focused button), never a bare Enter.
      if (e.repeat || (openAction && !(e.target instanceof HTMLButtonElement))) e.preventDefault();
      return;
    }
    if (!openAction) return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
    const k = e.key.toLowerCase();
    if (k === "c" || k === "f") {
      e.preventDefault();
      if (!e.repeat) answer(k === "c" ? "call" : "fold");
    }
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Each new question: focus the answer (the field, or the form for call/fold so Enter can't pick CALL; after
  // grading, NEXT for call/fold, while the field keeps focus and Enter goes on), then bring the band into view:
  // on mobile to the top, above a soft keyboard (instantly; the band is a screen tall, so there is room to).
  useEffect(() => {
    if (!running || !served) return;
    const action = served.question.unit === "action";
    if (result) {
      if (action) nextRef.current?.focus({ preventScroll: true });
    } else if (action) formRef.current?.focus({ preventScroll: true });
    else fieldRef.current?.focus({ preventScroll: true });
  }, [running, served, result]);
  useEffect(() => {
    if (!served) return;
    const n = narrow();
    bandRef.current?.scrollIntoView({ block: n ? "start" : "nearest", behavior: n || reducedMotion() ? "auto" : "smooth" });
  }, [served]);
  useEffect(() => {
    if (!round) {
      if (focusStart.current) startRef.current?.focus();
      focusStart.current = false;
    } else if (round.over) headingRef.current?.focus();
  }, [round]);

  const next = DRILL_TYPES[(DRILL_TYPES.indexOf(round?.type ?? selected) + 1) % DRILL_TYPES.length];

  return (
    <>
      <Picker
        selected={selected}
        difficulty={round?.difficulty ?? difficulty}
        active={round?.type ?? null}
        startRef={startRef}
        onStart={(t) => startRound(t)}
        onDifficulty={setDifficulty}
        onChange={() => {
          focusStart.current = true;
          setRound(null);
        }}
      />
      {round && (
        <>
          <Blank />
          {/* While running, on mobile the band is at least a screen tall, so it can always scroll to the top. */}
          <section
            ref={bandRef}
            aria-label={round.over ? "Round summary" : "Question"}
            className={cx("screen", !round.over && "max-[679px]:min-h-svh")}
          >
            {round.over ? (
              <Summary
                type={round.type}
                difficulty={round.difficulty}
                answers={answers}
                best={best}
                retry={round.retry}
                next={next}
                headingRef={headingRef}
                onAgain={again}
                onRetry={(misses) => startRound(round.type, round.difficulty, misses)}
                onNext={() => startRound(next)}
              />
            ) : (
              served && (
                <QuestionBody
                  question={served.question}
                  difficulty={served.difficulty}
                  number={answers.length + (result ? 0 : 1)}
                  left={clock.left}
                  input={input}
                  result={result}
                  picked={picked}
                  unreadable={unreadable}
                  onInput={(v) => {
                    setInput(v);
                    setUnreadable(false);
                  }}
                  onAnswer={answer}
                  onNext={() => serve(round.type, round.difficulty, queue)}
                  formRef={formRef}
                  fieldRef={fieldRef}
                  nextRef={nextRef}
                />
              )
            )}
          </section>
        </>
      )}
    </>
  );
}
