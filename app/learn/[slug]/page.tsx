import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
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
    <Suspense fallback={<p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Loading lesson…</p>}>
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
      <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Module {lesson.module}</p>
      <Content components={lessonComponents} />
      <nav className="mt-12 flex justify-between gap-4 border-t border-zinc-200 pt-6 text-sm dark:border-zinc-800">
        {prev ? (
          <Link href={`/learn/${prev.slug}`} className="hover:underline">
            ← {prev.module}. {prev.title}
          </Link>
        ) : (
          <Link href="/learn" className="hover:underline">
            ← All modules
          </Link>
        )}
        {next ? (
          <Link href={`/learn/${next.slug}`} className="text-right hover:underline">
            {next.module}. {next.title} →
          </Link>
        ) : (
          <Link href="/learn" className="hover:underline">
            All modules →
          </Link>
        )}
      </nav>
    </article>
  );
}
