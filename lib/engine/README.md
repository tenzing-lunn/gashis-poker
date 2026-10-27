# lib/engine: the no-limit hold'em state machine

Pure TypeScript with no DOM. It depends only on `lib/poker/` (cards, seeded shuffle, evaluator). One hand is one immutable state: `applyAction(state, action)` returns a new state and never changes its input. States are plain objects and arrays, so they can be stored, sent to a worker, or turned into JSON and back.

| File | What it does |
|---|---|
| `engine.ts` | `createHand`, `legalActions`, `applyAction`, the queries, types and event log |
| `pots.ts` | `buildPots` (main and side pots) and `awardPots` (settling a finished hand) |
| `engine.test.ts` | Unit tests: dealing, blinds, heads-up and 6-max order, min-raise, Rule 96, side pots, splits, odd chips, errors |
| `engine.random.test.ts` | 100,000 seeded random hands, with invariants checked at every step |
| `pokerkit-fuzz.test.ts` | Replays pokerkit hands and compares every decision |
| `oracle/gen_pokerkit_fixtures.py` | Generates those hands through pokerkit (test-only, MIT) |
| `oracle/pokerkit-hands.json` | 2,000 committed hands (`--hands 2000 --seed 1`) |

## API

```ts
import { createHand, legalActions, applyAction } from "@/lib/engine/engine";

let s = createHand({ stacks: [10000, 10000, 10000], button: 0 }, { seed: 7 }); // blinds default to 50/100
const la = legalActions(s);   // { seat, toCall, callAmount, canFold, canCheck, canCall, canRaise, minRaiseTo, maxRaiseTo, isBet, street }
s = applyAction(s, { type: "raise", to: 300 });
s = applyAction(s, { type: "fold" });
s = applyAction(s, { type: "call" });   // or { type: "check" }
// ... until s.complete; then s.result = { showdown, pots, won, finalStacks, net, values }
```

- `createHand(config: TableConfig, deal: DealSpec): HandState`. `TableConfig` is `{ stacks, button, smallBlind?, bigBlind? }`, and `DealSpec` is `{ seed }` or `{ deck }`.
- `legalActions(state): LegalActions | null`. It returns null once the hand is over.
- `applyAction(state, action: Action): HandState`. `Action` is `{type:"fold"} | {type:"check"} | {type:"call"} | {type:"raise", to}`.
- Queries: `seatToAct(s)`, `pots(s)` (main pot first; only chips collected on earlier streets), `potTotal(s)` (pots plus outstanding bets), `seatsFromButton(s)`.
- `IllegalActionError` is thrown, with a message that says why, for any action that isn't legal. Examples: checking while facing a bet, calling when there is nothing to call, folding when you could check, a raise outside `[minRaiseTo, maxRaiseTo]` or not an integer, a raise that Rule 96 forbids, and acting after the hand is over. A bad config or deck throws a plain `Error`.

Useful state fields include `stacks`, `bets` (this street), `committed` (this hand), `folded`, `toAct` (`toAct[0]` is on the clock), `board`, `street`, `holeCards`, `smallBlindSeat`/`bigBlindSeat`, `events` and `result`. Once the hand is complete, `stacks` are the final stacks, and `pots`/`potTotal` return empty/0. **`deck` holds the undealt board**, so bots and the UI must not read it.

## Conventions

- **Seats** are `0..n-1` clockwise, with 2–9 seats and every stack a positive integer (remove busted players before dealing). Heads-up, the button posts the small blind, acts first preflop and acts last on the flop, turn and river. With 3+ players the small and big blind sit left of the button, the seat left of the big blind acts first preflop, and the first live seat left of the button acts first after that.
- **Chips** are integers. A player whose stack is smaller than their blind posts all of it and is all-in.
- **Raise amounts are "raise to" totals for the street**, so the bet `to` replaces the player's current street bet. The first wager of a street is logged as a `bet` (preflop the blinds count as the bet, so it is a `raise`). A raise to `maxRaiseTo` is all-in.
- **Min-raise:** the increment must be at least `max(largest bet/raise increment so far this street, big blind)`. A raise-to below that is legal only as an all-in, in which case `minRaiseTo === maxRaiseTo`. A short all-in does not change the increment. An all-in bet below the big blind can be raised to that bet plus a big blind.
- **WSOP Rule 96 (TDA Rule 47):** a player who has already acted this street may raise again only if they now face at least a full raise, either from one raise or from several short all-ins that add up to one. Players who have not acted yet may always raise. Posting a blind is not acting, so the big blind keeps its option.
- **Calling a short big blind:** the amount to call is the largest bet actually posted. If the big blind is all-in for 60 at 50/100, the others call 60. This matches pokerkit.
- **Raising** also needs chips beyond the call and at least one other live player who could call more.
- **Uncalled bets:** when a street ends, any bet above the second-largest bet goes back to its owner (logged as `uncalled`). If everyone else folds, the last player wins the pot without a showdown.
- **Running out:** once at most one live player has chips behind, betting stops and the board is dealt to the river.
- **Side pots** are layers of contribution. A pot belongs to the live players who reached its level, and consecutive layers with the same eligible players merge. This is pokerkit's algorithm, including eligibility during a street judged on chips put in so far.
- **Showdown and the odd-chip rule (matches pokerkit):** every live player's hand is evaluated with `lib/poker`'s `evaluate`. First, players who cannot win any pot are dropped, which can merge two side pots into one. Then each pot is split evenly among its best hands, and **the whole remainder goes to the first winner clockwise from the button's left**. Heads-up, that winner is the big blind. When a three-way split leaves 2 chips over, both go to that one player rather than one each to the first two.
- **Dealing:** `{ seed }` shuffles the 52 cards with `createRng(seed)`. `{ deck }` takes an explicit order of at least `2n + 5` distinct cards: card `j < 2n` goes to the `(j mod n)`-th seat clockwise from the button's left, one card at a time, and the next five cards are flop, turn and river. No cards are burned, which doesn't change the odds.

### Event log

`state.events` lists, in order: `blind`, `action` (seat, street, `fold|check|call|bet|raise`, chips moved, the street bet after the action, all-in flag, plus the board, the total pot, `toCall` and the stack *before* the action), `uncalled`, `deal` (street, new cards, full board), `showdown` (cards and evaluator value) and `award` (pot index, amount, eligible seats, winners, shares). Together with the immutable states this is enough for hand histories, and for grading each decision on EV against the situation it was made in.

## Correctness

**Differential fuzzing against pokerkit 0.7.7.** `oracle/gen_pokerkit_fixtures.py` plays random hands through pokerkit. It varies 2–9 players (mostly 2–6), the button, a dozen blind structures, equal 100bb tables and wildly unequal stacks (some below a blind). Raise sizes favour the edges: exact min, all-in, min+1, max−1, pot and half pot. At every decision it records pokerkit's actor, can-fold, call amount, can-raise, min and max raise-to, bets, stacks, pots (with eligibility) and total pot, and at the end the final stacks. `pokerkit-fuzz.test.ts` replays each hand and requires every one of those values to be identical. The fixture lists everything in pokerkit's player order, plus an explicit `seatOfPk` mapping: pokerkit index `k` is seat `(button + 1 + k) % n`.

**Where we deliberately differ from pokerkit.**
1. *Rule 96.* pokerkit treats a raise as "full" when its increment is at least the largest increment so far on the street. That largest increment starts at 0, not at the big blind, so a short all-in can reopen the betting when every earlier wager on the street was also short. Examples: a limper facing an all-in to 1.5bb, or a player who checked facing an all-in bet smaller than the big blind. In both cases pokerkit allows a re-raise and Rule 96 forbids it. pokerkit also stops counting short all-ins that added up to a full raise once a further short all-in follows, so it refuses a raise that Rule 96 allows. The generator computes the strict rule at every decision and flags any step where pokerkit disagrees about whether a raise is allowed. It never raises at a flagged step, and the test checks the engine against the strict answer there. Any other kind of disagreement makes the generator fail. In practice about 1 decision in 700 is flagged. `engine.test.ts` pins both directions.
2. *Heads-up with equal blinds.* pokerkit breaks the tie between equal posted blinds toward the higher index, so heads-up with SB = BB its big blind acts first preflop. The engine keeps the button first, and the generator doesn't produce that configuration.

**Rerun the fuzz on fresh hands** (pokerkit stays out of the app; install it in a throwaway venv):

```sh
python3 -m venv /tmp/pkvenv && /tmp/pkvenv/bin/pip install pokerkit==0.7.7
/tmp/pkvenv/bin/python lib/engine/oracle/gen_pokerkit_fixtures.py --hands 20000 --seed 99 --out /tmp/pk20k.json
ENGINE_FUZZ_FIXTURE=/tmp/pk20k.json npx vitest run lib/engine/pokerkit-fuzz.test.ts --silent=false
# regenerate the committed fixture:
/tmp/pkvenv/bin/python lib/engine/oracle/gen_pokerkit_fixtures.py --hands 2000 --seed 1 --out lib/engine/oracle/pokerkit-hands.json
```

Generating takes about 4 ms per hand, and replaying about 0.03 ms per hand.

**Random hands.** `engine.random.test.ts` plays 100,000 seeded hands, with 2–9 players, random stacks and random legal actions. At every step it checks that chips are conserved and that pots match an independent textbook recomputation from contributions. At about 10% of steps it also checks that every illegal action is rejected. At the end of each hand it checks that no uncalled chips are left in the pot and that the final stacks match an independent settlement from the cards. It takes about 7 s inside `npm test`.
