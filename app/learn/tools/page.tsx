import type { Metadata } from "next";
import Link from "next/link";
import { Blank, Line } from "@/components/doc";
import { RiverPanel } from "@/app/lab/_components/river-panel";

export const metadata: Metadata = {
  title: "Tools · Gashi's Poker",
  description:
    "Where the course's solvers live: Kuhn poker CFR, the AKQ game, the push/fold equilibrium and the variance simulator in their lessons, plus an advanced river solver.",
};

const IN_LESSONS = [
  { href: "/learn/game-theory", label: "Kuhn poker solver (CFR / CFR+)", module: 5, note: "The computer plays a 3-card poker game against itself until its strategy settles." },
  { href: "/learn/game-theory", label: "AKQ game", module: 5, note: "How often to bluff with the Q and call with the K, for any pot and bet." },
  { href: "/learn/preflop#push-fold-equilibrium", label: "Push/fold equilibrium", module: 6, note: "Which hands the small blind shoves and the big blind calls, at 1 to 30bb." },
  { href: "/learn/variance", label: "Variance simulator", module: 9, note: "How far luck moves results, how deep downswings get, and the risk of going broke." },
] as const;

const WORDS = [
  { term: "OOP / IP", meaning: "Out of position / in position. OOP acts first on this river, IP acts last." },
  { term: "Equilibrium", meaning: "A pair of strategies where neither player can gain by changing only their own (module 5)." },
  { term: "DCFR", meaning: "Discounted CFR: a faster version of the CFR from module 5 that gives early, poor iterations less weight." },
  { term: "Exploitability", meaning: "How much a perfect counter-strategy would win against the solved strategies, as a % of the pot. Near 0 means near equilibrium." },
  { term: "Info set", meaning: "One decision as the player to act sees it: one point in the betting, holding one hand. The solver keeps a strategy for each." },
  { term: "EV (bb)", meaning: "A player's average share of the pot when both play the solved strategies, in big blinds. The two shares add up to the pot." },
] as const;

export default function ToolsPage() {
  return (
    <>
      <Blank />
      <Line as="h1">
        <span className="inv">TOOLS</span>
      </Line>
      <Blank />
      <Line as="p">
        <span className="min-w-0 max-w-[72ch]">
          The small solvers that used to be the Lab now sit in the lessons that teach them, right next to the math they check. Every one runs in your browser.
        </span>
      </Line>
      <Blank />
      <Line className="uppercase text-muted">
        <span>In the lessons</span>
        <span>Module</span>
      </Line>
      <ul>
        {IN_LESSONS.map((t) => (
          <li key={t.label}>
            <Line>
              <span className="uppercase">
                <Link href={t.href}>{t.label} →</Link>
              </span>
              <span className="text-muted">{String(t.module).padStart(2, "0")}</span>
            </Line>
            <Line as="p" className="text-muted">
              <span className="min-w-0 max-w-[72ch]">{t.note}</span>
            </Line>
          </li>
        ))}
      </ul>

      <Blank />
      <Line as="h2" className="uppercase">
        <span>§ Advanced: a river solver</span>
      </Line>
      <Line as="p" gap>
        <span className="min-w-0 max-w-[72ch]">
          On a river, given both players&apos; ranges, how often should each hand check, bet, call or raise if both play perfectly? This solver answers that for one board and two
          ranges you choose. The course does not teach it yet, so start from a preset, then change one thing at a time.
        </span>
      </Line>
      <Line className="uppercase" gap>
        <span>Words used here</span>
      </Line>
      <dl>
        {WORDS.map((w) => (
          <div key={w.term} className="l flex-nowrap! justify-start!">
            <dt className="w-[16ch] shrink-0 uppercase">{w.term}</dt>
            <dd className="min-w-0 max-w-[56ch]">{w.meaning}</dd>
          </div>
        ))}
      </dl>
      <Blank />
      <RiverPanel />
      <Blank />
    </>
  );
}
