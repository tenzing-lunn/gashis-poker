import type { ReactNode } from "react";

/** The box every interactive widget sits in, so widgets look alike across lessons. */
export function WidgetFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <figure className="my-8 rounded-lg border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <figcaption className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">
        <span className="mr-2 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[0.7rem] uppercase tracking-wider text-white dark:bg-zinc-100 dark:text-zinc-900">
          Try it
        </span>
        {title}
      </figcaption>
      <div className="p-4 text-sm">{children}</div>
      {footer && <div className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">{footer}</div>}
    </figure>
  );
}

export const inputClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono tabular-nums dark:border-zinc-700 dark:bg-zinc-950";

export const buttonClass =
  "rounded-md bg-zinc-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
