# Plan 7: hand read panel and end-of-hand result popup

**Goal:** while you play, a panel on the left says what you hold right now and what you're drawing to.
When a hand ends, a popup says why you won or lost, what they had against you, and whether it was a bad beat.
It stays up 7 seconds, and the next hand waits for a click.

**Where:** solo play (`/play`) and friends tables (`/play/t/CODE`).
**Branch:** new branch from `main` (not `claude/drill-picker-flow`).

Decided with the owner (2026-10-28):
- Both tables.
- Friends tables: **the host's click** deals the next hand. Everyone else sees the popup and "WAITING FOR THE HOST".
- **NEXT works right away.** The popup closes itself after 7 s if nobody clicks. The next hand still waits for the click.
- Panel shows **hand + draws + odds**.

## What the player sees

### Hand read panel (toggle, on by default)
Shown while you hold cards in a hand that isn't over. Hidden once you fold, while watching, and between hands.

```
YOUR HAND
TWO PAIR, KINGS AND SEVENS
DRAWING TO
FLUSH        9 OUTS  35% BY RIVER
GUTSHOT      4 OUTS
TOTAL       12 OUTS  45% BY RIVER
```
- Preflop: the starting hand in words: `POCKET JACKS`, `ACE-KING SUITED`, `SEVEN-TWO OFFSUIT`. No odds.
- Flop/turn: the made hand with its ranks (`ONE PAIR, JACKS`, `STRAIGHT, TEN HIGH`) plus the flush and straight
  draws that use at least one of your hole cards (not draws that are on the board alone): flush draw, open-ended,
  gutshot. Outs are de-duplicated across draws, and the river shows no draws. Odds: flop is
  `1 − C(unseen−outs, 2) / C(unseen, 2)` (by the river), turn is `outs / unseen`, with unseen = 52 − 2 − board.
  These are outs against the board only, since the panel can't see anyone's cards.
- **Wide screens:** fixed in the empty left margin, level with the table. **Narrow screens:** one line under the
  table, above the status (`TWO PAIR · FLUSH DRAW 9 OUTS 35%`). The line keeps its slot while the panel is on, so
  rows don't jump.
- **Toggle:** `[HAND READ: ON]` / `[OFF]` in the table header, plus the `R` key. Saved in localStorage
  (try/catch, default on).

### Result popup
Shown at the end of every hand you were dealt into. Watchers keep today's status line.
```
YOU WON 1,240
YOUR FLUSH, ACE HIGH  beat  JOSEF'S STRAIGHT, TEN HIGH
  YOU    A♠ 9♠   FLUSH, ACE HIGH
  JOSEF  J♦ T♣   STRAIGHT, TEN HIGH
LUCKY WIN: YOU HAD 19% WHEN THE CHIPS WENT IN ON THE TURN
[NEXT HAND →]   [CLOSE]                    CLOSES IN 7 S
```
- **Headline:** `YOU WON n` / `YOU LOST n` / `SPLIT POT, +n` / `YOU FOLDED ON THE FLOP`.
- **Why:**
  - At showdown: your hand vs the best hand that beat you, or the best hand you beat.
  - Without a showdown: `EVERYONE FOLDED TO YOUR TURN BET`, or `YOU FOLDED ON THE FLOP; S2 TOOK 400`.
- **Cards:** every hand shown down, each with its hand name.
- **Verdict:** only when you reached showdown against revealed cards. It uses your equity against the revealed
  hands on the board as it was when the last chips went in (the street of the last bet or call):
  - `BAD BEAT`: you lost with ≥ 70%.
  - `LUCKY WIN`: you won with ≤ 30%.
  - `COOLER`: you lost with under 70% while holding three of a kind or better.
  - `COIN FLIP`: 40–60%, either result.
  - Anything else: `AS EXPECTED: YOU WERE AHEAD (78%)` / `AS EXPECTED: THEY WERE AHEAD (YOU HAD 22%)`.
  - Each verdict shows the % and the street.
- **Timing:** opens when the hand ends and closes itself after 7 s (countdown shown), or sooner on NEXT, CLOSE or Esc.
  After it closes, NEXT HAND stays where it is today, at the right of the status line.
- **Solo:** NEXT deals as it does today; `N` still works. AUTO-NEXT stays, but its wait goes from 3 s to 7 s so
  the popup isn't cut off.
- **Friends, host:** NEXT sends `next` to the server. **Friends, non-host:** in place of NEXT,
  `WAITING FOR THE HOST TO DEAL`.
- Not modal: it sits over the middle of the felt, has `role="dialog"` with a label, doesn't steal focus from the
  controls, and its text is read out once.

## Phases

### A: pure functions (math judge)
New `lib/poker/hand-read.ts`:
- `describeStart(hole)` returns the starting-hand words.
- `readHand(hole, board)` returns `{ made: string, draws: {kind, outs: Card[]}[], outs: number, pctByRiver: number | null }`.

New `lib/poker/hand-review.ts`:
- `reviewHand({ heroSeat, holes, board, actions, result })` returns `{ headline, why, shown[], verdict | null }`.
- It's built from data both tables already have: the solo `HandState`, and the friends table's `HandResultPublic`
  plus `PublicHand.actions`.
- Equity: `exactEquity` from `lib/poker/equity.ts`. A heads-up preflop all-in is 1.7M runouts; if it takes over
  50 ms on the main thread, use `monteCarloEquity` with a fixed seed and 20k trials for preflop only.

Tests:
- Every category name.
- Combo draws (flush + OESD with shared outs).
- Wheel and broadway straight draws.
- Board-only draws excluded.
- Each verdict at its edges.
- Folds and splits.
- Side pots.

**Math judge:** enumerates outs by brute force over the unseen cards and checks `readHand` on 2,000 random spots.
It also checks verdict equities against `exactEquity` on 200 random showdowns.

### B: friends table server waits for the host (judge)
- `lib/multiplayer/protocol.ts`:
  - New client message `{ type: "next" }`, host only (`not_host` otherwise).
  - `TableState` gains `waitingForHost: boolean`.
- `lib/multiplayer/room.ts`: after a hand ends, `nextHandAt` becomes a **backstop** rather than the deal time.
  - Host connected and present: wait for `next`, with a 60 s backstop so a host who walks off can't freeze the
    table. (This backstop wasn't asked for; it's here so nobody gets stuck.)
  - Host disconnected or away: deal after 7 s, as today but with the popup's length.
  - `next` deals right away (same path as `nextHand`).
  - `endTable` still ends after the hand.
- `components/multiplayer/use-table.ts` / `lib/multiplayer/client.ts`: `actions.next()`.
- Tests in `room.test.ts`:
  - Waits for host.
  - Non-host `next` refused.
  - Backstop fires.
  - Host away falls back to 7 s.
  - Reload between hands keeps the wait (serialize/restore).
- MULTIPLAYER.md updated.
- **Deploying the table server is left to you.** The site and worker must ship together.

### C: UI (judge + browser check)
- New `components/table/hand-read.tsx`: panel, narrow line, toggle.
- New `components/table/result-popup.tsx`: popup with a 7 s countdown.
- Wired into `app/play/play-client.tsx` and `app/play/t/[tableId]/table-client.tsx`.
- Styles in `app/globals.css`, using existing tokens and the DESIGN.md look (monospace lines, no new colors).

Acceptance (judge runs solo plus two players: localhost and 127.0.0.1):
1. The panel matches `readHand` on 10 hands, hides on fold, and the toggle survives a reload.
2. At 1440×900 the panel is in the left margin and overlaps nothing. At 375×812 it's one line and the table
   doesn't jump between streets.
3. Showdown, fold-win, fold-loss and split hands each give the right popup, and its cards match the seats.
4. The popup closes at 7 s. NEXT/CLOSE/Esc close it early. Solo NEXT and `N` deal; friends non-host can't deal.
   The friends host's NEXT deals for everyone.
5. Controls keep focus; no console errors; `npm test`, `npm run lint` and the `table-server` typecheck pass.

## Order
A and B run in parallel (no shared files). C starts after both.
