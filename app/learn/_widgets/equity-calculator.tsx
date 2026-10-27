"use client";

import { useMemo, useState } from "react";
import { parseCards } from "@/lib/poker/cards";
import { COMBO_HI, COMBO_LO } from "@/lib/poker/combinatorics";
import { exactEquity, monteCarloEquity } from "@/lib/poker/equity";
import { parseRange, removeDeadCards } from "@/lib/poker/range";
import { WidgetFrame, buttonClass, inputClass } from "../_components/widget-frame";

const PRESETS = [
  { label: "AA vs KK", hero: "AsAh", villain: "KdKc", board: "" },
  { label: "AK vs a pair of twos", hero: "AhKd", villain: "2s2c", board: "" },
  { label: "AK vs AQ (dominated)", hero: "AhKd", villain: "AsQc", board: "" },
  { label: "JJ vs QQ+, AK", hero: "JhJd", villain: "QQ+, AK", board: "" },
  { label: "AQ vs a wide range", hero: "AhQd", villain: "22+, A2+, K9+, QT+, JT", board: "" },
  { label: "Range vs range on a flop", hero: "TT+, AQ+", villain: "22+, A2+, K9+, QT+, JT", board: "Qs7h2c" },
];

const MC_TRIALS = 40_000;
/** Exact range enumeration is used on a flop or later while (pairs of hands) × (runouts) stays under this. */
const EXACT_BUDGET = 1_500_000;

interface Query {
  hero: string;
  villain: string;
  board: string;
}

interface Outcome {
  equity: number;
  win: number;
  tie: number;
  /** 95% margin (1.96 standard errors) for Monte Carlo, 0 when exact. */
  margin: number;
  method: string;
  heroCombos: number;
  villainCombos: number;
}

const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;
const cardsOf = (combo: number) => [COMBO_HI[combo], COMBO_LO[combo]];

function compute(q: Query): Outcome {
  const board = parseCards(q.board);
  if (board.length !== 0 && (board.length < 3 || board.length > 5)) throw new Error("The board must be empty or have 3, 4 or 5 cards");
  if (new Set(board).size !== board.length) throw new Error("The same card appears twice on the board");
  const hero = removeDeadCards(parseRange(q.hero), board);
  const villain = removeDeadCards(parseRange(q.villain), board);
  if (hero.length === 0) throw new Error("Your side has no hands left after removing the board cards");
  if (villain.length === 0) throw new Error("The opponent's side has no hands left after removing the board cards");

  // Every compatible pair of hands is equally likely (the two sides cannot share a card).
  const pairs: [number[], number[]][] = [];
  for (const a of hero) {
    for (const b of villain) {
      const ha = cardsOf(a), hb = cardsOf(b);
      if (ha[0] !== hb[0] && ha[0] !== hb[1] && ha[1] !== hb[0] && ha[1] !== hb[1]) pairs.push([ha, hb]);
    }
  }
  if (pairs.length === 0) throw new Error("The two sides share every card, so no matchup is possible");
  // When one side is a single hand, its cards are known too, so remove them from the other side's count.
  const heroCombos = villain.length === 1 ? removeDeadCards(hero, cardsOf(villain[0])).length : hero.length;
  const villainCombos = hero.length === 1 ? removeDeadCards(villain, cardsOf(hero[0])).length : villain.length;

  const unseen = 52 - 4 - board.length;
  const toDeal = 5 - board.length;
  let runouts = 1;
  for (let k = 0; k < toDeal; k++) runouts = (runouts * (unseen - k)) / (k + 1);

  if (pairs.length === 1 || (board.length >= 3 && pairs.length * runouts <= EXACT_BUDGET)) {
    let eq = 0, win = 0, tie = 0;
    for (const [a, b] of pairs) {
      const p = exactEquity([a, b], board).players[0];
      eq += p.equity;
      win += p.win;
      tie += p.tie;
    }
    const n = pairs.length;
    return {
      equity: eq / n,
      win: win / n,
      tie: tie / n,
      margin: 0,
      method:
        n === 1
          ? `Exact: all ${Math.round(runouts).toLocaleString("en-US")} runouts enumerated.`
          : `Exact: ${n.toLocaleString("en-US")} equally likely matchups × ${Math.round(runouts).toLocaleString("en-US")} runouts each.`,
      heroCombos,
      villainCombos,
    };
  }

  const r = monteCarloEquity([hero, villain], { board, trials: MC_TRIALS, seed: 1 }).players[0];
  return {
    equity: r.equity,
    win: r.win,
    tie: r.tie,
    margin: 1.96 * r.stdErr,
    method: `Monte Carlo: ${MC_TRIALS.toLocaleString("en-US")} random deals (fixed seed). The true value is within the ± margin about 95% of the time.`,
    heroCombos,
    villainCombos,
  };
}

export function EquityCalculator() {
  const [hero, setHero] = useState(PRESETS[0].hero);
  const [villain, setVillain] = useState(PRESETS[0].villain);
  const [board, setBoard] = useState(PRESETS[0].board);
  const [query, setQuery] = useState<Query>({ hero: PRESETS[0].hero, villain: PRESETS[0].villain, board: PRESETS[0].board });

  const result = useMemo(() => {
    try {
      return { ok: true as const, out: compute(query) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [query]);

  const dirty = hero !== query.hero || villain !== query.villain || board !== query.board;
  const approx = result.ok && result.out.margin > 0 ? "≈ " : "";

  return (
    <WidgetFrame
      title="Equity calculator"
      footer="Each side can be one hand (AhKd) or a range (QQ+, AK). Hand vs hand is exact. A range is averaged over every compatible hand in it, each equally likely: exactly on a flop or later when that is fast enough, otherwise by Monte Carlo."
    >
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setHero(p.hero);
              setVillain(p.villain);
              setBoard(p.board);
              setQuery({ hero: p.hero, villain: p.villain, board: p.board });
            }}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {p.label}
          </button>
        ))}
      </div>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ hero, villain, board });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">You (hand or range)</span>
          <input className={inputClass} value={hero} onChange={(e) => setHero(e.target.value)} spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Opponent (hand or range)</span>
          <input className={inputClass} value={villain} onChange={(e) => setVillain(e.target.value)} spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Board (optional)</span>
          <input className={inputClass} value={board} onChange={(e) => setBoard(e.target.value)} placeholder="e.g. Qs7h2c" spellCheck={false} />
        </label>
        <button type="submit" className={buttonClass}>
          {dirty ? "Calculate" : "Calculated"}
        </button>
      </form>

      <div className="mt-4" aria-live="polite">
        {!result.ok ? (
          <p className="text-red-600 dark:text-red-400">{result.error}.</p>
        ) : (
          <>
            <div className="flex h-6 overflow-hidden rounded-md font-mono text-xs tabular-nums">
              <div className="flex items-center bg-emerald-600 px-2 text-white" style={{ width: `${100 * result.out.equity}%` }}>
                {result.out.equity >= 0.12 ? pct(result.out.equity) : ""}
              </div>
              <div className="flex flex-1 items-center justify-end bg-zinc-300 px-2 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100">
                {result.out.equity <= 0.88 ? pct(1 - result.out.equity) : ""}
              </div>
            </div>
            <table className="mt-3 w-full text-sm">
              <tbody className="[&_td]:py-1">
                <tr>
                  <td className="text-zinc-500">Your equity</td>
                  <td className="text-right font-mono font-semibold tabular-nums">
                    {approx}
                    {pct(result.out.equity, 2)}
                    {result.out.margin > 0 && <span className="font-normal text-zinc-500"> ± {(100 * result.out.margin).toFixed(2)} pts</span>}
                  </td>
                </tr>
                <tr>
                  <td className="text-zinc-500">Opponent&apos;s equity</td>
                  <td className="text-right font-mono tabular-nums">
                    {approx}
                    {pct(1 - result.out.equity, 2)}
                  </td>
                </tr>
                <tr>
                  <td className="text-zinc-500">You win outright / split</td>
                  <td className="text-right font-mono tabular-nums">
                    {approx}
                    {pct(result.out.win, 2)} / {pct(result.out.tie, 2)}
                  </td>
                </tr>
                <tr>
                  <td className="text-zinc-500">Combos left after card removal</td>
                  <td className="text-right font-mono tabular-nums">
                    {result.out.heroCombos} vs {result.out.villainCombos}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-zinc-500">{result.out.method}</p>
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
