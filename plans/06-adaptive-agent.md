# 06 — Adaptive agents: the Reader, the Exploiter, the Learner (draft for review, 2026-10-28)

A side project that lives apart from the site for now. Two agents that adapt to the table they sit at:

- **Exploiter**: good at *any* table within a few dozen to a few hundred hands, because it reads each player
  and plays the best response to the read. It can say, in plain words, what it believes and how sure it is:
  *"After 23 flop c-bets I'm 90% sure Bob folds between 48% and 79% of the time (best guess 64%)."*
- **Learner**: a reinforcement-learning agent that starts weak and improves slowly from the hands it plays,
  so it ends up good against the people it actually plays. Built in stages so each stage teaches one RL idea
  and has a known right answer to check against.

Both share one **Reader** (the opponent model). Later (Phase D, not now) either agent can be "tagged in" to a
Play or friends table to train against and get crushed by.

## Owns

Only this plan edits `lib/agent/**` and `plans/06-adaptive-agent.md`. It reads `lib/engine`, `lib/poker`,
`lib/bots`, `lib/grading`, `lib/gto`, `lib/sim` and changes none of them; any change needed there goes under
Hand-offs below. No UI until Phase D.

## What already exists and gets reused

| Need | Already in the repo |
|---|---|
| Legal, chip-exact hands | `lib/engine` (fuzzed vs PokerKit) |
| What a player may see | `lib/bots/view.ts` (`PublicView`, `BotView`, `publicHistory`, `replay`) |
| Hand features for all 1,326 combos | `lib/bots/features.ts` (strength percentile, draws, texture) |
| Six opponents with **known** strategies | `lib/bots/personas.ts` + `policy.ts` (`strategyAt`) — the ground truth for testing reads |
| Exact range given actions | `lib/bots/range.ts` (`inferRange`) |
| EV of each option vs modeled opponents | `lib/grading/ev.ts` (`gradeWithModel`, one-street tree, best response) |
| HUD stats from event logs | `lib/bots/stats.ts` |
| A solved game to check RL against | `lib/gto/pushfold.ts` (heads-up push/fold Nash + exploitability) |

## Phase A — the Reader (opponent model + confidence statements)

`lib/agent/read/`. Watches public actions (and any shown hands) and keeps, per opponent:

1. **Situation stats.** About 15 situations, each with a small set of outcomes, e.g. *unopened from late
   position: raise / limp / fold*, *facing an open: 3-bet / call / fold*, *flop c-bet as preflop raiser*,
   *facing a flop c-bet: fold / call / raise*, *turn barrel*, *facing a turn barrel*, *river bet when checked to*,
   *river bets that were bluffs (from showdowns)*, *went to showdown*. Each is a Dirichlet–multinomial with a
   population prior worth `k` pseudo-hands (the prior is the average of the six personas, so a new player
   starts as "a typical player" and the data takes over as it arrives).
2. **Confidence statements.** From each posterior: best guess, a credible interval (exact Beta quantiles), and
   P(rate > t). Rendered as sentences: *"After N spots, I'm C% sure <player> <does X> between L% and H%."*
   Also *"I'm C% sure <player> folds to c-bets more than a typical player."*
3. **Style posterior.** P(player plays like nit / tag / lag / station / maniac / micro | everything seen).
   The likelihood of a hand's actions under a persona is exact: the sum over hole-card combos of the product
   of that persona's action probabilities (the unnormalized `inferRange` weight), or the single shown combo.
   *"After 40 hands: 93% this plays like a calling station."* For humans it is "closest style", not truth,
   and the statement says so.

**Acceptance (math judge):**
- Calibration: against each persona (true situation frequencies measured on ≥200k simulated hands), the 90%
  intervals contain the truth 87–93% of the time over ≥500 seeded sessions, at 25, 100 and 400 hands.
- Learning speed: a table of hands-seen → P(true persona is the top style), for each persona. Published in
  the README; must reach ≥90% for every persona by some N that we record (expected: tens of hands for
  maniac/station, low hundreds for tag vs lag).
- The style likelihood matches a brute-force reference (enumerate combos, multiply `strategyAt` rows) to 1e-9.
- Pure functions, seeded, no DOM. `npm test` and `npm run lint` pass.

## Phase B — the Exploiter

`lib/agent/exploit/` plus an **arena** in `lib/agent/arena/`.

- **Decision.** Model each opponent as the posterior mixture over personas (Phase A3), feed it to the
  existing EV tree (`lib/grading`), pick the max-EV option. Blend with the TAG baseline by confidence: with
  little evidence it plays TAG; as the posterior sharpens it shifts toward the best response. This guards
  against over-exploiting a read built on five hands.
- **Arena.** Duplicate matches: every deal is played twice with seats swapped, so card luck cancels
  (plain bb/100 has SD ≈ 100 and needs huge samples). Reports bb/100 ± 95% CI for the agent and for
  static TAG on the *same deals*, heads-up and 6-max, plus a learning curve: bb/100 over hands 1–50,
  51–200, 201–1000 (adapting means the later buckets win more).
- Command: `npx tsx lib/agent/arena/run.ts --agent exploiter --vs station --hands 20000 --seed 1`.

**Acceptance (judge + math judge):**
- Heads-up vs each of the six personas, ≥20k duplicate hands: agent bb/100 − TAG bb/100 > 0 with the 95% CI
  excluding 0. Learning-curve buckets rise.
- No illegal action, chips conserved (reuse the `simulate.test.ts` style check) over 25k mixed hands.
- Median decision time recorded; target < 50 ms so it can later sit at a live table.

## Phase C — the Learner (reinforcement learning, in stages)

`lib/agent/learn/`. Each stage is a working agent with a check that has a known answer.

| Stage | What it learns | RL idea it teaches | Check |
|---|---|---|---|
| C1 | Heads-up push/fold (jam or fold, by hand and stack) | Policy gradient (REINFORCE) with a baseline, on a tiny game | Exploitability vs `lib/gto/pushfold` Nash falls below a set bb, from a seed |
| C2 | Full heads-up NLHE with the 8 abstract actions | Actor–critic, a small neural net written by hand (forward + backprop), self-play plus a league of the six personas | Learning curve vs the fixed persona pool in the arena; eventually beats static TAG with CI excluding 0 |
| C3 | Keeps learning from the hands it plays | Online updates with a small learning rate, replay buffer, checkpoints | Plays a long run vs a single persona; win rate vs that persona rises over the run without falling vs the others |

Inputs to the net are the existing features (strength, draw, texture, pot odds, position, street) **plus the
Reader's stats for the opponent**, so the Learner can learn *what to do with* a read, not just raw card play.
Training runs offline in Node worker threads; weights save to JSON checkpoints under `lib/agent/learn/checkpoints/`
(large or numerous checkpoints stay out of git).

Honest expectation: a person plays a few hundred hands a session. That is enough for the Reader to form
reads, but far too little for RL to learn poker from scratch. So the Learner gets good from millions of
simulated hands, and "improves against the people it plays" mainly through two paths: the Reader features it
was trained to use, and slow online fine-tuning (C3).

## Watching every real hand (hand log)

Today no hand history is kept: solo Play holds hands in browser memory only (gone on reload), the friends
table server stores just the current room snapshot (overwritten every action), and `/review` is a
placeholder. Bot-vs-bot hands need no log at all, since the arena makes millions on demand. Real people's
hands are the scarce ones, so those get logged:

- **Record.** When a hand ends, one compact record: the engine event log, stacks, blinds, every hole card
  that was dealt (the logger sees them even though no player did), and an anonymous player id per seat.
  About 1 KB per hand.
- **No lag.** It's sent after the hand ends, fire-and-forget, never during a decision. Learning runs offline
  in batches, so no table ever waits on the Learner.
- **Where.** Friends tables: the table Durable Object appends finished hands to a log store (Cloudflare D1 or
  R2; this is written after the hand, not part of table state, so it fits the Durable Objects choice). Solo
  Play: the browser posts finished hands to the same collector.
- **What the Learner does with it.** The hands weren't played by the Learner, so they're used two ways:
  1. **A "site population" prior for the Reader.** Real players' situation frequencies replace the
     six-persona average, so a stranger starts as "a typical player *here*".
  2. **A simulated site player.** A small net trained to imitate how real players act (behaviour cloning).
     It joins the training league, so the Learner plays millions of simulated hands against something that
     plays like the people on the site. This is the main way it gets good against them.
- **Consent.** Tables show one line saying hands are saved to train the bot.

The collectors touch `table-server/**` and `app/play/**`, owned by plans 2 and 1, so they go in as hand-offs.
The record format, the collector and the offline readers live in `lib/agent/log/`.

## Phase D — tag it in (later; not part of this build)

Seat either agent in solo Play and friends tables, show its reads on the table, store Learner weights in the
table server's Durable Object storage. Needs hand-offs to plans 1 and 2. Note for grading: the agents aren't
stationary, so the grader's exact range inference only stays exact if each decision logs the strategy the
agent used (the Exploiter's blend; for the Learner, its net evaluated on all 1,326 combos).

## Order and build loop

A → B, and C1 in parallel with A (it touches nothing A does). C2 after A (it needs Reader features), C3 after
C2. The hand-log record format and collector can be built any time; the hand-offs to plans 1 and 2 should go
in early, because real hands only start piling up once logging is live. Every phase: builder subagents, then an independent judge given the code and these acceptance criteria;
poker math and calibration get a math judge. Fix loops go to fresh subagents, max 3, then stop and ask.
Own branch, PR, no merge without the owner.

## Decided: the Learner is TypeScript (2026-10-28)

The net is written by hand: forward pass, backprop and Adam. Reasons: the game engine is TypeScript and
already proven, so training and play use the same rules; a Python learner would need either a second
engine that could disagree with this one or a slow bridge on every decision. The agent has to run in
TypeScript anyway once it sits at a table. And the nets here are small (a few thousand weights over hand
features), so a CPU is enough.

**Switch trigger.** If the behaviour-cloning net or the Learner needs more than about 100k weights, or
training runs take more than overnight, move only the *training* to PyTorch. TypeScript still plays the
hands and writes them to files, PyTorch trains on them, and the weights are exported to JSON for TypeScript
to run.

## Hand-offs

- Plan 2 (`table-server/**`): append each finished hand's record to the hand-log store.
- Plan 1 (`app/play/**`): post each finished solo hand to the collector; show the one-line consent note.
- Plan 4, maybe later: a mixture-of-personas opponent in `lib/grading/ev.ts` (if passing a mixture can't be
  done from outside).
