"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Blank, BoxButton, Line, Rule, Screen, Sheet, Tag, TextButton } from "@/components/doc";
import { ActionStrip, KeysLegend, PlayControls, PokerTable, StripLegend } from "@/components/table";
import { clockText, heroChips, heroLegal, heroSeatOf, modelFromState, secondsLeft, waitingText } from "@/components/multiplayer/model";
import { HandLogLines, HostPanel, LiveHeader, SeatList, TableBar } from "@/components/multiplayer/panels";
import { loadNickname, saveNickname } from "@/components/multiplayer/storage";
import { useTable } from "@/components/multiplayer/use-table";
import type { RejectCode } from "@/lib/multiplayer/client";
import { sanitizeName } from "@/lib/multiplayer/protocol";

const noSubscribe = () => () => {};
const pageOrigin = () => window.location.origin;

/** Shown once `at` is set, until `ms` later or the next `at`. */
function useRecent(at: number | null, ms: number): boolean {
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    if (at === null) return;
    const t = setTimeout(() => setDismissed(at), ms);
    return () => clearTimeout(t);
  }, [at, ms]);
  return at !== null && at !== dismissed;
}

/**
 * Nickname gate, then the live table. A refused join comes back to the nickname form with the server's
 * reason; a refusal no nickname can fix (refused site, no such table, server unreachable) gets a page
 * of its own.
 */
export default function TableClient({ tableId }: { tableId: string }) {
  // undefined until the browser has been read (server render and hydration).
  const stored = useSyncExternalStore(noSubscribe, loadNickname, () => undefined);
  const [chosen, setChosen] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ code: RejectCode; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const name = refused !== null ? null : (chosen ?? (stored || null));

  const onRejected = useCallback((code: RejectCode, message: string) => setRefused({ code, message }), []);
  const join = (n: string) => {
    saveNickname(n);
    setChosen(n);
    setRefused(null);
    setAttempt((a) => a + 1);
  };
  const retry = () => {
    setRefused(null);
    setAttempt((a) => a + 1);
  };

  const title = (
    <Line as="h1">
      <span className="inv">PLAY WITH FRIENDS: TABLE {tableId}</span>
    </Line>
  );
  if (stored === undefined && chosen === null) {
    return (
      <Sheet className="flex-1">
        <Blank />
        {title}
        <Blank />
        <Line>
          <span className="text-muted">LOADING TABLE…</span>
        </Line>
      </Sheet>
    );
  }
  if (refused?.code === "origin_refused") return <OriginRefused title={title} />;
  if (refused && (refused.code === "no_such_table" || refused.code === "unreachable")) {
    return <TableGone title={title} missing={refused.code === "no_such_table"} onRetry={retry} />;
  }
  if (!name) {
    return (
      <Sheet className="flex-1">
        <Blank />
        {title}
        <Blank />
        <Line as="p">
          <span>PICK A NICKNAME. YOU SIT IN THE FIRST FREE SEAT.</span>
        </Line>
        <Blank />
        <NicknameForm initial={chosen ?? stored ?? ""} error={refused?.message ?? null} onJoin={join} />
        <Blank />
      </Sheet>
    );
  }
  return <LiveTable key={`${name}:${attempt}`} tableId={tableId} name={name} title={title} onRejected={onRejected} />;
}

/** The server refuses this site: no nickname or retry can help, so there is nothing to press. */
function OriginRefused({ title }: { title: ReactNode }) {
  const origin = useSyncExternalStore(noSubscribe, pageOrigin, () => "");
  return (
    <Sheet className="flex-1">
      <Blank />
      {title}
      <Blank />
      <Line>
        <Tag role="alert">THE TABLE SERVER REFUSED THIS SITE (403)</Tag>
      </Line>
      <Line as="p">
        <span>
          IT ONLY ACCEPTS THE SITE ADDRESSES IT WAS GIVEN, AND {origin ? origin.toUpperCase() : "THIS ONE"} IS NOT ONE OF THEM.
          OPEN THE TABLE LINK FROM THE USUAL ADDRESS, OR ADD THIS ONE TO THE SERVER&apos;S DEV_ORIGINS / ALLOWED_ORIGIN.
        </span>
      </Line>
      <Blank />
    </Sheet>
  );
}

/** No table at this link, or the server never answered: start a new table or try again. */
function TableGone({ title, missing, onRetry }: { title: ReactNode; missing: boolean; onRetry: () => void }) {
  return (
    <Sheet className="flex-1">
      <Blank />
      {title}
      <Blank />
      <Line>
        <Tag role="alert">{missing ? "NO SUCH TABLE" : "CAN'T REACH THE TABLE SERVER"}</Tag>
      </Line>
      <Line as="p">
        <span>
          {missing
            ? "NO TABLE WITH THIS CODE. IT MAY BE MISTYPED, OR THE TABLE CLOSED AFTER 2 HOURS WITH NOBODY AT IT."
            : "IT MAY BE DOWN, OR THIS DEVICE IS OFFLINE. TRY AGAIN IN A MOMENT."}
        </span>
      </Line>
      <Blank />
      <Line>
        <span className="flex flex-wrap items-baseline gap-[2ch]">
          <BoxButton href="/play/friends" filled>
            NEW TABLE →
          </BoxButton>
          {missing ? (
            <Link href="/play/friends">JOIN ANOTHER CODE →</Link>
          ) : (
            <TextButton onClick={onRetry}>[RETRY]</TextButton>
          )}
        </span>
      </Line>
      <Blank />
    </Sheet>
  );
}

function NicknameForm({ initial, error, onJoin }: { initial: string; error: string | null; onJoin: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = sanitizeName(value);
    if (!clean) return setInvalid(true);
    onJoin(clean);
  };
  const message = invalid ? "NICKNAME MUST BE 1–16 CHARACTERS" : error ? error.toUpperCase() : null;
  return (
    <form onSubmit={submit} noValidate>
      <div className="l field">
        <label htmlFor="nick">NICKNAME</label>
        <span className="flex items-baseline gap-[2ch]">
          <input
            id="nick"
            className="min-w-0 flex-1"
            value={value}
            maxLength={16}
            autoComplete="nickname"
            autoFocus
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "nick-err" : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalid(false);
            }}
          />
          <BoxButton filled type="submit" className="shrink-0">
            JOIN TABLE →
          </BoxButton>
        </span>
      </div>
      {message ? (
        <div className="l field">
          <span />
          <span>
            <Tag id="nick-err" role="alert">
              {message}
            </Tag>
          </span>
        </div>
      ) : null}
    </form>
  );
}

const SCREEN_ID = "live-table";
const pageUrl = () => window.location.href.split(/[?#]/)[0];

function LiveTable({
  tableId,
  name,
  title,
  onRejected,
}: {
  tableId: string;
  name: string;
  title: ReactNode;
  onRejected: (code: RejectCode, message: string) => void;
}) {
  const { view, actions } = useTable(tableId, name, onRejected);
  const { state, playerId } = view;
  const inviteUrl = useSyncExternalStore(noSubscribe, pageUrl, () => `/play/t/${tableId}`);

  const handNo = state?.hand?.handNo ?? 0;
  const hole = view.holes[handNo] ?? null;
  const model = useMemo(() => (state ? modelFromState(state, hole, playerId) : null), [state, hole, playerId]);
  const heroSeat = state ? heroSeatOf(state, playerId) : null;
  const online = view.status === "open";
  // Nothing can be sent while the socket is down, so the controls wait for the reconnect.
  const legal = state && online ? heroLegal(state, playerId) : null;
  const chips = state ? heroChips(state, playerId) : { bet: 0, stack: 0 };
  const me = heroSeat !== null ? state!.seats[heroSeat] : null;
  const isHost = !!state && !!playerId && state.hostId === playerId;

  // Turn clock: ticks while someone human is on the clock (hidden while reconnecting: it may be stale).
  const deadline = online ? (state?.deadline ?? null) : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 250);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [deadline]);
  const turnSecs = state ? Math.min(Math.ceil(state.config.turnMs / 1000), secondsLeft(deadline, now, view.clockOffsetMs) ?? 0) : 0;

  // Server errors, and clicks that could not be sent, show for a few seconds next to the controls.
  const showError = useRecent(view.error?.at ?? null, 6000);
  const error = showError ? view.error : null;
  const notSent = useRecent(view.notSentAt, 4000) && !online;

  // The first time a hand reaches this seated player, bring the controls on screen once: on a short
  // window the action buttons can sit just under the fold, with the clock already running.
  const dealtIn = !!me && !!state?.started && !!state.hand;
  const scrolled = useRef(false);
  useEffect(() => {
    if (!dealtIn || scrolled.current) return;
    scrolled.current = true;
    document.getElementById(SCREEN_ID)?.querySelector(".controls-dock")?.scrollIntoView({ block: "nearest" });
  }, [dealtIn]);

  // Only the connection state is a live region; the round trip changes every ping and stays plain text.
  const conn = (
    <span className="whitespace-pre-wrap">
      <span role="status">
        <span aria-hidden="true">{online ? "●" : "○"}</span>{" "}
        {online ? "CONNECTED" : view.everOpen ? "RECONNECTING…" : "CONNECTING…"}
      </span>
      {online && view.rttMs !== null ? `  ${Math.round(view.rttMs)} MS` : ""}
    </span>
  );
  const right = (
    <span className="whitespace-pre-wrap">
      {deadline !== null ? <span className={turnSecs <= 5 ? "text-amber" : undefined}>{clockText(turnSecs)}    </span> : null}
      {conn}
    </span>
  );

  if (!state || !model) {
    return (
      <Sheet className="flex-1">
        <Blank />
        {title}
        <Blank />
        <Line>
          <span className="text-muted">{view.everOpen ? "JOINING…" : "CONNECTING TO THE TABLE SERVER…"}</span>
          <span>{conn}</span>
        </Line>
        <Blank />
      </Sheet>
    );
  }

  const hand = state.hand;
  const toAct = model.toAct;
  const status = !online
    ? "CONTROLS PAUSED UNTIL RECONNECTED"
    : !state.started
    ? isHost
      ? "SEATED — PRESS START ABOVE WHEN FRIENDS ARE IN"
      : "SEATED — WAITING FOR THE HOST TO START"
    : !hand
      ? "WAITING FOR TWO PLAYERS"
      : hand.complete
        ? "NEXT HAND…"
        : legal
          ? "YOUR TURN"
          : toAct !== null
            ? `${model.seats[toAct].name} TO ACT`
            : "";
  const names = model.seats.map((s) => s.name);
  const freeSeat = state.seats.findIndex((s) => s === null);
  const playing = state.started && !!hand;

  return (
    <Sheet className="flex-1">
      <Blank />
      {title}
      <Blank />
      <TableBar code={tableId} url={inviteUrl} state={state} isHost={isHost} onStart={actions.start} />
      <Rule />
      <Screen id={SCREEN_ID} aria-label="Table with friends">
        <LiveHeader
          model={model}
          title={`TABLE ${tableId}`}
          mode={`LIVE  ${model.seated}/${model.capacity} SEATED`}
          right={right}
          waiting={waitingText(state, isHost)}
        />
        <PokerTable
          model={model}
          label={`Table ${tableId}, ${model.seated} of ${model.capacity} seats taken`}
          onSit={heroSeat === null ? actions.sit : undefined}
        />
        <Line>
          <span>{heroSeat === null ? (freeSeat >= 0 ? "WATCHING" : "WATCHING — EVERY SEAT IS TAKEN") : status}</span>
          {heroSeat === null && freeSeat >= 0 ? (
            <TextButton onClick={() => actions.sit(freeSeat)} aria-label={`Sit in seat ${freeSeat + 1}, the first free seat`}>
              [SIT]
            </TextButton>
          ) : null}
          {me ? (
            <span className="whitespace-pre-wrap">
              {me.leaving ? (
                <>
                  LEAVING AFTER THIS HAND{"  "}
                  <TextButton onClick={() => actions.sit(heroSeat!)}>[STAY]</TextButton>
                </>
              ) : (
                <>
                  {me.sittingOut ? (
                    <>
                      SITTING OUT{"  "}
                      <TextButton onClick={() => actions.sit(heroSeat!)}>[SIT BACK IN]</TextButton>
                      {"  "}
                    </>
                  ) : null}
                  <TextButton onClick={actions.stand}>[STAND]</TextButton>
                </>
              )}
            </span>
          ) : null}
        </Line>
        {/* Watchers have nothing to act with, and nobody before the first deal: no dead controls. */}
        {me && playing ? <PlayControls legal={legal} pot={model.pot} heroBet={chips.bet} stack={chips.stack} onAct={actions.act} /> : null}
        {notSent ? (
          <Line>
            <Tag role="alert">NOT CONNECTED — NOT SENT</Tag>
          </Line>
        ) : error ? (
          <Line>
            <Tag role="alert">{error.message.toUpperCase()}</Tag>
          </Line>
        ) : null}
        {me && playing ? <KeysLegend /> : null}
        <Line center gap>
          <span>ACTION</span>
        </Line>
        <ActionStrip strip={model.strip} />
        <StripLegend />
      </Screen>
      <Blank />
      {isHost ? (
        <>
          <HostPanel state={state} names={names} actions={actions} />
          <Blank />
        </>
      ) : null}
      <SeatList state={state} names={names} heroSeat={heroSeat} />
      <Blank />
      <HandLogLines log={view.log} />
      <Blank />
    </Sheet>
  );
}
