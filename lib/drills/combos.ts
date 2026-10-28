// comboCount: combos left in a range after removing every combo that uses a dead card.
// Facts (3): Their range, You ("Not shown" at difficulty 2), Board ("None (preflop)" at difficulty 1).

import type { Rng } from "../poker/cards";
import { countCombos } from "../poker/range";
import type { Difficulty, Fact, Question } from "./types";
import {
  cardText,
  deal,
  hole,
  intIn,
  mistakesOf,
  pick,
  promptOf,
  randomRange,
  retry,
  showCards,
  type TokenStyle,
} from "./util";

export interface ComboCountParams {
  difficulty: Difficulty;
  /** Range notation, e.g. "QQ+, AKs, KTs-K8s". */
  range: string;
  /** Hero's hand, if it is among the dead cards. */
  hero: string | null;
  /** The board, if it is among the dead cards. */
  board: string | null;
  /** Every dead card: hero + board. */
  dead: string;
}

const STYLES: Record<Difficulty, TokenStyle[]> = { 1: ["single"], 2: ["single", "plus"], 3: ["single", "plus", "run"] };

export function genComboCount(rng: Rng, difficulty: Difficulty): Omit<Question<ComboCountParams>, "type" | "id"> {
  const { tokens, combos, hero, board, before, answer } = retry(() => {
    const count = difficulty === 1 ? intIn(rng, 1, 2) : difficulty === 2 ? intIn(rng, 2, 3) : intIn(rng, 2, 4);
    const { tokens, combos } = randomRange(rng, count, STYLES[difficulty]);
    const boardSize = difficulty === 1 ? 0 : difficulty === 2 ? 3 : pick(rng, [3, 4]);
    const withHero = difficulty !== 2;
    const dealt = deal(rng, (withHero ? 2 : 0) + boardSize);
    const hero = withHero ? hole(dealt.slice(0, 2)) : null;
    const board = boardSize ? dealt.slice(withHero ? 2 : 0) : null;
    const answer = countCombos(combos, dealt);
    // Only spots where card removal actually matters.
    return answer < combos.length ? { tokens, combos, hero, board, before: combos.length, answer } : null;
  });

  const dead = [...(hero ?? []), ...(board ?? [])];
  const range = tokens.join(", ");
  const perToken = tokens.map((t) => `${t} ${countCombos(t)}→${countCombos(t, dead)}`).join(", ");
  const facts: Fact[] = [
    { label: "Their range", value: range },
    { label: "You", value: hero ? showCards(hero) : "Not shown" },
    { label: "Board", value: board ? showCards(board) : "None (preflop)" },
  ];
  const ask = "How many combos of their range are left after removing every combo that uses a card you can see?";
  const candidates: [number, string][] = [
    [before, `You counted their range before card removal (${before}). Take out every combo that uses a card you can see: ${answer} left.`],
  ];
  if (hero && board) {
    const heroOnly = countCombos(combos, hero), boardOnly = countCombos(combos, board);
    if (heroOnly === boardOnly) {
      // Same count either way: name both slips rather than guess which one was made.
      candidates.push([heroOnly, `You removed only your cards' combos or only the board's (${heroOnly}). Remove both: ${answer} left.`]);
    } else {
      candidates.push(
        [heroOnly, `You removed combos that use your cards but not the board's (${heroOnly}). Board cards are dead too: ${answer} left.`],
        [boardOnly, `You removed combos that use board cards but not yours (${boardOnly}). Your cards are dead too: ${answer} left.`],
      );
    }
  }

  return {
    prompt: promptOf(facts, ask),
    facts,
    ask,
    params: {
      difficulty,
      range,
      hero: hero && cardText(hero),
      board: board && cardText(board),
      dead: cardText(dead),
    },
    answer,
    unit: "combos",
    tolerance: 0,
    explanation: `${perToken}: ${answer} combos left (${before} before card removal)`,
    mistakes: mistakesOf(answer, 0, candidates),
  };
}
