"use client";

import { memo, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { HAND_CLASSES } from "@/lib/poker/combinatorics";
import type { RiverNodeView, RiverResult } from "@/lib/gto/worker-protocol";
import { fmt, pct } from "./format";
import { Line } from "@/components/doc";
import { Button, FIELD_ROW, Scroll, selectClass } from "./ui";

const NAMES = HAND_CLASSES.map((h) => h.name);
const PLAYER = ["OOP", "IP"] as const;

// Ink only, told apart by pattern as well as tone: check / call dotted, fold hatched, bets and raises solid and
// darker with size, all-in solid ink. Three bet tones at most (adjacent steps >= 1.9:1 on the dark band); any
// further sizes share the darkest one, and the grid legend groups them. Each entry is a CSS `background` value.
const tone = (pct: number) => `color-mix(in srgb, var(--ink) ${pct}%, var(--paper))`;
const PASSIVE = "radial-gradient(circle, var(--ink) 0 0.9px, transparent 1.1px) 0 0 / 3px 3px, var(--paper)";
const FOLD = "repeating-linear-gradient(135deg, var(--muted) 0 1px, var(--paper) 1px 4px)";
const AGGRESSIVE = [25, 48, 72].map(tone);
const ALL_IN = "var(--ink)";

/** A small legend square in an action's tone. */
function Swatch({ bg, size = "1ch" }: { bg: string; size?: string }) {
  return <span aria-hidden className="inline-block shrink-0 border border-ink" style={{ background: bg, width: size, height: size }} />;
}

function actionColors(node: RiverNodeView): string[] {
  let k = 0;
  return node.actions.map((a) => {
    if (a.kind === "check" || a.kind === "call") return PASSIVE;
    if (a.kind === "fold") return FOLD;
    if (a.kind === "allin") return ALL_IN;
    return AGGRESSIVE[Math.min(k++, AGGRESSIVE.length - 1)];
  });
}

/** Legend entries, one per distinct fill: actions that share a tone are listed together. */
function legendGroups(colors: string[], actions: string[]): { bg: string; labels: string[] }[] {
  const groups: { bg: string; labels: string[] }[] = [];
  colors.forEach((bg, k) => {
    const g = groups.find((x) => x.bg === bg);
    if (g) g.labels.push(actions[k]);
    else groups.push({ bg, labels: [actions[k]] });
  });
  return groups;
}

/** Action label with the bet as a share of the pot, e.g. "Bet 3.3 (33%)". */
function actionLabel(node: RiverNodeView, a: number, pot: number): string {
  const act = node.actions[a];
  const potNow = pot + node.committed[0] + node.committed[1];
  if (act.kind === "bet" || (act.kind === "allin" && node.committed[0] === node.committed[1])) return `${act.label} (${fmt((100 * act.amount) / potNow, 0)}% pot)`;
  return act.label;
}

export function nodeTitle(node: RiverNodeView): string {
  if (node.history.length === 0) return "OOP first to act";
  return `${PLAYER[node.player]} after ${node.history.join(" · ")}`;
}

interface ClassCell {
  /** Combos of the class in the acting player's range (after board removal). */
  combos: number[];
  /** Sum of own reach over those combos. */
  reach: number;
  /** Reach-weighted frequency of each action, or null if no combo reaches the node. */
  freq: number[] | null;
}

function summarise(result: RiverResult, node: RiverNodeView) {
  const combos = result.rangeCombos[node.player];
  const n = combos.length, A = node.actions.length;
  const cells: ClassCell[] = Array.from({ length: 169 }, () => ({ combos: [], reach: 0, freq: null }));
  const totals = new Array<number>(A).fill(0);
  let reachTotal = 0;
  for (let i = 0; i < n; i++) {
    const cell = cells[combos[i].classIndex];
    cell.combos.push(i);
    const r = node.reach[i];
    cell.reach += r;
    reachTotal += r;
    if (!cell.freq) cell.freq = new Array<number>(A).fill(0);
    for (let a = 0; a < A; a++) {
      const w = r * node.strategy[a * n + i];
      cell.freq[a] += w;
      totals[a] += w;
    }
  }
  for (const c of cells) if (c.freq) c.freq = c.reach > 0 ? c.freq.map((w) => w / c.reach) : null;
  return { cells, totals, reachTotal, n, A };
}

/** Quick links to the nodes people look at most. */
function landmarks(result: RiverResult): { label: string; index: number }[] {
  const out: { label: string; index: number }[] = [{ label: "OOP first to act", index: 0 }];
  const root = result.nodes[0];
  const check = root.actions.findIndex((a) => a.kind === "check");
  const ipAfterCheck = check >= 0 ? root.next[check] : -1;
  if (ipAfterCheck >= 0) {
    out.push({ label: "IP after a check", index: ipAfterCheck });
    const ip = result.nodes[ipAfterCheck];
    const bet = ip.actions.findIndex((a) => a.kind === "bet" || a.kind === "allin");
    if (bet >= 0 && ip.next[bet] >= 0) out.push({ label: `OOP facing IP's ${ip.actions[bet].label.toLowerCase()}`, index: ip.next[bet] });
  }
  const bet = root.actions.findIndex((a) => a.kind === "bet" || a.kind === "allin");
  if (bet >= 0 && root.next[bet] >= 0) out.push({ label: `IP facing OOP's ${root.actions[bet].label.toLowerCase()}`, index: root.next[bet] });
  return out;
}

/** Node selector, action summary, 13x13 strategy grid and per-combo breakdown of a solved river spot. */
export const RiverExplorer = memo(function RiverExplorer({ result }: { result: RiverResult }) {
  const [index, setIndex] = useState(0);
  const [cls, setCls] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const node = result.nodes[index];
  const colors = useMemo(() => actionColors(node), [node]);
  const s = useMemo(() => summarise(result, node), [result, node]);
  const marks = useMemo(() => landmarks(result), [result]);
  const combos = result.rangeCombos[node.player];

  const go = (i: number) => {
    setIndex(i);
    setCls(null);
  };

  const selected = cls !== null && s.cells[cls].combos.length > 0 ? cls : null;

  return (
    <div className="flex min-w-0 flex-col">
      <Line as="div" role="group" aria-label="Common nodes">
        <span className="flex flex-wrap gap-x-[2ch]">
          {marks.map((m) => (
            <button key={m.index} type="button" className="t" onClick={() => go(m.index)} aria-pressed={index === m.index}>
              {m.label}
            </button>
          ))}
        </span>
      </Line>
      <div className={FIELD_ROW}>
        <label htmlFor="river-node" className="uppercase">
          Node
        </label>
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-[2ch]">
          <select id="river-node" className={`${selectClass} min-w-0 flex-1 w-auto!`} value={index} onChange={(e) => go(Number(e.target.value))}>
            {result.nodes.map((nd, i) => (
              <option key={nd.id} value={i}>
                {i + 1}. {nodeTitle(nd)}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => go(node.parent)} disabled={node.parent < 0}>
            Up
          </Button>
        </span>
      </div>
      <Line />

      <Line as="p" className="uppercase">
        <span>
          <span className="inv">{PLAYER[node.player]} to act</span>
          {node.history.length > 0 && <span className="text-muted"> after {node.history.join(" · ")}</span>}
        </span>
      </Line>
      <Line as="p">
        <span className="text-muted">
          Pot {fmt(result.pot + node.committed[0] + node.committed[1], 2)} bb · OOP in for {fmt(node.committed[0], 2)}, IP in for {fmt(node.committed[1], 2)} this street ·{" "}
          {fmt(s.reachTotal, 1)} of {s.n} {PLAYER[node.player]} combos reach this node
        </span>
      </Line>

      <Scroll>
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr className="text-left text-muted uppercase">
              <th scope="col" className="l table-cell! pr-[2ch]">
                Action
              </th>
              <th scope="col" className="pr-[2ch] text-right">
                Frequency
              </th>
              <th scope="col" className="pr-[2ch] text-right">
                Combos
              </th>
              <th scope="col" className="text-right">
                <span className="sr-only">Go to node</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {node.actions.map((a, k) => (
              <tr key={k} className="align-baseline">
                <td className="l table-cell! pr-[2ch] whitespace-nowrap uppercase">
                  <span className="inline-flex items-center gap-[1ch]">
                    <Swatch bg={colors[k]} />
                    {actionLabel(node, k, result.pot)}
                  </span>
                </td>
                <td className="pr-[2ch] text-right">{s.reachTotal > 0 ? pct(s.totals[k] / s.reachTotal, 1) : "—"}</td>
                <td className="pr-[2ch] text-right">{fmt(s.totals[k], 1)}</td>
                <td className="text-right whitespace-nowrap">
                  {node.next[k] >= 0 ? (
                    <button
                      type="button"
                      className="t"
                      onClick={() => go(node.next[k])}
                      aria-label={`${PLAYER[result.nodes[node.next[k]].player]} responds to ${a.label}`}
                    >
                      <span className="max-[679px]:hidden">{PLAYER[result.nodes[node.next[k]].player]} responds </span>→
                    </button>
                  ) : (
                    <span className="text-muted uppercase">{a.kind === "fold" ? "ends" : "showdown"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
      {s.reachTotal > 0 && (
        <div className="my-[0.5em] flex h-[8px] w-full overflow-hidden border border-ink" aria-hidden>
          {node.actions.map((_, k) => (
            <div key={k} style={{ width: `${(100 * s.totals[k]) / s.reachTotal}%`, background: colors[k] }} />
          ))}
        </div>
      )}
      <Line />

      <StrategyGrid cells={s.cells} colors={colors} actions={node.actions.map((_, k) => actionLabel(node, k, result.pot))} selected={selected} onSelect={setCls} player={PLAYER[node.player]} />
      <Line />
      {selected === null ? (
        <Line as="p">
          <span className="max-w-[72ch] text-muted">
            Select a hand class in the grid to see each of its combos. A cell&apos;s coloured height is the share of the class&apos;s live combos that reach this node; its colours split
            that share by action.
          </span>
        </Line>
      ) : (
        <ComboTable result={result} node={node} rows={s.cells[selected].combos} colors={colors} caption={`${NAMES[selected]}: ${s.cells[selected].combos.length} live combos`} />
      )}
      <Line />

      <details className="group" onToggle={(e) => setShowAll(e.currentTarget.open)}>
        <summary className="l cursor-pointer select-none uppercase">
          <span>
            <span aria-hidden className="group-open:hidden">
              [+]{" "}
            </span>
            <span aria-hidden className="hidden group-open:inline">
              [−]{" "}
            </span>
            Every {PLAYER[node.player]} combo at this node, strongest first ({combos.length})
          </span>
        </summary>
        {/* Rendered only while open: with wide ranges this is a thousand-row table. */}
        {showAll && <ComboTable result={result} node={node} rows={Array.from(combos.keys()).sort((a, b) => combos[b].value - combos[a].value || a - b)} colors={colors} />}
      </details>
    </div>
  );
});

function ComboTable({ result, node, rows, colors, caption }: { result: RiverResult; node: RiverNodeView; rows: number[]; colors: string[]; caption?: string }) {
  const combos = result.rangeCombos[node.player];
  const n = combos.length;
  return (
    <>
      {caption && (
        <Line as="p">
          <span className="inv normal-case">{caption}</span>
        </Line>
      )}
      <Scroll>
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr className="text-left text-muted uppercase">
              <th scope="col" className="l table-cell! pr-[2ch]">
                Combo
              </th>
              <th scope="col" className="pr-[2ch]">
                Hand
              </th>
              <th scope="col" className="pr-[2ch] text-right" title="Probability that this combo's own earlier actions lead here">
                Reach
              </th>
              {node.actions.map((a, k) => (
                <th key={k} scope="col" className="pr-[2ch] text-right whitespace-nowrap last:pr-0">
                  <span className="inline-flex items-center gap-[1ch]">
                    <Swatch bg={colors[k]} />
                    {a.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i} className={`align-baseline ${node.reach[i] < 1e-6 ? "text-muted" : ""}`}>
                <td className="l table-cell! pr-[2ch] normal-case">{combos[i].label}</td>
                <td className="pr-[2ch] whitespace-nowrap uppercase">{combos[i].category}</td>
                <td className="pr-[2ch] text-right">{pct(node.reach[i], 1)}</td>
                {node.actions.map((_, k) => (
                  <td key={k} className="pr-[2ch] text-right last:pr-0">
                    {pct(node.strategy[k * n + i], 1)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </>
  );
}

/** 13x13 grid: each class's live combos, coloured by action, filled to the share that reaches the node. */
function StrategyGrid({
  cells,
  colors,
  actions,
  selected,
  onSelect,
  player,
}: {
  cells: ClassCell[];
  colors: string[];
  actions: string[];
  selected: number | null;
  onSelect: (i: number) => void;
  player: string;
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 13, ArrowUp: -13, Home: -(focusIndex % 13), End: 12 - (focusIndex % 13) }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const next = focusIndex + d;
    if (next < 0 || next > 168 || (Math.abs(d) === 1 && Math.floor(next / 13) !== Math.floor(focusIndex / 13))) return;
    setFocusIndex(next);
    gridRef.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus();
  };

  return (
    <div className="flex min-w-0 flex-col">
      <Line className="uppercase">
        <span>{player} strategy by hand class</span>
      </Line>
      <div
        ref={gridRef}
        role="grid"
        aria-label={`${player} strategy per hand class`}
        onKeyDown={move}
        className="grid aspect-square w-full max-w-[26rem] grid-cols-13 gap-px border border-faint bg-faint"
      >
        {NAMES.map((name, i) => {
          const c = cells[i];
          const live = c.combos.length > 0;
          const share = live ? c.reach / c.combos.length : 0;
          const filled = Boolean(c.freq && share > 0);
          const desc = !live
            ? "not in range"
            : c.freq && share > 0
              ? `${pct(share, 0)} of ${c.combos.length} combos reach; ` + c.freq.map((f, k) => `${actions[k]} ${pct(f, 0)}`).join(", ")
              : `${c.combos.length} combos, none reach this node`;
          return (
            <div
              key={name}
              role="gridcell"
              data-i={i}
              tabIndex={i === focusIndex ? 0 : -1}
              aria-label={`${name}: ${desc}`}
              aria-selected={selected === i}
              title={`${name}: ${desc}`}
              onClick={() => live && onSelect(i)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && live) {
                  e.preventDefault();
                  onSelect(i);
                }
              }}
              onFocus={() => setFocusIndex(i)}
              className={`relative flex items-center justify-center bg-paper text-[clamp(7px,2.1vw,11px)] leading-none tracking-tighter focus-visible:z-10 ${
                live ? "cursor-pointer" : ""
              } ${!live ? "text-faint" : "text-ink"} ${selected === i ? "z-10 outline-2 -outline-offset-2 outline-ink" : ""}`}
            >
              {filled && (
                <span aria-hidden className="absolute inset-x-0 bottom-0 flex" style={{ height: `${(100 * share).toFixed(1)}%` }}>
                  {c.freq!.map((f, k) => (
                    <span key={k} className="h-full" style={{ width: `${(100 * f).toFixed(2)}%`, background: colors[k] }} />
                  ))}
                </span>
              )}
              <span className={`relative ${filled && share > 0.4 ? "bg-paper px-px" : ""}`}>{name}</span>
            </div>
          );
        })}
      </div>
      <Line className="legend uppercase">
        <ul className="flex flex-wrap gap-x-[2ch]">
          {legendGroups(colors, actions).map((g) => (
            <li key={g.bg} className="inline-flex items-center gap-[1ch]">
              <Swatch bg={g.bg} />
              {g.labels.join(" / ")}
            </li>
          ))}
        </ul>
      </Line>
    </div>
  );
}
