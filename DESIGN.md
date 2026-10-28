# Gashi's Poker — Design System

**Source of the look:** the visual language of pokerbot.sequoiacap.com (captured 2026-10-27): a typed
document on paper, monospace everywhere, numbered lines down the left margin, ink-on-paper with no color
doing decorative work, and poker tables drawn like a technical figure.

**We borrow the style, not the brand.** No Sequoia / Citadel / OpenAI marks, names, address block, copy, or
"Department of …" letterhead. Our own name, our own words. Section labels use our own device (`FIG.` / `§`),
not their "EXHIBIT A/B/C" sequence.

This fits PLAN.md §5 Phase 4 ("problem set meets trading desk") — it replaces that placeholder direction.

---

## 1. Principles

1. **It's a document.** Every page reads top to bottom like a printed sheet: one column, fixed measure, numbered lines.
2. **Ink and paper only.** Two tones carry everything. Emphasis is *inversion* (ink background, paper text),
   never color, weight, or size jumps. Color is reserved for meaning (win/loss, warnings) and used sparingly.
3. **One font, one weight.** Monospace 400 everywhere, including headings. Hierarchy comes from CAPS, position,
   inversion and rules (`=====`), not bold.
4. **Figures are diagrams.** Tables, cards, chip bars and timelines are drawn with 1px lines, hard offset
   shadows and dashed placeholders — like a figure in a paper, not a casino.
5. **Motion is mechanical.** Stepped animations (`steps(n)`), short (150–200 ms), like a printer or a flap
   display. No easing flourishes, no bounces. Everything respects `prefers-reduced-motion`.

---

## 2. Tokens

Put these on `:root` in `app/globals.css` and expose them to Tailwind via `@theme inline`.

### Color — paper (default, light)
| Token | Value | Use |
|---|---|---|
| `--ink` | `#111111` | Text, lines, filled bars, inverted backgrounds |
| `--paper` | `#ffffff` | Page background, card faces, inverted text |
| `--muted` | `#595959` | Secondary text, legends, folded/out seats |
| `--gutter` | `#8a8a8a` | Line numbers |
| `--faint` | `#c9c9c9` | Dashed placeholders, future/inactive tracks |
| `--warn` | `#ffc400` | Highlight tags only (e.g. "YOUR TURN", form errors) — ink text on it |
| `--amber` | `#b06300` | Caution text (low time bank) — 4.53:1 on paper |
| `--green` | `#078420` | Net-positive numbers only — 4.85:1 on paper |
| `--red` | `#d0141e` | Net-negative numbers only — 5.53:1 on paper |

`--green` / `--red` also mark correct / wrong feedback in drills and lesson checks (`CORRECT`, `WRONG`, the picked
choice). That is meaning, not decoration, and the word always carries it too.

`--green` is darker than the source site's `#0cab2c` (3.05:1 on white): these colors are used for small text,
so every semantic color must reach ≥ 4.5:1 against the band it sits on.

### Color — screen (dark figure band)
Any block with class `.screen` flips the palette. **Tables, replays and the live play area always sit in a
`.screen` band**, so the page alternates paper → screen → paper like a printout with a terminal pasted in.

| Token | `.screen` value |
|---|---|
| `--ink` | `#f2f2f2` |
| `--paper` | `#0a0a0a` |
| `--muted` | `#a6a6a6` |
| `--gutter` | `#747474` |
| `--faint` | `#3d3d3d` |
| `--green` | `#0cab2c` (6.48:1) |
| `--red` | `#ee3a44` (5.02:1) |
| `--amber` | `#c87200` (5.53:1) |

The semantic colors differ from the paper values because the paper red/amber fall below 4.5:1 on `#0a0a0a`
(3.58:1, 4.37:1) and the darkened paper green would too; each is lightened, same hue, to stay ≥ 4.5:1.

`.screen` also sets `color-scheme: dark`, `background: var(--paper)`, `color: var(--ink)`, and vertical padding of
one line (`calc(var(--lh) * 1em)`). Under `@media print`, `.screen` reverts to paper values.

Because every component is written against `--ink`/`--paper`, the same component renders correctly in both
bands with zero overrides. **Never hard-code a hex in a component.**

Site-wide dark mode: under `prefers-color-scheme: dark`, `:root` takes the `.screen` values. (The source site
is light-only; we add this.)

### Type
| Token | Value |
|---|---|
| `--mono` | `"Source Code Pro", ui-monospace, Menlo, monospace` (load via `next/font/google`, weight 400 only) |
| base size | `15px` |
| `--lh` | `1.8` (27px at 15px) — the line grid everything snaps to |
| table seat text | `11px / 1.35` |
| table center / pot | `12px / 1.3` |
| line numbers, axis labels | `10px` |
| tiny labels (tree/branch) | `9px` |

- Weight is **always 400**. No bold anywhere.
- Uppercase for headings, labels, nav, table text, buttons, and FAQ-style answers. Sentence case only for
  long-form lesson prose and help text under form fields.
- Widths are in `ch` (e.g. seat = `14ch`, name column = `12ch`), so layout follows the monospace grid.
- Numbers use the font's natural tabular figures; thousands separators always (`10,000`), hand numbers
  zero-padded to 6 (`HAND 000042`).

### Space & layout
| Token | Value |
|---|---|
| `.sheet` | `max-width: 96ch; margin: 0 auto; padding: 0 24px 0 64px` (the 64px left holds the line numbers) |
| top of document | `padding-top: 48px` |
| `.gap` | `margin-top: 0.5em` — the only vertical spacing step between lines |
| column gap inside a line | `2ch` |
| mobile (< 680px) | left padding drops to `40px`; line numbers shrink to `9px` |

---

## 3. Core primitives

### 3.1 Numbered lines — `.l`
Every row of content is a `.l` line. The document element sets `counter-reset: ln`; each `.l` does
`counter-increment: ln` and renders the number in a `::before` at `left: -5ch`, `width: 3.2ch`, right-aligned,
`10px`, `color: var(--gutter)`, `top: 0.55em`.

`.l` is `display:flex; justify-content: space-between; flex-wrap: wrap; column-gap: 2ch; min-height: calc(var(--lh)*1em)`.
That gives the signature "label left, value right" row for free:

```
12  HANDS PLAYED: 1,204                                    BB/100: +4.2
```

Blank lines are empty `.l` elements — they keep numbering continuous and act as vertical rhythm.

### 3.2 Rules
A full-width row of `=` characters between major sections (render as a `.l` holding a long string of `=` in an inner
`<span>`; the span gets `display:block; flex:1 1 auto; min-width:0; overflow:hidden; white-space:nowrap`. Never clip
the `.l` itself — that hides its `::before` line number). Section titles are centered on their own `.l` in CAPS: `FIG. 2: YOUR TABLE`.

### 3.3 Two-column record — `.tx`
`display:grid; grid-template-columns: 1fr 22ch; column-gap: 2ch; text-transform: uppercase`.
Used for schedules, stats, leaderboards (label column + fixed value column).

### 3.4 Buttons
- **Text button** (`button.t`, transport/toggles): inherits font and color, no background/border,
  `padding: 0 .5ch`. Hover: `outline: 1px solid var(--ink); outline-offset: -1px`.
  Pressed/selected: `background: var(--ink); color: var(--paper)` via `aria-pressed="true"`.
  Written as bracketed labels: `[|<] [<] [PAUSE] [>]`, `SPEED 1x 4x 8x 16x`.
- **Boxed button** (`.apply`, primary action): `border: 1px solid var(--ink); padding: 0 1.5ch; margin: -1px 0`.
  Hover/focus inverts. A filled variant (`.cta`) is inverted at rest. Arrow glyphs in the label: `JOIN TABLE →`, `SIT DOWN ↓`.
- **Focus** everywhere: `outline: 2px solid var(--ink); outline-offset: 2px`.

### 3.5 Form controls (ASCII)
- Rows are a grid `minmax(0, 24ch) 1fr`: CAPS label left, input right.
- Inputs: no box — bottom border only (`1px solid var(--ink)`), transparent background, inherit font.
- Radio: `( )` / `(X)`; checkbox: `[ ]` / `[X]` — drawn with `::before` content on a `.box` span over a visually hidden native input.
- Error / attention tag: `background: var(--warn); color: var(--ink); padding: 0 .5ch`.
- Bar inputs (sliders, allocation): dotted baseline (`border-bottom: 1px dotted var(--muted)`) with an ink fill.

### 3.6 Legend
A muted line under each figure explaining its symbols:
`b BLIND  X CHECK  C CALL  B BET  R RAISE  A ALL-IN  F FOLD  W WIN`

---

## 4. The poker table (the reference component)

This is the piece to match exactly. All practice and multiplayer tables use it. Lives in a `.screen` band.

### 4.1 Figure
- `figure.table-fig { position: relative; aspect-ratio: 2 / 1; }` (between 681–860px also `min-height: 368px`, which the
  seat boxes need, so at 800×600 the header through the controls fits the viewport; see §4.7 for mobile).
- **Felt** (`.felt`): `position:absolute; inset: 15% 10%; border: 1px solid var(--ink); border-radius: 50%;`
  `box-shadow: 0 0 0 5px var(--paper), 0 0 0 6px var(--ink);` — a double-line ellipse, no fill, no green.
- **Center** (`.center`): absolutely centered column, `gap: 4px`, `12px/1.3`. Holds the board row and `POT 1,350` under it.

### 4.2 Seats
`.seat { position:absolute; transform: translate(-50%,-50%); width:14ch; display:flex; flex-direction:column;
align-items:center; font-size:11px; line-height:1.35; background: var(--paper); padding: 3px 0; }`
— the paper background punches the seat out of the felt line.

Seat positions (`left%`, `top%`) for 8 seats, clockwise from bottom-left; seat 1 is the hero/bottom seat:

| Seat | left | top |
|---|---|---|
| 1 | 33.54% | 86.03% |
| 2 | 10.27% | 64.92% |
| 3 | 10.27% | 35.08% |
| 4 | 33.54% | 13.97% |
| 5 | 66.46% | 13.97% |
| 6 | 89.73% | 35.08% |
| 7 | 89.73% | 64.92% |
| 8 | 66.46% | 86.03% |

For 2–7 seats, compute points evenly by angle on a ring around the center, with the hero always at the
bottom (bottom-left for 4/6/8, else bottom-center). Heads-up = bottom vs top. **Accepted deviation:** the
radii are tuned per seat count and layout (`RINGS` in `components/table/model.ts`; the tall 7- and 8-seat
rings are bent toward a rounded rectangle) so that seat boxes never overlap each other, the board or the
figure edge at 320, 375, 700, 820 and 1440px for 2–8 seats — asserted in `model.test.ts`. Wide 8 stays exactly
the table above.

Seat stack, top to bottom:
1. `.hole` — two small cards, `gap: 4px; min-height: 37px; margin-bottom: 4px` (empty space reserved when no cards).
2. `.who` — `S3 MONTE BTN`: seat number, name, and the seat's position this hand (`BTN SB BB UTG MP LJ HJ CO`,
   from `seatPositions` over the seats dealt in, so multiplayer skips empty and sitting-out seats; none before the
   first deal). `BTN` replaces the old `(D)`. A flex row, `column-gap: 1ch; padding: 0 .5ch; max-width: 100%;
   white-space: nowrap`: the name is the only part that gives way (`.name { min-width: 0; overflow: hidden;
   text-overflow: ellipsis }`), so `S8 ` + a 16-character nickname + ` BTN` stays inside the 14ch (12ch) seat as
   `S8 ABCDEF… BTN`. The full name is in the seat's screen-reader sentence and its `title`; on mobile a tapped-open
   seat shows it whole, on paper, past the seat edge if it must. With `onSeatInfo` a bot's `S3 MICRO` is a text
   button (`About S3 MICRO`, same text, §3.4 hover outline in `currentColor`) that opens its bot sheet (§4.9); on
   mobile its 24px target is an invisible extension, so the seat keeps its height.
3. `.meta` — `10,000  100 BB`: stack, then stack depth in big blinds (whole BBs from 10 up, one decimal below,
   `0 BB` when all-in), from before the first deal on. At hand end, a winner and every showdown loser show their
   net result for the hand in place of the depth: `21,750  +1,783` (`--green`) / `9,900  -100` (`--red`).
   The line is fitted to the seat (`seatMeta`: 14 characters, 12 on the tall figure: one space, `100BB`, then
   `12.3K`), so it never leaves the box.
   **Accepted deviation:** the reference shows live equity there; equity would leak hole cards, and an unlabelled
   percentage on a math trainer reads as win chance, so no percentage is shown on a seat.
4. `.bar` — `width:10ch; height:4px; border:1px solid var(--ink); margin:2px 0` with an inner `<i>` filled `var(--ink)`
   to the seat's share of the chips at the table (stack + chips committed this hand while it is live; stack
   alone once the pot is awarded). Unlabelled: it is a picture of the stacks, not a number to read.
5. `.act` — last action: `CALL 100`, `SB 50`, `RAISE TO 300`, `FOLD`. `min-height: 1.35em`. At hand end every
   showdown seat shows its hand (`TWO PAIR`; seat forms `TRIPS`, `QUADS`, `STR FLUSH` keep it within 12
   characters) and an uncontested winner shows `WINS`. The full result goes on the status line (§5).

States:
- `.turn` and `.win` → `.who` inverts (ink background, paper text). That is the *only* "whose turn" signal on the figure.
- `.out` (folded / sitting out) → whole seat `var(--muted)`; its cards and bar border go `var(--faint)` and lose their shadow.
- On the hero's decision their `.who` reads `YOUR TURN` on `--warn` (ink text) in place of the name, so `.act` keeps
  showing their bet this street (`BET 1,100`) and the seat keeps its height. The position would not fit next to it
  (`YOUR TURN BTN` is 13 characters, more than the 12ch mobile seat), so the status line carries it:
  `YOUR TURN (CO) · TO CALL 300`. The seat's screen-reader sentence says the position in words (`cutoff`,
  `on the button (dealer)`).
- **Accepted deviation:** folded opponents keep two card backs (muted, `.out`) until the next hand, so the
  table still shows who was dealt in.

### 4.3 Cards
Small (`.cd`, hole cards): `26×36px; border:1px solid var(--ink); border-radius:3px; background: var(--paper);
box-shadow: 1px 1px 0 var(--ink); font-size:11px;` column of rank over suit (`<i>` suit at 12px).
Board cards (`.board .cd`): `42×58px; font-size:17px; gap:3px; border-radius:4px; box-shadow: 2px 2px 0 var(--ink);` suit `21px`.
Empty slot (`.cd.slot`): `border: 1px dashed var(--faint); box-shadow:none;` — five slots are always drawn so the board never reflows.
Card back (`.cd.back`): `outline:1px solid var(--ink); outline-offset:-5px` (an inset frame), or a 3px dot grid
`radial-gradient(var(--ink) .6px, transparent .8px) 0 0/3px 3px`.

- Suits are glyphs `♠︎ ♥︎ ♦︎ ♣︎` with the text variation selector (U+FE0E) so they never render as emoji.
  Source Code Pro has no suit glyphs, so the suit `<i>` names monospace faces that do —
  `ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace` — ahead of next/font's (wide) fallback: a suit is 0.6em wide.
- **Cards are ink, not red/black.** Suit is carried by the glyph only. (Optional accessibility setting: four-color deck using `--red` / `--green` / ink / `--amber`.)
- Rank `10` is written `10`, not `T`, on cards; `T` is fine in compact notation (`ATs`).

### 4.4 Animation
- Deal: `@keyframes deal { from { transform: translateY(-4px); opacity:0 } }`, `0.15s steps(3)`.
- Flip (showdown): `@keyframes flip { from { transform: scaleX(0) } }`, `0.2s steps(3)`.
- Both disabled under `prefers-reduced-motion: reduce`.

### 4.5 Header lines above the table (all `.l` rows)
```
47                      TABLE 4,812
48  REPLAY                       [|<] [<] [PAUSE] [>]  SPEED 1x 4x 8x 16x
49  HAND 000006, BLINDS 50/100                                    PREFLOP
```
For live play replace `REPLAY` + transport with `LIVE` + seat count / connection:
`LIVE  6/8 SEATED                                     ● CONNECTED`. Solo practice reads `SOLO  6 SEATS` with
nothing on the right. Before the first deal the hand line says what the table waits for, then the blinds:
`NO HAND YET                                          BLINDS 50/100` (`TableHeader` `waiting`; solo keeps
`PRESS DEAL TO START` for the status line only, so it is not said twice). Whose turn,
the clock and the result are on the status line above the controls (§5), not in the header.

### 4.6 Action strip (under the table)
A per-seat timeline across streets — the hand history as a figure.
- Header `.strip.head`: name column then a track labeled `PRE  FLOP  TURN  RIVER  SHOW` (clickable to jump in replay).
  When two neighbouring labels are closer than half of each label plus a space (an all-in runout), both are
  drawn as their initial (`F T R S`, full name in `title`), as the reference does; measured on the live track width.
- One `.strip` per seat: `.name` (`12ch`, nowrap) + `.track` (flex:1). Inside the track a 1px ink line (`.ln`, `top:53%`)
  runs up to "now"; the remainder is a `--faint` line. Action letters (`b X C B R A F W`) sit on the line at their
  time position; `W` is inverted. Future marks are `--muted`. Folded seats' names go `--muted`.
- Street labels and letters punch the line (`background: var(--paper); padding: 0 .3ch`, as a seat punches the felt),
  so the line never strikes through them. Their `left` is clamped to the line (`stripLeft`:
  `clamp(half, at%, 100% - half)`), so `PRE` at the start and `SHOW` / a `W` at the end finish flush with the line's
  ends instead of hanging past the measure; label shortening measures them where they are drawn. Each letter has
  its action in a `title` (`RAISE TO 500`, `SB 50`, `WINS 1,200`).
- Two legend lines beneath (`StripLegend`): how to read it, `EACH ROW IS A SEAT: ITS ACTIONS IN ORDER, UNDER THE
  STREET THEY HAPPENED ON`, then the letters.

### 4.7 Mobile (< 680px)
Table figure `aspect-ratio: 3 / 4` (`3 / 5` at ≤ 400px) with seats on a tall ring; names use a `.short` form
(`S3`), full name revealed on tap. Action controls dock to the bottom of the screen band.
**Accepted deviation (sizes taken from the reference's mobile CSS):** seat `12ch` at `9.5px`, hole cards `19×27px`
(suit `9.5px`), board cards `28×40px` (suit `14px`), center `10px`, felt `inset: 12% 16%`, strip names `3ch`.
Text buttons on the table, its header and the controls are at least 24px tall on mobile.

### 4.8 Home attract table
Eight bots, every hole card face down until showdown, an `ACTION` line centered above the strip. It has no live
region (it would announce every bot action), runs only while the tab is visible and the table is on screen, and
starts paused under `prefers-reduced-motion` (`[PLAY]` starts it).

### 4.9 Bot sheet
What a bot is, in plain words (`components/table/bot-sheet.tsx`): an inverted name line, `STYLE` and `TO BEAT IT`
sentences, opening widths at 6 seats plus heads-up (`UTG  11%  88+, A8s+, …`, the full range in `title`), and six
`.tx` stats with plain labels and the acronym muted (`CHOOSES TO PUT CHIPS IN BEFORE THE FLOP (VPIP)  10%`), measured once over 6,000
simulated hands and checked in. Inline, its lines continue the page's numbering. As a dialog (`BotSheetDialog`, a
native `<dialog>`) it is a sheet of the band it opens from: `--paper` background, 1px `--ink` border, no shadow,
lines numbered from 1, `[CLOSE]` on the title line, Esc and a backdrop click close it. Full width, docked to the
bottom, under 680px. Opened from a bot seat's name at the table (`PokerTable` `onSeatInfo`) and from each
setup row's `[ABOUT]` (§5).

---

## 5. Play controls (our addition, same language)

Not on the source page; designed to match it. Sits as `.l` lines directly under the table figure, inside `.screen`.

```
61  YOUR TURN · TO CALL 300   14 S                                 [STAND]
62  TO CALL 300 INTO 1,200 → NEED 20.0% EQUITY (4 TO 1)          STACK 9,200
63  [FOLD]  [CALL 300]  [RAISE TO] 1,100  600–9,500
64  1/2 POT  2/3 POT  POT  ALL-IN
```
- **Status line** (`StatusBlock`, shared by solo and multiplayer, first line of the controls): the status words, then
  the clock when there is one (`14 S`, `--amber` at 5 s or less), and an action slot at the right. The words are
  `YOUR TURN · TO CALL 300`, `S5 TAG-2 THINKING…` (a bot on the clock), `S4 BEA TO ACT`, the idle text before a hand
  (`PRESS DEAL TO START`), or at hand end the result: `YOU WIN 3,516 WITH TWO PAIR`,
  `S4 STATION WINS 400 WITH A STRAIGHT · YOU LOSE 100`, `S2 LAG WINS 150 · EVERYONE ELSE FOLDED`,
  `SPLIT POT: S2 LAG AND S4 BEA EACH WIN 375`. A pot shared unevenly (odd chips) reads
  `SPLIT POT: YOU, S3 LAG AND S4 NIT SHARE 350 WITH A STRAIGHT FLUSH`; main and side pots to different seats are
  listed in turn, and a hero who won a pot but is down on the hand gets `· YOU NET -600`.
- Solo holds the result: the action slot is a filled `[NEXT HAND →]` (focused when the controls had focus; `Enter`,
  `Space` or `N` deals). The setup row `AUTO-NEXT  [ ] DEAL THE NEXT HAND AFTER 3 S` (off by default) deals on a timer.
- **Price line:** `TO CALL 300 INTO 1,200 → NEED 20.0% EQUITY (4 TO 1)`. The pot already holds the bet faced, so the
  equity needed is call / (pot + call), module 3's B / (P + 2B), and the ratio is its pot odds (P + B) : B. When
  the call is all-in for less, the pot is only what the call contests (`contestedPot`: each seat's chips this hand
  capped at the hero's total after calling): 900 to call against a 5,000 bet into 200 reads
  `TO CALL 900 INTO 1,100 → NEED 45.0%` (`1.2 TO 1`), not `INTO 5,300` (on
  mobile the line ends at the percentage, and the range slot is not reserved). Nothing to call: `NOTHING TO CALL · POT 1,200`; not your turn: `POT 1,200`. `STACK` at the right.
- `[FOLD] [CHECK] [CALL n]` are boxed buttons (§3.4). The default action takes focus and is the filled `.cta`:
  **CHECK when it is free, else CALL** (FOLD only when neither applies). FOLD is disabled when checking is free.
  Once a raise size is chosen or typed the filled box moves to `[RAISE TO]` / `[BET]`, so Enter visibly means raise;
  `Esc` gives it back.
- **Accepted deviation:** the controls sit under the table figure (not under the header), so the seats stay in view
  above them.
- Raise input is an underlined field in `ch` width that shows thousands separators (typing strips anything but
  digits); while the user edits it the separators drop out, so the caret and Backspace move over digits, and they
  come back on blur or when a preset fills it. It is followed by one fixed-width slot that holds the legal range (`200–9,700`) or, instead of it, the error, so an
  error never reflows the line. The sizing presets are `button.t` toggles that say what they are a fraction of:
  `1/2 POT  2/3 POT  POT  ALL-IN`. A preset fills the field and selects it.
- Raise validation: the amount is never clamped. Out of range (or empty on submit) the field gets `aria-invalid`
  and a `Tag` says why — `MIN 200` or `MAX 9,700 (ALL-IN)` — and nothing is sent until the number is in range
  or ALL-IN is chosen explicitly.
- Buttons that don't apply are `aria-disabled` (not `disabled`), so focus stays where it was after an action. When
  the hero's next decision comes up (and on DEAL / NEXT HAND) the band from the table header through the controls is
  scrolled into view if it is not already (when taller than the viewport, the controls go to its bottom), then
  the default action takes focus without a second scroll, only if it is on screen and the user hasn't moved
  focus off the controls.
- Keyboard: `F` fold, `C` check/call, `1–4` choose a size (the field shows it, selected, and the filled box moves
  to `[RAISE TO]` / `[BET]`), `R` focus the field to type an amount, `Enter` confirm, `Esc` back out of the field —
  shown in the legend line `KEYS: F FOLD  C CHECK/CALL  1-4 SIZE  R TYPE AMOUNT  ENTER CONFIRM  ESC BACK` (solo adds
  `N NEXT HAND`). `1–4` pick a size only outside the raise field; in it digits always type, so a size picked
  with `1–4` is replaced by the first digit typed. Letters never go in, and `F`/`C` still act.
- `NEW SESSION` wipes the stats, so it asks again: `[NEW SESSION →]` then `[CONFIRM — WIPES STATS →]`.
- Solo setup (`/play`): each bot row is `S2 BOT  [STATION ▸]  [ABOUT]  LIMPS AND CALLS WITH ALMOST ANYTHING, …` — the
  picker cycles the seats' short names at a fixed `12ch`, so `[ABOUT]` and the note never move under the cursor;
  `[ABOUT]` opens the bot sheet of that choice (MIXED opens the mixed sheet); the muted note is the style in one
  sentence (MIXED: `A RANDOM STYLE, SHOWN AT THE TABLE`) and wraps within the value column, each line 27px. One
  muted legend under the rows: `[STYLE ▸] (CLICK TO CHANGE)  [ABOUT] HOW TO BEAT IT`. While a session runs and the
  seats or bots differ from the ones it started with, the NEW SESSION line adds a muted
  `SETUP CHANGED · APPLIES ON NEW SESSION` (AUTO-NEXT applies at once, so it is not flagged). Bot seats at the table
  open the same sheet, as a dialog of the screen band.
- SESSION record in plain words, numbers right-aligned on their last digit (`.tx.num`): `HANDS PLAYED`, `NET CHIPS`,
  `BIG BLINDS WON PER 100 HANDS (BB/100)`, `REBUYS (TIMES YOU BUSTED)` (the bracketed parts muted), then the legend
  `BB/100 SETTLES ONLY OVER THOUSANDS OF HANDS.`
- Table hotkeys (`F`, `C`, `1–4`, `N`) are ignored while a dialog (a bot sheet) has focus.
- Coach mode adds a line above: `YOUR EQUITY EST. ____%  [SUBMIT]` and, after acting, a graded line using `--green`/`--red` for EV.

---

## 6. Multiplayer UI pieces (same language)

- **Lobby** = a `.tx` record list: `TABLE 0007  6-MAX 50/100   4/6 SEATED   [JOIN →]`.
- **Invite** = a single line with the URL in an underlined field and a `[COPY]` text button.
- **Seat taken by a human** shows the player's handle in `.who`; bots keep their `S# NAME` form; an empty seat is a
  dashed `.cd.slot`-style box with `[SIT]`.
- **Connection state** on the header line, right side: `● CONNECTED` / `○ RECONNECTING…` (ink dot / ring, no color).
- **Message trace / chat** (optional) styled like the source's dealer trace: timestamped rows `+0.074  S2 CHECK`,
  muted timestamps in a `--mt-g` gutter.

---

## 7. Page map

| Route | Bands |
|---|---|
| `/` | paper: title line, short description, nav as numbered `.l` rows (`LEARN →`, `DRILL →`, `PLAY →`, `LAB →`, `REVIEW →`) · screen: a self-playing bot table (attract mode) |
| `/play` | paper: setup form (seats, blinds, bots) · screen: table + controls + action strip |
| `/play/[tableId]` (multiplayer) | screen: table · paper: seat list, invite line, hand log |
| `/drill`, `/lab`, `/learn` | paper document with any interactive figure in a screen band |

Navigation is a single header `.l`: `GASHI'S POKER                    LEARN  DRILL  PLAY  LAB  REVIEW`, current page inverted.

---

## 8. Don'ts
- No green felt, chip images, gradients, glows, rounded "app" cards, drop shadows other than the 1–2px hard offset on cards.
- No second font, no bold, no font-size bigger than 21px (the board-card suit).
- No color for decoration. If removing the color loses no information, remove it.
- No icons from icon libraries — glyphs and brackets only (`→ ↓ ● ○ [ ] ( )`).
- Don't break the line grid: anything taller than one line is a `figure`, not a stack of ad-hoc divs.

## 9. Accessibility
- Contrast: ink/paper pairs are ≥ 15:1; `--muted` on paper 7:1, on screen 8:1; `--gutter` is decorative (line numbers are `aria-hidden`).
- Seats are announced as text (`Seat 3, Monte, cutoff, 9,200 chips, called 100`); the turn is also exposed with `aria-current`.
- `forced-colors: active`: inverted states use `Highlight`/`HighlightText`; bars and lines use `CanvasText`.
- All motion off under `prefers-reduced-motion`.
