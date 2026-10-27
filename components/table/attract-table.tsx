"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Line, TextButton } from "@/components/doc";
import { applyAction, createHand, seatToAct, type HandState } from "@/lib/engine/engine";
import { PERSONA_IDS, PERSONAS, type PersonaId } from "@/lib/bots/personas";
import { chooseAction } from "@/lib/bots/policy";
import { botView } from "@/lib/bots/view";
import { createRng } from "@/lib/poker/cards";
import { ActionStrip, StripLegend } from "./action-strip";
import { modelFromHand } from "./model";
import { botNames } from "./names";
import { PokerTable } from "./poker-table";
import { TableHeader } from "./table-header";

const SEATS: PersonaId[] = [...PERSONA_IDS, "tag", "lag"];
const NAMES = botNames(SEATS);
const STACK = 10_000;
const STEP_MS = 900;
const RESULT_MS = 2500;
const SPEEDS = [1, 4, 8, 16] as const;

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeReduce = (cb: () => void) => {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const subscribeHidden = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};

interface Run {
  hand: HandState;
  handNo: number;
  button: number;
}

/**
 * Home page attract mode: eight bots playing each other, every hole card face down until showdown.
 * Runs only while the tab is visible and the table is on screen; starts paused under reduced motion.
 */
export function AttractTable() {
  // The first hand is fixed so server and client render the same table; later seeds come from the rng.
  const rngRef = useRef(createRng(20261027));
  const [run, setRun] = useState<Run>(() => ({
    hand: createHand({ stacks: new Array(SEATS.length).fill(STACK), button: 0 }, { seed: 1 }),
    handNo: 1,
    button: 0,
  }));
  // null = not chosen yet: paused exactly when reduced motion is on.
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const reduce = useSyncExternalStore(subscribeReduce, () => window.matchMedia(REDUCE).matches, () => false);
  const hidden = useSyncExternalStore(subscribeHidden, () => document.hidden, () => false);
  const [inView, setInView] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const paused = userPaused ?? reduce;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused || hidden || !inView) return;
    const rng = rngRef.current;
    const { hand } = run;
    const t = setTimeout(
      () => {
        if (hand.complete) {
          const stacks = hand.result!.finalStacks.map((x) => (x > 0 ? x : STACK));
          const button = (run.button + 1) % stacks.length;
          const next = createHand({ stacks, button }, { seed: rng.nextU32() });
          setRun((r) => (r === run ? { hand: next, handNo: run.handNo + 1, button } : r));
          return;
        }
        const seat = seatToAct(hand)!;
        const next = applyAction(hand, chooseAction(PERSONAS[SEATS[seat]], botView(hand, seat), rng).action);
        setRun((r) => (r === run ? { ...r, hand: next } : r));
      },
      (hand.complete ? RESULT_MS : STEP_MS) / speed,
    );
    return () => clearTimeout(t);
  }, [run, paused, hidden, inView, speed]);

  const model = useMemo(() => modelFromHand(run.hand, null, NAMES, { handNo: run.handNo }), [run]);

  return (
    <div ref={rootRef}>
      <TableHeader
        model={model}
        title="TABLE 0001"
        mode="AUTO"
        right={
          <>
            <TextButton onClick={() => setUserPaused(!paused)} aria-label={paused ? "Play" : "Pause"}>
              {paused ? "[PLAY]" : "[PAUSE]"}
            </TextButton>{" "}
            SPEED{" "}
            {SPEEDS.map((s) => (
              <TextButton
                key={s}
                className="lc"
                pressed={speed === s}
                onClick={() => setSpeed(s)}
                aria-label={`Speed ${s}x`}
              >
                {s}x
              </TextButton>
            ))}
          </>
        }
      />
      <PokerTable model={model} label="Eight bots playing each other" announce={false} />
      <Line center gap>
        <span>ACTION</span>
      </Line>
      <ActionStrip strip={model.strip} />
      <StripLegend />
    </div>
  );
}
