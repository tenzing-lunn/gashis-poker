import Link from "next/link";
import type { ReactNode } from "react";
import { parseCards, RANK_CHARS, rankOf, suitOf } from "@/lib/poker/cards";

// Shared building blocks for lessons. Every lesson can use these without importing them
// (they are passed to each MDX page through lessonComponents).

const SUIT_SYMBOL = ["♣", "♦", "♥", "♠"];
const SUIT_COLOR = ["text-emerald-700 dark:text-emerald-400", "text-blue-700 dark:text-blue-400", "text-red-600 dark:text-red-400", "text-zinc-900 dark:text-zinc-100"];
const SUIT_NAME = ["clubs", "diamonds", "hearts", "spades"];
const RANK_NAME = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king", "ace"];

/** Renders cards as text tiles (no card art). Usage: <Cards hand="AhKs" /> or <Cards hand="Ah Ks 7d" />. */
export function Cards({ hand }: { hand: string }) {
  const cards = parseCards(hand);
  return (
    <span className="inline-flex gap-0.5 align-baseline">
      {cards.map((c) => (
        <span
          key={c}
          aria-label={`${RANK_NAME[rankOf(c)]} of ${SUIT_NAME[suitOf(c)]}`}
          className={`inline-block rounded border border-zinc-300 bg-white px-1 font-mono text-[0.95em] font-semibold leading-tight dark:border-zinc-600 dark:bg-zinc-800 ${SUIT_COLOR[suitOf(c)]}`}
        >
          {RANK_CHARS[rankOf(c)]}
          {SUIT_SYMBOL[suitOf(c)]}
        </span>
      ))}
    </span>
  );
}

const CALLOUT_STYLE = {
  key: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
  note: "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900",
  warn: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
} as const;

/** A boxed aside. kind="key" for the main takeaway, "warn" for a common mistake. */
export function Callout({ kind = "note", title, children }: { kind?: keyof typeof CALLOUT_STYLE; title?: string; children: ReactNode }) {
  return (
    <aside className={`my-6 rounded-lg border px-4 py-3 ${CALLOUT_STYLE[kind]}`}>
      {title && <p className="mb-1 text-sm font-semibold">{title}</p>}
      <div className="text-[0.95rem] [&>p]:my-1">{children}</div>
    </aside>
  );
}

/** A displayed formula. Write it in plain text: <Formula>required equity = B / (P + 2B)</Formula> */
export function Formula({ children }: { children: ReactNode }) {
  return (
    <div className="my-5 overflow-x-auto rounded-md bg-zinc-100 px-4 py-3 text-center font-mono text-[0.95rem] dark:bg-zinc-900">
      {children}
    </div>
  );
}

/** A worked example, set apart from the prose. */
export function Example({ title = "Worked example", children }: { title?: string; children: ReactNode }) {
  return (
    <section className="my-6 rounded-lg border-l-4 border-zinc-400 bg-white px-4 py-3 dark:border-zinc-500 dark:bg-zinc-900">
      <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
      <div className="[&>p]:my-2">{children}</div>
    </section>
  );
}

/** Points the reader at the matching drill. Drills live at /drill (built separately). */
export function Practice({ drill, children }: { drill: string; children?: ReactNode }) {
  return (
    <aside className="my-8 flex items-center justify-between gap-4 rounded-lg border border-zinc-300 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="text-sm">
        <p className="font-semibold">Practice: {drill}</p>
        {children && <div className="text-zinc-600 dark:text-zinc-400">{children}</div>}
      </div>
      <Link href="/drill" className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
        Go to drills
      </Link>
    </aside>
  );
}
