# lib/sim and lib/grading: the Practice simulator's math core

Pure TypeScript with no DOM (Plan 4, Phase A). It builds on `lib/poker` (evaluator, combos), `lib/bots` (`inferRange`, `strategyAt`) and `lib/engine`, and changes none of them. Because the bots are our own code, a bot's range is its exact Bayesian posterior over the 1,326 combos (`inferRange`), so equity and EV "vs this bot" can be computed rather than guessed.

| File | What it does |
|---|---|
| `lib/sim/weighted-equity.ts` | Hero vs one weighted range: `equityVsRange`, per-combo `comboEquities`, chunked `startEquityVsRange`, `liveWeights` |
| `lib/sim/multiway.ts` | Hero vs 1–8 weighted ranges by joint rejection sampling: `multiwayEquity`, `startMultiwayEquity`, `sampleJoint` |
| `lib/sim/breakdown.ts` | Range summaries for the UI: `classShares`, `classFrequencies` (13×13 heat map), `handBuckets` (made hands and draws), `topCombos` |
| `lib/sim/protocol.ts`, `jobs.ts`, `cache.ts`, `sim.worker.ts` | Worker jobs `spot` and `grade`: progressive, cancellable, LRU-cached |
| `lib/grading/grade.ts` | `gradeDecision(input)`: the EV of every hero option at a decision, with a verdict tier |
| `lib/grading/ev.ts` | The tree walk behind it (`gradeWithModel`, showdown models) |
| `lib/grading/candidates.ts`, `tiers.ts`, `state.ts`, `types.ts` | Option sets and labels, verdict tiers, state rebuilt from a public history, result types |
| `lib/grading/why.ts` | `explain(result, index?)`: one or two sentences naming the concept, with a lesson link |
| `lib/sim/oracle/`, `lib/grading/oracle/` | The math judges' independent cross-checks (Python, using `oracle/poker_oracle.py`) |

## What's exact and what's estimated (say this in the UI)

- **Opponent ranges are exact** for our bots. One convention: folded players' unknown cards are not treated as removed, the same as `inferRange`.
- **Heads-up equity is exact on the flop, turn and river**: every runout against every live combo, weighted. **Preflop it is Monte Carlo** with a reported `stdErr`.
- **Multiway equity is Monte Carlo** over the joint posterior. The bots' likelihoods factorize, so drawing each bot's combo from its own range and rejecting card collisions samples the joint posterior exactly.
- **River EV is exact heads-up.** Each option's `model` is `"exact"` there, and also heads-up postflop when the option can only end in folds or all-ins.
- **Earlier-street EV is an estimate**, `model: "ev-now"`. The current street is played out exactly against the bot's strategy, and then the hand is assumed to check down. Label it "EV now (ignores later betting)". Never call any of it GTO.
- **`"ev-now"` also marks sampled EVs**: multiway (every street, the river included) and heads-up preflop all-ins. Tell those apart by `street === "river"` or `stdErr > 0`. `explain()` already words its `caveat` this way.
- Multiway and preflop EVs carry a `stdErr`. Tiers shrink the loss by 2·stdErr before grading, so noise is never called a mistake.

## API

```ts
import { equityVsRange, comboEquities } from "@/lib/sim/weighted-equity";
import { multiwayEquity } from "@/lib/sim/multiway";
import { classFrequencies, handBuckets } from "@/lib/sim/breakdown";
import { gradeDecision } from "@/lib/grading/grade";
import { explain } from "@/lib/grading/why";

const w = inferRange(TAG, publicHistory(state), botSeat, { dead: heroCards });   // Float64Array(1326)
equityVsRange(heroCards, w, board);       // { equity, win, tie, stdErr, exact, samples, combos }
multiwayEquity(heroCards, [w1, w2], board, { trials: 100_000, seed: 1 });   // players[0] = hero

const g = gradeDecision({ history: publicHistory(state), heroSeat, heroCards, personas, chosen });
g.options[g.chosen!];   // { label, ev, evBb, stdErr, model, loss, lossPct, tier, foldEquity, responses, showdownEquity }
explain(g);             // { concept, lesson: { slug, module, title, section }, sentences, verdict, caveat, also }
```

- **Inputs are public.** Grading takes a `PublicHistory` (`lib/bots/view.ts`), the hero's seat and cards, and a persona per seat (`null` for the hero). It never sees a `HandState` with hidden cards. It rebuilds the hand with placeholder hole cards, the way `replay` does, and reads only the board from it.
- **EV is in chips** (`evBb` = ÷ big blind). It is E[hero's final stack] − hero's stack now, so folding now is 0.
- **Option sets:**
  - fold (when legal), check, call;
  - first bet of a street: 33%, 66% and 100% of the pot, or all-in;
  - facing a bet: min-raise, pot-size raise, all-in;
  - plus the hero's `chosen` action.
- **Hero's later decisions on the same street** take the best option (a best response).
- **Tiers** (`TIER_THRESHOLDS`, loss as a share of the pot before the decision): best ≤ 0.5%, correct ≤ 3%, inaccuracy ≤ 8%, mistake ≤ 20%, blunder above that. The argmax is always "best".
- **`GradeResult` also has:**
  - `requiredEquity`: the pot odds when facing a bet;
  - `heroEquity`: the check-down equity vs the field;
  - `ranges`: each bot's posterior;
  - `blockers`: for each bot, the share of its range that uses a hero card, compared with the share for a random range;
  - `heroStreetBet`: what the hero has already bet on this street.

### Worker (`lib/sim/sim.worker.ts`, messages in `protocol.ts`)

```ts
const worker = new Worker(new URL("../../lib/sim/sim.worker.ts", import.meta.url), { type: "module" });
worker.postMessage({ kind: "spot", id, history, heroSeat, heroCards, personas });
// -> { type: "ranges", ranges }            per live bot: weights, classShares, classFrequencies, buckets (null preflop)
// -> { type: "equity", equity }            stage "rough" (1,500-trial MC, a few ms), then "refined" (exact or more MC)
// -> { type: "done", result, cached }
worker.postMessage({ kind: "grade", id, history, heroSeat, heroCards, personas, chosen });
// -> multiway: { type: "progress", result, particles } (coarse), then { type: "done", result, cached }
worker.postMessage({ kind: "cancel", id });
```

The worker follows the same rules as `lib/gto/worker-protocol.ts`:
- It runs one job at a time, and a newer request or a cancel supersedes the running one at its next yield (about every 12 ms).
- Progress posts are throttled to about one per 50 ms.
- Results are cached (LRU, 64 entries) by everything that determines the answer. A cache hit posts `done` alone, so a hook must accept a `done` with no `ranges` or `equity` before it.
- Personas cross the boundary as `PersonaId`s.

One limit: a single `gradeDecision` pass is synchronous and can't be interrupted. It runs about 20–60 ms heads-up and 100–500 ms 3-way.

## Performance (Node 22, single thread)

| Job | Time |
|---|---|
| Flop, exact, vs about 1,000 combos | about 12–25 ms |
| Turn, exact | about 1 ms |
| River, exact | about 0.1 ms |
| Preflop, 200k-trial weighted MC | about 30 ms |
| Grading, heads-up, river to preflop | about 20–60 ms |
| Grading, 3-way flop | about 120–500 ms |

Benchmarks:
```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs lib/sim/scripts/bench.ts
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs lib/grading/scripts/bench.ts
```

## Correctness

Unit tests are in `lib/sim/*.test.ts` and `lib/grading/*.test.ts`. Two independent math judges cross-checked the code against `oracle/poker_oracle.py`, using exact Fractions and their own enumeration. They put the checks under `lib/sim/oracle/` and `lib/grading/oracle/` so anyone can rerun them:

```sh
python3 lib/sim/oracle/check.py        # c1..c7: weighted, multiway, MC CIs, breakdown, perf, chunking (~5 min first run)
python3 lib/grading/oracle/judge.py G1 G2 G5 G6   # river/turn/flop EV vs an independent recursion, tiers, no leak (~30 s)
python3 lib/grading/oracle/judge.py G3            # 3-way vs exact joint enumeration (~200 s); G4 preflop (~15 min)
```

The two judges' results:
- **Equity:** 45 heads-up exact spots, max error 1.1e-15. Preflop and multiway Monte Carlo within 3·stdErr, and the reported stdErr matches the spread across seeds.
- **Grading:** 21 river and 12 turn/flop heads-up spots, max EV error 2.6e-11 chips. 3-way and preflop within 4·stdErr. Byte-identical output after reshuffling the bots' hole cards.
