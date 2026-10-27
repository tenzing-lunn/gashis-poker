# Research — what to teach, how to train it, what code to learn from

Compiled 2026-10-26 from three web-research agents (strategy/math, trainer design, GitHub survey).
Numbers marked ✓ were re-derived by hand; ⚠ means secondary/commercial source, check in a solver before it goes in the app.

---

## 1. PurePoker is not a trainer

Every product called PurePoker is a place to *play*, not study:
- **Pure: Poker & Mahjong** (iOS, 4.7★ / ~8.1K ratings): no-rake social + real-money NLHE/PLO, private tables with
  friends, chat, hand replay. No stats or training tools. Reviewers like the soft, fast, rake-free tables and complain
  about suspected bots and collusion, misclick-prone "call any", and missing bet presets/notes.
  [App Store](https://apps.apple.com/us/app/pure-poker-mahjong/id6741335064)
- **PurePoker web** (US waitlist): rake-free real-money, promises future "tools that help players learn".
  [site](https://pure-poker.webflow.io/)

So the plan's "play vs bots + get graded" is *our* idea, not theirs. If what you liked was **playing with friends**,
that's a different (bigger) feature: realtime multiplayer needs a backend. See the open question in PLAN.md.

---

## 2. What to teach (the math spine)

### Course sequencing that already works
- **MIT 15.S50 Poker Theory & Analytics** (IAP 2015, [OCW](https://ocw.mit.edu/courses/15-s50-poker-theory-and-analytics-january-iap-2015/)):
  tools/stats → EV & pot odds → preflop ranges & push/fold → tournaments → economics → game theory (Bill Chen, SIG: toy games → regret matching → CFR) → decision-making.
- **CMU 15-888 Computational Game Solving** ([schedule](https://www.cs.cmu.edu/~sandholm/cs15-888F25/)): normal/extensive form → regret minimization → CFR → abstraction → Libratus → Pluribus. The CS track for the Lab.
- No dedicated Stanford poker course exists; trading firms frame it as "decisions under uncertainty" (SIG) and Jane Street uses its own game, Figgie, rather than poker.

### Formulas, each with one worked number
| Concept | Formula | Worked |
|---|---|---|
| Required equity to call | B / (P + 2B) | 50 into 100 → 25% ✓ |
| MDF / alpha | P/(P+B), B/(P+B) | 60% pot bet → MDF 62.5%, α 37.5% ✓ |
| Polarized bluff share | B / (P + 2B) | ⅓ pot 20% · ½ pot 25% · pot 33% · 2× pot 40% ✓ |
| Outs, two cards to come | 1 − C(47−o,2)/C(47,2) | 9 outs 35.0%, 15 outs 54.1%, 20 outs 67.5% ✓ |
| Rule of 4 patch (>8 outs) | 3·outs + 8 | 15 outs → 53% vs 4·15 = 60% ✓ |
| Implied odds needed | X = C(1−e)/e − P | 9 outs on turn, C=5, P=15 → X ≥ 5.6 ✓ |
| Geometric sizing | f = ((1 + 2S/P)^(1/n) − 1)/2 | P=100, S=300, 3 streets → 45.6% pot ✓ (one source says 55% — it's wrong) |
| Equity realization | EV ≈ equity × EQR × pot | 40% × 0.8 × 10bb = 3.2bb |
| SPR | stack ÷ pot on flop | SRP BTN vs BB ≈ 17.7; SB 3-bet pot ≈ 3.9 ✓ |
| AKQ half-street game | bluff Q at 1/(P+1); call K at P/(P+1) | pot-sized bet → both 50% ✓ |
| Kuhn poker | P1 bets J at α∈[0,⅓], K at 3α | game value −1/18 |
| Win-rate confidence | ±1.96·SD/√(hands/100) | SD 90: ±17.6 bb/100 at 10k hands; a 3 bb/100 winner needs ~346k hands to prove it ✓ |

Typical SD: ~90 bb/100 6-max (75–110), ~130 HU ⚠.

### Tactics, in priority order for a beginner (100bb 6-max)
1. **Position-based opens** ⚠: UTG ~15–18%, HJ ~19–22%, CO ~25–29%, BTN ~40–45%, SB disputed (35–44%). Open 2.5bb.
2. **3-bet or fold** out of position / from the SB; flat mostly in position. 3-bet size ~3× IP, ~4× OOP. Frequencies ⚠ unverified.
3. **C-bet by texture** ([GTO Wizard](https://blog.gtowizard.com/flop-heuristics-ip-c-betting-in-cash-games/)): dry/high/paired boards → bet often and small (~33%);
   connected/draw-heavy → bet less often, bigger; monotone → less and smaller. A-high gets bet *less* than K–8-high.
4. **Size by range shape**: small with a range advantage, big/overbet with a nut advantage and a polarized range.
5. **MDF is a ceiling, not a rule**: defend less vs underbluffers, out of position, and in value-heavy pools ([GTO Wizard](https://blog.gtowizard.com/mdf-alpha/)).
6. **Low-stakes exploits** ⚠: the pool calls too much preflop → value-bet thinner, bluff less; rivers are underbluffed (big river raises ≈ always value) → overfold;
   the pool overfolds to turn and triple barrels → barrel more. Both are true at once; which applies depends on the line, and that's worth teaching explicitly.

### Books / papers
Mathematics of Poker (Chen & Ankenman; toy games, the spine) · Modern Poker Theory (Acevedo; solver-era ranges) ·
Zinkevich 2007 (CFR) · Cepheus 2015 · DeepStack 2017 · Libratus 2018 · Pluribus 2019 · GTO Wizard blog (free applied heuristics).

---

## 3. How to train it (what actually makes people better)

- **Grade by EV loss with tiers, never right/wrong.** Leading trainers grade each action by EV lost (bb and % of pot) with tiers like
  best / correct / inaccuracy / mistake / blunder, and never call a solver mixed action "wrong". Right/wrong grading punishes correct mixes
  and treats a 0.01bb slip the same as a punt. ([GTO Wizard](https://help.gtowizard.com/measure-performance/))
- **Always say why.** The most common complaint about PokerSnowie and DTO: they tell you *what*, not *why*. Every verdict gets a concept tag + the math.
- **Glicko-2 ratings on both the player and every drill item** (as Lichess puzzles do), serving items at ~85% expected success,
  the learning sweet spot in [Wilson et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6831579). Hints reduce rating gain.
- **Spaced repetition (FSRS)** on every missed spot and concept card ([Anki docs](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm.md)).
- **Fixed-format timed sprints** like Zetamac (120 s, auto-submit) / Optiver 80-in-8 (wrong answers penalized), so scores compare over time and guessing doesn't pay.
- **Blocked practice, then interleaved**: learn one concept, then mix spots so you must *recognize* which concept applies ([Rohrer 2014](https://Www.Gwern.net/doc/psychology/spaced-repetition/2014-rohrer.pdf)).
- **Feedback modes**: immediate while learning; errors-only / end-of-session in test mode. Only unassisted answers count toward rating.
- **Leak dashboard**: EV loss by street, position and mistake type (too loose / tight / passive / aggressive), biggest leak first.
- **Simplified action sets for beginners** (fold / call / one raise size), expanding as rating climbs.
- **Session review** after bot play: best/worst hands, biggest leaks, replay, "try another line".
- **Unrated speed mode** (Storm/Rush style, ends at 3 mistakes) + daily streak for habit.

---

## 4. Code to learn from (GitHub, licenses verified via API)

### Decisions this changes
- **Evaluator: perfect-hash style (PHE / rank-key + flush-mask, ~100–500 KB tables), not Two Plus Two.**
  2+2 is only ~1.6× faster in V8 but needs a ~130 MB table per worker. The real speed win is *incremental* eval: precompute the board key, add two hole cards (11 ns/hand on a fixed river in poker-utils).
- **Engine oracle: pokerkit (Python, MIT).** Differential fuzzing: a Python script generates random action sequences through pokerkit → JSON →
  replay against our TS engine and diff pots, legal actions, min-raise at every step. Pokerkit implements WSOP Rule 96 (an incomplete all-in raise doesn't reopen betting).
- **Don't trust poker-ts as an oracle**: the agent found in its code that an incomplete all-in shrinks the min-raise and reopens action, and an open issue reports all-in players losing pot eligibility. Those are exactly the bugs our fuzz tests must catch in ours.
- **A real postflop solver *can* run in the browser.** wasm-postflop solves a flop 3-bet pot in 660 MB–1.25 GB, 21–93 s; river/turn spots with 1–2 sizes are far smaller (estimate, unverified).
  Needs COOP/COEP headers for threads. **But every open solver (postflop-solver, wasm-postflop, TexasSolver) is AGPL**: bundling one forces the whole app open-source under AGPL.
  → If we want it, write our own Discounted-CFR river solver from the papers (fits Phase 2C as a stretch), or precompute offline.
- **Push/fold: no good open-source solver exists.** Build it: 169×169 preflop equity matrix + fictitious play / CFR in a worker.
- **Bots: no repo solves "distinct styles".** Pattern: baseline policy + persona parameters (VPIP/PFR, 3-bet %, aggression, bluff ratio, sizing tells, tilt) + seeded noise. Add a "micro-stakes pool" persona modeled on the exploits in §2.

### Reference stack
| Use | Repo | License |
|---|---|---|
| Evaluator algorithm + fixtures | [HenryRLee/PokerHandEvaluator](https://github.com/HenryRLee/PokerHandEvaluator) (`test_data/`) | Apache-2.0 |
| TS patterns + V8 benchmarks | [conradbkay/poker-utils](https://github.com/conradbkay/poker-utils) | MIT |
| Monte Carlo over overlapping ranges | [zekyll/OMPEval](https://github.com/zekyll/OMPEval) | ISC |
| Engine oracle + real hand fixtures | [uoftcprg/pokerkit](https://github.com/uoftcprg/pokerkit), [phh-dataset](https://github.com/uoftcprg/phh-dataset) | MIT |
| CFR + exploitability, Kuhn/Leduc | [google-deepmind/open_spiel](https://github.com/google-deepmind/open_spiel) | Apache-2.0 |
| Equity cross-check | [andrewprock/pokerstove](https://github.com/andrewprock/pokerstove), [rundef/node-poker-odds-calculator](https://github.com/rundef/node-poker-odds-calculator) | BSD-3 / MIT |
| Bot patterns | [datamllab/rlcard](https://github.com/datamllab/rlcard), [dickreuter/neuron_poker](https://github.com/dickreuter/neuron_poker) | MIT |
| Solver internals (study only) | [b-inary/postflop-solver](https://github.com/b-inary/postflop-solver) | **AGPL** |
| Card art | [hayeah/playing-cards-assets](https://github.com/hayeah/playing-cards-assets) (public-domain art), [letele/playing-cards](https://github.com/letele/playing-cards) | MIT / CC0 |

### License rules for the build
- **Never copy or bundle**: anything AGPL (all open postflop solvers), GPL (dickreuter/Poker, JbCourtois/PokerTrainer), or unlicensed (Cactus Kev / Senzee / 2+2 code, chenosaurus/poker-evaluator).
  Unlicensed code may be used only as a local test oracle, never shipped.
- **Card art**: public-domain / CC0 only; skip the LGPL decks.
- **Avoid**: four "poker lab/arena" HTML repos the survey flagged as likely malware lures (throwaway accounts, ~55★, pushed in the last day).
  Never clone-and-run poker repos from unknown accounts.
