"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { BoxButton, Legend, Line, TextButton, Tx } from "@/components/doc";
import { TableHeader } from "@/components/table";
import { fmt } from "@/components/table/model";
import { PERSONA_IDS, PERSONAS, type PersonaId } from "@/lib/bots/personas";
import type { TableState } from "@/lib/multiplayer/protocol";
import { stamp, type HandLog } from "./log";
import { cycleNext } from "./model";
import type { TableActions } from "./use-table";

/** A persona's display name in caps, `MIXED` for a random one: `TAG`, `CALLING STATION`. */
export const personaText = (p: PersonaId | "mixed"): string => (p === "mixed" ? "MIXED" : PERSONAS[p].name.toUpperCase());

/**
 * An ASCII picker in the §3.5 language: a text button `[TAG ▸]`; each click (or Enter / Space) moves
 * to the next option, wrapping around.
 */
export function CycleButton<T extends string>({
  options,
  value,
  onChange,
  text,
  label,
  className,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  text: (v: T) => string;
  /** What is being picked, for the accessible name: `Bot for seat 3`. */
  label: string;
  className?: string;
}) {
  return (
    <TextButton
      className={className}
      aria-label={`${label}: ${text(value)}. Press to change`}
      onClick={() => onChange(cycleNext(options, value))}
    >
      [{text(value)} ▸]
    </TextButton>
  );
}

/** The table header; before the first deal the hand line says what the table is waiting for. */
export function LiveHeader({ waiting, ...props }: ComponentProps<typeof TableHeader> & { waiting: string }) {
  const { model, title, mode, right } = props;
  if (model.handNo > 0) return <TableHeader {...props} />;
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
        <span>{waiting}</span>
        <span>
          BLINDS {model.smallBlind}/{model.bigBlind}
        </span>
      </Line>
    </>
  );
}

/** Host only: start the table, put bots in empty seats, take them out again. */
export function HostPanel({ state, names, actions }: { state: TableState; names: string[]; actions: TableActions }) {
  const [persona, setPersona] = useState<Record<number, PersonaId>>({});
  const seated = state.seats.filter(Boolean).length;
  return (
    <>
      <Line center>
        <span>HOST</span>
      </Line>
      <Line>
        <span>
          {state.started
            ? "TABLE STARTED. HANDS DEAL WHILE TWO OR MORE ARE SEATED."
            : seated >= 2
              ? "READY: DEAL THE FIRST HAND WHEN EVERYONE IS IN."
              : "SEAT AT LEAST TWO PLAYERS OR BOTS TO START."}
        </span>
        {state.started ? null : (
          <BoxButton filled={seated >= 2} disabled={seated < 2} onClick={actions.start}>
            START →
          </BoxButton>
        )}
      </Line>
      {state.seats.map((s, i) => {
        if (s && s.kind === "human") return null;
        const label = `S${i + 1}`;
        if (s) {
          return (
            <Line key={i}>
              <span>
                {label} {names[i]} (BOT)
                {s.leaving ? " LEAVING" : ""}
              </span>
              <TextButton onClick={() => actions.removeBot(i)} aria-label={`Remove the bot in seat ${i + 1}`} disabled={s.leaving}>
                [REMOVE]
              </TextButton>
            </Line>
          );
        }
        const p = persona[i] ?? "tag";
        return (
          <Line key={i}>
            <span>{label} EMPTY</span>
            <span className="whitespace-pre-wrap">
              <CycleButton
                options={PERSONA_IDS}
                value={p}
                text={personaText}
                label={`Bot for seat ${i + 1}`}
                onChange={(next) => setPersona((m) => ({ ...m, [i]: next }))}
              />
              {"  "}
              <TextButton onClick={() => actions.addBot(i, p)} aria-label={`Add a ${personaText(p)} bot in seat ${i + 1}`}>
                [+ BOT]
              </TextButton>
            </span>
          </Line>
        );
      })}
    </>
  );
}

/** The table link in an underlined read-only field with a [COPY] button (DESIGN.md §6). */
export function InviteLine({ url }: { url: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<"yes" | "select" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flash = (v: "yes" | "select") => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(v);
    timer.current = setTimeout(() => setCopied(null), 2000);
  };
  const fallback = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    flash(ok ? "yes" : "select");
  };
  const copy = () => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => flash("yes"), fallback);
    else fallback();
  };
  return (
    <div className="l field">
      <span>INVITE</span>
      <span className="flex items-baseline gap-[2ch]">
        <input ref={ref} className="u min-w-0 flex-1" readOnly value={url} aria-label="Table link" onFocus={(e) => e.currentTarget.select()} />
        <TextButton className="shrink-0" onClick={copy}>
          {copied === "yes" ? "[COPIED]" : copied === "select" ? "[PRESS CTRL+C]" : "[COPY]"}
        </TextButton>
        <span className="sr-only" aria-live="polite">
          {copied === "yes" ? "Link copied" : copied === "select" ? "Link selected; copy it with your keyboard" : ""}
        </span>
      </span>
    </div>
  );
}

/**
 * One record row per seat: who, what, chips, connection. Under 680px the kind and host shrink to
 * `H` / `B` and `*` (explained in the legend) and SITTING OUT to OUT, so each row stays on one line.
 */
export function SeatList({ state, names, heroSeat }: { state: TableState; names: string[]; heroSeat: number | null }) {
  return (
    <>
      <Line center>
        <span>SEATS</span>
      </Line>
      {state.seats.map((s, i) => {
        const label = `S${i + 1}`;
        if (!s) return <Tx key={i} className={ROW} label={`${label}  EMPTY`} value="--" />;
        const who = `${names[i]}${i === heroSeat ? " (YOU)" : ""}`;
        const host = s.playerId === state.hostId;
        const kind = s.kind === "bot" ? "BOT" : "HUMAN";
        const flag = s.leaving ? "LEAVING" : s.sittingOut ? "SITTING OUT" : null;
        return (
          <Tx
            key={i}
            className={ROW}
            label={
              <>
                {label}  {who}  <span className="max-[679px]:sr-only">{host ? `${kind} HOST` : kind}</span>
                <span aria-hidden="true" className="hidden max-[679px]:inline">
                  {kind[0]}
                  {host ? "*" : ""}
                </span>
                {"  "}
                <span aria-hidden="true">{s.connected ? "●" : "○"}</span>
                <span className="sr-only">{s.connected ? ", connected" : ", disconnected"}</span>
              </>
            }
            value={
              <>
                {fmt(s.stack)}
                {flag ? (
                  <>
                    {"  "}
                    <span className="max-[679px]:sr-only">{flag}</span>
                    <span aria-hidden="true" className="hidden max-[679px]:inline">
                      {s.leaving ? "LEAVING" : "OUT"}
                    </span>
                  </>
                ) : null}
              </>
            }
          />
        );
      })}
      <Legend className="pre">
        <span>
          <span className="hidden max-[679px]:inline">H HUMAN  B BOT  * HOST  </span>
          <span className="max-[679px]:hidden">● CONNECTED  </span>○ AWAY
        </span>
      </Legend>
    </>
  );
}

/** Seat rows: on mobile the value column shrinks to fit the chips instead of a fixed 22ch. */
const ROW = "whitespace-pre-wrap max-[679px]:grid-cols-[minmax(0,1fr)_auto]!";

/** The last rows of the hand log, dealer-trace style: `+0.074  S2 CHECK` with muted times. */
export function HandLogLines({ log }: { log: HandLog }) {
  return (
    <>
      <Line center>
        <span>HAND LOG</span>
      </Line>
      {log.rows.length === 0 ? (
        <Line>
          <span className="text-muted">NO HANDS YET</span>
        </Line>
      ) : (
        log.rows.map((r) => (
          <Line key={r.key}>
            <span className="whitespace-pre-wrap">
              <span className="text-muted">{stamp(r.t).padEnd(10)}</span>
              {r.text}
            </span>
          </Line>
        ))
      )}
    </>
  );
}
