"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { parseCards } from "@/lib/poker/cards";
import { parseRange, removeDeadCards } from "@/lib/poker/range";
import { RIVER_MAX_ITERATIONS, type RiverPoint, type RiverRequest, type RiverResult, type RiverTreeInfo } from "@/lib/gto/worker-protocol";
import { RIVER_PRESETS, type RiverForm } from "./river-presets";
import { RiverChart } from "./river-chart";
import { RiverExplorer } from "./river-strategy";
import { fmt, fmtSigned, ms, pct } from "./format";
import { Choice, Line, Tag } from "@/components/doc";
import { Actions, Button, Card, FIELD_ROW, Field, Figure, Panel, Sci, Stat, StatusLine, Toggles, inputClass, selectClass } from "./ui";
import { useSolverWorker } from "./use-solver";

const TARGETS = [1, 0.3, 0.1, 0.03, 0.01];
const MAX_ITERATIONS = [1_000, 5_000, RIVER_MAX_ITERATIONS];
const DEFAULT_TARGET = 0.1;
const DEFAULT_MAX = 5_000;

type Status = "idle" | "running" | "done" | "stopped" | "error";
type Job = Omit<RiverRequest, "id" | "kind">;

/** "33, 75" (percent) -> [0.33, 0.75]; null if anything is not a size in (0, 1000]%. At most 4 sizes. */
function parseSizes(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (parts.length > 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    const x = Number(p.replace(/%$/, ""));
    if (!Number.isFinite(x) || x <= 0 || x > 1000) return null;
    out.push(x / 100);
  }
  return out;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Validates the form on the main thread (cheap: no evaluator), counting live combos for each range. */
function check(form: RiverForm) {
  const errors: Partial<Record<keyof RiverForm, string>> = {};
  let board: number[] = [];
  try {
    board = parseCards(form.board);
    if (board.length !== 5) errors.board = `A river board has 5 cards; this has ${board.length}.`;
  } catch (e) {
    errors.board = errorText(e);
  }
  const live = (key: "oopRange" | "ipRange") => {
    try {
      const all = parseRange(form[key]);
      if (all.length === 0) {
        errors[key] = "Empty range.";
        return 0;
      }
      const n = errors.board ? all.length : removeDeadCards(all, board).length;
      if (n === 0) errors[key] = "Every combo uses a board card.";
      return n;
    } catch (e) {
      errors[key] = errorText(e);
      return 0;
    }
  };
  const combos = [live("oopRange"), live("ipRange")] as const;
  const pot = Number(form.pot), stack = Number(form.stack);
  if (form.pot.trim() === "" || !(pot > 0 && pot <= 10_000)) errors.pot = "Pot must be between 0 and 10,000 bb.";
  if (form.stack.trim() === "" || !(stack > 0 && stack <= 100_000)) errors.stack = "Stack must be between 0 and 100,000 bb.";
  const oop = parseSizes(form.oopBets), ip = parseSizes(form.ipBets), raises = parseSizes(form.raises);
  if (!oop) errors.oopBets = "Up to 4 sizes, each a percentage of the pot up to 1000.";
  if (!ip) errors.ipBets = "Up to 4 sizes, each a percentage of the pot up to 1000.";
  if (!raises) errors.raises = "Up to 4 sizes, each a percentage of the pot up to 1000.";
  const ok = Object.keys(errors).length === 0;
  const job: Job | null = ok
    ? {
        board: form.board,
        oopRange: form.oopRange,
        ipRange: form.ipRange,
        pot,
        stack,
        oopBetSizes: oop!,
        ipBetSizes: ip!,
        raiseSizes: raises!,
        allIn: form.allIn,
        maxRaises: form.maxRaises,
        targetPct: DEFAULT_TARGET,
        maxIterations: DEFAULT_MAX,
      }
    : null;
  return { ok, errors, combos, job };
}

const INITIAL = RIVER_PRESETS[0];

export function RiverPanel() {
  const { run, stop } = useSolverWorker("river");
  const [presetId, setPresetId] = useState(INITIAL.id);
  const [form, setForm] = useState<RiverForm>(INITIAL.form);
  const [targetPct, setTargetPct] = useState(DEFAULT_TARGET);
  const [maxIterations, setMaxIterations] = useState(DEFAULT_MAX);
  const [status, setStatus] = useState<Status>("running");
  const [error, setError] = useState("");
  const [points, setPoints] = useState<RiverPoint[]>([]);
  const [tree, setTree] = useState<RiverTreeInfo | null>(null);
  const [result, setResult] = useState<RiverResult | null>(null);
  const [runTarget, setRunTarget] = useState(DEFAULT_TARGET);
  const [runId, setRunId] = useState(0);
  const parsed = check(form);

  // Posts a job; state changes only in the worker's callbacks (so this is safe to call from an effect).
  const launch = useCallback(
    (job: Job) => {
      const id = run({ kind: "river", ...job }, (msg) => {
        if (msg.type === "error") {
          setError(msg.message);
          setStatus("error");
          return;
        }
        setTree(msg.tree);
        setPoints((p) => (msg.points.length ? p.concat(msg.points) : p));
        if (msg.type === "done") {
          setResult(msg.result);
          setRunId(id);
          setStatus("done");
        }
      });
    },
    [run],
  );

  useEffect(() => {
    launch(check(INITIAL.form).job!);
  }, [launch]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.job) return;
    setPoints([]);
    setTree(null);
    setError("");
    setStatus("running");
    setRunTarget(targetPct);
    launch({ ...parsed.job, targetPct, maxIterations });
  };

  const halt = () => {
    stop();
    setStatus("stopped");
  };

  const choosePreset = (id: string) => {
    const p = RIVER_PRESETS.find((x) => x.id === id);
    setPresetId(id);
    if (p) setForm(p.form);
  };

  const edit = <K extends keyof RiverForm>(key: K, value: RiverForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setPresetId("custom");
  };

  const running = status === "running";
  const last = points[points.length - 1];
  const r = result;
  const preset = RIVER_PRESETS.find((p) => p.id === presetId);

  const note = (key: keyof RiverForm, hint: string | undefined) => (
    <span id={`river-${key}-note`} className={parsed.errors[key] ? undefined : "text-muted"}>
      {parsed.errors[key] ? <Tag>{parsed.errors[key]}</Tag> : hint}
    </span>
  );

  const text = (key: "board" | "pot" | "stack" | "oopBets" | "ipBets" | "raises", label: string, unit?: string, hint?: string) => (
    <Field label={label} unit={unit} htmlFor={`river-${key}`}>
      <input
        id={`river-${key}`}
        type="text"
        inputMode={key === "board" ? "text" : "decimal"}
        autoComplete="off"
        spellCheck={false}
        value={form[key]}
        aria-invalid={Boolean(parsed.errors[key])}
        aria-describedby={`river-${key}-note`}
        onChange={(e) => edit(key, e.target.value)}
        className={inputClass}
      />
      {note(key, hint)}
    </Field>
  );

  const range = (key: "oopRange" | "ipRange", label: string, n: number) => (
    <Field label={label} htmlFor={`river-${key}`}>
      <textarea
        id={`river-${key}`}
        rows={3}
        spellCheck={false}
        value={form[key]}
        aria-invalid={Boolean(parsed.errors[key])}
        aria-describedby={`river-${key}-note`}
        onChange={(e) => edit(key, e.target.value)}
        className="resize-y"
      />
      {note(key, `${fmt(n, 0)} combos after removing the board cards`)}
    </Field>
  );

  return (
    <Panel
      title="River solver (Discounted CFR)"
      kicker="Heads-up, on a fixed river board. OOP checks or bets; facing a bet, a player folds, calls or raises; check-check and calls go to showdown. Our own DCFR solver finds the equilibrium over every combo in both ranges, with exact card removal, and grades it with an exact best response."
    >
      <Line as="p">
        <span className="max-w-[72ch]">
          <Tag>What this is:</Tag> an exact equilibrium of a simplified river betting abstraction, where players may use only the bet and raise sizes listed below. It is not a
          full no-limit hold&apos;em solver: real players can bet any amount, and the earlier streets that produced these ranges are not modelled.
        </span>
      </Line>
      <Line />

      <Card title="Spot">
        <form onSubmit={submit}>
          <Field label="Preset" htmlFor="river-preset">
            <select id="river-preset" className={selectClass} value={presetId} onChange={(e) => choosePreset(e.target.value)} disabled={running}>
              {RIVER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="custom" disabled>
                Custom
              </option>
            </select>
            {preset && <span className="text-muted">{preset.blurb}</span>}
          </Field>
          {text("board", "Board", "5 cards", "e.g. Ks7d2c9h4s")}
          {range("oopRange", "OOP range (acts first)", parsed.combos[0])}
          {range("ipRange", "IP range", parsed.combos[1])}
          {text("pot", "Pot", "bb")}
          {text("stack", "Stack", "bb behind")}
          {text("oopBets", "OOP bets", "% pot", "Empty: OOP only checks")}
          {text("ipBets", "IP bets", "% pot", "After OOP checks")}
          {text("raises", "Raises", "% pot after call", "100 = pot-sized")}
          <Toggles
            label="Raise cap"
            value={form.maxRaises}
            onChange={(k) => edit("maxRaises", k)}
            options={[0, 1, 2, 3].map((k) => ({ value: k, label: k === 0 ? "No raises" : `${k} raise${k > 1 ? "s" : ""}` }))}
          />
          <div className={FIELD_ROW}>
            <span className="uppercase">All-in</span>
            <span>
              <Choice type="checkbox" id="river-allin" checked={form.allIn} onChange={(e) => edit("allIn", e.target.checked)}>
                All-in option
              </Choice>
            </span>
          </div>
          <Toggles
            label="Stop at (% of pot)"
            value={targetPct}
            onChange={setTargetPct}
            options={TARGETS.map((t) => ({ value: t, label: `${fmt(t, t < 0.1 ? 2 : 1)}%` }))}
          />
          <Toggles label="Max iterations" value={maxIterations} onChange={setMaxIterations} options={MAX_ITERATIONS.map((n) => ({ value: n, label: fmt(n, 0) }))} />
          <Actions>
            <Button type="submit" disabled={running || !parsed.ok}>
              Run
            </Button>
            <Button onClick={halt} variant="secondary" disabled={!running}>
              Stop
            </Button>
          </Actions>
        </form>
        <StatusLine tone={running ? "busy" : status === "error" ? "error" : "muted"}>
          {running && (last ? `Solving: iteration ${fmt(last.iteration, 0)}, exploitability ${fmt(last.exploitabilityPct, 3)}% of the pot` : "Building the tree…")}
          {status === "done" && r && (
            <>
              {r.stoppedBy === "target" ? "Reached" : "Stopped short of"} the target ({fmt(r.targetPct, 2)}% of pot): {fmt(r.iterations, 0)} DCFR iterations in {ms(r.timeMs)}.
            </>
          )}
          {status === "stopped" && `Stopped at iteration ${fmt(last?.iteration ?? 0, 0)}. Results below are from the previous finished run.`}
          {status === "error" && `Solver error: ${error}`}
          {status === "idle" && "Press Run to solve."}
        </StatusLine>
      </Card>

      <Figure caption="FIG. 1: Convergence of the average strategy" legend="Dashed: target exploitability">
        <RiverChart points={points} targetPct={running ? runTarget : (r?.targetPct ?? runTarget)} />
      </Figure>

      <Card title="Tree">
        <Stat label="Combos" value={tree ? `${fmt(tree.combos[0], 0)} × ${fmt(tree.combos[1], 0)}` : "—"} unit="OOP × IP" hint="Live combos after removing board cards" />
        <Stat label="Hand pairs" value={tree ? fmt(tree.pairs, 0) : "—"} hint="Card-disjoint (OOP, IP) combo pairs: every deal the solver weighs" />
        <Stat label="Decision nodes" value={tree ? fmt(tree.counts.decision, 0) : "—"} unit={tree ? `of ${fmt(tree.counts.total, 0)}` : undefined} hint="Decision nodes out of all nodes in the betting tree" />
        <Stat label="Fold / showdown" value={tree ? `${fmt(tree.counts.fold, 0)} / ${fmt(tree.counts.showdown, 0)}` : "—"} hint="Terminal nodes: hands that end in a fold, and hands that reach showdown" />
        <Stat label="Info sets" value={tree ? fmt(tree.counts.infoSets, 0) : "—"} hint="Decision nodes × combos of the player to act" />
      </Card>

      <div className={running && r ? "text-muted" : undefined}>
        <Card title="Result">
          <Stat label="OOP EV" value={r ? fmt(r.potShare[0], 3) : "—"} unit={r ? `bb · ${pct(r.potShare[0] / r.pot, 1)}` : "bb"} hint="OOP's expected share of the pot (bb and % of the pot), counting what it wins or loses beyond it" />
          <Stat label="IP EV" value={r ? fmt(r.potShare[1], 3) : "—"} unit={r ? `bb · ${pct(r.potShare[1] / r.pot, 1)}` : "bb"} />
          <Stat label="OOP vs even split" value={r ? fmtSigned(r.value, 3) : "—"} unit="bb" hint="Zero-sum value: OOP's EV minus half the pot; IP's is the negative" />
          <Stat label="Exploitability" value={r ? `${fmt(r.exploitabilityPct, 3)}%` : "—"} unit="of pot" hint="NashConv / 2, as a share of the starting pot" />
          <Stat label="Exploitability" value={r ? <Sci x={r.exploitability} digits={1} /> : "—"} unit="bb" />
          <Stat label="Iterations" value={r ? fmt(r.iterations, 0) : "—"} unit={r ? `in ${ms(r.timeMs)}` : undefined} />
        </Card>
      </div>

      <Figure caption="FIG. 2: Strategy explorer">
        {r && (
          <Line className="text-muted uppercase">
            <span>
              Board <span className="normal-case">{r.board}</span> · pot {fmt(r.pot, 2)} bb · {fmt(r.stack, 2)} bb behind
            </span>
          </Line>
        )}
        {r ? (
          <div className={running ? "opacity-50" : undefined}>
            <RiverExplorer key={runId} result={r} />
          </div>
        ) : (
          <Line as="p" className="text-muted">
            <span>{status === "error" ? "Fix the input and run again." : "Solving…"}</span>
          </Line>
        )}
      </Figure>

      <Line as="p">
        <span className="max-w-[72ch] text-muted">
          <span className="text-ink uppercase">How it works.</span> Discounted CFR (Brown &amp; Sandholm, 2019, with α = 1.5, β = 0, γ = 2) plays the spot against itself. Each
          decision node keeps a regret and a strategy sum for every combo of the player to act; positive regrets are discounted by t<sup>1.5</sup>/(t<sup>1.5</sup>+1), negative ones
          halved, and iteration t counts t² in the average. Showdowns and folds remove the opponent combos that share a card with yours, so blockers are exact.
        </span>
      </Line>
      <Line as="p">
        <span className="max-w-[72ch] text-muted">
          <span className="text-ink uppercase">Sizes.</span> Bets are a percentage of the pot. A raise of r% means call, then add r% of the pot after calling (100 = a pot-sized
          raise), never less than the previous raise. Any size at or above the stack becomes all-in.
        </span>
      </Line>
      <Line as="p">
        <span className="max-w-[72ch] text-muted">
          <span className="text-ink uppercase">Exploitability</span> is what a perfect counter-strategy would gain, averaged over the two players (NashConv ÷ 2), found by an exact
          best response over the whole tree. EVs are each player&apos;s share of the {r ? `${fmt(r.pot, 2)} bb ` : ""}pot; they add up to the pot.
        </span>
      </Line>
    </Panel>
  );
}
