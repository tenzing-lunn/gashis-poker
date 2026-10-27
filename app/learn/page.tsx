import type { Metadata } from "next";
import Link from "next/link";
import { Blank, Line } from "@/components/doc";
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
              <Line>
                <span className="uppercase">
                  <span className="inline-block w-[3ch] text-muted">{String(lesson.module).padStart(2, "0")}</span>
                  <Link href={`/learn/${lesson.slug}`}>{lesson.title} →</Link>
                </span>
              </Line>
              <Line as="p" className="text-muted">
                <span className="pl-[3ch]">{lesson.summary}</span>
              </Line>
            </li>
          ))}
        </ol>
      </nav>
      <Blank />
    </>
  );
}
