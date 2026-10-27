import type { Metadata } from "next";
import DrillClient from "./drill-client";

export const metadata: Metadata = {
  title: "Drills · Gashi's Poker",
  description: "Timed poker math drills: outs, pot odds, MDF, combos, EV and equity.",
};

export default function DrillPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold">Drills</h1>
      <p className="mt-1 text-sm text-zinc-500">Pick a drill, answer, press Enter. Every answer is computed exactly.</p>
      <DrillClient />
    </main>
  );
}
