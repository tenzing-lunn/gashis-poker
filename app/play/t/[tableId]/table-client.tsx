"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Blank, BoxButton, Line, Rule, Screen, Sheet, Tag, TextButton } from "@/components/doc";
import {
  ActionStrip,
  HandReadLine,
  HandReadPanel,
  HandReadToggle,
  heroRead,
  KeysLegend,
  PlayControls,
  PokerTable,
  ResultPopup,
  revealTable,
  StatusBlock,
  StripLegend,
  TableHeader,
  useHandRead,
  useHandReview,
} from "@/components/table";
import {
  heroChips,
  heroLegal,
  heroSeatOf,
  hostDealsNext,
  isPaused,
  modeText,
  modelFromState,
  pausedText,
  reviewSeatOf,
  secondsLeft,
  waitingText,
} from "@/components/multiplayer/model";
import { FinalRows, HandLogLines, HostPanel, SeatList, TableBar } from "@/components/multiplayer/panels";
import { loadNickname, saveNickname } from "@/components/multiplayer/storage";
import { useTable } from "@/components/multiplayer/use-table";
import type { RejectCode } from "@/lib/multiplayer/client";
import { sanitizeName, type FinalRow } from "@/lib/multiplayer/protocol";
import { reviewInputFromPublic } from "@/lib/poker/hand-review";

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
            ? "NO TABLE WITH THIS CODE. IT MAY BE MISTYPED, OR THE TABLE WAS CLOSED (BY ITS HOST, OR AFTER 2 HOURS WITH NOBODY AT IT)."
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

/** The host ended the table: everyone's final chips, then where to go next. */
function TableEnded({ title, rows }: { title: ReactNode; rows: FinalRow[] | null }) {
  return (
    <Sheet className="flex-1">
      <Blank />
      {title}
      <Blank />
      <Line>
        <Tag role="status">TABLE ENDED BY THE HOST</Tag>
      </Line>
      <Blank />
      {rows ? <FinalRows rows={rows} /> : null}
      <Blank />
      <Line>
        <span className="flex flex-wrap items-baseline gap-[2ch]">
          <BoxButton href="/play/friends" filled>
            NEW TABLE →
          </BoxButton>
          <Link href="/play/friends">JOIN ANOTHER CODE →</Link>
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
/** A note never wraps: it is cut with an ellipsis instead (see LiveTable). */
const NOTE = "inline-block min-w-0 max-w-full truncate align-bottom";
const pageUrl = () => window.location.href.split(/[?#]/)[0];
/** Prefixed to the tab title while it is this player's decision, for a tab in the background. */
const TURN_PREFIX = "● YOUR TURN · ";

/** Prefixes the document title while `on`, and puts it back after. */
function useTurnTitle(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const base = document.title.startsWith(TURN_PREFIX) ? document.title.slice(TURN_PREFIX.length) : document.title;
    document.title = TURN_PREFIX + base;
    return () => {
      if (document.title.startsWith(TURN_PREFIX)) document.title = document.title.slice(TURN_PREFIX.length);
    };
  }, [on]);
}

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
  const router = useRouter();
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
  useTurnTitle(!!legal);

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
  const turnSecs =
    state && deadline !== null ? Math.min(Math.ceil(state.config.turnMs / 1000), secondsLeft(deadline, now, view.clockOffsetMs) ?? 0) : null;

  // Server errors, and clicks that could not be sent, show for a few seconds in the line under the status.
  const showError = useRecent(view.error?.at ?? null, 6000);
  const error = showError ? view.error : null;
  const notSent = useRecent(view.notSentAt, 4000) && !online;

  // Controls only for a seated player while hands are dealt: none before the first deal or while paused.
  const controls = !!me && !!state?.started && !!state.hand && !isPaused(state);
  // The first time the controls appear for this seated player, bring the table band into view once (the
  // controls do it again on each of the player's own decisions).
  const revealed = useRef(false);
  useEffect(() => {
    if (!controls || revealed.current) return;
    const band = document.getElementById(SCREEN_ID);
    if (!band?.querySelector(".controls-dock")) return;
    revealed.current = true;
    revealTable(band);
  }, [controls]);

  // Hand read (the hero's cards in a live hand), and the result popup for a finished hand the hero was dealt into:
  // the seat they held in it (kept if they stand up) and the names as first seen in it (someone standing up after
  // does not rename them EMPTY, nor work the review out again).
  const [handReadOn, toggleHandRead] = useHandRead();
  const read = handReadOn && model ? heroRead(model) : null;
  const [handNames, setHandNames] = useState<{ handNo: number; names: Record<number, string> } | null>(null);
  if (model && handNo > 0 && handNames?.handNo !== handNo) setHandNames({ handNo, names: { ...model.seats.map((s) => s.name) } });
  const reviewSeat = state ? reviewSeatOf(state, hole, heroSeat) : null;
  const { key: reviewKey, review } = useHandReview(
    reviewSeat !== null && handNames?.handNo === handNo
      ? reviewInputFromPublic(state!.lastResult!, state!.hand!.actions, reviewSeat, handNames.names)
      : null,
  );

  // The connection only (DESIGN.md §6): no round-trip time, so the header never jitters.
  const conn = (
    <span role="status">
      <span aria-hidden="true">{online ? "●" : "○"}</span> {online ? "CONNECTED" : view.everOpen ? "RECONNECTING…" : "CONNECTING…"}
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

  if (state.ended || view.ended) return <TableEnded title={title} rows={state.ended?.rows ?? null} />;

  const hand = state.hand;
  const paused = isPaused(state);
  const freeSeat = state.seats.findIndex((s) => s === null);
  // A bot playing this watcher's chips since they went away: they may take that seat back.
  const standIn = heroSeat === null && playerId ? state.seats.findIndex((s) => s?.replacesId === playerId && s.reclaimable) : -1;
  // A bot the host put in for this watcher while they were present: it holds their chips, so no seat for them.
  const holder = heroSeat === null && playerId ? state.seats.findIndex((s) => s?.replacesId === playerId && !s.reclaimable) : -1;

  // The status line's words when nobody is on the clock and no result is up.
  const idle =
    heroSeat === null
      ? standIn >= 0
        ? `A BOT HAS YOUR CHIPS (S${standIn + 1})`
        : holder >= 0
          ? `WATCHING — THE HOST GAVE YOUR CHIPS TO S${holder + 1}`
          : freeSeat >= 0
            ? "WATCHING"
            : "WATCHING — EVERY SEAT IS TAKEN"
      : !state.started
        ? isHost
          ? "SEATED — PRESS START ABOVE WHEN FRIENDS ARE IN"
          : "SEATED — WAITING FOR THE HOST TO START"
        : paused
          ? "PAUSED"
          : "NEXT HAND…";
  // Between hands with the host here, the next hand waits for the host's NEXT (or the server's backstop), whether
  // the host is seated, leaving or watching.
  const hostDeals = hostDealsNext(state, playerId);
  const nextButton = (
    <button type="button" className="apply cta" onClick={actions.next}>
      NEXT HAND →
    </button>
  );
  const own =
    heroSeat === null ? (
      standIn >= 0 ? (
        state.seats[standIn]!.reclaiming ? (
          <span>BACK IN NEXT HAND</span>
        ) : (
          <TextButton onClick={() => actions.sit(standIn)} aria-label={`Take seat ${standIn + 1} back from the bot`}>
            [TAKE SEAT BACK]
          </TextButton>
        )
      ) : freeSeat >= 0 && holder < 0 ? (
        <TextButton onClick={() => actions.sit(freeSeat)} aria-label={`Sit in seat ${freeSeat + 1}, the first free seat`}>
          [SIT]
        </TextButton>
      ) : null
    ) : me!.leaving ? (
      <TextButton onClick={() => actions.sit(heroSeat)} aria-label="Stay in your seat">
        [STAY]
      </TextButton>
    ) : (
      <span className="whitespace-pre-wrap">
        {me!.sittingOut ? (
          <>
            <TextButton onClick={() => actions.sit(heroSeat)}>[SIT BACK IN]</TextButton>
            {"  "}
          </>
        ) : null}
        <TextButton onClick={actions.stand}>[STAND]</TextButton>
      </span>
    );
  const action = hostDeals ? (
    <span className="whitespace-pre-wrap">
      {nextButton}
      {/* Phones: NEXT HAND alone, so the action still fits beside the result's last row. */}
      {own ? <span className="max-[679px]:hidden">{"  "}{own}</span> : null}
    </span>
  ) : (
    own
  );
  const status = (
    <StatusBlock model={model} heroTurn={!!legal} toCall={legal?.callAmount} seconds={turnSecs} idle={idle} action={action} />
  );

  // One line under the status (or under the controls, in place of the keys) carries whatever needs saying
  // now, so a message never adds or removes a row. Worded to fit one line at 375px; anything longer (a
  // server error) is cut with an ellipsis, the whole text still read out.
  const note = notSent ? (
    <Tag role="alert" className={NOTE}>
      NOT CONNECTED — NOT SENT
    </Tag>
  ) : error ? (
    <Tag role="alert" className={NOTE}>
      {error.message.toUpperCase()}
    </Tag>
  ) : !online ? (
    <span className={`text-muted ${NOTE}`}>OFFLINE — CONTROLS PAUSED</span>
  ) : state.ending ? (
    <Tag className={NOTE}>TABLE ENDS AFTER THIS HAND</Tag>
  ) : me?.sittingOut ? (
    <Tag className={NOTE}>SITTING OUT AFTER 2 TIMEOUTS</Tag>
  ) : me?.leaving ? (
    <span className={`text-muted ${NOTE}`}>LEAVING AFTER THIS HAND</span>
  ) : paused ? (
    <span className={`text-muted ${NOTE}`}>{pausedText(state)}</span>
  ) : !isHost && hand?.complete && state.waitingForHost ? (
    <span className={`text-muted ${NOTE}`}>WAITING FOR THE HOST TO DEAL</span>
  ) : null;
  const names = model.seats.map((s) => s.name);

  return (
    <Sheet className="flex-1">
      <Blank />
      {title}
      <Blank />
      <TableBar
        code={tableId}
        url={inviteUrl}
        state={state}
        isHost={isHost}
        onStart={actions.start}
        onLeave={() => {
          actions.leave();
          router.push("/play/friends");
        }}
        onEnd={actions.endTable}
      />
      <Rule />
      <Screen id={SCREEN_ID} aria-label="Table with friends">
        <TableHeader
          model={model}
          title={`TABLE ${tableId}`}
          mode={modeText(state)}
          right={conn}
          waiting={waitingText(state, isHost)}
          tool={<HandReadToggle on={handReadOn} onToggle={toggleHandRead} />}
        />
        <PokerTable
          model={model}
          label={`Table ${tableId}, ${model.seated} of ${model.capacity} seats taken`}
          onSit={heroSeat === null && standIn < 0 && holder < 0 ? actions.sit : undefined}
        >
          {handReadOn ? <HandReadPanel read={read} boardLength={model.board.length} /> : null}
          <ResultPopup
            review={review}
            handKey={reviewKey}
            next={
              hostDeals ? (
                nextButton
              ) : !isHost && state.waitingForHost ? (
                <span className="text-muted">WAITING FOR THE HOST TO DEAL</span>
              ) : paused ? null : (
                <span className="text-muted">NEXT HAND…</span>
              )
            }
          />
        </PokerTable>
        {handReadOn && heroSeat !== null ? <HandReadLine read={read} /> : null}
        {controls ? (
          <>
            <PlayControls
              legal={legal}
              pot={model.pot}
              heroBet={chips.bet}
              stack={chips.stack}
              onAct={actions.act}
              decisionKey={hand ? `${hand.handNo}:${hand.actions.length}` : undefined}
              status={status}
            />
            {note ? (
              <Line className="legend">{note}</Line>
            ) : (
              <>
                <KeysLegend />
                {/* Mobile hides the keys line: an empty line keeps the slot, so a note never adds a row. */}
                <div className="l hidden! max-[679px]:flex!" aria-hidden="true" />
              </>
            )}
          </>
        ) : (
          <>
            {status}
            <Line>{note}</Line>
          </>
        )}
        <Line center gap>
          <span>ACTION</span>
        </Line>
        <ActionStrip strip={model.strip} />
        <StripLegend />
      </Screen>
      <Blank />
      <HandLogLines log={view.log} />
      <Blank />
      {isHost ? (
        <>
          <HostPanel state={state} names={names} heroSeat={heroSeat} actions={actions} />
          <Blank />
        </>
      ) : null}
      <SeatList state={state} names={names} heroSeat={heroSeat} />
      <Blank />
    </Sheet>
  );
}
