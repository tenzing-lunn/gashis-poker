"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blank, BoxButton, Choice, Line, Rule, Screen, Sheet, Tx } from "@/components/doc";
import {
  ActionStrip,
  KeysLegend,
  PlayControls,
  PokerTable,
  StripLegend,
  TableHeader,
  emptyTableModel,
  fmt,
  modelFromHand,
} from "@/components/table";
import { botNames } from "@/components/table/names";
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
const SMALL_BLIND = 50;
const BIG_BLIND = 100;
const STACK = 10_000;
const SEAT_CHOICES = [2, 3, 4, 5, 6, 7, 8] as const;
const RESULT_MS = 2500;

type PersonaChoice = PersonaId | "mixed";

interface Stats {
  hands: number;
  net: number;
  rebuys: number;
}

interface Session {
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

function pickPersonas(choices: PersonaChoice[], rng: Rng): (PersonaId | null)[] {
  return choices.map((c, i) => (i === HERO ? null : c === "mixed" ? PERSONA_IDS[rng.int(PERSONA_IDS.length)] : c));
}

export default function PlayClient() {
  const [seats, setSeats] = useState(6);
  const [choices, setChoices] = useState<PersonaChoice[]>(() => new Array(8).fill("mixed"));
  const [session, setSession] = useState<Session | null>(null);
  // NEW SESSION wipes the stats, so it takes a second click.
  const [confirmNew, setConfirmNew] = useState(false);
  const rngRef = useRef<Rng | null>(null);

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
  };

  // Bots think for 400-900 ms; a finished hand stays up for RESULT_MS, then the next one is dealt.
  useEffect(() => {
    if (!session) return;
    const { hand } = session;
    const rng = rngRef.current!;
    if (hand.complete) {
      const t = setTimeout(() => {
        const seed = rng.nextU32();
        setSession((s) => (s === session ? nextHand(s, seed) : s));
      }, RESULT_MS);
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
  }, [session]);

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
  const toAct = model.toAct;
  const status = !session
    ? "PRESS DEAL"
    : hand!.complete
      ? "NEXT HAND…"
      : heroTurn
        ? "YOUR TURN"
        : toAct !== null
          ? `${model.seats[toAct].label} ${model.seats[toAct].name} TO ACT`
          : "";

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
        <span>S1</span>
        <span>YOU</span>
      </div>
      {Array.from({ length: seats - 1 }, (_, k) => k + 1).map((i) => (
        <label key={i} className="l field">
          <span>S{i + 1} BOT</span>
          <select
            value={choices[i]}
            onChange={(e) => {
              const v = e.target.value as PersonaChoice;
              setChoices((c) => c.map((x, j) => (j === i ? v : x)));
            }}
          >
            <option value="mixed">MIXED</option>
            {PERSONA_IDS.map((id) => (
              <option key={id} value={id}>
                {id.toUpperCase()}: {PERSONAS[id].name.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      ))}
      <Line gap>
        <BoxButton filled onClick={deal} onBlur={() => setConfirmNew(false)}>
          {!session ? "DEAL →" : confirmNew ? "CONFIRM — WIPES STATS →" : "NEW SESSION →"}
        </BoxButton>
      </Line>
      <Blank />
      <Rule />
      <Screen aria-label="Practice table">
        <TableHeader
          model={model}
          title="PRACTICE TABLE"
          mode={`LIVE  ${model.seated}/${model.capacity} SEATED`}
          right={status}
        />
        <PokerTable model={model} label={`Practice table, ${model.seated} seats`} />
        <PlayControls
          legal={legal}
          pot={model.pot}
          heroBet={hand ? hand.bets[HERO] : 0}
          stack={hand ? hand.stacks[HERO] : STACK}
          onAct={act}
        />
        <KeysLegend />
        <Line center gap>
          <span>ACTION</span>
        </Line>
        <ActionStrip strip={model.strip} />
        <StripLegend />
      </Screen>
      <Blank />
      <Line center>
        <span>SESSION</span>
      </Line>
      <Tx label="HANDS" value={fmt(stats.hands)} />
      <Tx label="NET CHIPS" value={<span className={tone(stats.net)}>{signed(stats.net, fmt(stats.net))}</span>} />
      <Tx label="BB/100" value={<span className={tone(bb100)}>{signed(bb100, bb100.toFixed(1))}</span>} />
      <Tx label="REBUYS" value={fmt(stats.rebuys)} />
      <Blank />
    </Sheet>
  );
}
