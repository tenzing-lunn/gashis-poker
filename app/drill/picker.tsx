"use client";

import Link from "next/link";
import type { Ref } from "react";
import {
  DIFFICULTY_LABELS,
  DRILL_INFO,
  DRILL_LABELS,
  DRILL_TYPES,
  START_HERE,
  type Difficulty,
  type DrillType,
} from "@/lib/drills/meta";
import { Blank, Choice, Tag, TextButton } from "@/components/doc";

const DIFFICULTIES = [1, 2, 3] as const;

/** `LESSON 02 →` to the lesson a drill comes from. */
export function LessonLink({ type }: { type: DrillType }) {
  const { slug, module } = DRILL_INFO[type].lesson;
  return (
    <Link href={`/learn/${slug}`} className="whitespace-nowrap">
      LESSON {String(module).padStart(2, "0")} →
    </Link>
  );
}

type PickerProps = {
  /** The type START would run (from the URL, else START_HERE). */
  selected: DrillType;
  difficulty: Difficulty;
  /** The type of the round on screen, running or over; null when no round is on screen. */
  active: DrillType | null;
  startRef: Ref<HTMLButtonElement>;
  /** Picks a drill without starting it. */
  onSelect: (type: DrillType) => void;
  onStart: (type: DrillType) => void;
  onDifficulty: (d: Difficulty) => void;
  onChange: () => void;
};

/**
 * The drill picker, read top to bottom: 1. pick a drill (a radio row each), 2. pick a level, 3. START. While a round is on
 * screen (running or its summary) the picker folds to one line, `DRILL  POT ODDS · EASY  [CHANGE ▸]`, so the
 * question sits high on the page; CHANGE ends the round and unfolds it.
 */
export function Picker({ selected, difficulty, active, startRef, onSelect, onStart, onDifficulty, onChange }: PickerProps) {
  if (active) {
    return (
      <div className="l field max-[679px]:flex!">
        {/* Phones drop the label so the line fits: POT ODDS · EASY  [CHANGE ▸]. */}
        <span className="max-[679px]:sr-only">Drill</span>
        <span className="flex flex-wrap gap-x-[2ch] uppercase">
          <span>
            {DRILL_LABELS[active]} · {DIFFICULTY_LABELS[difficulty]}
          </span>
          <TextButton className="-ml-[0.5ch]" onClick={onChange}>
            [Change ▸]
          </TextButton>
        </span>
      </div>
    );
  }
  return (
    <div className="pick">
      <div className="l uppercase">
        <span id="pick-drill">1. Pick a drill</span>
      </div>
      <ol role="radiogroup" aria-labelledby="pick-drill">
        {DRILL_TYPES.map((t) => (
          <li key={t} className="l">
            <label className="field pick-row">
              <span className="opt">
                <input type="radio" name="drill" checked={t === selected} onChange={() => onSelect(t)} />
                <span className="box" aria-hidden="true" />
                <span className="name">{DRILL_LABELS[t]}</span>
                {t === START_HERE && <Tag className="whitespace-nowrap">Start here</Tag>}
              </span>
              {/* Phones: the blurb sits under the name, and the lesson link is left to LEARN, so a row is two lines. */}
              <span className="flex flex-wrap justify-between gap-x-[2ch] max-[679px]:pl-[4ch]">
                <span className="text-muted uppercase">{DRILL_INFO[t].blurb}</span>
                <span className="max-[679px]:hidden">
                  <LessonLink type={t} />
                </span>
              </span>
            </label>
          </li>
        ))}
      </ol>
      <Blank />
      <div className="l field" role="radiogroup" aria-labelledby="pick-level">
        <span id="pick-level">2. Pick a level</span>
        <span className="opts">
          {DIFFICULTIES.map((d) => (
            <Choice key={d} name="difficulty" checked={d === difficulty} onChange={() => onDifficulty(d)}>
              {DIFFICULTY_LABELS[d]}
            </Choice>
          ))}
        </span>
      </div>
      <div className="l field">
        <span />
        <span className="text-muted">{DRILL_INFO[selected].levels[difficulty - 1]}</span>
      </div>
      <Blank />
      <div className="l field">
        <span>3. Go</span>
        <span>
          <button ref={startRef} type="button" className="apply cta" onClick={() => onStart(selected)}>
            Start: {DRILL_LABELS[selected]} · {DIFFICULTY_LABELS[difficulty]} →
          </button>
        </span>
      </div>
    </div>
  );
}
