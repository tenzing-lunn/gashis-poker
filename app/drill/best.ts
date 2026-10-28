// Best round score per drill type and difficulty, kept in the browser. Best-effort: storage can be
// blocked, so every access is wrapped and the page works without it.

import type { Difficulty, DrillType } from "@/lib/drills/meta";

const key = (type: DrillType, difficulty: Difficulty) => `gp.drill.best.${type}.${difficulty}`;

export function loadBest(type: DrillType, difficulty: Difficulty): number | null {
  try {
    const n = Number(window.localStorage.getItem(key(type, difficulty)));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveBest(type: DrillType, difficulty: Difficulty, score: number): void {
  try {
    window.localStorage.setItem(key(type, difficulty), String(score));
  } catch {
    // Private mode or blocked storage: the round still ends with its score, it just isn't kept.
  }
}
