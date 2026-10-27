import type { Metadata } from "next";
import { Blank, Line, Sheet } from "@/components/doc";
import DrillClient from "./drill-client";

export const metadata: Metadata = {
  title: "Drills · Gashi's Poker",
  description: "Timed poker math drills: outs, pot odds, MDF, combos, EV and equity.",
};

export default function DrillPage() {
  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">DRILLS</span>
      </Line>
      <Line as="p" className="uppercase">
        <span>Pick a drill, answer, press Enter. Every answer is computed exactly.</span>
      </Line>
      <Blank />
      <DrillClient />
      <Blank />
    </Sheet>
  );
}
