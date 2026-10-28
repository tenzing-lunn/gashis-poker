import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Action } from "../engine/engine";
import { STATION, TAG, type Persona } from "../bots/personas";
import { LESSONS } from "../../app/learn/lessons";
import { gradeDecision } from "./grade";
import { scenario } from "./test-helpers";
import type { GradedOption, GradeResult } from "./types";
import { CONCEPTS, explain, formatEvBb, formatPct, type ConceptId, type Why } from "./why";

const BOARD = "Ks9d4c7h2s";
const HU_STEPS = ["raise", "call", "check", "bet33", "call", "check", "check", "check", "bet66"] as const;
/** Heads-up: the bot's button opens, the hero (big blind) calls, then steps 2..n-1 of HU_STEPS. */
const headsUp = (hero: string, n: number, board = BOARD, bot: Persona = TAG) =>
  gradeDecision(scenario([10_000, 10_000], 0, 1, hero, board, [bot, bot], HU_STEPS.slice(0, n)));

const riverFacingBet = headsUp("9h8h", 9); // middle pair vs a 66% river bet
const riverFirstMid = headsUp("9h8h", 7); // middle pair, first to act on the river
const riverFirstNuts = headsUp("KhKd", 7); // top set: the nuts on this board
const riverFirstAir = headsUp("5h3h", 7);
const riverFirstAirStation = headsUp("5h3h", 7, BOARD, STATION);
const flopFacingCbet = headsUp("9h8h", 4, BOARD.slice(0, 6));
const preflopFacingOpen = headsUp("9h8h", 1, "");
const riverBlocker = headsUp("Kh9h", 9, "Ks9d4c7h2c"); // two pair blocks the bot's Kx and 9x
const threeWay = gradeDecision(
  scenario([10_000, 10_000, 10_000], 0, 0, "Ah9h", BOARD.slice(0, 6), [TAG, TAG, STATION], ["raise", "call", "call", "check", "check"]),
);
const REAL: Record<string, GradeResult> = {
  riverFacingBet, riverFirstMid, riverFirstNuts, riverFirstAir, riverFirstAirStation, flopFacingCbet, preflopFacingOpen, riverBlocker, threeWay,
};

const byKind = (r: GradeResult, kind: GradedOption["kind"]) => r.options.findIndex((o) => o.kind === kind);
const byLabel = (r: GradeResult, label: string) => {
  const i = r.options.findIndex((o) => o.label.startsWith(label));
  if (i < 0) throw new Error(`No option ${label}`);
  return i;
};
const text = (w: Why) => w.sentences.join(" ");

describe("CONCEPTS: every lesson link resolves", () => {
  const contentDir = path.resolve(__dirname, "../../content");
  const files = readdirSync(contentDir);
  for (const [id, { lesson }] of Object.entries(CONCEPTS)) {
    it(`${id} → ${lesson.slug} § ${lesson.section}`, () => {
      const info = LESSONS.find((l) => l.slug === lesson.slug);
      expect(info, lesson.slug).toBeDefined();
      expect(info!.module).toBe(lesson.module);
      expect(info!.title).toBe(lesson.title);
      const file = files.find((f) => f === `${String(lesson.module).padStart(2, "0")}-${lesson.slug}.mdx`);
      expect(file, `content file for ${lesson.slug}`).toBeDefined();
      const headings = readFileSync(path.join(contentDir, file!), "utf8").split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
      expect(headings).toContain(lesson.section);
    });
  }
});

describe("formatting", () => {
  it("percents to one decimal, EVs signed with a real minus sign", () => {
    expect(formatPct(2 / 7)).toBe("28.6%");
    expect(formatPct(0.41)).toBe("41.0%");
    expect(formatPct(1)).toBe("100.0%");
    expect(formatEvBb(3.21)).toBe("+3.2 bb");
    expect(formatEvBb(-0.44)).toBe("−0.4 bb");
    expect(formatEvBb(-0.04)).toBe("0.0 bb");
    expect(formatEvBb(0)).toBe("0.0 bb");
  });
});

describe("explain on real graded spots: invariants", () => {
  for (const [name, r] of Object.entries(REAL)) {
    it(name, () => {
      expect(explain(r)).toEqual(explain(r, r.chosen ?? r.best));
      r.options.forEach((o, i) => {
        const w = explain(r, i);
        const all = [...w.sentences, w.verdict, w.caveat ?? ""].join(" ");
        expect(w.sentences.length, o.label).toBeGreaterThanOrEqual(1);
        expect(w.sentences.length, o.label).toBeLessThanOrEqual(2);
        for (const s of w.sentences) {
          expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(32);
          expect(s, s).toMatch(/^[A-Z].*\.$/);
        }
        expect(w.lesson).toBe(CONCEPTS[w.concept].lesson);
        expect(all).not.toMatch(/GTO|wrong/i);
        expect(all, "ASCII minus before a number").not.toMatch(/(^|[\s(])-\d/);
        expect(all, "raw fraction").not.toMatch(/\d\/\d|\b0\.\d{2,}/);
        const prose = r.options.reduce((t, x) => t.split(x.label).join("").split(x.label.charAt(0).toLowerCase() + x.label.slice(1)).join(""), all);
        for (const pct of prose.match(/\d+(\.\d+)?%/g) ?? []) expect(pct).toMatch(/^\d+\.\d%$/);
        expect(w.caveat !== null, `${name} caveat`).toBe(r.model === "ev-now");
        expect(w.also.includes("equity-realization")).toBe(r.model === "ev-now" && r.street !== "river");
        if (o.tier === "best" || o.tier === "correct") expect(w.verdict).toMatch(/^(Best|Correct): /);
        else expect(w.verdict).toMatch(new RegExp(`^[A-Z][a-z]+: −\\d+\\.\\d bb \\(\\d+\\.\\d% of the pot\\) vs ${escape(r.options[r.best].label)}$`));
      });
    });
  }
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("concept choice on real spots", () => {
  it("river facing a bet with a bluff-catcher: bluff-catching, equity vs the required equity", () => {
    const r = riverFacingBet;
    expect(r.model).toBe("exact");
    const w = explain(r, byKind(r, "fold"));
    expect(w.concept).toBe("bluff-catching");
    expect(w.lesson.section).toBe("The EV of calling a bluff-catcher");
    expect(text(w)).toContain(formatPct(r.requiredEquity!));
    expect(text(w)).toContain(formatPct(r.heroEquity));
    expect(text(w)).toContain(formatEvBb(r.options[byKind(r, "call")].evBb));
    expect(w.caveat).toBeNull();
  });

  it("flop facing a c-bet: pot odds, with the ev-now caveat", () => {
    const r = flopFacingCbet;
    const call = r.options[byKind(r, "call")];
    const w = explain(r, byKind(r, "call"));
    expect(w.concept).toBe("pot-odds");
    expect(w.sentences[0]).toBe(
      `You needed ${formatPct(r.requiredEquity!)} equity to call; against this range you have ${formatPct(call.showdownEquity)}, so calling earns ${formatEvBb(call.evBb)}.`,
    );
    expect(w.caveat).toMatch(/later betting/);
    expect(w.also).toContain("equity-realization");
  });

  it("preflop fold facing an open with a +EV call: pot odds at 30.0%", () => {
    const r = preflopFacingOpen;
    const w = explain(r, byKind(r, "fold"));
    expect(w.concept).toBe("pot-odds");
    expect(text(w)).toContain("You needed 30.0% equity to call");
    expect(text(w)).toContain("folding gives that up");
  });

  it("air on the river: bets are bluffs (alpha vs the fold rate); checking explained through the bluff", () => {
    const r = riverFirstAir;
    for (const o of r.options.filter((x) => x.kind === "bet")) expect(explain(r, r.options.indexOf(o)).concept).toBe("fold-equity");
    const pot = explain(r, byLabel(r, "Bet 100%"));
    expect(text(pot)).toContain("breaks even if the bot folds 50.0%");
    // Against a calling station the bluff fails and checking is best: affirm, never call it an error.
    const s = riverFirstAirStation;
    const check = explain(s, byKind(s, "check"));
    expect(s.options[s.best].kind).toBe("check");
    expect(check.concept).toBe("fold-equity");
    expect(check.verdict).toMatch(/^Best: /);
    expect(text(check)).toMatch(/folds only \d+\.\d%, so checking \(.+\) beats betting/);
  });

  it("the nuts on the river: value betting", () => {
    const r = riverFirstNuts;
    for (const o of r.options.filter((x) => x.kind !== "check")) {
      const w = explain(r, r.options.indexOf(o));
      expect(w.concept, o.label).toBe("value-betting");
      expect(text(w)).toContain("you win 100.0% at showdown");
    }
  });

  it("a medium hand ahead of the range but behind the calls: value betting, worse hands fold", () => {
    const r = riverFirstMid;
    expect(r.heroEquity).toBeGreaterThan(0.5);
    const bet = r.options[byLabel(r, "Bet 66%")];
    expect(bet.showdownEquity).toBeLessThan(0.5);
    expect(bet.ev).toBeLessThan(r.options[byKind(r, "check")].ev);
    const w = explain(r, r.options.indexOf(bet));
    expect(w.concept).toBe("value-betting");
    expect(text(w)).toContain("since worse hands fold");
    expect(explain(r, byKind(r, "check")).concept).toBe("value-betting");
  });

  it("a big blocker effect adds a blocker sentence", () => {
    const r = riverBlocker;
    const b = r.blockers[0];
    expect(b.blockedShare).toBeGreaterThan(1.3 * b.uniformShare);
    const w = explain(r, byKind(r, "call"));
    expect(w.also).toContain("blockers");
    expect(w.sentences[1]).toBe(
      `Blockers matter here: ${formatPct(b.blockedShare)} of the bot's likely hands use one of your cards, against ${formatPct(b.uniformShare)} for a random range.`,
    );
    expect(explain(riverFacingBet, 0).also).not.toContain("blockers");
  });

  it("multiway: speaks of the bots and everyone folding", () => {
    const r = threeWay;
    const bet = explain(r, byLabel(r, "Bet 33%"));
    expect(text(bet)).toMatch(/everyone folds|gets called/);
    expect(text(bet)).not.toContain("the bot ");
    expect(bet.caveat).not.toBeNull();
  });

  it("explaining a better option than the one asked about: the sentence opens by naming it", () => {
    for (const [name, r] of Object.entries(REAL)) {
      const best = r.options[r.best];
      const call = r.options.find((x) => x.kind === "call");
      r.options.forEach((o, i) => {
        const lost = o.tier === "inaccuracy" || o.tier === "mistake" || o.tier === "blunder";
        const aggressiveBest = best.kind === "bet" || best.kind === "raise" || best.kind === "allin";
        const passive = o.kind === "check" || o.kind === "call" || o.kind === "fold";
        const viaBest = passive && lost && aggressiveBest && !(o.kind === "fold" && call !== undefined && call.ev > 0);
        const first = explain(r, i).sentences[0];
        if (viaBest) {
          expect(first, `${name} ${o.label}`).toMatch(/^(Betting|Raising to|Going all-in) .+ was better: /);
          expect(first, `${name} ${o.label}`).toContain(formatEvBb(best.evBb));
        } else expect(first, `${name} ${o.label}`).not.toContain("was better");
      });
    }
    // Called a river bet when raising for value was best: name the raise, not "your raise".
    expect(explain(riverBlocker, byKind(riverBlocker, "call")).sentences[0]).toMatch(
      /^Raising to 24\.7 bb was better: when the bot calls, you win \d+\.\d% at showdown, so it earns \+\d+\.\d bb\.$/,
    );
    // Checked the nuts multiway when shoving was best.
    expect(explain(threeWay, byKind(threeWay, "check")).sentences[0]).toMatch(/^Going all-in \(97\.5 bb\) was better: when it gets called, /);
    // Checked air when the pot-size bluff was best.
    expect(explain(riverFirstAir, byKind(riverFirstAir, "check")).sentences[0]).toMatch(/^Betting 8\.3 bb was better: risking 8\.3 bb /);
  });

  it("preflop facing an open from the big blind: the raise risks only the chips added to the blind", () => {
    const r = preflopFacingOpen;
    expect(r.heroStreetBet).toBe(r.bigBlind);
    expect(text(explain(r, byLabel(r, "Raise to 4 bb")))).toMatch(/^Risking 3\.0 bb to win 3\.5 bb, /);
  });

  it("persona names replace 'the bot'", () => {
    const r = riverFirstAir;
    const w = explain(r, byLabel(r, "Bet 100%"), { personaNames: ["TAG", null] });
    expect(text(w)).toContain("breaks even if TAG folds 50.0%");
  });
});

// ---------------------------------------------------------------------------
// Hand-built results for edge cases.

function option(action: Action, label: string, kind: GradedOption["kind"], evBb: number, extra: Partial<GradedOption> = {}): GradedOption {
  return {
    action, label, kind, ev: evBb * 100, evBb, stdErr: 0, model: "exact", loss: 0, lossPct: 0, tier: "best",
    foldEquity: 0, responses: [], showdownEquity: NaN, ...extra,
  };
}

/** Fills loss / tier from the EVs (tiers given explicitly per option, best = argmax). */
function result(options: GradedOption[], over: Partial<GradeResult> = {}, tiers?: GradedOption["tier"][]): GradeResult {
  const pot = over.pot ?? 1000;
  let best = 0;
  options.forEach((o, i) => (o.ev > options[best].ev ? (best = i) : 0));
  options.forEach((o, i) => {
    o.loss = options[best].ev - o.ev;
    o.lossPct = o.loss / pot;
    o.tier = tiers?.[i] ?? (i === best ? "best" : "mistake");
  });
  return {
    street: "river", board: [], pot, toCall: 0, bigBlind: 100, heroSeat: 1, heroStreetBet: 0, requiredEquity: null, heroEquity: 0.3,
    heroEquityStdErr: 0, ranges: [{ seat: 0, persona: "tag", weights: new Float64Array(1326) }],
    blockers: [{ seat: 0, blockedShare: 0.08, uniformShare: 0.084 }], options, best, chosen: null, model: "exact", ...over,
  };
}

const folds = (p: number) => [
  { label: "Fold", action: { type: "fold" } as Action, prob: p },
  { label: "Call", action: { type: "call" } as Action, prob: 1 - p },
];

describe("explain on hand-built results", () => {
  it("verdict: loss in bb and share of the pot vs the best option", () => {
    const r = result(
      [option({ type: "fold" }, "Fold", "fold", 0), option({ type: "call" }, "Call (3.3 bb)", "call", 2.4, { showdownEquity: 0.41 })],
      { street: "flop", toCall: 330, requiredEquity: 330 / 1660, heroEquity: 0.41, pot: 2182 },
    );
    const w = explain(r, 0);
    expect(w.verdict).toBe("Mistake: −2.4 bb (11.0% of the pot) vs Call (3.3 bb)");
    expect(w.concept).toBe("pot-odds");
    expect(w.sentences[0]).toBe("You needed 19.9% equity to call; against this range you have 41.0%, so calling earns +2.4 bb and folding gives that up.");
    expect(explain(r, 1).verdict).toBe("Best: +2.4 bb");
  });

  it("a losing call: 'only', a signed negative EV, and folding costs nothing", () => {
    const r = result(
      [option({ type: "fold" }, "Fold", "fold", 0), option({ type: "call" }, "Call (5 bb)", "call", -1.09, { showdownEquity: 9 / 46 })],
      { street: "turn", toCall: 500, requiredEquity: 0.25, heroEquity: 9 / 46, pot: 1500 },
    );
    expect(explain(r, 0).sentences[0]).toBe("You needed 25.0% equity to call; against this range you have only 19.6%, so calling is worth −1.1 bb and folding costs nothing.");
    expect(explain(r, 1).verdict).toBe("Mistake: −1.1 bb (7.3% of the pot) vs Fold");
  });

  it("a near-tie is affirmed, not called an error", () => {
    const r = result(
      [
        option({ type: "check" }, "Check", "check", 2.0),
        option({ type: "raise", to: 660 }, "Bet 66% (6.6 bb)", "bet", 2.1, { showdownEquity: 0.45, responses: folds(0.3), foldEquity: 0.3 }),
      ],
      { heroEquity: 0.6 },
      ["correct", "best"],
    );
    const w = explain(r, 0);
    expect(w.verdict).toBe("Correct: +2.0 bb, 0.1 bb behind Bet 66% (6.6 bb)");
    expect(w.concept).toBe("value-betting");
    expect(w.sentences).toEqual(["You have 60.0% against the bot's range, but when the bot calls your bet 66% (6.6 bb) you win only 45.0%, so checking (+2.0 bb) is about as good as betting (+2.1 bb)."]);
  });

  it("a bluff that gets enough folds: alpha against the fold rate", () => {
    const r = result(
      [
        option({ type: "check" }, "Check", "check", 0),
        option({ type: "raise", to: 750 }, "Bet 75% (7.5 bb)", "bet", 2.125, { showdownEquity: 0, responses: folds(0.55), foldEquity: 0.55 }),
      ],
      { heroEquity: 0.05 },
    );
    const w = explain(r, 1);
    expect(w.concept).toBe("fold-equity");
    expect(w.lesson.section).toBe("The EV of a bluff");
    expect(w.sentences).toEqual(["Risking 7.5 bb to win 10.0 bb, a bluff breaks even if the bot folds 42.9%; it folds 55.0%, so the bet earns +2.1 bb."]);
    // Checking instead: the bet's reason, then the EV of the check the first sentence left out.
    const c = explain(r, 0);
    expect(c.concept).toBe("fold-equity");
    expect(c.sentences[1]).toBe("Checking is worth 0.0 bb.");
  });

  it("preflop big blind option: the raise risks only the chips added to the big blind", () => {
    const r = result(
      [
        option({ type: "check" }, "Check", "check", 0.5),
        option({ type: "raise", to: 400 }, "Raise to 4 bb", "raise", 0.9, { showdownEquity: 0.3, responses: folds(0.6), foldEquity: 0.6 }),
      ],
      { street: "preflop", pot: 200, heroStreetBet: 100, heroEquity: 0.45, model: "ev-now" },
    );
    const w = explain(r, 1);
    expect(w.sentences[0]).toBe("Risking 3.0 bb to win 2.0 bb, a bluff breaks even if the bot folds 60.0%; it folds 60.0%, so the raise earns +0.9 bb.");
    expect(w.caveat).toMatch(/checks down after this street/);
  });

  it("a raise facing a bet: alpha from the chips the raise adds; folding instead names the raise", () => {
    const r = result(
      [
        option({ type: "fold" }, "Fold", "fold", 0),
        option({ type: "call" }, "Call (5 bb)", "call", -1, { showdownEquity: 0.15 }),
        option({ type: "raise", to: 2000 }, "Raise to 20 bb", "raise", 1.5, { showdownEquity: 0.1, responses: folds(0.6), foldEquity: 0.6 }),
      ],
      { toCall: 500, requiredEquity: 0.25, heroEquity: 0.15, pot: 1500 },
    );
    const w = explain(r, 2, { personaNames: ["Maniac", null] });
    expect(w.concept).toBe("fold-equity");
    expect(w.sentences[0]).toBe("Risking 20.0 bb to win 15.0 bb, a bluff breaks even if Maniac folds 57.1%; it folds 60.0%, so the raise earns +1.5 bb.");
    // Folding a hand whose call loses, when a bluff-raise was best: explained through the raise, named first.
    const f = explain(r, 0);
    expect(f.concept).toBe("fold-equity");
    expect(f.sentences).toEqual([
      "Raising to 20 bb was better: risking 20.0 bb to win 15.0 bb, a bluff breaks even if the bot folds 57.1%; it folds 60.0%, so it earns +1.5 bb.",
      "Folding is worth 0.0 bb.",
    ]);
  });

  it("re-raising after the hero's own bet was raised: the risk excludes the hero's chips already in", () => {
    // Hero bet 3 bb into 10 bb, the bot raised to 8 bb: pot 21 bb, 5 bb to call. Re-raising to 20 bb adds 17 bb.
    const r = result(
      [
        option({ type: "fold" }, "Fold", "fold", 0),
        option({ type: "call" }, "Call (5 bb)", "call", -2, { showdownEquity: 0.1 }),
        option({ type: "raise", to: 2000 }, "Raise to 20 bb", "raise", 1, { showdownEquity: 0, responses: folds(0.5), foldEquity: 0.5 }),
      ],
      { toCall: 500, heroStreetBet: 300, requiredEquity: 500 / 2600, heroEquity: 0.1, pot: 2100 },
    );
    const alpha = 1700 / (2100 + 1700);
    expect(alpha * 2100).toBeCloseTo((1 - alpha) * 1700, 9); // f·pot = (1 − f)·B at the break-even fold rate
    expect(explain(r, 2).sentences[0]).toBe(
      `Risking 17.0 bb to win 21.0 bb, a bluff breaks even if the bot folds ${formatPct(alpha)}; it folds 50.0%, so the raise earns +1.0 bb.`,
    );
    expect(formatPct(alpha)).toBe("44.7%");
  });

  it("calling a river bet when raising for value was best: the raise is named first, then the call's EV", () => {
    const r = result(
      [
        option({ type: "fold" }, "Fold", "fold", 0),
        option({ type: "call" }, "Call (5.5 bb)", "call", 13.3, { showdownEquity: 0.9 }),
        option({ type: "raise", to: 2470 }, "Raise to 24.7 bb", "raise", 15.5, { showdownEquity: 0.796, responses: folds(0.2), foldEquity: 0.2 }),
      ],
      { toCall: 548, requiredEquity: 0.285, heroEquity: 0.9, pot: 1378 },
    );
    const w = explain(r, 1);
    expect(w.concept).toBe("value-betting");
    expect(w.sentences).toEqual(["Raising to 24.7 bb was better: when the bot calls, you win 79.6% at showdown, so it earns +15.5 bb.", "Calling earns +13.3 bb."]);
    expect(explain(r, 2).sentences[0]).toBe("When the bot calls your raise to 24.7 bb, you win 79.6% at showdown, so the raise earns +15.5 bb.");
  });

  it("blocker thresholds: well above a random range only", () => {
    const opts = () => [option({ type: "check" }, "Check", "check", 1), option({ type: "raise", to: 330 }, "Bet 33% (3.3 bb)", "bet", 0.5, { showdownEquity: 0.8 })];
    const hit = (blockedShare: number): ConceptId[] => explain(result(opts(), { blockers: [{ seat: 0, blockedShare, uniformShare: 0.084 }] }), 0).also;
    expect(hit(0.2)).toContain("blockers");
    expect(hit(0.1)).not.toContain("blockers");
    expect(hit(0.05)).not.toContain("blockers");
  });

  it("river ev-now (sampled multiway particles): the caveat is about noise, not later betting", () => {
    const r = result([option({ type: "check" }, "Check", "check", 1, { model: "ev-now" })], {
      model: "ev-now",
      ranges: [{ seat: 0, persona: "tag", weights: new Float64Array(1326) }, { seat: 2, persona: "nit", weights: new Float64Array(1326) }],
      blockers: [],
    });
    const w = explain(r, 0);
    expect(w.caveat).toMatch(/sampled/);
    expect(w.also).not.toContain("equity-realization");
    expect(w.concept).toBe("ranges");
    expect(w.sentences[0]).toBe("You have 30.0% against the bots' ranges, and checking earns +1.0 bb.");
  });

  it("uses the chosen option by default", () => {
    const r = result([option({ type: "check" }, "Check", "check", 1), option({ type: "raise", to: 330 }, "Bet 33% (3.3 bb)", "bet", 2, { showdownEquity: 0.8 })]);
    r.chosen = 0;
    expect(explain(r).verdict).toMatch(/^Mistake: /);
    expect(explain({ ...r, chosen: null }).verdict).toBe("Best: +2.0 bb");
  });
});
