import type { ReactNode } from "react";
import { Line } from "@/components/doc";
import { padHand, streetText, type TableModel } from "./model";

type TableHeaderProps = {
  model: TableModel;
  /** Centered title line, e.g. `PRACTICE TABLE`. */
  title: ReactNode;
  /** Left of the mode line: `LIVE  6/6 SEATED`, `AUTO`. */
  mode: ReactNode;
  /** Right of the mode line: time bank, transport, connection state. */
  right?: ReactNode;
};

/** The three header lines above a table (DESIGN.md §4.5). */
export function TableHeader({ model, title, mode, right }: TableHeaderProps) {
  return (
    <>
      <Line center gap>
        <span>{title}</span>
      </Line>
      <Line className="table-head">
        <span className="pre">{mode}</span>
        {right ? <span>{right}</span> : null}
      </Line>
      <Line className="hand-line">
        <span>
          HAND {padHand(model.handNo)}
          <span className="full">
            , BLINDS {model.smallBlind}/{model.bigBlind}
          </span>
        </span>
        <span>{model.handNo === 0 ? "WAITING" : streetText(model.street)}</span>
      </Line>
    </>
  );
}
