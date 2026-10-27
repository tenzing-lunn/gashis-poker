"use client";

import { useMemo, useState } from "react";
import { parseCards } from "@/lib/poker/cards";
import { exactEquity } from "@/lib/poker/equity";
import { Cards } from "../_components/lesson-ui";
import { Field, Legend, Line, Tag, TextButton } from "@/components/doc";
import { Row, WidgetFrame } from "../_components/widget-frame";
import { nextCardOuts, oneCard, twoCards } from "./outs-math";

const PRESETS = [
  { label: "Flush draw vs top pair, turn", hero: "9h8h", villain: "KcQd", board: "Kh7h2d3s" },
  { label: "Dirty outs: flush draw vs a set, turn", hero: "AhKh", villain: "8s8d", board: "8h7h2c5s" },
  { label: "Flush draw vs top pair, flop", hero: "9h8h", villain: "KcQd", board: "Kh7h2d" },
  { label: "Flush draw + an ace vs top pair, flop", hero: "Ah5h", villain: "KcQd", board: "Kh7h2d" },
  { label: "Flush draw + straight draw vs aces, flop", hero: "JhTh", villain: "AcAd", board: "9h8h2c" },
];

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

export function OutsVsEquity() {
  const [hero, setHero] = useState(PRESETS[0].hero);
  const [villain, setVillain] = useState(PRESETS[0].villain);
  const [board, setBoard] = useState(PRESETS[0].board);

  const r = useMemo(() => {
    try {
      const h = parseCards(hero), v = parseCards(villain), b = parseCards(board);
      if (h.length !== 2 || v.length !== 2) return { error: "Each hand needs exactly two cards." };
      if (b.length !== 3 && b.length !== 4) return { error: "Use a flop (3 board cards) or a turn (4 board cards)." };
      const all = [...h, ...v, ...b];
      if (new Set(all).size !== all.length) return { error: "The same card appears twice." };
      const eq = exactEquity([h, v], b).players[0];
      const outs = nextCardOuts(hero, villain, board);
      const o = outs.ahead.length;
      const estimate = b.length === 4 ? oneCard(o, outs.unseen) : twoCards(o, outs.unseen);
      const formula =
        b.length === 4 ? `${o} / ${outs.unseen}` : `1 − (${outs.unseen - o}/${outs.unseen}) × (${outs.unseen - 1 - o}/${outs.unseen - 1})`;
      return { error: null, eq, outs, o, estimate, formula, street: b.length === 4 ? "turn" : "flop" };
    } catch (e) {
      return { error: `${(e as Error).message}. Write cards like Ah 9c.` };
    }
  }, [hero, villain, board]);

  return (
    <WidgetFrame
      title="Outs vs real equity against a known hand"
      footer="Both hands are known here, so the unseen deck is 52 − 4 hole cards − the board (44 on the turn, 45 on the flop). Exact result: every possible runout enumerated."
    >
      <Line>
        <span className="flex flex-wrap gap-x-[1ch]">
          {PRESETS.map((p) => (
            <TextButton
              key={p.label}
              pressed={hero === p.hero && villain === p.villain && board === p.board}
              onClick={() => {
                setHero(p.hero);
                setVillain(p.villain);
                setBoard(p.board);
              }}
            >
              [{p.label}]
            </TextButton>
          ))}
        </span>
      </Line>
      <Field label="Your hand" value={hero} onChange={(e) => setHero(e.target.value)} spellCheck={false} />
      <Field label="Opponent's hand" value={villain} onChange={(e) => setVillain(e.target.value)} spellCheck={false} />
      <Field label="Board (3 or 4 cards)" value={board} onChange={(e) => setBoard(e.target.value)} spellCheck={false} />
      <div aria-live="polite">
        {r.error !== null ? (
          <Line>
            <Tag>{r.error}</Tag>
          </Line>
        ) : (
          <>
            <Line className="text-muted">
              <span>Right now you are {r.outs.now > 0 ? "ahead" : r.outs.now < 0 ? "behind" : "tied"}.</span>
            </Line>
            <Line>
              <span>
                <span className="inv">{r.o} outs</span> <span className="text-muted">(next cards that put you ahead):</span>
              </span>
            </Line>
            <Line>
              <span className="flex flex-wrap gap-1">{r.o > 0 ? <Cards hand={r.outs.ahead.join("")} /> : <span className="text-muted">none</span>}</span>
            </Line>
            {r.outs.tie.length > 0 && (
              <Line className="text-muted">
                <span>
                  Plus {r.outs.tie.length} card{r.outs.tie.length > 1 ? "s" : ""} that would tie: <Cards hand={r.outs.tie.join("")} />
                </span>
              </Line>
            )}
            <Row label="Outs estimate">
              <span className="text-muted">{r.formula}</span> {pct(r.estimate)}
            </Row>
            <Row label="Exact equity (all runouts)">
              <span className="inv">{pct(r.eq.equity)}</span>
            </Row>
            <Legend>
              <span>
                {r.street === "turn"
                  ? "With one card to come, an out either wins or it does not, so the outs count is exact when every out wins and nothing else does."
                  : "With two cards to come, the outs estimate misses runner-runner hands (two running cards that both help) and the opponent improving after you hit, so it can differ from the exact equity in either direction."}
              </span>
            </Legend>
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
