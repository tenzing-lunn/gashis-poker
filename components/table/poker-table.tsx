"use client";

import { useState, type CSSProperties } from "react";
import { cx } from "@/components/doc/cx";
import { TextButton } from "@/components/doc";
import { Card } from "./card";
import { cardWords, fmt, seatPoints, type SeatModel, type TableModel } from "./model";

type PokerTableProps = {
  model: TableModel;
  /** Accessible name of the figure. */
  label?: string;
  /** Shown as `[SIT]` on empty seats when given (multiplayer). */
  onSit?: (seat: number) => void;
  /** Announce each event in a polite live region (off for the home attract table). */
  announce?: boolean;
};

/** The table figure (DESIGN.md §4.1–4.4, §4.7): felt, board and pot, seats around the ellipse. */
export function PokerTable({ model, label, onSit, announce = true }: PokerTableProps) {
  const [open, setOpen] = useState<number | null>(null);
  const n = model.seats.length;
  const wide = seatPoints(n, "wide");
  const tall = seatPoints(n, "tall");
  const boardText = model.board.length ? model.board.map(cardWords).join(", ") : "no cards yet";

  return (
    <figure className="table-fig" aria-label={label ?? `Poker table, ${model.seated} of ${n} seats taken`}>
      <div className="felt" aria-hidden="true" />
      <div className="center">
        <div className="board" role="group" aria-label={`Board: ${boardText}`}>
          {Array.from({ length: 5 }, (_, i) =>
            i < model.board.length ? (
              <Card key={`${model.handNo}-${model.board[i]}`} card={model.board[i]} anim="deal" />
            ) : (
              <Card key={`slot-${i}`} card="slot" />
            ),
          )}
        </div>
        <div className="pot">POT {fmt(model.pot)}</div>
      </div>
      {model.seats.map((s) => {
        const rel = (s.seat - model.anchorSeat + n) % n;
        const style = {
          "--x": `${wide[rel].left}%`,
          "--y": `${wide[rel].top}%`,
          "--tx": `${tall[rel].left}%`,
          "--ty": `${tall[rel].top}%`,
        } as CSSProperties;
        return (
          <Seat
            key={s.seat}
            seat={s}
            handNo={model.handNo}
            style={style}
            open={open === s.seat}
            onToggle={() => setOpen((o) => (o === s.seat ? null : s.seat))}
            onSit={onSit}
          />
        );
      })}
      {announce ? (
        <p className="sr-only" aria-live="polite">
          {model.lastEvent}
        </p>
      ) : null}
    </figure>
  );
}

type SeatProps = {
  seat: SeatModel;
  handNo: number;
  style: CSSProperties;
  open: boolean;
  onToggle: () => void;
  onSit?: (seat: number) => void;
};

function Seat({ seat: s, handNo, style, open, onToggle, onSit }: SeatProps) {
  const empty = s.kind === "empty";
  const yourTurn = s.isHero && s.turn;
  return (
    <div
      className={cx("seat", s.turn && "turn", s.win && "win", s.out && "out", empty && "empty", open && "open")}
      style={style}
      aria-current={s.turn ? "true" : undefined}
      onClick={onToggle}
    >
      <span className="sr-only">{seatSentence(s)}</span>
      <div className="hole" aria-hidden="true">
        {empty ? (
          <>
            <Card card="slot" />
            <Card card="slot" />
          </>
        ) : s.holeCards === "hidden" ? (
          <>
            <Card key={`${handNo}-0-b`} card="back" anim="deal" />
            <Card key={`${handNo}-1-b`} card="back" anim="deal" />
          </>
        ) : s.holeCards ? (
          s.holeCards.map((c, k) => <Card key={`${handNo}-${k}-${c}`} card={c} anim={s.revealed ? "flip" : "deal"} />)
        ) : null}
      </div>
      <div className="who" aria-hidden="true">
        <span className="full">
          {s.label} {s.name}
        </span>
        <span className="short">{s.label}</span>
        {s.isButton ? " (D)" : null}
      </div>
      <div className="meta" aria-hidden="true">
        {empty ? "--" : `${fmt(s.stack)}  ${s.metaPct === null ? "--" : `${s.metaPct}%`}`}
      </div>
      <div className="bar" aria-hidden="true">
        <i style={{ width: `${Math.round(s.barFraction * 100)}%` }} />
      </div>
      <div className="act">
        {yourTurn ? (
          <span className="tag" aria-hidden="true">
            YOUR TURN
          </span>
        ) : empty && onSit ? (
          <TextButton
            onClick={(e) => {
              e.stopPropagation();
              onSit(s.seat);
            }}
            aria-label={`Sit in seat ${s.seat + 1}`}
          >
            [SIT]
          </TextButton>
        ) : (
          <span aria-hidden="true" className={s.net === null ? undefined : s.net < 0 ? "text-red" : "text-green"}>
            {s.lastAction || " "}
          </span>
        )}
      </div>
    </div>
  );
}

/** `Seat 3, Monte, dealer, 9,200 chips, call 100` (DESIGN.md §9). */
export function seatSentence(s: SeatModel): string {
  if (s.kind === "empty") return `Seat ${s.seat + 1}, empty`;
  const parts = [`Seat ${s.seat + 1}`, s.isHero ? `${s.name} (you)` : s.name];
  if (s.isButton) parts.push("dealer");
  parts.push(`${fmt(s.stack)} chips`);
  if (Array.isArray(s.holeCards)) parts.push(`holding ${s.holeCards.map(cardWords).join(" and ")}`);
  if (s.net !== null) parts.push(`net ${s.lastAction}`);
  else if (s.lastAction) parts.push(s.lastAction.toLowerCase());
  if (s.turn) parts.push(s.isHero ? "your turn" : "to act");
  if (s.win) parts.push("winner");
  return parts.join(", ");
}
