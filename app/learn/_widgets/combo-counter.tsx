"use client";

import { useMemo, useState } from "react";
import { parseCards } from "@/lib/poker/cards";
import { HAND_CLASSES } from "@/lib/poker/combinatorics";
import { comboClassName, formatCombo, parseRange, removeDeadCards } from "@/lib/poker/range";
import { Field, Line, Tag } from "@/components/doc";
import { Scroll, WidgetFrame } from "../_components/widget-frame";

interface ClassRow {
  name: string;
  full: number;
  live: string[];
}

const CLASS_ORDER = new Map(HAND_CLASSES.map((c, i) => [c.name, i]));

/** Class, live / full count, then the live combos (on their own row under 680px). Columns keep the counts aligned. */
const ROW = "grid! tabular-nums grid-cols-[5ch_11ch_minmax(0,1fr)] max-[679px]:grid-cols-[5ch_minmax(0,1fr)]";

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
      <Field label="Range" value={rangeText} onChange={(e) => setRangeText(e.target.value)} spellCheck={false} />
      <Field label="Cards you can see (yours and the board)" value={knownText} onChange={(e) => setKnownText(e.target.value)} spellCheck={false} />
      <div aria-live="polite">
        {result.error !== null ? (
          <Line>
            <Tag>{result.error}</Tag>
          </Line>
        ) : (
          <>
            <Line>
              <span>
                <span className="inv">{result.after}</span> combos still possible
                <span className="text-muted">
                  {" "}
                  (of {result.before} before removing the cards you see) · {((100 * result.after) / 1326).toFixed(2)}% of all 1,326 starting hands
                </span>
              </span>
            </Line>
            {result.rows.length > 0 && (
              <>
                <Line className={`${ROW} text-muted uppercase`}>
                  <span>Class</span>
                  <span className="text-right">Live / full</span>
                  <span className="max-[679px]:hidden">Live combos</span>
                </Line>
                {/* capped at about 12 lines: wide ranges scroll inside the figure instead of running down the page */}
                <Scroll className="ln-quiet max-h-[calc(var(--lh)*12em)] overflow-y-auto">
                  <div role="region" aria-label="Live combos by class" tabIndex={0}>
                    {result.rows.map((r) => (
                      <Line key={r.name} className={ROW}>
                        <span>{r.name}</span>
                        <span className="text-right">
                          <span className={r.live.length < r.full ? "inv" : ""}>
                            {r.live.length} / {r.full}
                          </span>
                        </span>
                        <span className="text-muted max-[679px]:col-span-2">{r.live.join(" ") || "none"}</span>
                      </Line>
                    ))}
                  </div>
                </Scroll>
              </>
            )}
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
