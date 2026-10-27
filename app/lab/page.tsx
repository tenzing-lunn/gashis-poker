import type { Metadata } from "next";
import { LabTabs } from "./_components/lab-tabs";

export const metadata: Metadata = {
  title: "Lab · Gashi's Poker",
  description:
    "Watch game theory run: Kuhn poker solved by CFR and CFR+, the AKQ game's closed form checked by CFR, heads-up push/fold Nash ranges, and a bankroll variance simulator.",
};

export default function LabPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 bg-background px-4 py-8 font-sans text-foreground sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Gashi&apos;s Poker / Lab</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">The Lab</h1>
        <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Four small solvers you can run and watch. Every number is computed exactly in your browser, in a background worker, and set against the closed-form
          answer where one exists.
        </p>
      </header>
      <LabTabs />
    </main>
  );
}
