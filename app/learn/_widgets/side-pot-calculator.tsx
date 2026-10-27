"use client";

import { useState } from "react";
import { BoxButton, Choice, Legend, Line } from "@/components/doc";
import { WidgetFrame, inputClass } from "../_components/widget-frame";
import { splitPots, type Contribution } from "./side-pot-math";

const NAMES = ["A", "B", "C", "D", "E", "F"];

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

export function SidePotCalculator() {
  const [rows, setRows] = useState<Contribution[]>([
    { name: "A", amount: 20, folded: false },
    { name: "B", amount: 50, folded: false },
    { name: "C", amount: 100, folded: false },
    { name: "D", amount: 10, folded: true },
  ]);

  const update = (i: number, patch: Partial<Contribution>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const { pots, returned } = splitPots(rows);
  const total = rows.reduce((s, r) => s + Math.max(0, r.amount), 0);

  return (
    <WidgetFrame
      title="Side-pot calculator"
      footer="Enter the total each player put in over the whole hand. Folded players' chips stay in the pot, but they cannot win it."
    >
      <Line className="text-muted uppercase">
        <span>Player</span>
        <span>Chips put in (bb) · folded?</span>
      </Line>
      {rows.map((r, i) => (
        <div key={r.name} className="l field">
          <span>{r.name}</span>
          <span className="flex flex-wrap items-baseline gap-x-[2ch]">
            <input
              className={`${inputClass} w-[10ch]!`}
              type="number"
              min={0}
              step="any"
              value={Number.isFinite(r.amount) ? r.amount : ""}
              onChange={(e) => update(i, { amount: e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)) })}
              aria-label={`Chips put in by player ${r.name}`}
            />
            <Choice type="checkbox" checked={r.folded} onChange={(e) => update(i, { folded: e.target.checked })} aria-label={`Player ${r.name} folded`}>
              Folded
            </Choice>
          </span>
        </div>
      ))}
      <Line className="justify-start!">
        <BoxButton disabled={rows.length >= NAMES.length} onClick={() => setRows((r) => [...r, { name: NAMES[r.length], amount: 0, folded: false }])}>
          Add player
        </BoxButton>
        <BoxButton disabled={rows.length <= 2} onClick={() => setRows((r) => r.slice(0, -1))}>
          Remove last
        </BoxButton>
      </Line>
      <div aria-live="polite">
        {pots.length === 0 ? (
          <Line className="text-muted">
            <span>Nobody still in the hand has put chips in.</span>
          </Line>
        ) : (
          pots.map((p, i) => (
            <Line key={i}>
              <span>
                <span className="uppercase">{i === 0 ? "Main pot" : `Side pot ${i}`}:</span> <span className="inv">{fmt(p.amount)} bb</span>
                <span className="text-muted">
                  {" "}
                  · can be won by {p.eligible.join(", ")}
                  {p.eligible.length === 1 && " (everyone else folded or is not in this layer)"}
                </span>
              </span>
            </Line>
          ))
        )}
        {returned && (
          <Line className="text-muted">
            <span>
              {fmt(returned.amount)} bb of {returned.name}&apos;s chips were never matched, so they go back to {returned.name} (an uncalled bet).
            </span>
          </Line>
        )}
        <Legend>
          <span>
            Check: pots{returned ? " + returned chips" : ""} = {fmt(pots.reduce((s, p) => s + p.amount, 0) + (returned?.amount ?? 0))} bb = total put in ({fmt(total)} bb).
          </span>
        </Legend>
      </div>
    </WidgetFrame>
  );
}
