"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PushFoldResult } from "@/lib/gto/worker-protocol";
import { HandGrid } from "@/app/lab/_components/hand-grid";
import { fmt, fmtSigned, ms, pct } from "@/app/lab/_components/format";
import { useSolverWorker } from "@/app/lab/_components/use-solver";
import { Blank, Field, Line, Tag } from "@/components/doc";
import { Row, WidgetFrame } from "../_components/widget-frame";

// Heads-up, blinds 0.5 / 1 bb, no antes, both players start with S bb. The small blind shoves or folds;
// facing a shove the big blind calls or folds. The worker solves both ranges against each other (CFR+
// over the 169 hand classes, exact all-in equities with card removal) until neither side can gain more
// than 1e-5 bb per hand by changing its range.

const MIN = 1, MAX = 30, STEP = 0.5, INITIAL = 10;
const DEBOUNCE_MS = 120;

const snap = (x: number) => Math.min(MAX, Math.max(MIN, Math.round(x / STEP) * STEP));

/** The push/fold equilibrium at any stack from 1 to 30 bb: both ranges as 13×13 grids. */
export function PushFoldNash() {
  const { run } = useSolverWorker("pushfold");
  const [stack, setStack] = useState(INITIAL);
  const [stackText, setStackText] = useState(String(INITIAL));
  const [shown, setShown] = useState<PushFoldResult | null>(null);
  /** The stack being solved, or null when the shown result is current. */
  const [pending, setPending] = useState<number | null>(INITIAL);
  const [error, setError] = useState("");
  const cache = useRef(new Map<number, PushFoldResult>());
  const wanted = useRef(INITIAL);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Posts a solve; state changes only when the worker answers.
  const startSolve = useCallback(
    (s: number) => {
      run({ kind: "pushfold", stack: s }, (msg) => {
        if (msg.type === "progress") return;
        if (msg.type === "done") {
          cache.current.set(msg.result.stack, msg.result);
          if (wanted.current === msg.result.stack) {
            setShown(msg.result);
            setPending(null);
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
      return;
    }
    setPending(s);
    setError("");
    startSolve(s);
  };

  const choose = (s: number) => {
    setStack(s);
    clearTimeout(timer.current);
    // Solved stacks show at once; new ones wait until the slider rests for DEBOUNCE_MS.
    if (cache.current.has(s)) request(s);
    else timer.current = setTimeout(() => request(s), DEBOUNCE_MS);
  };

  const onText = (text: string) => {
    setStackText(text);
    const x = Number(text);
    if (text.trim() !== "" && Number.isFinite(x) && x >= MIN && x <= MAX) choose(snap(x));
  };

  const r = shown;
  const stale = pending !== null && r !== null && r.stack !== pending;
  const textOk = Number(stackText) >= MIN && Number(stackText) <= MAX;

  return (
    <div id="push-fold-equilibrium">
      <WidgetFrame
        title="Push/fold equilibrium (heads-up, small blind vs big blind)"
        footer="Blinds 0.5/1, no antes, both players start with S bb. Grid: pairs on the diagonal, suited hands above it, offsuit below; the darker the cell, the more often that hand shoves or calls. Percentages count combos (6 per pair, 4 suited, 12 offsuit) out of 1,326. Solved with CFR+ (module 5) over the 169 hand classes, using exact all-in equities with card removal. Solved stacks are kept, so going back to one is instant."
      >
        <label className="l field">
          <span>Stack S</span>
          <span className="flex items-center gap-x-[2ch]">
            <input
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
              className="min-w-0 flex-1 accent-ink border-dotted! border-muted!"
            />
            <span className="w-[7ch] shrink-0 text-right">{stack} bb</span>
          </span>
        </label>
        <Field
          label="Or type a stack (1 to 30 bb)"
          type="number"
          inputMode="decimal"
          min={MIN}
          max={MAX}
          step={STEP}
          value={stackText}
          error={textOk ? undefined : "Use a stack from 1 to 30 bb."}
          onChange={(e) => onText(e.target.value)}
          onBlur={() => setStackText(String(stack))}
        />
        <Line className="text-muted" aria-live="polite">
          <span>
            {error ? (
              <Tag>Solver error: {error}</Tag>
            ) : pending !== null ? (
              `Solving ${fmt(pending, 1)} bb…`
            ) : (
              r &&
              `Solved ${fmt(r.stack, 1)} bb in ${ms(r.timeMs)}: neither player can gain more than ${r.nashConv < 1e-5 ? "0.00001" : fmt(r.nashConv, 5)} bb per hand by changing its range.`
            )}
          </span>
        </Line>

        <div className={stale ? "opacity-50" : undefined}>
          <Row label="Small blind shoves">{r ? `${pct(r.pushFraction, 1)} of hands` : "—"}</Row>
          <Row label="Big blind calls a shove with">{r ? `${pct(r.callFraction, 1)} of hands` : "—"}</Row>
          <Row label="Small blind's gain per hand over folding every hand">
            <span className="inv">{r ? `${fmtSigned(r.sbValue + 0.5, 3)} bb` : "—"}</span>
          </Row>
          <Line as="p" className="text-muted">
            <span className="min-w-0 max-w-[72ch]">
              Measured from after the blinds are posted, as in EV(shove), so folding is worth 0. Counted from before the blinds go in, the small blind&apos;s result is {r ? `${fmtSigned(r.sbValue, 3)} bb` : "—"} (folding every hand would score −0.500 bb), and the big blind&apos;s is the same number with the sign flipped.
            </span>
          </Line>
          <Blank />
          <HandGrid title={r ? `Small blind: how often it shoves at ${fmt(r.stack, 1)} bb` : "Small blind: how often it shoves"} freq={r ? r.push : null} tone="push" />
          <RangeText label="Shoved at least half the time" text={r?.pushRange} />
          <Blank />
          <HandGrid title={r ? `Big blind: how often it calls a shove at ${fmt(r.stack, 1)} bb` : "Big blind: how often it calls a shove"} freq={r ? r.call : null} tone="call" />
          <RangeText label="Called at least half the time" text={r?.callRange} />
        </div>
      </WidgetFrame>
    </div>
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
