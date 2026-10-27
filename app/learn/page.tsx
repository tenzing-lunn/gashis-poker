import type { Metadata } from "next";
import Link from "next/link";
import { LESSONS } from "./lessons";

export const metadata: Metadata = {
  title: "Learn · Gashi's Poker",
  description: "A 10-module poker course built on the math behind every decision.",
};

export default function LearnIndex() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Learn</h1>
      <p className="mt-3 max-w-prose text-zinc-600 dark:text-zinc-400">
        Ten modules, in order. Each one derives its numbers instead of handing you rules of thumb, works an
        example, and ends with an interactive check. Start at module 0 if you have never played.
      </p>
      <ol className="mt-8 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {LESSONS.map((lesson) => (
          <li key={lesson.slug}>
            <Link
              href={`/learn/${lesson.slug}`}
              className="flex gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
            >
              <span className="w-6 shrink-0 font-mono text-sm tabular-nums text-zinc-400">{lesson.module}</span>
              <span>
                <span className="block font-medium">{lesson.title}</span>
                <span className="block text-sm text-zinc-600 dark:text-zinc-400">{lesson.summary}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
