"use client";

import { useMemo, useState } from "react";
import { BoxButton, Field, Line, Tag } from "@/components/doc";
import { WidgetFrame } from "@/app/learn/_components/widget-frame";
import { normalCdf, riskOfRuin, simulate } from "./variance-simulator-math";

const W = 360, H = 220, PAD_L = 52, PAD_R = 10, PAD_T = 10, PAD_B = 26;
const DRAWN = 20;
const WORK = 2_000_000; // normal draws per recompute (keeps it fast in the browser)

const num = (s: string) => Number(s.replace(/[,\s]/g, ""));
const int = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const downswing = (bb: number) => `${int(bb)} bb · ${(bb / 100).toFixed(1)} buy-ins`;

/** Win rate, SD, hands and bankroll → seeded simulated results, the 95% band and the share of losing runs. */
export function VarianceSimulator() {
  const [winRate, setWinRate] = useState("5");
  const [sd, setSd] = useState("90");
  const [hands, setHands] = useState("100000");
  const [bankroll, setBankroll] = useState("2000");
  const [seed, setSeed] = useState(1);

  const w = num(winRate), s = num(sd), n = num(hands), br = num(bankroll);
  const valid = [w, s, n, br].every(Number.isFinite) && s > 0 && n >= 100 && n <= 2_000_000 && br >= 0;
  const blocks = valid ? Math.max(1, Math.round(n / 100)) : 1;
  const runs = Math.min(2000, Math.max(100, Math.floor(WORK / blocks)));

  const sim = useMemo(
    () => (valid ? simulate({ winRate: w, sd: s, hands: n, bankroll: br, runs, seed }, DRAWN) : null),
    [valid, w, s, n, br, runs, seed],
  );

  if (!valid || !sim) {
    return (
      <WidgetFrame title="Variance simulator">
        <Inputs {...{ winRate, setWinRate, sd, setSd, hands, setHands, bankroll, setBankroll }} />
        <Line>
          <Tag>Use an SD above 0, between 100 and 2,000,000 hands, and a bankroll of 0 or more.</Tag>
        </Line>
      </WidgetFrame>
    );
  }

  const halfCi = (1.96 * s) / Math.sqrt(n / 100);
  const predictedBelow = normalCdf((-w * Math.sqrt(n / 100)) / s);
  const xs = sim.sampleAt;
  const mean = (k: number) => w * k;
  const band = (k: number) => 1.96 * s * Math.sqrt(k);

  let yMin = 0, yMax = 0;
  for (const k of xs) {
    yMin = Math.min(yMin, mean(k) - band(k));
    yMax = Math.max(yMax, mean(k) + band(k));
  }
  for (const p of sim.paths) {
    for (const v of p) {
      yMin = Math.min(yMin, v);
      yMax = Math.max(yMax, v);
    }
  }
  if (br > 0) yMin = Math.min(yMin, -br);
  const sx = (k: number) => PAD_L + (k / sim.blocks) * (W - PAD_L - PAD_R);
  const sy = (v: number) => PAD_T + ((yMax - v) / (yMax - yMin)) * (H - PAD_T - PAD_B);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  const bandPath =
    xs.map((k, i) => `${i ? "L" : "M"}${sx(k).toFixed(1)},${sy(mean(k) + band(k)).toFixed(1)}`).join("") +
    [...xs].reverse().map((k) => `L${sx(k).toFixed(1)},${sy(mean(k) - band(k)).toFixed(1)}`).join("") +
    "Z";

  return (
    <WidgetFrame
      title="Variance simulator"
      footer={`Normal approximation: each 100 hands is an independent normal draw with mean = win rate and SD = SD. ${int(runs)} runs, ${DRAWN} drawn. Seed ${seed}: the seed fixes the random sequence, so the same inputs always give the same runs; “New random runs” changes the seed to show a different set. The shaded band is the expected result ± 1.96 SD of the total. A downswing is the largest fall from a high point to a later low within one run, over all ${int(runs)} runs, checked every 100 hands. The risk-of-ruin formula assumes play never stops; the simulation stops at ${int(n)} hands, so on average its ruin share is lower (any one set of runs can land above it by chance).`}
    >
      <Inputs {...{ winRate, setWinRate, sd, setSd, hands, setHands, bankroll, setBankroll }} />
      <Line>
        <BoxButton filled onClick={() => setSeed((x) => x + 1)}>
          New random runs
        </BoxButton>
      </Line>

      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Simulated results in bb against hands played">
        <path d={bandPath} className="fill-faint" fillOpacity={0.6} />
        {sim.paths.map((p, i) => (
          <path key={i} d={line(p)} fill="none" className="stroke-muted" strokeOpacity={0.6} strokeWidth={1} />
        ))}
        <line x1={sx(0)} x2={sx(sim.blocks)} y1={sy(0)} y2={sy(0)} className="stroke-muted" strokeWidth={1} />
        <path d={line(xs.map(mean))} fill="none" className="stroke-ink" strokeWidth={2} />
        {br > 0 && <line x1={sx(0)} x2={sx(sim.blocks)} y1={sy(-br)} y2={sy(-br)} className="stroke-red" strokeDasharray="4 3" strokeWidth={1.5} />}
        <text x={PAD_L - 4} y={sy(yMax) + 8} textAnchor="end" className="fill-muted text-[10px]">
          {int(yMax)}
        </text>
        <text x={PAD_L - 4} y={sy(0) + 3} textAnchor="end" className="fill-muted text-[10px]">
          0
        </text>
        <text x={PAD_L - 4} y={sy(yMin)} textAnchor="end" className="fill-muted text-[10px]">
          {int(yMin)}
        </text>
        <text x={sx(0)} y={H - 8} className="fill-muted text-[10px]">
          0 hands
        </text>
        <text x={sx(sim.blocks)} y={H - 8} textAnchor="end" className="fill-muted text-[10px]">
          {int(n)} hands
        </text>
      </svg>

      <dl>
        <Stat label="Expected result" value={`${int(w * (n / 100))} bb`} />
        <Stat label="SD of the total" value={`${int(s * Math.sqrt(n / 100))} bb`} />
        <Stat label="95% interval for observed win rate" value={`${w.toFixed(1)} ± ${halfCi.toFixed(1)} bb/100`} />
        <Stat label="Runs finishing below 0" value={`${pct(sim.belowZero)} (formula ${pct(predictedBelow)})`} />
        {br > 0 && <Stat label={`Runs that lost ${int(br)} bb at some point`} value={pct(sim.ruined)} />}
        {br > 0 && <Stat label="Risk of ruin, no time limit (formula)" value={pct(riskOfRuin(w, s, br))} />}
      </dl>

      <Line className="uppercase">
        <span>Deepest downswing in each run</span>
        <span className="text-muted">bb · 100bb buy-ins</span>
      </Line>
      <dl>
        <Stat label="Typical run (median)" value={downswing(sim.drawdown.median)} />
        <Stat label="1 run in 20 is worse than" value={downswing(sim.drawdown.p95)} />
        <Stat label={`Worst of ${int(runs)} runs`} value={downswing(sim.drawdown.max)} />
      </dl>
    </WidgetFrame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="l">
      <dt className="uppercase">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

interface InputsProps {
  winRate: string;
  setWinRate: (v: string) => void;
  sd: string;
  setSd: (v: string) => void;
  hands: string;
  setHands: (v: string) => void;
  bankroll: string;
  setBankroll: (v: string) => void;
}

function Inputs(p: InputsProps) {
  const field = (label: string, value: string, set: (v: string) => void) => (
    <Field label={label} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
  );
  return (
    <>
      {field("Win rate (bb/100)", p.winRate, p.setWinRate)}
      {field("SD (bb/100)", p.sd, p.setSd)}
      {field("Hands", p.hands, p.setHands)}
      {field("Bankroll R (bb, 0 = none)", p.bankroll, p.setBankroll)}
    </>
  );
}
