"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type Ref } from "react";
import { Legend, Line, Tag, TextButton } from "@/components/doc";
import { cx } from "@/components/doc/cx";
import type { Action } from "@/lib/engine/engine";
import { fmt } from "./model";
import { onScreen, revealTable } from "./reveal";

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
  /**
   * The pot a call plays for, the call included (`contestedPot`): less than `pot` + call when the call is
   * all-in for less. Default `pot` + call.
   */
  contestedPot?: number;
  /** The hero's bet on this street. */
  heroBet: number;
  /** The hero's chips behind. */
  stack: number;
  onAct: (action: Action) => void;
  /** A line drawn first in the dock, above the price line: the `StatusBlock`. */
  status?: ReactNode;
};

const PRESETS = [
  { label: "1/2 POT", frac: 1 / 2 },
  { label: "2/3 POT", frac: 2 / 3 },
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
  value = value.replace(/[^0-9]/g, "");
  const to = value === "" ? null : Number(value);
  if (to === null || to < legal.minRaiseTo) return { to: null, error: `MIN ${fmt(legal.minRaiseTo)}` };
  if (to > legal.maxRaiseTo) return { to: null, error: `MAX ${fmt(legal.maxRaiseTo)} (ALL-IN)` };
  return { to, error: null };
}

/**
 * The chips a call plays for, the call included: each seat's chips this hand capped at what the hero will
 * have in after calling, `Σ min(committed[j], committed[hero] + call)`. Equal to pot + call unless the call
 * is all-in for less than the bet; then the part of the bet the hero cannot match is left out.
 */
export function contestedPot(committed: readonly number[], hero: number, callAmount: number): number {
  const cap = committed[hero] + callAmount;
  return committed.reduce((t, c, j) => t + (j === hero ? cap : Math.min(c, cap)), 0);
}

/**
 * The price of a call in words: `TO CALL 300 INTO 1,200 → NEED 20.0% EQUITY`. `pot` already holds the bet
 * faced, so the equity needed is call / (pot + call), module 3's B / (P + 2B); `ratio` is the pot odds
 * (P + B) : B as `4 TO 1`. Null when there is nothing to call.
 */
export function priceLine(callAmount: number, pot: number): { short: string; text: string; need: number; ratio: string } | null {
  if (callAmount <= 0) return null;
  const need = (100 * callAmount) / (pot + callAmount);
  const x = pot / callAmount;
  const ratio = `${Number.isInteger(x) ? x : x.toFixed(1)} TO 1`;
  const short = `TO CALL ${fmt(callAmount)} INTO ${fmt(pot)} → NEED ${need.toFixed(1)}%`;
  return { short, text: `${short} EQUITY`, need, ratio };
}

/**
 * The raise field's value (digits only): `armed` once a size is chosen or typed (the filled default moves to
 * RAISE); `typed` while the user edits it, when it is shown without separators so the caret and Backspace
 * work on digits.
 */
type Draft = { decision: string; value: string; tried: boolean; select: number; armed: boolean; typed: boolean };

/**
 * The play lines under the table (DESIGN.md §5). Keys: F, C, R, Enter, Escape, and 1–4 outside the raise
 * field (in it, digits type). Buttons that do not apply are `aria-disabled` (not `disabled`) so focus stays
 * put after an action. The filled default is CHECK when free, else CALL; it moves to RAISE once a size is chosen.
 */
export function PlayControls({ legal, pot, contestedPot, heroBet, stack, onAct, status }: PlayControlsProps) {
  const ids = useId();
  const dockRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultRef = useRef<HTMLButtonElement>(null);
  // The raise draft resets to the min raise whenever a new decision comes up.
  const decision = legal ? `${legal.toCall}:${legal.minRaiseTo}:${legal.maxRaiseTo}:${pot}` : "none";
  const [stored, setStored] = useState<Draft>({ decision, value: "", tried: false, select: 0, armed: false, typed: false });
  const current = (d: Draft): Draft =>
    d.decision === decision
      ? d
      : { decision, value: legal?.canRaise ? String(legal.minRaiseTo) : "", tried: false, select: d.select, armed: false, typed: false };
  const draft = current(stored);
  // Functional, so two updates in one event (Esc, then the blur it causes) both land.
  const update = (d: Partial<Draft>) => setStored((s) => ({ ...current(s), ...d }));
  // Where the caret goes after an edit, in digits from the start (the field is redrawn without separators).
  const caretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = caretRef.current;
    caretRef.current = null;
    if (at !== null && inputRef.current === document.activeElement) inputRef.current?.setSelectionRange(at, at);
  });

  const canRaise = !!legal?.canRaise;
  // Separators except while the user is typing (then the caret and Backspace move over digits only).
  const shown = draft.typed || draft.value === "" ? draft.value : fmt(Number(draft.value));
  const check = legal && canRaise ? checkRaise(draft.value, legal) : null;
  // An out-of-range number is flagged as soon as it is typed; an empty field once a raise is tried.
  const error = check?.error && (draft.tried || draft.value !== "") ? check.error : null;

  /** Set the field to a preset and select it, so the next digit typed replaces it. */
  const choosePreset = (frac: number) => {
    if (!legal?.canRaise) return;
    update({ value: String(presetRaiseTo(legal, pot, heroBet, frac)), tried: false, select: draft.select + 1, armed: true, typed: false });
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
      // Nor while a dialog (a bot sheet) is open over the table: reading it must not fold.
      if (t?.closest?.("dialog")) return;
      if (keyRef.current(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [legal]);

  // When the hero's next decision comes up (unless focus has gone elsewhere): bring the table into view,
  // then focus the default action if it is on screen, without a second scroll.
  useEffect(() => {
    if (decision === "none") return;
    const a = document.activeElement;
    if (a && a !== document.body && !dockRef.current?.contains(a)) return;
    if (dockRef.current) revealTable(dockRef.current);
    const btn = defaultRef.current;
    if (btn && onScreen(btn)) btn.focus({ preventScroll: true });
  }, [decision]);

  // The price counts only the chips the call plays for (an all-in call for less leaves part of the bet out).
  const price = legal ? priceLine(legal.callAmount, contestedPot === undefined ? pot : contestedPot - legal.callAmount) : null;
  const selected = (frac: number) => !!check?.to && check.to === presetRaiseTo(legal!, pot, heroBet, frac);
  const verb = legal?.isBet ? "BET" : "RAISE TO";
  // The safe default takes focus; the filled box is the default until a raise size is chosen.
  const safe = legal?.canCheck ? "check" : legal?.canCall ? "call" : legal?.canFold ? "fold" : null;
  const filled = canRaise && draft.armed ? "raise" : safe;
  // The range and an error share one slot as wide as the longest error, so an error never reflows the line.
  const maxTo = legal?.canRaise ? legal.maxRaiseTo : heroBet + stack;
  const slotCh = `MAX ${fmt(maxTo)} (ALL-IN)`.length + 1;

  return (
    <div className="controls-dock" ref={dockRef}>
      {status}
      <Line>
        <span>
          {!legal ? (
            `POT ${fmt(pot)}`
          ) : price ? (
            <>
              {price.short}
              <span className="long">
                {" "}
                EQUITY ({price.ratio})
              </span>
            </>
          ) : (
            `NOTHING TO CALL · POT ${fmt(pot)}`
          )}
        </span>
        <span>STACK {fmt(stack)}</span>
      </Line>
      <form ref={formRef} className="l controls" onSubmit={submit} aria-label="Your action" tabIndex={-1}>
        <span className="cols">
          <Act
            filled={filled === "fold"}
            on={!!legal?.canFold}
            btnRef={safe === "fold" ? defaultRef : undefined}
            onClick={() => onAct({ type: "fold" })}
          >
            FOLD
          </Act>
          {legal?.canCall ? (
            <Act filled={filled === "call"} on btnRef={safe === "call" ? defaultRef : undefined} onClick={() => onAct({ type: "call" })}>
              CALL {fmt(legal.callAmount)}
            </Act>
          ) : (
            <Act
              filled={filled === "check"}
              on={!!legal?.canCheck}
              btnRef={safe === "check" ? defaultRef : undefined}
              onClick={() => onAct({ type: "check" })}
            >
              CHECK
            </Act>
          )}
          <span className="raise">
            <Act filled={filled === "raise"} on={canRaise} submit>
              {verb}
            </Act>
            <input
              ref={inputRef}
              id={`${ids}-amt`}
              className="u"
              inputMode="numeric"
              autoComplete="off"
              aria-label={legal?.isBet ? "Bet amount" : "Raise to amount"}
              aria-describedby={canRaise ? (error ? `${ids}-err` : `${ids}-range`) : undefined}
              aria-invalid={error ? true : undefined}
              aria-disabled={!canRaise || undefined}
              readOnly={!canRaise}
              value={shown}
              placeholder="____"
              onFocus={() => {
                if (canRaise && !draft.armed) update({ armed: true });
              }}
              onBlur={() => update({ typed: false })}
              onChange={(e) => {
                const raw = e.target.value;
                let value = raw.replace(/[^0-9]/g, "");
                let at = raw.slice(0, e.target.selectionStart ?? raw.length).replace(/[^0-9]/g, "").length;
                // Backspace / Delete on a separator removes the digit next to it.
                const del = (e.nativeEvent as InputEvent).inputType;
                if (value === draft.value && raw.length < shown.length) {
                  if (del === "deleteContentBackward" && at > 0) value = value.slice(0, --at) + value.slice(at + 1);
                  else if (del === "deleteContentForward") value = value.slice(0, at) + value.slice(at + 1);
                }
                caretRef.current = at;
                update({ value, tried: false, armed: true, typed: true });
              }}
              onKeyDown={(e) => {
                if (e.metaKey || e.ctrlKey || e.altKey) return;
                if (e.key === "Escape") {
                  // Back out: the safe default is filled and focused again.
                  e.preventDefault();
                  update({ armed: false });
                  (defaultRef.current ?? formRef.current)?.focus();
                } else if (/^[a-z]$/i.test(e.key)) {
                  // Letters never go in the field: F and C still fold / check-call from here.
                  e.preventDefault();
                  const k = e.key.toLowerCase();
                  if (k === "f" || k === "c") keyAction(k);
                }
              }}
            />
            <span className="slot" style={{ "--slot": `${slotCh}ch` } as CSSProperties}>
              {error ? (
                <Tag id={`${ids}-err`} className="err">
                  {error}
                </Tag>
              ) : legal?.canRaise ? (
                <span className="range" id={`${ids}-range`}>
                  {fmt(legal.minRaiseTo)}–{fmt(legal.maxRaiseTo)}
                </span>
              ) : null}
            </span>
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

/** Keyboard help under the controls; `extra` is appended (`N NEXT HAND` in solo). */
export function KeysLegend({ extra }: { extra?: string } = {}) {
  return (
    <Legend className="pre keys">
      <span>
        KEYS: F FOLD  C CHECK/CALL  1-4 SIZE  R TYPE AMOUNT  ENTER CONFIRM  ESC BACK{extra ? `  ${extra}` : ""}
      </span>
    </Legend>
  );
}
