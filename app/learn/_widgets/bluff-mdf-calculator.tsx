"use client";

import { useState } from "react";
import { Field, Legend, Line, Tag, TextButton } from "@/components/doc";
import { Row, WidgetFrame } from "../_components/widget-frame";

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

// Ink only: the three curves differ by dash and tone, not hue.
const LINES = [
  { f: mdf, label: "MDF", color: "stroke-ink", dot: "fill-ink", dash: undefined },
  { f: alpha, label: "α (fold % a bluff needs)", color: "stroke-ink", dot: "fill-ink", dash: "6 4" },
  { f: bluffShare, label: "Bluff share of a balanced bet", color: "stroke-muted", dot: "fill-muted", dash: undefined },
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
      <Field label="Pot before the bet (bb)" inputMode="decimal" value={pot} onChange={(e) => setPot(e.target.value)} />
      <Field label="Bet (bb)" inputMode="decimal" value={bet} onChange={(e) => setBet(e.target.value)} />
      <Line>
        <span className="flex flex-wrap gap-x-[1ch]">
          {PRESET_FRACTIONS.map((f) => (
            <TextButton key={f} onClick={() => setBet(String(Math.round(f * (valid ? P : 10) * 100) / 100))}>
              [{presetLabel(f)} pot]
            </TextButton>
          ))}
        </span>
      </Line>

      {!valid ? (
        <Line>
          <Tag>Enter a positive pot and a positive bet.</Tag>
        </Line>
      ) : (
        <>
          <Row label="Bet as a fraction of the pot">
            <span className="text-muted normal-case">r = B / P</span> {pct(x)}
          </Row>
          <Row label={<>Caller&apos;s required equity = bluff share <span className="normal-case">s</span> that makes calling break even</>}>
            <span className="text-muted normal-case">s = B / (P + 2B)</span> <span className="inv">{pct(bluffShare(x))}</span>
          </Row>
          <Row label="Bluffs : value bets in that range">
            <span className="text-muted normal-case">s / (1 − s) = B / (P + B)</span> 1 bluff : {((1 - bluffShare(x)) / bluffShare(x)).toFixed(2)} value bets
          </Row>
          <Row label="Minimum defense frequency (MDF)">
            <span className="text-muted">P / (P + B)</span> <span className="inv">{pct(mdf(x))}</span>
          </Row>
          <Row label="Alpha: how often a pure bluff must work">
            <span className="text-muted">B / (P + B)</span> <span className="inv">{pct(alpha(x))}</span>
          </Row>
          <Row label="AKQ game: bettor bluffs Q / caller calls K">
            <span className="text-muted">B/(P+B), P/(P+B)</span> {pct(alpha(x))} / {pct(mdf(x))}
          </Row>

          <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="MDF, alpha and bluff share as the bet grows from 0 to 3 times the pot">
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="stroke-faint" />
                <text x={L - 6} y={sy(v) + 4} textAnchor="end" className="fill-muted text-[10px]">
                  {v * 100}%
                </text>
              </g>
            ))}
            {[0, 0.5, 1, 1.5, 2, 2.5, 3].map((t) => (
              <text key={t} x={sx(t)} y={H - B + 14} textAnchor="middle" className="fill-muted text-[10px]">
                {t}×
              </text>
            ))}
            <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="fill-muted text-[10px]">
              bet size (× pot)
            </text>
            {LINES.map((l) => (
              <path key={l.label} d={path(l.f)} fill="none" strokeWidth={2} strokeDasharray={l.dash} className={l.color} />
            ))}
            {x <= X_MAX && (
              <>
                <line x1={sx(x)} x2={sx(x)} y1={T} y2={H - B} className="stroke-muted" strokeDasharray="3 3" />
                {LINES.map((l) => (
                  <circle key={l.label} cx={sx(x)} cy={sy(l.f(x))} r={4} className={l.dot} />
                ))}
              </>
            )}
          </svg>
          <Legend>
            <span className="flex flex-wrap gap-x-[2ch]">
              {LINES.map((l) => (
                <span key={l.label} className="flex items-center gap-[1ch]">
                  <svg width="24" height="4" aria-hidden="true">
                    <line x1="0" x2="24" y1="2" y2="2" strokeWidth={2} strokeDasharray={l.dash} className={l.color} />
                  </svg>
                  {l.label}
                </span>
              ))}
            </span>
          </Legend>
        </>
      )}
    </WidgetFrame>
  );
}
