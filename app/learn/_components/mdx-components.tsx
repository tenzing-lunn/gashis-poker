import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { Check } from "./check";
import { Callout, Cards, Example, Formula, Practice } from "./lesson-ui";

// Typography for lesson markdown, plus the shared components lessons use without importing.
export const lessonComponents: MDXComponents = {
  h1: (props) => <h1 className="mb-4 mt-1 text-3xl font-semibold tracking-tight" {...props} />,
  h2: (props) => <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight" {...props} />,
  h3: (props) => <h3 className="mb-2 mt-6 font-semibold" {...props} />,
  p: (props) => <p className="my-4 leading-7" {...props} />,
  ul: (props) => <ul className="my-4 list-disc space-y-1 pl-6 leading-7" {...props} />,
  ol: (props) => <ol className="my-4 list-decimal space-y-1 pl-6 leading-7" {...props} />,
  a: ({ href = "", ...props }) =>
    href.startsWith("/") ? (
      <Link href={href} className="underline underline-offset-2" {...props} />
    ) : (
      <a href={href} className="underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />
    ),
  blockquote: (props) => <blockquote className="my-4 border-l-4 border-zinc-300 pl-4 italic dark:border-zinc-700" {...props} />,
  code: (props) => <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-zinc-800" {...props} />,
  pre: (props) => <pre className="my-4 overflow-x-auto rounded-md bg-zinc-100 p-3 text-sm dark:bg-zinc-900 [&_code]:bg-transparent [&_code]:p-0" {...props} />,
  table: (props) => (
    <div className="my-5 overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums" {...props} />
    </div>
  ),
  th: (props) => <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-semibold dark:border-zinc-700" {...props} />,
  td: (props) => <td className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800" {...props} />,
  hr: () => <hr className="my-8 border-zinc-200 dark:border-zinc-800" />,
  Callout,
  Cards,
  Check,
  Example,
  Formula,
  Practice,
};
