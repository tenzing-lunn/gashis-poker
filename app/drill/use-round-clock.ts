"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ROUND_MS } from "@/lib/drills/round";

// Impure: only called from handlers and the interval, never during render.
const now = () => Date.now();

/**
 * The round's countdown. `start()` (from an event handler) sets a fresh deadline; while `running`, the
 * remaining time is re-read from the clock 4 times a second and `onEnd` fires once it reaches 0.
 */
export function useRoundClock(running: boolean, onEnd: () => void) {
  const deadline = useRef(0);
  const [left, setLeft] = useState(ROUND_MS);
  const end = useEffectEvent(onEnd);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const l = Math.max(0, deadline.current - now());
      setLeft(l);
      if (l === 0) end();
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  function start() {
    deadline.current = now() + ROUND_MS;
    setLeft(ROUND_MS);
  }

  /** True once the deadline has passed, even before the next tick has ended the round. */
  function expired() {
    return now() >= deadline.current;
  }

  return { left, start, expired };
}

/** 107_000 → "1:47". */
export function clockText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
