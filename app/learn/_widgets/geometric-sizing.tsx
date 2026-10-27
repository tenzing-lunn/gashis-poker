"use client";

import { useState } from "react";
import { WidgetFrame, inputClass } from "@/app/learn/_components/widget-frame";
import { geometricPlan } from "./geometric-sizing-math";

const fmt = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Pot, effective stack and number of streets → the geometric bet fraction and the street-by-street plan. */
export function GeometricSizing() {
  const [pot, setPot] = useState("100");
  const [stack, setStack] = useState("300");
  const [streets, setStreets] = useState(3);

  const P = Number(pot), S = Number(stack);
  const valid = Number.isFinite(P) && Number.isFinite(S) && P > 0 && S > 0;
  const plan = valid ? geometricPlan(P, S, streets) : null;

  return (
    <WidgetFrame
      title="Geometric bet sizing"
      footer="r = ((1 + 2S/P)^(1/n) − 1) / 2, where ^(1/n) is the n-th root. Each bet is r times the pot at that moment and is called. Values rounded to 0.1."
    >
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Pot P (bb)</span>
          <input className={`${inputClass} w-24`} inputMode="decimal" value={pot} onChange={(e) => setPot(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Effective stack S (bb)</span>
          <input className={`${inputClass} w-24`} inputMode="decimal" value={stack} onChange={(e) => setStack(e.target.value)} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Streets n</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Streets">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={streets === n}
                onClick={() => setStreets(n)}
                className={`rounded-md border px-3 py-1 font-mono ${
                  streets === n ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {plan ? (
        <>
          <p className="mt-4 text-base">
            SPR = {fmt(S / P)}. Bet <span className="font-mono font-semibold">{fmt(plan.fraction * 100)}%</span> of the pot on each of {streets}{" "}
            street{streets > 1 ? "s" : ""}.
          </p>
          <table className="mt-3 w-full border-collapse font-mono tabular-nums">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-2 font-normal">Street</th>
                <th className="py-1 pr-2 font-normal">Pot before</th>
                <th className="py-1 pr-2 font-normal">Bet</th>
                <th className="py-1 pr-2 font-normal">Pot after call</th>
                <th className="py-1 font-normal">Stack left</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r, i) => (
                <tr key={i} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1 pr-2">{i + 1}</td>
                  <td className="py-1 pr-2">{fmt(i === 0 ? P : plan.rows[i - 1].potAfter)}</td>
                  <td className="py-1 pr-2">{fmt(r.bet)}</td>
                  <td className="py-1 pr-2">{fmt(r.potAfter)}</td>
                  <td className="py-1">{fmt(r.stackAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="mt-4 text-red-600">Enter a pot and a stack greater than 0.</p>
      )}
    </WidgetFrame>
  );
}
