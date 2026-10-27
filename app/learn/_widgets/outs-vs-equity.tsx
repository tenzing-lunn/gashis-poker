"use client";

import { useMemo, useState } from "react";
import { parseCards } from "@/lib/poker/cards";
import { exactEquity } from "@/lib/poker/equity";
import { Cards } from "../_components/lesson-ui";
import { WidgetFrame, inputClass } from "../_components/widget-frame";
import { nextCardOuts, oneCard, twoCards } from "./outs-math";

const PRESETS = [
  { label: "Flush draw vs top pair, turn", hero: "9h8h", villain: "KcQd", board: "Kh7h2d3s" },
  { label: "Dirty outs: flush draw vs a set, turn", hero: "AhKh", villain: "8s8d", board: "8h7h2c5s" },
  { label: "Flush draw vs top pair, flop", hero: "9h8h", villain: "KcQd", board: "Kh7h2d" },
  { label: "Flush draw + an ace vs top pair, flop", hero: "Ah5h", villain: "KcQd", board: "Kh7h2d" },
  { label: "Flush draw + straight draw vs aces, flop", hero: "JhTh", villain: "AcAd", board: "9h8h2c" },
];

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

export function OutsVsEquity() {
  const [hero, setHero] = useState(PRESETS[0].hero);
  const [villain, setVillain] = useState(PRESETS[0].villain);
  const [board, setBoard] = useState(PRESETS[0].board);

  const r = useMemo(() => {
    try {
      const h = parseCards(hero), v = parseCards(villain), b = parseCards(board);
      if (h.length !== 2 || v.length !== 2) return { error: "Each hand needs exactly two cards." };
      if (b.length !== 3 && b.length !== 4) return { error: "Use a flop (3 board cards) or a turn (4 board cards)." };
      const all = [...h, ...v, ...b];
      if (new Set(all).size !== all.length) return { error: "The same card appears twice." };
      const eq = exactEquity([h, v], b).players[0];
      const outs = nextCardOuts(hero, villain, board);
      const o = outs.ahead.length;
      const estimate = b.length === 4 ? oneCard(o, outs.unseen) : twoCards(o, outs.unseen);
      const formula =
        b.length === 4 ? `${o} / ${outs.unseen}` : `1 − (${outs.unseen - o}/${outs.unseen}) × (${outs.unseen - 1 - o}/${outs.unseen - 1})`;
      return { error: null, eq, outs, o, estimate, formula, street: b.length === 4 ? "turn" : "flop" };
    } catch (e) {
      return { error: `${(e as Error).message}. Write cards like Ah 9c.` };
    }
  }, [hero, villain, board]);

  return (
    <WidgetFrame
      title="Outs vs real equity against a known hand"
      footer="Both hands are known here, so the unseen deck is 52 − 4 hole cards − the board (44 on the turn, 45 on the flop). Exact result: every possible runout enumerated."
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
            }}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Your hand</span>
          <input className={inputClass} value={hero} onChange={(e) => setHero(e.target.value)} spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Opponent&apos;s hand</span>
          <input className={inputClass} value={villain} onChange={(e) => setVillain(e.target.value)} spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Board (3 or 4 cards)</span>
          <input className={inputClass} value={board} onChange={(e) => setBoard(e.target.value)} spellCheck={false} />
        </label>
      </div>
      <div className="mt-4 space-y-2" aria-live="polite">
        {r.error !== null ? (
          <p className="text-red-600 dark:text-red-400">{r.error}</p>
        ) : (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              Right now you are {r.outs.now > 0 ? "ahead" : r.outs.now < 0 ? "behind" : "tied"}.
            </p>
            <div>
              <p>
                <span className="font-semibold">{r.o} outs</span>{" "}
                <span className="text-zinc-500">(next cards that put you ahead):</span>
              </p>
              <div className="mt-1 flex flex-wrap gap-1">{r.o > 0 ? <Cards hand={r.outs.ahead.join("")} /> : <span className="text-zinc-500">none</span>}</div>
              {r.outs.tie.length > 0 && (
                <p className="mt-1 text-zinc-500">
                  Plus {r.outs.tie.length} card{r.outs.tie.length > 1 ? "s" : ""} that would tie: <Cards hand={r.outs.tie.join("")} />
                </p>
              )}
            </div>
            <table className="w-full text-sm">
              <tbody className="[&_td]:py-1">
                <tr>
                  <td className="text-zinc-500">Outs estimate</td>
                  <td className="font-mono">{r.formula}</td>
                  <td className="text-right font-mono tabular-nums">{pct(r.estimate)}</td>
                </tr>
                <tr>
                  <td className="text-zinc-500">Exact equity (all runouts)</td>
                  <td />
                  <td className="text-right font-mono font-semibold tabular-nums">{pct(r.eq.equity)}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-zinc-500">
              {r.street === "turn"
                ? "With one card to come, an out either wins or it does not, so the outs count is exact when every out wins and nothing else does."
                : "With two cards to come, the outs estimate misses runner-runner hands (two running cards that both help) and the opponent improving after you hit, so it can differ from the exact equity in either direction."}
            </p>
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
