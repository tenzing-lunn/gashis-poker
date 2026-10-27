# lib/poker: the math core

Pure TypeScript with no DOM and no dependencies. Every function is pure. The only module-level state is a set of lookup tables that are built once and never change after that, so the code can move into a Web Worker unchanged.

| File | What it does |
|---|---|
| `cards.ts` | Card encoding, `parseCard` / `formatCard` / `parseCards`, `FULL_DECK`, seeded PRNG (`createRng`), `shuffle` |
| `evaluator.ts` | Evaluates 5, 6 and 7 cards, with incremental evaluation and `handCategory` |
| `combinatorics.ts` | `choose`, combo indices 0..1325, the 169 hand classes, combos per class |
| `range.ts` | Range notation: `parseRange`, `removeDeadCards`, `countCombos`, `formatRange` |
| `equity.ts` | `exactEquity` (full enumeration) and `monteCarloEquity` (ranges, seeded) |
| `testing/` | A deliberately naive evaluator used as a test oracle, plus sampled PokerHandEvaluator fixtures (`phe-sample.csv`, Copyright 2016-2023 Henry Lee, Apache-2.0). See `PHE-SAMPLE-NOTICE.txt` and `LICENSE-APACHE-2.0.txt` |
| `scripts/bench.ts` | `npm run bench` |

## Cards

A card is an integer `id = rank * 4 + suit`. Ranks run 0..12 for 2..A and suits run 0..3 for c, d, h, s, so `As = 51` and `2c = 0`. You get the rank with `id >> 2` and the suit with `id & 3`. Using plain integers means hot loops allocate nothing, and a card can index straight into a table.

## Evaluator

A hand's value is a number from 1 to 7462. **Higher is stronger, and equal values are an exact tie.** There are exactly 7,462 distinct 5-card hands once you ignore suits that don't matter. Each category occupies a contiguous block of values: high card 1–1277, pair 1278–4137, two pair 4138–4995, trips 4996–5853, straight 5854–5863, flush 5864–7140, full house 7141–7296, quads 7297–7452, straight flush 7453–7462. `handCategory(v)` looks the value up in these blocks.

The evaluator works in two parts: a rank key with a perfect hash, and a flush mask.

1. **Flush check first.** Each card adds `1 << (4 * suit)` to a word that holds four 4-bit suit counters. Adding `0x3333` raises every counter by 3, so a counter's top bit is set exactly when that suit has 5 or more cards. The test is `(suits + 0x3333) & 0x8888`: one addition and one AND.
2. **Flushes.** Each card also sets its rank bit in a 13-bit mask for its suit. Two suits are packed into each of two int32 words (`lo` and `hi`), because JavaScript bitwise operators work on 32 bits. If the flush check fires, the answer is `FLUSH_TABLE[mask]`, an 8,192-entry table covering every suited rank set. It returns a straight flush when the mask contains a straight, and otherwise the best 5 suited cards. Ignoring the other cards is safe: with 7 cards, a 5-card flush leaves only 2 off-suit cards, and quads or a full house would need at least 3.
3. **Everything else depends only on the ranks.** Each card adds `5^rank` to a key. No rank appears more than 4 times, so the key is the base-5 number whose digits are the rank counts. Every rank multiset therefore gets a unique key, and keys from different card sets can be added together.
4. **Perfect hash.** There are only 73,775 valid keys: 6,175 for 5 cards, 18,395 for 6 and 49,205 for 7. They are spread over a range of about 1.1 billion, so the key can't index a table directly. Instead, the key is mixed (`k ^ (k >>> 15)`) and multiplied by an odd constant. Multiplying by an odd number is a bijection on uint32, so two distinct keys never produce identical products. The low 15 bits of the product choose one of 32,768 buckets, and the high 17 bits choose a slot. Each bucket stores a one-byte displacement `d`, and the final slot is `slot ^ d`. This is the "hash and displace" construction (Pagh; Belazzougui, Botelho & Dietzfelbinger's CHD). Buckets are placed largest first, and each gets the smallest `d` that sends all its keys to free slots. At a load factor of 0.56, the largest displacement needed is 39.

Lookup costs two multiplies, a few shifts and three table reads, with no branches apart from the flush test.

**Input checking.** `evaluate`, `handState` and `evaluateWith` validate their input and throw on a bad card count, an invalid id or a duplicate card. `evaluateWith` reads which cards a state holds from its `lo`/`hi` masks. The positional `evaluate5/6/7` and `evaluateState` do no checking, for speed; with bad input they return garbage.

**Incremental evaluation.** All four state words are additive or OR-able: `key`, `suits`, `lo` and `hi`. Equity loops compute a board's state once and add each player's precomputed hole-card contribution: `evaluateState(key + hk, suits + hs, lo | hl, hi | hh)`. The public API for this is `handState(cards)` plus `evaluateWith(state, ...cards)`. Hot loops use the exported `CARD_KEY` / `CARD_SUIT` / `CARD_LO` / `CARD_HI` tables directly.

**Tables.** The tables are generated at module load in about 40–50 ms (about 120 ms for the whole import, including type stripping). A slow, readable scorer (`scoreCounts`) is run on every rank multiset, and the results are ranked into the dense 1..7462 scale.

| Table | Entries | Bytes |
|---|---|---|
| `NONFLUSH_TABLE` (Uint16) | 131,072 | 256 KB |
| `DISPLACEMENT` (Uint8) | 32,768 | 32 KB |
| `FLUSH_TABLE` (Uint16) | 8,192 | 16 KB |
| **Total** | | **≈ 304 KB** |

**Why not Two Plus Two?** The "2+2" evaluator is a state machine over cards with about 32 million states. Its table is around 130 MB, and every Web Worker would need its own copy. In V8 it is only about 1.6× faster than a hash-based evaluator, because a table that size misses the cache on almost every step. Here the whole working set fits in L2 cache, and incremental evaluation recovers most of the speed difference anyway.

**Ideas credited (no code copied):** additive rank keys and suit counters come from OMPEval (zekyll, ISC) and b-inary/holdem-hand-evaluator. The idea of evaluating hands through a perfect hash comes from HenryRLee/PokerHandEvaluator (Apache-2.0). PokerHandEvaluator uses a different, minimal hash that ranks base-5 count vectors with a DP table. The displacement construction here is the textbook CHD/Pagh scheme.

## Combos and ranges

A two-card combo is an index from 0 to 1325. For cards `x > y`, `index = x(x-1)/2 + y`, which is the combo's position in colexicographic order, so the indices have no gaps. A range is a sorted array of unique combo indices.

`parseRange` supports the following notation. Tokens are comma-separated, whitespace is ignored and ranks are case-insensitive.

| Notation | Meaning |
|---|---|
| `22`, `22+`, `22-55` | A pair, that pair and all higher pairs, or a run of pairs |
| `AKs`, `AKo`, `AK` | Suited (4 combos), offsuit (12), or both (16) |
| `ATs+`, `ATo+`, `AT+` | The kicker climbs to one below the top card: ATs, AJs, AQs, AKs |
| `KTs-K7s`, `A5s-A2s`, `K9-K6` | A run of kickers under a fixed top card |
| `AhKh` | One specific combo |

**Rank order:** class tokens must put the higher rank first. `TKs`, `KA` and `TKs-T7s` are all rejected, with an error that says to write `KTs`. Specific combos (`KhAh`) may list their two cards in either order. Inside a run, the kickers may come in either order (`K7s-KTs` is fine).

`removeDeadCards(range, dead)` applies card removal. `AK` has 16 combos, 12 with an ace dead, and 9 with both an ace and a king dead. `formatRange` writes canonical compact notation. Complete classes become tokens with `+` or `-` runs, a run that is present both suited and offsuit is written without a suffix (`AT+`), and partial classes are listed as specific combos. `parseRange(formatRange(r))` always gives back the same set as `r`.

## Equity

All results are fractions in [0, 1]:

- **win**: the share of runouts the player wins outright.
- **tie**: the share of runouts the player splits.
- **equity**: win plus 1/k of every k-way split. This is the expected pot share, and equities across players sum to 1.

**`exactEquity(hands, board?, dead?)`** takes 2–10 hands and a board of 0–5 cards. It visits every completion of the board in a depth-first search, carrying the board's evaluator state down the tree so that each leaf costs one table lookup per player. Split counts are kept as integers per split size, which keeps the result exact. Heads-up preflop means C(48,5) = 1,712,304 boards and takes about 40 ms. A flop needs C(45,2) = 990 boards.

**`monteCarloEquity(ranges, { board, dead, trials = 200000, seed = 1 })`** treats each player as a range, given as combos or as text like `"QQ+, AKs"`. Combo arrays are treated as sets, so duplicate combos are dropped rather than counted as extra weight. Out-of-range combo indices and a non-integer or non-positive `trials` throw. Each trial works like this:

1. Draw one combo per player, uniformly from that player's range. If any cards collide, reject the whole draw and redraw it. This makes every compatible combination of hands equally likely, which is the same weighting exact range-vs-range enumeration uses.
2. Deal the rest of the board uniformly from the cards that are left.

The result's `stdErr` is the standard error of the equity estimate, `sqrt(sample variance / n)`. At the default 200,000 trials it is at most `sqrt(0.25 / 200000) ≈ 0.11` percentage points, so 0.5 pp is more than 4 standard errors. If almost no draws are compatible (under about 0.1%), the function throws instead of spinning.

## Running

- `npm test`: the fast suite (about 1 s). It enumerates all 2,598,960 five-card hands, compares 6- and 7-card results with the best 5-card subset, checks the PokerHandEvaluator fixtures, and compares equity against a brute-force naive evaluator.
- `npm run test:slow`: enumerates all 133,784,560 seven-card hands and checks the category counts and the 4,824 distinct values. Takes about 2 s.
- `npm run bench`: prints evals/sec and timings for equity calculations.

Node 22 strips TypeScript types natively. Like any ESM loader, though, it won't guess file extensions. `scripts/register-ts.mjs` is a 10-line resolve hook that retries extensionless relative imports with `.ts`, so the library's import style also works for `tsc` and Next.js.

**Bundler note:** Vite, Vitest and Turbopack turn imported bindings into property reads on a module object. V8 optimizes those poorly in hot loops: an exact preflop enumeration took about 3 s under Vitest instead of 40 ms. `equity.ts` therefore copies the imported tables into local constants.
