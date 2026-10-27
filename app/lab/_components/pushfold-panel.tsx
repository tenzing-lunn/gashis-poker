"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PushFoldResult } from "@/lib/gto/worker-protocol";
import { HandGrid } from "./hand-grid";
import { fmt, fmtSigned, ms, pct } from "./format";
import { Card, Field, Figure, Panel, Sci, Stat, StatusLine, inputClass } from "./ui";
import { Line } from "@/components/doc";
import { useSolverWorker } from "./use-solver";

const MIN = 1, MAX = 30, STEP = 0.5, INITIAL = 10;
const DEBOUNCE_MS = 120;

const snap = (x: number) => Math.min(MAX, Math.max(MIN, Math.round(x / STEP) * STEP));

export function PushFoldPanel() {
  const { run } = useSolverWorker("pushfold");
  const [stack, setStack] = useState(INITIAL);
  const [stackText, setStackText] = useState(String(INITIAL));
  const [shown, setShown] = useState<PushFoldResult | null>(null);
  /** The stack being solved, or null when the shown result is current. */
  const [pending, setPending] = useState<number | null>(INITIAL);
  const [progress, setProgress] = useState<{ iterations: number; nashConv: number } | null>(null);
  const [error, setError] = useState("");
  const cache = useRef(new Map<number, PushFoldResult>());
  const wanted = useRef(INITIAL);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Posts a solve; state changes only when the worker answers.
  const startSolve = useCallback(
    (s: number) => {
      run({ kind: "pushfold", stack: s }, (msg) => {
        if (msg.type === "progress") {
          if (wanted.current === msg.stack) setProgress({ iterations: msg.iterations, nashConv: msg.nashConv });
        } else if (msg.type === "done") {
          cache.current.set(msg.result.stack, msg.result);
          if (wanted.current === msg.result.stack) {
            setShown(msg.result);
            setPending(null);
            setProgress(null);
          }
        } else {
          setError(msg.message);
          setPending(null);
        }
      });
    },
    [run],
  );

  useEffect(() => {
    startSolve(INITIAL);
    return () => clearTimeout(timer.current);
  }, [startSolve]);

  const request = (s: number) => {
    wanted.current = s;
    const hit = cache.current.get(s);
    if (hit) {
      setShown(hit);
      setPending(null);
      setProgress(null);
      return;
    }
    setPending(s);
    setProgress(null);
    setError("");
    startSolve(s);
  };

  const choose = (s: number) => {
    setStack(s);
    clearTimeout(timer.current);
    // Cached stacks show at once; uncached ones wait until the slider rests for DEBOUNCE_MS.
    if (cache.current.has(s)) request(s);
    else timer.current = setTimeout(() => request(s), DEBOUNCE_MS);
  };

  const onText = (text: string) => {
    setStackText(text);
    const x = Number(text);
    if (text.trim() !== "" && Number.isFinite(x) && x >= MIN && x <= MAX) choose(snap(x));
  };

  const stale = pending !== null && shown !== null && shown.stack !== pending;
  const r = shown;

  return (
    <Panel
      title="Heads-up push/fold Nash equilibrium"
      kicker="No-limit hold'em, small blind 0.5 bb, big blind 1 bb, no ante. The small blind shoves or folds; the big blind calls or folds. Both players start with the same stack. Solved exactly over the 169 hand classes with CFR+ on a precomputed all-in equity matrix that accounts for card removal."
    >
      <Card title="Inputs">
        <Field label="Effective stack" unit="bb, including the blind" htmlFor="pf-slider">
          <input
            id="pf-slider"
            type="range"
            min={MIN}
            max={MAX}
            step={STEP}
            value={stack}
            onChange={(e) => {
              const s = Number(e.target.value);
              setStackText(String(s));
              choose(s);
            }}
            className="border-b-0! accent-current"
          />
          <span className="relative mx-2 block h-[1.8em] text-[10px] tabular-nums text-muted" aria-hidden>
            {[1, 5, 10, 15, 20, 25, 30].map((v) => (
              <span key={v} className="absolute -translate-x-1/2" style={{ left: `${((v - MIN) / (MAX - MIN)) * 100}%` }}>
                {v}
              </span>
            ))}
          </span>
        </Field>
        <Field label="Stack" unit="bb, rounds to 0.5" htmlFor="pf-stack">
          <input
            id="pf-stack"
            type="number"
            inputMode="decimal"
            min={MIN}
            max={MAX}
            step={STEP}
            value={stackText}
            aria-invalid={!(Number(stackText) >= MIN && Number(stackText) <= MAX)}
            onChange={(e) => onText(e.target.value)}
            onBlur={() => setStackText(String(stack))}
            className={`${inputClass} w-[10ch]!`}
          />
        </Field>
        <StatusLine tone={error ? "error" : pending !== null ? "busy" : "muted"}>
          {error
            ? `Solver error: ${error}`
            : pending !== null
              ? (
                  <>
                    Solving {fmt(pending, 1)} bb
                    {progress ? (
                      <>
                        : iteration {fmt(progress.iterations, 0)}, NashConv <Sci x={progress.nashConv} digits={1} /> bb
                      </>
                    ) : (
                      "…"
                    )}
                  </>
                )
              : r && (
                  <>
                    Solved {fmt(r.stack, 1)} bb in {ms(r.timeMs)} ({fmt(r.iterations, 0)} CFR+ iterations, stopping at NashConv &lt; 10<sup className="text-[0.7em]">−5</sup> bb). Solved
                    stacks are cached.
                  </>
                )}
        </StatusLine>
      </Card>

      <div className={stale ? "text-muted" : undefined}>
        <Card title="Equilibrium">
          <Stat label="SB pushes" value={r ? pct(r.pushFraction, 1) : "—"} unit="of combos" />
          <Stat label="BB calls" value={r ? pct(r.callFraction, 1) : "—"} unit="of combos" />
          <Stat label="SB value" value={r ? fmtSigned(r.sbValue, 4) : "—"} unit="bb/hand" hint="SB's expected result per hand; BB's is the negative" />
          <Stat label="Exploitability" value={r ? <Sci x={r.exploitability} digits={1} /> : "—"} unit="bb" hint="NashConv / 2" />
          <Stat label="NashConv" value={r ? <Sci x={r.nashConv} digits={1} /> : "—"} unit="bb" hint="Sum of both players' best-response gains" />
          <Stat label="Iterations" value={r ? fmt(r.iterations, 0) : "—"} unit={r ? `in ${ms(r.timeMs)}` : undefined} />
        </Card>
      </div>

      <Figure caption={r ? `FIG. 1: SB push range at ${fmt(r.stack, 1)} bb` : "FIG. 1: SB push range"}>
        <div className={stale ? "opacity-50" : undefined}>
          <HandGrid title="Small blind: P(shove)" freq={r ? r.push : null} tone="push" />
          <RangeText label="Pushed at least half the time" text={r?.pushRange} />
        </div>
      </Figure>
      <Figure caption={r ? `FIG. 2: BB call range at ${fmt(r.stack, 1)} bb` : "FIG. 2: BB call range"}>
        <div className={stale ? "opacity-50" : undefined}>
          <HandGrid title="Big blind: P(call a shove)" freq={r ? r.call : null} tone="call" />
          <RangeText label="Called at least half the time" text={r?.callRange} />
        </div>
      </Figure>
      <Line as="p">
        <span className="max-w-[72ch] text-muted">
          Grid: pairs on the diagonal, suited hands above it, offsuit below. Percentages of combos weight each class by its combo count (6 per pair, 4 suited, 12 offsuit) out of
          1,326.
        </span>
      </Line>
    </Panel>
  );
}

function RangeText({ label, text }: { label: string; text: string | undefined }) {
  return (
    <>
      <Line className="uppercase">
        <span>{label}</span>
      </Line>
      <Line as="p">
        <span className="min-w-0 break-words normal-case">{text ?? "—"}</span>
      </Line>
    </>
  );
}
