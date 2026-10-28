"use client";

import { useEffect, useRef, useState } from "react";
import { BoxButton, Field, Legend, Line, Tag, TextButton } from "@/components/doc";
import { NumTable, Row, WidgetFrame } from "../_components/widget-frame";
import type { EquityOutcome, EquityQuery, EquityResponse } from "./equity-math";

const PRESETS = [
  { label: "AA vs KK", hero: "AsAh", villain: "KdKc", board: "" },
  { label: "AK vs a pair of twos", hero: "AhKd", villain: "2s2c", board: "" },
  { label: "AK vs AQ (dominated)", hero: "AhKd", villain: "AsQc", board: "" },
  { label: "JJ vs QQ+, AK", hero: "JhJd", villain: "QQ+, AK", board: "" },
  { label: "AQ vs a wide range", hero: "AhQd", villain: "22+, A2+, K9+, QT+, JT", board: "" },
  { label: "Range vs range on a flop", hero: "TT+, AQ+", villain: "22+, A2+, K9+, QT+, JT", board: "Qs7h2c" },
];

const START: EquityQuery = { hero: PRESETS[0].hero, villain: PRESETS[0].villain, board: PRESETS[0].board };
/** Class rows shown before [show all]. */
const CLASS_ROWS = 12;

interface View {
  /** The latest result and the query it answers; while a newer query runs it stays on screen, greyed. */
  outcome: EquityOutcome | null;
  error: string | null;
  answers: EquityQuery | null;
  busy: boolean;
  progress: { done: number; total: number } | null;
}

const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;

export function EquityCalculator() {
  const [hero, setHero] = useState(START.hero);
  const [villain, setVillain] = useState(START.villain);
  const [board, setBoard] = useState(START.board);
  const [query, setQuery] = useState<EquityQuery>(START);
  const [view, setView] = useState<View>({ outcome: null, error: null, answers: null, busy: true, progress: null });
  const [showAll, setShowAll] = useState(false);

  // One worker for this widget. Each job has an id; replies to anything but the latest job are dropped.
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const queriesRef = useRef(new Map<number, EquityQuery>());

  const post = (worker: Worker, q: EquityQuery) => {
    const id = ++jobRef.current;
    queriesRef.current.clear();
    queriesRef.current.set(id, q);
    worker.postMessage({ id, ...q });
  };

  useEffect(() => {
    const worker = new Worker(new URL("./equity.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<EquityResponse>) => {
      const msg = e.data;
      if (msg.id !== jobRef.current) return;
      const answers = queriesRef.current.get(msg.id) ?? null;
      if (msg.type === "progress") setView((v) => ({ ...v, progress: { done: msg.done, total: msg.total } }));
      else if (msg.type === "error") setView({ outcome: null, error: msg.message, answers, busy: false, progress: null });
      else setView({ outcome: msg.outcome, error: null, answers, busy: !msg.final, progress: null });
    };
    worker.onerror = (e) => {
      e.preventDefault();
      const answers = queriesRef.current.get(jobRef.current) ?? null;
      setView({ outcome: null, error: e.message || "The calculator's worker failed to load", answers, busy: false, progress: null });
    };
    workerRef.current = worker;
    post(worker, START);
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const calculate = (q: EquityQuery) => {
    setQuery(q);
    const worker = workerRef.current;
    if (!worker) return;
    setView((v) => ({ ...v, busy: true, progress: null }));
    post(worker, q);
  };

  const dirty = hero !== query.hero || villain !== query.villain || board !== query.board;
  const stale = view.answers !== query;
  const out = view.outcome;
  const approx = out && out.margin > 0 ? "≈ " : "";
  const classes = out && out.classes.length > 1 ? out.classes : null;

  return (
    <WidgetFrame
      title="Equity calculator"
      footer="Each side can be one hand (AhKd) or a range (QQ+, AK). Hand vs hand is exact. A range is averaged over every compatible pair of hands, each equally likely, and broken down by hand class. When every runout of every matchup fits the budget it is counted exactly, after a quick Monte Carlo preview; otherwise the result is Monte Carlo with a ± margin."
    >
      <Line>
        <span className="flex flex-wrap gap-x-[1ch]">
          {PRESETS.map((p) => (
            <TextButton
              key={p.label}
              pressed={query.hero === p.hero && query.villain === p.villain && query.board === p.board}
              onClick={() => {
                setHero(p.hero);
                setVillain(p.villain);
                setBoard(p.board);
                calculate({ hero: p.hero, villain: p.villain, board: p.board });
              }}
            >
              [{p.label}]
            </TextButton>
          ))}
        </span>
      </Line>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          calculate({ hero, villain, board });
        }}
      >
        <Field label="You (hand or range)" value={hero} onChange={(e) => setHero(e.target.value)} spellCheck={false} />
        <Field label="Opponent (hand or range)" value={villain} onChange={(e) => setVillain(e.target.value)} spellCheck={false} />
        <Field label="Board (optional)" value={board} onChange={(e) => setBoard(e.target.value)} placeholder="e.g. Qs7h2c" spellCheck={false} />
        <Line>
          <BoxButton type="submit" filled={dirty}>
            {dirty ? "Calculate" : "Calculated"}
          </BoxButton>
        </Line>
      </form>

      {view.busy && (
        <Line>
          <span className="text-muted tabular-nums">
            <span aria-hidden="true">● </span>
            {view.progress
              ? `Counting every runout exactly: ${view.progress.done.toLocaleString("en-US")} of ${view.progress.total.toLocaleString("en-US")} matchups`
              : out && !stale
                ? "Counting every runout exactly"
                : "Calculating"}
            …
          </span>
        </Line>
      )}
      <div aria-live="polite">
        {view.error && !stale ? (
          <Line>
            <Tag>{view.error.replace(/\.$/, "")}.</Tag>
          </Line>
        ) : (
          out && (
            <div className={stale ? "text-muted" : undefined}>
              <Line className="items-center">
                <span className="flex h-[19px] w-full border border-ink text-[12px] leading-none">
                  <span className="flex items-center bg-ink px-[1ch] text-paper" style={{ width: `${100 * out.equity}%` }}>
                    {out.equity >= 0.12 ? pct(out.equity) : ""}
                  </span>
                  <span className="flex flex-1 items-center justify-end px-[1ch]">{out.equity <= 0.88 ? pct(1 - out.equity) : ""}</span>
                </span>
              </Line>
              <Row label="Your equity">
                <span className="inv">
                  {approx}
                  {pct(out.equity, 2)}
                </span>
                {out.margin > 0 && <span className="text-muted"> ± {(100 * out.margin).toFixed(2)} pts</span>}
              </Row>
              <Row label="Opponent's equity">
                {approx}
                {pct(1 - out.equity, 2)}
              </Row>
              <Row label="You win outright / split">
                {approx}
                {pct(out.win, 2)} / {pct(out.tie, 2)}
              </Row>
              <Row label="Combos left after card removal">
                {out.heroCombos} vs {out.villainCombos}
              </Row>
              {classes && (
                <>
                  <NumTable
                    head={[
                      out.bySide === "villain" ? "Their class" : "Your class",
                      "Combos",
                      "Weight",
                      out.bySide === "villain" ? "Your equity vs it" : "Your equity with it",
                    ]}
                    rows={[
                      ...(showAll ? classes : classes.slice(0, CLASS_ROWS)).map((c) => ({
                        key: c.name,
                        cells: [
                          <span key="n" className="normal-case">
                            {c.name}
                          </span>,
                          c.combos,
                          pct(c.weight),
                          <>
                            {approx}
                            {pct(c.equity)}
                            {c.margin > 0 && <span className="text-muted"> ± {(100 * c.margin).toFixed(1)}</span>}
                          </>,
                        ],
                      })),
                      {
                        key: "total",
                        cells: ["Total", classes.reduce((n, c) => n + c.combos, 0), "100%", `${approx}${pct(out.equity)}`],
                      },
                    ]}
                  />
                  {classes.length > CLASS_ROWS && (
                    <Line>
                      <span className="text-muted">
                        {showAll ? `All ${classes.length} classes shown.` : `First ${CLASS_ROWS} of ${classes.length} classes shown.`}
                      </span>
                      <TextButton onClick={() => setShowAll(!showAll)}>[{showAll ? "show fewer" : `show all ${classes.length}`}]</TextButton>
                    </Line>
                  )}
                </>
              )}
              <Legend>
                <span>
                  {classes && "Your equity is the weighted average of the rows: each class's equity times its weight (its share of all the equally likely matchups). "}
                  {out.method}
                </span>
              </Legend>
            </div>
          )
        )}
      </div>
    </WidgetFrame>
  );
}
