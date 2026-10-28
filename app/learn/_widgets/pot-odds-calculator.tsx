"use client";

import { useState } from "react";
import { Field, Line, Tag, TextButton } from "@/components/doc";
import { Row, WidgetFrame } from "../_components/widget-frame";
import { callEV, impliedOddsNeeded, outsEquity, potOddsRatio, requiredEquity, unseenFor } from "./pot-odds-math";

const W = 520, H = 220, PAD_L = 48, PAD_R = 12, PAD_T = 12, PAD_B = 36;

const num = (x: number, d = 2) => (Math.abs(x) < 0.005 ? "0" : x.toFixed(d).replace(/\.?0+$/, ""));

export function PotOddsCalculator() {
  const [pot, setPot] = useState(10);
  const [bet, setBet] = useState(5);
  // Equity comes from the outs (module 2) until you type one yourself; then the typed value drives.
  const [outs, setOuts] = useState(9); // the lesson's example: 9 outs, one card to come, 46 unseen
  const [toCome, setToCome] = useState<1 | 2>(1);
  const [fromOuts, setFromOuts] = useState(true);
  const [typedPct, setTypedPct] = useState(NaN);
  const driveFromOuts = () => setFromOuts(true);

  const unseen = unseenFor(toCome);
  const outsValid = Number.isInteger(outs) && outs >= 0 && outs <= unseen;
  const eqPct = fromOuts ? (outsValid ? 100 * outsEquity(outs, toCome) : NaN) : typedPct;
  const valid = pot >= 0 && bet > 0 && eqPct >= 0 && eqPct <= 100;
  const e = eqPct / 100;
  const req = requiredEquity(pot, bet);
  const ev = callEV(e, pot, bet);
  const ratio = potOddsRatio(pot, bet);
  const implied = e > 0 && e < req ? impliedOddsNeeded(e, pot, bet) : null;

  // Chart: EV (bb) against equity 0..100%. The line runs from -B at 0% to P + B at 100%.
  const yMin = -bet, yMax = pot + bet;
  const x = (eq: number) => PAD_L + eq * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + ((yMax - v) / (yMax - yMin)) * (H - PAD_T - PAD_B);

  return (
    <WidgetFrame title="Pot odds and the EV of a call" footer="Assumes no more betting after your call: you either win the pot at showdown or lose your call.">
      <NumField label="Pot before the bet (bb)" value={pot} onChange={setPot} />
      <NumField label="Bet you face (bb)" value={bet} onChange={setBet} />
      <NumField
        label="Your outs"
        value={outs}
        onChange={(v) => {
          setOuts(v);
          driveFromOuts();
        }}
      />
      <div className="l field" role="group" aria-label="Cards to come">
        <span>Cards to come</span>
        <span>
          {([1, 2] as const).map((n) => (
            <TextButton
              key={n}
              pressed={toCome === n}
              onClick={() => {
                setToCome(n);
                driveFromOuts();
              }}
            >
              [{n === 1 ? "1: turn, 46 unseen" : "2: flop, 47 unseen"}]
            </TextButton>
          ))}
        </span>
      </div>
      <NumField
        label="Your equity (%)"
        value={fromOuts && Number.isFinite(eqPct) ? Number(eqPct.toFixed(2)) : eqPct}
        onChange={(v) => {
          setTypedPct(v);
          setFromOuts(false);
        }}
        step={0.1}
      />
      <Line>
        {!fromOuts ? (
          <span>
            <span className="text-muted">Equity typed directly; the outs are ignored.</span> <TextButton onClick={driveFromOuts}>[use outs]</TextButton>
          </span>
        ) : outsValid ? (
          <span className="text-muted">
            Equity set by the outs:{" "}
            {toCome === 1 ? `${num(outs)} / ${unseen}` : `1 − (${unseen} − ${num(outs)})/${unseen} × (${unseen - 1} − ${num(outs)})/${unseen - 1}`}. Type an equity to override it.
          </span>
        ) : null}
      </Line>
      {!valid ? (
        <Line>
          <Tag>
            {fromOuts && !outsValid
              ? `Use a whole number of outs from 0 to ${unseen}.`
              : "Use a pot of 0 or more, a bet above 0 and an equity from 0 to 100%."}
          </Tag>
        </Line>
      ) : (
        <>
          <div aria-live="polite">
            <Row label="Pot odds">
              <span className="text-muted">
                ({num(pot)} + {num(bet)}) : {num(bet)}
              </span>{" "}
              {num(ratio)} to 1
            </Row>
            <Row label="Required equity">
              <span className="text-muted">
                {num(bet)} / ({num(pot)} + 2 × {num(bet)})
              </span>{" "}
              <span className="inv">{(100 * req).toFixed(1)}%</span>
            </Row>
            <Row label="EV of calling">
              <span className="text-muted">
                {num(e, 3)} × {num(pot + bet)} − {num(1 - e, 3)} × {num(bet)}
              </span>{" "}
              <span className={ev >= 0 ? "text-green" : "text-red"}>
                {ev >= 0 ? "+" : "−"}
                {Math.abs(ev).toFixed(2)} bb
              </span>
            </Row>
            <Row label="Verdict">
              {Math.abs(e - req) < 1e-9 ? "Break-even: calling and folding are worth the same." : e > req ? "Call: you have more equity than the call needs." : "Fold, unless you expect to win more later (implied odds)."}
            </Row>
            {implied !== null && (
              <Row label="Implied odds needed (next section)">
                <span className="text-muted">
                  {num(bet)} × {num(1 - e, 3)} / {num(e, 3)} − {num(pot + bet)}
                </span>{" "}
                {implied.toFixed(2)} bb more when you hit
              </Row>
            )}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`EV of calling against equity. Break-even at ${(100 * req).toFixed(1)}% equity.`}>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={PAD_T} y2={H - PAD_B} className="stroke-faint" />
                <text x={x(t)} y={H - PAD_B + 16} textAnchor="middle" className="fill-muted text-[10px]">
                  {t * 100}%
                </text>
              </g>
            ))}
            <text x={(PAD_L + W - PAD_R) / 2} y={H - 4} textAnchor="middle" className="fill-muted text-[10px]">
              your equity
            </text>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} className="stroke-muted" />
            <text x={PAD_L - 6} y={y(0) + 4} textAnchor="end" className="fill-muted text-[10px]">0</text>
            <text x={PAD_L - 6} y={y(yMax) + 8} textAnchor="end" className="fill-muted text-[10px]">+{num(yMax, 1)}</text>
            <text x={PAD_L - 6} y={y(yMin)} textAnchor="end" className="fill-muted text-[10px]">−{num(bet, 1)}</text>
            <text x={12} y={(PAD_T + H - PAD_B) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(PAD_T + H - PAD_B) / 2})`} className="fill-muted text-[10px]">
              EV (bb)
            </text>
            <line x1={x(0)} y1={y(-bet)} x2={x(1)} y2={y(pot + bet)} className="stroke-ink" strokeWidth={2} />
            <line x1={x(req)} x2={x(req)} y1={PAD_T} y2={H - PAD_B} strokeDasharray="4 3" className="stroke-ink" />
            <text x={x(req) + 4} y={PAD_T + 10} className="fill-ink text-[10px]">
              break-even {(100 * req).toFixed(1)}%
            </text>
            <circle cx={x(e)} cy={y(ev)} r={5} className={ev >= 0 ? "fill-green" : "fill-red"} />
          </svg>
        </>
      )}
    </WidgetFrame>
  );
}

function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <Field
      label={label}
      type="number"
      min={0}
      step={step}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
    />
  );
}
