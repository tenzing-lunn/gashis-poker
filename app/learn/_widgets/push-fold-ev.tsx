"use client";

import { useMemo, useState } from "react";
import { parseCards } from "@/lib/poker/cards";
import { comboIndex } from "@/lib/poker/combinatorics";
import { monteCarloEquity } from "@/lib/poker/equity";
import { parseRange, removeDeadCards } from "@/lib/poker/range";
import { Cards } from "../_components/lesson-ui";
import { BoxButton, Field, Line, Tag, TextButton } from "@/components/doc";
import { Row, WidgetFrame } from "../_components/widget-frame";

// Heads-up, blinds 0.5 / 1 bb, no antes. The SB has S bb at the start of the hand, posts 0.5 and
// either shoves the remaining S − 0.5 or folds. EV is measured from the moment after the blinds are
// posted, so folding is worth 0 and the 0.5 already in the pot no longer counts as the SB's.
//   EV(shove) = f · 1.5 + (1 − f) · (e · 2S − (S − 0.5))
// f = share of the BB's possible hands that fold, e = SB's equity against the calling hands.

const TRIALS = 200_000;
const BB_HANDS = 1225; // C(50, 2): the BB's possible hands once the SB's two cards are known

const RANGE_PRESETS = [
  { label: "Lesson example (28.8%)", range: "22+, A2+, K9+, QT+, JT" },
  { label: "Tight (16.1%)", range: "66+, A8+, KT+, QJ" },
  { label: "Loose (42.1%)", range: "22+, A2+, K5+, Q8+, J8+, T8+, 98" },
];

function evShove(f: number, e: number, S: number): number {
  return f * 1.5 + (1 - f) * (e * 2 * S - (S - 0.5));
}

interface Query {
  hand: string;
  range: string;
}

const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;
const sign = (x: number) => (x >= 0 ? `+${x.toFixed(2)}` : `−${Math.abs(x).toFixed(2)}`);

// EV-vs-stack chart, S from 1 to 30 bb.
const W = 520, H = 180, L = 44, R = 12, T = 10, B = 30, S_MAX = 30;

export function PushFoldEv() {
  const [hand, setHand] = useState("Kh7d");
  const [range, setRange] = useState(RANGE_PRESETS[0].range);
  const [stack, setStack] = useState(10);
  const [query, setQuery] = useState<Query>({ hand: "Kh7d", range: RANGE_PRESETS[0].range });

  const calc = useMemo(() => {
    try {
      const h = parseCards(query.hand);
      if (h.length !== 2 || h[0] === h[1]) throw new Error("Your hand needs exactly two different cards, like Kh7d");
      const calls = removeDeadCards(parseRange(query.range), h);
      const f = 1 - calls.length / BB_HANDS;
      if (calls.length === 0) return { ok: true as const, h, calls: 0, f, e: 0, margin: 0 };
      const r = monteCarloEquity([[comboIndex(h[0], h[1])], calls], { trials: TRIALS, seed: 1 }).players[0];
      return { ok: true as const, h, calls: calls.length, f, e: r.equity, margin: 1.96 * r.stdErr };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [query]);

  const dirty = hand !== query.hand || range !== query.range;

  let body = null;
  if (!calc.ok) {
    body = (
      <Line>
        <Tag>{calc.error}.</Tag>
      </Line>
    );
  } else {
    const { f, e, margin } = calc;
    const ev = evShove(f, e, stack);
    const evMargin = (1 - f) * 2 * stack * margin;
    // EV is linear in S: EV(S) = 1.5f + (1 − f)(0.5 + S(2e − 1)). Break-even S where it crosses 0.
    const breakEven = e < 0.5 && f < 1 ? (1.5 * f / (1 - f) + 0.5) / (1 - 2 * e) : Infinity;
    const verdict = Math.abs(ev) <= evMargin ? "Too close to call at this precision" : ev > 0 ? "Shove beats folding" : "Fold beats shoving";

    const evs = Array.from({ length: S_MAX }, (_, i) => evShove(f, e, i + 1));
    const lo = Math.min(-1, ...evs), hi = Math.max(1, ...evs);
    const sx = (s: number) => L + ((s - 1) / (S_MAX - 1)) * (W - L - R);
    const sy = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const step = hi - lo > 8 ? 2 : hi - lo > 4 ? 1 : 0.5;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(2)));

    body = (
      <>
        <Row label="BB's calling hands left after your cards">
          {calc.calls} of {BB_HANDS}
        </Row>
        <Row label={<>Fold probability <span className="normal-case">f</span></>}>
          <span className="normal-case">
            1 − {calc.calls}/{BB_HANDS} = {pct(f)}
          </span>
        </Row>
        <Row label={<>Your equity when called <span className="normal-case">e</span></>}>
          {calc.calls ? (
            <>
              ≈ {pct(e)} <span className="text-muted">± {(100 * margin).toFixed(1)} pts</span>
            </>
          ) : (
            "never called"
          )}
        </Row>
        <Line>
          <span className="normal-case text-muted">EV(shove) = f·1.5 + (1 − f)·(e·2S − (S − 0.5))</span>
          <span>
            {pct(f)}·1.5 + {pct(1 - f)}·({e.toFixed(3)}·{2 * stack} − {stack - 0.5})
          </span>
        </Line>
        <Row label="EV of shoving, vs 0 for folding">
          <span className="inv">
            {margin > 0 ? "≈ " : ""}
            {sign(ev)} bb
          </span>
          {margin > 0 && <span className="text-muted"> ± {evMargin.toFixed(2)}</span>}
        </Row>
        <Row label={`Verdict at ${stack} bb`}>
          <span className="uppercase">{verdict}</span>
        </Row>
        <Row label="Shoving stays better than folding up to (this calling range held fixed)">
          {Number.isFinite(breakEven) ? `≈ ${breakEven.toFixed(1)} bb` : "any stack"}
        </Row>

        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="EV of shoving by stack size">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className={v === 0 ? "stroke-muted" : "stroke-faint"} />
              <text x={L - 4} y={sy(v) + 3} textAnchor="end" className="fill-muted text-[10px]">
                {v}
              </text>
            </g>
          ))}
          {[1, 5, 10, 15, 20, 25, 30].map((s) => (
            <text key={s} x={sx(s)} y={H - B + 13} textAnchor="middle" className="fill-muted text-[10px]">
              {s}
            </text>
          ))}
          <text x={(L + W - R) / 2} y={H - 3} textAnchor="middle" className="fill-muted text-[10px]">
            stack at the start of the hand (bb); EV of shoving in bb, folding = 0
          </text>
          <path
            d={evs.map((v, i) => `${i ? "L" : "M"}${sx(i + 1).toFixed(1)},${sy(v).toFixed(1)}`).join(" ")}
            fill="none"
            strokeWidth={2}
            className="stroke-ink"
          />
          <circle cx={sx(stack)} cy={sy(ev)} r={4} className="fill-ink" />
        </svg>
      </>
    );
  }

  return (
    <WidgetFrame
      title="Push/fold EV calculator (heads-up, small blind)"
      footer={`Blinds 0.5/1, no antes. The calling range is your assumption about the BB, not a solved strategy. Equity is Monte Carlo (${TRIALS.toLocaleString("en-US")} random deals, with a fixed seed: the same deals every time, so results repeat exactly); f uses exact combo counts with card removal.`}
    >
      <Line>
        <span className="flex flex-wrap gap-x-[1ch]">
          {RANGE_PRESETS.map((p) => (
            <TextButton
              key={p.label}
              pressed={query.range === p.range}
              onClick={() => {
                setRange(p.range);
                setQuery({ hand, range: p.range });
              }}
            >
              [BB calls: {p.label}]
            </TextButton>
          ))}
        </span>
      </Line>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ hand, range });
        }}
      >
        <Field label="Your hand (SB)" value={hand} onChange={(e) => setHand(e.target.value)} spellCheck={false} />
        <Field label="BB calls with" value={range} onChange={(e) => setRange(e.target.value)} spellCheck={false} />
        <Line>
          <BoxButton type="submit" filled={dirty}>
            {dirty ? "Calculate" : "Calculated"}
          </BoxButton>
        </Line>
      </form>
      <label className="l field">
        <span>Stack S</span>
        <span className="flex items-center gap-x-[2ch]">
          <input type="range" min={1} max={S_MAX} step={0.5} value={stack} onChange={(e) => setStack(Number(e.target.value))} className="min-w-0 flex-1 accent-ink border-dotted! border-muted!" />
          <span className="w-[7ch] shrink-0 text-right">{stack} bb</span>
        </span>
      </label>
      {calc.ok && (
        <Line className="text-muted">
          <span>
            Shoving <Cards hand={query.hand} /> for {stack} bb: you risk {stack - 0.5} bb more to win the 1.5 bb in the pot.
          </span>
        </Line>
      )}
      <div aria-live="polite">{body}</div>
    </WidgetFrame>
  );
}
