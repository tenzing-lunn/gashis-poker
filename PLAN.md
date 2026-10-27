# Gashi's Poker — Build Plan (draft for review)

A poker trainer built like a quant course: every decision at the table is tied to the number behind it.
You learn the math, drill it until it's fast, then use it in real hands against bots and get graded in big blinds of EV lost.

> **Scope note:** this is an original trainer, not a copy of PurePoker's screens, branding or content.
> Common trainer features (play bots, drills, hand review) are fair game; its specific look and lesson text are not.

---

## 0. Problems first

1. **True GTO for full No-Limit Hold'em can't be computed here.** Commercial solvers need precomputed
   databases of gigabytes. So the app is exact where exact is possible and approximate elsewhere, and says which:
   - **Exact:** hand odds, equity, combinatorics, pot odds/MDF, toy games (Kuhn, AKQ, [0,1] game),
     heads-up push/fold Nash (small enough to solve in the browser).
   - **Exact vs the bot, not vs "perfect play":** postflop grading. Because the bots are our own code, we know
     exactly what range a bot holds given its actions, so "EV of your call vs *this* opponent" is computable.
     That teaches exploitative thinking. It does not claim to be solver output.
   - **Heuristic:** preflop opening charts for 6-max (hand-built, labeled as a starting point).
2. **Bots will be beatable by a good player.** They are rule-based with distinct styles (nit, TAG, LAG,
   calling station, maniac). Good for learning; not a stand-in for strong online opponents.
3. **Not on your priority list in `1-Me.md`.** Fine — just flagging so it's a choice, not a drift.


---

## 1. What it is — four rooms

| Room | What you do | The math it trains |
|---|---|---|
| **Learn** | A 10-module course. Short lessons, each with a worked example and an interactive widget. | Derivations, not rules of thumb |
| **Drill** | Timed mental-math rounds (Zetamac-style), adaptive difficulty, spaced repetition on misses. | Speed: outs → equity, pot odds, combos, MDF, EV |
| **Play** | Heads-up and 6-max NLHE, 100bb cash, vs bots. Optional math HUD. "Coach mode" makes you estimate equity/odds before you act, then shows the truth. | Applying it under time pressure |
| **Lab** | Tools: equity calculator, range builder, Kuhn-poker CFR visualizer, push/fold solver, variance simulator. | Seeing the theory run |

Plus **Review** (every hand graded decision by decision, EV lost in bb, with the math shown) and
**Stats** (accuracy/speed per drill type, VPIP/PFR, *actual winnings vs all-in-EV winnings* — the luck/skill split).

---

## 2. Curriculum (Learn)

Each module: objective → derivation → worked example → interactive check → links to its drill.

0. **Rules & mechanics** — hand rankings, positions, blinds, betting rounds, side pots.
1. **Combinatorics** — 1326 starting hands = C(52,2); 169 classes (13 pairs, 78 suited, 78 offsuit);
   6 / 4 / 12 combos; card removal and blockers; counting combos in a range.
2. **Probability & outs** — exact outs math (hypergeometric), the rule of 2 and 4 and where it breaks
   (9 outs flop→river: 4×9 = 36% vs exact 1 − (38/47)(37/46) ≈ 35.0%).
3. **Pot odds & EV** — facing bet B into pot P: required equity = B / (P + 2B); EV of a call; implied and reverse implied odds.
4. **Equity & ranges** — hand vs range, range vs range, equity realization, why you never "put someone on a hand."
5. **Game theory with toy games** — Kuhn poker solved live with CFR (value to P1 = −1/18);
   AKQ game; bluff-to-value ratios; MDF = P / (P + B); a pure bluff needs folds B / (P + B).
6. **Preflop** — heads-up push/fold Nash (solved in-app); 6-max opening ranges by position.
7. **Postflop** — board texture, range advantage vs nut advantage, c-betting, polarized vs merged betting,
   geometric bet sizing (sizes that get stacks in by the river).
8. **Exploitation** — reading bot tendencies from stats, adjusting away from equilibrium and what it costs.
9. **Variance & bankroll** — standard deviation in bb/100, confidence intervals on win rate, sample size,
   risk of ruin, Kelly intuition. (The quant module.)

Tournament/ICM: deferred to v2.

---

## 3. Drill types (each generator returns question + exact answer + one-line explanation)

- Count outs on a board (with "dirty outs" variants)
- Outs → equity (one card / two cards to come)
- Pot odds → required equity %
- MDF and bluff-break-even % for a given bet size
- Count combos in a range after card removal
- EV of a call (given equity, pot, bet)
- Hand vs hand / hand vs range equity estimate (graded within a tolerance band)
- Speed round: call/fold with only the numbers shown

Scoring = accuracy × speed. Difficulty adapts per type. Misses go into a review queue.

---

## 4. Architecture

- **Next.js (App Router) + TypeScript + Tailwind**, all poker logic client-side. No backend in v1.
- **Storage:** local-first (Zustand persist for settings/progress, IndexedDB via Dexie for hand histories).
  Supabase accounts are a later add if you want sync.
- **Heavy compute in a Web Worker** (equity Monte Carlo, CFR, push/fold solver) so the UI never freezes.
- **Tests:** Vitest. The math core is pure functions, so it's fully testable.

```
lib/poker/     cards, deck, 7-card evaluator, range parser ("22+, ATs+, KQo"), combos, equity (exact + Monte Carlo)
lib/engine/    game state machine: blinds, betting rounds, min-raise rules, all-ins, side pots, showdown
lib/bots/      bot styles; each bot exposes its range so grading can compute EV vs it
lib/gto/       Kuhn CFR, AKQ game, heads-up push/fold Nash solver, best-response/exploitability
lib/drills/    question generators + answer checkers
lib/grading/   per-decision EV loss vs the bot's known range
content/       lessons (MDX) with embedded widgets
app/           /learn  /drill  /play  /review  /lab  /stats
workers/       equity.worker.ts, solver.worker.ts
```

The evaluator and equity engine are written from scratch, not pulled from a library — that's where a lot
of the CS lives (bit tricks, lookup tables, why exact enumeration on the flop is ~1k boards but preflop needs sampling).

---

## 5. Build phases, agents, and judges

### How the loop works
- **Builder agent** gets: the files it owns, the acceptance criteria below, nothing it doesn't need.
- **Judge agent** gets: the code and the criteria — *not* the builder's summary — and returns PASS/FAIL
  per criterion with evidence (test output, screenshot, worked recomputation).
- FAIL → builder fixes → judge re-checks. **Max 3 loops**, then it comes to me, and I bring it to you.
- I check every diff between phases. You get a working, runnable thing at the end of each phase.
- Parallel builders never share files.

### Phase 1 — Math core (1 builder, 1 math judge)
Scaffold Next.js + git init; build `lib/poker/`.
**Acceptance:**
- Enumerating all 2,598,960 five-card hands gives exactly: straight flush 40, quads 624, full house 3,744,
  flush 5,108, straight 10,200, trips 54,912, two pair 123,552, pair 1,098,240, high card 1,302,540.
- Seven-card enumeration (slow test) totals 133,784,560 with the known category counts.
- Equity: exact enumeration matches an independent evaluator the judge writes itself (Python) on 200 random spots;
  Monte Carlo within 0.5% at the configured sample size.
- Range parser round-trips; combo counts correct after card removal.
- Evaluator speed: ≥ 1M seven-card evals/sec in Node.

### Phase 2 — Four parallel workstreams (4 builders, judges per stream)
| Stream | Owns | Judge checks |
|---|---|---|
| **A. Game engine + bots** | `lib/engine/`, `lib/bots/` | Fuzz 100k random hands: chips conserved, no illegal actions, side pots correct; heads-up order (button = SB, acts first preflop, last postflop); short all-in doesn't reopen betting; each bot style is measurably different (VPIP/PFR/aggression) |
| **B. Drills** | `lib/drills/`, `/drill` | Judge re-derives the answer to 500 generated questions independently; zero mismatches |
| **C. Lab + game theory** | `lib/gto/`, `/lab` | Kuhn CFR → value −1/18, exploitability → 0; push/fold solver exploitability < 0.01 bb; variance sim matches analytic mean/SD |
| **D. Curriculum** | `content/`, `/learn` | Math judge recomputes every number in every lesson; pedagogy judge reads it as a beginner and flags any jump in logic |

### Phase 3 — Play, coach, review, stats (1–2 builders, engine + UX judges)
Table UI, HUD, coach mode, per-decision EV grading, hand history, stats dashboard.
**Acceptance:** UX judge plays 30 hands in the browser via screenshots and reports breakage;
grading judge hand-checks 20 graded decisions; all-in-EV vs actual results reconcile.

### Phase 4 — Design pass + deploy
One coherent look ("problem set meets trading desk": tabular numbers, quiet table, math front and center).
Mobile-usable. Deploy to Vercel. Final judge: full walkthrough as a new player, Learn → Drill → Play → Review.

---

## 6. Decisions I need from you (defaults in bold — I'll use them unless you say otherwise)

1. **What did you actually like about PurePoker?** I'm assuming "play hands vs bots and get feedback."
   If it's something specific (a drill, a review screen), tell me so it shapes the build.
2. Format focus: **100bb cash, heads-up + 6-max** / tournaments / both.
3. Accounts: **local-only v1** / Supabase login + sync from day one.
4. AI coach (Claude explaining your mistakes in words): **off for v1** — every explanation is computed, not generated.
5. Name: **Gashi's Poker**?
