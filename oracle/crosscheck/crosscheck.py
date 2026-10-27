"""Judge lib/poker (TypeScript) against the independent Python oracle.

    python3 oracle/crosscheck/crosscheck.py            # all criteria
    python3 oracle/crosscheck/crosscheck.py c1 c4      # selected criteria (c1..c7)
    python3 oracle/crosscheck/crosscheck.py c2 --deep  # c2 also histogram-matches all 7-card hands vs oracle (minutes)

Prints PASS/FAIL per criterion with evidence. Exit code 1 if anything fails.
"""

import itertools
import json
import os
import random
import subprocess
import sys
import tempfile
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from fractions import Fraction
from math import comb, sqrt
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE.parent))
import poker_oracle as po  # noqa: E402

RUNNER = HERE / "ts_runner.ts"
HOOK = (REPO / "lib/poker/scripts/register-ts.mjs").as_uri()
WORK = Path(tempfile.mkdtemp(prefix="pokerxc-"))
CAT_NAMES = po.CATEGORY_NAMES  # same strings as the TS HandCategory union
results = {}


def ts(job, binary=False):
    jp, op = WORK / f"{job['op']}.json", WORK / f"{job['op']}.out"
    jp.write_text(json.dumps(job))
    subprocess.run(["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", HOOK,
                    str(RUNNER), str(jp), str(op)], check=True, cwd=REPO)
    return op.read_bytes() if binary else json.loads(op.read_text())


def verdict(name, ok, lines):
    results[name] = ok
    print(f"\n=== {name}: {'PASS' if ok else 'FAIL'}")
    for line in lines:
        print("   " + line)


def hand_str(cards):
    return "".join(po.card_str(c) for c in cards)


# ---------------------------------------------------------------- bijection oracle tuple <-> TS value

_BIJ = None


def bijection():
    """Map every oracle 5-card value tuple to the TS value of the same hands (built in c1)."""
    global _BIJ
    if _BIJ is None:
        raw = ts({"op": "all5"}, binary=True)
        vals = memoryview(raw).cast("H")
        t2v, v2t = {}, {}
        bad = 0
        for i, hand in enumerate(itertools.combinations(range(52), 5)):
            t, v = po.eval5(hand), vals[i]
            if t2v.setdefault(t, v) != v or v2t.setdefault(v, t) != t:
                bad += 1
        _BIJ = (t2v, v2t, bad, vals)
    return _BIJ


def c1():
    t0 = time.time()
    t2v, v2t, bad, vals = bijection()
    cats = ts({"op": "categories"})
    lines = []
    count = Counter(cats[v - 1] for v in vals)
    expect = {"straight flush": 40, "quads": 624, "full house": 3744, "flush": 5108, "straight": 10200,
              "trips": 54912, "two pair": 123552, "pair": 1098240, "high card": 1302540}
    ok_counts = dict(count) == expect
    lines.append(f"TS category counts over 2,598,960 hands == expected: {ok_counts} {dict(count)}")
    distinct = len(set(vals))
    lines.append(f"TS distinct values: {distinct}, range {min(vals)}..{max(vals)}")
    lines.append(f"hands where oracle-tuple<->TS-value mapping is not one-to-one: {bad}")
    order = [t2v[t] for t in sorted(t2v)]
    monotone = order == list(range(1, 7463))
    lines.append(f"oracle tuples sorted ascending map to TS values 1..7462 in order (full ordering proof): {monotone}")
    cat_ok = all(CAT_NAMES[t[0]] == cats[v - 1] for t, v in t2v.items())
    lines.append(f"TS handCategory(value) == oracle category for all 7462 values: {cat_ok}")
    rng = random.Random(1)
    pairs = [(rng.sample(range(52), 5), rng.sample(range(52), 5)) for _ in range(500_000)]
    tv = ts({"op": "eval", "hands": [hand_str(h) for pr in pairs for h in pr]})
    mism = 0
    for k, (a, b) in enumerate(pairs):
        ta, tb = po.eval5(a), po.eval5(b)
        va, vb = tv[2 * k][0], tv[2 * k + 1][0]
        mism += ((ta > tb) - (ta < tb)) != ((va > vb) - (va < vb))
    lines.append(f"random 500,000 hand pairs: sign(TS a-b) != sign(oracle a-b) in {mism} pairs")
    lines.append(f"({time.time() - t0:.0f}s)")
    verdict("1. 5-card counts/distinct/ordering",
            ok_counts and distinct == 7462 and bad == 0 and monotone and cat_ok and mism == 0, lines)


def _oracle7_shard(first):
    cnt = Counter()
    for rest in itertools.combinations(range(first + 1, 52), 6):
        cnt[po.evaluate((first,) + rest)] += 1
    return cnt


def c2(deep):
    t0 = time.time()
    hist = ts({"op": "hist7"})
    t_ts = time.time() - t0
    cats = ts({"op": "categories"})
    count = Counter()
    for v in range(1, 7463):
        count[cats[v - 1]] += hist[v]
    expect = {"straight flush": 41584, "quads": 224848, "full house": 3473184, "flush": 4047644,
              "straight": 6180020, "trips": 6461620, "two pair": 31433400, "pair": 58627800,
              "high card": 23294460}
    total = sum(hist)
    distinct = sum(1 for h in hist[1:] if h)
    ok = {k: int(v) for k, v in count.items()} == expect and total == comb(52, 7) and distinct == 4824 and hist[0] == 0
    lines = [f"own Node loop over all 7-card hands ({t_ts:.1f}s incl. startup): total {int(total):,}, "
             f"distinct {distinct}, value-0 count {int(hist[0])}",
             f"category counts == expected: {ok} {dict((k, int(v)) for k, v in count.items())}"]
    r = subprocess.run("npm run test:slow 2>&1 | tail -6", shell=True, cwd=REPO, capture_output=True, text=True)
    slow_ok = "passed" in r.stdout and "failed" not in r.stdout
    lines.append("npm run test:slow -> " + " | ".join(l.strip() for l in r.stdout.strip().splitlines()[-4:]))
    ok = ok and slow_ok
    if deep:
        t1 = time.time()
        t2v = bijection()[0]
        oracle = Counter()
        with ProcessPoolExecutor() as pool:
            for c in pool.map(_oracle7_shard, range(46)):
                oracle.update(c)
        ohist = [0] * 7463
        for t, n in oracle.items():
            ohist[t2v[t]] += n
        same = ohist == [int(h) for h in hist]
        lines.append(f"--deep: per-value histogram (7,462 bins) of TS == oracle over all 133,784,560 hands: "
                     f"{same} ({time.time() - t1:.0f}s)")
        ok = ok and same
    verdict("2. 7-card counts/distinct", ok, lines)


def c3():
    t2v, v2t, _, vals = bijection()
    cats = ts({"op": "categories"})
    rng = random.Random(3)
    hands = []
    for n, k in ((5, 20_000), (6, 50_000), (7, 100_000)):
        hands += [rng.sample(range(52), n) for _ in range(k)]
    for _ in range(30_000):  # flush / straight-flush heavy
        suit = rng.randrange(4)
        suited = [r * 4 + suit for r in rng.sample(range(13), rng.randint(4, 7))]
        rest = [c for c in range(52) if c not in suited]
        hands.append((suited + rng.sample(rest, 3))[:rng.choice((6, 7))])
    out = ts({"op": "eval", "hands": [hand_str(h) for h in hands]})
    bad_api = bad_pos = 0
    first_bad = None
    for h, (va, vp) in zip(hands, out):
        want = t2v[po.best_hand_reference(h)]
        if va != want:
            bad_api += 1
            first_bad = first_bad or (hand_str(h), va, want)
        if vp != want:
            bad_pos += 1
    n6 = sum(len(h) == 6 for h in hands)
    n7 = sum(len(h) == 7 for h in hands)
    lines = [f"{len(hands):,} random hands ({n6:,} six-card, {n7:,} seven-card, 30k flush-biased): "
             f"evaluate() mismatches vs oracle best-5-subset {bad_api}, evaluateN() mismatches {bad_pos}"
             + (f" first: {first_bad}" if first_bad else "")]
    wheel = ts({"op": "eval", "hands": ["As2d3h4c5s", "As2s3s4s5s", "Ac2d3h4s5c6d", "As2s3s4s5s6s"]})
    straights = [v for v in range(1, 7463) if cats[v - 1] == "straight"]
    sfs = [v for v in range(1, 7463) if cats[v - 1] == "straight flush"]
    w_ok = wheel[0][0] == min(straights) and wheel[1][0] == min(sfs) and wheel[2][0] == min(straights) + 1 \
        and wheel[3][0] == min(sfs) + 1
    lines.append(f"wheel={wheel[0][0]} (min straight {min(straights)}), steel wheel={wheel[1][0]} "
                 f"(min SF {min(sfs)}), A23456={wheel[2][0]}, 6-high SF={wheel[3][0]}: {w_ok}")
    verdict("3. wheel + 6/7-card == best 5-subset", bad_api == 0 and bad_pos == 0 and w_ok, lines)


# ---------------------------------------------------------------- equity

def random_spots(seed, n):
    rng = random.Random(seed)
    spots = []
    for i in range(n):
        players = rng.choice((2, 3))
        bsize = rng.choice((3, 4, 5))
        ndead = rng.choice((0, 0, 1, 2, 3))
        deck = rng.sample(range(52), 2 * players + bsize + ndead)
        hands = [hand_str(deck[2 * p:2 * p + 2]) for p in range(players)]
        board = hand_str(deck[2 * players:2 * players + bsize])
        dead = hand_str(deck[2 * players + bsize:])
        spots.append({"hands": hands, "board": board, "dead": dead})
    return spots


def split_spots(seed, n):
    """River boards where nobody can beat the board: broadway with <=2 per suit, or a royal flush."""
    rng = random.Random(seed)
    spots = []
    for i in range(n):
        if i % 4 == 3:
            s = rng.randrange(4)
            board = [r * 4 + s for r in (8, 9, 10, 11, 12)]
        else:
            while True:
                board = [r * 4 + rng.randrange(4) for r in (8, 9, 10, 11, 12)]
                if max(Counter(c % 4 for c in board).values()) <= 2:
                    break
        rest = [c for c in range(52) if c not in board]
        players = rng.choice((2, 3))
        deck = rng.sample(rest, 2 * players + 1)
        spots.append({"hands": [hand_str(deck[2 * p:2 * p + 2]) for p in range(players)],
                      "board": hand_str(board), "dead": hand_str(deck[-1:]) if i % 2 else ""})
    return spots


PREFLOP = [
    ["AhKh", "QhJh"],   # suited vs suited, same suit
    ["AsKs", "7s6s"],   # same suit, dominated flush
    ["7c7d", "AhKs"],   # pair vs overcards
    ["AsKd", "AcQh"],   # dominated
    ["AhAs", "KdKc"],
    ["9s8s", "AcAd"],
]


def _oracle_exact(spot):
    return po.equity(spot["hands"], spot["board"], spot["dead"], processes=1)


def compare_exact(spot, o, t):
    if not t["ok"]:
        return f"TS error {t['error']}"
    tv = t["value"]
    if tv["samples"] != o["boards"]:
        return f"samples {tv['samples']} != {o['boards']}"
    worst = 0.0
    for p, pl in enumerate(tv["players"]):
        for k in ("win", "tie", "equity"):
            worst = max(worst, abs(pl[k] - float(o[k][p])))
    return worst


def c4():
    lines = []
    ok = True
    rnd, spl = random_spots(4, 200), split_spots(44, 24)
    spots = rnd + spl
    with ProcessPoolExecutor() as pool:
        oracle = list(pool.map(_oracle_exact, spots, chunksize=8))
    tsr = ts({"op": "exact", "spots": spots})
    worst, fails = 0.0, []
    for s, o, t in zip(spots, oracle, tsr):
        d = compare_exact(s, o, t)
        if isinstance(d, str) or d > 1e-9:
            fails.append((s, d))
        else:
            worst = max(worst, d)
    split_ok = all(all(pl["tie"] == 1 for pl in t["value"]["players"]) for t in tsr[len(rnd):])
    nd = sum(1 for s in rnd if s["dead"])
    lines.append(f"{len(rnd)} random flop/turn/river spots (2-3 players, {nd} with dead cards) + {len(spl)} "
                 f"guaranteed splits: {len(fails)} mismatches, worst |diff| {worst:.2e}; all splits tie=1: {split_ok}")
    for s, d in fails[:3]:
        lines.append(f"  MISMATCH {s} -> {d}")
    ok &= not fails and split_ok

    # preflop heads-up, oracle multiprocess per spot
    pre = [{"hands": h, "board": "", "dead": ""} for h in PREFLOP]
    t0 = time.time()
    pre_oracle = [po.equity(s["hands"]) for s in pre]
    t_or = time.time() - t0
    pre_ts = ts({"op": "exact", "spots": pre})
    for s, o, t in zip(pre, pre_oracle, pre_ts):
        d = compare_exact(s, o, t)
        good = not isinstance(d, str) and d <= 1e-9
        ok &= good
        lines.append(f"preflop {s['hands'][0]} vs {s['hands'][1]}: oracle eq {float(o['equity'][0]) * 100:.4f}% "
                     f"tie {float(o['tie'][0]) * 100:.4f}% | TS eq {t['value']['players'][0]['equity'] * 100:.4f}% "
                     f"| worst |diff| {d if isinstance(d, str) else f'{d:.1e}'}")
    lines.append(f"(oracle preflop total {t_or:.0f}s)")
    _PRE_CACHE[:] = list(zip(pre, pre_oracle))

    # Monte Carlo vs exact
    mc_spots = []  # (label, spec for TS, exact Fractions for player 0 + HU E[s^2])
    for s, o in _PRE_CACHE:
        mc_spots.append((f"{s['hands'][0]} vs {s['hands'][1]} preflop", s["hands"], "", "", o))
    for s in random_spots(41, 8):
        mc_spots.append((f"{' vs '.join(s['hands'])} on {s['board']} dead[{s['dead']}]", s["hands"], s["board"],
                         s["dead"], _oracle_exact(s)))
    for label, ranges, board, dead in RANGE_SPOTS:
        t0 = time.time()
        o = range_exact(ranges, board, dead)
        mc_spots.append((f"{' | '.join(ranges)} on {board or 'preflop'} dead[{dead}] ({label}, oracle "
                         f"{time.time() - t0:.0f}s)", ranges, board, dead, o))
    job = [{"ranges": r, "board": b, "dead": d, "seed": 1000 + i} for i, (_, r, b, d, _) in enumerate(mc_spots)]
    mc = ts({"op": "mc", "spots": job})
    zs, worst_pp, se_ratio = [], 0.0, []
    lines.append(f"Monte Carlo at default trials, {len(mc_spots)} spots (player 1 shown):")
    for (label, r, b, d, o), m in zip(mc_spots, mc):
        if not m["ok"]:
            ok = False
            lines.append(f"  TS error on {label}: {m['error']}")
            continue
        v = m["value"]
        for p, pl in enumerate(v["players"]):
            diff = pl["equity"] - float(o["equity"][p])
            worst_pp = max(worst_pp, abs(diff) * 100)
            if pl["stdErr"]:
                zs.append(diff / pl["stdErr"])
            elif diff != 0:
                zs.append(float("inf"))  # stdErr 0 is only right when the result is exact
        p0 = v["players"][0]
        if len(r) == 2:  # heads-up: per-trial share is 1, 1/2 or 0 -> E[s^2] = win + tie/4
            var = float(o["win"][0] + o["tie"][0] / 4 - o["equity"][0] ** 2)
            if var > 0:
                se_ratio.append(p0["stdErr"] / sqrt(var / v["samples"]))
            elif p0["stdErr"] != 0:
                se_ratio.append(float("inf"))  # deterministic spot must report stdErr 0
        lines.append(f"  {label}: exact {float(o['equity'][0]) * 100:.3f}%  MC {p0['equity'] * 100:.3f}% "
                     f"± {p0['stdErr'] * 100:.3f}  ({v['samples']:,} trials, {m['value']['ms']:.0f} ms)")
    rms = sqrt(sum(z * z for z in zs) / len(zs))
    mc_ok = worst_pp < 0.5 and max(abs(z) for z in zs) < 4.5 and 0.6 < rms < 1.4 and \
        all(0.95 < x < 1.05 for x in se_ratio)
    lines.append(f"MC worst |MC-exact| {worst_pp:.3f} pp (limit 0.5); z=(MC-exact)/stdErr over {len(zs)} "
                 f"player-results: max|z| {max(abs(z) for z in zs):.2f}, RMS {rms:.2f} (expect ~1); "
                 f"reported stdErr / theoretical SE (heads-up): {min(se_ratio):.3f}..{max(se_ratio):.3f}")
    verdict("4. exact + Monte Carlo equity", ok and mc_ok, lines)


_PRE_CACHE = []

RANGE_SPOTS = [
    ("overlap AK", ["AK, KQ, 99, 44", "AK, AQ, TT+"], "Ks9d4c", ""),
    ("identical ranges -> 50%", ["AA, KK, AK", "AA, KK, AK"], "Qs7h2d", ""),
    ("turn", ["AK, AQ, 77, 55", "AJ+, 66, 43s"], "Ah7d2c5s", ""),
    ("draws vs made", ["QhJh, AhKh, 99+, AT", "TT, AA, KQ, QJs"], "Th9h2d", ""),
    ("3-way turn", ["JJ+, AJ", "88, 33, AK", "KQ, QT, T9s"], "Jc8s3d2h", ""),
    ("river", ["AK, A7, 44", "AQ, KK, 77, 53s"], "AsKd7c4h2s", ""),
    ("dead card", ["TcJc, QcKc, 99, 88, A9s", "AA, KK, Tc7c, 98s"], "9c8c2h3d", "Ac"),
    ("preflop small ranges", ["AKs", "QQ"], "", ""),
]


def _range_job(args):
    hands, board, dead = args
    return po.equity(hands, board, dead, processes=1)


def range_exact(ranges, board, dead):
    """Exact range-vs-range: every disjoint combo assignment equally weighted, all boards."""
    blocked = po.parse_cards(board) + po.parse_cards(dead)
    expanded = [po.expand_range(r, blocked) for r in ranges]
    jobs = []
    for pick in itertools.product(*expanded):
        cards = [c for combo in pick for c in combo]
        if len(set(cards)) == len(cards):
            jobs.append(([list(c) for c in pick], board, dead))
    n = len(ranges)
    win, tie, eq = [Fraction(0)] * n, [Fraction(0)] * n, [Fraction(0)] * n
    with ProcessPoolExecutor() as pool:
        for r in pool.map(_range_job, jobs, chunksize=max(1, len(jobs) // 64)):
            for p in range(n):
                win[p] += r["win"][p]
                tie[p] += r["tie"][p]
                eq[p] += r["equity"][p]
    k = len(jobs)
    return {"win": [w / k for w in win], "tie": [t / k for t in tie], "equity": [e / k for e in eq]}


# ---------------------------------------------------------------- ranges

FORMS = ["22", "22+", "TT+", "22-55", "55-22", "AKs", "AKo", "AK", "ATs+", "ATo+", "AT+", "KTs-K7s",
         "K7s-KTs", "A5s-A2s", "K9-K6", "AhKh", "ahkh", "QQ+, AKs, AhKh", "AA-22", "T9s+", "32s", "A2s-A2s",
         "22+,AKs,ATs+,KTs-K7s,A5s-A2s,AhKh", " 99 ,  AJo+ , 7c6c ", "AsAh,AhAs"]
MALFORMED = ["KTs-Q7s", "AAs", "AKx", "AhAh", "22-AKs", "ATs-A5o", "1A", "AK+s", "A", "AKss", "22++", "AsKsQs",
             "Ax", "ZZ", "T9-T9s", "AK-", "-AK", "22-", "A5s-A2", "10s", "AsAs", "KK-AK", "AKo-AKs", "QQ+-22",
             "AK,,QQ", "AK;QQ", "AKs+-", "XhKh", "AhKx", "", " , ", "TKs-T7s", "A K s", "AhKH",
             # Reversed rank order is rejected by design (lib/poker/README.md).
             "KA", "TKs", "TK+", "TAs+", "23s"]


def random_range_text(rng):
    toks = []
    for _ in range(rng.randint(1, 7)):
        kind = rng.randrange(7)
        hi = rng.randrange(1, 13)
        lo = rng.randrange(0, hi)
        sfx = rng.choice(["", "s", "o"])
        R = po.RANKS
        if kind == 0:
            toks.append(R[hi] * 2 + rng.choice(["", "+"]))
        elif kind == 1:
            a, b = rng.randrange(13), rng.randrange(13)
            toks.append(f"{R[a] * 2}-{R[b] * 2}")
        elif kind == 2:
            toks.append(R[hi] + R[lo] + sfx + rng.choice(["", "+"]))
        elif kind == 3:
            k2 = rng.randrange(0, hi)
            toks.append(f"{R[hi]}{R[lo]}{sfx}-{R[hi]}{R[k2]}{sfx}")
        elif kind == 4:
            c = rng.sample(range(52), 2)
            toks.append(po.card_str(c[0]) + po.card_str(c[1]))
        else:
            toks.append(R[hi] * 2)
    return ",".join(toks)


def c5():
    lines, ok = [], True
    rng = random.Random(5)
    texts = FORMS + [random_range_text(rng) for _ in range(300)]
    parsed = ts({"op": "parse", "texts": texts})
    mism = []
    for t, r in zip(texts, parsed):
        want = sorted(po.combo_str(c) for c in po.expand_range(t))
        if not r["ok"] or sorted(r["value"]) != want:
            mism.append((t, r.get("error") or len(r["value"]), len(want)))
    lines.append(f"{len(FORMS)} notation forms + 300 random ranges: TS parseRange set == oracle set "
                 f"in {len(texts) - len(mism)}/{len(texts)}" + (f"; first mismatches {mism[:3]}" if mism else ""))
    ok &= not mism

    rt = ts({"op": "roundtrip", "texts": texts})
    rt_bad = [t for t, r in zip(texts, rt)
              if not r["ok"] or sorted(r["value"]["combos"]) != sorted(r["value"]["original"])
              or sorted(po.combo_str(c) for c in po.expand_range(r["value"]["formatted"])) !=
              sorted(po.combo_str(c) for c in po.expand_range(t))]
    lines.append(f"round-trip parse(format(parse(x))) == parse(x), and oracle(format(...)) == oracle(x): "
                 f"{len(texts) - len(rt_bad)}/{len(texts)} ok" + (f"; bad {rt_bad[:3]}" if rt_bad else ""))
    ex = [r["value"]["formatted"] for r in rt[:len(FORMS)] if r["ok"]][-7:-3]
    lines.append(f"  sample formatRange output: {ex}")
    ok &= not rt_bad

    sets = []
    for _ in range(200):  # arbitrary combo sets, incl. partial classes
        k = rng.randint(1, 120)
        sets.append([po.combo_str((max(a, b), min(a, b))) for a, b in
                     (rng.sample(range(52), 2) for _ in range(k))])
    for _ in range(50):  # whole classes minus a few combos
        base = po.expand_range(random_range_text(rng))
        sets.append([po.combo_str(c) for c in base if rng.random() > 0.1] or ["AsKs"])
    fs = ts({"op": "formatSets", "sets": sets})
    fs_bad = [i for i, (s, r) in enumerate(zip(sets, fs))
              if not r["ok"] or sorted(r["value"]["combos"]) != sorted(set(s))
              or sorted(po.combo_str(c) for c in po.expand_range(r["value"]["formatted"])) != sorted(set(s))]
    lines.append(f"250 arbitrary combo sets -> formatRange -> parse (TS and oracle): {250 - len(fs_bad)}/250 ok")
    ok &= not fs_bad

    items = [{"text": "AK", "dead": ""}, {"text": "AK", "dead": "As"}, {"text": "AK", "dead": "AsKd"},
             {"text": "AA", "dead": "Ah"}]
    for _ in range(150):
        items.append({"text": random_range_text(rng), "dead": hand_str(rng.sample(range(52), rng.randint(1, 5)))})
    rd = ts({"op": "removeDead", "items": items})
    rd_bad = [it for it, r in zip(items, rd) if not r["ok"] or sorted(r["value"]) !=
              sorted(po.combo_str(c) for c in po.expand_range(it["text"], it["dead"]))]
    lines.append(f"card removal: AK={len(rd[0]['value'])}, AK dead As={len(rd[1]['value'])}, "
                 f"AK dead AsKd={len(rd[2]['value'])}, AA dead Ah={len(rd[3]['value'])}; "
                 f"154 cases vs oracle: {154 - len(rd_bad)}/154 ok")
    ok &= not rd_bad and [len(rd[i]["value"]) for i in range(4)] == [16, 12, 9, 3]

    mal = ts({"op": "parse", "texts": MALFORMED})
    accepted = [(t, len(r["value"])) for t, r in zip(MALFORMED, mal) if r["ok"]]
    lines.append(f"malformed inputs: {len(MALFORMED) - len(accepted)}/{len(MALFORMED)} throw; accepted: {accepted}")
    # Judgement: empty input -> [] and whitespace inside tokens are lenient but not garbage; anything else is.
    lenient = {"", " , ", "A K s", "AK,,QQ"}
    garbage = [a for a in accepted if a[0] not in lenient]
    ok &= not garbage
    verdict("5. range parser", ok, lines)


def c6():
    r = subprocess.run("npm run bench 2>&1", shell=True, cwd=REPO, capture_output=True, text=True)
    lines = ["npm run bench:"] + ["  " + l for l in r.stdout.strip().splitlines() if l and not l.startswith(">")]
    b = ts({"op": "bench", "n": 2_000_000})
    rate = b["n"] / b["bestMs"] * 1000
    lines.append(f"own bench (xorshift hands, checksum consumed): {rate / 1e6:.1f}M evals/s best of 5 "
                 f"(times {[round(t) for t in b['times']]} ms); checksum {b['sum']} == evaluate() array-path "
                 f"checksum {b['check']}: {b['sum'] == b['check']}")
    verdict("6. >= 1M random 7-card evals/s", rate >= 1e6 and b["sum"] == b["check"] and r.returncode == 0, lines)


def c7():
    lines, ok = [], True
    for cmd in ("npm test", "npx tsc --noEmit", "npm run lint"):
        r = subprocess.run(cmd + " 2>&1", shell=True, cwd=REPO, capture_output=True, text=True)
        tail = [l.strip() for l in r.stdout.strip().splitlines() if l.strip()][-3:]
        lines.append(f"{cmd}: exit {r.returncode} | {' | '.join(tail) or '(no output)'}")
        ok &= r.returncode == 0
    verdict("7. npm test / tsc / lint", ok, lines)


if __name__ == "__main__":
    args = sys.argv[1:]
    deep = "--deep" in args
    want = [a for a in args if a.startswith("c")] or ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]
    for name in want:
        if name == "c2":
            c2(deep)
        else:
            globals()[name]()
    print("\nSUMMARY: " + ", ".join(f"{k.split('.')[0]}={'PASS' if v else 'FAIL'}" for k, v in results.items()))
    sys.exit(0 if all(results.values()) else 1)
