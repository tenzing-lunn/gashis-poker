import type { Metadata } from "next";
import { Suspense } from "react";
import { Blank, Line, Sheet } from "@/components/doc";
import DrillClient, { Drill } from "./drill-client";

export const metadata: Metadata = {
  title: "Drills · Gashi's Poker",
  description:
    "120-second poker math rounds: count outs, outs to equity, pot odds, EV of a call, combos, equity and MDF. Score, median time and your misses at the end.",
};

export default function DrillPage() {
  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">DRILLS</span>
      </Line>
      <Line as="p" className="uppercase">
        <span>Pick a drill. Each round is 120 seconds. Answer, press Enter.</span>
      </Line>
      <Blank />
      {/* ?type= is read on the client (useSearchParams), so the static shell prerenders the default picker. */}
      <Suspense fallback={<Drill requested={null} />}>
        <DrillClient />
      </Suspense>
      <Blank />
    </Sheet>
  );
}
