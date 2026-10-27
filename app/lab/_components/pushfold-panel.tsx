"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PushFoldResult } from "@/lib/gto/worker-protocol";
import { HandGrid } from "./hand-grid";
import { fmt, fmtSigned, ms, pct } from "./format";
import { Card, Field, Panel, Sci, Stat, StatusLine, inputClass } from "./ui";
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
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
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
                className="h-9 w-full accent-emerald-600"
              />
            </Field>
            <div className="relative mx-2 h-4 font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400" aria-hidden>
              {[1, 5, 10, 15, 20, 25, 30].map((v) => (
                <span key={v} className="absolute -translate-x-1/2" style={{ left: `${((v - MIN) / (MAX - MIN)) * 100}%` }}>
                  {v}
                </span>
              ))}
            </div>
          </div>
          <div className="w-28">
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
                className={inputClass}
              />
            </Field>
          </div>
        </div>
        <div className="mt-3">
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
        </div>
      </Card>

      <div className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 lg:grid-cols-6 ${stale ? "opacity-50" : ""}`}>
        <Card>
          <Stat label="SB pushes" value={r ? pct(r.pushFraction, 1) : "—"} unit="of combos" />
        </Card>
        <Card>
          <Stat label="BB calls" value={r ? pct(r.callFraction, 1) : "—"} unit="of combos" />
        </Card>
        <Card>
          <Stat label="SB value" value={r ? fmtSigned(r.sbValue, 4) : "—"} unit="bb/hand" hint="SB's expected result per hand; BB's is the negative" />
        </Card>
        <Card>
          <Stat label="Exploitability" value={r ? <Sci x={r.exploitability} digits={1} /> : "—"} unit="bb" hint="NashConv / 2" />
        </Card>
        <Card>
          <Stat label="NashConv" value={r ? <Sci x={r.nashConv} digits={1} /> : "—"} unit="bb" hint="Sum of both players' best-response gains" />
        </Card>
        <Card>
          <Stat label="Iterations" value={r ? fmt(r.iterations, 0) : "—"} unit={r ? `in ${ms(r.timeMs)}` : undefined} />
        </Card>
      </div>

      <div className={`grid grid-cols-1 gap-6 transition-opacity md:grid-cols-2 ${stale ? "opacity-50" : ""}`}>
        <Card title={r ? `SB push range at ${fmt(r.stack, 1)} bb` : "SB push range"}>
          <HandGrid title="Small blind: P(shove)" freq={r ? r.push : null} tone="push" />
          <RangeText label="Pushed at least half the time" text={r?.pushRange} />
        </Card>
        <Card title={r ? `BB call range at ${fmt(r.stack, 1)} bb` : "BB call range"}>
          <HandGrid title="Big blind: P(call a shove)" freq={r ? r.call : null} tone="call" />
          <RangeText label="Called at least half the time" text={r?.callRange} />
        </Card>
      </div>
      <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
        Grid: pairs on the diagonal, suited hands above it, offsuit below. Percentages of combos weight each class by its combo count (6 per pair, 4 suited, 12 offsuit) out of 1,326.
      </p>
    </Panel>
  );
}

function RangeText({ label, text }: { label: string; text: string | undefined }) {
  return (
    <div className="mt-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</div>
      <p className="mt-1 break-words font-mono text-xs leading-5">{text ?? "—"}</p>
    </div>
  );
}
