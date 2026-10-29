# lib/agent/learn: the Learner, stage C1 (push/fold by policy gradient)

C1 is the first reinforcement-learning agent in the repo, and the smallest one that still teaches the core idea. It plays heads-up **push/fold**, starting from random weights. SB shoves or folds, and BB calls or folds. It learns only from the chips it wins and loses, over millions of dealt hands against itself. Because `lib/gto/pushfold.ts` already solves this game exactly, we can measure how far the learner is from the right answer, in big blinds, at every point of training.

Pure TypeScript with no DOM and no dependencies. The neural net, backpropagation and the Adam optimiser are written by hand in `nn.ts`. Everything is seeded, so the same seed gives the same weights, bit for bit.

| File | What it does |
|---|---|
| `nn.ts` | A small multilayer perceptron: dense tanh layers, a linear output, forward, backward, Adam, seeded init, JSON weights, and sigmoid/softmax output helpers |
| `pushfold-env.ts` | The environment: deals real cards from a seeded deck, plays the showdown with `lib/poker`'s evaluator, maps a hand to its class and its feature vector |
| `pushfold-learner.ts` | The learner: two policy nets, two baseline nets, REINFORCE self-play, weight averaging, exact evaluation and checkpoints |
| `scripts/train-pushfold.ts` | Trains from a seed, prints the learning curve and writes a checkpoint (by default the uncommitted `checkpoints/pushfold-local.json`) |
| `checkpoints/` | `pushfold-c1.json`: the committed result of the default run, 12.9 KB. The folder's `.gitignore` keeps every other file out of git |
| `nn.test.ts` | Finite-difference gradient check of every parameter for each output head, seeded init, JSON round trip, Adam fit |
| `reinforce.test.ts` | The REINFORCE estimator, built from the trainer's own logit gradient (`nn.ts`'s `bernoulliLogProbGrad`), is unbiased on a bandit whose exact gradient is known |
| `pushfold-env.test.ts` | Class mapping for all 1,326 combos, distinct features, the realised reward averages to the solver's exact value, uniform dealing |
| `pushfold-learner.test.ts` | Reproducibility, a reduced training run, and the committed checkpoint's exploitability |

## Run it

```sh
# The full run (20M episodes, about 2 minutes on an M2): prints the curve and writes
# lib/agent/learn/checkpoints/pushfold-local.json, which git ignores.
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs \
  lib/agent/learn/scripts/train-pushfold.ts --seed 1
# Options: --seed N, --episodes N, --every N (episodes between curve rows), --reward showdown|expected, --out file.json
# Bad values (NaN, 0 or negative counts, an unknown reward mode) stop the script with an error.

# The committed checkpoint was written by exactly this command (every other flag at its default):
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs \
  lib/agent/learn/scripts/train-pushfold.ts --seed 1 --out lib/agent/learn/checkpoints/pushfold-c1.json
npx vitest run lib/agent/learn   # the tests, about 6-16 s
```

```ts
import { createPushFoldTrainer, loadPushFoldPolicy } from "@/lib/agent/learn/pushfold-learner";

const trainer = createPushFoldTrainer({ seed: 1, totalEpisodes: 20_000_000 });
trainer.train(1_000_000);                         // play and learn from 1M more hands
trainer.report(10).exploitability;                // exact distance from Nash at 10 bb, in bb
const { push, call } = trainer.strategy(12.5);    // P(shove), P(call) for each of the 169 classes at 12.5 bb

const policy = loadPushFoldPolicy(checkpointJson); // the trained nets, from the JSON file
```

## The game

The game is the one `lib/gto/pushfold.ts` solves. SB posts 0.5 bb and BB posts 1 bb. Both start with S bb, counting the blind. SB folds and loses 0.5, or shoves all-in. Facing the shove, BB folds (SB wins 1) or calls. Then five board cards are dealt and the better hand wins S. A tie returns each stack. The learner trains on every stack from 2 to 25 bb at once: each hand draws its own S uniformly from that range.

## The RL words, in this code

| Word | What it means in general | What it is here |
|---|---|---|
| **Environment** | The world the agent acts in. It hands out situations and rewards | `pushfold-env.ts`: a seeded deck, the rules above and the hand evaluator |
| **Episode** | One complete try, from start to finish | One deal: 4 hole cards, at most two decisions (SB's, then BB's), then the result |
| **Observation** (state) | What the agent sees when it must act | Its own hand and the stack, as 6 numbers: high rank, low rank, suited, pair, gap and log stack (`writeFeatures`). It never sees the other hand |
| **Action** | What the agent can do | SB: shove (1) or fold (0). BB: call (1) or fold (0) |
| **Policy** π(a \| x) | The agent's rule for acting: a probability for each action, given the observation | A net reading x. Its one output z is a logit, and P(shove) = sigmoid(z). It is a *probability*, not a choice: the agent samples its action, which is how it explores |
| **Reward** | The number the agent wants to be large | Chips won in the hand, in bb. SB gets −0.5, +1 or ±S (0 on a tie). BB gets the negative |
| **Return** G | The sum of the rewards from a decision to the end of the episode | Each player makes one decision and gets one reward at the end, so the return is that reward. In C2 a hand has many decisions and the return adds up what follows each one |
| **Value / baseline** b(x) | What the agent expects to get from x, on average | A second small net per seat, trained by least squares to predict the reward from x |
| **Advantage** A = G − b(x) | How much better than usual this episode went | `r - sbBase`, and `-r - bbBase` for BB |
| **Policy gradient** | The direction in weight space that raises the expected reward | REINFORCE: A · ∇ log π(a \| x), averaged over a batch |
| **Self-play** | The agent's opponent is (a copy of) itself | SB's net and BB's net learn at the same time, each from hands against the other |

### One update, step by step (`playOne` and `update` in `pushfold-learner.ts`)

1. Deal four cards and draw a stack S in [2, 25]. Turn SB's hand into features x.
2. SB's policy net gives p = P(shove | x). **Sample** the action: shove with probability p.
3. If SB shoved, BB does the same with its own net and samples call or fold.
4. If BB called, deal a real board and evaluate both hands. The reward is the actual result, so AA sometimes loses 20 bb. That noise is what an RL agent has to live with.
5. For each player who acted, compute the advantage A = reward − baseline(x). Backpropagate two things. The policy gets the loss −A · log π(a | x), whose gradient with respect to the logit is −A (a − p). The baseline gets the squared-error loss ½(b − reward)².
6. After 1,000 episodes, average the accumulated gradients and take one Adam step on each of the four nets. Then update the running average of the two policy nets.

### Why "reward times ∇ log π" points uphill

The expected reward is J(θ) = Σₐ π(a | x) Q(x, a), where Q(x, a) is the average reward of taking action a. Because ∇π = π ∇log π,

  ∇J = Σₐ π(a | x) Q(x, a) ∇log π(a | x) = E[ G · ∇log π(a | x) ].

That is an average over the actions the policy itself takes, so **one played episode gives an unbiased estimate**: take the reward and multiply it by the gradient of the log-probability of what you did. A good result makes that action more likely, and a bad one makes it less likely. No model of the game is needed, only the rewards.

The estimate is very noisy. A 20 bb shove that gets called returns +20 or −20 whatever the decision was worth. Subtracting a **baseline** that depends only on the observation leaves the estimate unbiased, because

  E[ b(x) ∇log π(a | x) ] = b(x) ∇ Σₐ π(a | x) = b(x) ∇1 = 0.

It also removes the part of the reward that "this hand at this stack is just worth this much" explains. What is left asks a sharper question: did shoving do better or worse than I usually do here? `reinforce.test.ts` checks both claims on a two-armed bandit with a known gradient. Over 200,000 one-sample estimates, every parameter's average lands within 4 standard errors of the exact gradient, with and without a baseline, and the baseline gives every parameter a smaller standard error.

For a sigmoid policy, d log π(a) / dz = a − p. The whole learning signal for the logit is therefore **A · (a − p)**: "push the probability of what I did toward 1, in proportion to how much better than expected it went".

## Self-play, and why it can go round in circles

Neither seat has a fixed target. SB's best shoving range depends on BB's calling range, and the other way round. Both learn at once, each chasing the other. In zero-sum games, simultaneous gradient steps can **circle** the equilibrium instead of settling on it. The classic case is matching pennies: each player keeps over-correcting toward the other's last move. On top of that, the showdown noise keeps kicking the weights around.

C1 uses two standard remedies:

1. **A decaying step size.** Adam's learning rate falls linearly from 3e-3 to 2e-4 over the run, so the late updates are small.
2. **Playing the averaged nets** (Polyak averaging). We keep a running average of each policy net's weights. It is uniform over the first 1,000 updates, then an exponential average over roughly the last 1,000 updates (decay 0.999; 1,000 updates is 1M episodes, the last 5% of the default run). The checkpoint and the reported exploitability use these averages. When iterates circle a point, or jitter around it, their average lands closer to the point.

One caveat. The game-theory results about averaging (fictitious play, regret matching) average the *policies*, the action probabilities. We average the *weights* of a nonlinear net, and the net of the averaged weights is not the average of the nets' policies. It works here because the late updates are small, so the averaged weights stay close to every recent iterate, and over that short distance the net is nearly linear in its weights.

The curve below shows why the average is the one to trust. The "current" nets (the latest weights) jump around. At 8M episodes they were 0.051 bb from Nash at 20 bb, and at 11M 0.044 bb, while the averaged nets were at 0.015 bb both times. In a side experiment with two hidden layers (`hidden: [32, 32]`, before the gap input was added), the current nets swung to 0.16 bb at 20 bb after 4M episodes, while their average stayed at 0.017 bb.

We left out two alternatives. A league or pool of past opponents is the plan for C2. Fictitious play (each side best-responds to the other's *average* policy) would need a best-response learner and an average-policy learner, two nets per seat, where averaging the weights gets much of the benefit in a few lines.

## What exploitability measures here

Freeze both policies and ask two questions. How much could SB win by switching to the best possible reply to BB's calling range? How much could BB win by best-responding to SB's shoving range? Their sum is **NashConv**, and **exploitability = NashConv / 2**, in bb per hand (OpenSpiel's convention, as in `lib/gto`). It is 0 exactly at a Nash equilibrium, and it never depends on luck. `pushFoldExploitability` computes it exactly from the precomputed 169×169 class matrix: no sampling, card removal included.

To score the learner we evaluate its two nets on all 169 hand classes at a stack and hand the 169 probabilities per seat to that function. Every class has its own feature vector, so these per-class probabilities are exactly the learner's strategy. The realised showdowns and the matrix agree on average: `pushfold-env.test.ts` checks over 400,000 deals that the mean realised reward matches the solver's exact value within 4 standard errors.

## The learning curve (measured)

Default run: `--seed 1`, 20M episodes, real showdowns. Wall time 139 s on an Apple M2 while another job shared the machine (109 s of CPU time, so about 5-7 µs per episode). Exploitability is NashConv / 2 in bb.

| Episodes | Time | Averaged nets: 5 bb | 10 bb | 15 bb | 20 bb | Current nets: 5 bb | 10 bb | 15 bb | 20 bb |
|---|---|---|---|---|---|---|---|---|---|
| uniform random (every P = 0.5) | | 0.3897 | 0.4989 | 0.6652 | 0.8480 | | | | |
| 0 (random init) | 0 s | 0.4261 | 0.5435 | 0.7612 | 1.0143 | 0.4261 | 0.5435 | 0.7612 | 1.0143 |
| 1M | 4 s | 0.0249 | 0.0569 | 0.0781 | 0.0888 | 0.0130 | 0.0427 | 0.0537 | 0.0549 |
| 2M | 9 s | 0.0112 | 0.0337 | 0.0441 | 0.0467 | 0.0091 | 0.0327 | 0.0405 | 0.0402 |
| 3M | 18 s | 0.0076 | 0.0227 | 0.0284 | 0.0278 | 0.0085 | 0.0243 | 0.0290 | 0.0277 |
| 4M | 29 s | 0.0069 | 0.0182 | 0.0231 | 0.0231 | 0.0076 | 0.0157 | 0.0234 | 0.0284 |
| 5M | 40 s | 0.0066 | 0.0154 | 0.0189 | 0.0180 | 0.0079 | 0.0151 | 0.0176 | 0.0161 |
| 6M | 49 s | 0.0070 | 0.0129 | 0.0163 | 0.0156 | 0.0067 | 0.0219 | 0.0274 | 0.0272 |
| 8M | 58 s | 0.0077 | 0.0130 | 0.0141 | 0.0152 | 0.0135 | 0.0146 | 0.0311 | 0.0511 |
| 10M | 67 s | 0.0086 | 0.0132 | 0.0149 | 0.0136 | 0.0087 | 0.0124 | 0.0150 | 0.0227 |
| 15M | 100 s | 0.0073 | 0.0119 | 0.0123 | 0.0120 | 0.0081 | 0.0110 | 0.0139 | 0.0240 |
| **20M (checkpoint)** | 139 s | **0.0086** | **0.0104** | **0.0125** | **0.0118** | 0.0092 | 0.0093 | 0.0113 | 0.0122 |

The target was ≤ 0.02 bb at each of 5, 10, 15 and 20 bb. The averaged nets get there after about 5M episodes (40 s) and stay there. They end between 0.009 and 0.013 bb at those four stacks, roughly 1/50 to 1/90 of where they started (at 2-3 bb they are much worse; see Limits). Other seeds give the same picture:

| Seed | 5 bb | 10 bb | 15 bb | 20 bb |
|---|---|---|---|---|
| 1 (committed) | 0.0086 | 0.0104 | 0.0125 | 0.0118 |
| 2 | 0.0081 | 0.0098 | 0.0124 | 0.0121 |
| 3 | 0.0073 | 0.0107 | 0.0129 | 0.0124 |

How close is that in poker terms? These are the learned and Nash range sizes (share of the 1,326 combos played):

| Stack | SB shoves (learned / Nash) | BB calls (learned / Nash) |
|---|---|---|
| 5 bb | 71.5% / 71.5% | 56.7% / 62.0% |
| 10 bb | 57.0% / 58.3% | 40.2% / 37.4% |
| 15 bb | 47.2% / 45.7% | 29.6% / 28.5% |
| 20 bb | 40.0% / 40.1% | 21.5% / 21.7% |

The ranges are close in size but not identical in shape. At 15-20 bb the learner shoves more weak offsuit kings and queens (K4o-K8o, Q6o-Q8o) and fewer small suited connectors (75s, 65s, 54s) than Nash. Those hands are close to indifferent at those stacks, so the swap costs little. The biggest single leak in the checkpoint is SB at 20 bb shoving A2o only 8% of the time, where Nash always shoves it. Making it always shove A2o, with everything else unchanged, lowers the 20 bb NashConv by 0.0024 bb (from 0.0235 to 0.0211), so 0.0012 bb of exploitability.

### What the card luck costs: real showdowns vs expected rewards

`--reward expected` replaces each called shove's realised result with its class-level mean, S (2 E<sub>ij</sub> − 1), and keeps everything else the same, including the sampled actions. Same seed, same 20M episodes:

| Episodes | Showdown rewards: 5 / 10 / 15 / 20 bb | Expected rewards: 5 / 10 / 15 / 20 bb |
|---|---|---|
| 1M | 0.0249 / 0.0569 / 0.0781 / 0.0888 | 0.0167 / 0.0456 / 0.0581 / 0.0604 |
| 2M | 0.0112 / 0.0337 / 0.0441 / 0.0467 | 0.0082 / 0.0232 / 0.0281 / 0.0265 |
| 5M | 0.0066 / 0.0154 / 0.0189 / 0.0180 | 0.0070 / 0.0117 / 0.0130 / 0.0129 |
| 10M | 0.0086 / 0.0132 / 0.0149 / 0.0136 | 0.0058 / 0.0088 / 0.0100 / 0.0105 |
| 20M | 0.0086 / 0.0104 / 0.0125 / 0.0118 | 0.0041 / 0.0073 / 0.0083 / 0.0077 |

Without the board-card noise, the learner gets to the same level in a half to a third of the episodes, and it ends lower. What remains in expected mode (about 0.008 bb) is mostly the net itself. A 32-unit net over six features is a smooth function, so it can't flip every borderline class exactly where Nash does. The checkpoint also plays 12 to 20 classes per seat and stack at probabilities between 5% and 95%. Giving the net the rank gap as an explicit input lowered that floor from 0.010 to 0.008 bb (the gap is a linear function of the ranks, so this only made connectors easier to see).

## Network and hyperparameters

| | |
|---|---|
| Policy nets (SB, BB) | 6 inputs → 32 tanh → 1 logit, sigmoid output. 257 weights each |
| Baseline nets (SB, BB) | same shape, linear output (bb). 257 weights each |
| Inputs | (high rank − 6)/6, (low rank − 6)/6, suited, pair, (high − low)/12, ln(S / 7) |
| Init | uniform Glorot, sqrt(6 / (fan-in + fan-out)), biases 0, seeded |
| Batch | 1,000 episodes per update (20,000 updates in the default run) |
| Policy optimiser | Adam (β₁ 0.9, β₂ 0.999), learning rate 3e-3 falling linearly to 2e-4 at 20M episodes |
| Baseline optimiser | Adam, constant 3e-3 |
| Weight averaging | newest weight max(1 − 0.999, 1/k) at update k (uniform, then exponential) |
| Stacks | uniform in [2, 25] bb, a fresh draw every episode |
| No entropy bonus, no reward scaling | the rewards are raw bb; Adam's per-weight scaling copes with the range |

## Tests

| Test | Checks | Time |
|---|---|---|
| `nn.test.ts` gradient check | Central differences (h = 1e-6) against backprop for every parameter of a 3-5-4-k tanh net with random weights. Three heads: sigmoid policy (−A log π), linear value (½(V − y)²) and softmax policy. Worst relative error 1.2e-8, 3.5e-7 and 4.4e-8 (limit 1e-5) | < 20 ms |
| `nn.test.ts` | Same seed → same weights, JSON round trip is exact, Adam fits sin(2x) | 0.2 s |
| `reinforce.test.ts` | Unbiased REINFORCE gradient (bandit, 200k samples, every parameter within 4 SE, with and without a baseline). The baseline lowers every SE | 0.2 s |
| `pushfold-env.test.ts` | Class of all 1,326 combos, 169 distinct feature vectors, realised mean reward = solver value within 4 SE (both reward modes), uniform dealing | 0.6 s |
| `pushfold-learner.test.ts` reproducibility | Two 100k-episode runs with seed 4 have identical weights in all six nets; seed 5 differs | 1.4-2.8 s |
| `pushfold-learner.test.ts` reduced run | 1.5M episodes over all stacks: 10 bb exploitability from 0.54 to **≤ 0.08 bb** (measured 0.054). The looser bound is for the shorter run | 6-13 s |
| `pushfold-learner.test.ts` checkpoint | The committed `pushfold-c1.json` is ≤ 0.02 bb at 5, 10, 15 and 20 bb and matches the numbers stored in it | < 10 ms |

The time ranges come from runs on an idle and a busy machine.

## Limits

- **Short stacks are weak, inside the trained range.** The ≤ 0.02 bb target holds from about 5 bb up, but not at the bottom of the range. At 2 bb the checkpoint is 0.065 bb from Nash and at 3 bb 0.036 bb. Most of that is BB folding too much: at 2 bb it calls 74% of combos, where Nash calls every hand, and BB's best-response gain is 0.098 of the 0.130 bb NashConv (0.046 of 0.072 at 3 bb). The test only checks 5, 10, 15 and 20 bb, so nothing catches this. The checkpoint's exploitability (NashConv / 2, bb), measured with `pushFoldExploitability`:

  | Stack | 2 bb | 3 bb | 4 bb | 5 bb | 8 bb | 10 bb | 12 bb | 15 bb | 20 bb | 25 bb |
  |---|---|---|---|---|---|---|---|---|---|---|
  | Exploitability | 0.0651 | 0.0360 | 0.0159 | 0.0086 | 0.0079 | 0.0104 | 0.0111 | 0.0125 | 0.0118 | 0.0111 |
  | BB calls (learned / Nash) | 74.2% / 100% | 67.1% / 92.3% | 61.3% / 74.0% | 56.7% / 62.0% | 45.9% / 45.0% | 40.2% / 37.4% | 35.6% / 33.0% | 29.6% / 28.5% | 21.5% / 21.7% | 16.6% / 17.3% |

- **Stacks outside 2-25 bb.** They were never trained. There the nets extrapolate, and nothing checks the result.
- **Exact reproducibility** means the same seed and code on the same JavaScript engine. `Math.tanh`, `exp` and `log` are deterministic in V8, but another engine could round a last bit differently and drift.
- **Checkpoint size.** The checkpoint is 12.9 KB, not "a few KB": it stores the 514 policy weights at full double precision, so they round-trip exactly, plus the learning curve.
- **Variance.** In showdown mode, after about 10M episodes, gains come slowly. The remaining gap to expected mode is board-card noise that a 1,000-hand batch can't average away. Bigger late batches would trade time for it.

## How C2 extends this

C2 plays full heads-up no-limit with the 8 abstract actions, through `lib/engine`. The pieces carry over:

- **`nn.ts` as is.** The policy head becomes the softmax over 8 actions (`softmax`, `softmaxLogProbGrad`; the gradient check already covers it). The inputs become the existing hand and board features plus the Reader's opponent stats.
- **Return over many decisions.** A hand has up to a dozen decisions, so each one's return is the reward of the rest of the hand, and credit has to be shared across streets.
- **Baseline → critic (actor–critic).** Here the baseline only reduced variance. In C2 the value net also *bootstraps*: it estimates the value of the next decision point, so a decision on the flop can learn before the river is dealt. That is the step from REINFORCE to actor–critic.
- **Self-play → a league.** C2 adds the six personas to the opponent pool, which also fights the cycling described above.
- **Training at scale.** Training moves into Node worker threads, and checkpoints keep this folder's format and `.gitignore` rule.
