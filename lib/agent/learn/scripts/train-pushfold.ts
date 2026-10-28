// Trains the C1 push/fold learner from a seed, prints a learning curve and writes a JSON checkpoint.
//
// Run (from the repo root):
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs \
//     lib/agent/learn/scripts/train-pushfold.ts [--seed 1] [--episodes 20000000] [--every 1000000] \
//     [--reward showdown|expected] [--out lib/agent/learn/checkpoints/pushfold-local.json]
//
// The default --out is an uncommitted file (checkpoints/.gitignore keeps it out of git). The committed checkpoint
// was written by `--seed 1 --out lib/agent/learn/checkpoints/pushfold-c1.json`, with every other flag at its default.
//
// Each curve row: episodes played, wall time, and the exact exploitability (NashConv / 2, bb) at 5, 10, 15 and
// 20 bb of the averaged nets (what the learner plays) and of the current nets (the latest weights).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPushFoldTrainer, DEFAULT_CONFIG, type PushFoldCheckpoint, type PushFoldCurveRow } from "../pushfold-learner";
import type { RewardMode } from "../pushfold-env";

const args = process.argv.slice(2);
const fail = (message: string): never => {
  console.error(`train-pushfold: ${message}`);
  process.exit(1);
};
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  if (i + 1 >= args.length) fail(`--${name} needs a value`);
  return args[i + 1];
};
/** An integer flag; `min` is the smallest allowed value. Rejects NaN, fractions and anything below `min`. */
const intArg = (name: string, fallback: number, min: number) => {
  const text = arg(name, String(fallback)), n = Number(text);
  if (!Number.isInteger(n) || n < min) fail(`--${name} must be an integer >= ${min}, got "${text}"`);
  return n;
};
const seed = intArg("seed", 1, 0);
const episodes = intArg("episodes", DEFAULT_CONFIG.totalEpisodes, 1);
const every = intArg("every", 1_000_000, 1);
const rewardText = arg("reward", "showdown");
if (rewardText !== "showdown" && rewardText !== "expected") fail(`--reward must be "showdown" or "expected", got "${rewardText}"`);
const reward = rewardText as RewardMode;
const out = arg("out", "lib/agent/learn/checkpoints/pushfold-local.json");
const STACKS = [5, 10, 15, 20];

const trainer = createPushFoldTrainer({ seed, totalEpisodes: episodes, reward });
const curve: PushFoldCurveRow[] = [];
const row = (seconds: number) => {
  const average = STACKS.map((s) => trainer.report(s, "average").exploitability);
  const current = STACKS.map((s) => trainer.report(s, "current").exploitability);
  const round = (xs: number[]) => xs.map((x) => Math.round(x * 1e5) / 1e5);
  curve.push({ episodes: trainer.episodes, seconds: Math.round(seconds), average: round(average), current: round(current) });
  const f = (xs: number[]) => xs.map((x) => x.toFixed(4).padStart(7)).join(" ");
  console.log(`${String(trainer.episodes).padStart(10)} ${seconds.toFixed(0).padStart(5)}s | ${f(average)} | ${f(current)}`);
};

console.log(`C1 push/fold REINFORCE self-play: seed ${seed}, ${episodes} episodes, reward ${reward}`);
console.log(`config ${JSON.stringify(trainer.config)}`);
console.log(`  episodes  time | averaged nets: exploitability (bb) at ${STACKS.join(" / ")} | current nets`);
const t0 = performance.now();
row(0);
while (trainer.episodes < episodes) {
  trainer.train(Math.min(every, episodes - trainer.episodes));
  row((performance.now() - t0) / 1000);
}

const checkpoint: PushFoldCheckpoint = { ...trainer.checkpoint(STACKS), curve };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(checkpoint) + "\n");
console.log(`wrote ${out} (${(JSON.stringify(checkpoint).length / 1024).toFixed(1)} KB)`);
console.log(`final exploitability (averaged nets): ${STACKS.map((s) => `${s} bb ${checkpoint.exploitability[s].toFixed(4)}`).join(", ")}`);
