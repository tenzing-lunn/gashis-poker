// Small presentational pieces shared by the Lab panels (no state, so usable from any component).
// Everything renders as numbered document lines (DESIGN.md §3); figures go in a Screen band.

import type { ReactNode } from "react";
import { BoxButton, Line, Rule, Screen, Tag } from "@/components/doc";
import { sciParts } from "./format";

export function Panel({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col">
      <Line as="h2" className="uppercase">
        <span className="inv">{title}</span>
      </Line>
      <Line as="p">
        <span className="max-w-[72ch] text-muted">{kicker}</span>
      </Line>
      <Line />
      {children}
    </section>
  );
}

/** A titled block of lines: a CAPS heading line (with an optional muted aside on the right), then its content. */
export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      {(title || aside) && (
        <Line className="uppercase">
          <span>{title}</span>
          {aside && <span className="text-muted">{aside}</span>}
        </Line>
      )}
      {children}
      <Line />
    </div>
  );
}

/** A figure band (chart, grid, explorer) with a centred `FIG.` caption line. */
export function Figure({ caption, legend, children }: { caption: ReactNode; legend?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Screen as="figure" className="min-w-0">
        <Line as="figcaption" center className="uppercase">
          <span>{caption}</span>
        </Line>
        {children}
        {legend && (
          <Line className="legend uppercase">
            <span>{legend}</span>
          </Line>
        )}
      </Screen>
      <Line />
    </>
  );
}

/** A labelled number on one line: CAPS label left, value (and muted unit) right. */
export function Stat({ label, value, unit, hint }: { label: string; value: ReactNode; unit?: string; hint?: string }) {
  return (
    <Line title={hint}>
      <span className="uppercase">{label}</span>
      <span>
        {value}
        {unit && <span className="ml-[1ch] text-muted uppercase">{unit}</span>}
      </span>
    </Line>
  );
}

/** Form-row classes: label column left, control right (`.field` stacks them under 680px). */
export const FIELD_ROW = "l field";

/** A form row: CAPS label (and unit) left, the control right on an underline. */
export function Field({ label, unit, htmlFor, children }: { label: string; unit?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className={FIELD_ROW}>
      <label htmlFor={htmlFor} className="uppercase">
        {label}
        {unit && <span className="ml-[1ch] text-muted">({unit})</span>}
      </label>
      <span className="flex min-w-0 flex-col">{children}</span>
    </div>
  );
}

/** A row of mutually exclusive text-button toggles, used where a short select would be. */
export function Toggles<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={FIELD_ROW} role="group" aria-label={label}>
      <span className="uppercase">{label}</span>
      <span className="flex flex-wrap gap-x-[1ch]">
        {options.map((o) => (
          <button key={String(o.value)} type="button" className="t" aria-pressed={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

export const inputClass = "tabular-nums";

export const selectClass = "";

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
  return (
    <BoxButton type={type} onClick={onClick} disabled={disabled} filled={variant === "primary"}>
      {children}
    </BoxButton>
  );
}

/** A line of buttons. */
export function Actions({ children }: { children: ReactNode }) {
  return (
    <Line>
      <span className="flex flex-wrap gap-x-[2ch]">{children}</span>
    </Line>
  );
}

export function StatusLine({ tone = "muted", children }: { tone?: "muted" | "busy" | "error"; children: ReactNode }) {
  return (
    <Line as="p" role="status" aria-live="polite" className="tabular-nums">
      <span className={tone === "muted" ? "text-muted" : undefined}>
        {tone === "busy" && <span aria-hidden="true">● </span>}
        {tone === "error" ? <Tag>{children}</Tag> : children}
      </span>
    </Line>
  );
}

/**
 * Horizontal scroller for wide figures and tables. It extends left over the line-number gutter so the
 * numbers of the lines inside stay visible.
 */
export function Scroll({ children }: { children: ReactNode }) {
  return <div className="relative -ml-[64px] overflow-x-auto pl-[64px] max-[679px]:-ml-[40px] max-[679px]:pl-[40px]">{children}</div>;
}

/** A multi-column numeric table: every row is a numbered line, the label column left, numbers right. */
export function MathTable({ head, rows, caption }: { head: ReactNode[]; rows: { key: string; cells: ReactNode[] }[]; caption?: ReactNode }) {
  return (
    <>
      {caption && (
        <Line as="p">
          <span className="max-w-[72ch] text-muted">{caption}</span>
        </Line>
      )}
      <Scroll>
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr className="text-muted uppercase">
              {head.map((h, i) => (
                <th key={i} scope="col" className={`pr-[2ch] text-left last:pr-0 ${i === 0 ? "l table-cell!" : "text-right whitespace-nowrap"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="align-baseline">
                {r.cells.map((c, i) => (
                  <td key={i} className={`pr-[2ch] last:pr-0 ${i === 0 ? "l table-cell! uppercase" : "text-right whitespace-nowrap"}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </>
  );
}

export { Rule };
