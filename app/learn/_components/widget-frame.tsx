import type { ReactNode } from "react";
import { Blank, Legend, Line, Screen } from "@/components/doc";

/** The screen band every interactive widget sits in, so widgets look alike across lessons. */
export function WidgetFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <Blank />
      <Screen as="figure">
        <Line as="figcaption" className="uppercase">
          <span>
            <span className="inv">TRY IT</span> {title}
          </span>
        </Line>
        {children}
        {footer && (
          <Legend>
            <span>{footer}</span>
          </Legend>
        )}
      </Screen>
      <Blank />
    </>
  );
}

/** A result line: CAPS label left, value right. Wrap formula text in `normal-case` yourself. */
export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Line className={className}>
      <span className="uppercase">{label}</span>
      <span>{children}</span>
    </Line>
  );
}

export const inputClass = "u";

export const buttonClass = "apply cta";

/** Horizontal scroller for wide tables. It extends over the line-number gutter so the numbers of the lines inside stay visible. */
export function Scroll({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative -ml-[64px] overflow-x-auto pl-[64px] max-[679px]:-ml-[40px] max-[679px]:pl-[40px] ${className}`}>{children}</div>;
}

/**
 * A numeric table: every row is a numbered line, CAPS label column left, numbers right-aligned so the digits line up.
 * Under 680px each row becomes a small record instead (title line, then one label/value line per column), so the
 * numbers stay on screen and still align on the right edge. `prefixTitle` titles those records "<first header> <label>".
 */
export function NumTable({ head, rows, prefixTitle }: { head: ReactNode[]; rows: { key: string; cells: ReactNode[] }[]; prefixTitle?: boolean }) {
  return (
    <>
      <div className="max-[679px]:hidden">
        <Scroll>
          <table className="w-full border-collapse tabular-nums">
            <thead>
              <tr className="text-muted uppercase">
                {head.map((h, i) => (
                  <th key={i} scope="col" className={`pr-[2ch] last:pr-0 ${i === 0 ? "l table-cell! text-left" : "text-right whitespace-nowrap"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="align-baseline">
                  {r.cells.map((c, i) => (
                    <td key={i} className={`pr-[2ch] last:pr-0 ${i === 0 ? "l table-cell! whitespace-nowrap uppercase" : "text-right whitespace-nowrap"}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </div>
      <div className="tabular-nums min-[680px]:hidden">
        {rows.map((r) => (
          <div key={r.key}>
            <Line className="uppercase">
              <span>
                {prefixTitle && <>{head[0]} </>}
                {r.cells[0]}
              </span>
            </Line>
            {r.cells.slice(1).map((c, i) => (
              <Line key={i}>
                <span className="text-muted uppercase">{head[i + 1]}</span>
                <span>{c}</span>
              </Line>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
