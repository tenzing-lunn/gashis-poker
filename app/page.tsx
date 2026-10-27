import Link from "next/link";
import { Blank, BoxButton, Line, Rule, Screen, Sheet } from "@/components/doc";

const ROOMS = [
  { href: "/learn", label: "LEARN", note: "TEN SHORT MODULES, EACH WITH A WORKED HAND" },
  { href: "/drill", label: "DRILL", note: "TIMED REPS: OUTS, POT ODDS, MDF, COMBOS, EV" },
  { href: "/play", label: "PLAY", note: "A TABLE OF BOTS, OR A PRIVATE TABLE WITH FRIENDS" },
  { href: "/lab", label: "LAB", note: "SOLVERS AND SIMULATORS FOR SMALL GAMES" },
  { href: "/review", label: "REVIEW", note: "YOUR HANDS, REPLAYED AND GRADED" },
] as const;

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
      <Line as="p">THE LAB SOLVES SMALL GAMES SO YOU CAN SEE WHY THE NUMBERS WORK.</Line>
      <Blank />
      <Line>
        <BoxButton href="/play" filled>
          PLAY →
        </BoxButton>
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
        </ul>
      </nav>
      <Blank />
      <Rule />
      <Screen aria-label="Figure 1: table">
        <Line center>FIG. 1: TABLE</Line>
        <Line center className="text-muted">
          TABLE LOADING…
        </Line>
      </Screen>
      <Blank />
    </Sheet>
  );
}
