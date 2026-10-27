import type { Metadata } from "next";
import { Blank, BoxButton, Line, Sheet } from "@/components/doc";

export const metadata: Metadata = {
  title: "Review · Gashi's Poker",
  description: "Hand review: every hand graded decision by decision. Arrives with the next phase.",
};

export default function ReviewPage() {
  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">REVIEW</span>
      </Line>
      <Line as="p" className="uppercase">
        <span>Hand review: every hand you play, graded decision by decision, with the EV lost in bb.</span>
      </Line>
      <Line as="p" className="uppercase">
        <span className="text-muted">It arrives with the next phase. Until then, play some hands.</span>
      </Line>
      <Blank />
      <Line>
        <BoxButton href="/play">PLAY →</BoxButton>
      </Line>
      <Blank />
    </Sheet>
  );
}
