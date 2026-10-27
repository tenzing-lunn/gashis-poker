"use client";

// Minimal hand-written SVG charting: scales, ticks, a frame with gridlines and axis labels.
// Charts render at their real pixel width (measured), so text stays legible on a phone.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { compact, decadeExponent, fmt } from "./format";

export type Scale = (v: number) => number;

export function linearScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

export function logScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const l0 = Math.log10(d0), k = Math.log10(d1) === l0 ? 0 : (r1 - r0) / (Math.log10(d1) - l0);
  return (v) => r0 + (Math.log10(Math.max(v, 1e-300)) - l0) * k;
}

/** About `count` round ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Decade ticks 10^a .. 10^b, thinned to at most ~7. */
export function decadeTicks(lo: number, hi: number): number[] {
  const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
  const stride = Math.max(1, Math.ceil((b - a) / 6));
  const out: number[] = [];
  for (let k = a; k <= b; k += stride) out.push(10 ** k);
  return out;
}

export function decadeLabel(v: number): ReactNode {
  const k = Math.round(Math.log10(v));
  if (k === 0) return "1";
  if (k === 1) return "10";
  return (
    <>
      10
      <tspan dy="-0.45em" fontSize="0.78em">
        {decadeExponent(v)}
      </tspan>
    </>
  );
}
export const iterLabel = (v: number): string => compact(Math.round(v));
export const numLabel = (v: number): string => {
  const a = Math.abs(v);
  return fmt(v, a === 0 || a >= 100 || Number.isInteger(v) ? 0 : a >= 1 ? 1 : a >= 0.1 ? 2 : 3);
};

export function linePath(xs: ArrayLike<number>, ys: ArrayLike<number>, x: Scale, y: Scale): string {
  let d = "";
  for (let i = 0; i < xs.length; i++) d += `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(ys[i]).toFixed(1)}`;
  return d;
}

/** Width of an element, tracked with ResizeObserver. Starts at `initial` (same on server and client). */
export function useWidth<T extends HTMLElement>(initial = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export interface Frame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function makeFrame(width: number, height: number, margin = { left: 52, right: 14, top: 12, bottom: 36 }): Frame {
  return { width, height, left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom };
}

/** Axes, gridlines and labels; the plot goes in `children` (clipped to the plot area). */
export function ChartFrame(props: {
  frame: Frame;
  x: Scale;
  y: Scale;
  xTicks: number[];
  yTicks: number[];
  xFormat: (v: number) => ReactNode;
  yFormat: (v: number) => ReactNode;
  xLabel: string;
  yLabel: string;
  title: string;
  clipId: string;
  children: ReactNode;
}) {
  const { frame: f, x, y } = props;
  return (
    <svg width={f.width} height={f.height} viewBox={`0 0 ${f.width} ${f.height}`} role="img" aria-label={props.title} className="block select-none overflow-visible">
      <defs>
        <clipPath id={props.clipId}>
          <rect x={f.left} y={f.top} width={Math.max(0, f.right - f.left)} height={Math.max(0, f.bottom - f.top)} />
        </clipPath>
      </defs>
      <g className="text-zinc-400 dark:text-zinc-600">
        {props.yTicks.map((v) => (
          <line key={`gy${v}`} x1={f.left} x2={f.right} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
        ))}
        {props.xTicks.map((v) => (
          <line key={`gx${v}`} x1={x(v)} x2={x(v)} y1={f.top} y2={f.bottom} stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} />
        ))}
        <line x1={f.left} x2={f.right} y1={f.bottom} y2={f.bottom} stroke="currentColor" />
        <line x1={f.left} x2={f.left} y1={f.top} y2={f.bottom} stroke="currentColor" />
      </g>
      <g className="fill-zinc-500 text-[11px] tabular-nums dark:fill-zinc-400">
        {props.yTicks.map((v) => (
          <text key={`ty${v}`} x={f.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
            {props.yFormat(v)}
          </text>
        ))}
        {props.xTicks.map((v) => (
          <text key={`tx${v}`} x={x(v)} y={f.bottom + 15} textAnchor="middle">
            {props.xFormat(v)}
          </text>
        ))}
        <text x={(f.left + f.right) / 2} y={f.height - 4} textAnchor="middle" className="fill-zinc-600 dark:fill-zinc-300">
          {props.xLabel}
        </text>
        <text transform={`translate(12 ${(f.top + f.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="fill-zinc-600 dark:fill-zinc-300">
          {props.yLabel}
        </text>
      </g>
      <g clipPath={`url(#${props.clipId})`}>{props.children}</g>
    </svg>
  );
}
