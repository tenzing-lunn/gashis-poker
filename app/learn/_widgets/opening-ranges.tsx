"use client";

import { useMemo, useState } from "react";
import { HAND_CLASSES, combosOfClass } from "@/lib/poker/combinatorics";
import { formatRange, parseRange } from "@/lib/poker/range";
import { Legend, Line, Tag, TextButton } from "@/components/doc";
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
      <Line role="group" aria-label="Position">
        <span>
          {POSITIONS.map((p, i) => (
            <TextButton key={p.pos} pressed={i === posIndex} onClick={() => choose(i)}>
              {p.pos}
            </TextButton>
          ))}
        </span>
        {edited && <TextButton onClick={() => choose(posIndex)}>[Reset {original.pos}]</TextButton>}
      </Line>

      <Line aria-live="polite">
        <span>
          <span className="inv">{stats.combos}</span> combos = <span className="inv">{((100 * stats.combos) / 1326).toFixed(1)}%</span> of 1,326
          {edited && (
            <>
              {" "}
              <Tag>(edited)</Tag>
            </>
          )}
        </span>
      </Line>

      <div className="grid w-full max-w-[26rem] gap-px border border-faint bg-faint" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
        {HAND_CLASSES.map((c) => {
          const on = selected.has(c.name);
          return (
            <button
              key={c.name}
              type="button"
              aria-pressed={on}
              title={`${c.name}: ${c.combos} combos`}
              onClick={() => toggle(c.name)}
              className={`aspect-square text-[9px] leading-none hover:outline hover:-outline-offset-1 hover:outline-ink sm:text-[11px] ${
                on ? "bg-ink text-paper" : c.kind === "pair" ? "bg-paper text-ink" : "bg-paper text-muted"
              }`}
            >
              {c.name}
            </button>
          );
        })}
      </div>
      <Legend>
        <span>Top-right triangle: suited (4 combos each). Bottom-left: offsuit (12). Diagonal: pairs (6).</span>
      </Legend>
      <Line>
        <span className="break-words">{stats.text}</span>
      </Line>
    </WidgetFrame>
  );
}
