"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TextButton } from "@/components/doc";
import { reviewHand, type HandReview, type ReviewInput } from "@/lib/poker/hand-review";
import { popupSecondsLeft, RESULT_MS } from "./hand-read-model";
import { rankText, suitGlyph } from "./model";

/**
 * The review of a finished hand, worked out once per hand (exact equity on the flop or later takes a few ms): memoized on the input's
 * content, so a new snapshot of the same finished hand reuses it. `key` names the hand for the popup: the input
 * without the names, so someone sitting down or leaving between hands does not open the popup again.
 */
export function useHandReview(input: ReviewInput | null): { key: string | null; review: HandReview | null } {
  const json = input ? JSON.stringify(input) : null;
  const review = useMemo(() => (json ? reviewHand(JSON.parse(json) as ReviewInput) : null), [json]);
  const key = input ? JSON.stringify({ ...input, names: null }) : null;
  return { key, review };
}

type ResultPopupProps = {
  /** Null while no finished hand has a review (a hand running, watching): nothing is shown. */
  review: HandReview | null;
  /** Names the hand: a new key opens the popup again. */
  handKey: string | null;
  /** Left of `[CLOSE]`: NEXT HAND, or why there is none (`WAITING FOR THE HOST TO DEAL`). */
  next?: ReactNode;
};

/**
 * The end-of-hand popup over the middle of the felt (mount inside the table figure, `PokerTable` children).
 * Not modal: it never takes focus, it is read out once (a polite live region, set when it opens), and it closes
 * after `RESULT_MS`, on `[CLOSE]` or Esc, or when the next hand starts (`review` goes null). It is an overlay, so
 * closing it moves nothing under it.
 */
export function ResultPopup({ review, handKey, next }: ResultPopupProps) {
  const [closed, setClosed] = useState<string | null>(null);
  const [left, setLeft] = useState<{ key: string; secs: number } | null>(null);
  const open = !!review && handKey !== null && closed !== handKey;

  useEffect(() => {
    if (!open || handKey === null) return;
    const start = Date.now();
    const id = setInterval(() => {
      const secs = popupSecondsLeft(Date.now() - start);
      if (secs <= 0) setClosed(handKey);
      else setLeft({ key: handKey, secs });
    }, 250);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A native dialog (a bot sheet) closes itself on Esc.
      if ((e.target as HTMLElement | null)?.closest?.("dialog")) return;
      setClosed(handKey);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, handKey]);

  const secs = left && left.key === handKey ? left.secs : popupSecondsLeft(0, RESULT_MS);
  const said = open && review ? [review.headline, review.why, ...review.shown.map((s) => `${s.name}: ${s.hand}`), review.verdict?.text].filter(Boolean).join(". ") : "";

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {open && review ? (
        <div className="result-pop" role="dialog" aria-label="Hand result">
          <div>
            <div>
              <span className="inv">{review.headline}</span>
            </div>
            <div>{review.why}</div>
            {review.shown.map((s) => (
              <div key={s.seat} className="rp-hand">
                <span className="rp-name">{s.name}</span>
                <span className="rp-cards">{s.cards.map((c) => `${rankText(c)}${suitGlyph(c)}`).join(" ")}</span>
                <span>{s.hand}</span>
              </div>
            ))}
            {review.verdict ? <div>{review.verdict.text}</div> : null}
          </div>
          <div className="rp-foot">
            <span className="rp-acts">
              {next}
              <TextButton onClick={() => setClosed(handKey)}>[CLOSE]</TextButton>
            </span>
            <span className="text-muted" aria-hidden="true">
              CLOSES IN {secs} S
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
