"use client";

import { useMemo, useState } from "react";
import { BoxButton, Field, Legend, Line, Tag, TextButton } from "@/components/doc";
import { NumTable, WidgetFrame } from "@/app/learn/_components/widget-frame";
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
  { min: 0.8, label: "≥ 80%", color: "bg-ink" },
  { min: 0.5, label: "50–80%", color: "bg-muted" },
  { min: 0.2, label: "20–50%", color: "bg-faint" },
  { min: 0, label: "< 20%", color: "bg-paper" },
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
      <Line>
        <span className="flex flex-wrap gap-x-[1ch]">
          {FLOPS.map((f) => (
            <TextButton
              key={f.cards}
              pressed={flop === f.cards}
              onClick={() => {
                setFlop(f.cards);
                setFlopText(f.cards);
              }}
            >
              [<span className="normal-case">{f.cards}</span> · {f.label}]
            </TextButton>
          ))}
        </span>
      </Line>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFlop(flopText.trim());
          setApplied({ a: rangeA, b: rangeB });
        }}
      >
        <Field label="Flop" value={flopText} onChange={(e) => setFlopText(e.target.value)} aria-label="Flop cards" />
        <label className="l field">
          <span>Preflop raiser</span>
          <textarea className="min-h-12" value={rangeA} onChange={(e) => setRangeA(e.target.value)} />
        </label>
        <label className="l field">
          <span>Caller</span>
          <textarea className="min-h-12" value={rangeB} onChange={(e) => setRangeB(e.target.value)} />
        </label>
        <Line className="justify-start!">
          <BoxButton type="submit" filled>
            Compute
          </BoxButton>
          <TextButton
            onClick={() => {
              setRangeA(RAISER_RANGE);
              setRangeB(CALLER_RANGE);
              setApplied({ a: RAISER_RANGE, b: CALLER_RANGE });
            }}
          >
            [Reset ranges]
          </TextButton>
        </Line>
      </form>

      {result.ok ? (
        <>
          <NumTable
            head={["Side", "Combos left", "Equity", "Strong (≥ 80%)"]}
            rows={sides.map(({ name, side }) => {
              const strong = buckets(side)[0];
              return {
                key: name,
                cells: [
                  name,
                  side.combos,
                  <span key="eq" className="inv">
                    {pct(side.equity)}
                  </span>,
                  `${pct(strong)} (${Math.round(strong * side.combos)} combos)`,
                ],
              };
            })}
          />

          <Line className="text-muted">
            <span>Each range split by its combos&apos; own equity</span>
          </Line>
          {sides.map(({ name, side }) => (
            <Line key={name} className="flex-nowrap! items-center">
              <span className="w-[16ch] shrink-0 uppercase">{name}</span>
              <span className="flex h-4 min-w-0 flex-1 border border-ink">
                {buckets(side).map((share, i) => (
                  <span key={i} className={BUCKETS[i].color} style={{ width: `${share * 100}%` }} title={`${BUCKETS[i].label}: ${pct(share)}`} />
                ))}
              </span>
            </Line>
          ))}
          <Legend>
            <span className="flex flex-wrap gap-x-[2ch]">
              {BUCKETS.map((b) => (
                <span key={b.label} className="flex items-center gap-[1ch]">
                  <span className={`inline-block h-3 w-3 border border-ink ${b.color}`} /> {b.label}
                </span>
              ))}
            </span>
          </Legend>
        </>
      ) : (
        <Line>
          <Tag>{result.error}</Tag>
        </Line>
      )}
    </WidgetFrame>
  );
}
