// Derives MOBILE_LINES in ../line-budget.ts: how many lines the facts and the ask + hint of each drill type and
// difficulty take at most on a 375px phone (34ch of 15px Source Code Pro), so the answer line never moves.
// Wraps greedily at spaces only (fewer break points than a browser, so it never undercounts).
// node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs app/drill/_scripts/line-budget.ts 400
import { DRILL_TYPES, generate, type Difficulty } from "../../../lib/drills/index";
import { MOBILE_CH } from "../line-budget";

const n = Number(process.argv[2] ?? 400);

/** As CardText draws it: rank T is written 10. */
const shown = (s: string) => s.replace(/T(?=[♣♦♥♠])/g, "10");

function lines(text: string, width: number): number {
  let count = 1;
  let used = 0;
  for (const word of shown(text).split(" ")) {
    const w = [...word].length;
    if (used === 0) used = w;
    else if (used + 1 + w <= width) used += 1 + w;
    else {
      count++;
      used = w;
    }
  }
  return count;
}

const out: Record<string, [number, number][]> = {};
for (const type of DRILL_TYPES) {
  out[type] = [];
  for (const d of [1, 2, 3] as Difficulty[]) {
    let facts = 0;
    let ask = 0;
    for (let seed = 1; seed <= n; seed++) {
      const q = generate(type, seed, d);
      // Fact rows on mobile: label column sized to the label, value wraps in the rest (2ch gap).
      facts = Math.max(facts, q.facts.reduce((sum, f) => sum + lines(f.value, MOBILE_CH - 2 - f.label.length), 0));
      // mdf: on mobile its LEARN link wraps onto a line of its own under the ask.
      const link = type === "mdf" ? 1 : 0;
      ask = Math.max(ask, lines(q.ask, MOBILE_CH) + (q.hint ? lines(q.hint, MOBILE_CH) : 0) + link);
    }
    out[type].push([facts, ask]);
  }
}
for (const [type, rows] of Object.entries(out)) console.log(`  ${type}: ${JSON.stringify(rows)},`);
