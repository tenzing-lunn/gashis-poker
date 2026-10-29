"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Line, TextButton } from "@/components/doc";
import type { HandRead } from "@/lib/poker/hand-read";
import { narrowReadText, panelView } from "./hand-read-model";

// The hand read setting: on at every visit; turning it off holds while moving around the site (module memory),
// and a reload or new visit turns it back on.
/** Not the R of the play controls (R TYPE focuses the raise field): H for hand read. */
const HOTKEY = "h";
let setting = true;
const listeners = new Set<() => void>();

function readSetting(): boolean {
  return setting;
}

function writeSetting(next: boolean): void {
  setting = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * The hand read setting and its toggle. Server render and hydration read the default (on); OFF set earlier in
 * this visit applies right after. Also binds the H key (not in a field, not while a dialog has focus). Mount once per page.
 */
export function useHandRead(): [boolean, () => void] {
  const on = useSyncExternalStore(subscribe, readSetting, () => true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.key.toLowerCase() !== HOTKEY) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (t?.closest?.("dialog")) return;
      e.preventDefault();
      writeSetting(!readSetting());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [on, () => writeSetting(!readSetting())];
}

/** `[HAND READ: ON]` in the table header (`[READ]` on phones, inverted while on). */
export function HandReadToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <TextButton className="hr-toggle" pressed={on} aria-label="Hand read" aria-keyshortcuts="H" title="Hand read (H)" onClick={onToggle}>
      <span className="hr-full" aria-hidden="true">
        [HAND READ: {on ? "ON" : "OFF"}]
      </span>
      <span className="hr-short" aria-hidden="true">
        [READ]
      </span>
    </TextButton>
  );
}

/**
 * Wide screens: the read in the left margin beside the table, level with it. Mount inside the table figure
 * (`PokerTable` children); drawn only from 1400px up (globals.css), and only while there is a read.
 */
export function HandReadPanel({ read, boardLength }: { read: HandRead | null; boardLength: number }) {
  if (!read) return null;
  const v = panelView(read, boardLength);
  return (
    <aside className="hand-read" aria-label="Hand read">
      <div className="hr-head">{v.title}</div>
      <div>{v.made}</div>
      {v.draws ? (
        <>
          <div className="hr-head">DRAWING TO</div>
          {v.draws.length === 0 ? <div className="text-muted">NOTHING</div> : null}
          {v.draws.map((d) => (
            <div key={d.label} className="hr-row">
              <span>{d.label}</span>
              <span>{d.outs}</span>
              <span>{d.pct}</span>
            </div>
          ))}
          {v.total ? (
            <div className="hr-row hr-total">
              <span>{v.total.label}</span>
              <span>{v.total.outs}</span>
              <span>{v.total.pct}</span>
            </div>
          ) : null}
          {v.draws.length > 0 ? <div className="text-muted">% BY THE RIVER, BOARD ONLY</div> : null}
        </>
      ) : null}
    </aside>
  );
}

/**
 * Narrow screens (under 1400px): one line under the table, above the status, `TWO PAIR · 9 OUTS 35% · FLUSH DRAW`.
 * It keeps its slot while empty (between hands, after a fold), so rows never move between streets; cut with an
 * ellipsis, never wrapped (the whole text in its title).
 */
export function HandReadLine({ read }: { read: HandRead | null }) {
  const text = read ? narrowReadText(read) : "";
  return (
    <Line className="hand-read-line">
      <span title={text || undefined}>
        {text ? <span className="sr-only">Your hand: </span> : null}
        {text}
      </span>
    </Line>
  );
}
