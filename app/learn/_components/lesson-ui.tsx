import type { ReactNode } from "react";
import { BoxButton, Line, Tag } from "@/components/doc";
import { parseCards, RANK_CHARS, rankOf, suitOf } from "@/lib/poker/cards";

// Shared building blocks for lessons. Every lesson can use these without importing them
// (they are passed to each MDX page through lessonComponents).

// Text variation selector (U+FE0E) so suits never render as emoji. Cards are ink: the glyph carries the suit.
const SUIT_SYMBOL = ["♣︎", "♦︎", "♥︎", "♠︎"];
const SUIT_NAME = ["clubs", "diamonds", "hearts", "spades"];
const RANK_NAME = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king", "ace"];
/** On cards the ten is written 10, not T (DESIGN.md §4.3). */
const rankText = (r: number) => (RANK_CHARS[r] === "T" ? "10" : RANK_CHARS[r]);

/** Renders cards as text tiles (no card art). Usage: <Cards hand="AhKs" /> or <Cards hand="Ah Ks 7d" />. */
export function Cards({ hand }: { hand: string }) {
  const cards = parseCards(hand);
  return (
    <span className="inline-flex flex-wrap gap-[0.5ch] align-baseline normal-case">
      {cards.map((c) => (
        <span key={c} aria-label={`${RANK_NAME[rankOf(c)]} of ${SUIT_NAME[suitOf(c)]}`} className="inline-block border border-ink bg-paper px-[0.4ch] leading-[1.3] text-ink">
          {rankText(rankOf(c))}
          {SUIT_SYMBOL[suitOf(c)]}
        </span>
      ))}
    </span>
  );
}

/** An aside with a title line. kind="key" for the main takeaway, "warn" for a common mistake. */
export function Callout({ kind = "note", title, children }: { kind?: "key" | "note" | "warn"; title?: string; children: ReactNode }) {
  return (
    <aside className="gap">
      {title && (
        <Line as="p" className="uppercase">
          <span>
            {kind === "key" ? (
              <span className="inv">Key · {title}</span>
            ) : kind === "warn" ? (
              <>
                <Tag>Watch out</Tag> {title}
              </>
            ) : (
              <>
                <span className="text-muted">Note ·</span> {title}
              </>
            )}
          </span>
        </Line>
      )}
      {children}
    </aside>
  );
}

/** A displayed formula. Write it in plain text: <Formula>required equity = B / (P + 2B)</Formula> */
export function Formula({ children }: { children: ReactNode }) {
  return (
    <div className="l c gap max-w-[72ch]">
      <span className="max-w-full px-[2ch] outline outline-faint -outline-offset-1">{children}</span>
    </div>
  );
}

/** A worked example, set apart from the prose. */
export function Example({ title = "Worked example", children }: { title?: string; children: ReactNode }) {
  return (
    <section className="gap">
      <Line as="p" className="uppercase">
        <span className="inv">{title}</span>
      </Line>
      {children}
    </section>
  );
}

/** Points the reader at the matching drill. Drills live at /drill (built separately). */
export function Practice({ drill, children }: { drill: string; children?: ReactNode }) {
  return (
    <aside className="gap">
      <Line as="p">
        <span className="uppercase">Practice: {drill}</span>
        <BoxButton href="/drill">Go to drills →</BoxButton>
      </Line>
      {children && (
        <Line as="div">
          <span className="max-w-[72ch] text-muted">{children}</span>
        </Line>
      )}
    </aside>
  );
}
