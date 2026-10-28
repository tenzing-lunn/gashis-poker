"use client";

import { createContext, useMemo, useSyncExternalStore } from "react";
import { BoxButton } from "@/components/doc";

// Course progress, kept in this browser only. Per lesson: the checks seen on the page and the ones answered
// correctly. Every storage access is guarded: private mode or blocked storage just means no progress.

const KEY = "gashi:learn:v1";

export interface LessonProgress {
  checks: string[];
  correct: string[];
}

export type Progress = Record<string, LessonProgress>;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Stored progress, keeping only well-shaped lessons: a hand-edited or older store cannot crash a page. */
function parse(raw: string | null): Progress {
  if (!raw) return {};
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    const out: Progress = {};
    for (const [slug, l] of Object.entries(p)) {
      if (l && typeof l === "object" && isStrings(l.checks) && isStrings(l.correct)) out[slug] = { checks: l.checks, correct: l.correct };
    }
    return out;
  } catch {
    return {};
  }
}

function update(slug: string, change: (l: LessonProgress) => LessonProgress | null) {
  const all = parse(readRaw());
  const before = all[slug] ?? { checks: [], correct: [] };
  const after = change(before);
  if (!after) return;
  all[slug] = after;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
    window.dispatchEvent(new Event(KEY));
  } catch {
    // Storage unavailable: progress is not kept.
  }
}

/** A check on the lesson page: the store learns how many checks the lesson has. */
export function registerCheck(slug: string, key: string) {
  update(slug, (l) => (l.checks.includes(key) ? null : { ...l, checks: [...l.checks, key] }));
}

/** A check answered correctly (not merely revealed). */
export function recordCorrect(slug: string, key: string) {
  update(slug, (l) =>
    l.correct.includes(key) ? null : { checks: l.checks.includes(key) ? l.checks : [...l.checks, key], correct: [...l.correct, key] },
  );
}

function subscribe(onChange: () => void) {
  window.addEventListener(KEY, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(KEY, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Stored progress; null on the server and during hydration, so first paint matches the server. */
export function useProgress(): Progress | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => undefined);
  return useMemo(() => (raw === undefined ? null : parse(raw)), [raw]);
}

export interface LessonStatus {
  visited: boolean;
  total: number;
  correct: number;
  done: boolean;
}

export function lessonStatus(l: LessonProgress | undefined): LessonStatus {
  if (!l) return { visited: false, total: 0, correct: 0, done: false };
  const total = l.checks.length;
  const correct = l.correct.filter((k) => l.checks.includes(k)).length;
  return { visited: true, total, correct, done: total > 0 && correct === total };
}

/** The slug of the lesson being read, provided around the lesson content. */
export const LessonSlug = createContext<string | null>(null);

// Small views of the store. Each renders the no-progress state on the server and first paint, then updates.

/** Learn index: `[X]` when every check in the lesson is answered correctly, else `[ ]`. */
export function ModuleMark({ slug }: { slug: string }) {
  const progress = useProgress();
  const { done } = lessonStatus(progress?.[slug]);
  return (
    <>
      <span aria-hidden="true">{done ? "[X]" : "[ ]"}</span>
      {done && <span className="sr-only">Done: </span>}
    </>
  );
}

/** Learn index: `2/3 CHECKS` for a lesson that has been opened, else nothing. */
export function ModuleChecks({ slug }: { slug: string }) {
  const progress = useProgress();
  const { visited, total, correct } = lessonStatus(progress?.[slug]);
  if (!visited || total === 0) return null;
  return (
    <span className="text-muted">
      {correct}/{total} checks
    </span>
  );
}

/** Home: `START LEARNING →` for a newcomer; `CONTINUE: MODULE N →` once any lesson has been opened. */
export function LearnCta({ lessons }: { lessons: { slug: string; module: number }[] }) {
  const progress = useProgress();
  const started = progress !== null && lessons.some((l) => lessonStatus(progress[l.slug]).visited);
  if (!started) {
    return (
      <BoxButton href={`/learn/${lessons[0].slug}`} filled>
        START LEARNING →
      </BoxButton>
    );
  }
  const next = lessons.find((l) => !lessonStatus(progress[l.slug]).done);
  return next ? (
    <BoxButton href={`/learn/${next.slug}`} filled>
      CONTINUE: MODULE {next.module} →
    </BoxButton>
  ) : (
    <BoxButton href="/learn" filled>
      ALL MODULES DONE →
    </BoxButton>
  );
}
