"use client";

import { memo, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { HAND_CLASSES } from "@/lib/poker/combinatorics";
import type { RiverNodeView, RiverResult } from "@/lib/gto/worker-protocol";
import { fmt, pct } from "./format";
import { Button, selectClass } from "./ui";

const NAMES = HAND_CLASSES.map((h) => h.name);
const PLAYER = ["OOP", "IP"] as const;

// Check / call green, fold blue, bets and raises from amber to deep red by size, all-in violet.
const PASSIVE = "16 185 129";
const FOLD = "14 165 233";
const AGGRESSIVE = ["245 158 11", "234 88 12", "220 38 38", "159 18 57", "112 26 117"];
const ALL_IN = "124 58 237";

function actionColors(node: RiverNodeView): string[] {
  let k = 0;
  return node.actions.map((a) => {
    if (a.kind === "check" || a.kind === "call") return PASSIVE;
    if (a.kind === "fold") return FOLD;
    if (a.kind === "allin") return ALL_IN;
    return AGGRESSIVE[Math.min(k++, AGGRESSIVE.length - 1)];
  });
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
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {marks.map((m) => (
            <button
              key={m.index}
              type="button"
              onClick={() => go(m.index)}
              aria-pressed={index === m.index}
              className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 ${
                index === m.index ? "border-foreground bg-foreground text-background" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="river-node" className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Node
          </label>
          <select id="river-node" className={`${selectClass} sm:flex-1`} value={index} onChange={(e) => go(Number(e.target.value))}>
            {result.nodes.map((nd, i) => (
              <option key={nd.id} value={i}>
                {i + 1}. {nodeTitle(nd)}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => go(node.parent)} disabled={node.parent < 0}>
            Up
          </Button>
        </div>
      </div>

      <div className="rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900/60">
        <p className="font-medium">
          {PLAYER[node.player]} to act{node.history.length > 0 && <span className="font-normal text-zinc-600 dark:text-zinc-400"> after {node.history.join(" · ")}</span>}
        </p>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Pot {fmt(result.pot + node.committed[0] + node.committed[1], 2)} bb · OOP in for {fmt(node.committed[0], 2)}, IP in for {fmt(node.committed[1], 2)} this street ·{" "}
          {fmt(s.reachTotal, 1)} of {s.n} {PLAYER[node.player]} combos reach this node
        </p>
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-max border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th scope="col" className="py-2 pr-4 font-medium">
                Action
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Frequency
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Combos
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                <span className="sr-only">Go to node</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {node.actions.map((a, k) => (
              <tr key={k} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                <td className="py-1.5 pr-4">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ background: `rgb(${colors[k]})` }} />
                    {actionLabel(node, k, result.pot)}
                  </span>
                </td>
                <td className="py-1.5 pr-4 text-right font-mono">{s.reachTotal > 0 ? pct(s.totals[k] / s.reachTotal, 1) : "—"}</td>
                <td className="py-1.5 pr-4 text-right font-mono">{fmt(s.totals[k], 1)}</td>
                <td className="py-1.5 text-right">
                  {node.next[k] >= 0 ? (
                    <button
                      type="button"
                      onClick={() => go(node.next[k])}
                      aria-label={`${PLAYER[result.nodes[node.next[k]].player]} responds to ${a.label}`}
                      className="text-xs text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
                    >
                      <span className="hidden sm:inline">{PLAYER[result.nodes[node.next[k]].player]} responds </span>→
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{a.kind === "fold" ? "ends" : "showdown"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.reachTotal > 0 && (
        <div className="flex h-3 w-full overflow-hidden rounded-sm" aria-hidden>
          {node.actions.map((_, k) => (
            <div key={k} style={{ width: `${(100 * s.totals[k]) / s.reachTotal}%`, background: `rgb(${colors[k]})` }} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <StrategyGrid cells={s.cells} colors={colors} actions={node.actions.map((_, k) => actionLabel(node, k, result.pot))} selected={selected} onSelect={setCls} player={PLAYER[node.player]} />
        <div className="min-w-0">
          {selected === null ? (
            <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
              Select a hand class in the grid to see each of its combos. A cell&apos;s coloured height is the share of the class&apos;s live combos that reach this node; its colours split
              that share by action.
            </p>
          ) : (
            <ComboTable result={result} node={node} rows={s.cells[selected].combos} colors={colors} caption={`${NAMES[selected]}: ${s.cells[selected].combos.length} live combos`} />
          )}
        </div>
      </div>

      <details className="group" onToggle={(e) => setShowAll(e.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-medium text-zinc-600 select-none hover:text-foreground dark:text-zinc-400">
          Every {PLAYER[node.player]} combo at this node, strongest first ({combos.length})
        </summary>
        {/* Rendered only while open: with wide ranges this is a thousand-row table. */}
        {showAll && (
          <div className="mt-3">
            <ComboTable result={result} node={node} rows={Array.from(combos.keys()).sort((a, b) => combos[b].value - combos[a].value || a - b)} colors={colors} />
          </div>
        )}
      </details>
    </div>
  );
});

function ComboTable({ result, node, rows, colors, caption }: { result: RiverResult; node: RiverNodeView; rows: number[]; colors: string[]; caption?: string }) {
  const combos = result.rangeCombos[node.player];
  const n = combos.length;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-max border-collapse text-xs tabular-nums">
        {caption && <caption className="mb-2 text-left text-xs font-semibold text-foreground">{caption}</caption>}
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Combo
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Hand
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium" title="Probability that this combo's own earlier actions lead here">
              Reach
            </th>
            {node.actions.map((a, k) => (
              <th key={k} scope="col" className="py-1.5 pr-3 text-right font-medium last:pr-0">
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden className="size-2 rounded-sm" style={{ background: `rgb(${colors[k]})` }} />
                  {a.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i} className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${node.reach[i] < 1e-6 ? "text-zinc-400 dark:text-zinc-600" : ""}`}>
              <td className="py-1 pr-3 font-mono">{combos[i].label}</td>
              <td className="py-1 pr-3">{combos[i].category}</td>
              <td className="py-1 pr-3 text-right font-mono">{pct(node.reach[i], 1)}</td>
              {node.actions.map((_, k) => (
                <td key={k} className="py-1 pr-3 text-right font-mono last:pr-0">
                  {pct(node.strategy[k * n + i], 1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{player} strategy by hand class</figcaption>
      <div
        ref={gridRef}
        role="grid"
        aria-label={`${player} strategy per hand class`}
        onKeyDown={move}
        className="grid aspect-square w-full max-w-[26rem] grid-cols-13 gap-px rounded-md border border-zinc-200 bg-zinc-200 p-px dark:border-zinc-800 dark:bg-zinc-800"
      >
        {NAMES.map((name, i) => {
          const c = cells[i];
          const live = c.combos.length > 0;
          const share = live ? c.reach / c.combos.length : 0;
          let background: string | undefined;
          if (c.freq && share > 0) {
            let at = 0;
            const stops = c.freq.map((f, k) => {
              const from = at;
              at += 100 * f;
              return `rgb(${colors[k]}) ${from.toFixed(2)}% ${at.toFixed(2)}%`;
            });
            background = `linear-gradient(to right, ${stops.join(", ")})`;
          }
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
              style={background ? { backgroundImage: background, backgroundSize: `100% ${(100 * share).toFixed(1)}%`, backgroundPosition: "bottom", backgroundRepeat: "no-repeat" } : undefined}
              className={`flex items-center justify-center bg-zinc-50 font-mono text-[clamp(7px,2.1vw,11px)] leading-none tracking-tighter outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-foreground dark:bg-zinc-950 ${
                live ? "cursor-pointer" : ""
              } ${!live ? "text-zinc-300 dark:text-zinc-700" : share > 0.5 ? "text-white [text-shadow:0_0_2px_rgb(0_0_0/0.6)]" : "text-zinc-600 dark:text-zinc-300"} ${
                selected === i ? "ring-2 ring-foreground ring-inset" : ""
              }`}
            >
              {name}
            </div>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {actions.map((label, k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: `rgb(${colors[k]})` }} />
            {label}
          </li>
        ))}
      </ul>
    </figure>
  );
}
