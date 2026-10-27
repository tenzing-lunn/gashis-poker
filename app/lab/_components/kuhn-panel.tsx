"use client";

import { useCallback, useMemo, useState } from "react";
import type { CfrVariant } from "@/lib/gto/cfr";
import type { KuhnBetProbs, KuhnPoint, KuhnResult } from "@/lib/gto/worker-protocol";
import { KuhnCharts, SWATCH, VARIANT_LABEL, type KuhnSeries } from "./kuhn-charts";
import { KuhnStrategyTable } from "./kuhn-table";
import { fmt, fmtSigned, ms } from "./format";
import { Actions, Button, Card, Figure, Panel, Sci, Stat, StatusLine, Toggles } from "./ui";
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
      <Card title="Setup">
        <Toggles
          label="Algorithm"
          value={variant}
          onChange={setVariant}
          disabled={running}
          options={[
            { value: "cfr+", label: "CFR+" },
            { value: "cfr", label: "CFR (vanilla)" },
          ]}
        />
        <Toggles label="Iterations" value={iterations} onChange={setIterations} disabled={running} options={ITERATION_OPTIONS.map((n) => ({ value: n, label: fmt(n, 0) }))} />
        <Toggles label="Pace" value={pace} onChange={setPace} disabled={running} options={PACE_OPTIONS.map((p) => ({ value: p.ms, label: p.label }))} />
        <Actions>
          <Button onClick={start} disabled={running}>
            Run
          </Button>
          <Button onClick={halt} variant="secondary" disabled={!running}>
            Stop
          </Button>
        </Actions>
        <StatusLine tone={running ? "busy" : status === "error" ? "error" : "muted"}>
          {status === "idle" && "Press Run to start. Runs happen in a Web Worker; the page stays responsive."}
          {running && `${VARIANT_LABEL[runVariant]}: iteration ${fmt(last?.iteration ?? 0, 0)} of ${fmt(runTotal, 0)}`}
          {status === "done" && result && `${VARIANT_LABEL[result.variant]}: ${fmt(result.iterations, 0)} iterations in ${ms(result.timeMs)}${runPace > 0 ? ", including the pacing delays" : ""}`}
          {status === "stopped" && `Stopped at iteration ${fmt(last?.iteration ?? 0, 0)}.`}
          {status === "error" && `Solver error: ${error}`}
        </StatusLine>
      </Card>

      <Figure
        caption="FIG. 1: Convergence of the average strategy"
        legend={
          <span className="flex flex-wrap gap-x-[2ch]">
            {series.map((s) => (
              <span key={`${s.variant}-${s.ghost}`} className="inline-flex items-center gap-[1ch]">
                <svg aria-hidden="true" width="24" height="6" className={SWATCH[s.variant]}>
                  <line x1="0" x2="24" y1="3" y2="3" stroke="currentColor" strokeWidth={s.ghost ? 1.25 : 2} strokeDasharray={s.ghost ? "4 3" : undefined} />
                </svg>
                {VARIANT_LABEL[s.variant]}
                {s.ghost ? " (previous)" : ""}
              </span>
            ))}
          </span>
        }
      >
        <KuhnCharts series={series} maxIterations={runTotal} />
      </Figure>

      <Card title="Now">
        <Stat label="Iterations" value={last ? fmt(last.iteration, 0) : "—"} />
        <Stat label="Exploitability" value={last ? <Sci x={last.exploitability} /> : "—"} unit="chips/hand" />
        <Stat label="P0 value" value={last ? fmtSigned(last.value, 5) : "—"} unit="chips/hand" />
        <Stat label="Gap to −1/18" value={last ? <Sci x={Math.abs(last.value + 1 / 18)} digits={1} /> : "—"} unit="chips/hand" />
        <p className="l">
          <span className="max-w-[72ch] text-muted">
            <span className="text-ink uppercase">Exploitability</span> is how much a perfect counter-strategy would win per hand against this strategy, averaged over
            the two seats (NashConv ÷ 2). It is exactly 0 at a Nash equilibrium.
          </span>
        </p>
      </Card>

      <Card title="Average strategy vs. Kuhn's analytic equilibrium">
        <KuhnStrategyTable strategy={strategy} />
      </Card>
    </Panel>
  );
}
