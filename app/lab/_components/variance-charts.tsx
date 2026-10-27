"use client";

import { memo } from "react";
import type { VarianceResultMessage } from "@/lib/gto/worker-protocol";
import { ChartFrame, linePath, linearScale, makeFrame, niceTicks, numLabel, useWidth } from "./chart";
import { compact } from "./format";

const handLabel = (v: number) => compact(Math.round(v));

/** Sample bankroll paths over the analytic mean line and its 95% (±1.96σ) band. */
export const PathsChart = memo(function PathsChart({ r }: { r: VarianceResultMessage }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const f = makeFrame(width, width < 500 ? 220 : 280, { left: 58, right: 14, top: 26, bottom: 36 });
  const mean = (h: number) => (r.winRate * h) / 100;
  const band = (h: number) => 1.96 * r.stdDev * Math.sqrt(h / 100);
  let lo = Math.min(0, mean(r.hands) - band(r.hands)), hi = Math.max(0, mean(r.hands) + band(r.hands));
  for (const p of r.paths) {
    for (const v of p) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const yTicks = niceTicks(lo, hi, 5);
  const x = linearScale(0, r.hands, f.left, f.right);
  const y = linearScale(Math.min(lo, yTicks[0]), Math.max(hi, yTicks[yTicks.length - 1]), f.bottom, f.top);
  const hs = r.pathHands;
  const upper = hs.map((h) => `${x(h).toFixed(1)},${y(mean(h) + band(h)).toFixed(1)}`);
  const lower = hs.map((h) => `${x(h).toFixed(1)},${y(mean(h) - band(h)).toFixed(1)}`).reverse();

  return (
    <div ref={ref} className="w-full overflow-hidden">
      <ChartFrame
        frame={f}
        x={x}
        y={y}
        xTicks={niceTicks(0, r.hands, width < 500 ? 4 : 6)}
        yTicks={yTicks}
        xFormat={handLabel}
        yFormat={numLabel}
        xLabel="hands played"
        yLabel="cumulative result (bb)"
        title="Sample bankroll paths against the expected line and its 95 percent band"
        clipId="var-paths"
      >
        <polygon points={[...upper, ...lower].join(" ")} className="fill-faint" fillOpacity={0.35} />
        <line x1={f.left} x2={f.right} y1={y(0)} y2={y(0)} className="stroke-muted" strokeWidth={1} />
        {r.paths.map((p, i) => (
          <path key={i} d={linePath(hs, p, x, y)} fill="none" strokeWidth={1} className="stroke-muted" strokeLinejoin="round" />
        ))}
        <path d={linePath(hs, hs.map(mean), x, y)} fill="none" strokeWidth={2} className="stroke-ink" />
        <path d={linePath(hs, hs.map((h) => mean(h) + band(h)), x, y)} fill="none" strokeWidth={1} strokeDasharray="5 4" className="stroke-ink" />
        <path d={linePath(hs, hs.map((h) => mean(h) - band(h)), x, y)} fill="none" strokeWidth={1} strokeDasharray="5 4" className="stroke-ink" />
      </ChartFrame>
    </div>
  );
});

const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** Histogram of final results with the analytic normal density scaled to counts. */
export const HistogramChart = memo(function HistogramChart({ r }: { r: VarianceResultMessage }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const f = makeFrame(width, width < 500 ? 200 : 240, { left: 46, right: 14, top: 26, bottom: 36 });
  const { min, binWidth, counts } = r.histogram;
  const m = r.analytic.mean, s = r.analytic.sd;
  const x0 = Math.min(min, m - 3.5 * s), x1 = Math.max(min + binWidth * counts.length, m + 3.5 * s);
  const density = (v: number) => (s > 0 ? (r.runs * binWidth * phi((v - m) / s)) / s : 0);
  const yMax = Math.max(1, ...counts, density(m)) * 1.08;
  const yTicks = niceTicks(0, yMax, 4);
  const x = linearScale(x0, x1, f.left, f.right);
  const y = linearScale(0, Math.max(yMax, yTicks[yTicks.length - 1]), f.bottom, f.top);
  const curveX = Array.from({ length: 121 }, (_, i) => x0 + ((x1 - x0) * i) / 120);

  return (
    <div ref={ref} className="w-full overflow-hidden">
      <ChartFrame
        frame={f}
        x={x}
        y={y}
        xTicks={niceTicks(x0, x1, width < 500 ? 4 : 6)}
        yTicks={yTicks}
        xFormat={numLabel}
        yFormat={numLabel}
        xLabel="final result (bb)"
        yLabel="runs"
        title="Histogram of final results with the analytic normal curve"
        clipId="var-hist"
      >
        {counts.map((c, i) => {
          const left = x(min + i * binWidth), right = x(min + (i + 1) * binWidth);
          const neg = min + (i + 0.5) * binWidth < 0;
          return (
            <rect
              key={i}
              x={left + 0.5}
              y={y(c)}
              width={Math.max(0, right - left - 1)}
              height={Math.max(0, y(0) - y(c))}
              className={neg ? "fill-red" : "fill-green"}
              fillOpacity={0.7}
            />
          );
        })}
        <path d={linePath(curveX, curveX.map(density), x, y)} fill="none" strokeWidth={2} className="stroke-ink" />
        <line x1={x(0)} x2={x(0)} y1={f.top} y2={f.bottom} strokeDasharray="3 3" className="stroke-muted" />
        <text x={x(0) + 4} y={f.top + 10} className="fill-muted text-[10px] uppercase">
          break-even
        </text>
      </ChartFrame>
    </div>
  );
});
