import Link from "next/link";
import { Blank, BoxButton, Line, Rule, Screen, Sheet } from "@/components/doc";
import { AttractTable } from "@/components/table/attract-table";
import { LearnCta } from "./learn/_components/progress";
import { LESSONS } from "./learn/lessons";

const ROOMS = [
  { href: "/learn", label: "LEARN", note: "TEN SHORT MODULES, EACH WITH A WORKED HAND" },
  { href: "/drill", label: "DRILL", note: "TIMED REPS: OUTS, POT ODDS, MDF, COMBOS, EV" },
  { href: "/play/friends", label: "PLAY WITH FRIENDS", note: "A PRIVATE TABLE, JOINED BY INVITE LINK" },
] as const;

const COURSE = LESSONS.map(({ slug, module }) => ({ slug, module }));

export default function Home() {
  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">A TRAINER FOR POKER MATH</span>
      </Line>
      <Blank />
      <Line as="p">POT ODDS, OUTS, EQUITY AND EXPECTED VALUE, PRACTICED UNTIL THEY ARE AUTOMATIC.</Line>
      <Line as="p">LEARN A CONCEPT, DRILL IT AGAINST THE CLOCK, THEN TAKE IT TO A TABLE OF BOTS OR FRIENDS.</Line>
      <Line as="p">THE LESSONS COME WITH SMALL SOLVERS YOU CAN RUN, SO YOU CAN SEE WHY THE NUMBERS WORK.</Line>
      <Blank />
      <Line>
        <span className="flex flex-wrap gap-x-[2ch]">
          <LearnCta lessons={COURSE} />
          <BoxButton href="/play">PLAY →</BoxButton>
        </span>
      </Line>
      <Blank />
      <nav aria-label="Rooms">
        <ul>
          {ROOMS.map((room) => (
            <Line as="li" key={room.href}>
              <Link href={room.href}>{room.label} →</Link>
              <span className="text-muted">{room.note}</span>
            </Line>
          ))}
          <Line as="li">
            <span className="text-muted" aria-disabled="true">
              REVIEW <span aria-hidden="true">(SOON)</span>
              <span className="sr-only">, coming soon</span>
            </span>
            <span className="text-muted">YOUR HANDS, REPLAYED AND GRADED</span>
          </Line>
        </ul>
      </nav>
      <Blank />
      <Rule />
      <Screen aria-label="Figure 1: bots playing each other (demo)">
        <Line center>FIG. 1: BOTS PLAYING EACH OTHER (DEMO)</Line>
        <AttractTable />
      </Screen>
      <Blank />
    </Sheet>
  );
}
