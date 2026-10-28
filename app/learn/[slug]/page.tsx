import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Blank, Line, Rule } from "@/components/doc";
import { DRILL_LABELS, type DrillType } from "@/lib/drills";
import { lessonComponents } from "../_components/mdx-components";
import { LESSONS, lessonBySlug } from "../lessons";
import { LessonProgressProvider } from "./lesson-progress";
import { PRACTICE_HREF } from "./practice";

type Params = PageProps<"/learn/[slug]">["params"];

// The drill that practices each lesson's math. Rules has none; it points at the table instead.
const LESSON_DRILL: Partial<Record<string, DrillType>> = {
  combinatorics: "comboCount",
  outs: "countOuts",
  "pot-odds": "potOdds",
  equity: "equityEstimate",
  "game-theory": "mdf",
  preflop: "comboCount",
  postflop: "equityEstimate",
  exploitation: "mdf",
  variance: "callEv",
};

export function generateStaticParams() {
  return LESSONS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const lesson = lessonBySlug(slug);
  return lesson ? { title: `${lesson.module}. ${lesson.title} · Gashi's Poker`, description: lesson.summary } : {};
}

// The slug is URL data, so the lesson renders inside a Suspense boundary; the fallback is the
// instant shell shown during navigation.
export default function LessonPage({ params }: PageProps<"/learn/[slug]">) {
  return (
    <Suspense
      fallback={
        <Line as="p" className="uppercase text-muted">
          <span>Loading lesson…</span>
        </Line>
      }
    >
      <Lesson params={params} />
    </Suspense>
  );
}

async function Lesson({ params }: { params: Params }) {
  const { slug } = await params;
  const lesson = lessonBySlug(slug);
  if (!lesson) notFound();

  const { default: Content } = await lesson.load();
  const index = LESSONS.indexOf(lesson);
  const prev = LESSONS[index - 1];
  const next = LESSONS[index + 1];

  return (
    <article>
      <Blank />
      <Line as="nav" aria-label="Course" className="uppercase">
        <Link href="/learn">← All modules</Link>
        <span className="text-muted">Module {lesson.module} · 10-module course</span>
      </Line>
      <Blank />
      <LessonProgressProvider slug={lesson.slug}>
        <Content components={lessonComponents} />
      </LessonProgressProvider>
      <Blank />
      <NextSteps slug={lesson.slug} />
      <Blank />
      <Rule />
      <Line as="nav" aria-label="Lessons" className="uppercase">
        {prev ? <Link href={`/learn/${prev.slug}`}>← {prev.module}. {prev.title}</Link> : <Link href="/learn">← All modules</Link>}
        {next ? (
          <Link href={`/learn/${next.slug}`} className="text-right">
            {next.module}. {next.title} →
          </Link>
        ) : (
          <Link href="/learn">All modules →</Link>
        )}
      </Line>
      <Blank />
    </article>
  );
}

function NextSteps({ slug }: { slug: string }) {
  const drill = LESSON_DRILL[slug];
  return (
    <nav aria-label="Next steps" className="uppercase">
      <Line as="h2">
        <span>§ Next steps</span>
      </Line>
      <ul>
        <Line as="li">
          {drill ? (
            <Link href={`/drill?type=${drill}`}>Drill this: {DRILL_LABELS[drill]} →</Link>
          ) : (
            <Link href="/play">Try it: play a few hands →</Link>
          )}
        </Line>
        <Line as="li">
          {PRACTICE_HREF ? (
            <Link href={PRACTICE_HREF}>Practice this →</Link>
          ) : (
            <span className="text-muted">Practice this (soon)</span>
          )}
        </Line>
      </ul>
    </nav>
  );
}
