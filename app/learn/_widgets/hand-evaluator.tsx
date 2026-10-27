"use client";

import { useMemo, useState } from "react";
import { createRng, formatCards, parseCards, rankOf, shuffle, type Card } from "@/lib/poker/cards";
import { evaluate, handCategory, type HandCategory } from "@/lib/poker/evaluator";
import { Cards } from "../_components/lesson-ui";
import { BoxButton, Field, Line, Tag } from "@/components/doc";
import { WidgetFrame } from "../_components/widget-frame";

const CATEGORY_LABEL: Record<HandCategory, string> = {
  "high card": "High card",
  pair: "One pair",
  "two pair": "Two pair",
  trips: "Three of a kind (trips)",
  straight: "Straight",
  flush: "Flush",
  "full house": "Full house",
  quads: "Four of a kind (quads)",
  "straight flush": "Straight flush",
};

interface Best {
  value: number;
  category: HandCategory;
  five: Card[];
}

/** The best five cards out of 5-7: the 5-card subset whose value equals the whole hand's value. */
function bestFive(cards: Card[]): Best {
  const value = evaluate(cards);
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            if (evaluate(five) === value) return { value, category: handCategory(value), five: orderFive(five, handCategory(value)) };
          }
  throw new Error("unreachable");
}

/** Orders five cards the way you would read them: bigger groups first, then higher ranks; a 5-high straight ends with the ace. */
function orderFive(five: Card[], category: HandCategory): Card[] {
  const count = new Map<number, number>();
  for (const c of five) count.set(rankOf(c), (count.get(rankOf(c)) ?? 0) + 1);
  const sorted = [...five].sort((x, y) => count.get(rankOf(y))! - count.get(rankOf(x))! || rankOf(y) - rankOf(x) || y - x);
  const ranks = sorted.map(rankOf).join(",");
  if ((category === "straight" || category === "straight flush") && ranks === "12,3,2,1,0") sorted.push(sorted.shift()!);
  return sorted;
}

/** Cards in the made part of each category (the rest are kickers). */
const MADE_CARDS: Partial<Record<HandCategory, { count: number; name: string }>> = {
  pair: { count: 2, name: "pair" },
  "two pair": { count: 4, name: "two pair" },
  trips: { count: 3, name: "three of a kind" },
  "full house": { count: 5, name: "full house" },
  quads: { count: 4, name: "four of a kind" },
};

/** Why one hand beats another in the same category. Both `five`s are ordered by orderFive. */
function sameCategoryReason(winner: Best, loser: Best): string {
  const cat = winner.category;
  if (cat === "straight" || cat === "straight flush") return "Same category, and the higher straight wins.";
  const made = MADE_CARDS[cat];
  if (!made) return "Same category, so compare the five cards from the highest down: the first higher card decides.";
  const w = winner.five.map(rankOf), l = loser.five.map(rankOf);
  const madeDiffers = w.slice(0, made.count).some((r, i) => r !== l[i]);
  return madeDiffers
    ? `Same category, and the higher ${made.name} wins.`
    : `Same category and the same ${made.name}, so the higher remaining cards (the kickers) decide.`;
}

function parse(text: string): Card[] {
  return text.trim() ? parseCards(text) : [];
}

export function HandEvaluator() {
  const [p1, setP1] = useState("AhKd");
  const [p2, setP2] = useState("KcJc");
  const [board, setBoard] = useState("Ks Qd 7c 7s 2h");

  const result = useMemo(() => {
    try {
      const h1 = parse(p1), h2 = parse(p2), b = parse(board);
      if (h1.length !== 2 || h2.length !== 2) return { error: "Each player needs exactly two hole cards, like AhKd." };
      if (b.length > 5) return { error: "The board has at most five cards." };
      const all = [...h1, ...h2, ...b];
      if (new Set(all).size !== all.length) return { error: "The same card appears twice. A deck has one of each card." };
      if (b.length < 3) return { error: null, board: b, players: null };
      return { error: null, board: b, players: [bestFive([...h1, ...b]), bestFive([...h2, ...b])] };
    } catch (e) {
      return { error: (e as Error).message + ". Write cards as rank then suit, like As, Td, 7h." };
    }
  }, [p1, p2, board]);

  function deal() {
    const deck = shuffle(Array.from({ length: 52 }, (_, i) => i), createRng((Math.random() * 2 ** 32) >>> 0));
    setP1(formatCards(deck.slice(0, 2)));
    setP2(formatCards(deck.slice(2, 4)));
    setBoard(formatCards(deck.slice(4, 9)).replace(/(..)(?!$)/g, "$1 "));
  }

  const players = result.players;
  let verdict: string | null = null;
  if (players && result.board && result.board.length === 5) {
    const [a, b] = players;
    if (a.value === b.value) verdict = "Split pot: both players' best five cards are equally strong.";
    else {
      const winner = a.value > b.value ? 1 : 2;
      const [w, l] = winner === 1 ? [a, b] : [b, a];
      verdict =
        w.category === l.category
          ? `Player ${winner} wins. ${sameCategoryReason(w, l)}`
          : `Player ${winner} wins with the higher category (${CATEGORY_LABEL[w.category].toLowerCase()}).`;
    }
  }

  return (
    <WidgetFrame
      title="Hand evaluator: best five of seven"
      footer="Computed with the course's 7-card evaluator. With fewer than five board cards it shows each player's best hand so far."
    >
      <Field label="Player 1 hole cards" value={p1} onChange={(e) => setP1(e.target.value)} spellCheck={false} />
      <Field label="Player 2 hole cards" value={p2} onChange={(e) => setP2(e.target.value)} spellCheck={false} />
      <Field label="Board (0–5 cards)" value={board} onChange={(e) => setBoard(e.target.value)} spellCheck={false} />
      <Line>
        <BoxButton filled onClick={deal}>
          Deal a random hand
        </BoxButton>
      </Line>
      <div aria-live="polite">
        {result.error ? (
          <Line>
            <Tag>{result.error}</Tag>
          </Line>
        ) : !players ? (
          <Line className="text-muted">
            <span>Add at least three board cards (the flop) to see each player&apos;s best five-card hand.</span>
          </Line>
        ) : (
          <>
            {players.map((p, i) => (
              <Line key={i}>
                <span className="uppercase">Player {i + 1}</span>
                <span className="flex flex-wrap items-center gap-x-[2ch]">
                  <Cards hand={formatCards(p.five)} />
                  <span className="uppercase">{CATEGORY_LABEL[p.category]}</span>
                </span>
              </Line>
            ))}
            {verdict ? (
              <Line>
                <span className="inv">{verdict}</span>
              </Line>
            ) : (
              <Line className="text-muted">
                <span>The river is not out yet, so nobody has won. Add board cards to reach five.</span>
              </Line>
            )}
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
