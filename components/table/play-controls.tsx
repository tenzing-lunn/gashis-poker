"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { Legend, Line, Tag, TextButton } from "@/components/doc";
import { cx } from "@/components/doc/cx";
import type { Action } from "@/lib/engine/engine";
import { fmt } from "./model";

/** What the hero may do. Engine `LegalActions` and the multiplayer `PublicLegal` both fit. */
export interface ControlsLegal {
  toCall: number;
  callAmount: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  isBet: boolean;
}

type PlayControlsProps = {
  /** The hero's options, or null when it is not the hero's turn (everything disabled). */
  legal: ControlsLegal | null;
  /** Everything in the middle, outstanding bets included (the awarded pot once the hand is over). */
  pot: number;
  /** The hero's bet on this street. */
  heroBet: number;
  /** The hero's chips behind. */
  stack: number;
  onAct: (action: Action) => void;
};

const PRESETS = [
  { label: "1/2", frac: 1 / 2 },
  { label: "2/3", frac: 2 / 3 },
  { label: "POT", frac: 1 },
  { label: "ALL-IN", frac: Infinity },
] as const;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Raise-to total for a fraction of the pot after calling, clamped to the legal range. */
export function presetRaiseTo(legal: ControlsLegal, pot: number, heroBet: number, frac: number): number {
  if (!legal.canRaise) return 0;
  if (!Number.isFinite(frac)) return legal.maxRaiseTo;
  const facing = heroBet + legal.toCall;
  return clamp(Math.round(facing + frac * (pot + legal.toCall)), legal.minRaiseTo, legal.maxRaiseTo);
}

/**
 * The typed raise amount checked against the legal range. Never clamped: an amount outside the range
 * is not submitted; the field says why (DESIGN.md §5).
 */
export function checkRaise(value: string, legal: ControlsLegal): { to: number | null; error: string | null } {
  const to = value === "" ? null : Number(value);
  if (to === null || to < legal.minRaiseTo) return { to: null, error: `MIN ${fmt(legal.minRaiseTo)}` };
  if (to > legal.maxRaiseTo) return { to: null, error: `MAX ${fmt(legal.maxRaiseTo)} (ALL-IN)` };
  return { to, error: null };
}

type Draft = { decision: string; value: string; tried: boolean; select: number };

/**
 * The play lines under the table (DESIGN.md §5). Keys: F, C, R, Enter, Escape, 1–4. Buttons that do not
 * apply are `aria-disabled` (not `disabled`) so focus stays put after an action.
 */
export function PlayControls({ legal, pot, heroBet, stack, onAct }: PlayControlsProps) {
  const ids = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultRef = useRef<HTMLButtonElement>(null);
  // The raise draft resets to the min raise whenever a new decision comes up.
  const decision = legal ? `${legal.toCall}:${legal.minRaiseTo}:${legal.maxRaiseTo}:${pot}` : "none";
  const [stored, setStored] = useState<Draft>({ decision, value: "", tried: false, select: 0 });
  const draft: Draft =
    stored.decision === decision
      ? stored
      : { decision, value: legal?.canRaise ? String(legal.minRaiseTo) : "", tried: false, select: stored.select };
  const update = (d: Partial<Draft>) => setStored({ ...draft, ...d });

  const canRaise = !!legal?.canRaise;
  const check = legal && canRaise ? checkRaise(draft.value, legal) : null;
  // An out-of-range number is flagged as soon as it is typed; an empty field once a raise is tried.
  const error = check?.error && (draft.tried || draft.value !== "") ? check.error : null;

  /** Set the field to a preset and select it, so the next digit typed replaces it. */
  const choosePreset = (frac: number) => {
    if (!legal?.canRaise) return;
    update({ value: String(presetRaiseTo(legal, pot, heroBet, frac)), tried: false, select: draft.select + 1 });
  };
  const selectTick = draft.select;
  useEffect(() => {
    if (selectTick === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [selectTick]);

  const raise = () => {
    if (!legal?.canRaise) return;
    const { to } = checkRaise(draft.value, legal);
    if (to !== null) onAct({ type: "raise", to });
    else update({ tried: true, select: draft.select + 1 });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    raise();
  };

  /** F / C / R / 1–4. Returns true when the key was used. */
  const keyAction = (k: string): boolean => {
    if (!legal) return false;
    if (k === "f" && legal.canFold) onAct({ type: "fold" });
    else if (k === "c" && legal.canCheck) onAct({ type: "check" });
    else if (k === "c" && legal.canCall) onAct({ type: "call" });
    else if (k === "r" && legal.canRaise) update({ select: draft.select + 1 });
    else if (k >= "1" && k <= "4" && k.length === 1 && legal.canRaise) choosePreset(PRESETS[Number(k) - 1].frac);
    else return false;
    return true;
  };
  const keyRef = useRef(keyAction);
  useEffect(() => {
    keyRef.current = keyAction;
  });

  useEffect(() => {
    if (!legal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      // The raise field handles its own keys; other fields keep theirs.
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (keyRef.current(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [legal]);

  // Back to the safe default when the hero's next decision comes up, unless focus has gone elsewhere.
  useEffect(() => {
    if (decision === "none") return;
    const a = document.activeElement;
    if (!a || a === document.body || formRef.current?.closest(".controls-dock")?.contains(a)) {
      defaultRef.current?.focus({ preventScroll: true });
    }
  }, [decision]);

  const odds = legal && legal.toCall > 0 ? `${((100 * legal.callAmount) / (pot + legal.callAmount)).toFixed(1)}%` : "--";
  const selected = (frac: number) => !!check?.to && check.to === presetRaiseTo(legal!, pot, heroBet, frac);
  const checkFree = !!legal?.canCheck;
  const verb = legal?.isBet ? "BET" : "RAISE TO";

  return (
    <div className="controls-dock">
      <Line>
        <span className="cols">
          <span>TO CALL {legal ? fmt(legal.toCall) : "--"}</span>
          <span>POT {fmt(pot)}</span>
          <span>POT ODDS {odds}</span>
        </span>
        <span>STACK {fmt(stack)}</span>
      </Line>
      <form ref={formRef} className="l controls" onSubmit={submit} aria-label="Your action" tabIndex={-1}>
        <span className="cols">
          <Act
            filled={!!legal?.canFold}
            on={!!legal?.canFold}
            btnRef={checkFree ? undefined : defaultRef}
            onClick={() => onAct({ type: "fold" })}
          >
            FOLD
          </Act>
          {legal?.canCall ? (
            <Act on onClick={() => onAct({ type: "call" })}>
              CALL {fmt(legal.callAmount)}
            </Act>
          ) : (
            <Act filled={checkFree} on={checkFree} btnRef={checkFree ? defaultRef : undefined} onClick={() => onAct({ type: "check" })}>
              CHECK
            </Act>
          )}
          <span className="raise">
            <Act on={canRaise} submit>
              {verb}
            </Act>
            <input
              ref={inputRef}
              id={`${ids}-amt`}
              className="u"
              inputMode="numeric"
              autoComplete="off"
              aria-label={legal?.isBet ? "Bet amount" : "Raise to amount"}
              aria-describedby={canRaise ? `${ids}-range${error ? ` ${ids}-err` : ""}` : undefined}
              aria-invalid={error ? true : undefined}
              aria-disabled={!canRaise || undefined}
              readOnly={!canRaise}
              value={draft.value}
              placeholder="____"
              onChange={(e) => update({ value: e.target.value.replace(/[^0-9]/g, ""), tried: false })}
              onKeyDown={(e) => {
                if (e.metaKey || e.ctrlKey || e.altKey) return;
                if (e.key === "Escape") {
                  e.preventDefault();
                  formRef.current?.focus();
                } else if (/^[a-z]$/i.test(e.key)) {
                  // Letters never go in the field: F and C still fold / check-call from here.
                  e.preventDefault();
                  const k = e.key.toLowerCase();
                  if (k === "f" || k === "c") keyAction(k);
                }
              }}
            />
            {legal?.canRaise ? (
              <span className="range" id={`${ids}-range`}>
                {fmt(legal.minRaiseTo)}–{fmt(legal.maxRaiseTo)}
              </span>
            ) : null}
            {error ? (
              <Tag id={`${ids}-err`} className="err">
                {error}
              </Tag>
            ) : null}
          </span>
        </span>
        <span className="presets">
          {PRESETS.map((p) => (
            <TextButton
              key={p.label}
              aria-disabled={!canRaise || undefined}
              pressed={canRaise ? selected(p.frac) : undefined}
              onClick={() => choosePreset(p.frac)}
            >
              {p.label}
            </TextButton>
          ))}
        </span>
      </form>
    </div>
  );
}

type ActProps = {
  children: ReactNode;
  /** Usable now; otherwise `aria-disabled` and inert. */
  on: boolean;
  filled?: boolean;
  submit?: boolean;
  btnRef?: Ref<HTMLButtonElement>;
  onClick?: () => void;
};

/** A boxed button (§3.4) that stays focusable while it does not apply. */
function Act({ children, on, filled, submit, btnRef, onClick }: ActProps) {
  return (
    <button
      ref={btnRef}
      type={submit ? "submit" : "button"}
      className={cx("apply", on && filled && "cta")}
      aria-disabled={!on || undefined}
      onClick={(e) => {
        if (!on) e.preventDefault();
        else onClick?.();
      }}
    >
      {children}
    </button>
  );
}

/** Keyboard help under the controls. */
export function KeysLegend() {
  return (
    <Legend className="pre keys">
      <span>KEYS: F FOLD  C CHECK/CALL  R RAISE  ENTER CONFIRM  ESC BACK  1-4 1/2 2/3 POT ALL-IN</span>
    </Legend>
  );
}
