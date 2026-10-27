# lib/bots: rule-based opponents with known ranges

Pure TypeScript with no DOM. It builds on `lib/engine/` (the game) and `lib/poker/` (cards, evaluator, combos, ranges) and changes neither. A bot is one baseline policy with a **persona** (a parameter set). The policy is an explicit **mixed strategy**: for any decision and any of the 1,326 hole-card combos it returns a probability for each of a small set of abstract actions. A bot acts by sampling from that distribution with a seeded RNG. Because we know the exact strategy, the grader can compute the bot's **range given its actions** by Bayes' rule and grade "EV of your call vs *this* bot" (PLAN.md §0).

| File | What it does |
|---|---|
| `view.ts` | `PublicView` / `BotView` (what a bot may see), positions, `PublicHistory` and `replay` |
| `preflop.ts` | The shared 169-class preflop ranking (tiers in range notation), `PREFLOP_PCT`, `topRange` |
| `features.ts` | Postflop features for all 1,326 combos at once: strength percentile, draws, board texture |
| `personas.ts` | The `Persona` type and the six personas |
| `policy.ts` | Abstract actions, `analyzeSpot`, `comboDistribution`, `strategyAt`, `chooseAction` |
| `range.ts` | `inferRange`: the bot's posterior range over its hole cards |
| `simulate.ts` | `playHand`, `simulate`: bots playing each other through the engine |
| `stats.ts` | HUD stats from event logs: VPIP, PFR, 3-bet, AF, AFq, fold to c-bet, WTSD, bb/100 |
| `bots.test.ts` | Views, ranking, features, strategy sums, determinism, range inference, stat counting |
| `simulate.test.ts` | 25,000 bot hands (2–9 seats, uneven and short stacks): no illegal action, chips conserved |
| `personas.test.ts` | Every persona measurably different, 6-max and heads-up; prints the stats tables |

## API

```ts
import { botView, publicView, publicHistory, replay } from "@/lib/bots/view";
import { PERSONAS, TAG } from "@/lib/bots/personas";
import { analyzeSpot, comboDistribution, strategyAt, chooseAction, ABSTRACT_ACTIONS } from "@/lib/bots/policy";
import { inferRange } from "@/lib/bots/range";
import { playHand, simulate } from "@/lib/bots/simulate";
import { recordHand, summarize, formatStats } from "@/lib/bots/stats";

// Play: let the bot in `seat` act.
const d = chooseAction(TAG, botView(state, seat), rng);   // { action, abstract, distribution }
state = applyAction(state, d.action);

// Grade: the bot's whole strategy at a decision, and its range given its actions so far.
const st = strategyAt(TAG, publicView(state, seat), heroCards);  // st.probs[combo * 8 + a], st.concrete[a]
const range = inferRange(TAG, publicHistory(state), seat, { dead: heroCards });  // Float64Array(1326), sums to 1
```

- `publicView(state, seat): PublicView` and `botView(state, seat): BotView`. A `PublicView` holds seat, blinds, positions, starting stacks, stacks, bets, committed, folded, board, street, pot, the seat on the clock, `legal` (only when `seat` is on the clock) and the public event log. `BotView` adds `holeCards` for that seat only. Neither has the deck or anyone else's cards.
- `seatPositions(seatCount, button): Position[]`. 6-max is UTG, HJ, CO, BTN, SB, BB; 7–9 seats add LJ and MP; heads-up is BTN (posts the small blind) and BB.
- `publicHistory(state): PublicHistory` is `{ stacks, button, smallBlind, bigBlind, actions, board }`. `replay(history, upTo?)` returns `{ decisions: { seat, view, action }[], board }`, rebuilding every view exactly (it deals placeholder hole cards that are never exposed, and the real board).
- `analyzeSpot(persona, view): Spot` gives the public facts about a decision (position, raises, limpers, aggressor, barrels, price, board features) and `spot.concrete`, the engine action for each abstract action (null where illegal). `comboDistribution(spot, combo): Float64Array` gives the strategy for one combo, indexed like `ABSTRACT_ACTIONS`. `actionDistribution(persona, view, combo)` does both.
- `strategyAt(persona, view, dead?): Strategy` is `{ spot, actions, concrete, probs, live }` for all 1,326 combos. `probs[combo * ACTION_COUNT + a]` is the probability; every live row sums to 1; combos using a board card or a `dead` card have `live[combo] = 0` and an all-zero row.
- `chooseAction(persona, botView, rng): BotDecision` samples `{ action, abstract, distribution }`. The rng is the only randomness.
- `inferRange(persona, history, seat, { upTo?, dead? }): Float64Array` returns posterior weights per combo (see below). It throws if the seat took an action the persona never takes, e.g. a human-sized raise.
- `playHand({ personas, stacks, button, smallBlind?, bigBlind? }, seed): HandState`. The seed fixes the deal and every decision, so the same seed always gives the identical hand.
- `simulate({ personas, hands, seed, stacks?, smallBlind?, bigBlind?, shuffleSeats? }, onHand)`. It plays independent hands with stacks reset to `stacks` (default 100 bb), rotates the button, optionally reseats the personas at random every hand, and calls `onHand(state, personasBySeat)`.
- `recordHand(counts, state, labelOf)`, `summarize(counts): HudStats[]`, `formatStats(stats): string`, `emptyCounts()`.

## What a bot may see

The policy functions take `(persona, PublicView, combo)` or a `Spot` built from a view, never a `HandState`, so a policy cannot read `state.deck` or other players' hole cards: the view simply doesn't contain them. `publicView` copies the public fields out of the state; the event log is shared (the engine never mutates a state) and, before a hand ends, holds only blinds, actions, uncalled bets and deals. The bot's own cards enter only as the `combo` argument, which is what makes it possible to evaluate the same policy for every combo.

## Abstract actions

`ABSTRACT_ACTIONS = ["fold", "check", "call", "bet33", "bet66", "bet100", "raise", "allin"]`.

| Action | Concrete engine action |
|---|---|
| `fold`, `check`, `call` | the same |
| `bet33` / `bet66` / `bet100` | when nobody has bet this street: raise to 33% / 66% / 100% of the pot |
| `raise` | preflop: open to `openSize` bb (+0.5 bb from the small blind), isolate limpers at `openSize + 1 + limpers` bb, 3-bet to 3× the raise in position or 4× out of position, 4-bet to 2.3×, plus one more raise per caller (squeeze). Postflop: raise to 3× the bet |
| `allin` | raise to `maxRaiseTo` |

Every size is rounded to a chip, raised to `minRaiseTo` if needed, and turned into the all-in once it reaches 45% of the stack (`JAM_SHARE`). The mapping depends only on the public view and the persona, never on the combo. Probability on an action that isn't legal is moved before anything is returned: a fold becomes a check when checking is free, a raise becomes a call (or check) when raising isn't allowed, and a postflop "raise" with nothing to raise becomes `bet66`. Two abstract actions can map to the same concrete action (a small stack's `raise` is its `allin`); range inference sums them.

## The policy

All thresholds go through smooth steps (a logistic with width 0.035 on the strength scale, a linear fringe on preflop widths), so strategies near a boundary are genuinely mixed rather than hard-edged. That is realistic, and it makes ranges smooth.

**Preflop.** Every combo has a percentile on one shared ranking (`PREFLOP_PCT`: 0 = AA, ~1 = 72o). The ranking is ten hand-built tiers written in range notation (`PREFLOP_TIERS`, Sklansky-style, strongest first; the classes not listed form an eleventh tier), ordered by the Chen formula inside a tier. A persona's ranges are widths on that scale ("the top 17%"):

- *Unopened:* raise with the top `open[position]` (heads-up `huOpen`), limp anything else inside `limp`, fold the rest. Behind limpers: raise the top `isoRaise`, overlimp up to `max(limp, isoRaise + 1.5 × flat)`. The big blind in a limped pot raises the top `0.8 × isoRaise` and checks the rest.
- *Facing an open:* 3-bet the top `threeBet` and bluff 3-bet `THREE_BET_BLUFFS` (suited wheel aces, suited connectors) with probability `threeBetBluff`. Flat up to `threeBet + flat × position × size`, where position is 2.6 for the big blind (plus `0.35 × huOpen` heads-up), 0.6 for the small blind, 1.15 in position, 0.85 out of position, and size is `(2.75 bb / raise)^0.7` clamped to [0.3, 1.2].
- *Facing a 3-bet:* as the opener, 4-bet the top `fourBet` (plus a few A5s-type bluffs) and call up to `fourBet + callThreeBet` (×1.2 in position, ×0.85 out); cold, 4-bet `0.7 × fourBet` and call up to `0.55 × (fourBet + callThreeBet)`.
- *Facing a 4-bet or more:* jam the top `jam`, call up to `jam + callJam`, fold the rest.

**Postflop.** Features are computed once per board for all combos (`features.ts`):

- *strength* is the percentile of the combo's made hand among all other live combos on this board (ties count half). One evaluator lookup per combo; no Monte Carlo.
- *draw* is `flush` (four to a flush using a hole card), `straight` (two or more ranks complete a straight that the board alone doesn't), `gutshot` (one rank), `combo` (flush plus straight draw), or `none`, and always `none` on the river.
- *texture* records the most cards of a suit, whether the board is paired, and whether it is connected (three ranks in a five-rank window). It is summarized as `wet` in [0, 1].

Checked to: value-bet with probability `step(strength, valueBet[street] + 0.035 × extra opponents)`. Otherwise bluff with a frequency that depends on the role: `cbet` / `barrel` / `riverBluff` as the previous street's aggressor (c-bets shrink on wet boards), `stab` otherwise (×0.6 out of position), and at least `semibluff` with a draw. The frequency is cut for hands with showdown value and by 0.65 per extra opponent. Sizes come from `sizes`, tilted bigger on wet boards; with `sizingTell` value bets size up and bluffs size down.

Facing a bet: raise for value at `valueBet + raiseGap` (+0.06 vs a raise), raise draws at 35% of `semibluff` and air at `bluffRaise` (halved on the river, cut to 20% when facing a raise). Otherwise call when `max(strength, draw value)` clears `call[street] + 0.9 × (price − 0.25)` + 0.04 per extra opponent + 0.12 vs a raise + `barrelFold` vs a second or third barrel + `riverRaiseFold` vs a river raise. Price is `toCall / (pot + toCall)`. Draw values are flush 0.72 / 0.62, open-ender 0.68 / 0.58, gutshot 0.50 / 0.40 and combo draw 0.86 / 0.76 on the flop / turn.

## Strategy and ranges for grading

- **Whole strategy at a decision:** `strategyAt(persona, publicView(state, botSeat), deadCards)` gives every combo's distribution and the concrete action of each abstract action. It costs one evaluator lookup and a few bit operations per combo: about 0.2 ms preflop and 0.3 ms postflop per decision under Vitest.
- **Range given its actions:** `inferRange(persona, publicHistory(state), botSeat, { upTo, dead })`. Start uniform over combos that use no board card (as of the cut point) or `dead` card. For each of the seat's decisions, recompute the spot from the public view, find the abstract actions whose concrete action equals what the seat did, and multiply each combo's weight by the sum of their probabilities. Then normalize. `upTo` cuts the history to the first `upTo` actions, giving the range at that moment. Pass the hero's hole cards as `dead`: the bot doesn't know them, so removing them is exact conditioning. A whole hand's inference for one seat takes about 0.3 ms.

This is exact, not an approximation: the bot sampled its action from that very distribution, so the true combo always has positive weight, and the posterior is precisely P(combo | public actions). `bots.test.ts` checks this on 250 simulated hands, for every seat, both at the end of the hand and at a random cut point.

## Personas

Preflop widths are fractions of all 1,326 combos from the top of the ranking. Postflop thresholds are strength percentiles. Frequencies are probabilities.

| | nit | tag | lag | station | maniac | micro |
|---|---|---|---|---|---|---|
| open UTG / HJ / CO / BTN / SB | .11 / .14 / .19 / .28 / .20 | .17 / .23 / .30 / .48 / .40 | .24 / .32 / .42 / .62 / .52 | .05 / .06 / .07 / .09 / .06 | .50 / .60 / .68 / .82 / .72 | .11 / .13 / .17 / .22 / .14 |
| huOpen | .40 | .75 | .85 | .12 | .95 | .30 |
| limp (total width played unopened) | 0 | 0 | 0 | .45 | 0 | .36 |
| openSize (bb) | 3 | 2.5 | 2.5 | 3 | 3 | 3.5 |
| isoRaise | .05 | .12 | .18 | .04 | .40 | .10 |
| threeBet / threeBetBluff | .03 / 0 | .065 / .35 | .10 / .6 | .015 / 0 | .22 / .8 | .03 / .02 |
| flat | .035 | .07 | .11 | .38 | .25 | .28 |
| fourBet / callThreeBet | .015 / .02 | .022 / .04 | .035 / .06 | .01 / .18 | .10 / .20 | .015 / .10 |
| jam / callJam | .02 / .005 | .025 / .01 | .03 / .015 | .012 / .06 | .08 / .10 | .02 / .04 |
| valueBet flop / turn / river | .86 / .88 / .90 | .80 / .83 / .86 | .76 / .79 / .83 | .88 / .90 / .93 | .62 / .66 / .70 | .82 / .86 / .88 |
| raiseGap | .08 | .10 | .08 | .09 | .06 | .10 |
| call flop / turn / river | .70 / .75 / .80 | .60 / .66 / .71 | .60 / .65 / .70 | .45 / .48 / .52 | .55 / .60 / .66 | .52 / .56 / .60 |
| cbet / barrel / riverBluff | .45 / .20 / .05 | .65 / .40 / .25 | .75 / .55 / .35 | .15 / .05 / .02 | .90 / .75 / .55 | .55 / .25 / .03 |
| stab / semibluff / bluffRaise | .05 / .30 / 0 | .15 / .55 / .05 | .30 / .70 / .12 | .03 / .10 / 0 | .60 / .90 / .30 | .08 / .20 / .02 |
| barrelFold / riverRaiseFold | .03 / .05 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | .20 / .05 |
| sizes 33 / 66 / 100 | .3 / .5 / .2 | .45 / .4 / .15 | .35 / .45 / .2 | .6 / .3 / .1 | .15 / .4 / .45 | .3 / .4 / .3 |
| sizingTell | .2 | 0 | 0 | .3 | .1 | .7 |

(MP and LJ, used only at 7–9 seats, sit between UTG and HJ.)

- **nit**: plays very few hands, rarely bluffs, folds to pressure. Teaches stealing its blinds and folding to its bets. Its UTG open is `88+, A8s+, A5s, AJo+, KTs+, KQo, QTs+, JTs`; it 3-bets `JJ+, AQs+, AKo`.
- **tag**: the baseline tight-aggressive regular. Position-aware ranges, c-bets by texture, some bluffs on every street. UTG `77+, A2s+, ATo+, KTs+, KJo+, Q9s+, QJo, J9s+, T9s, 98s`; BTN 48% (`22+, A2+, K2s+, K8o+, Q6s+, ...`); value 3-bets `99+, AJs+, AQo+, KJs+, QJs` plus suited bluffs.
- **lag**: wider opens (BTN 62%) and 3-bets (`88+, A9s+, AJo+, KTs+, KQo, QTs+, JTs` plus bluffs), more barrels and bluff-raises. Teaches calling down lighter.
- **station**: limps 45% of hands, flats huge ranges, calls postflop with any pair or a decent high card, rarely raises or bluffs. Teaches thin value betting and not bluffing.
- **maniac**: raises and re-raises constantly (UTG 50%, 3-bets 22%), bets most flops and keeps bluffing. Teaches calling down and trapping.
- **micro**: the low-stakes pool from RESEARCH.md §2 item 6. Loose-passive preflop (limps 36%, flats a lot, opens `88+, A8s+, A5s, AJo+, ...` from UTG, 3-bets only `JJ+, AQs+, AKo`). Sticky on the flop (calls more than the TAG) but overfolds to turn and triple barrels (`barrelFold`). Almost never bluffs the river (`riverBluff` .03), so a big river bet or raise is nearly always value (`sizingTell` .7, `bluffRaise` .02). `bots.test.ts` checks each of these behaviors directly on scripted spots.

Not modeled: tilt and per-session drift. Every persona is stationary, which is what keeps the range inference exact.

## Stats

`stats.ts` reads only the engine's event log:

| Stat | Definition |
|---|---|
| VPIP | % of hands with a voluntary preflop call or raise. Blinds and the big blind's check don't count |
| PFR | % of hands with a preflop raise |
| 3bet | % of first chances facing exactly one preflop raise from someone else that were re-raised |
| AF | postflop (bets + raises) / calls |
| AFq | postflop (bets + raises) / (bets + raises + calls + folds), in % |
| FtCB | % of first responses to a flop c-bet (the preflop raiser's unraised flop bet) that were folds |
| WTSD | showdowns / hands that saw the flop, in % |
| bb/100 | net big blinds per 100 hands |

Measured by `personas.test.ts` (seeded; run `npx vitest run lib/bots/personas.test.ts --silent=false` to print):

```
6-max, 6000 hands, each persona in every hand:
persona  hands  VPIP   PFR  3bet     AF   AFq  FtCB  WTSD  bb/100
nit       6000   9.9   7.4   2.5   1.96  41.1  63.6  39.6   -23.4
tag       6000  19.4  14.3   6.4   2.35  49.6  51.8  36.4    58.2
lag       6000  30.5  22.6  12.2   3.73  58.3  50.3  36.0    33.1
station   6000  46.5   3.9   0.9   0.33  18.4  32.9  50.6   -48.3
maniac    6000  59.4  41.9  20.7  10.04  75.0  47.3  33.5   -47.3
micro     6000  38.6   7.8   2.8   0.95  31.1  40.7  34.9    27.7

Heads-up, 300 hands per pairing (1800 per persona):
persona  hands  VPIP   PFR  3bet     AF   AFq  FtCB  WTSD  bb/100
nit       1800  26.5  20.7   2.6   3.34  51.8  65.0  36.1   -10.1
tag       1800  52.7  40.4   9.1   3.52  54.9  69.9  29.2    -8.5
lag       1800  61.7  44.8  10.3   5.61  61.8  68.7  23.5    -4.3
station   1800  51.2   7.1   1.6   0.55  26.2  39.9  53.6   -47.7
maniac    1800  76.8  54.4  20.8  13.80  75.6  64.8  18.1    -4.7
micro     1800  44.6  17.1   2.7   1.60  40.5  53.9  31.9    38.4
```

The 6-max table seats one of each persona, so the tight styles often face a raise before they act; at a table of six TAGs the TAG measures 22/18. bb/100 over a few thousand hands is mostly noise (SD ≈ 90–130 bb/100).

## Tests

`bots.test.ts` covers the following:
- Views contain no deck or foreign hole cards, and are copies.
- `replay` rebuilds every view of 40 hands exactly.
- The ranking covers all 169 classes once.
- Draw and strength features are correct on hand-picked boards.
- `strategyAt` rows sum to 1 and only put weight on legal actions. This is checked for more than 300,000 (decision, combo) pairs, and the engine accepts every concrete action.
- `strategyAt` agrees with the single-combo policy.
- The micro persona's underbluffing and turn overfolding hold on scripted spots.
- The same seed replays the identical hand.
- The true combo always has positive posterior weight, both at the end of the hand and mid-hand (250 hands, every seat).
- The posterior equals the normalized opening strategy on a simple line.
- An off-policy action throws.
- The stat counting is right on a scripted hand.

`simulate.test.ts` plays 25,000 hands at 2–9 seats (mostly 2–6) with random personas, blinds of 2 to 100 and stacks from under a blind to 425 bb. The engine throws on any illegal action, so finishing every hand is the legality check. Chips are conserved in every hand. The bots' tests take about 8 s of wall time inside `npm test`.
