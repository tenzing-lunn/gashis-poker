// Prints N generated questions as JSON (default 500): seed i = 1..N, type round-robin over DRILL_TYPES,
// difficulty cycling 1, 2, 3 (8 and 3 are coprime, so every type gets every difficulty).
// node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs lib/drills/scripts/dump.ts 500
import { DRILL_TYPES, generate, type Difficulty } from "../index";

const n = Number(process.argv[2] ?? 500);
if (!Number.isInteger(n) || n < 1) throw new Error(`Bad count "${process.argv[2]}"`);

const questions = [];
for (let seed = 1; seed <= n; seed++) {
  const type = DRILL_TYPES[(seed - 1) % DRILL_TYPES.length];
  const difficulty = (((seed - 1) % 3) + 1) as Difficulty;
  questions.push(generate(type, seed, difficulty));
}
process.stdout.write(JSON.stringify(questions, null, 2) + "\n");
