"use client";

import { useEffect, useRef, useState } from "react";
import { BoxButton, Legend, Line, TextButton } from "@/components/doc";
import { Scroll, WidgetFrame } from "../_components/widget-frame";
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
  type CfrVariant,
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

/** A right-aligned number column of the strategy table. */
const NUM = "pr-[2ch] text-right whitespace-nowrap";

// Charts: x is log10(iterations) from 0 (1 iteration) to 5 (100,000).
const CW = 300, CH = 150, CL = 52, CR = 16, CT = 10, CB = 28;
const cx = (t: number) => CL + (Math.log10(Math.max(t, 1)) / 5) * (CW - CL - CR);

function Chart({
  points,
  compare,
  y,
  yTicks,
  yLabel,
  title,
  target,
}: {
  points: Point[];
  /** The other algorithm's last run, drawn dashed. */
  compare?: Point[];
  y: (p: Point) => number;
  yTicks: { v: number; label: string }[];
  yLabel: (v: number) => number;
  title: string;
  target?: number;
}) {
  const lo = Math.min(...yTicks.map((k) => k.v)), hi = Math.max(...yTicks.map((k) => k.v));
  const cy = (v: number) => CT + (1 - (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (CH - CT - CB);
  const path = (pts: Point[]) => pts.map((p, i) => `${i ? "L" : "M"}${cx(p.t).toFixed(1)},${cy(yLabel(y(p))).toFixed(1)}`).join(" ");
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="text-[10px] uppercase text-muted">{title}</figcaption>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img" aria-label={title}>
        {yTicks.map((k) => (
          <g key={k.label}>
            <line x1={CL} x2={CW - CR} y1={cy(k.v)} y2={cy(k.v)} className="stroke-faint" />
            <text x={CL - 4} y={cy(k.v) + 3} textAnchor="end" className="fill-muted text-[9px]">
              {k.label}
            </text>
          </g>
        ))}
        {[1, 10, 100, 1000, 10000, 100000].map((t) => (
          <text key={t} x={cx(t)} y={CH - CB + 12} textAnchor="middle" className="fill-muted text-[9px]">
            {t >= 1000 ? `${t / 1000}k` : t}
          </text>
        ))}
        <text x={(CL + CW - CR) / 2} y={CH - 3} textAnchor="middle" className="fill-muted text-[9px]">
          iterations (log scale: each step is 10× more)
        </text>
        {target !== undefined && (
          <line x1={CL} x2={CW - CR} y1={cy(target)} y2={cy(target)} strokeDasharray="4 3" className="stroke-muted" />
        )}
        {compare && <path d={path(compare)} fill="none" strokeWidth={1.5} strokeDasharray="6 3" className="stroke-muted" />}
        <path d={path(points)} fill="none" strokeWidth={2} className="stroke-ink" />
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

const newRun = (variant: CfrVariant): Run => ({ state: createCfrState(variant), history: [], checkpoint: 1 });

const VARIANT_LABEL: Record<CfrVariant, string> = { cfr: "CFR", "cfr+": "CFR+" };

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
  const [variant, setVariant] = useState<CfrVariant>("cfr");
  // Each algorithm's last run, kept when you switch away from it, so the other one can be compared.
  const [lastRuns, setLastRuns] = useState<Partial<Record<CfrVariant, Point[]>>>({});

  const getRun = () => (runRef.current ??= newRun(variant));

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
    runRef.current = newRun(variant);
    setSnap(snapshot(runRef.current.state, []));
  };

  const switchTo = (v: CfrVariant) => {
    if (v === variant) return;
    stop();
    const history = runRef.current?.history ?? [];
    if (history.length) setLastRuns((r) => ({ ...r, [variant]: history }));
    setVariant(v);
    runRef.current = newRun(v);
    setSnap(snapshot(runRef.current.state, []));
  };

  const other: CfrVariant = variant === "cfr" ? "cfr+" : "cfr";
  const compare = lastRuns[other];

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
      footer="Plain CFR: each iteration plays the current regret-matching strategy through all 6 deals and updates the regrets. CFR+ changes three things: the players update in turn, any negative total regret is reset to 0 (so an action that was bad early can come back quickly), and later iterations count more in the average. In both, the average strategy is what converges. Game value and exploitability are computed exactly for the average strategy. Exploitability is the average of what a best response gains against each player (found by trying every pure strategy: each player has 6 decisions with 2 choices each, so 2 × 2 × 2 × 2 × 2 × 2 = 64 ways to always pick one action at each decision)."
    >
      <Line className="justify-start!">
        {running ? (
          <BoxButton filled onClick={stop}>
            Pause
          </BoxButton>
        ) : (
          <BoxButton filled onClick={start} disabled={snap.iterations >= MAX_ITERATIONS}>
            {snap.iterations === 0 ? `Run ${VARIANT_LABEL[variant]}` : "Continue"}
          </BoxButton>
        )}
        <span>
          <TextButton onClick={() => step(1)} disabled={snap.iterations >= MAX_ITERATIONS}>
            [+1 iteration]
          </TextButton>
          <TextButton onClick={() => step(100)} disabled={snap.iterations >= MAX_ITERATIONS}>
            [+100]
          </TextButton>
          <TextButton onClick={reset}>[Reset]</TextButton>
        </span>
      </Line>
      <Line>
        <span className="uppercase">Advanced: algorithm</span>
        <span>
          {(["cfr", "cfr+"] as const).map((v) => (
            <TextButton key={v} pressed={variant === v} onClick={() => switchTo(v)}>
              [{VARIANT_LABEL[v]}]
            </TextButton>
          ))}
        </span>
      </Line>

      <dl>
        {[
          { k: "Iterations", v: snap.iterations.toLocaleString("en-US") },
          { k: "Game value to Player 1", v: snap.iterations ? snap.value.toFixed(4) : "–" },
          { k: "Target −1/18", v: KUHN_VALUE.toFixed(4) },
          { k: "Exploitability (pair average)", v: snap.iterations ? snap.expl.toFixed(4) : "–" },
        ].map((x) => (
          <div key={x.k} className="l">
            <dt className="uppercase">{x.k}</dt>
            <dd>{x.v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-x-[2ch] gap-y-[0.5em] sm:flex-row">
        <Chart
          title="Game value of the average strategy"
          points={snap.history}
          compare={compare}
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
          compare={compare}
          y={(p) => p.expl}
          yLabel={(v) => Math.log10(Math.max(v, 1e-6))}
          yTicks={[
            { v: 0, label: "1" },
            { v: -1, label: "0.1" },
            { v: -2, label: "0.01" },
            { v: -3, label: "0.001" },
            { v: -4, label: "0.0001" },
            { v: -5, label: "0.00001" },
            { v: -6, label: "0.000001" },
          ]}
        />
      </div>
      {compare && (
        <Legend>
          <span>
            Solid: this {VARIANT_LABEL[variant]} run. Dashed: your last {VARIANT_LABEL[other]} run, {compare[compare.length - 1].t.toLocaleString("en-US")} iterations.
          </span>
        </Legend>
      )}

      <Scroll>
        <table className="w-full border-collapse tabular-nums">
          <thead className="text-muted uppercase">
            <tr>
              <th scope="colgroup" colSpan={4} className="l table-cell! text-left">
                Situation · card · action
              </th>
              <th scope="colgroup" colSpan={2} className="text-right whitespace-nowrap">
                Avg regret
              </th>
            </tr>
            <tr>
              <td className="l table-cell!" />
              <th scope="col" className={NUM}>
                Average
              </th>
              <th scope="col" className={NUM}>
                Equilibrium (<span className="normal-case">β</span> = {betaEstimate.toFixed(3)})
              </th>
              <th scope="col" className={NUM}>
                Current
              </th>
              <th scope="col" className={NUM}>
                check-or-fold
              </th>
              <th scope="col" className={`${NUM} pr-0!`}>
                bet-or-call
              </th>
            </tr>
          </thead>
          {INFO_GROUPS.map((g, gi) => (
            <tbody key={gi}>
              <tr>
                <th scope="rowgroup" colSpan={6} className="l table-cell! text-left text-muted uppercase">
                  {g.label}
                </th>
              </tr>
              {CARD_NAMES.map((card, c) => {
                const i = gi * 3 + c;
                return (
                  <tr key={i} className="align-baseline">
                    <th scope="row" className="l table-cell! pr-[2ch] text-left whitespace-nowrap uppercase">
                      {card} {g.bet}
                    </th>
                    <td className={NUM}>{pct(snap.avg[i])}</td>
                    <td className={`${NUM} text-muted`}>{pct(eq[i])}</td>
                    <td className={`${NUM} text-muted`}>{pct(snap.current[i])}</td>
                    <td className={`${NUM} text-muted`}>{snap.regretPerIter[2 * i].toFixed(3)}</td>
                    <td className={`${NUM} pr-0! text-muted`}>{snap.regretPerIter[2 * i + 1].toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </Scroll>
      <Legend>
        <span>
          &ldquo;Average&rdquo; and &ldquo;Current&rdquo; give the probability of the action named (bet or call); the rest of the time the player
          checks or folds. The equilibrium column plugs the solver&apos;s own J-betting frequency in as β. Regrets are divided by the number of
          iterations. The positive ones shrink toward 0 as CFR learns; an action the equilibrium never takes keeps a negative average
          regret, because it really was worse. CFR+ resets negative totals to 0, so there they stay at 0 instead.
        </span>
      </Legend>
    </WidgetFrame>
  );
}
