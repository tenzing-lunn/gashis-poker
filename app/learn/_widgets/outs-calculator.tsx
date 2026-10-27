"use client";

import { useState } from "react";
import { WidgetFrame, inputClass } from "../_components/widget-frame";
import { oddsAgainst, oneCard, twoCards } from "./outs-math";

type Spot = "turn" | "river" | "both";

const SPOTS: { id: Spot; label: string }[] = [
  { id: "turn", label: "On the flop, next card only (47 unseen)" },
  { id: "river", label: "On the turn, river only (46 unseen)" },
  { id: "both", label: "On the flop, seeing turn and river (all-in)" },
];

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

export function OutsCalculator() {
  const [outs, setOuts] = useState(9);
  const [spot, setSpot] = useState<Spot>("both");

  const o = Math.max(0, Math.min(20, Math.round(outs)));
  const exact = spot === "turn" ? oneCard(o, 47) : spot === "river" ? oneCard(o, 46) : twoCards(o, 47);
  const thumb = (spot === "both" ? 4 : 2) * o;
  const patch = spot === "both" && o > 8 ? 3 * o + 8 : null;
  const formula =
    spot === "turn"
      ? `${o} / 47`
      : spot === "river"
        ? `${o} / 46`
        : `1 − (${47 - o}/47) × (${46 - o}/46)`;

  return (
    <WidgetFrame title="Outs calculator: exact vs rule of thumb" footer="Unseen cards are counted from your own view: 52 minus your 2 hole cards and the board.">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Outs (0–20)</span>
          <input
            className={`${inputClass} w-20`}
            type="number"
            min={0}
            max={20}
            value={outs}
            onChange={(e) => setOuts(Number(e.target.value))}
          />
        </label>
        <input type="range" min={0} max={20} value={o} onChange={(e) => setOuts(Number(e.target.value))} aria-label="Outs" className="w-48" />
      </div>
      <fieldset className="mt-3 flex flex-col gap-1">
        <legend className="mb-1 text-zinc-500">Cards to come</legend>
        {SPOTS.map((s) => (
          <label key={s.id} className="flex items-center gap-2">
            <input type="radio" name="outs-spot" checked={spot === s.id} onChange={() => setSpot(s.id)} />
            {s.label}
          </label>
        ))}
      </fieldset>
      <table className="mt-4 w-full text-sm" aria-live="polite">
        <tbody className="[&_td]:py-1">
          <tr>
            <td className="text-zinc-500">Exact</td>
            <td className="font-mono">{formula}</td>
            <td className="text-right font-mono font-semibold tabular-nums">{pct(exact)}</td>
          </tr>
          <tr>
            <td className="text-zinc-500">As odds against</td>
            <td />
            <td className="text-right font-mono tabular-nums">{o === 0 ? "never hits" : `${oddsAgainst(exact).toFixed(2)} to 1`}</td>
          </tr>
          <tr>
            <td className="text-zinc-500">Rule of {spot === "both" ? 4 : 2}</td>
            <td className="font-mono">
              {spot === "both" ? 4 : 2} × {o}
            </td>
            <td className="text-right font-mono tabular-nums">
              {thumb}% <span className="text-zinc-500">({signed(thumb - 100 * exact)} pts)</span>
            </td>
          </tr>
          {patch !== null && (
            <tr>
              <td className="text-zinc-500">Patch above 8 outs</td>
              <td className="font-mono">3 × {o} + 8</td>
              <td className="text-right font-mono tabular-nums">
                {patch}% <span className="text-zinc-500">({signed(patch - 100 * exact)} pts)</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </WidgetFrame>
  );
}

function signed(x: number): string {
  const r = Math.round(x * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(1)}`;
}
