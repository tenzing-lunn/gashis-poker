"use client";

import { memo } from "react";
import type { RiverPoint } from "@/lib/gto/worker-protocol";
import { ChartFrame, decadeTicks, iterLabel, linePath, linearScale, logScale, makeFrame, niceTicks, useWidth } from "./chart";
import { fmt } from "./format";

const pctLabel = (v: number): string => `${fmt(v, Math.max(0, Math.round(-Math.log10(v))))}%`;

/** Exploitability of the average strategy (% of the pot, log scale) against iterations. */
export const RiverChart = memo(function RiverChart({ points, targetPct }: { points: readonly RiverPoint[]; targetPct: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const h = width < 500 ? 200 : 240;
  const f = makeFrame(width, h, { left: 56, right: 14, top: 12, bottom: 36 });
  const xs = points.map((p) => p.iteration);
  const ys = points.map((p) => Math.max(p.exploitabilityPct, 1e-6));
  const xMax = Math.max(10, ...xs);
  const lo = 10 ** Math.floor(Math.log10(Math.min(targetPct, ...ys)));
  const hi = 10 ** Math.ceil(Math.log10(Math.max(targetPct * 10, ...ys)));
  const x = linearScale(0, xMax, f.left, f.right);
  const y = logScale(lo, hi, f.bottom, f.top);
  const last = points[points.length - 1];

  return (
    <div ref={ref} className="w-full overflow-hidden">
      <ChartFrame
        frame={f}
        x={x}
        y={y}
        xTicks={niceTicks(0, xMax, width < 500 ? 4 : 6)}
        yTicks={decadeTicks(lo, hi)}
        xFormat={iterLabel}
        yFormat={pctLabel}
        xLabel="iterations"
        yLabel="exploitability, % pot (log)"
        title="Exploitability of the DCFR average strategy, as a percentage of the pot, against iterations"
        clipId="river-expl"
      >
        <line x1={f.left} x2={f.right} y1={y(targetPct)} y2={y(targetPct)} className="stroke-amber-500" strokeDasharray="6 4" strokeWidth={1.5} />
        <text x={f.right - 4} y={y(targetPct) - 6} textAnchor="end" className="fill-amber-600 text-[11px] dark:fill-amber-400">
          target {pctLabel(targetPct)}
        </text>
        {points.length > 0 && (
          <g className="stroke-rose-600 dark:stroke-rose-400">
            <path d={linePath(xs, ys, x, y)} fill="none" strokeWidth={2} strokeLinejoin="round" />
            <circle cx={x(last.iteration)} cy={y(Math.max(last.exploitabilityPct, 1e-6))} r={3} className="fill-background" strokeWidth={2} />
          </g>
        )}
      </ChartFrame>
    </div>
  );
});
