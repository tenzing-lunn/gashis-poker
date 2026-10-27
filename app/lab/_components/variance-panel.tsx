"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { VARIANCE_MAX_HANDS_X_RUNS, type VarianceResultMessage } from "@/lib/gto/worker-protocol";
import { HistogramChart, PathsChart } from "./variance-charts";
import { fmt, fmtSigned, ms, pct } from "./format";
import { Actions, Button, Card, Field, Figure, MathTable, Panel, StatusLine, inputClass } from "./ui";
import { useSolverWorker } from "./use-solver";

type Inputs = { winRate: string; stdDev: string; hands: string; runs: string; seed: string };
const DEFAULTS: Inputs = { winRate: "2.5", stdDev: "90", hands: "50000", runs: "1000", seed: "1" };

function parse(i: Inputs) {
  const winRate = Number(i.winRate), stdDev = Number(i.stdDev), hands = Number(i.hands), runs = Number(i.runs), seed = Number(i.seed);
  const errors: Partial<Record<keyof Inputs, boolean>> = {
    winRate: i.winRate.trim() === "" || !Number.isFinite(winRate) || Math.abs(winRate) > 1000,
    stdDev: i.stdDev.trim() === "" || !(stdDev >= 0 && stdDev <= 10_000),
    hands: !(Number.isInteger(hands) && hands >= 100 && hands <= 10_000_000),
    runs: !(Number.isInteger(runs) && runs >= 2 && runs <= 100_000),
    seed: !(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32),
  };
  const tooBig = !errors.hands && !errors.runs && hands * runs > VARIANCE_MAX_HANDS_X_RUNS;
  const ok = !Object.values(errors).some(Boolean) && !tooBig;
  return { ok, errors, tooBig, params: { winRate, stdDev, hands, runs, seed } };
}

export function VariancePanel() {
  const { run } = useSolverWorker("variance");
  const [inputs, setInputs] = useState<Inputs>(DEFAULTS);
  const [result, setResult] = useState<VarianceResultMessage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const parsed = parse(inputs);

  const simulate = useCallback(
    (params: ReturnType<typeof parse>["params"]) => {
      run({ kind: "variance", ...params }, (msg) => {
        if (msg.type === "done") {
          setResult(msg.result);
          setError("");
        } else setError(msg.message);
        setBusy(false);
      });
    },
    [run],
  );

  useEffect(() => {
    simulate(parse(DEFAULTS).params);
  }, [simulate]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.ok) return;
    setBusy(true);
    simulate(parsed.params);
  };

  const field = (key: keyof Inputs, label: string, unit: string | undefined, step: string) => (
    <Field label={label} unit={unit} htmlFor={`var-${key}`}>
      <input
        id={`var-${key}`}
        type="number"
        inputMode="decimal"
        step={step}
        value={inputs[key]}
        aria-invalid={parsed.errors[key] || (parsed.tooBig && (key === "hands" || key === "runs"))}
        onChange={(e) => setInputs((s) => ({ ...s, [key]: e.target.value }))}
        className={inputClass}
      />
    </Field>
  );

  const r = result;
  return (
    <Panel
      title="Variance simulator"
      kicker="How far luck moves a player whose true win rate is known. Each hand is an independent normal draw, scaled so 100 hands have the given mean and standard deviation. The sum over H hands is Normal(wr·H/100, sd·√(H/100)), which the simulation should reproduce."
    >
      <Card title="Inputs">
        <form onSubmit={submit}>
          {field("winRate", "Win rate", "bb/100", "0.5")}
          {field("stdDev", "Std. dev.", "bb/100", "5")}
          {field("hands", "Hands", "per run", "1000")}
          {field("runs", "Runs", undefined, "100")}
          {field("seed", "Seed", undefined, "1")}
          <Actions>
            <Button type="submit" disabled={!parsed.ok || busy}>
              {busy ? "Running…" : "Run"}
            </Button>
          </Actions>
        </form>
        <StatusLine tone={error || !parsed.ok ? "error" : busy ? "busy" : "muted"}>
          {!parsed.ok
            ? parsed.tooBig
              ? `Hands × runs must be at most ${fmt(VARIANCE_MAX_HANDS_X_RUNS, 0)} (about 5–7 s of work).`
              : "Check the inputs: hands 100 to 10,000,000, runs 2 to 100,000, whole-number seed, SD ≥ 0."
            : error
              ? `Simulation error: ${error}`
              : busy
                ? `Simulating ${fmt(parsed.params.hands * parsed.params.runs, 0)} hands…`
                : r && `${fmt(r.runs, 0)} runs × ${fmt(r.hands, 0)} hands (seed ${r.seed}) in ${ms(r.timeMs)}.`}
        </StatusLine>
      </Card>

      {r && (
        <div className={`flex flex-col ${busy ? "opacity-50" : ""}`}>
          <Figure caption={`FIG. 1: ${r.paths.length} sample paths`} legend={
              <>
                Thick: expected line. Dashed: 95% band <span className="normal-case">(mean ± 1.96σ√(h/100))</span>. Thin: sample paths
              </>
            }>
            <PathsChart r={r} />
          </Figure>
          <Figure caption={`FIG. 2: Final results of ${fmt(r.runs, 0)} runs`} legend="Curve: analytic normal density. Bars below 0 in red, above in green">
            <HistogramChart r={r} />
          </Figure>
          <Card title="Simulated vs. analytic">
            <MathTable
              head={["After " + fmt(r.hands, 0) + " hands", "Simulated", "Analytic"]}
              rows={[
                { key: "mean", cells: ["Mean result (bb)", fmtSigned(r.simulated.mean, 0), fmtSigned(r.analytic.mean, 0)] },
                { key: "sd", cells: ["Standard deviation (bb)", fmt(r.simulated.sd, 0), fmt(r.analytic.sd, 0)] },
                { key: "below", cells: ["P(finish below 0)", pct(r.simulated.belowZero, 1), pct(r.analytic.belowZero, 1)] },
                {
                  key: "ci",
                  cells: [
                    "95% interval (bb)",
                    `${fmtSigned(r.simulated.interval95[0], 0)} … ${fmtSigned(r.simulated.interval95[1], 0)}`,
                    `${fmtSigned(r.analytic.interval95[0], 0)} … ${fmtSigned(r.analytic.interval95[1], 0)}`,
                  ],
                },
                { key: "wr", cells: ["Observed win rate (bb/100)", fmtSigned((100 * r.simulated.mean) / r.hands, 2), fmtSigned(r.winRate, 2)] },
              ]}
            />
          </Card>
          <Card title="Largest drawdown per run (peak to trough)">
            <MathTable
              head={["Statistic", "bb", "100 bb buy-ins"]}
              rows={[
                { key: "mean", cells: ["Mean", fmt(r.drawdown.mean, 0), fmt(r.drawdown.mean / 100, 1)] },
                { key: "median", cells: ["Median", fmt(r.drawdown.median, 0), fmt(r.drawdown.median / 100, 1)] },
                { key: "p95", cells: ["95th percentile", fmt(r.drawdown.p95, 0), fmt(r.drawdown.p95 / 100, 1)] },
                { key: "max", cells: ["Worst run", fmt(r.drawdown.max, 0), fmt(r.drawdown.max / 100, 1)] },
              ]}
            />
          </Card>
        </div>
      )}
    </Panel>
  );
}
