"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blank, BoxButton, Choice, Legend, Line, Rule, Screen, Sheet, TextButton, Tx } from "@/components/doc";
import { CycleButton } from "@/components/multiplayer/panels";
import {
  ActionStrip,
  BotSheetDialog,
  KeysLegend,
  PlayControls,
  PokerTable,
  contestedPot,
  StatusBlock,
  StripLegend,
  TableHeader,
  emptyTableModel,
  enterTable,
  fmt,
  modelFromHand,
  onScreen,
} from "@/components/table";
import { botNames } from "@/components/table/names";
import { BOT_COPY, MIXED_COPY } from "@/components/table/bot-profiles";
import {
  applyAction,
  createHand,
  legalActions,
  seatToAct,
  type Action,
  type HandState,
} from "@/lib/engine/engine";
import { PERSONA_IDS, PERSONAS, type PersonaId } from "@/lib/bots/personas";
import { chooseAction } from "@/lib/bots/policy";
import { botView } from "@/lib/bots/view";
import { createRng, type Rng } from "@/lib/poker/cards";

const HERO = 0;
const BAND_ID = "practice-table";
const SMALL_BLIND = 50;
const BIG_BLIND = 100;
const STACK = 10_000;
const SEAT_CHOICES = [2, 3, 4, 5, 6, 7, 8] as const;
/** With AUTO-NEXT on, a finished hand stays up this long before the next is dealt. */
const AUTO_NEXT_MS = 3000;

type PersonaChoice = PersonaId | "mixed";
/** Per-seat bot choices, cycled by `[TAG ▸]`: a random persona, then each one. */
const PERSONA_CHOICES: readonly PersonaChoice[] = ["mixed", ...PERSONA_IDS];
/** `[STATION ▸]`: the short names the seats use. */
const choiceText = (c: PersonaChoice): string => (c === "mixed" ? MIXED_COPY.short : BOT_COPY[c].short);
/** The muted note after a bot's picker: its style in one sentence. */
const choiceNote = (c: PersonaChoice): string =>
  c === "mixed" ? "A RANDOM STYLE, SHOWN AT THE TABLE" : BOT_COPY[c].style.toUpperCase();

interface Stats {
  hands: number;
  net: number;
  rebuys: number;
}

/** What the setup rows said when the session started. */
interface Setup {
  seats: number;
  choices: PersonaChoice[];
}

const sameSetup = (a: Setup, b: Setup): boolean => a.seats === b.seats && a.choices.every((c, i) => c === b.choices[i]);

/** The bot sheet on show, and the band it opened from (it takes that band's palette). */
interface SheetOpen {
  persona: PersonaChoice;
  name?: string;
  from: "setup" | "table";
}

interface Session {
  setup: Setup;
  /** Persona per seat; null for the hero. */
  personas: (PersonaId | null)[];
  names: string[];
  button: number;
  handNo: number;
  hand: HandState;
  stats: Stats;
}

function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

/** Records the hero's result once, at the step that finishes the hand. */
function advance(s: Session, next: HandState): Session {
  if (!next.complete || s.hand.complete) return { ...s, hand: next };
  const net = next.result!.net[HERO];
  return { ...s, hand: next, stats: { ...s.stats, hands: s.stats.hands + 1, net: s.stats.net + net } };
}

/** Next hand: button moves, busted seats rebuy to the starting stack. */
function nextHand(s: Session, seed: number): Session {
  const final = s.hand.result!.finalStacks;
  const stacks = final.map((x) => (x > 0 ? x : STACK));
  const rebuys = s.stats.rebuys + (final[HERO] > 0 ? 0 : 1);
  const button = (s.button + 1) % stacks.length;
  return {
    ...s,
    button,
    handNo: s.handNo + 1,
    hand: createHand({ stacks, button, smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND }, { seed }),
    stats: { ...s.stats, rebuys },
  };
}

/** Scroll the table into view and hand focus to the controls (DEAL, NEXT HAND). */
function showTable() {
  const band = document.getElementById(BAND_ID);
  if (band) enterTable(band);
}

function pickPersonas(choices: PersonaChoice[], rng: Rng): (PersonaId | null)[] {
  return choices.map((c, i) => (i === HERO ? null : c === "mixed" ? PERSONA_IDS[rng.int(PERSONA_IDS.length)] : c));
}

export default function PlayClient() {
  const [seats, setSeats] = useState(6);
  const [choices, setChoices] = useState<PersonaChoice[]>(() => new Array(8).fill("mixed"));
  const [session, setSession] = useState<Session | null>(null);
  // NEW SESSION wipes the stats, so it takes a second click.
  const [confirmNew, setConfirmNew] = useState(false);
  // Off: a finished hand stays up until NEXT HAND.
  const [autoNext, setAutoNext] = useState(false);
  const [sheet, setSheet] = useState<SheetOpen | null>(null);
  const rngRef = useRef<Rng | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const setup: Setup = { seats, choices: choices.slice(0, seats) };

  const deal = () => {
    if (session && !confirmNew) {
      setConfirmNew(true);
      return;
    }
    setConfirmNew(false);
    const rng = createRng(newSeed());
    rngRef.current = rng;
    const personas = pickPersonas(choices.slice(0, seats), rng);
    const button = rng.int(seats);
    setSession({
      setup,
      personas,
      names: botNames(personas),
      button,
      handNo: 1,
      hand: createHand(
        { stacks: new Array(seats).fill(STACK), button, smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND },
        { seed: rng.nextU32() },
      ),
      stats: { hands: 0, net: 0, rebuys: 0 },
    });
    showTable();
  };

  const dealNext = useCallback(() => {
    const seed = rngRef.current!.nextU32();
    setSession((s) => (s && s.hand.complete ? nextHand(s, seed) : s));
    showTable();
  }, []);

  // Bots think for 400-900 ms. A finished hand stays up until NEXT HAND (or AUTO_NEXT_MS with AUTO-NEXT on).
  useEffect(() => {
    if (!session) return;
    const { hand } = session;
    const rng = rngRef.current!;
    if (hand.complete) {
      if (!autoNext) return;
      const t = setTimeout(() => {
        const seed = rng.nextU32();
        setSession((s) => (s === session ? nextHand(s, seed) : s));
      }, AUTO_NEXT_MS);
      return () => clearTimeout(t);
    }
    const seat = seatToAct(hand)!;
    if (seat === HERO) return;
    const t = setTimeout(
      () => {
        const persona = PERSONAS[session.personas[seat]!];
        const next = applyAction(hand, chooseAction(persona, botView(hand, seat), rng).action);
        setSession((s) => (s && s.hand === hand ? advance(s, next) : s));
      },
      400 + Math.random() * 500,
    );
    return () => clearTimeout(t);
  }, [session, autoNext]);

  const complete = !!session?.hand.complete;
  const handNo = session?.handNo ?? 0;
  // A finished hand: NEXT HAND takes focus if the controls had it and it is on screen; N deals too.
  useEffect(() => {
    if (!complete) return;
    const a = document.activeElement;
    const btn = nextRef.current;
    if (btn && (!a || a === document.body || btn.closest(".controls-dock")?.contains(a)) && onScreen(btn)) {
      btn.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.key.toLowerCase() !== "n") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (t?.closest?.("dialog")) return;
      e.preventDefault();
      dealNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [complete, handNo, dealNext]);

  const act = useCallback((a: Action) => {
    setSession((s) => {
      if (!s || s.hand.complete || seatToAct(s.hand) !== HERO) return s;
      return advance(s, applyAction(s.hand, a));
    });
  }, []);

  const previewNames = useMemo(
    () => choices.slice(0, seats).map((c, i) => (i === HERO ? "YOU" : c === "mixed" ? "BOT" : c.toUpperCase())),
    [choices, seats],
  );

  const model = useMemo(() => {
    if (session) return modelFromHand(session.hand, HERO, session.names, { handNo: session.handNo });
    return emptyTableModel(
      previewNames.map((name, i) => ({ name, kind: i === HERO ? "human" : "bot" })),
      new Array(seats).fill(STACK),
      { heroSeat: HERO, smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND },
    );
  }, [session, previewNames, seats]);

  const hand = session?.hand ?? null;
  const heroTurn = !!hand && !hand.complete && seatToAct(hand) === HERO;
  const legal = heroTurn ? legalActions(hand) : null;

  const seatInfo = (seat: number) => {
    const persona = session ? session.personas[seat] : choices[seat];
    if (persona) setSheet({ persona, name: session?.names[seat], from: "table" });
  };
  const sheetDialog = (
    <BotSheetDialog persona={sheet?.persona ?? null} name={sheet?.name} onClose={() => setSheet(null)} />
  );
  const setupChanged = !!session && !sameSetup(session.setup, setup);

  const stats = session?.stats ?? { hands: 0, net: 0, rebuys: 0 };
  const bb100 = stats.hands > 0 ? (stats.net / BIG_BLIND / stats.hands) * 100 : 0;
  const tone = (x: number) => (x > 0 ? "text-green" : x < 0 ? "text-red" : undefined);
  const signed = (x: number, s: string) => (x > 0 ? `+${s}` : s);

  return (
    <Sheet className="flex-1">
      <Blank />
      <Line as="h1">
        <span className="inv">PLAY: PRACTICE AGAINST BOTS</span>
      </Line>
      <Blank />
      <Line as="p">YOU SIT IN SEAT 1. EVERY BOT PLAYS A KNOWN STRATEGY, SO ITS RANGE CAN BE WORKED OUT FROM ITS ACTIONS.</Line>
      <Blank />
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
          {SMALL_BLIND}/{BIG_BLIND}
        </span>
      </div>
      <div className="l field">
        <span>STACK</span>
        <span>{fmt(STACK)}, BUSTED SEATS REBUY</span>
      </div>
      <div className="l field">
        <span>AUTO-NEXT</span>
        <span>
          <Choice type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)}>
            DEAL THE NEXT HAND AFTER 3 S
          </Choice>
        </span>
      </div>
      <div className="l field">
        <span>S1</span>
        <span>YOU</span>
      </div>
      {Array.from({ length: seats - 1 }, (_, k) => k + 1).map((i) => (
        <div key={i} className="l field">
          <span>S{i + 1} BOT</span>
          <span className="bot-pick">
            <CycleButton
              className="pick"
              options={PERSONA_CHOICES}
              value={choices[i]}
              text={choiceText}
              label={`Bot for seat ${i + 1}`}
              onChange={(v) => setChoices((c) => c.map((x, j) => (j === i ? v : x)))}
            />
            <TextButton
              aria-label={`About ${choices[i] === "mixed" ? "mixed bots" : `the ${choiceText(choices[i])} style`}`}
              onClick={() => setSheet({ persona: choices[i], from: "setup" })}
            >
              [ABOUT]
            </TextButton>
            <span className="note">{choiceNote(choices[i])}</span>
          </span>
        </div>
      ))}
      <Legend className="field">
        <span />
        <span className="pre">[STYLE ▸] (CLICK TO CHANGE)  [ABOUT] HOW TO BEAT IT</span>
      </Legend>
      <Line gap>
        <span className="opts">
          <BoxButton filled onClick={deal} onBlur={() => setConfirmNew(false)}>
            {!session ? "DEAL →" : confirmNew ? "CONFIRM — WIPES STATS →" : "NEW SESSION →"}
          </BoxButton>
          {setupChanged ? <span className="text-muted">SETUP CHANGED · APPLIES ON NEW SESSION</span> : null}
        </span>
      </Line>
      <Line>
        <Link href="/play/friends">PLAY WITH FRIENDS →</Link>
      </Line>
      <Blank />
      <Rule />
      <Screen id={BAND_ID} aria-label="Practice table">
        <TableHeader model={model} title="PRACTICE TABLE" mode={`SOLO  ${model.capacity} SEATS`} waiting="NO HAND YET" />
        <PokerTable model={model} label={`Practice table, ${model.seated} seats`} onSeatInfo={seatInfo} />
        <PlayControls
          legal={legal}
          pot={model.pot}
          contestedPot={legal && hand ? contestedPot(hand.committed, HERO, legal.callAmount) : undefined}
          heroBet={hand ? hand.bets[HERO] : 0}
          stack={hand ? hand.stacks[HERO] : STACK}
          onAct={act}
          status={
            <StatusBlock
              model={model}
              heroTurn={heroTurn}
              toCall={legal?.callAmount}
              idle="PRESS DEAL TO START"
              action={
                complete ? (
                  <button ref={nextRef} type="button" className="apply cta" onClick={dealNext}>
                    NEXT HAND →
                  </button>
                ) : null
              }
            />
          }
        />
        <KeysLegend extra="N NEXT HAND" />
        <Line center gap>
          <span>ACTION</span>
        </Line>
        <ActionStrip strip={model.strip} />
        <StripLegend />
        {sheet?.from === "table" ? sheetDialog : null}
      </Screen>
      <Blank />
      <Line center>
        <span>SESSION</span>
      </Line>
      <Tx className="num" label="HANDS PLAYED" value={fmt(stats.hands)} />
      <Tx
        className="num"
        label="NET CHIPS"
        value={<span className={tone(stats.net)}>{signed(stats.net, fmt(stats.net))}</span>}
      />
      <Tx
        className="num"
        label={
          <>
            BIG BLINDS WON PER 100 HANDS <span className="text-muted">(BB/100)</span>
          </>
        }
        value={<span className={tone(bb100)}>{signed(bb100, bb100.toFixed(1))}</span>}
      />
      <Tx
        className="num"
        label={
          <>
            REBUYS <span className="text-muted">(TIMES YOU BUSTED)</span>
          </>
        }
        value={fmt(stats.rebuys)}
      />
      <Legend>BB/100 SETTLES ONLY OVER THOUSANDS OF HANDS.</Legend>
      <Blank />
      {sheet?.from !== "table" ? sheetDialog : null}
    </Sheet>
  );
}
