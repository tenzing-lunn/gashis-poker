"use client";

import { useMemo, useState } from "react";
import { HAND_CLASSES, combosOfClass } from "@/lib/poker/combinatorics";
import { formatRange, parseRange } from "@/lib/poker/range";
import { WidgetFrame } from "../_components/widget-frame";

// Heuristic 6-max opening ranges (100bb cash, first in, open to 2.5bb). Starting points, not solver output.
const POSITIONS = [
  { pos: "UTG", range: "22+, A2s+, ATo+, K9s+, KQo, QTs+, JTs, T9s, 98s, 87s, 76s" },
  { pos: "HJ", range: "22+, A2s+, ATo+, K9s+, KJo+, Q9s+, QJo, J9s+, T9s, 98s, 87s, 76s, 65s" },
  { pos: "CO", range: "22+, A2s+, A8o+, K7s+, K9o+, Q9s+, QTo+, J9s+, JTo, T8s+, 97s+, 87s, 76s, 65s, 54s" },
  { pos: "BTN", range: "22+, A2+, K2s+, K9o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, T9o, 96s+, 98o, 85s+, 74s+, 64s+, 53s+, 43s" },
  { pos: "SB", range: "22+, A2+, K2s+, K9o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, T9o, 97s+, 86s+, 75s+, 65s, 54s" },
] as const;

/** Class names (e.g. "AKs") fully contained in a range. */
function classesIn(rangeText: string): Set<string> {
  const combos = new Set(parseRange(rangeText));
  const out = new Set<string>();
  for (const c of HAND_CLASSES) {
    if (combosOfClass(c.hi, c.lo, c.kind).every((x) => combos.has(x))) out.add(c.name);
  }
  return out;
}

export function OpeningRanges() {
  const [posIndex, setPosIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => classesIn(POSITIONS[0].range));

  const choose = (i: number) => {
    setPosIndex(i);
    setSelected(classesIn(POSITIONS[i].range));
  };

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const stats = useMemo(() => {
    const combos: number[] = [];
    for (const c of HAND_CLASSES) if (selected.has(c.name)) combos.push(...combosOfClass(c.hi, c.lo, c.kind));
    combos.sort((a, b) => a - b);
    return { combos: combos.length, text: combos.length ? formatRange(combos) : "(empty)" };
  }, [selected]);

  const original = POSITIONS[posIndex];
  const edited = stats.text !== formatRange(parseRange(original.range));

  return (
    <WidgetFrame
      title="6-max opening ranges by position"
      footer="Heuristic starting points for a 100bb cash game when everyone before you has folded; open to 2.5bb. Click any cell to add or remove that hand class and watch the count change. Percent = combos / 1,326."
    >
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Position">
        {POSITIONS.map((p, i) => (
          <button
            key={p.pos}
            type="button"
            role="tab"
            aria-selected={i === posIndex}
            onClick={() => choose(i)}
            className={`rounded-md border px-3 py-1 font-mono text-xs ${
              i === posIndex
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {p.pos}
          </button>
        ))}
        {edited && (
          <button
            type="button"
            onClick={() => choose(posIndex)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Reset {original.pos}
          </button>
        )}
      </div>

      <p className="mt-3 font-mono tabular-nums" aria-live="polite">
        <span className="text-lg font-semibold">{stats.combos}</span> combos ={" "}
        <span className="text-lg font-semibold">{((100 * stats.combos) / 1326).toFixed(1)}%</span> of 1,326
        {edited && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">(edited)</span>}
      </p>

      <div className="mt-3 grid gap-px overflow-hidden rounded-md bg-zinc-300 dark:bg-zinc-700" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
        {HAND_CLASSES.map((c) => {
          const on = selected.has(c.name);
          return (
            <button
              key={c.name}
              type="button"
              aria-pressed={on}
              title={`${c.name}: ${c.combos} combos`}
              onClick={() => toggle(c.name)}
              className={`aspect-square font-mono text-[0.55rem] leading-none sm:text-[0.7rem] ${
                on
                  ? "bg-emerald-600 font-semibold text-white"
                  : c.kind === "pair"
                    ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                    : "bg-white text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500"
              }`}
            >
              {c.name}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Top-right triangle: suited (4 combos each). Bottom-left: offsuit (12). Diagonal: pairs (6).
      </p>
      <p className="mt-3 break-words font-mono text-xs">{stats.text}</p>
    </WidgetFrame>
  );
}
