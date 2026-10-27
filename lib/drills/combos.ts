// comboCount: combos left in a range after removing every combo that uses a dead card.

import type { Rng } from "../poker/cards";
import { countCombos } from "../poker/range";
import type { Difficulty, Question } from "./types";
import { cardText, deal, hole, intIn, pick, randomRange, retry, showCards, type TokenStyle } from "./util";

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
  const { tokens, hero, board, before, answer } = retry(() => {
    const count = difficulty === 1 ? intIn(rng, 1, 2) : difficulty === 2 ? intIn(rng, 2, 3) : intIn(rng, 2, 4);
    const { tokens, combos } = randomRange(rng, count, STYLES[difficulty]);
    const boardSize = difficulty === 1 ? 0 : difficulty === 2 ? 3 : pick(rng, [3, 4]);
    const withHero = difficulty !== 2;
    const dealt = deal(rng, (withHero ? 2 : 0) + boardSize);
    const hero = withHero ? hole(dealt.slice(0, 2)) : null;
    const board = boardSize ? dealt.slice(withHero ? 2 : 0) : null;
    const answer = countCombos(combos, dealt);
    // Only spots where card removal actually matters.
    return answer < combos.length ? { tokens, hero, board, before: combos.length, answer } : null;
  });

  const dead = [...(hero ?? []), ...(board ?? [])];
  const range = tokens.join(", ");
  const deadText = [hero && `your hand ${showCards(hero)}`, board && `the board ${showCards(board)}`]
    .filter(Boolean)
    .join(" and ");
  const perToken = tokens.map((t) => `${t} ${countCombos(t)}→${countCombos(t, dead)}`).join(", ");

  return {
    prompt:
      `Villain's range: ${range}. Dead cards: ${deadText}. How many combos of villain's range remain after ` +
      `removing every combo that uses a dead card?`,
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
    explanation: `${perToken}: ${answer} combos (${before} before card removal)`,
  };
}
