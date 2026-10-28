import type { ReactNode } from "react";
import { Line } from "@/components/doc";
import { fmt, type TableModel } from "./model";

export type StatusBlockProps = {
  model: TableModel;
  /** The viewer's decision is up. Default: the model's seat to act is its hero seat. */
  heroTurn?: boolean;
  /** Chips the hero pays to call; `YOUR TURN · TO CALL 300` when above 0. */
  toCall?: number;
  /** Seconds left for the seat to act (`14 S`, amber at 5 or less); omit or null for no clock. */
  seconds?: number | null;
  /** Shown while no hand is running and none has finished: `PRESS DEAL TO START`. */
  idle?: ReactNode;
  /** Right side: `[NEXT HAND →]` (solo), `[STAND]` (multiplayer). */
  action?: ReactNode;
};

/** What the status line says: the result, whose turn it is, or `idle`. */
export function statusText(model: TableModel, heroTurn: boolean, toCall = 0): string | null {
  if (model.complete && model.result) return model.result.text;
  if (heroTurn) return toCall > 0 ? `YOUR TURN · TO CALL ${fmt(toCall)}` : "YOUR TURN";
  if (model.toAct !== null && !model.complete) {
    const s = model.seats[model.toAct];
    return `${s.label} ${s.name} ${s.kind === "bot" ? "THINKING…" : "TO ACT"}`;
  }
  return null;
}

/**
 * The one status line directly above the play controls (DESIGN.md §5): status words, the clock, an action
 * slot at the right. Solo and multiplayer mount the same line, so it is always in the same place.
 */
export function StatusBlock({ model, heroTurn, toCall, seconds, idle, action }: StatusBlockProps) {
  const mine = heroTurn ?? (model.heroSeat !== null && model.toAct === model.heroSeat && !model.complete);
  const text = statusText(model, mine, toCall);
  const clock = seconds === undefined || seconds === null ? null : Math.max(0, Math.ceil(seconds));
  return (
    <Line className="status">
      <span className="cols">
        <span>{text ?? idle}</span>
        {clock !== null ? <span className={clock <= 5 ? "text-amber" : undefined}>{clock} S</span> : null}
      </span>
      {action ? <span>{action}</span> : null}
    </Line>
  );
}
