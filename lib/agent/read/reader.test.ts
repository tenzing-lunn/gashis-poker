// Situation classifier on scripted hands, the checked-in population counts against a fresh seeded
// measurement, the read math and sentences, a reduced calibration run, and the Reader's purity.
import { describe, expect, it } from "vitest";
import { applyAction, createHand, type Action, type HandState } from "../../engine/engine";
import { parseCards } from "../../poker/cards";
import { PERSONA_IDS, PERSONAS, TAG, type PersonaId } from "../../bots/personas";
import { playHand } from "../../bots/simulate";
import { betaQuantile } from "./beta";
import { coverage, coverageRate, pool, sessionSeed, sessionSnapshots } from "./calibration";
import { observe } from "./hand";
import { HU_COUNTS, SIX_MAX_COUNTS } from "./population";
import { addHand, createReader, playerRead, playerReads } from "./reader";
import { compareRead, DEFAULT_K, describeRead, PRIOR, readOutcome, readProbAbove, topReads } from "./reads";
import { classifyHand, SITUATIONS } from "./situations";
import { emptySituationCounts, frequencies, measureHeadsUp, measureSixMax, type SituationCounts } from "./truth";

const S = (id: string) => SITUATIONS.findIndex((s) => s.id === id);

/** A hand on a fixed deal: holes[seat] as text, then the board; hole cards go one at a time from the button's left. */
function scripted(button: number, holes: string[], board: string, actions: Action[]): HandState {
  const n = holes.length;
  const cards = holes.map((h) => parseCards(h));
  const deck: number[] = [];
  for (let j = 0; j < 2 * n; j++) deck.push(cards[(button + 1 + (j % n)) % n][Math.floor(j / n)]);
  deck.push(...parseCards(board));
  let s = createHand({ stacks: new Array(n).fill(10_000), button }, { deck });
  for (const a of actions) s = applyAction(s, a);
  return s;
}

/** "seat:situation=outcome" strings, sorted. */
const labels = (s: HandState) =>
  classifyHand(observe(s, s.holeCards.map(() => "x")))
    .map((o) => `${o.seat}:${SITUATIONS[o.situation].id}=${SITUATIONS[o.situation].outcomes[o.outcome]}`)
    .sort();

const R = (to: number): Action => ({ type: "raise", to });
const CALL: Action = { type: "call" }, CHECK: Action = { type: "check" }, FOLD: Action = { type: "fold" };

describe("situations", () => {
  it("finds c-bets, barrels and the responses heads-up", () => {
    // Button opens, big blind calls; flop check, c-bet, call; turn check, barrel, fold.
    const s = scripted(0, ["AhKd", "7c6c"], "Qs8d2h4c9s", [R(250), CALL, CHECK, R(300), CALL, CHECK, R(600), FOLD]);
    expect(labels(s)).toEqual(
      [
        "0:openLate=raise",
        "0:flopCbet=bet",
        "0:turnBarrel=bet",
        "0:showdown=no showdown",
        "1:vsOpen=call",
        "1:flopStab=check",
        "1:vsFlopCbet=call",
        "1:vsTurnBarrel=fold",
        "1:showdown=no showdown",
      ].sort(),
    );
  });

  it("finds 3-bets and the opener's response", () => {
    // Button opens, big blind 3-bets, button calls; the 3-bettor checks the flop, the button stabs, fold.
    const s = scripted(0, ["AhKd", "QcQd"], "7s8d2h4c9s", [R(250), R(1000), CALL, CHECK, R(800), FOLD]);
    expect(labels(s)).toEqual(
      ["0:openLate=raise", "0:vs3bet=call", "0:flopStab=bet", "0:showdown=no showdown", "1:vsOpen=3-bet", "1:flopCbet=check", "1:showdown=no showdown"].sort(),
    );
  });

  it("finds limps, the big blind's option, river bets and shown bluffs three-handed", () => {
    // Button limps, small blind completes, big blind checks. Flop: SB checks, BB bets, BTN calls, SB folds.
    // Turn checked through. River: BB bets with 4-high, BTN calls with aces. Both are shown.
    const s = scripted(0, ["AhAd", "7c2d", "4s3s"], "KcQh9d8c2h", [CALL, CALL, CHECK, CHECK, R(300), CALL, FOLD, CHECK, CHECK, R(500), CALL]);
    expect(s.result!.showdown).toBe(true);
    expect(labels(s)).toEqual(
      [
        "0:openLate=limp",
        "0:vsRiverBet=call",
        "0:showdown=showdown",
        "1:flopStab=check",
        "1:showdown=no showdown",
        "2:bbVsLimp=check",
        "2:flopStab=bet",
        "2:riverBet=bet",
        "2:riverBluff=bluff",
        "2:showdown=showdown",
      ].sort(),
    );
  });

  it("uses early position and the small blind six-handed", () => {
    // UTG opens, HJ and CO fold, BTN folds, SB 3-bets, BB folds (facing two raises: not "facing an
    // open"), UTG folds.
    const s = scripted(0, ["2c3d", "AhAd", "4c5d", "KsKh", "7c8d", "9c9d"], "QsJd2h4h9s", [R(250), FOLD, FOLD, FOLD, R(1000), FOLD, FOLD]);
    expect(labels(s)).toEqual(["3:openEarly=raise", "4:vsOpen=fold", "5:vsOpen=fold", "0:vsOpen=fold", "1:vsOpen=3-bet", "3:vs3bet=fold"].sort());
    // Folded to the small blind, which completes; checked down from there.
    const t = scripted(0, ["2c3d", "AhAd", "4c5d", "KsKh", "7c8d", "9c9d"], "QsJd2h4h9s", [FOLD, FOLD, FOLD, FOLD, CALL, ...new Array(7).fill(CHECK)]);
    expect(labels(t).filter((l) => !/flop|river|showdown/.test(l))).toEqual(
      ["0:openLate=fold", "1:openSmallBlind=limp", "2:bbVsLimp=check", "3:openEarly=fold", "4:openEarly=fold", "5:openLate=fold"].sort(),
    );
  });
});

describe("population counts", () => {
  it("match a fresh seeded measurement within sampling error", () => {
    const failures: string[] = [];
    // Each frequency within 4.5 standard errors of the checked-in one (a true zero must stay zero).
    const check = (label: string, fresh: SituationCounts, stored: SituationCounts) =>
      fresh.forEach((c, si) => {
        const n = c.reduce((a, b) => a + b, 0);
        const f = frequencies(c);
        const p = frequencies(stored[si]);
        if (!f || n < 50) return;
        if (!p) return void failures.push(`${label} ${SITUATIONS[si].id}: never seen in population.ts, ${n} times now`);
        f.forEach((x, j) => {
          const tol = 4.5 * Math.sqrt((p[j] * (1 - p[j])) / n);
          if (Math.abs(x - p[j]) > tol) failures.push(`${label} ${SITUATIONS[si].id} ${SITUATIONS[si].outcomes[j]}: ${x.toFixed(4)} vs ${p[j].toFixed(4)} (n ${n})`);
        });
      });
    const hu = {} as Record<PersonaId, SituationCounts>;
    PERSONA_IDS.forEach((id, i) => {
      hu[id] = measureHeadsUp(id, 4_000, 77 + i);
      check(`hu ${id}`, hu[id], HU_COUNTS[id]);
    });
    const six = measureSixMax(3_000, 78);
    for (const id of PERSONA_IDS) check(`6max ${id}`, six[id], SIX_MAX_COUNTS[id]);

    // The prior means regenerated from the fresh sample (same setup per situation), within 4.5 SE.
    PRIOR.forEach(({ mean, setup }, si) => {
      const source = setup === "hu" ? hu : six;
      const f = PERSONA_IDS.map((id) => source[id][si]);
      if (f.some((c) => c.reduce((a, b) => a + b, 0) < 30)) return;
      mean.forEach((m, j) => {
        const fresh = f.reduce((acc, c) => acc + frequencies(c)![j] / 6, 0);
        const se = Math.sqrt(f.reduce((acc, c, i) => {
          const p = frequencies((setup === "hu" ? HU_COUNTS : SIX_MAX_COUNTS)[PERSONA_IDS[i]][si])![j];
          return acc + (p * (1 - p)) / c.reduce((a, b) => a + b, 0);
        }, 0)) / 6;
        if (Math.abs(fresh - m) > 4.5 * se) failures.push(`prior ${SITUATIONS[si].id} ${SITUATIONS[si].outcomes[j]}: ${fresh.toFixed(4)} vs ${m.toFixed(4)}`);
      });
    });
    expect(failures, `population.ts is stale; rerun lib/agent/read/scripts/measure.ts.\n${failures.join("\n")}`).toEqual([]);
    for (const { mean } of PRIOR) for (const m of mean) expect(m).toBeGreaterThan(0); // every outcome possible a priori
  }, 30_000);
});

describe("reads", () => {
  it("are Dirichlet posteriors with exact Beta intervals", () => {
    const si = S("vsFlopCbet");
    const counts = [15, 6, 2];
    const r = readOutcome(counts, si, 0);
    const mu = PRIOR[si].mean[0];
    const a = DEFAULT_K * mu + 15;
    const b = DEFAULT_K * (1 - mu) + 8;
    expect(r.mean).toBeCloseTo(a / (a + b), 14);
    expect(r.lo).toBeCloseTo(betaQuantile(0.05, a, b), 14);
    expect(r.hi).toBeCloseTo(betaQuantile(0.95, a, b), 14);
    expect(r.shape).toBe("between");
    expect(readProbAbove(r, r.lo)).toBeCloseTo(0.95, 12);
    expect(readProbAbove(r, r.hi)).toBeCloseTo(0.05, 12);
    expect(describeRead(r, "Bob")).toMatch(/^After 23 flop c-bets faced, I'm 90% sure Bob folds between \d+% and \d+% of the time \(best guess \d+%\)\.$/);
    expect(compareRead(r, "Bob")).toMatch(/^I'm \d+% sure Bob folds facing a flop c-bet (more|less) often than a typical player\.$/);
    // Never seen: an upper bound holding 90% of the posterior; always seen: a lower bound.
    const never = readOutcome([0, 9, 0], si, 0);
    expect(never.shape).toBe("atMost");
    expect(never.lo).toBe(0);
    expect(describeRead(never, "Bob")).toMatch(/Bob folds at most \d+% of the time/);
    const always = readOutcome([1, 0, 0], si, 0);
    expect(always.shape).toBe("atLeast");
    expect(describeRead(always, "Bob")).toMatch(/^After 1 flop c-bet faced, I'm 90% sure Bob folds at least \d+%/);
  });

  it("compare with the population mean, and say so when there are too few spots", () => {
    SITUATIONS.forEach((sit, si) =>
      sit.outcomes.forEach((_, o) => {
        const r = readOutcome(sit.outcomes.map(() => 0), si, o);
        expect(r.typical).toBe(PRIOR[si].mean[o]);
        expect(r.tooFew).toBe(true);
        expect(compareRead(r, "Bob")).toBe("No spots yet: 4 needed to compare Bob with a typical player here.");
      }),
    );
    const two = readOutcome([1, 1, 0], S("vsFlopCbet"), 0);
    expect(two.tooFew).toBe(true);
    expect(compareRead(two, "Bob")).toBe("Only 2 of 4 spots needed to compare Bob with a typical player here.");
    expect(readOutcome([1, 2, 1], S("vsFlopCbet"), 0).tooFew).toBe(false);
    expect(topReads(emptySituationCounts(), "Bob")).toEqual([]);
  });

  it("move with the player's own data once n ≥ k", () => {
    const si = S("vsOpen");
    const none = readOutcome([0, 0, 0], si, 0).pAboveTypical;
    const threeBets = readOutcome([2, 2, 0], si, 0);
    const folds = readOutcome([0, 0, 4], si, 0);
    expect(threeBets.pAboveTypical).toBeGreaterThan(none);
    expect(folds.pAboveTypical).toBeLessThan(none);
    expect(compareRead(threeBets, "Bob")).toMatch(/Bob 3-bets facing an open more often/);
    expect(compareRead(folds, "Bob")).toMatch(/Bob 3-bets facing an open less often/);
  });

  it("don't call a below-average rate of a rare action 'more often'", () => {
    // TAG's 4-bets facing a 3-bet: 2 in 100, below the population mean 4.8%.
    const fourBet = readOutcome([2, 13, 85], S("vs3bet"), 0);
    expect(fourBet.pAboveTypical).toBeLessThan(0.1);
    expect(compareRead(fourBet, "TAG")).toMatch(/^I'm 9\d% sure TAG 4-bets facing a 3-bet after opening less often than a typical player\.$/);
    // 3-bets facing an open: estimate 6.0%, below the mean 7.7%; it must not rank as "more often".
    const counts = emptySituationCounts();
    counts[S("vsOpen")] = [12, 95, 93];
    const threeBet = readOutcome(counts[S("vsOpen")], S("vsOpen"), 0);
    expect(threeBet.mean).toBeLessThan(PRIOR[S("vsOpen")].mean[0]);
    expect(threeBet.pAboveTypical).toBeLessThan(0.5);
    const ranked = topReads(counts, "TAG", { limit: 100 }).find((r) => r.read.situation === S("vsOpen") && r.read.outcome === 0);
    expect(ranked?.comparison).toMatch(/TAG 3-bets facing an open less often/);
  });

  it("rank only situations seen at least k times", () => {
    // A single 3-bet facing an open is too few to compare; ranked reads need n ≥ k.
    expect(readOutcome([1, 0, 0], S("vsOpen"), 0).tooFew).toBe(true);
    const tagReads = (hands: number) => {
      let reader = createReader();
      for (let h = 0; h < hands; h++) {
        const state = playHand({ personas: [TAG, TAG], stacks: [10_000, 10_000], button: h % 2 }, 500 + h);
        reader = addHand(reader, observe(state, ["bob", null], 1));
      }
      return playerReads(reader, "bob", "Bob", { limit: 100 });
    };
    // Three hands: no situation can have been met 4 times (at most once per hand), so nothing is ranked.
    expect(tagReads(3)).toEqual([]);
    const ten = tagReads(10);
    expect(ten.length).toBeGreaterThan(0);
    for (const r of ten) expect(r.read.n).toBeGreaterThanOrEqual(DEFAULT_K);
    expect(playerReads(createReader(), "nobody", "Bob")).toEqual([]);
  });

  it("rank the most unusual reads first", () => {
    let reader = createReader();
    for (let h = 0; h < 150; h++) {
      const state = playHand({ personas: [PERSONAS.station, TAG], stacks: [10_000, 10_000], button: h % 2 }, 1_000 + h);
      reader = addHand(reader, observe(state, ["bob", null], 1));
    }
    const reads = playerReads(reader, "bob", "Bob", { limit: 4 });
    expect(reads).toHaveLength(4);
    for (let i = 1; i < reads.length; i++) expect(reads[i].confidence).toBeLessThanOrEqual(reads[i - 1].confidence);
    expect(reads[0].confidence).toBeGreaterThan(0.99); // a station is far from typical somewhere
    // A station calls opens far more than a typical player.
    const call = playerRead(reader, "bob", "vsOpen", "call");
    expect(call.pAboveTypical).toBeGreaterThan(0.99);
    expect(compareRead(call, "Bob")).toMatch(/Bob calls facing an open more often/);
  });
});

describe("calibration (reduced)", () => {
  it("90% intervals cover the truth 86-94% of the time at 25, 100 and 400 hands", () => {
    // 30 sessions per persona (the full run, scripts/calibrate.ts, uses 1,000 and gets within 87-93%).
    const checkpoints = [25, 100, 400];
    const rates = checkpoints.map(() => ({ covered: 0, total: 0 }));
    for (const p of PERSONA_IDS) {
      const snaps = Array.from({ length: 30 }, (_, s) => sessionSnapshots(p, checkpoints, sessionSeed(p, s)));
      checkpoints.forEach((_, ci) => (rates[ci] = pool([rates[ci], ...coverage(p, snaps.map((x) => x[ci]), { k: DEFAULT_K })])));
    }
    for (const r of rates) {
      expect(r.total).toBeGreaterThan(2_000);
      expect(coverageRate(r)).toBeGreaterThan(0.86);
      expect(coverageRate(r)).toBeLessThan(0.94);
    }
  }, 30_000);
});

describe("reader", () => {
  it("is pure and follows players across seats", () => {
    const a = playHand({ personas: [TAG, PERSONAS.maniac], stacks: [10_000, 10_000], button: 0 }, 5);
    const b = playHand({ personas: [PERSONAS.maniac, TAG], stacks: [10_000, 10_000], button: 1 }, 6);
    const r0 = createReader();
    const r1 = addHand(r0, observe(a, ["me", "max"], 0));
    const r2 = addHand(r1, observe(b, ["max", "me"], 1));
    expect(r0.players).toEqual({});
    expect(Object.keys(r1.players).sort()).toEqual(["max", "me"]);
    expect(r1.players.max.hands).toBe(1);
    expect(r2.players.max.hands).toBe(2);
    expect(JSON.stringify(addHand(r1, observe(b, ["max", "me"], 1)))).toBe(JSON.stringify(r2)); // deterministic
    // A null id is not modeled.
    expect(Object.keys(addHand(r0, observe(a, [null, "max"], 0)).players)).toEqual(["max"]);
  });
});
