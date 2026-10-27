import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Blank, Line, Rule } from "@/components/doc";
import { Check } from "./check";
import { Callout, Cards, Example, Formula, Practice } from "./lesson-ui";

/** Marks the first cell of a table row as a numbered line, so every row gets a line number. */
function numberFirstCell(children: ReactNode): ReactNode {
  let done = false;
  return Children.map(children, (child) => {
    if (done || !isValidElement(child)) return child;
    done = true;
    const el = child as ReactElement<{ className?: string }>;
    return cloneElement(el, { className: `${el.props.className ?? ""} l table-cell!` });
  });
}

// Typography for lesson markdown, plus the shared components lessons use without importing.
// Prose stays sentence case on the line grid at a 72ch measure; headings are uppercase 15px lines.
export const lessonComponents: MDXComponents = {
  h1: ({ children, ...props }) => (
    <Line as="h1" className="uppercase" {...props}>
      <span className="inv">{children}</span>
    </Line>
  ),
  h2: ({ children, ...props }) => (
    <>
      <Blank />
      <Line as="h2" className="uppercase" {...props}>
        <span>§ {children}</span>
      </Line>
    </>
  ),
  h3: ({ children, ...props }) => (
    <Line as="h3" gap className="uppercase" {...props}>
      <span className="text-muted">{children}</span>
    </Line>
  ),
  p: ({ children, ...props }) => (
    <Line as="p" gap {...props}>
      <span className="min-w-0 max-w-[72ch]">{children}</span>
    </Line>
  ),
  ul: (props) => <ul className="gap [&>li>.mk]:before:content-['–']" {...props} />,
  ol: (props) => (
    <ol className="gap [counter-reset:item] [&>li]:[counter-increment:ln_1_item_1]! [&>li>.mk]:before:content-[counter(item)_'.']" {...props} />
  ),
  li: ({ children, ...props }) => (
    <li className="l flex-nowrap! justify-start!" {...props}>
      <span className="mk w-[3ch] shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 max-w-[69ch]">{children}</span>
    </li>
  ),
  a: ({ href = "", ...props }) =>
    href.startsWith("/") ? <Link href={href} {...props} /> : <a href={href} target="_blank" rel="noreferrer" {...props} />,
  strong: (props) => <strong className="bg-ink px-[0.5ch] text-paper [box-decoration-break:clone]" {...props} />,
  blockquote: (props) => <blockquote className="text-muted" {...props} />,
  code: (props) => <code className="px-[0.5ch] normal-case outline outline-faint -outline-offset-1" {...props} />,
  pre: (props) => <pre className="gap whitespace-pre-wrap" {...props} />,
  table: (props) => (
    <div className="gap -ml-[64px] overflow-x-auto pl-[64px] max-[679px]:-ml-[40px] max-[679px]:pl-[40px]">
      <table className="w-full border-collapse tabular-nums" {...props} />
    </div>
  ),
  thead: (props) => <thead className="text-muted uppercase" {...props} />,
  tr: ({ children, ...props }) => (
    <tr className="align-baseline" {...props}>
      {numberFirstCell(children)}
    </tr>
  ),
  th: ({ className, ...props }) => <th className={`pr-[2ch] text-left last:pr-0 ${className ?? ""}`} {...props} />,
  td: ({ className, ...props }) => <td className={`pr-[2ch] last:pr-0 ${className ?? ""}`} {...props} />,
  hr: () => <Rule />,
  Callout,
  Cards,
  Check,
  Example,
  Formula,
  Practice,
};
