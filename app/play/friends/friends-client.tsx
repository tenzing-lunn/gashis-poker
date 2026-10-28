"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Blank, BoxButton, Choice, Line, Sheet, Tag } from "@/components/doc";
import { loadNickname, parseTableId, saveNickname, TABLE_SERVER_URL } from "@/components/multiplayer/storage";
import { createTable, CreateTableError } from "@/lib/multiplayer/client";
import { sanitizeName } from "@/lib/multiplayer/protocol";

const SEAT_CHOICES = [2, 3, 4, 5, 6, 7, 8] as const;
const noSubscribe = () => () => {};

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
  const [typed, setTyped] = useState<string | null>(null);
  const nickname = typed ?? stored;
  const [seats, setSeats] = useState(6);
  const [nameError, setNameError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const name = sanitizeName(nickname);
    if (!name) return setNameError("NICKNAME MUST BE 1–16 CHARACTERS");
    saveNickname(name);
    setBusy(true);
    setCreateError(null);
    try {
      const id = await createTable(TABLE_SERVER_URL, seats);
      router.push(`/play/t/${id}`);
    } catch (err) {
      const reason = err instanceof CreateTableError ? err.reason : "unreachable";
      setCreateError(
        reason === "origin_refused"
          ? `THE TABLE SERVER REFUSED THIS SITE (403): ${window.location.origin.toUpperCase()} IS NOT AN ALLOWED ORIGIN.`
          : reason === "failed"
            ? `THE TABLE SERVER SAID NO (${err instanceof CreateTableError ? err.status : "ERROR"}). TRY AGAIN IN A MOMENT.`
            : "COULD NOT REACH THE TABLE SERVER (NETWORK ERROR). TRY AGAIN IN A MOMENT.",
      );
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const id = parseTableId(link);
    if (!id) return setLinkError("TYPE THE 6-LETTER CODE OR PASTE THE TABLE LINK");
    const name = sanitizeName(nickname);
    if (name) saveNickname(name);
    router.push(`/play/t/${id}`);
  };

  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">PLAY WITH FRIENDS</span>
      </Line>
      <Blank />
      <Line as="p">
        <span>OPEN A TABLE, SEND THE LINK, AND FILL ANY EMPTY SEATS WITH BOTS. PLAY MONEY: BUSTED SEATS REBUY.</span>
      </Line>
      <Blank />
      <form onSubmit={create} noValidate aria-label="Create a table">
        <label className="l field">
          <span>NICKNAME</span>
          <input
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
          <span>50/100, 10,000 STACKS, 20 S PER DECISION</span>
        </div>
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
      <Line center>
        <span>OR JOIN ONE</span>
      </Line>
      <form onSubmit={join} noValidate aria-label="Join a table">
        <div className="l field">
          <label htmlFor="table-link">CODE OR LINK</label>
          <span className="flex items-baseline gap-[2ch]">
            <input
              id="table-link"
              className="min-w-0 flex-1"
              value={link}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={linkError ? true : undefined}
              aria-describedby={linkError ? "link-err" : undefined}
              onChange={(e) => {
                setLink(e.target.value);
                setLinkError(null);
              }}
            />
            <BoxButton type="submit" className="shrink-0">
              JOIN →
            </BoxButton>
          </span>
        </div>
        <ErrorLine id="link-err">{linkError}</ErrorLine>
      </form>
      <Blank />
    </Sheet>
  );
}
