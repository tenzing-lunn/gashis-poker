"use client";

import { useState } from "react";
import { WidgetFrame, buttonClass, inputClass } from "../_components/widget-frame";
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
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="pb-1 font-normal">Player</th>
            <th className="pb-1 font-normal">Chips put in (bb)</th>
            <th className="pb-1 font-normal">Folded?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name}>
              <td className="py-1 font-mono">{r.name}</td>
              <td className="py-1">
                <input
                  className={`${inputClass} w-24`}
                  type="number"
                  min={0}
                  step="any"
                  value={Number.isFinite(r.amount) ? r.amount : ""}
                  onChange={(e) => update(i, { amount: e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)) })}
                  aria-label={`Chips put in by player ${r.name}`}
                />
              </td>
              <td className="py-1">
                <input type="checkbox" checked={r.folded} onChange={(e) => update(i, { folded: e.target.checked })} aria-label={`Player ${r.name} folded`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={rows.length >= NAMES.length}
          onClick={() => setRows((r) => [...r, { name: NAMES[r.length], amount: 0, folded: false }])}
        >
          Add player
        </button>
        <button type="button" className={buttonClass} disabled={rows.length <= 2} onClick={() => setRows((r) => r.slice(0, -1))}>
          Remove last
        </button>
      </div>
      <div className="mt-4 space-y-1" aria-live="polite">
        {pots.length === 0 ? (
          <p className="text-zinc-500">Nobody still in the hand has put chips in.</p>
        ) : (
          pots.map((p, i) => (
            <p key={i}>
              <span className="font-semibold">{i === 0 ? "Main pot" : `Side pot ${i}`}:</span>{" "}
              <span className="font-mono tabular-nums">{fmt(p.amount)} bb</span>
              <span className="text-zinc-500">
                {" "}
                · can be won by {p.eligible.join(", ")}
                {p.eligible.length === 1 && " (everyone else folded or is not in this layer)"}
              </span>
            </p>
          ))
        )}
        {returned && (
          <p className="text-zinc-600 dark:text-zinc-400">
            <span className="font-mono tabular-nums">{fmt(returned.amount)} bb</span> of {returned.name}&apos;s chips were never matched, so they go back to{" "}
            {returned.name} (an uncalled bet).
          </p>
        )}
        <p className="pt-1 text-xs text-zinc-500">
          Check: pots{returned ? " + returned chips" : ""} = {fmt(pots.reduce((s, p) => s + p.amount, 0) + (returned?.amount ?? 0))} bb = total put in ({fmt(total)} bb).
        </p>
      </div>
    </WidgetFrame>
  );
}
