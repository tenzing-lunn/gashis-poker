"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/doc/cx";
import { Legend } from "@/components/doc";
import { shortLabels, type StripLetter, type StripModel } from "./model";

const pct = (x: number): string => `${Math.round(x * 10000) / 100}%`;

/**
 * `left` for a centered label of `chars` characters at `at` on the track. A full word at 0 or 1 (PRE, SHOW) is
 * kept inside the line: it ends flush with the line's ends instead of hanging past the measure. Each label
 * carries 0.3ch of paper either side (it punches the line), counted in. A single letter (every mark, a W, a
 * street initial) stays on its tick, so letters keep the tick spacing: `.in` is inset 1ch from the track, so
 * its 1.6ch box hangs at most 0.8ch past the line's ends and never past the measure.
 */
export function stripLeft(at: number, chars: number): string {
  if (chars <= 1) return pct(at);
  const half = Math.round((chars / 2 + 0.3) * 100) / 100;
  return `clamp(${half}ch, ${pct(at)}, calc(100% - ${half}ch))`;
}

const WORD: Record<StripLetter, string> = {
  b: "blind",
  X: "check",
  C: "call",
  B: "bet",
  R: "raise",
  A: "all-in",
  F: "fold",
  W: "win",
};

/** The hand history as a figure: one track per seat across the streets (DESIGN.md §4.6). */
export function ActionStrip({ strip }: { strip: StripModel }) {
  // Width of the head track and of one character, for shortening crowded street labels.
  const trackRef = useRef<HTMLSpanElement>(null);
  const [room, setRoom] = useState<{ px: number; ch: number } | null>(null);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setRoom({ px: el.clientWidth, ch: parseFloat(getComputedStyle(el).fontSize) * 0.6 });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const short = room ? shortLabels(strip.labels, room.px, room.ch) : strip.labels.map(() => false);

  return (
    <div className="strips" role="group" aria-label="Action by seat">
      <div className="l strip head" aria-hidden="true">
        <span className="name">
          <span className="full">STREET</span>
          <span className="short" />
        </span>
        <span className="track">
          <span className="in" ref={trackRef}>
            <i className="ln future" style={{ width: "100%" }} />
            <i className="ln" style={{ width: pct(strip.now) }} />
            {strip.labels.map((l, k) => (
              <b
                key={l.label}
                className={l.future ? "future" : undefined}
                style={{ left: stripLeft(l.at, short[k] ? 1 : l.label.length) }}
                title={l.label}
              >
                {short[k] ? l.label[0] : l.label}
              </b>
            ))}
          </span>
        </span>
      </div>
      {strip.rows.map((r) => (
        <div key={r.seat} className={cx("l strip", r.out && "out")}>
          <span className="name" aria-hidden="true">
            <span className="full">
              {r.label} {r.name}
            </span>
            <span className="short">{r.label}</span>
          </span>
          <span className="track" aria-hidden="true">
            <span className="in">
              <i className="ln" style={{ width: pct(r.lineTo) }} />
              {r.marks.map((m, k) => (
                <b key={k} className={m.letter === "W" ? "w" : undefined} style={{ left: stripLeft(m.at, 1) }} title={m.text}>
                  {m.letter}
                </b>
              ))}
            </span>
          </span>
          <span className="sr-only">
            {`Seat ${r.seat + 1}, ${r.name}: ${r.marks.map((m) => WORD[m.letter]).join(", ") || "no action yet"}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/** How to read the strip, then `b BLIND  X CHECK ...`, under it. */
export function StripLegend() {
  return (
    <>
      <Legend>EACH ROW IS A SEAT: ITS ACTIONS IN ORDER, UNDER THE STREET THEY HAPPENED ON</Legend>
      <Legend className="pre">
        <span>b BLIND  X CHECK  C CALL  B BET  R RAISE  A ALL-IN  F FOLD  W WIN</span>
      </Legend>
    </>
  );
}
