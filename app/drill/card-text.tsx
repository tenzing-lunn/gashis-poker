/**
 * Renders "A♥ K♦"-style cards inside text, kept in their own case and drawn in ink (suit carried by the glyph).
 * Display only: rank T is written 10, as on cards and in lessons (DESIGN.md §4.3).
 */
export function CardText({ text }: { text: string }) {
  return (
    <>
      {text.split(/([2-9TJQKA][♣♦♥♠])/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="whitespace-nowrap normal-case">
            {part[0] === "T" ? `10${part.slice(1)}` : part}
            {"︎"}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
