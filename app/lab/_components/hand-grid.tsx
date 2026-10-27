"use client";

import { memo, useRef, useState, type KeyboardEvent } from "react";
import { HAND_CLASSES } from "@/lib/poker/combinatorics";
import { Line } from "@/components/doc";
import { pct } from "./format";

// Same layout as lib/gto's classGrid / CLASS_GRID_NAMES: index r*13 + c is HAND_CLASSES order, ranks A..2
// from the top-left, pairs on the diagonal, suited above it, offsuit below. Built from lib/poker here so
// the main bundle doesn't pull in pushfold.ts and, with it, the 100 KB preflop matrix.
const NAMES = HAND_CLASSES.map((h) => h.name);
const COMBOS = HAND_CLASSES.map((h) => h.combos);

const TONE = {
  push: { label: "pushes" },
  call: { label: "calls" },
} as const;

/** 13x13 hand-class grid shaded by frequency, with a readout for the hovered or focused cell. */
export const HandGrid = memo(function HandGrid({ title, freq, tone }: { title: string; freq: readonly number[] | null; tone: keyof typeof TONE }) {
  const [active, setActive] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const t = TONE[tone];

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 13, ArrowUp: -13, Home: -(focusIndex % 13), End: 12 - (focusIndex % 13) }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const next = focusIndex + d;
    if (next < 0 || next > 168 || (Math.abs(d) === 1 && Math.floor(next / 13) !== Math.floor(focusIndex / 13))) return;
    setFocusIndex(next);
    gridRef.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus();
  };

  const shown = active ?? null;
  return (
    <div className="flex min-w-0 flex-col">
      <Line className="uppercase">
        <span>{title}</span>
      </Line>
      <div
        ref={gridRef}
        role="grid"
        aria-label={`${title}: frequency per hand class`}
        onKeyDown={move}
        onMouseLeave={() => setActive(null)}
        className="grid aspect-square w-full max-w-[26rem] grid-cols-13 gap-px border border-faint bg-faint"
      >
        {NAMES.map((name, i) => {
          const f = freq ? freq[i] : 0;
          return (
            <div
              key={name}
              role="gridcell"
              data-i={i}
              tabIndex={i === focusIndex ? 0 : -1}
              aria-label={`${name}: ${freq ? pct(f, 1) : "not solved"}`}
              title={`${name}: ${freq ? pct(f, 2) : "—"}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => {
                setActive(i);
                setFocusIndex(i);
              }}
              onBlur={() => setActive(null)}
              style={{ backgroundColor: `color-mix(in srgb, var(--ink) ${(100 * f).toFixed(1)}%, var(--paper))` }}
              className={`relative flex items-center justify-center text-[clamp(7px,2.1vw,11px)] leading-none tracking-tighter focus-visible:z-10 ${f > 0.55 ? "text-paper" : "text-muted"} ${
                active === i ? `z-10 outline-2 -outline-offset-2 ${f > 0.55 ? "outline-paper" : "outline-ink"}` : ""
              }`}
            >
              {name}
            </div>
          );
        })}
      </div>
      <Line as="p" className="tabular-nums">
        <span className="text-muted">
          {shown !== null && freq ? (
            <>
              <span className="text-ink">{NAMES[shown]}</span> ({COMBOS[shown]} combos) {t.label} <span className="inv">{pct(freq[shown], 2)}</span>
            </>
          ) : (
            "Hover or focus a cell for its exact frequency."
          )}
        </span>
      </Line>
    </div>
  );
});
