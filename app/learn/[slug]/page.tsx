import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Blank, Line, Rule } from "@/components/doc";
import { lessonComponents } from "../_components/mdx-components";
import { LESSONS, lessonBySlug } from "../lessons";

type Params = PageProps<"/learn/[slug]">["params"];

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
      <Content components={lessonComponents} />
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
