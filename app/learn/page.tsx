import type { Metadata } from "next";
import Link from "next/link";
import { Blank, Line } from "@/components/doc";
import { ModuleChecks, ModuleMark } from "./_components/progress";
import { PRACTICE_HREF } from "./[slug]/practice";
import { LESSONS } from "./lessons";

export const metadata: Metadata = {
  title: "Learn · Gashi's Poker",
  description: "A 10-module poker course built on the math behind every decision.",
};

export default function LearnIndex() {
  return (
    <>
      <Blank />
      <Line as="h1">
        <span className="inv">LEARN</span>
      </Line>
      <Blank />
      <Line as="p" className="uppercase">
        <span>
          Ten modules, in order. Each one derives its numbers instead of handing you rules of thumb, works an example, and ends with an interactive check. Start at module 0 if
          you have never played.
        </span>
      </Line>
      <Blank />
      <Line className="uppercase text-muted">
        <span>Modules</span>
        <span>10-module course</span>
      </Line>
      <nav aria-label="Modules">
        <ol>
          {LESSONS.map((lesson) => (
            <li key={lesson.slug}>
              <Line className="uppercase">
                <span>
                  <span className="inline-block w-[4ch]">
                    <ModuleMark slug={lesson.slug} />
                  </span>
                  <span className="inline-block w-[3ch] text-muted">{String(lesson.module).padStart(2, "0")}</span>
                  <Link href={`/learn/${lesson.slug}`}>{lesson.title} →</Link>
                </span>
                <ModuleChecks slug={lesson.slug} />
              </Line>
              <Line as="p" className="text-muted">
                <span className="pl-[7ch]">{lesson.summary}</span>
              </Line>
            </li>
          ))}
        </ol>
      </nav>
      <Blank />
      <ul className="uppercase">
        <li>
          <Line>
            <Link href="/learn/tools">Tools →</Link>
          </Line>
          <Line as="p" className="text-muted">
            <span className="pl-[7ch]">The solvers and simulators that used to be the Lab, for running the small games yourself.</span>
          </Line>
        </li>
        <li>
          <Line>{PRACTICE_HREF ? <Link href={PRACTICE_HREF}>Practice →</Link> : <span className="text-muted">Practice (soon)</span>}</Line>
          <Line as="p" className="text-muted">
            <span className="pl-[7ch]">Set up a spot and play it, with your equity and the EV of each option shown at every decision.</span>
          </Line>
        </li>
      </ul>
      <Blank />
    </>
  );
}
