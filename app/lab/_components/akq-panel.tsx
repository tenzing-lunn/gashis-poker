"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { akqClosedForm, type AkqSolution } from "@/lib/gto/akq";
import type { AkqCfrResult } from "@/lib/gto/worker-protocol";
import { fmt, fmtSigned, ms, pct } from "./format";
import { Card, Field, MathTable, Panel, Sci, Stat, StatusLine, inputClass } from "./ui";
import { useSolverWorker } from "./use-solver";

const ITERATIONS = 5_000;
const DEBOUNCE_MS = 250;

const parsePositive = (s: string): number | null => {
  const x = Number(s);
  return s.trim() !== "" && Number.isFinite(x) && x > 0 && x <= 1000 ? x : null;
};

type Row = { key: string; label: string; formula: string; closed: (s: AkqSolution) => number; cfr: (r: AkqCfrResult) => number; kind: "pct" | "chips" };

const ROWS: Row[] = [
  { key: "bluff", label: "Y bluffs with Q", formula: "β = B / (P + B)", closed: (s) => s.yBluff, cfr: (r) => r.yBluff, kind: "pct" },
  { key: "betA", label: "Y bets with A", formula: "always", closed: (s) => s.yBetA, cfr: (r) => r.yBetA, kind: "pct" },
  { key: "kcall", label: "X calls with K", formula: "c = (P − B) / (P + B)", closed: (s) => s.kCall, cfr: (r) => r.kCall, kind: "pct" },
  { key: "xcall", label: "X calls in total vs. a bluff (A always, K at c)", formula: "(1 + c) / 2 = P / (P + B)", closed: (s) => s.xCallVsBluff, cfr: (r) => r.xCallVsBluff, kind: "pct" },
  { key: "share", label: "Bluffs as a share of Y's bets", formula: "β / (1 + β) = B / (P + 2B)", closed: (s) => s.bluffShareOfBets, cfr: (r) => r.bluffShareOfBets, kind: "pct" },
  { key: "value", label: "Game value to Y", formula: "B (P − B) / (6 (P + B))", closed: (s) => s.valueY, cfr: (r) => r.valueY, kind: "chips" },
  { key: "potshare", label: "Y's pot share (pot as dead money)", formula: "P/2 + value", closed: (s) => s.yPotShare, cfr: (r) => r.yPotShare, kind: "chips" },
];

export function AkqPanel() {
  const { run } = useSolverWorker("akq");
  const [potText, setPotText] = useState("2");
  const [betText, setBetText] = useState("1");
  const [cfr, setCfr] = useState<AkqCfrResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const pot = parsePositive(potText), bet = parsePositive(betText);
  const closed = useMemo(() => (pot !== null && bet !== null ? akqClosedForm(pot, bet) : null), [pot, bet]);

  // Posts a CFR+ solve; state is only set when the worker answers.
  const solve = useCallback(
    (P: number, B: number) => {
      run({ kind: "akq", pot: P, bet: B, iterations: ITERATIONS }, (msg) => {
        if (msg.type === "done") {
          setCfr(msg.result);
          setError("");
        } else if (msg.type === "error") setError(msg.message);
        setBusy(false);
      });
    },
    [run],
  );

  useEffect(() => {
    solve(2, 1);
    return () => clearTimeout(timer.current);
  }, [solve]);

  const onChange = (which: "pot" | "bet", text: string) => {
    if (which === "pot") setPotText(text);
    else setBetText(text);
    const P = parsePositive(which === "pot" ? text : potText), B = parsePositive(which === "bet" ? text : betText);
    clearTimeout(timer.current);
    if (P === null || B === null) return;
    setBusy(true);
    timer.current = setTimeout(() => solve(P, B), DEBOUNCE_MS);
  };

  const cfrMatches = cfr !== null && closed !== null && cfr.pot === closed.pot && cfr.bet === closed.bet;
  const show = (r: Row, v: number) => (r.kind === "pct" ? pct(v, 2) : fmtSigned(v, 4));

  return (
    <Panel
      title="The [A, K, Q] game"
      kicker="Chen & Ankenman's half-street toy game. X and Y each get one of A > K > Q; the pot is P. X checks; Y bets B or checks; X calls or folds. The closed form falls out of two indifference equations; CFR+ re-derives it numerically."
    >
      <Card title="Inputs">
        <Field label="Pot P" unit="chips" htmlFor="akq-pot">
          <input id="akq-pot" className={inputClass} type="number" inputMode="decimal" min={0.1} step={0.5} value={potText} aria-invalid={pot === null} onChange={(e) => onChange("pot", e.target.value)} />
        </Field>
        <Field label="Bet B" unit="chips" htmlFor="akq-bet">
          <input id="akq-bet" className={inputClass} type="number" inputMode="decimal" min={0.1} step={0.5} value={betText} aria-invalid={bet === null} onChange={(e) => onChange("bet", e.target.value)} />
        </Field>
        <StatusLine tone={error ? "error" : busy ? "busy" : "muted"}>
          {pot === null || bet === null
            ? "Pot and bet must be positive numbers (up to 1,000)."
            : error
              ? `Solver error: ${error}`
              : busy
                ? `Solving P = ${fmt(pot, 2)}, B = ${fmt(bet, 2)} with ${fmt(ITERATIONS, 0)} CFR+ iterations…`
                : cfr && (
                    <>
                      CFR+: {fmt(cfr.iterations, 0)} iterations in {ms(cfr.timeMs)}, exploitability <Sci x={cfr.exploitability} digits={1} /> chips/hand
                    </>
                  )}
        </StatusLine>
      </Card>

      {closed && (
        <Card>
          <Stat label="Bet / pot" value={fmt(closed.bet / closed.pot, 3)} unit="× pot" />
          <Stat label="Y bluffs Q" value={pct(closed.yBluff, 1)} hint="β = B/(P+B)" />
          <Stat label="K calls" value={pct(closed.kCall, 1)} hint="c = (P−B)/(P+B)" />
          <Stat label="Value to Y" value={fmtSigned(closed.valueY, 4)} unit="chips/deal" />
        </Card>
      )}

      {closed && (
        <Card title="Closed form vs. CFR+" aside={cfr === null ? undefined : cfrMatches ? "CFR+ column solved at these inputs" : "CFR+ column is from the previous inputs"}>
          <MathTable
            head={["Quantity", "Formula", "Closed form", "CFR+", "|Δ|"]}
            rows={ROWS.map((r) => {
              const c = r.closed(closed);
              const v = cfr ? r.cfr(cfr) : null;
              // Non-unique case (B >= P): Y's bluff is checked against its equilibrium interval, and rows with
              // no unique answer (Y's ace, the bluff share that depends on it) get no |Δ|.
              const [lo, hi] = closed.yBluffRange;
              const d =
                v === null || !cfrMatches || (!closed.unique && (r.key === "betA" || r.key === "share"))
                  ? null
                  : r.key === "bluff"
                    ? Math.max(0, lo - v, v - hi)
                    : Math.abs(v - c);
              const closedText = r.key === "bluff" && !closed.unique ? `${pct(closed.yBluffRange[0], 1)} – ${pct(closed.yBluffRange[1], 1)}` : show(r, c);
              return {
                key: r.key,
                cells: [
                  r.label,
                  <span key="f" className="text-muted normal-case">{closed.unique || r.key === "value" || r.key === "potshare" ? r.formula : "see note"}</span>,
                  closedText,
                  v === null ? "—" : <span className={cfrMatches ? "" : "text-muted"}>{show(r, v)}</span>,
                  d === null ? "—" : r.kind === "pct" ? (d < 5e-5 ? "<0.01 pp" : `${fmt(100 * d, 2)} pp`) : d < 5e-5 ? "<0.0001" : fmt(d, 4),
                ],
              };
            })}
          />
          <p className="l">
            <span className="max-w-[72ch] text-muted">
            {closed.unique ? (
              <>
                With P &gt; B the equilibrium is unique: K is indifferent to calling when −B + β(P + B) = 0, and Q is indifferent to bluffing when −B + (1 − c)P − cB = 0.
                X&apos;s total calling frequency is the minimum defence frequency P/(P + B). Frequencies are fractions of the hands in that spot; values are chips per deal with each player treated as having put P/2 in the pot.
              </>
            ) : (
              <>
                With B ≥ P the equilibrium is not unique. A bluff loses B to the ace and wins at most P from the king, so K never calls and the game is worth 0.
                {closed.pot === closed.bet ? " At B = P any bluffing frequency from 0% to 50% is an equilibrium (CFR+ can land anywhere in that range), and Y's ace is indifferent between betting and checking." : " Y never bluffs, and Y's ace is indifferent between betting and checking."}{" "}
                So the closed form shows one equilibrium: CFR+&apos;s bluff is checked against the whole interval, and rows with no unique answer get no |Δ|.
              </>
            )}
            </span>
          </p>
        </Card>
      )}
    </Panel>
  );
}
