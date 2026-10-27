"use client";

import { useCallback, useMemo, useState } from "react";
import type { CfrVariant } from "@/lib/gto/cfr";
import type { KuhnBetProbs, KuhnPoint, KuhnResult } from "@/lib/gto/worker-protocol";
import { KuhnCharts, SWATCH, VARIANT_LABEL, type KuhnSeries } from "./kuhn-charts";
import { KuhnStrategyTable } from "./kuhn-table";
import { fmt, fmtSigned, ms } from "./format";
import { Button, Card, Field, Panel, Sci, Stat, StatusLine, selectClass } from "./ui";
import { useSolverWorker } from "./use-solver";

const ITERATION_OPTIONS = [1_000, 10_000, 100_000, 1_000_000];
const PACE_OPTIONS = [
  { ms: 40, label: "Watch it (40 ms / point)" },
  { ms: 10, label: "Brisk (10 ms / point)" },
  { ms: 0, label: "Full speed" },
];

type Status = "idle" | "running" | "done" | "stopped" | "error";

export function KuhnPanel() {
  const { run, stop } = useSolverWorker("kuhn");
  const [variant, setVariant] = useState<CfrVariant>("cfr+");
  const [iterations, setIterations] = useState(100_000);
  const [pace, setPace] = useState(40);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [runVariant, setRunVariant] = useState<CfrVariant>("cfr+");
  const [runTotal, setRunTotal] = useState(100_000);
  const [runPace, setRunPace] = useState(40);
  const [points, setPoints] = useState<KuhnPoint[]>([]);
  const [strategy, setStrategy] = useState<KuhnBetProbs | null>(null);
  const [result, setResult] = useState<KuhnResult | null>(null);
  /** The last finished (or stopped) run of each variant, kept for comparison. */
  const [previous, setPrevious] = useState<Partial<Record<CfrVariant, KuhnPoint[]>>>({});

  const start = useCallback(() => {
    // Keep the outgoing run as a dashed comparison line.
    if (points.length > 0) setPrevious((p) => ({ ...p, [runVariant]: points }));
    setRunVariant(variant);
    setRunTotal(iterations);
    setRunPace(pace);
    setPoints([]);
    setStrategy(null);
    setResult(null);
    setError("");
    setStatus("running");
    run({ kind: "kuhn", variant, iterations, paceMs: pace }, (msg) => {
      if (msg.type === "progress") {
        setPoints((p) => p.concat(msg.points));
        setStrategy(msg.strategy);
      } else if (msg.type === "done") {
        setPoints((p) => p.concat(msg.points));
        setStrategy(msg.result.strategy);
        setResult(msg.result);
        setStatus("done");
      } else {
        setError(msg.message);
        setStatus("error");
      }
    });
  }, [points, runVariant, variant, iterations, pace, run]);

  const halt = useCallback(() => {
    stop();
    setStatus("stopped");
  }, [stop]);

  const series = useMemo<KuhnSeries[]>(() => {
    const out: KuhnSeries[] = [];
    for (const v of ["cfr", "cfr+"] as const) {
      const prev = previous[v];
      if (prev && prev.length) out.push({ variant: v, points: prev, ghost: true });
    }
    out.push({ variant: runVariant, points, ghost: false });
    return out;
  }, [previous, runVariant, points]);

  const last = points[points.length - 1];
  const running = status === "running";

  return (
    <Panel
      title="Kuhn poker, solved by counterfactual regret minimisation"
      kicker="Three cards (J < Q < K), ante 1, one bet of 1. CFR plays the game against itself and averages its strategies; the average converges to a Nash equilibrium, worth −1/18 chip per hand to the first player."
    >
      <Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Algorithm" htmlFor="kuhn-variant">
            <select id="kuhn-variant" className={selectClass} value={variant} onChange={(e) => setVariant(e.target.value as CfrVariant)} disabled={running}>
              <option value="cfr+">CFR+</option>
              <option value="cfr">CFR (vanilla)</option>
            </select>
          </Field>
          <Field label="Iterations" htmlFor="kuhn-iterations">
            <select id="kuhn-iterations" className={selectClass} value={iterations} onChange={(e) => setIterations(Number(e.target.value))} disabled={running}>
              {ITERATION_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {fmt(n, 0)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pace" htmlFor="kuhn-pace">
            <select id="kuhn-pace" className={selectClass} value={pace} onChange={(e) => setPace(Number(e.target.value))} disabled={running}>
              {PACE_OPTIONS.map((p) => (
                <option key={p.ms} value={p.ms}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex gap-2">
            <Button onClick={start} disabled={running}>
              Run
            </Button>
            <Button onClick={halt} variant="secondary" disabled={!running}>
              Stop
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <StatusLine tone={running ? "busy" : status === "error" ? "error" : "muted"}>
            {status === "idle" && "Press Run to start. Runs happen in a Web Worker; the page stays responsive."}
            {running && `${VARIANT_LABEL[runVariant]}: iteration ${fmt(last?.iteration ?? 0, 0)} of ${fmt(runTotal, 0)}`}
            {status === "done" && result && `${VARIANT_LABEL[result.variant]}: ${fmt(result.iterations, 0)} iterations in ${ms(result.timeMs)}${runPace > 0 ? ", including the pacing delays" : ""}`}
            {status === "stopped" && `Stopped at iteration ${fmt(last?.iteration ?? 0, 0)}.`}
            {status === "error" && `Solver error: ${error}`}
          </StatusLine>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <Card
          title="Convergence of the average strategy"
          aside={
            <span className="flex flex-wrap gap-3">
              {series.map((s) => (
                <span key={`${s.variant}-${s.ghost}`} className="flex items-center gap-1.5">
                  <span className={`h-0.5 w-4 ${SWATCH[s.variant]} ${s.ghost ? "opacity-60" : ""}`} />
                  {VARIANT_LABEL[s.variant]}
                  {s.ghost ? " (previous)" : ""}
                </span>
              ))}
            </span>
          }
        >
          <KuhnCharts series={series} maxIterations={runTotal} />
        </Card>
        <Card title="Now">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            <Stat label="Iterations" value={last ? fmt(last.iteration, 0) : "—"} />
            <Stat label="Exploitability" value={last ? <Sci x={last.exploitability} /> : "—"} unit="chips/hand" />
            <Stat label="P0 value" value={last ? fmtSigned(last.value, 5) : "—"} unit="chips/hand" />
            <Stat label="Gap to −1/18" value={last ? <Sci x={Math.abs(last.value + 1 / 18)} digits={1} /> : "—"} unit="chips/hand" />
          </div>
          <p className="mt-4 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
            <strong className="font-semibold text-foreground">Exploitability</strong> is how much a perfect counter-strategy would win per hand against
            this strategy, averaged over the two seats (NashConv ÷ 2). It is exactly 0 at a Nash equilibrium.
          </p>
        </Card>
      </div>

      <Card title="Average strategy vs. Kuhn's analytic equilibrium">
        <KuhnStrategyTable strategy={strategy} />
      </Card>
    </Panel>
  );
}
