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
import { Blank, Tag, TextButton } from "@/components/doc";

const DIFFICULTIES = [1, 2, 3] as const;

/** `LEARN 02 →` to the lesson a drill comes from. */
export function LessonLink({ type }: { type: DrillType }) {
  const { slug, module } = DRILL_INFO[type].lesson;
  return (
    <Link href={`/learn/${slug}`} className="whitespace-nowrap">
      LEARN {String(module).padStart(2, "0")} →
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
  onStart: (type: DrillType) => void;
  onDifficulty: (d: Difficulty) => void;
  onChange: () => void;
};

/**
 * The drill picker on the form-row grid. With no round on screen the DRILL row holds START. While a round is on
 * screen (running or its summary) the picker folds to one line, `DRILL  POT ODDS · EASY  [CHANGE ▸]`, so the
 * question sits high on the page; CHANGE ends the round and unfolds it.
 */
export function Picker({ selected, difficulty, active, startRef, onStart, onDifficulty, onChange }: PickerProps) {
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
    <>
      <div className="l field">
        <span>Drill</span>
        <span>
          <button ref={startRef} type="button" className="apply cta" onClick={() => onStart(selected)}>
            Start: {DRILL_LABELS[selected]} →
          </button>
        </span>
      </div>
      <div className="l field" role="group" aria-label="Difficulty">
        <span aria-hidden="true">Difficulty</span>
        <span className="opts">
          {DIFFICULTIES.map((d) => (
            <TextButton
              key={d}
              pressed={d === difficulty}
              className={d === 1 ? "-ml-[0.5ch]" : undefined}
              onClick={() => onDifficulty(d)}
            >
              {d} {DIFFICULTY_LABELS[d]}
            </TextButton>
          ))}
        </span>
      </div>
      <div className="l field">
        <span />
        <span className="text-muted">{DRILL_INFO[selected].levels[difficulty - 1]}</span>
      </div>
      <Blank />
      <ol aria-label="Drills, in lesson order">
        {DRILL_TYPES.map((t, i) => (
          <li key={t} className="l field">
            <span className="flex">
              <span className="w-[2ch] shrink-0" aria-hidden="true">
                {i + 1}
              </span>
              <TextButton className="-ml-[0.5ch] text-left whitespace-nowrap" pressed={t === selected} onClick={() => onStart(t)}>
                {DRILL_LABELS[t]}
              </TextButton>
            </span>
            <span className="flex flex-wrap justify-between gap-x-[2ch]">
              <span>
                {t === START_HERE && <Tag className="mr-[1ch] uppercase">Start here</Tag>}
                <span className="text-muted uppercase">{DRILL_INFO[t].blurb}</span>
              </span>
              <LessonLink type={t} />
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
