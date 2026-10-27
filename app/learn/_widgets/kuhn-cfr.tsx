"use client";

import { useEffect, useRef, useState } from "react";
import { WidgetFrame, buttonClass } from "../_components/widget-frame";
import {
  CARD_NAMES,
  INFO_GROUPS,
  KUHN_VALUE,
  averageStrategy,
  createCfrState,
  currentStrategyAt,
  equilibriumFor,
  exploitability,
  gameValue,
  runIterations,
  type CfrState,
} from "./kuhn-cfr-math";

const MAX_ITERATIONS = 100_000;
const SLICE_MS = 10;

interface Point {
  t: number;
  value: number;
  expl: number;
}

interface Snapshot {
  iterations: number;
  avg: number[];
  current: number[];
  regretPerIter: number[];
  value: number;
  expl: number;
  history: Point[];
}

function snapshot(state: CfrState, history: Point[]): Snapshot {
  const avg = averageStrategy(state);
  const current: number[] = [];
  const regretPerIter: number[] = [];
  const t = Math.max(state.iterations, 1);
  for (let i = 0; i < 12; i++) {
    current.push(currentStrategyAt(state, i)[1]);
    regretPerIter.push(state.regret[2 * i] / t, state.regret[2 * i + 1] / t);
  }
  return { iterations: state.iterations, avg, current, regretPerIter, value: gameValue(avg), expl: exploitability(avg), history };
}

const pct = (v: number) => `${(100 * v).toFixed(1)}%`;

// Charts: x is log10(iterations) from 0 (1 iteration) to 5 (100,000).
const CW = 300, CH = 150, CL = 44, CR = 16, CT = 10, CB = 28;
const cx = (t: number) => CL + (Math.log10(Math.max(t, 1)) / 5) * (CW - CL - CR);

function Chart({
  points,
  y,
  yTicks,
  yLabel,
  title,
  target,
}: {
  points: Point[];
  y: (p: Point) => number;
  yTicks: { v: number; label: string }[];
  yLabel: (v: number) => number;
  title: string;
  target?: number;
}) {
  const lo = Math.min(...yTicks.map((k) => k.v)), hi = Math.max(...yTicks.map((k) => k.v));
  const cy = (v: number) => CT + (1 - (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (CH - CT - CB);
  const d = points.map((p, i) => `${i ? "L" : "M"}${cx(p.t).toFixed(1)},${cy(yLabel(y(p))).toFixed(1)}`).join(" ");
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">{title}</figcaption>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img" aria-label={title}>
        {yTicks.map((k) => (
          <g key={k.label}>
            <line x1={CL} x2={CW - CR} y1={cy(k.v)} y2={cy(k.v)} className="stroke-zinc-200 dark:stroke-zinc-800" />
            <text x={CL - 4} y={cy(k.v) + 3} textAnchor="end" className="fill-zinc-500 text-[9px]">
              {k.label}
            </text>
          </g>
        ))}
        {[1, 10, 100, 1000, 10000, 100000].map((t) => (
          <text key={t} x={cx(t)} y={CH - CB + 12} textAnchor="middle" className="fill-zinc-500 text-[9px]">
            {t >= 1000 ? `${t / 1000}k` : t}
          </text>
        ))}
        <text x={(CL + CW - CR) / 2} y={CH - 3} textAnchor="middle" className="fill-zinc-500 text-[9px]">
          iterations (log scale: each step is 10× more)
        </text>
        {target !== undefined && (
          <line x1={CL} x2={CW - CR} y1={cy(target)} y2={cy(target)} strokeDasharray="4 3" className="stroke-emerald-600 dark:stroke-emerald-400" />
        )}
        <path d={d} fill="none" strokeWidth={2} className="stroke-zinc-900 dark:stroke-zinc-100" />
      </svg>
    </figure>
  );
}

/** Next iteration count at which to add a chart point: about 12 points per factor of 10. */
const nextCheckpoint = (t: number) => Math.max(t + 1, Math.ceil(t * 1.2));

interface Run {
  state: CfrState;
  history: Point[];
  checkpoint: number;
}

const newRun = (): Run => ({ state: createCfrState(), history: [], checkpoint: 1 });

/** Runs up to n more iterations (stopping early after budgetMs), adding a chart point at each checkpoint. */
function advance(run: Run, n: number, budgetMs: number): void {
  const { state } = run;
  const deadline = performance.now() + budgetMs;
  const target = Math.min(state.iterations + n, MAX_ITERATIONS);
  while (state.iterations < target && performance.now() < deadline) {
    runIterations(state, Math.min(run.checkpoint, target) - state.iterations);
    if (state.iterations >= run.checkpoint) {
      const avg = averageStrategy(state);
      run.history = [...run.history, { t: state.iterations, value: gameValue(avg), expl: exploitability(avg) }];
      run.checkpoint = nextCheckpoint(state.iterations);
    }
  }
}

export function KuhnCfr() {
  const runRef = useRef<Run | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [running, setRunning] = useState(false);
  const [snap, setSnap] = useState<Snapshot>(() => snapshot(createCfrState(), []));

  const getRun = () => (runRef.current ??= newRun());

  const stop = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    setRunning(false);
  };

  // Work in small slices, each in its own task, so the browser can repaint and respond between
  // slices and the page never freezes. Each slice grows the iteration count by about 5% (capped at
  // SLICE_MS of work), so the run sweeps the log-scale charts evenly in a second or two.
  const tick = () => {
    const run = getRun();
    advance(run, Math.max(1, Math.ceil(run.state.iterations * 0.05)), SLICE_MS);
    setSnap(snapshot(run.state, run.history));
    if (run.state.iterations < MAX_ITERATIONS) timerRef.current = setTimeout(tick, 0);
    else {
      timerRef.current = null;
      setRunning(false);
    }
  };

  const start = () => {
    if (timerRef.current !== null || getRun().state.iterations >= MAX_ITERATIONS) return;
    setRunning(true);
    timerRef.current = setTimeout(tick, 0);
  };

  const step = (n: number) => {
    stop();
    const run = getRun();
    advance(run, n, Infinity);
    setSnap(snapshot(run.state, run.history));
  };

  const reset = () => {
    stop();
    runRef.current = newRun();
    setSnap(snapshot(runRef.current.state, []));
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const betaEstimate = snap.avg[0];
  const eq = equilibriumFor(Math.min(Math.max(betaEstimate, 0), 1 / 3));

  return (
    <WidgetFrame
      title="Kuhn poker solved by CFR"
      footer="Plain CFR: each iteration plays the current regret-matching strategy through all 6 deals and updates the regrets. The average strategy is what converges. Game value and exploitability are computed exactly for the average strategy. Exploitability is the average of what a best response gains against each player (found by trying every pure strategy: each player has 6 decisions with 2 choices each, so 2 × 2 × 2 × 2 × 2 × 2 = 64 ways to always pick one action at each decision)."
    >
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <button type="button" className={buttonClass} onClick={stop}>
            Pause
          </button>
        ) : (
          <button type="button" className={buttonClass} onClick={start} disabled={snap.iterations >= MAX_ITERATIONS}>
            {snap.iterations === 0 ? "Run CFR" : "Continue"}
          </button>
        )}
        <button
          type="button"
          onClick={() => step(1)}
          disabled={snap.iterations >= MAX_ITERATIONS}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          +1 iteration
        </button>
        <button
          type="button"
          onClick={() => step(100)}
          disabled={snap.iterations >= MAX_ITERATIONS}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          +100
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Reset
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "Iterations", v: snap.iterations.toLocaleString("en-US") },
          { k: "Game value to Player 1", v: snap.iterations ? snap.value.toFixed(4) : "–" },
          { k: "Target −1/18", v: KUHN_VALUE.toFixed(4) },
          { k: "Exploitability (pair average)", v: snap.iterations ? snap.expl.toFixed(4) : "–" },
        ].map((x) => (
          <div key={x.k} className="rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
            <dt className="text-xs text-zinc-500">{x.k}</dt>
            <dd className="font-mono text-base tabular-nums">{x.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        <Chart
          title="Game value of the average strategy"
          points={snap.history}
          y={(p) => p.value}
          yLabel={(v) => v}
          target={KUHN_VALUE}
          yTicks={[
            { v: -0.15, label: "−0.15" },
            { v: -0.1, label: "−0.10" },
            { v: -0.05, label: "−0.05" },
            { v: 0, label: "0" },
            { v: 0.05, label: "0.05" },
            { v: 0.1, label: "0.10" },
            { v: 0.15, label: "0.15" },
          ]}
        />
        <Chart
          title="Exploitability (log scale: each gridline down is 10× smaller)"
          points={snap.history}
          y={(p) => p.expl}
          yLabel={(v) => Math.log10(Math.max(v, 1e-4))}
          yTicks={[
            { v: 0, label: "1" },
            { v: -1, label: "0.1" },
            { v: -2, label: "0.01" },
            { v: -3, label: "0.001" },
            { v: -4, label: "0.0001" },
          ]}
        />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-zinc-500 [&_th]:px-1 [&_th]:py-1 [&_th]:font-normal">
              <th>Situation</th>
              <th>Card</th>
              <th>Action</th>
              <th className="text-right">Average</th>
              <th className="text-right">Equilibrium (β = {betaEstimate.toFixed(3)})</th>
              <th className="text-right">Current</th>
              <th className="text-right">Avg regret check-or-fold / bet-or-call</th>
            </tr>
          </thead>
          <tbody>
            {INFO_GROUPS.map((g, gi) =>
              CARD_NAMES.map((card, c) => {
                const i = gi * 3 + c;
                return (
                  <tr key={i} className="border-t border-zinc-200 dark:border-zinc-800 [&_td]:px-1 [&_td]:py-1">
                    <td className="text-zinc-500">{c === 0 ? g.label : ""}</td>
                    <td className="font-mono font-semibold">{card}</td>
                    <td>{g.bet}</td>
                    <td className="text-right font-mono">{pct(snap.avg[i])}</td>
                    <td className="text-right font-mono text-zinc-500">{pct(eq[i])}</td>
                    <td className="text-right font-mono text-zinc-500">{pct(snap.current[i])}</td>
                    <td className="text-right font-mono text-zinc-500">
                      {snap.regretPerIter[2 * i].toFixed(3)} / {snap.regretPerIter[2 * i + 1].toFixed(3)}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        &ldquo;Average&rdquo; and &ldquo;Current&rdquo; give the probability of the action named (bet or call); the rest of the time the player
        checks or folds. The equilibrium column plugs the solver&apos;s own J-betting frequency in as β. Regrets are divided by the number of
        iterations. The positive ones shrink toward 0 as CFR learns; an action the equilibrium never takes keeps a negative average
        regret, because it really was worse.
      </p>
    </WidgetFrame>
  );
}
