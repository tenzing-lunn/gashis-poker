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
| `--amber` | `#b06300` | Caution text (low time bank) |
| `--green` | `#0cab2c` | Net-positive numbers only |
| `--red` | `#d0141e` | Net-negative numbers only |

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
A full-width row of `=` characters between major sections (render as a `.l` with `overflow:hidden; white-space:nowrap`
and a long string of `=`). Section titles are centered on their own `.l` in CAPS: `FIG. 2: YOUR TABLE`.

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
- `figure.table-fig { position: relative; aspect-ratio: 2 / 1; }` (`5 / 3` between 681–860px; see §4.7 for mobile).
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

For 2–6 seats, compute points on the same ellipse (center 50%/50%, radii ≈ 40% × 36%) evenly by angle,
with the hero always at bottom-center-left. Heads-up = bottom vs top.

Seat stack, top to bottom:
1. `.hole` — two small cards, `gap: 4px; min-height: 37px; margin-bottom: 4px` (empty space reserved when no cards).
2. `.who` — `S3 MONTE (D)`: seat number, name, `(D)` for dealer. `padding: 0 .6ch; white-space: nowrap`.
3. `.meta` — `9,200 10%`: stack, then share/equity %. `--` when unknown.
4. `.bar` — `width:10ch; height:4px; border:1px solid var(--ink); margin:2px 0` with an inner `<i>` filled `var(--ink)`
   to the stack fraction (or equity in coach mode).
5. `.act` — last action: `CALL 100`, `SB 50`, `RAISE TO 300`, `FOLD`. `min-height: 1.35em`.

States:
- `.turn` and `.win` → `.who` inverts (ink background, paper text). That is the *only* "whose turn" signal.
- `.out` (folded / sitting out) → whole seat `var(--muted)`; its cards and bar border go `var(--faint)` and lose their shadow.
- Hero seat additionally shows a `--warn` tag `YOUR TURN` on its `.act` line when it's their decision.

### 4.3 Cards
Small (`.cd`, hole cards): `26×36px; border:1px solid var(--ink); border-radius:3px; background: var(--paper);
box-shadow: 1px 1px 0 var(--ink); font-size:11px;` column of rank over suit (`<i>` suit at 12px).
Board cards (`.board .cd`): `42×58px; font-size:17px; gap:3px; border-radius:4px; box-shadow: 2px 2px 0 var(--ink);` suit `21px`.
Empty slot (`.cd.slot`): `border: 1px dashed var(--faint); box-shadow:none;` — five slots are always drawn so the board never reflows.
Card back (`.cd.back`): `outline:1px solid var(--ink); outline-offset:-5px` (an inset frame), or a 3px dot grid
`radial-gradient(var(--ink) .6px, transparent .8px) 0 0/3px 3px`.

- Suits are glyphs `♠︎ ♥︎ ♦︎ ♣︎` with the text variation selector (U+FE0E) so they never render as emoji.
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
For live play replace `REPLAY` + transport with `LIVE` + seat count / time bank:
`LIVE  6/8 SEATED                                     TIME 00:14`.

### 4.6 Action strip (under the table)
A per-seat timeline across streets — the hand history as a figure.
- Header `.strip.head`: name column then a track labeled `PRE  FLOP  TURN  RIVER  SHOW` (clickable to jump in replay).
- One `.strip` per seat: `.name` (`12ch`, nowrap) + `.track` (flex:1). Inside the track a 1px ink line (`.ln`, `top:53%`)
  runs up to "now"; the remainder is a `--faint` line. Action letters (`b X C B R A F W`) sit on the line at their
  time position; `W` is inverted. Future marks are `--muted`. Folded seats' names go `--muted`.
- Legend line beneath.

### 4.7 Mobile (< 680px)
Table figure `aspect-ratio: 3 / 4` with seats on a tall ellipse; seat width `11ch`; names use a `.short` form
(`S3`), full name revealed on tap. Board cards drop to the small size. Action controls dock to the bottom of the
screen band.

---

## 5. Play controls (our addition, same language)

Not on the source page; designed to match it. Sits as `.l` lines directly under the table header, inside `.screen`.

```
62  TO CALL 200   POT 1,350   POT ODDS 12.9%                   STACK 9,200
63  [FOLD]  [CALL 200]  [RAISE TO ____]   1/2  2/3  POT  ALL-IN
```
- `[FOLD] [CHECK] [CALL n]` are boxed buttons (§3.4); the default/safe action is the filled `.cta`.
- Raise input is an underlined field in `ch` width; the sizing presets are `button.t` toggles.
- Keyboard: `F` fold, `C` check/call, `R` focus raise, `Enter` confirm, `1–4` presets — shown in the legend line.
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
- Seats are announced as text (`Seat 3, Monte, dealer, 9,200 chips, called 100`); the turn is also exposed with `aria-current`.
- `forced-colors: active`: inverted states use `Highlight`/`HighlightText`; bars and lines use `CanvasText`.
- All motion off under `prefers-reduced-motion`.
