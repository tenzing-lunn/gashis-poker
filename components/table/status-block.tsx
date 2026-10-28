import type { ReactNode } from "react";
import { Line } from "@/components/doc";
import { fmt, type TableModel } from "./model";

export type StatusBlockProps = {
  model: TableModel;
  /** The viewer's decision is up. Default: the model's seat to act is its hero seat. */
  heroTurn?: boolean;
  /** Chips the hero pays to call; `YOUR TURN (CO) · TO CALL 300` when above 0. */
  toCall?: number;
  /** Seconds left for the seat to act (`14 S`, amber at 5 or less); omit or null for no clock. */
  seconds?: number | null;
  /** Shown while no hand is running and none has finished: `PRESS DEAL TO START`. */
  idle?: ReactNode;
  /** Right side: `[NEXT HAND →]` (solo), `[STAND]` (multiplayer). */
  action?: ReactNode;
};

/**
 * What the status line says: the result, whose turn it is, or `idle`. The hero's position goes with
 * `YOUR TURN (CO)`, since the seat's `YOUR TURN` tag has no room for it.
 */
export function statusText(model: TableModel, heroTurn: boolean, toCall = 0): string | null {
  if (model.complete && model.result) return model.result.text;
  if (heroTurn) {
    const pos = model.heroSeat === null ? null : model.seats[model.heroSeat]?.position;
    const turn = pos ? `YOUR TURN (${pos})` : "YOUR TURN";
    return toCall > 0 ? `${turn} · TO CALL ${fmt(toCall)}` : turn;
  }
  if (model.toAct !== null && !model.complete) {
    const s = model.seats[model.toAct];
    return `${s.label} ${s.name} ${s.kind === "bot" ? "THINKING…" : "TO ACT"}`;
  }
  return null;
}

/**
 * The one status line directly above the play controls (DESIGN.md §5): status words, the clock, an action
 * slot at the right. Solo and multiplayer mount the same line, so it is always in the same place. On mobile
 * the result takes its narrow form (`YOU WIN 3,516 · TWO PAIR`), which wraps to a second line rather than
 * being cut, and the action sits at the right of the last line.
 */
export function StatusBlock({ model, heroTurn, toCall, seconds, idle, action }: StatusBlockProps) {
  const mine = heroTurn ?? (model.heroSeat !== null && model.toAct === model.heroSeat && !model.complete);
  const text = statusText(model, mine, toCall);
  const short = model.complete && model.result && model.result.short !== text ? model.result.short : null;
  const clock = seconds === undefined || seconds === null ? null : Math.max(0, Math.ceil(seconds));
  return (
    <Line className="status">
      <span className="cols">
        {short ? (
          <span className="words">
            <span className="full">{text}</span>
            <span className="short" title={text ?? undefined}>
              {short}
            </span>
          </span>
        ) : (
          <span className="words">{text ?? idle}</span>
        )}
        {clock !== null ? <span className={clock <= 5 ? "text-amber" : undefined}>{clock} S</span> : null}
      </span>
      {action ? <span className="side">{action}</span> : null}
    </Line>
  );
}
