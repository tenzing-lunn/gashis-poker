import type { Metadata } from "next";
import { Blank, Line, Sheet } from "@/components/doc";
import { LabTabs } from "./_components/lab-tabs";

export const metadata: Metadata = {
  title: "Lab · Gashi's Poker",
  description:
    "Watch game theory run: Kuhn poker solved by CFR and CFR+, the AKQ game's closed form checked by CFR, heads-up push/fold Nash ranges, a bankroll variance simulator, and a Discounted-CFR river solver.",
};

export default function LabPage() {
  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">THE LAB</span>
      </Line>
      <Line as="p" className="uppercase">
        <span>
          Five small solvers you can run and watch. Every number is computed exactly in your browser, in a background worker, and set against the closed-form answer where
          one exists.
        </span>
      </Line>
      <Blank />
      <LabTabs />
    </Sheet>
  );
}
