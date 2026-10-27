"use client";

import { memo } from "react";
import type { CfrVariant } from "@/lib/gto/cfr";
import type { KuhnPoint } from "@/lib/gto/worker-protocol";
import { ChartFrame, decadeLabel, decadeTicks, iterLabel, linePath, linearScale, logScale, makeFrame, niceTicks, numLabel, useWidth } from "./chart";

export const KUHN_VALUE = -1 / 18;

export interface KuhnSeries {
  variant: CfrVariant;
  points: KuhnPoint[];
  /** A finished earlier run, drawn dashed for comparison. */
  ghost: boolean;
}

export const VARIANT_LABEL: Record<CfrVariant, string> = { cfr: "CFR", "cfr+": "CFR+" };
// Two tones on the band: CFR+ in ink, vanilla CFR in muted grey. Earlier runs are dashed.
const STROKE: Record<CfrVariant, string> = {
  cfr: "stroke-muted",
  "cfr+": "stroke-ink",
};
/** Text colour for a legend swatch drawn with currentColor. */
export const SWATCH: Record<CfrVariant, string> = {
  cfr: "text-muted",
  "cfr+": "text-ink",
};

function Series({ s, x, y, field }: { s: KuhnSeries; x: (v: number) => number; y: (v: number) => number; field: "exploitability" | "value" }) {
  if (s.points.length === 0) return null;
  const xs = s.points.map((p) => p.iteration);
  const ys = s.points.map((p) => (field === "exploitability" ? Math.max(p.exploitability, 1e-12) : p.value));
  const last = s.points[s.points.length - 1];
  return (
    <g className={STROKE[s.variant]}>
      <path d={linePath(xs, ys, x, y)} fill="none" strokeWidth={s.ghost ? 1.25 : 2} strokeDasharray={s.ghost ? "4 3" : undefined} strokeOpacity={s.ghost ? 0.7 : 1} strokeLinejoin="round" />
      {!s.ghost && <circle cx={x(last.iteration)} cy={y(field === "exploitability" ? Math.max(last.exploitability, 1e-12) : last.value)} r={3} className="fill-paper" strokeWidth={2} />}
    </g>
  );
}

/** Exploitability (log-log) and value (log-x) of the average strategy against iterations. */
export const KuhnCharts = memo(function KuhnCharts({ series, maxIterations }: { series: KuhnSeries[]; maxIterations: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const all = series.flatMap((s) => s.points);
  const xMax = Math.max(10, maxIterations, ...all.map((p) => p.iteration));

  // Exploitability: log y over whole decades.
  const ex = all.map((p) => Math.max(p.exploitability, 1e-12));
  const eLo = ex.length ? 10 ** Math.floor(Math.log10(Math.min(...ex))) : 1e-4;
  const eHi = ex.length ? Math.max(1, 10 ** Math.ceil(Math.log10(Math.max(...ex)))) : 1;
  const h = width < 500 ? 200 : 240;
  const f1 = makeFrame(width, h);
  const x1 = logScale(1, xMax, f1.left, f1.right);
  const y1 = logScale(eLo, eHi, f1.bottom, f1.top);

  // Value: linear y around -1/18, clipped to a window so early iterations don't flatten the picture.
  const vs = all.map((p) => p.value);
  const vLo = Math.max(KUHN_VALUE - 0.15, Math.min(KUHN_VALUE - 0.02, ...vs));
  const vHi = Math.min(KUHN_VALUE + 0.15, Math.max(KUHN_VALUE + 0.02, ...vs));
  const vTicks = niceTicks(vLo, vHi, 4);
  const f2 = makeFrame(width, h);
  const y2 = linearScale(Math.min(vLo, vTicks[0]), Math.max(vHi, vTicks[vTicks.length - 1]), f2.bottom, f2.top);
  const xTicks = decadeTicks(1, xMax).filter((v) => v <= xMax * 1.0001);

  return (
    <div ref={ref} className="flex w-full flex-col gap-[1.8em] overflow-hidden">
      <ChartFrame
        frame={f1}
        x={x1}
        y={y1}
        xTicks={xTicks}
        yTicks={decadeTicks(eLo, eHi)}
        xFormat={iterLabel}
        yFormat={decadeLabel}
        xLabel="iterations (log)"
        yLabel="exploitability (chips/hand, log)"
        title="Exploitability of the average strategy against iterations, log-log"
        clipId="kuhn-expl"
      >
        {series.map((s) => (
          <Series key={`${s.variant}-${s.ghost}`} s={s} x={x1} y={y1} field="exploitability" />
        ))}
      </ChartFrame>
      <ChartFrame
        frame={f2}
        x={x1}
        y={y2}
        xTicks={xTicks}
        yTicks={vTicks}
        xFormat={iterLabel}
        yFormat={numLabel}
        xLabel="iterations (log)"
        yLabel="P0 value (chips/hand)"
        title="Expected value of the average strategy for player 0, converging to minus one eighteenth"
        clipId="kuhn-value"
      >
        <line x1={f2.left} x2={f2.right} y1={y2(KUHN_VALUE)} y2={y2(KUHN_VALUE)} className="stroke-ink" strokeDasharray="6 4" strokeWidth={1} />
        <text x={f2.right - 4} y={y2(KUHN_VALUE) - 6} textAnchor="end" className="fill-ink text-[10px]">
          −1/18 ≈ −0.0556
        </text>
        {series.map((s) => (
          <Series key={`${s.variant}-${s.ghost}`} s={s} x={x1} y={y2} field="value" />
        ))}
      </ChartFrame>
    </div>
  );
});
