"use client";

import { useState, type CSSProperties } from "react";
import { cx } from "@/components/doc/cx";
import { TextButton } from "@/components/doc";
import { Card } from "./card";
import { SEAT_CHARS, bbText, cardWords, fmt, seatMeta, seatPoints, type SeatModel, type TableModel } from "./model";

type PokerTableProps = {
  model: TableModel;
  /** Accessible name of the figure. */
  label?: string;
  /** Shown as `[SIT]` on empty seats when given (multiplayer). */
  onSit?: (seat: number) => void;
  /** Announce each event in a polite live region (off for the home attract table). */
  announce?: boolean;
  /**
   * Given: every bot seat's `S3 MICRO` becomes a text button (`About S3 MICRO`) that calls this with the seat,
   * e.g. to open its bot sheet (`BotSheetDialog`).
   */
  onSeatInfo?: (seat: number) => void;
};

/** The table figure (DESIGN.md §4.1–4.4, §4.7): felt, board and pot, seats around the ellipse. */
export function PokerTable({ model, label, onSit, announce = true, onSeatInfo }: PokerTableProps) {
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
            onInfo={onSeatInfo && s.kind === "bot" ? () => onSeatInfo(s.seat) : undefined}
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
  onInfo?: () => void;
};

function Seat({ seat: s, handNo, style, open, onToggle, onSit, onInfo }: SeatProps) {
  const empty = s.kind === "empty";
  const yourTurn = s.isHero && s.turn;
  const position = s.position ?? (s.isButton ? "BTN" : null);
  // `S3 MICRO-2`: the name shrinks to an ellipsis so `S8 ` + name + ` BTN` stays inside the seat.
  const id = (
    <>
      <span>{s.label}</span>
      <span className="name full" title={s.name}>
        {s.name}
      </span>
    </>
  );
  return (
    <div
      className={cx("seat", s.turn && "turn", yourTurn && "you", s.win && "win", s.out && "out", empty && "empty", open && "open")}
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
      <div className="who">
        {yourTurn ? (
          // The warn highlight takes the name's place, so the seat keeps its height and `.act` keeps the bet.
          // The position would not fit next to it: the status line says `YOUR TURN (CO)`.
          <span aria-hidden="true">YOUR TURN</span>
        ) : (
          <>
            {onInfo ? (
              <button
                type="button"
                className="t id"
                aria-label={`About ${s.label} ${s.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onInfo();
                }}
              >
                {id}
              </button>
            ) : (
              <span className="id" aria-hidden="true">
                {id}
              </span>
            )}
            {position ? (
              <span className="pos" aria-hidden="true">
                {position}
              </span>
            ) : null}
          </>
        )}
      </div>
      <div className="meta" aria-hidden="true">
        <MetaText seat={s} width={SEAT_CHARS.wide} className="wide" />
        <MetaText seat={s} width={SEAT_CHARS.tall} className="tall" />
      </div>
      <div className="bar" aria-hidden="true">
        <i style={{ width: `${Math.round(s.barFraction * 100)}%` }} />
      </div>
      <div className="act">
        {empty && onSit ? (
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
          <span aria-hidden="true">{s.lastAction || " "}</span>
        )}
      </div>
    </div>
  );
}

/** The meta line at one seat width; a net result is green/red. */
function MetaText({ seat, width, className }: { seat: SeatModel; width: number; className: string }) {
  const { head, tail } = seatMeta(seat, width);
  return (
    <span className={className}>
      {head}
      {tail ? <span className={seat.net === null ? undefined : seat.net < 0 ? "text-red" : "text-green"}>{tail}</span> : null}
    </span>
  );
}

const POSITION_WORDS: Record<string, string> = {
  BTN: "on the button (dealer)",
  SB: "small blind",
  BB: "big blind",
  UTG: "under the gun",
  MP: "middle position",
  LJ: "lojack",
  HJ: "hijack",
  CO: "cutoff",
};

/** `Seat 3, Monte, cutoff, 9,200 chips, 92 big blinds, call 100` (DESIGN.md §9). */
export function seatSentence(s: SeatModel): string {
  if (s.kind === "empty") return `Seat ${s.seat + 1}, empty`;
  const parts = [`Seat ${s.seat + 1}`, s.isHero ? `${s.name} (you)` : s.name];
  if (s.position) parts.push(POSITION_WORDS[s.position] ?? s.position);
  else if (s.isButton) parts.push("dealer");
  parts.push(`${fmt(s.stack)} chips`);
  if (s.bbDepth !== null && s.net === null) parts.push(bbText(s.bbDepth).replace("BB", "big blinds"));
  if (Array.isArray(s.holeCards)) parts.push(`holding ${s.holeCards.map(cardWords).join(" and ")}`);
  if (s.category) parts.push(s.category.toLowerCase());
  else if (s.lastAction) parts.push(s.lastAction.toLowerCase());
  if (s.net !== null) parts.push(`net ${s.net < 0 ? "-" : "+"}${fmt(Math.abs(s.net))}`);
  if (s.turn) parts.push(s.isHero ? "your turn" : "to act");
  if (s.win) parts.push("winner");
  return parts.join(", ");
}
