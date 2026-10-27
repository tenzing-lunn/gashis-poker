"use client";

import { useState } from "react";
import { Choice, Field, Line } from "@/components/doc";
import { Row, WidgetFrame } from "../_components/widget-frame";
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
      <Field label="Outs (0–20)" type="number" min={0} max={20} value={outs} onChange={(e) => setOuts(Number(e.target.value))} />
      <div className="l field">
        <span />
        <input type="range" min={0} max={20} value={o} onChange={(e) => setOuts(Number(e.target.value))} aria-label="Outs" className="accent-ink border-dotted! border-muted!" />
      </div>
      <fieldset>
        <Line as="legend" className="uppercase">
          Cards to come
        </Line>
        {SPOTS.map((s) => (
          <Line key={s.id}>
            <Choice name="outs-spot" checked={spot === s.id} onChange={() => setSpot(s.id)}>
              {s.label}
            </Choice>
          </Line>
        ))}
      </fieldset>
      <div aria-live="polite">
        <Row label="Exact">
          <span className="text-muted">{formula}</span> <span className="inv">{pct(exact)}</span>
        </Row>
        <Row label="As odds against">{o === 0 ? "never hits" : `${oddsAgainst(exact).toFixed(2)} to 1`}</Row>
        <Row label={`Rule of ${spot === "both" ? 4 : 2}`}>
          <span className="text-muted">
            {spot === "both" ? 4 : 2} × {o}
          </span>{" "}
          {thumb}% <span className="text-muted">({signed(thumb - 100 * exact)} pts)</span>
        </Row>
        {patch !== null && (
          <Row label="Patch above 8 outs">
            <span className="text-muted">3 × {o} + 8</span> {patch}% <span className="text-muted">({signed(patch - 100 * exact)} pts)</span>
          </Row>
        )}
      </div>
    </WidgetFrame>
  );
}

function signed(x: number): string {
  const r = Math.round(x * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(1)}`;
}
