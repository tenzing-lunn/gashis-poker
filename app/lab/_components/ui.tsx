// Small presentational pieces shared by the Lab panels (no state, so usable from any component).

import type { ReactNode } from "react";
import { sciParts } from "./format";

export function Panel({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">{kicker}</p>
      </header>
      {children}
    </section>
  );
}

export function Card({ title, aside, children, className = "" }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-lg border border-zinc-200 bg-background p-4 dark:border-zinc-800 ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {title && <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{title}</h3>}
          {aside && <div className="text-xs text-zinc-500 dark:text-zinc-400">{aside}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** A labelled number: label on top, value large and tabular, unit small. */
export function Stat({ label, value, unit, hint }: { label: string; value: ReactNode; unit?: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={hint}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-mono text-lg tabular-nums leading-6">
        {value}
        {unit && <span className="ml-1 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">{unit}</span>}
      </span>
    </div>
  );
}

export function Field({ label, unit, htmlFor, children }: { label: string; unit?: string; htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
        {unit && <span className="ml-1 normal-case tracking-normal">({unit})</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-background px-2.5 font-mono text-sm tabular-nums outline-none focus-visible:border-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-400/40 aria-invalid:border-rose-500 dark:border-zinc-700 dark:focus-visible:border-zinc-400";

export const selectClass = inputClass.replace("font-mono ", "");

/** A number in scientific notation with a real superscript exponent: 2.14 × 10⁻⁶. */
export function Sci({ x, digits = 2 }: { x: number; digits?: number }) {
  const { mantissa, exp } = sciParts(x, digits);
  if (exp === null) return <>{mantissa}</>;
  return (
    <span className="whitespace-nowrap">
      {mantissa} × 10<sup className="text-[0.7em]">{exp}</sup>
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const base = "h-9 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60";
  const look =
    variant === "primary"
      ? "bg-foreground text-background hover:opacity-85"
      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${look}`}>
      {children}
    </button>
  );
}

export function StatusLine({ tone = "muted", children }: { tone?: "muted" | "busy" | "error"; children: ReactNode }) {
  const color = tone === "error" ? "text-rose-600 dark:text-rose-400" : "text-zinc-500 dark:text-zinc-400";
  return (
    <p role="status" aria-live="polite" className={`flex min-h-5 items-baseline gap-2 text-xs leading-5 tabular-nums ${color}`}>
      {tone === "busy" && <span aria-hidden className="size-1.5 shrink-0 -translate-y-px animate-pulse self-center rounded-full bg-amber-500" />}
      <span>{children}</span>
    </p>
  );
}

/** A two-or-more column numeric table with a header row. */
export function MathTable({ head, rows, caption }: { head: ReactNode[]; rows: { key: string; cells: ReactNode[] }[]; caption?: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-max border-collapse text-sm tabular-nums">
        {caption && <caption className="mb-2 text-left text-xs text-zinc-500 dark:text-zinc-400">{caption}</caption>}
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {head.map((h, i) => (
              <th key={i} scope="col" className={`py-2 pr-4 font-medium last:pr-0 ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              {r.cells.map((c, i) => (
                <td key={i} className={`py-1.5 pr-4 last:pr-0 ${i > 0 ? "text-right font-mono" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
