"use client";

import { useState } from "react";
import { WidgetFrame, inputClass } from "../_components/widget-frame";

// All three quantities depend only on the bet as a fraction of the pot, x = B / P:
//   bluff share that makes a call break even  B / (P + 2B) = x / (1 + 2x)
//   minimum defense frequency                 P / (P + B)  = 1 / (1 + x)
//   alpha (folds a pure bluff needs)          B / (P + B)  = x / (1 + x)
const bluffShare = (x: number) => x / (1 + 2 * x);
const mdf = (x: number) => 1 / (1 + x);
const alpha = (x: number) => x / (1 + x);

const PRESET_FRACTIONS = [0.25, 1 / 3, 0.5, 0.6, 0.75, 1, 1.5, 2];
const presetLabel = (x: number) => (Math.abs(x - 1 / 3) < 1e-9 ? "⅓" : `${Math.round(x * 100)}%`);

const pct = (v: number) => `${(100 * v).toFixed(1)}%`;

// Chart geometry: bet size from 0 to 3× pot on x, 0–100% on y.
const W = 520, H = 220, L = 40, R = 12, T = 12, B = 34;
const X_MAX = 3;
const sx = (x: number) => L + (x / X_MAX) * (W - L - R);
const sy = (v: number) => T + (1 - v) * (H - T - B);
const path = (f: (x: number) => number) =>
  Array.from({ length: 121 }, (_, i) => (i / 120) * X_MAX)
    .map((x, i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(f(x)).toFixed(1)}`)
    .join(" ");

const LINES = [
  { f: mdf, label: "MDF", color: "stroke-sky-600 dark:stroke-sky-400", dot: "fill-sky-600 dark:fill-sky-400" },
  { f: alpha, label: "α (fold % a bluff needs)", color: "stroke-amber-600 dark:stroke-amber-400", dot: "fill-amber-600 dark:fill-amber-400" },
  { f: bluffShare, label: "Bluff share of a balanced bet", color: "stroke-emerald-600 dark:stroke-emerald-400", dot: "fill-emerald-600 dark:fill-emerald-400" },
];

export function BluffMdfCalculator() {
  const [pot, setPot] = useState("10");
  const [bet, setBet] = useState("6");

  const P = Number(pot), Bt = Number(bet);
  const valid = Number.isFinite(P) && Number.isFinite(Bt) && P > 0 && Bt > 0;
  const x = valid ? Bt / P : 0;

  return (
    <WidgetFrame
      title="Bet size → bluff share, MDF and alpha"
      footer="All three numbers depend only on the bet as a fraction of the pot. The pot is measured before the bet. The AKQ row uses the game from this lesson: the bettor holds A or Q with equal chance and the caller always holds K."
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Pot before the bet (bb)</span>
          <input className={`${inputClass} w-28`} inputMode="decimal" value={pot} onChange={(e) => setPot(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Bet (bb)</span>
          <input className={`${inputClass} w-28`} inputMode="decimal" value={bet} onChange={(e) => setBet(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-1">
          {PRESET_FRACTIONS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setBet(String(Math.round(f * (valid ? P : 10) * 100) / 100))}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {presetLabel(f)} pot
            </button>
          ))}
        </div>
      </div>

      {!valid ? (
        <p className="mt-4 text-red-600 dark:text-red-400">Enter a positive pot and a positive bet.</p>
      ) : (
        <>
          <table className="mt-4 w-full text-sm">
            <tbody className="[&_td]:py-1">
              <tr>
                <td className="text-zinc-500">Bet as a fraction of the pot</td>
                <td className="font-mono text-zinc-500">r = B / P</td>
                <td className="text-right font-mono tabular-nums">{pct(x)}</td>
              </tr>
              <tr>
                <td>Caller&apos;s required equity = bluff share s that makes calling break even</td>
                <td className="font-mono text-zinc-500">s = B / (P + 2B)</td>
                <td className="text-right font-mono font-semibold tabular-nums">{pct(bluffShare(x))}</td>
              </tr>
              <tr>
                <td className="text-zinc-500">Bluffs : value bets in that range</td>
                <td className="font-mono text-zinc-500">s / (1 − s) = B / (P + B)</td>
                <td className="text-right font-mono tabular-nums">1 bluff : {((1 - bluffShare(x)) / bluffShare(x)).toFixed(2)} value bets</td>
              </tr>
              <tr>
                <td>Minimum defense frequency (MDF)</td>
                <td className="font-mono text-zinc-500">P / (P + B)</td>
                <td className="text-right font-mono font-semibold tabular-nums">{pct(mdf(x))}</td>
              </tr>
              <tr>
                <td>Alpha: how often a pure bluff must work</td>
                <td className="font-mono text-zinc-500">B / (P + B)</td>
                <td className="text-right font-mono font-semibold tabular-nums">{pct(alpha(x))}</td>
              </tr>
              <tr>
                <td className="text-zinc-500">AKQ game: bettor bluffs Q / caller calls K</td>
                <td className="font-mono text-zinc-500">B/(P+B), P/(P+B)</td>
                <td className="text-right font-mono tabular-nums">
                  {pct(alpha(x))} / {pct(mdf(x))}
                </td>
              </tr>
            </tbody>
          </table>

          <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label="MDF, alpha and bluff share as the bet grows from 0 to 3 times the pot">
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="stroke-zinc-200 dark:stroke-zinc-800" />
                <text x={L - 6} y={sy(v) + 4} textAnchor="end" className="fill-zinc-500 text-[10px]">
                  {v * 100}%
                </text>
              </g>
            ))}
            {[0, 0.5, 1, 1.5, 2, 2.5, 3].map((t) => (
              <text key={t} x={sx(t)} y={H - B + 14} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                {t}×
              </text>
            ))}
            <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="fill-zinc-500 text-[10px]">
              bet size (× pot)
            </text>
            {LINES.map((l) => (
              <path key={l.label} d={path(l.f)} fill="none" strokeWidth={2} className={l.color} />
            ))}
            {x <= X_MAX && (
              <>
                <line x1={sx(x)} x2={sx(x)} y1={T} y2={H - B} className="stroke-zinc-400" strokeDasharray="3 3" />
                {LINES.map((l) => (
                  <circle key={l.label} cx={sx(x)} cy={sy(l.f(x))} r={4} className={l.dot} />
                ))}
              </>
            )}
          </svg>
          <div className="mt-1 flex flex-wrap gap-4 text-xs">
            {LINES.map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <svg width="16" height="4" aria-hidden="true">
                  <line x1="0" x2="16" y1="2" y2="2" strokeWidth={3} className={l.color} />
                </svg>
                {l.label}
              </span>
            ))}
          </div>
        </>
      )}
    </WidgetFrame>
  );
}
