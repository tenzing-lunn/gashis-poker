import type { PersonaId } from "@/lib/bots/personas";

/** Bot display names from persona ids: `TAG`, a second TAG becomes `TAG-2`. */
export function botNames(ids: readonly (PersonaId | null)[], heroName = "YOU"): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    if (id === null) return heroName;
    const base = id.toUpperCase();
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k === 1 ? base : `${base}-${k}`;
  });
}
