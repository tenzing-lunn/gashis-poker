"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Blank, BoxButton, Choice, Line, Sheet, Tag } from "@/components/doc";
import { fmt } from "@/components/table/model";
import {
  loadNickname,
  loadRecentTables,
  parseTableId,
  saveNickname,
  TABLE_SERVER_URL,
} from "@/components/multiplayer/storage";
import { createTable, CreateTableError, probeTable } from "@/lib/multiplayer/client";
import { sanitizeName } from "@/lib/multiplayer/protocol";
import { DEFAULT_ROOM_CONFIG, TURN_SECOND_CHOICES } from "@/lib/multiplayer/config";

const SEAT_CHOICES = [2, 3, 4, 5, 6, 7, 8] as const;
const noSubscribe = () => () => {};
/** Recent tables shown: the last few joined in the past day. */
const RECENT_SHOWN = 3;
const RECENT_MS = 24 * 60 * 60 * 1000;
/** `JUST NOW`, `12 MIN AGO`, `3 H AGO`. */
function ago(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "JUST NOW";
  return min < 60 ? `${min} MIN AGO` : `${Math.floor(min / 60)} H AGO`;
}

/**
 * The recent tables worth showing, with their ages, as a string (a stable store snapshot): ages are
 * whole minutes, so it only changes when a minute ticks over.
 */
const recentSnapshot = () => {
  const now = Date.now();
  const shown = loadRecentTables()
    .filter((t) => now - t.at < RECENT_MS)
    .slice(0, RECENT_SHOWN)
    .map((t) => ({ code: t.code, ago: ago(now - t.at) }));
  return JSON.stringify(shown);
};

const refusedText = () => `THE TABLE SERVER REFUSED THIS SITE (403): ${window.location.origin.toUpperCase()} IS NOT AN ALLOWED ORIGIN.`;

/** The warn tag line under a field, when it has an error. */
function ErrorLine({ id, children }: { id: string; children: string | null }) {
  if (!children) return null;
  return (
    <div className="l field">
      <span />
      <span>
        <Tag id={id} role="alert">
          {children}
        </Tag>
      </span>
    </div>
  );
}

export default function FriendsClient() {
  const router = useRouter();
  const stored = useSyncExternalStore(noSubscribe, loadNickname, () => "");
  const recentJson = useSyncExternalStore(noSubscribe, recentSnapshot, () => "[]");
  const recent = JSON.parse(recentJson) as { code: string; ago: string }[];
  const [typed, setTyped] = useState<string | null>(null);
  const nickname = typed ?? stored;
  const nickRef = useRef<HTMLInputElement>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [seats, setSeats] = useState(6);
  const [turnSecs, setTurnSecs] = useState<number>(TURN_SECOND_CHOICES[0]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The action that stopped to ask for a nickname: Enter in the nickname field carries on with it. */
  const pending = useRef<"join" | "create" | null>(null);

  // Next keeps this page alive (hidden) after navigating to the table; coming Back must not find JOIN
  // or CREATE still waiting on a request that already succeeded.
  useLayoutEffect(
    () => () => {
      setChecking(false);
      setBusy(false);
      pending.current = null;
    },
    [],
  );

  /** The cleaned nickname, saved; or null with the error shown and the field focused. */
  const takeName = (action: "join" | "create"): string | null => {
    const name = sanitizeName(nickname);
    if (!name) {
      setNameError(nickname.trim() ? "NICKNAME MUST BE 1–16 CHARACTERS" : "TYPE A NICKNAME FIRST");
      pending.current = action;
      nickRef.current?.focus();
      return null;
    }
    pending.current = null;
    saveNickname(name);
    return name;
  };

  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    if (checking) return;
    const id = parseTableId(code);
    if (!id) {
      // Six characters that are not all code letters: say which letters a code uses.
      const typed = code.replace(/[\s-]/g, "");
      return setCodeError(/^[a-z0-9]{6}$/i.test(typed) ? "CODES USE LETTERS ONLY, NO I, L OR O" : "A CODE IS 6 LETTERS, E.G. KXRTVM");
    }
    if (!takeName("join")) return;
    setChecking(true);
    setCodeError(null);
    const found = await probeTable(TABLE_SERVER_URL, id);
    if (found === "open") return router.push(`/play/t/${id}`);
    setChecking(false);
    setCodeError(
      found === "no_such_table"
        ? `NO TABLE WITH CODE ${id}. CHECK THE LETTERS, OR ASK FOR A NEW CODE.`
        : found === "origin_refused"
          ? refusedText()
          : "COULD NOT REACH THE TABLE SERVER. TRY AGAIN IN A MOMENT.",
    );
  };

  const create = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !takeName("create")) return;
    setBusy(true);
    setCreateError(null);
    try {
      const id = await createTable(TABLE_SERVER_URL, seats, turnSecs);
      router.push(`/play/t/${id}`);
    } catch (err) {
      const reason = err instanceof CreateTableError ? err.reason : "unreachable";
      setCreateError(
        reason === "origin_refused"
          ? refusedText()
          : reason === "failed"
            ? `THE TABLE SERVER SAID NO (${err instanceof CreateTableError ? err.status : "ERROR"}). TRY AGAIN IN A MOMENT.`
            : "COULD NOT REACH THE TABLE SERVER (NETWORK ERROR). TRY AGAIN IN A MOMENT.",
      );
      setBusy(false);
    }
  };

  const { smallBlind, bigBlind, startingStack } = DEFAULT_ROOM_CONFIG;

  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">PLAY WITH FRIENDS</span>
      </Line>
      <Blank />
      <Line as="p">
        <span>
          OPEN A TABLE AND SEND FRIENDS ITS 6-LETTER CODE, OR TYPE A FRIEND&apos;S CODE TO JOIN. PLAY MONEY: BUSTED SEATS REBUY.
        </span>
      </Line>
      <Blank />
      <form
        noValidate
        aria-label="Nickname"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending.current === "join") void join();
          else if (pending.current === "create") void create();
        }}
      >
        <label className="l field">
          <span>NICKNAME</span>
          <input
            ref={nickRef}
            value={nickname}
            maxLength={16}
            autoComplete="nickname"
            placeholder="1–16 CHARACTERS"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "nick-err" : undefined}
            onChange={(e) => {
              setTyped(e.target.value);
              setNameError(null);
            }}
          />
        </label>
        <ErrorLine id="nick-err">{nameError}</ErrorLine>
      </form>
      <form onSubmit={join} noValidate aria-label="Join a table with its code">
        <div className="l field">
          <label htmlFor="table-code">JOIN WITH CODE</label>
          <span className="flex items-baseline gap-[2ch]">
            <input
              id="table-code"
              className="min-w-0 flex-1 uppercase"
              value={code}
              placeholder="6 LETTERS OR A LINK"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? "code-err" : undefined}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeError(null);
              }}
            />
            <BoxButton type="submit" className="shrink-0" aria-disabled={checking || undefined}>
              {checking ? "CHECKING…" : "JOIN →"}
            </BoxButton>
          </span>
        </div>
        <ErrorLine id="code-err">{codeError}</ErrorLine>
      </form>
      {recent.length > 0 ? (
        <>
          <Blank />
          <Line center>
            <span>RECENT</span>
          </Line>
          {recent.map((t) => (
            <Line key={t.code}>
              <span className="whitespace-pre-wrap">
                TABLE {t.code}  {t.ago}
              </span>
              <Link href={`/play/t/${t.code}`} aria-label={`Rejoin table ${t.code}`}>
                REJOIN →
              </Link>
            </Line>
          ))}
        </>
      ) : null}
      <Blank />
      <Line center>
        <span>OR OPEN A NEW TABLE</span>
      </Line>
      <form onSubmit={create} noValidate aria-label="Create a table">
        <fieldset>
          <legend className="sr-only">Number of seats</legend>
          <div className="l field">
            <span aria-hidden="true">SEATS</span>
            <span className="opts">
              {SEAT_CHOICES.map((n) => (
                <Choice key={n} name="seats" value={n} checked={seats === n} onChange={() => setSeats(n)}>
                  {n}
                </Choice>
              ))}
            </span>
          </div>
        </fieldset>
        <div className="l field">
          <span>BLINDS</span>
          <span>
            {fmt(smallBlind)}/{fmt(bigBlind)}
          </span>
        </div>
        <div className="l field">
          <span>STACK</span>
          <span>{fmt(startingStack)}</span>
        </div>
        <fieldset>
          <legend className="sr-only">Seconds per move</legend>
          <div className="l field">
            <span aria-hidden="true">TIMER</span>
            <span className="opts">
              {TURN_SECOND_CHOICES.map((n) => (
                <Choice key={n} name="turn" value={n} checked={turnSecs === n} onChange={() => setTurnSecs(n)}>
                  {n}S
                </Choice>
              ))}
            </span>
          </div>
        </fieldset>
        <Line gap>
          <BoxButton filled type="submit" aria-disabled={busy || undefined}>
            {busy ? "CREATING…" : "CREATE TABLE →"}
          </BoxButton>
        </Line>
        {createError ? (
          <Line>
            <Tag role="alert">{createError}</Tag>
          </Line>
        ) : null}
      </form>
      <Blank />
    </Sheet>
  );
}
