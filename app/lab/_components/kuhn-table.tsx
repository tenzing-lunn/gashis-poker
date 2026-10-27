"use client";

import { memo, useMemo } from "react";
import { profileFromMap } from "@/lib/gto/game";
import { createKuhnGame, kuhnAlpha, kuhnEquilibriumBetProbs } from "@/lib/gto/kuhn";
import type { KuhnBetProbs } from "@/lib/gto/worker-protocol";
import { fmt } from "./format";
import { MathTable } from "./ui";

const ROWS: { key: string; player: "P0" | "P1"; situation: string; action: string }[] = [
  { key: "J", player: "P0", situation: "Holds J, first to act", action: "bet (bluff)" },
  { key: "Q", player: "P0", situation: "Holds Q, first to act", action: "bet" },
  { key: "K", player: "P0", situation: "Holds K, first to act", action: "bet" },
  { key: "Jpb", player: "P0", situation: "Holds J, checked, faces a bet", action: "call" },
  { key: "Qpb", player: "P0", situation: "Holds Q, checked, faces a bet", action: "call" },
  { key: "Kpb", player: "P0", situation: "Holds K, checked, faces a bet", action: "call" },
  { key: "Jb", player: "P1", situation: "Holds J, faces a bet", action: "call" },
  { key: "Qb", player: "P1", situation: "Holds Q, faces a bet", action: "call" },
  { key: "Kb", player: "P1", situation: "Holds K, faces a bet", action: "call" },
  { key: "Jp", player: "P1", situation: "Holds J, P0 checked", action: "bet (bluff)" },
  { key: "Qp", player: "P1", situation: "Holds Q, P0 checked", action: "bet" },
  { key: "Kp", player: "P1", situation: "Holds K, P0 checked", action: "bet" },
];

/** α of Kuhn's family closest to a strategy given as P(bet/call) per info set. */
export function alphaOf(strategy: KuhnBetProbs): number {
  const game = createKuhnGame();
  return kuhnAlpha(game, profileFromMap(game, Object.fromEntries(Object.entries(strategy).map(([k, p]) => [k, [1 - p, p]]))));
}

/** CFR's average strategy at all 12 info sets beside Kuhn's analytic equilibrium at the solved α. */
export const KuhnStrategyTable = memo(function KuhnStrategyTable({ strategy }: { strategy: KuhnBetProbs | null }) {
  const alpha = useMemo(() => (strategy ? alphaOf(strategy) : null), [strategy]);
  const eq = alpha === null ? null : kuhnEquilibriumBetProbs(alpha);
  const rows = ROWS.map((r) => {
    const cfr = strategy?.[r.key];
    const ref = eq?.[r.key];
    const diff = cfr !== undefined && ref !== undefined ? Math.abs(cfr - ref) : undefined;
    return {
      key: r.key,
      cells: [
        <span key="k" className="flex items-baseline gap-2">
          <span className="w-9 font-mono font-semibold">{r.key}</span>
          <span className="w-6 text-[11px] text-zinc-500 dark:text-zinc-400">{r.player}</span>
          <span className="text-zinc-600 dark:text-zinc-300">
            {r.situation} → <em className="not-italic text-foreground">{r.action}</em>
          </span>
        </span>,
        cfr === undefined ? "—" : fmt(cfr, 4),
        ref === undefined ? "—" : fmt(ref, 4),
        diff === undefined ? "—" : <span className={diff < 1e-3 ? "text-emerald-600 dark:text-emerald-400" : diff < 1e-2 ? "" : "text-amber-600 dark:text-amber-400"}>{diff < 5e-5 ? "<0.0001" : fmt(diff, 4)}</span>,
      ],
    };
  });
  return (
    <MathTable
      caption={
        <>
          P(bet or call) at each information set. Equilibrium family: P0 bets J with α, K with 3α, calls Q after check-bet with α + ⅓; P1 is unique.
          {alpha !== null && (
            <>
              {" "}
              Solved <span className="font-mono text-foreground">α = {fmt(alpha, 4)}</span> (any α ∈ [0, ⅓] is an equilibrium).
            </>
          )}
        </>
      }
      head={["Info set", "CFR average", <>Equilibrium at <span className="normal-case">α</span></>, "|Δ|"]}
      rows={rows}
    />
  );
});
