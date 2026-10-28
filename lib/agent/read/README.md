# lib/agent/read: the Reader

Phase A of `plans/06-adaptive-agent.md`. The Reader watches finished hands and keeps a model of each opponent: how often they take each option in about fifteen common situations, with honest credible intervals, and which of the six bot personas (`lib/bots`) they play most like. Pure functions, seeded, no DOM. It reads `lib/engine`, `lib/poker` and `lib/bots` and changes none of them.

It uses only what a player at the table could know: the public event log of a finished hand (blinds, actions, deals, and the cards shown at a showdown) and, optionally, the observer's own hole cards. Players are named by a caller-supplied id per seat, so the same person can change seats between hands.

| File | What it does |
|---|---|
| `hand.ts` | `ObservedHand` (the Reader's whole input) and `observe(state, players, observerSeat?)` |
| `situations.ts` | The 15 situations, and `classifyHand`: each seat's situations and outcomes in one hand |
| `beta.ts` | Beta CDF (regularized incomplete beta) and quantile, exact to ~1e-12, no dependencies |
| `reads.ts` | Dirichlet posteriors, credible intervals, P(rate > t), comparison with a typical player (the population mean), sentences, `topReads` |
| `style.ts` | The style likelihood per hand and seat, the posterior over the six personas, its sentence |
| `reader.ts` | `createReader`, `addHand` (pure), and per-player reads and style |
| `truth.ts` | Measuring situation frequencies by simulation; the prior means |
| `population.ts` | Generated: every persona's situation counts (heads-up vs TAG, and 6-max) |
| `calibration.ts` | Each persona's true frequencies (`TRUTH_HU`), seeded sessions, interval coverage, and the style learning session |
| `scripts/measure.ts` | Writes `population.ts` (200,000 hands per persona heads-up, 200,000 6-max) |
| `scripts/calibrate.ts` | The full calibration run, pooled down to per (persona, situation) cells (results below) |
| `scripts/learning.ts` | The style learning-speed run (results below) |

## API

```ts
import { observe } from "@/lib/agent/read/hand";
import { createReader, addHand, playerRead, playerReads, playerStyle } from "@/lib/agent/read/reader";
import { describeRead, compareRead, readProbAbove } from "@/lib/agent/read/reads";

let reader = createReader();                                   // { epsilon: 0.01, players: {} }
reader = addHand(reader, observe(state, ["me", "bob"], 0));    // a finished hand; seat 0 is the observer (modeled from its own cards)
reader = addHand(reader, observe(state, [null, "bob"], 0));    // null: don't model that seat

const r = playerRead(reader, "bob", "vsFlopCbet", "fold");     // OutcomeRead
describeRead(r, "Bob");  // "After 23 flop c-bets faced, I'm 90% sure Bob folds between 48% and 79% of the time (best guess 64%)."
compareRead(r, "Bob");   // "I'm 85% sure Bob folds facing a flop c-bet more often than a typical player." (under k spots: "Only 2 of 4 spots needed to compare Bob with a typical player here.")
readProbAbove(r, 0.6);   // P(Bob's fold rate > 60%)
playerReads(reader, "bob", "Bob", { limit: 5 });  // the five most confident ways Bob differs from a typical player (situations seen ≥ k times)
playerStyle(reader, "bob", "Bob");  // { posterior, top: "station", sentence: "After 40 hands: 93% that Bob plays closest to a calling station (...)" }
```

- `observe(state: HandState, players: (string | null)[], observerSeat?: number): ObservedHand`. Copies the starting stacks, button, blinds and the event log of a complete hand, plus `observer` = `observerSeat` and `known` = the observer's hole cards. Nothing else of the state is read. The observer's seat can be modeled like any other (give it an id): for its style likelihood its known cards count as shown at showdown; for every other seat they are dead cards. Pass null for it to skip it.
- `classifyHand(hand): Observation[]`, each `{ seat, situation, outcome }` (indices into `SITUATIONS`).
- `createReader({ epsilon? }): Reader`; `addHand(reader, hand): Reader` returns a new Reader and never mutates its input; `playerModel(reader, id): PlayerModel` is `{ hands, counts[situation][outcome], styleLogLik[persona] }`.
- `readOutcome(counts, situation, outcome, { k?, level? }): OutcomeRead` is `{ n, count, a, b, mean, lo, hi, level, shape, typical, pAboveTypical, k, tooFew }` (`typical` is the population mean μ, `tooFew` is n < k, below); `playerRead(reader, id, situationId, outcomeName, options)` looks it up by name.
- `describeRead(read, name)`, `compareRead(read, name)`, `readProbAbove(read, t)`, `probAbove(t, a, b)`, `credibleInterval(a, b, level, shape)`.
- `topReads(counts, name, { k?, level?, limit? }): RankedRead[]` and `playerReads(reader, id, name, options)`: every outcome of every situation seen at least k times, ranked by `max(P(above typical), P(below typical))`, each with both sentences (empty until some situation has been seen k times).
- `styleLogLikelihoods(hand, seat, epsilon?, decisions?): number[]` (per persona, `PERSONA_IDS` order), `comboWeights(persona, decisions, seat, dead, epsilon)`, `stylePosterior(logLik)`, `rankStyles`, `describeStyle(posterior, hands, name)`, `playerStyle(reader, id, name)`.
- `betaCdf(x, a, b)`, `betaQuantile(p, a, b)`, `logGamma(x)`.

`k` (prior weight, default 4) and `level` (default 0.9) are chosen when reading, since the stored counts don't depend on them. `epsilon` (the style tremble, default 0.01) is fixed per Reader because it enters the stored log-likelihoods.

## Situations

Each situation is a kind of decision with mutually exclusive outcomes, defined only from public facts at the player's own decision point. A player meets each situation at most once per hand: the first decision that fits. Hands are independent, so each observation is an independent draw from the player's outcome frequencies in that situation, which is what makes the counting below exact.

| Id | When | Outcomes |
|---|---|---|
| `openEarly` | Preflop, nobody has called or raised yet, the player is UTG, MP, LJ or HJ | raise / limp / fold |
| `openLate` | Same, on the CO or BTN (heads-up the button is BTN) | raise / limp / fold |
| `openSmallBlind` | Same, in the small blind (3+ players) | raise / limp / fold |
| `bbVsLimp` | Big blind, someone limped, nobody raised | raise / check |
| `vsOpen` | Facing exactly one raise, first voluntary action of the hand | 3-bet / call / fold |
| `vs3bet` | The opener, first facing exactly two raises | 4-bet / call / fold |
| `flopCbet` | First flop action with no bet yet, as the preflop raiser (last preflop aggressor) | bet / check |
| `flopStab` | First flop action with no bet yet, not the preflop raiser (includes limped pots and donk leads) | bet / check |
| `vsFlopCbet` | First response to an unraised flop bet by the preflop raiser | fold / call / raise |
| `turnBarrel` | First turn action with no bet yet, having c-bet the flop and been its last aggressor | bet / check |
| `vsTurnBarrel` | First response to an unraised turn bet by the player who c-bet the flop and was its last aggressor | fold / call / raise |
| `riverBet` | River bet when first to act or checked to: the player's first river action with no bet yet. Out-of-position leads and bets after a check are counted together | bet / check |
| `vsRiverBet` | First response to an unraised river bet | fold / call / raise |
| `riverBluff` | The player bet in `riverBet` and their cards were shown at showdown | bluff / value |
| `showdown` | The player saw the flop (not folded when it was dealt) | showdown / no showdown |

- **Bluff.** A shown river bet is a bluff when the hand's strength percentile on the final board (`lib/bots/features.ts`: the share of other live combos it beats, ties half) is below `BLUFF_LINE = 0.5`, else value.
- **Selection bias of `riverBluff`.** Only river bets that reach showdown are ever shown: a bet that wins at once is never seen, and a bluff that is raised and folds is never seen either. So the rate is "bluffs among river bets that got to showdown", not the bluff share of all river bets (raises hide more bluffs than value). Heads-up the caller's decision depends on the caller's cards, not the bettor's, so the bias there is mostly the raise-and-fold case. The calibration truth is measured the same way, so the interval is honest about what it estimates.
- Not tracked: limping behind limpers, cold-calling a 3-bet, 4-bets and up, raises after a check (check-raise as its own spot), multiway responses beyond the first bet. They are rarer and can be added the same way.

## The population prior

The prior mean μ of a situation is the plain average over the six personas of their true outcome frequencies. Frequencies depend on the table, so the setup is fixed and named (`truth.ts`):

- **Heads-up** (primary): the persona in seat 0 against TAG, 100 bb stacks reset every hand, button alternating; 200,000 hands per persona.
- **6-max**: one of each persona, reseated every hand; 200,000 hands. Used only for situations that heads-up play doesn't produce for some persona at least 200 times: `openEarly`, `openSmallBlind` (those positions don't exist heads-up) and `bbVsLimp` (TAG never limps, so nobody faces a limp).

The prior is therefore tuned for heads-up. At a 6-max table it is a reasonable starting point (it moves out of the way after tens of observations) but not the population mean of that table.

`scripts/measure.ts` writes the counts to `population.ts` (~70 s on 7 worker threads). `reader.test.ts` regenerates them on a smaller seeded sample (4,000 heads-up hands per persona, 3,000 6-max hands) and fails if any frequency, or any prior mean, moves by more than 4.5 standard errors, or a true zero stops being zero. The failure message says to rerun the script.

Prior means (heads-up unless marked):

| Situation | μ |
|---|---|
| openEarly (6-max) | raise .220 / limp .106 / fold .674 |
| openLate | raise .561 / limp .066 / fold .374 |
| openSmallBlind (6-max) | raise .361 / limp .130 / fold .509 |
| bbVsLimp (6-max) | raise .124 / check .876 |
| vsOpen | 3-bet .077 / call .665 / fold .258 |
| vs3bet | 4-bet .048 / call .294 / fold .658 |
| flopCbet | bet .561 / check .439 |
| flopStab | bet .326 / check .674 |
| vsFlopCbet | fold .596 / call .331 / raise .072 |
| turnBarrel | bet .554 / check .446 |
| vsTurnBarrel | fold .642 / call .313 / raise .044 |
| riverBet | bet .227 / check .773 |
| vsRiverBet | fold .667 / call .285 / raise .049 |
| riverBluff | bluff .197 / value .803 |
| showdown | showdown .302 / no .698 |

## Reads: the math

For one situation with outcome frequencies p = (p_1..p_m), the prior is Dirichlet(k·μ): worth k pseudo-observations at the population mean. After counts x the posterior is Dirichlet(α), α_i = k·μ_i + x_i, and each rate alone is Beta(α_i, α_0 − α_i).

- **Best guess**: the posterior mean α_i / α_0.
- **Credible interval** at level 90%: equal-tailed, from exact Beta quantiles (`beta.ts`: the regularized incomplete beta by its continued fraction, a Lanczos log-gamma, and a bracketed Newton inverse), with one deliberate deviation at the boundary. If the outcome has been seen 0 times in n ≥ 1 tries the interval is one-sided, [0, q(0.90)] ("at most"); if it was seen every time, [q(0.10), 1] ("at least"). Both still hold 90% of the posterior, but they are not equal-tailed. Why: some personas truly never take some actions (a nit never limps, a station never folds to an open heads-up), and an equal-tailed interval never contains 0, so it would exclude a true zero forever, however many hands are seen. This is the boundary rule Brown, Cai and DasGupta (2001) recommend for the Jeffreys interval, with the open end's quantile moved so the mass stays 90%. The calibration below reports coverage both ways: the shipped intervals, and strictly equal-tailed ones (87.3% / 88.5% / 87.0% at 25 / 100 / 400 hands in our run).
- **P(rate > t)** = 1 − I_t(α_i, α_0 − α_i).
- **A typical player** is the population mean μ_i. "I'm 85% sure Bob folds facing a flop c-bet more often than a typical player" means P(Bob's rate > μ_i) = 0.85. Until the situation has been seen k times (n < k, `tooFew`) the sentence instead says there are too few spots to compare yet ("Only 2 of 4 spots needed to compare Bob with a typical player here."): with little data the skewed prior alone would sway P(rate > μ_i).
- **Most unusual reads** (`topReads`): every outcome (two-outcome situations once) of every situation seen at least k times, ranked by max(P(above typical), P(below typical)). The n ≥ k rule is the same as `tooFew`: the player's own observations weigh at least as much as the prior. Before any situation has been seen k = 4 times (so always within the first 3 hands, since a situation is met at most once per hand) the list is empty.

**Why k = 4.** The intervals are Bayesian; against a fixed persona they are calibrated only if the prior's spread roughly matches how far real players sit from the mean. Too weak a prior (k ≤ 2) leaves small-count intervals of rare outcomes unsteady and coverage falls to 80–86% by 400 hands; too strong a prior (k ≥ 8) overrules the data on players far from average early on (84–88% at 25 hands). k = 3, 4 and 5 all land inside 87–93% at every checkpoint; 4 is the middle (table below).

## Style: the math

For one hand and one seat, the likelihood of the seat's actions under persona p is

```
L_p = (1/|C|) Σ_{c ∈ C} Π_d q_p(a_d | c)     cards not shown
L_p = Π_d q_p(a_d | c*)                      cards c* shown at showdown

q_p(a | c) = (1 − ε) Σ_{x ∈ M_p(a)} P_p(x | c) + ε / K_p
```

- C is every combo using no final-board card and no card the observer knows (its own hole cards and other seats' shown cards); d runs over the seat's decisions, rebuilt from the public history with `replay`. The observer's own seat is scored like a shown seat, with c* its known hole cards.
- P_p(x | c) is p's probability of abstract action x with combo c (`comboDistribution`, the row `strategyAt` returns). M_p(a) is the set of abstract actions whose engine action under p is the nearest to the observed one: the same action when p has it (several abstract actions can map to one engine action, and they are summed exactly as `inferRange` does), otherwise, for an odd bet or raise size, p's bet or raise with the closest raise-to total in chips (ties to the smaller). So a human's 2.2× open counts as p's open whatever p's size. This throws away sizing information: personas are told apart by what they do, not by how much they bet.
- ε = 1% is a tremble: with probability ε the player picks uniformly among p's K_p distinct legal engine actions. It keeps one action p never takes (a limp from a nit) from zeroing p for good: one such action costs p a factor of roughly ε/K ≈ 1/400 against a persona that takes it, which a few dozen ordinary hands can outweigh. With ε = 0 and actions p does take, the combo weights Π_d q_p(a_d | c) normalized are exactly `inferRange(p, history, seat, { dead })`.
- Hands are independent, so log L_p adds across hands; with a uniform prior over the six, P(p | hands) ∝ exp(Σ log L_p). The sum is kept in log space.
- Card removal from other unshown players' actions is ignored, as `inferRange` does.
- For a person this is the **closest** of six styles, not a claim that they are one, and the sentence says so: "After 40 hands: 93% that Bob plays closest to a calling station (the closest of six bot styles; a person may not play exactly like any of them)." Against a real person the posterior will still concentrate on one style; how well that style predicts them is what the situation reads are for.

Cost: about 0.25 ms per persona per decision, so ~2.5 ms per heads-up hand per modeled seat.

## Calibration

`scripts/calibrate.ts` (1,000 sessions per persona; ~60 s on 8 worker threads). The numbers below are from our own run of it after the typical-player and observer-seat changes, which don't touch the intervals, so they are the same as before those changes. Truth is each persona's frequencies heads-up vs TAG from `population.ts` (200,000 hands, seeds disjoint from the sessions). A session is 400 seeded heads-up hands of the persona against TAG; at 25, 100 and 400 hands, every situation the persona has met at least once gives one statement per outcome (two-outcome situations once: the second interval mirrors the first). A statement is covered when lo ≤ truth ≤ hi. Coverage is pooled over all personas and statements.

**Pooled coverage** of the 90% intervals, with the boundary rule (the shipped intervals) and strictly equal-tailed:

| k | 25 hands | 100 hands | 400 hands | strict equal-tailed: 25 / 100 / 400 |
|---|---|---|---|---|
| 1 | 82.2% | 79.5% | 79.8% | 84.7% / 84.9% / 81.8% |
| 2 | 89.5% | 88.8% | 85.5% | 87.0% / 87.5% / 86.1% |
| 3 | 90.4% | 90.7% | 89.3% | 87.9% / 88.4% / 86.5% |
| 4 (default) | 90.6% | 91.0% | 90.2% | 87.3% / 88.5% / 87.0% |
| 5 | 90.4% | 91.1% | 90.6% | 85.8% / 88.0% / 86.9% |
| 8 | 88.1% | 89.6% | 89.8% | 79.8% / 84.3% / 86.1% |
| 12 | 84.2% | 87.1% | 88.2% | 73.1% / 79.1% / 83.1% |

Statements counted (all k): 96,683 at 25 hands, 124,726 at 100, 140,241 at 400.

**Per persona** at k = 4:

| persona | 25 hands | 100 hands | 400 hands |
|---|---|---|---|
| nit | 93.0% | 92.2% | 93.2% |
| tag | 92.8% | 94.1% | 91.2% |
| lag | 92.5% | 92.5% | 89.1% |
| station | 88.3% | 90.4% | 89.7% |
| maniac | 85.4% | 84.8% | 86.8% |
| micro | 91.9% | 92.2% | 91.5% |

**Per situation** at k = 4, pooled over personas (coverage, statements). Dashes are situations heads-up play never produces:

| situation | 25 hands | 100 hands | 400 hands |
|---|---|---|---|
| openEarly | – | – | – |
| openLate | 88.5% (18000) | 92.0% (18000) | 92.4% (18000) |
| openSmallBlind | – | – | – |
| bbVsLimp | – | – | – |
| vsOpen | 89.3% (18000) | 88.2% (18000) | 89.6% (18000) |
| vs3bet | 94.8% (6753) | 91.5% (13905) | 90.4% (17319) |
| flopCbet | 92.1% (4684) | 90.3% (5788) | 90.4% (5999) |
| flopStab | 91.6% (5906) | 91.7% (6000) | 90.8% (6000) |
| vsFlopCbet | 92.7% (15480) | 91.6% (17940) | 88.2% (18000) |
| turnBarrel | 94.0% (1408) | 93.9% (3381) | 92.8% (5094) |
| vsTurnBarrel | 87.3% (5319) | 91.2% (10914) | 90.6% (16512) |
| riverBet | 91.7% (5545) | 90.0% (5998) | 90.9% (6000) |
| vsRiverBet | 90.3% (8565) | 92.4% (15690) | 88.6% (17961) |
| riverBluff | 84.5% (1031) | 88.1% (3110) | 91.7% (5356) |
| showdown | 90.7% (5992) | 91.2% (6000) | 90.8% (6000) |

At the default k = 4 the pooled coverage is 90.6%, 91.0% and 90.2% at 25, 100 and 400 hands, inside 87–93% at every checkpoint, and the strict equal-tailed intervals also land inside (87.3%, 88.5%, 87.0%, just). Per persona it is not uniform: the maniac, the persona furthest from the average almost everywhere, is under-covered (85–87%) because the prior pulls its early reads toward a typical player, and the nit and TAG are slightly over-covered. Per situation, `riverBluff` at 25 hands (84.5%, few and mostly single observations) is the weakest pooled row.

**The pooled numbers hide weak cells.** The script also prints coverage for every (persona, situation, checkpoint) cell. The weakest ones (at least 100 statements; shipped intervals, and strict equal-tailed for comparison):

| persona | situation | hands | coverage | strict | statements |
|---|---|---|---|---|---|
| maniac | riverBluff | 25 | 48.4% | 96.4% | 277 |
| maniac | riverBluff | 100 | 60.6% | 86.5% | 758 |
| maniac | vsTurnBarrel | 25 | 63.3% | 100.0% | 207 |
| maniac | vsTurnBarrel | 100 | 64.9% | 99.8% | 870 |
| maniac | vsRiverBet | 25 | 65.6% | 99.7% | 966 |
| station | flopCbet | 25 | 67.8% | 95.8% | 360 |
| maniac | vsTurnBarrel | 400 | 67.9% | 98.6% | 2301 |
| maniac | vsRiverBet | 100 | 69.4% | 97.5% | 2358 |
| maniac | riverBet | 25 | 71.5% | 71.5% | 898 |
| station | flopCbet | 100 | 76.3% | 92.4% | 816 |
| maniac | vsFlopCbet | 25 | 76.8% | 87.7% | 2574 |
| lag | vsRiverBet | 400 | 77.0% | 93.2% | 2997 |

One shared population prior pulls extreme players toward average, so early reads on extreme players are under-covered. In most of these cells the one-sided boundary rule makes it worse: when an extreme player's few observations all went one way (a maniac who hasn't raised a turn barrel yet, a station that c-bet the one flop it had), the one-sided bound q(0.90) (or q(0.10)) of a posterior already pulled toward the prior falls short of the true rate, where the equal-tailed q(0.95) (or q(0.05)) would still reach it. `maniac riverBet` at 25 hands (71.5% both ways) is the prior's pull alone. The strict column shows the other side of the trade: equal-tailed intervals cover only 56–62% of the nit, TAG, LAG and maniac `openLate` statements (their true limp rate is 0) and 33% of the station's `vs3bet` (it never folds to a 3-bet). The boundary rule wins pooled (90.6% vs 87.3% at 25 hands) and is the shipped design; these cells are its cost.

The reduced version in `reader.test.ts` (30 sessions per persona, the same checkpoints) asserts 86–94% pooled at each checkpoint (it measures 91.9%, 90.6% and 90.3% on 2,849, 3,734 and 4,206 statements): with statements correlated within a session the sampling spread is about ±1.5 points.

## Limits

- **No calibration evidence for `openEarly`, `openSmallBlind` and `bbVsLimp`.** Their prior comes only from the 6-max setup, and heads-up play (the calibration setup) never produces them, so nothing above says whether their intervals are honest.
- **`riverBet` is not split.** It counts the first river action with no bet yet, so an out-of-position lead and a bet when checked to are the same situation. A player who leads rarely but bets often when checked to reads as somewhere in between.
- **Weak cells on extreme players** (above): early reads of a maniac or station, especially "never seen yet" bounds, cover the truth far less than 90%.
- **Heads-up tuning**: the prior and the calibration are heads-up vs TAG; at other tables they are a starting point, not measured.

## Learning speed

`scripts/learning.ts` (300 sessions per persona; 11 min on 8 worker threads). Each session: 500 seeded heads-up hands of the persona against TAG, watched from the TAG seat (which knows its own cards), ε = 1%. The table gives the share of sessions in which the true persona is the most likely style, and in brackets the mean posterior on it.

| hands | nit | tag | lag | station | maniac | micro |
|---|---|---|---|---|---|---|
| 5 | 75% (58%) | 42% (38%) | 46% (40%) | 81% (78%) | 89% (75%) | 66% (52%) |
| 10 | 84% (78%) | 68% (55%) | 67% (59%) | 93% (90%) | 96% (91%) | 85% (78%) |
| 15 | 91% (85%) | 71% (63%) | 80% (70%) | 96% (95%) | 98% (95%) | 95% (91%) |
| 20 | 94% (91%) | 79% (70%) | 84% (78%) | 98% (98%) | 100% (98%) | 98% (96%) |
| 30 | 98% (97%) | 85% (80%) | 90% (86%) | 100% (99%) | 100% (100%) | 99% (99%) |
| 40 | 99% (99%) | 92% (87%) | 92% (89%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 50 | 99% (99%) | 95% (91%) | 95% (92%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 60 | 100% (100%) | 96% (94%) | 98% (95%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 75 | 100% (100%) | 98% (96%) | 97% (96%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 100 | 100% (100%) | 99% (98%) | 99% (98%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 125 | 100% (100%) | 99% (99%) | 99% (99%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 150 | 100% (100%) | 99% (100%) | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 200 | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 300 | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 400 | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) |
| 500 | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) | 100% (100%) |

**Hands needed for P(true persona is the top style) ≥ 90%** (first checkpoint; every later checkpoint stays ≥ 90%):

| nit | tag | lag | station | maniac | micro |
|---|---|---|---|---|---|
| 15 | 40 | 30 | 10 | 10 | 15 |

Every persona is at ≥ 99% by 125 hands and 100% by 200. TAG and LAG, the closest pair, take longest. These are bots playing exactly one of the six strategies; a person will usually be read faster as *something* and the posterior says nothing about how well that style fits them.

## Tests

| File | What it checks | Time |
|---|---|---|
| `beta.test.ts` | Beta CDF and quantile vs SciPy (1e-12 / 1e-11), closed forms, round trips | <0.1 s |
| `style.test.ts` | Style log-likelihood vs an independent brute-force reference to 1e-9 (50 mixed 2–6 seat hands, every seat but the observer, all six personas, ε = 0.01 and 0.1, more than 10 shown seats); the observer's own seat scores exactly as if its cards were shown, its true combo keeps positive weight, and its cards stay dead for every other seat; ε = 0 combo weights equal `inferRange` to 1e-12 (60 hands, every persona that `inferRange` accepts); two off-policy hands (odd sizes, and a size exactly between two of the persona's) don't throw, match the reference, and zero no persona; a calling station is named within 100 hands | ~3 s |
| `reader.test.ts` | The classifier on five scripted hands (heads-up, 3- and 6-handed); `population.ts` vs a fresh seeded measurement; the Dirichlet/Beta read math and sentences; typical is the population mean, and under k spots (no data, 2 spots) the comparison says too few; direction once n ≥ k (3-bets move it up, folds down); a TAG 4-bet record [2,13,85] and a 3-bet record below μ read "less often"; ranked reads need n ≥ k (none for a 3-hand TAG, only n ≥ 4 at 10 hands); ranking of unusual reads; reduced calibration; the Reader is pure, deterministic and follows ids across seats | ~11 s (reduced calibration ~8 s, population check ~3 s) |

Run `npx vitest run lib/agent/read`.
