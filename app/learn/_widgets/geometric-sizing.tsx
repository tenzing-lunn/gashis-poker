"use client";

import { useState } from "react";
import { Field, Line, Tag, TextButton } from "@/components/doc";
import { NumTable, WidgetFrame } from "@/app/learn/_components/widget-frame";
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
      <Field label="Pot P (bb)" inputMode="decimal" value={pot} onChange={(e) => setPot(e.target.value)} />
      <Field label="Effective stack behind S (bb)" inputMode="decimal" value={stack} onChange={(e) => setStack(e.target.value)} />
      <div className="l field" role="group" aria-label="Streets">
        <span>
          Streets <span className="normal-case">n</span>
        </span>
        <span>
          {[1, 2, 3].map((n) => (
            <TextButton key={n} pressed={streets === n} onClick={() => setStreets(n)}>
              [{n}]
            </TextButton>
          ))}
        </span>
      </div>

      {plan ? (
        <>
          <Line>
            <span>
              SPR = {fmt(S / P)}. Bet <span className="inv">{fmt(plan.fraction * 100)}%</span> of the pot on each of {streets} street{streets > 1 ? "s" : ""}.
            </span>
          </Line>
          <NumTable
            prefixTitle
            head={["Street", "Pot before", "Bet", "Pot after call", "Stack left"]}
            rows={plan.rows.map((r, i) => ({
              key: String(i),
              cells: [i + 1, fmt(i === 0 ? P : plan.rows[i - 1].potAfter), fmt(r.bet), fmt(r.potAfter), fmt(r.stackAfter)],
            }))}
          />
        </>
      ) : (
        <Line>
          <Tag>Enter a pot and a stack greater than 0.</Tag>
        </Line>
      )}
    </WidgetFrame>
  );
}
