import type { Card as CardId } from "@/lib/poker/cards";
import { cx } from "@/components/doc/cx";
import { cardWords, rankText, suitGlyph } from "./model";

type CardProps = {
  /** A card id, "back" (face down) or "slot" (dashed empty place). */
  card: CardId | "back" | "slot";
  /** Mount animation: `deal` (drop in) or `flip` (showdown reveal). */
  anim?: "deal" | "flip";
  className?: string;
};

/** One card (DESIGN.md §4.3). Size comes from context: `.board .cd` is the large board card. */
export function Card({ card, anim, className }: CardProps) {
  if (card === "slot") return <span className={cx("cd slot", className)} aria-hidden="true" />;
  if (card === "back") return <span className={cx("cd back", anim, className)} role="img" aria-label="face-down card" />;
  return (
    <span className={cx("cd", anim, className)} role="img" aria-label={cardWords(card)}>
      <span aria-hidden="true">{rankText(card)}</span>
      <i aria-hidden="true">{suitGlyph(card)}</i>
    </span>
  );
}
