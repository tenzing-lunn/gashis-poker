"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Legend, Line, TextButton, Tx } from "@/components/doc";
import { PERSONA_IDS, PERSONAS, type PersonaId } from "@/lib/bots/personas";
import { topRange } from "@/lib/bots/preflop";
import { BOT_COPY, BOT_STATS, BOT_STATS_SAMPLE, MIXED_COPY, OPEN_POSITIONS, shortRange } from "./bot-profiles";
import { fmt } from "./model";

/** A persona, or the MIXED setup option (a random style per bot). */
export type BotSheetPersona = PersonaId | "mixed";

export type BotSheetProps = {
  persona: BotSheetPersona;
  /** Seat display name, e.g. `TAG-2`. Defaults to the persona's short name. */
  name?: string;
  /** id for the title, so a dialog or region can point `aria-labelledby` at it. */
  titleId?: string;
  /** Shown at the right of the title line, e.g. a `[CLOSE]` button. */
  action?: ReactNode;
};

const caps = (s: string) => s.toUpperCase();
const pct = (x: number) => `${Math.round(x)}%`;
const RANGE_CHARS = 56;
const OPEN_LABEL_CHARS = 8; // `UTG  11%`

/**
 * Everything the table knows about one bot style, as numbered lines (DESIGN.md §3): the style in one
 * sentence, how to beat it, how wide it opens from each position and six measured stats in plain words.
 * Renders only `.l` lines, so it continues the numbering of whatever document it sits in, on paper or in a
 * `.screen` band.
 */
export function BotSheet({ persona, name, titleId, action }: BotSheetProps) {
  const copy = persona === "mixed" ? MIXED_COPY : BOT_COPY[persona];
  const heading = name ?? copy.short;
  const subtitle = caps(copy.title) === heading ? null : caps(copy.title);

  return (
    <div className="bot-sheet">
      <Line>
        <span>
          <span className="inv" id={titleId}>
            {heading}
          </span>
          {subtitle ? <span className="ac">{`  ${subtitle}`}</span> : null}
        </span>
        {action}
      </Line>
      <Line className="kv">
        <span>STYLE</span>
        <span>{caps(copy.style)}</span>
      </Line>
      <Line className="kv">
        <span>{persona === "mixed" ? "AT THE TABLE" : "TO BEAT IT"}</span>
        <span>{caps(copy.beat)}</span>
      </Line>
      {persona === "mixed" ? <MixedList /> : <Details id={persona} />}
    </div>
  );
}

function MixedList() {
  return (
    <>
      <Line gap>THE SIX STYLES</Line>
      {PERSONA_IDS.map((id) => (
        <Line key={id} className="kv">
          <span>{BOT_COPY[id].short}</span>
          <span>{caps(BOT_COPY[id].style)}</span>
        </Line>
      ))}
    </>
  );
}

function Details({ id }: { id: PersonaId }) {
  const p = PERSONAS[id];
  const s = BOT_STATS[id];
  const stats: [label: string, value: string, acronym: string][] = [
    ["Chooses to put chips in before the flop", pct(s.vpip), "VPIP"],
    ["Raises before the flop", pct(s.pfr), "PFR"],
    ["Re-raises when someone raised first", pct(s.threeBet), "3-BET"],
    ["Bets or raises per call, after the flop", s.af.toFixed(1), "AF"],
    ["Folds to the raiser's flop bet", pct(s.foldToCbet), "FOLD TO C-BET"],
    ["Goes to showdown after seeing a flop", pct(s.wtsd), "WTSD"],
  ];
  return (
    <>
      <Line gap>
        <span>OPENS AT 6 SEATS (RAISES FIRST IN)</span>
        <span className="ac">SHARE OF ALL HANDS</span>
      </Line>
      {OPEN_POSITIONS.map((pos) => (
        <OpenRow key={pos} label={pos} width={p.open[pos]} />
      ))}
      <OpenRow label="HEADS-UP" width={p.huOpen} />
      {p.limp > 0 ? (
        <Line className="kv">
          <span>LIMPS</span>
          <span>{`ALSO JUST CALLS THE BIG BLIND, PLAYING UP TO ${pct(p.limp * 100)} OF HANDS`}</span>
        </Line>
      ) : null}
      <Legend className="pre">
        UTG FIRST TO ACT  HJ HIJACK  CO CUTOFF  BTN BUTTON  SB SMALL BLIND  HEADS-UP 2 SEATS, ON THE BUTTON
      </Legend>
      <Line gap>
        <span>HOW IT PLAYS</span>
        <span className="ac">{`${fmt(BOT_STATS_SAMPLE.hands)} PRACTICE HANDS`}</span>
      </Line>
      {stats.map(([label, value, acronym]) => (
        <Tx
          key={acronym}
          className="st"
          label={
            <>
              {label}
              <span className="ac">{` (${acronym})`}</span>
            </>
          }
          value={value}
        />
      ))}
      <Legend>{`MEASURED AT A ${BOT_STATS_SAMPLE.seats}-SEAT TABLE WITH ONE BOT OF EACH STYLE`}</Legend>
    </>
  );
}

/** One opening-width row: `UTG  11%` then the range. A wider label takes its extra characters from the range. */
function OpenRow({ label, width }: { label: string; width: number }) {
  const v = `${label.padEnd(4)}${pct(width * 100).padStart(4)}`;
  return (
    <Line className="kv op">
      <span className="v">{v}</span>
      <span className="rg" title={topRange(width)}>
        {shortRange(width, RANGE_CHARS - Math.max(0, v.length - OPEN_LABEL_CHARS))}
      </span>
    </Line>
  );
}

export type BotSheetDialogProps = {
  /** The style to show. `null` keeps the dialog closed; any other value opens it as a modal. */
  persona: BotSheetPersona | null;
  /** Seat display name, e.g. `TAG-2`. */
  name?: string;
  /** Called when the dialog closes (Esc, `[CLOSE]`, a click on the backdrop). Set `persona` to null here. */
  onClose: () => void;
};

/**
 * The bot sheet in a native modal `<dialog>`. Opens with `showModal` while `persona` is set; Esc, `[CLOSE]`
 * or a click outside closes it and returns focus to the element that had it when it opened. Written with
 * --ink/--paper only, so it takes the palette of the band it is mounted in (paper or `.screen`).
 */
export function BotSheetDialog({ persona, name, onClose }: BotSheetDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const open = persona !== null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const handleClose = () => {
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className="bot-sheet-dialog"
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={(e) => {
        // a click on the backdrop lands on the dialog itself, outside its box
        const d = ref.current;
        if (!d || e.target !== d) return;
        const r = d.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) d.close();
      }}
    >
      {persona !== null ? (
        <BotSheet
          persona={persona}
          name={name}
          titleId={titleId}
          action={<TextButton onClick={() => ref.current?.close()}>[CLOSE]</TextButton>}
        />
      ) : null}
    </dialog>
  );
}
