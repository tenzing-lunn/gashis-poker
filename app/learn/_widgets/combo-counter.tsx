"use client";

import { useMemo, useState } from "react";
import { parseCards } from "@/lib/poker/cards";
import { HAND_CLASSES } from "@/lib/poker/combinatorics";
import { comboClassName, formatCombo, parseRange, removeDeadCards } from "@/lib/poker/range";
import { WidgetFrame, inputClass } from "../_components/widget-frame";

interface ClassRow {
  name: string;
  full: number;
  live: string[];
}

const CLASS_ORDER = new Map(HAND_CLASSES.map((c, i) => [c.name, i]));

export function ComboCounter() {
  const [rangeText, setRangeText] = useState("QQ+, AK");
  const [knownText, setKnownText] = useState("Kh 7d 2c");

  const result = useMemo(() => {
    let range: number[];
    try {
      range = parseRange(rangeText);
    } catch (e) {
      return { error: `Range: ${(e as Error).message}` };
    }
    let known: number[];
    try {
      known = knownText.trim() ? parseCards(knownText) : [];
    } catch (e) {
      return { error: `Known cards: ${(e as Error).message}. Write cards like Kh 7d 2c.` };
    }
    const live = new Set(removeDeadCards(range, known));
    const byClass = new Map<string, ClassRow>();
    for (const combo of range) {
      const name = comboClassName(combo);
      const row = byClass.get(name) ?? { name, full: 0, live: [] };
      row.full++;
      if (live.has(combo)) row.live.push(formatCombo(combo));
      byClass.set(name, row);
    }
    const rows = [...byClass.values()].sort((a, b) => CLASS_ORDER.get(a.name)! - CLASS_ORDER.get(b.name)!);
    return { error: null, before: range.length, after: live.size, rows };
  }, [rangeText, knownText]);

  return (
    <WidgetFrame
      title="Combo counter"
      footer="Range notation: 22+ (all pairs), ATs+ (ATs, AJs, AQs, AKs), KQo, A5s-A2s, AK (suited and offsuit), AhKh (one combo). Separate tokens with commas."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Range</span>
          <input className={inputClass} value={rangeText} onChange={(e) => setRangeText(e.target.value)} spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Cards you can see (yours and the board)</span>
          <input className={inputClass} value={knownText} onChange={(e) => setKnownText(e.target.value)} spellCheck={false} />
        </label>
      </div>
      <div className="mt-4" aria-live="polite">
        {result.error !== null ? (
          <p className="text-red-600 dark:text-red-400">{result.error}</p>
        ) : (
          <>
            <p className="text-base">
              <span className="font-mono text-lg font-semibold tabular-nums">{result.after}</span> combos still possible
              <span className="text-zinc-500">
                {" "}
                (of {result.before} before removing the cards you see) ·{" "}
                <span className="font-mono tabular-nums">{((100 * result.after) / 1326).toFixed(2)}%</span> of all 1,326 starting hands
              </span>
            </p>
            {result.rows.length > 0 && (
              <div className="mt-3 max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="pb-1 font-normal">Class</th>
                      <th className="pb-1 font-normal">Live / full</th>
                      <th className="pb-1 font-normal">Live combos</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {result.rows.map((r) => (
                      <tr key={r.name} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                        <td className="py-1 pr-3">{r.name}</td>
                        <td className={`py-1 pr-3 tabular-nums ${r.live.length < r.full ? "text-amber-700 dark:text-amber-400" : ""}`}>
                          {r.live.length} / {r.full}
                        </td>
                        <td className="py-1 text-xs text-zinc-600 dark:text-zinc-400">{r.live.join(" ") || "none"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
