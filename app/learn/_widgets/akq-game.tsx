"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Field, Line, Tag, TextButton } from "@/components/doc";
import { fmt, pct } from "@/app/lab/_components/format";
import { useSolverWorker } from "@/app/lab/_components/use-solver";
import { akqBettorEv, akqBluffEv, akqCallEv, akqClosedForm } from "@/lib/gto/akq";
import type { AkqCfrResult } from "@/lib/gto/worker-protocol";
import { Row, WidgetFrame } from "../_components/widget-frame";

const ITERATIONS = 5_000;
const DEBOUNCE_MS = 250;

const parsePositive = (s: string): number | null => {
  const x = Number(s);
  return s.trim() !== "" && Number.isFinite(x) && x > 0 && x <= 1000 ? x : null;
};

const bb = (x: number) => `${fmt(x, 2)} bb`;
const signedBb = (x: number) => `${x > 0.005 ? "+" : ""}${bb(x)}`;
/** Within rounding of 0: the player is indifferent. */
const isZero = (x: number, scale: number) => Math.abs(x) < 1e-9 * scale;

// Charts: frequency 0..100% on x, EV in bb on y.
const CW = 300, CH = 160, CL = 44, CR = 12, CT = 10, CB = 30;
const sx = (f: number) => CL + f * (CW - CL - CR);

/**
 * One player's EV as their own frequency f goes from 0 to 1, with the opponent's frequency fixed.
 * The EV is linear in f, so the line runs from at0 to at1. Dashed: the equilibrium EV, which is
 * where the line lies flat when the opponent plays the equilibrium.
 */
function EvLine({ title, xName, lo, hi, at0, at1, f, eq }: { title: string; xName: string; lo: number; hi: number; at0: number; at1: number; f: number; eq: number }) {
  const sy = (v: number) => CT + (1 - (v - lo) / (hi - lo || 1)) * (CH - CT - CB);
  const yTicks = [lo, eq, hi];
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="text-[10px] uppercase text-muted">{title}</figcaption>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img" aria-label={`${title}. EV runs from ${bb(at0)} at 0% to ${bb(at1)} at 100%; at equilibrium it is ${bb(eq)}.`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={CT} y2={CH - CB} className="stroke-faint" />
            <text x={sx(t)} y={CH - CB + 12} textAnchor="middle" className="fill-muted text-[9px]">
              {t * 100}%
            </text>
          </g>
        ))}
        <text x={(CL + CW - CR) / 2} y={CH - 3} textAnchor="middle" className="fill-muted text-[9px]">
          {xName}
        </text>
        {yTicks.map((v, i) => (
          <text key={i} x={CL - 4} y={sy(v) + 3} textAnchor="end" className="fill-muted text-[9px]">
            {fmt(v, 2)}
          </text>
        ))}
        <line x1={CL} x2={CW - CR} y1={sy(eq)} y2={sy(eq)} strokeDasharray="4 3" className="stroke-muted" />
        <line x1={sx(0)} y1={sy(at0)} x2={sx(1)} y2={sy(at1)} strokeWidth={2} className="stroke-ink" />
        <circle cx={sx(f)} cy={sy(at0 + f * (at1 - at0))} r={4} className="fill-ink" />
      </svg>
    </figure>
  );
}

export function AkqGame() {
  const { run } = useSolverWorker("akq");
  const [potText, setPotText] = useState("10");
  const [betText, setBetText] = useState("10");
  // null = play the equilibrium frequency.
  const [bluffPick, setBluffPick] = useState<number | null>(null);
  const [callPick, setCallPick] = useState<number | null>(null);
  const [cfr, setCfr] = useState<AkqCfrResult | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Posts a CFR+ solve; state is only set when the worker answers.
  const solve = useCallback(
    (P: number, B: number) => {
      run({ kind: "akq", pot: P, bet: B, iterations: ITERATIONS }, (msg) => {
        if (msg.type === "done") {
          setCfr(msg.result);
          setError("");
        } else if (msg.type === "error") setError(msg.message);
      });
    },
    [run],
  );

  useEffect(() => {
    solve(10, 10);
    return () => clearTimeout(timer.current);
  }, [solve]);

  const onChange = (which: "pot" | "bet", text: string) => {
    if (which === "pot") setPotText(text);
    else setBetText(text);
    setBluffPick(null);
    setCallPick(null);
    const P = parsePositive(which === "pot" ? text : potText), B = parsePositive(which === "bet" ? text : betText);
    clearTimeout(timer.current);
    if (P === null || B === null) return;
    timer.current = setTimeout(() => solve(P, B), DEBOUNCE_MS);
  };

  const P = parsePositive(potText), B = parsePositive(betText);

  return (
    <WidgetFrame
      title="The AKQ game: bluff and call frequencies"
      footer="The game from this lesson: the caller always holds the K, the bettor holds the A or the Q with equal chance, and the bettor always bets the A. EVs are per hand, counted from now on, so the pot belongs to nobody yet and the two EVs add up to P. On each chart the dashed line is the equilibrium EV: when the other player plays their equilibrium frequency, the solid line lies flat on it, because every frequency earns the same."
    >
      <Field label="Pot P (bb)" inputMode="decimal" value={potText} onChange={(e) => onChange("pot", e.target.value)} />
      <Field label="Bet B (bb)" inputMode="decimal" value={betText} onChange={(e) => onChange("bet", e.target.value)} />
      {P === null || B === null ? (
        <Line>
          <Tag>Enter a pot and a bet above 0 (up to 1,000).</Tag>
        </Line>
      ) : (
        <AkqBody P={P} B={B} bluffPick={bluffPick} callPick={callPick} setBluffPick={setBluffPick} setCallPick={setCallPick} cfr={cfr} error={error} />
      )}
    </WidgetFrame>
  );
}

function AkqBody({
  P,
  B,
  bluffPick,
  callPick,
  setBluffPick,
  setCallPick,
  cfr,
  error,
}: {
  P: number;
  B: number;
  bluffPick: number | null;
  callPick: number | null;
  setBluffPick: (v: number | null) => void;
  setCallPick: (v: number | null) => void;
  cfr: AkqCfrResult | null;
  error: string;
}) {
  const eq = akqClosedForm(P, B);
  const b = bluffPick ?? eq.qBluff, c = callPick ?? eq.kCall;
  const bettorEv = akqBettorEv(P, B, b, c);
  const bluffEv = akqBluffEv(P, B, c), callEv = akqCallEv(P, B, b);
  const s = b / (1 + b);

  // Best responses: each EV is linear in the player's own frequency, so the best is 0% or 100%.
  const bettorBest = Math.max(akqBettorEv(P, B, 0, c), akqBettorEv(P, B, 1, c));
  const callerBest = P - Math.min(akqBettorEv(P, B, b, 0), akqBettorEv(P, B, b, 1));
  const bettorBr = isZero(bluffEv, P + B) ? "any b (the Q is indifferent)" : bluffEv > 0 ? "bluff every Q" : "never bluff";
  const callerBr = isZero(callEv, P + B) ? "any c (the K is indifferent)" : callEv > 0 ? "call every bet" : "fold every time";
  const gain = (best: number, atEq: number) => (best - atEq > 0.005 ? ` (${fmt(best - atEq, 2)} more than at equilibrium)` : "");

  const solverReady = cfr !== null && cfr.pot === P && cfr.bet === B;

  return (
    <>
      <Line>
        <span className="uppercase">At equilibrium</span>
      </Line>
      <Row label="Q bluffs">
        <span className="text-muted normal-case">b = B / (P + B)</span> <span className="inv">{pct(eq.qBluff)}</span>
      </Row>
      <Row label="K calls">
        <span className="text-muted normal-case">c = P / (P + B)</span> <span className="inv">{pct(eq.kCall)}</span>
      </Row>
      <Row label="Bluff share of bets">
        <span className="text-muted normal-case">s = B / (P + 2B)</span> {pct(eq.bluffShare)}
      </Row>
      <Row label="Bettor's EV">
        <span className="text-muted normal-case">(P + cB) / 2</span> {bb(eq.bettorEv)}
      </Row>
      <Row label="Caller's EV">
        <span className="text-muted normal-case">P − bettor&apos;s EV</span> {bb(eq.callerEv)}
      </Row>
      <Line className="text-muted">
        <span>
          {error
            ? `Solver check failed: ${error}`
            : solverReady
              ? `Solver check: CFR+ (${cfr.iterations.toLocaleString("en-US")} iterations) re-derives b = ${pct(cfr.qBluff)} and c = ${pct(cfr.kCall)}, and bets the A ${pct(cfr.aBet)} of the time; its exploitability is ${cfr.exploitability < 1e-4 ? "less than 0.0001" : fmt(cfr.exploitability, 4)} bb per hand.`
              : "Solver check: CFR+ is solving…"}
        </span>
      </Line>

      <Line>
        <span className="uppercase">Now move the frequencies</span>
        <TextButton
          onClick={() => {
            setBluffPick(null);
            setCallPick(null);
          }}
          disabled={bluffPick === null && callPick === null}
        >
          [Back to equilibrium]
        </TextButton>
      </Line>
      <Slider label={<>Q bluffs <span className="normal-case">b</span></>} value={b} onChange={setBluffPick} />
      <Slider label={<>K calls <span className="normal-case">c</span></>} value={c} onChange={setCallPick} />

      <div aria-live="polite">
        <Row label="Q: bluff instead of check">
          <span className="text-muted normal-case">(1 − c)P − cB</span> {signedBb(bluffEv)}
        </Row>
        <Row label="K: call instead of fold">
          <span className="text-muted normal-case">s(P + B) − (1 − s)B, s = {pct(s)}</span> {signedBb(callEv)}
        </Row>
        <Row label="Bettor's EV">
          <span className="text-muted normal-case">(P + cB) / 2 + b((1 − c)P − cB) / 2</span> {bb(bettorEv)}
        </Row>
        <Row label="Caller's EV">
          <span className="text-muted normal-case">P − bettor&apos;s EV</span> {bb(P - bettorEv)}
        </Row>
        <Row label="Bettor's best response">
          {bettorBr}: {bb(bettorBest)}
          {gain(bettorBest, eq.bettorEv)}
        </Row>
        <Row label="Caller's best response">
          {callerBr}: {bb(callerBest)}
          {gain(callerBest, eq.callerEv)}
        </Row>
      </div>

      <div className="flex flex-col gap-x-[2ch] gap-y-[0.5em] sm:flex-row">
        <EvLine
          title={`Bettor's EV by bluff frequency b (c = ${pct(c)})`}
          xName="Q bluffs b"
          lo={P / 2}
          hi={Math.max(P, (P + B) / 2)}
          at0={akqBettorEv(P, B, 0, c)}
          at1={akqBettorEv(P, B, 1, c)}
          f={b}
          eq={eq.bettorEv}
        />
        <EvLine
          title={`Caller's EV by call frequency c (b = ${pct(b)})`}
          xName="K calls c"
          lo={Math.min(0, (P - B) / 2)}
          hi={P / 2}
          at0={P - akqBettorEv(P, B, b, 0)}
          at1={P - akqBettorEv(P, B, b, 1)}
          f={c}
          eq={eq.callerEv}
        />
      </div>
    </>
  );
}

function Slider({ label, value, onChange }: { label: ReactNode; value: number; onChange: (v: number) => void }) {
  return (
    <label className="l field">
      <span>{label}</span>
      <span className="flex items-center gap-x-[2ch]">
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={Math.round(value * 1000) / 10}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="min-w-0 flex-1 accent-ink border-dotted! border-muted!"
        />
        <span className="w-[7ch] shrink-0 text-right">{pct(value)}</span>
      </span>
    </label>
  );
}
