"use client";

import { useMemo, useState } from "react";
import { WidgetFrame, buttonClass, inputClass } from "@/app/learn/_components/widget-frame";
import { parseCards } from "@/lib/poker/cards";
import { parseRange } from "@/lib/poker/range";
import { flopMatchup, type SideResult } from "./flop-range-advantage-math";

// Example ranges from module 7 (starting points, not solver output).
const RAISER_RANGE = "22+, A2s+, K9s+, QTs+, JTs, T9s, 98s, 87s, 76s, ATo+, KQo";
const CALLER_RANGE =
  "22-JJ, A2s-AQs, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 64s+, 53s+, 43s, ATo-AQo, KTo+, QTo+, JTo, T9o, 98o, 87o";

const FLOPS = [
  { cards: "Ks7d2c", label: "K-7-2 rainbow" },
  { cards: "AsKd4c", label: "A-K-4 rainbow" },
  { cards: "8s8d3c", label: "8-8-3 paired" },
  { cards: "Qh9h4h", label: "Q-9-4 monotone" },
  { cards: "7h6h5c", label: "7-6-5 two-tone" },
  { cards: "Jc9c8d", label: "J-9-8 two-tone" },
];

const BUCKETS = [
  { min: 0.8, label: "≥ 80%", color: "bg-emerald-600" },
  { min: 0.5, label: "50–80%", color: "bg-emerald-300 dark:bg-emerald-700" },
  { min: 0.2, label: "20–50%", color: "bg-zinc-300 dark:bg-zinc-600" },
  { min: 0, label: "< 20%", color: "bg-zinc-100 dark:bg-zinc-800" },
];

function buckets(side: SideResult): number[] {
  const counts = [0, 0, 0, 0];
  for (const e of side.perCombo) counts[BUCKETS.findIndex((b) => e >= b.min)]++;
  return counts.map((c) => c / side.combos);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Two ranges on a flop → each side's exact equity and how much of each range is strong (≥ 80% equity). */
export function FlopRangeAdvantage() {
  const [flop, setFlop] = useState(FLOPS[0].cards);
  const [flopText, setFlopText] = useState(FLOPS[0].cards);
  const [rangeA, setRangeA] = useState(RAISER_RANGE);
  const [rangeB, setRangeB] = useState(CALLER_RANGE);
  const [applied, setApplied] = useState({ a: RAISER_RANGE, b: CALLER_RANGE });

  const result = useMemo(() => {
    try {
      const cards = parseCards(flop);
      const m = flopMatchup(parseRange(applied.a), parseRange(applied.b), cards);
      return { ok: true as const, m };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [flop, applied]);

  const sides = result.ok
    ? [
        { name: "Preflop raiser", side: result.m.a },
        { name: "Caller", side: result.m.b },
      ]
    : [];

  return (
    <WidgetFrame
      title="Range vs range on the flop"
      footer="Exact: every pair of combos that share no card, with every possible turn and river (990 per pair of combos). A combo's equity is its average share of the pot against the whole opposing range. “Strong” = at least 80% equity."
    >
      <div className="flex flex-wrap gap-1.5">
        {FLOPS.map((f) => (
          <button
            key={f.cards}
            type="button"
            onClick={() => {
              setFlop(f.cards);
              setFlopText(f.cards);
            }}
            className={`rounded-md border px-2 py-1 text-xs ${
              flop === f.cards ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <span className="font-mono">{f.cards}</span> · {f.label}
          </button>
        ))}
      </div>

      <form
        className="mt-3 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFlop(flopText.trim());
          setApplied({ a: rangeA, b: rangeB });
        }}
      >
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-xs text-zinc-500">Flop</span>
          <input className={`${inputClass} w-32`} value={flopText} onChange={(e) => setFlopText(e.target.value)} aria-label="Flop cards" />
        </label>
        <label className="flex items-start gap-2">
          <span className="w-28 shrink-0 pt-1 text-xs text-zinc-500">Preflop raiser</span>
          <textarea className={`${inputClass} min-h-12 w-full text-xs`} value={rangeA} onChange={(e) => setRangeA(e.target.value)} />
        </label>
        <label className="flex items-start gap-2">
          <span className="w-28 shrink-0 pt-1 text-xs text-zinc-500">Caller</span>
          <textarea className={`${inputClass} min-h-12 w-full text-xs`} value={rangeB} onChange={(e) => setRangeB(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass}>
            Compute
          </button>
          <button
            type="button"
            className="text-xs text-zinc-500 underline"
            onClick={() => {
              setRangeA(RAISER_RANGE);
              setRangeB(CALLER_RANGE);
              setApplied({ a: RAISER_RANGE, b: CALLER_RANGE });
            }}
          >
            Reset ranges
          </button>
        </div>
      </form>

      {result.ok ? (
        <div className="mt-4 grid gap-4">
          <table className="w-full border-collapse font-mono tabular-nums">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-2 font-normal" />
                <th className="py-1 pr-2 font-normal">Combos left</th>
                <th className="py-1 pr-2 font-normal">Equity</th>
                <th className="py-1 font-normal">Strong (≥ 80%)</th>
              </tr>
            </thead>
            <tbody>
              {sides.map(({ name, side }) => {
                const strong = buckets(side)[0];
                return (
                  <tr key={name} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1 pr-2 font-sans">{name}</td>
                    <td className="py-1 pr-2">{side.combos}</td>
                    <td className="py-1 pr-2 font-semibold">{pct(side.equity)}</td>
                    <td className="py-1">
                      {pct(strong)} ({Math.round(strong * side.combos)} combos)
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="grid gap-2">
            <p className="text-xs text-zinc-500">Each range split by its combos&apos; own equity</p>
            {sides.map(({ name, side }) => (
              <div key={name} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-xs">{name}</span>
                <div className="flex h-4 w-full overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
                  {buckets(side).map((share, i) => (
                    <div key={i} className={BUCKETS[i].color} style={{ width: `${share * 100}%` }} title={`${BUCKETS[i].label}: ${pct(share)}`} />
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
              {BUCKETS.map((b) => (
                <span key={b.label} className="flex items-center gap-1">
                  <span className={`inline-block h-3 w-3 rounded-sm border border-zinc-300 dark:border-zinc-700 ${b.color}`} /> {b.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-red-600">{result.error}</p>
      )}
    </WidgetFrame>
  );
}
