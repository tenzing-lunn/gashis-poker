"""Independent judge for lib/sim (weighted / multiway equity, breakdown).

References come from oracle/poker_oracle.py (stdlib evaluator, exact Fractions); this file only adds
weighting, joint enumeration and statistics. TypeScript is driven through lib/sim/oracle/ts_runner.ts.

  python3 lib/sim/oracle/check.py [c1 c2 c3 c4 c5 c6 c7]     # default: all
"""
from __future__ import annotations

import itertools
import json
import math
import os
import random
import subprocess
import sys
import tempfile
import time
from fractions import Fraction
from multiprocessing import Pool

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "oracle"))
import poker_oracle as O  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
N = 1326
COMBO = []  # index -> (hi, lo), index = hi(hi-1)/2 + lo
for x in range(1, 52):
    for y in range(x):
        COMBO.append((x, y))
assert len(COMBO) == N and all(COMBO[x * (x - 1) // 2 + y] == (x, y) for x, y in COMBO)


def cidx(a, b):
    x, y = max(a, b), min(a, b)
    return x * (x - 1) // 2 + y


def cards(s):
    return O.parse_cards(s)


def ts(tasks):
    with tempfile.TemporaryDirectory() as d:
        i, o = os.path.join(d, "in.json"), os.path.join(d, "out.json")
        with open(i, "w") as f:
            json.dump(tasks, f)
        subprocess.run(
            ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./lib/poker/scripts/register-ts.mjs",
             "lib/sim/oracle/ts_runner.ts", i, o], cwd=ROOT, check=True)
        with open(o) as f:
            return json.load(f)


FAILS: list[str] = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("  FAIL:", msg)
    return cond


# ------------------------------------------------------------------ exact heads-up reference (oracle evaluator)

def hu_counts(args):
    """win/tie runout counts of hero vs each combo, by brute force over every runout (O.evaluate)."""
    hero, board, dead, combos = args
    used = set(hero) | set(board) | set(dead)
    deck = [c for c in range(52) if c not in used]
    need = 5 - len(board)
    win = {c: 0 for c in combos}
    tie = {c: 0 for c in combos}
    seen = {c: 0 for c in combos}
    pairs = {c: COMBO[c] for c in combos}
    for run in itertools.combinations(deck, need):
        common = list(board) + list(run)
        hv = O.evaluate(list(hero) + common)
        rs = set(run)
        for c, (a, b) in pairs.items():
            if a in rs or b in rs:
                continue
            seen[c] += 1
            v = O.evaluate([a, b] + common)
            if hv > v:
                win[c] += 1
            elif hv == v:
                tie[c] += 1
    return win, tie, seen


def live_combos(weights, blocked):
    bl = set(blocked)
    return [c for c in range(N) if weights[c] > 0 and COMBO[c][0] not in bl and COMBO[c][1] not in bl]


def random_weights(rng, size, blocked, n_blocked_extra=3):
    """`size` positive-weight live combos (mixed scales, some exact ties) + a few positive weights on blocked combos."""
    bl = set(blocked)
    live = [c for c in range(N) if COMBO[c][0] not in bl and COMBO[c][1] not in bl]
    blk = [c for c in range(N) if c not in set(live)]
    w = [0.0] * N
    kind = rng.choice(["unif", "exp", "wide", "pow"])
    for c in rng.sample(live, min(size, len(live))):
        if kind == "unif":
            w[c] = rng.choice([1.0, 0.5, 0.25])
        elif kind == "exp":
            w[c] = rng.expovariate(1.0)
        elif kind == "wide":
            w[c] = 10 ** rng.uniform(-6, 3)
        else:
            w[c] = rng.random() ** 4
    for c in rng.sample(blk, min(n_blocked_extra, len(blk))):
        w[c] = 10 ** rng.uniform(-2, 4)
    return w


def random_spot(rng, street_len, n_dead):
    deck = list(range(52))
    rng.shuffle(deck)
    return deck[:2], deck[2:2 + street_len], deck[2 + street_len:2 + street_len + n_dead]


# ------------------------------------------------------------------ C1

def c1():
    print("C1 heads-up exact vs oracle")
    rng = random.Random(20261027)
    spots = []
    plan = []
    # (board length, range size, dead count)
    for L in (3, 4, 5):
        for size in (1, 2, 5, 17, 60, 150, 400):
            plan.append((L, size, rng.choice([0, 0, 1, 2])))
    plan += [(3, 1300, 0), (3, 1300, 2), (4, 1300, 0), (4, 1300, 3), (4, 900, 1), (5, 1300, 0), (5, 1300, 4), (5, 1000, 1),
             (4, 1300, 0), (5, 1300, 0)]
    plan += [(L, size, rng.choice([0, 1, 3])) for L in (3, 4, 5) for size in (3, 30, 250, 1100)] + [(3, 700, 1), (3, 1, 4)]
    for L, size, nd in plan:
        hero, board, dead = random_spot(rng, L, nd)
        w = random_weights(rng, size, hero + board + dead)
        spots.append((hero, board, dead, w))
    tasks = [{"op": "hu", "hero": h, "board": b, "dead": d, "weights": w} for h, b, d, w in spots]
    t0 = time.time()
    res = ts(tasks)
    print(f"  TS done in {time.time() - t0:.1f}s; running oracle on {len(spots)} spots ...")
    jobs = [(h, b, d, live_combos(w, h + b + d)) for h, b, d, w in spots]
    # split big jobs into chunks for the pool
    chunks, owner = [], []
    for si, (h, b, d, lc) in enumerate(jobs):
        for k in range(0, len(lc), 60):
            chunks.append((h, b, d, lc[k:k + 60]))
            owner.append(si)
    t0 = time.time()
    with Pool() as p:
        outs = p.map(hu_counts, chunks, chunksize=1)
    print(f"  oracle done in {time.time() - t0:.1f}s")
    win = [{} for _ in spots]
    tie = [{} for _ in spots]
    seen = [{} for _ in spots]
    for si, (wn, tn, sn) in zip(owner, outs):
        win[si].update(wn)
        tie[si].update(tn)
        seen[si].update(sn)

    # spot-check the brute-force loop against O.equity (the oracle's own enumeration) on a few combos
    sample = []
    for si, (h, b, d, lc) in enumerate(jobs):
        for c in lc[:1]:
            sample.append((si, c))
    with Pool() as p:
        eqs = p.starmap(O.equity, [([jobs[si][0], list(COMBO[c])], jobs[si][1], jobs[si][2], 1) for si, c in sample])
    for (si, c), e in zip(sample, eqs):
        R = e["boards"]
        check(e["win_count"][0] == win[si][c] and e["tie_count"][0] == tie[si][c] and seen[si][c] == R,
              f"C1 internal: brute loop != O.equity spot {si} combo {c}")

    maxerr = 0.0
    n_combos = 0
    for si, ((h, b, d, w), r) in enumerate(zip(spots, res)):
        lc = jobs[si][3]
        R = None
        sw = Fraction(0)
        swin = Fraction(0)
        stie = Fraction(0)
        for c in lc:
            Rc = seen[si][c]
            R = Rc if R is None else R
            check(Rc == R, f"C1 runout count differs across combos spot {si}")
            wc = Fraction(w[c])
            sw += wc
            swin += wc * win[si][c]
            stie += wc * tie[si][c]
        E = (swin + stie / 2) / (sw * R)
        Win = swin / (sw * R)
        Tie = stie / (sw * R)
        rr = r["r"]
        errs = [abs(rr["equity"] - float(E)), abs(rr["win"] - float(Win)), abs(rr["tie"] - float(Tie))]
        check(rr["exact"] and rr["samples"] == R and rr["combos"] == len(lc) and rr["stdErr"] == 0,
              f"C1 metadata spot {si}: {rr} vs R={R} combos={len(lc)}")
        ce = r["ce"]
        lcs = set(lc)
        for c in range(N):
            if c in lcs:
                e_c = Fraction(2 * win[si][c] + tie[si][c], 2 * R)
                for key, ref in (("equity", e_c), ("win", Fraction(win[si][c], R)), ("tie", Fraction(tie[si][c], R))):
                    v = ce[key][c]
                    if v is None:
                        check(False, f"C1 comboEquities {key} NaN for live combo {c} spot {si}")
                        continue
                    errs.append(abs(v - float(ref)))
                n_combos += 1
            else:
                if ce["equity"][c] is not None:
                    check(False, f"C1 comboEquities non-NaN for non-live combo {c} spot {si}")
        m = max(errs)
        maxerr = max(maxerr, m)
        check(m < 1e-9, f"C1 spot {si} hero={h} board={b} dead={d}: max err {m}")
        print(f"  spot {si:2d} board {len(b)} dead {len(d)} live {len(lc):4d}  eq ts={rr['equity']:.12f} or={float(E):.12f}  maxerr={m:.2e}")
    print(f"C1: {len(spots)} spots, {n_combos} per-combo checks, max abs err {maxerr:.3e}")


# ------------------------------------------------------------------ C2

def c2():
    print("C2 card removal / normalization")
    rng = random.Random(7)
    tasks = []
    meta = []
    for L in (0, 3, 4, 5):
        for nd in (0, 2):
            hero, board, dead = random_spot(rng, L, nd)
            blocked = hero + board + dead
            w = random_weights(rng, 200, blocked, 0)
            w2 = list(w)
            for c in range(N):  # put huge weight on every blocked combo
                if COMBO[c][0] in blocked or COMBO[c][1] in blocked:
                    w2[c] = 1e9
            ws = [x * 1e7 for x in w]
            wt = [x * 3e-12 for x in w]
            base = {"hero": hero, "board": board, "dead": dead, "trials": 20000, "seed": 5}
            for ww in (w, w2, ws, wt):
                tasks.append({"op": "eq", **base, "weights": ww})
            tasks.append({"op": "ceq", **base, "weights": w2, "trialsPerCombo": 20})
            tasks.append({"op": "live", "weights": w2, "blocked": blocked})
            meta.append((hero, board, dead, w))
    # empty / invalid ranges
    hero, board = [50, 51], [0, 1, 2]
    allblocked = [0.0] * N
    for c in range(N):
        if 50 in COMBO[c] or 51 in COMBO[c]:  # touches hero: blocked on every street
            allblocked[c] = 1.0
    bad = [
        ("zero", [0.0] * N), ("allblocked", allblocked), ("neg", [1.0] * (N - 1) + [-1.0]),
        ("nan", [1.0] * (N - 1) + [float("nan")]), ("inf", [1.0] * (N - 1) + [float("inf")]), ("short", [1.0] * 1325)]
    nbad0 = len(tasks)
    for name, ww in bad:
        for L in (0, 3):
            tasks.append({"op": "eq", "hero": hero, "board": board[:L], "dead": [], "weights": ww, "trials": 100})
        tasks.append({"op": "ceq", "hero": hero, "board": board, "dead": [], "weights": ww})
        tasks.append({"op": "mw", "hero": hero, "board": board, "dead": [], "ranges": [[1.0] * N, ww], "trials": 100})
    res = ts(_encode_special(tasks))
    k = 0
    n_ok = 0
    for hero, board, dead, w in meta:
        r0, r2, rs, rt, ce, lw = res[k:k + 6]
        k += 6
        blocked = set(hero + board + dead)
        a = r0["value"]
        same = r2["value"] == a
        check(same, f"C2 blocked-combo weights changed result board={board} dead={dead}: {a} vs {r2['value']}")
        for rx, nm in ((rs, "x1e7"), (rt, "x3e-12")):
            d = abs(rx["value"]["equity"] - a["equity"])
            tol = 1e-12 if len(board) >= 3 else 1e-12
            check(d <= tol or (len(board) == 0 and d <= 1e-12), f"C2 scaling {nm} changed equity by {d} board={board}")
        live = live_combos(w, list(blocked))
        cev = ce["value"]["equity"]
        nonlive_nan = all(cev[c] is None for c in range(N) if c not in set(live))
        live_ok = all(cev[c] is not None for c in live)
        check(nonlive_nan and live_ok, f"C2 comboEquities NaN pattern wrong board={board}")
        lwv = lw["value"]
        tot = sum(w[c] for c in live)
        errs = [abs(lwv[c] - (w[c] / tot if c in set(live) else 0.0)) for c in range(N)]
        check(max(errs) < 1e-15 and abs(sum(lwv) - 1) < 1e-12 and all(lwv[c] == 0 for c in range(N) if c not in set(live)),
              f"C2 liveWeights wrong (max err {max(errs)})")
        check(a["combos"] == len(live), f"C2 combos count {a['combos']} != {len(live)}")
        n_ok += 1
    for name, _ in bad:
        for j in range(4):
            r = res[k]
            k += 1
            check(r["ok"] is False, f"C2 invalid range '{name}' task {j} did not throw: {str(r)[:120]}")
    print(f"C2: {n_ok} spots x (blocked-weights, x1e7, x3e-12 scaling, NaN pattern, liveWeights) + {len(bad)} invalid ranges x 4 APIs")


def _encode_special(tasks):
    """NaN / Infinity aren't JSON: send them as strings, ts_runner maps them back with Number()."""
    def enc(x):
        if isinstance(x, list):
            return [enc(v) for v in x]
        if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
            return str(x).replace("nan", "NaN").replace("inf", "Infinity")
        return x
    return [{k: enc(v) for k, v in t.items()} for t in tasks]


# ------------------------------------------------------------------ C3 preflop MC

def _canon(hero, vill, dead):
    best = None
    for p in itertools.permutations(range(4)):
        f = lambda c: (c >> 2) * 4 + p[c & 3]  # noqa: E731
        key = (tuple(sorted(map(f, hero))), tuple(sorted(map(f, vill))), tuple(sorted(map(f, dead))))
        if best is None or key < best:
            best = key
    return best


def preflop_exact(hero, vill, dead, cache):
    key = json.dumps(_canon(hero, vill, dead))
    if key not in cache:
        h, v, d = json.loads(key)
        t0 = time.time()
        e = O.equity([h, v], [], d)
        cache[key] = [e["win_count"][0], e["tie_count"][0], e["boards"]]
        print(f"    oracle preflop {O.combo_str(h)} vs {O.combo_str(v)} dead {d}: {time.time() - t0:.0f}s")
    return cache[key]


def c3():
    print("C3 preflop Monte Carlo")
    cpath = os.path.join(HERE, "preflop_cache.json")
    cache = json.load(open(cpath)) if os.path.exists(cpath) else {}
    rng = random.Random(3)

    def w_of(pairs):
        w = [0.0] * N
        for s, x in pairs:
            a, b = cards(s)
            w[cidx(a, b)] = x
        return w

    QQ = ["QsQh", "QsQd", "QsQc", "QhQd", "QhQc", "QdQc"]
    spots = [
        ("AsKs", w_of([(q, rng.uniform(0.1, 2)) for q in QQ]), []),
        ("AhAd", w_of([("KsKc", 1.0), ("7h6h", 0.6), ("7s6s", 0.3)]), []),
        ("7c2d", w_of([("AhKs", 1.0), ("AcKd", 0.2), ("AdKc", 0.5)]), []),
        ("JhTh", w_of([("9s9d", 3.0), ("AsQc", 1.0), ("2h2c", 7.0)]), ["2h"]),  # 2h2c blocked by dead 2h
        ("5s5c", w_of([("AhKd", 1.0)]), []),
        ("KdQd", w_of([("AdKc", 1.0), ("AsAh", 2.0), ("JcTc", 0.5), ("9h8h", 0.25)]), ["Ac"]),
    ]
    refs = []
    for hero, w, dead in spots:
        h = cards(hero)
        d = cards("".join(dead)) if dead else []
        live = live_combos(w, h + d)
        sw = sum(Fraction(w[c]) for c in live)
        E = Fraction(0)
        per = {}
        for c in live:
            wn, tn, R = preflop_exact(h, list(COMBO[c]), d, cache)
            per[c] = Fraction(2 * wn + tn, 2 * R)
            E += Fraction(w[c]) * per[c]
        refs.append((h, d, w, E / sw, per))
        json.dump(cache, open(cpath, "w"))
    tasks = []
    SEEDS = 40
    for h, d, w, E, per in refs:
        tasks.append({"op": "eq", "hero": h, "board": [], "dead": d, "weights": w, "seed": 1})  # default 200k
        for s in range(SEEDS):
            tasks.append({"op": "eq", "hero": h, "board": [], "dead": d, "weights": w, "trials": 20000, "seed": 100 + s})
        tasks.append({"op": "ceq", "hero": h, "board": [], "dead": d, "weights": w, "trialsPerCombo": 50000, "seed": 9})
        for s in range(SEEDS):
            tasks.append({"op": "ceq", "hero": h, "board": [], "dead": d, "weights": w, "trialsPerCombo": 2000, "seed": 300 + s})
    res = ts(tasks)
    k = 0
    for i, (h, d, w, E, per) in enumerate(refs):
        big = res[k]["value"]
        k += 1
        runs = [res[k + s]["value"] for s in range(SEEDS)]
        k += SEEDS
        cbig = res[k]["value"]
        k += 1
        cruns = [res[k + s]["value"] for s in range(SEEDS)]
        k += SEEDS
        z = (big["equity"] - float(E)) / big["stdErr"]
        est = [r["equity"] for r in runs]
        mu = sum(est) / SEEDS
        sd = math.sqrt(sum((x - mu) ** 2 for x in est) / (SEEDS - 1))
        mse = sum(r["stdErr"] for r in runs) / SEEDS
        ratio = sd / mse
        zm = (mu - float(E)) / (sd / math.sqrt(SEEDS))
        check(abs(z) < 3, f"C3 spot {i}: 200k estimate {big['equity']:.5f} vs exact {float(E):.5f}, z={z:.2f}")
        check(0.7 <= ratio <= 1.4, f"C3 spot {i}: empirical sd / reported stdErr = {ratio:.3f}")
        check(abs(zm) < 3.5, f"C3 spot {i}: mean of {SEEDS} seeds biased, z={zm:.2f}")
        # comboEquities preflop per combo
        czs, cratios = [], []
        for c, pe in per.items():
            czs.append((cbig["equity"][c] - float(pe)) / cbig["stdErr"][c] if cbig["stdErr"][c] > 0 else 0.0)
            ce_est = [r["equity"][c] for r in cruns]
            m2 = sum(ce_est) / SEEDS
            sd2 = math.sqrt(sum((x - m2) ** 2 for x in ce_est) / (SEEDS - 1))
            cratios.append(sd2 / (sum(r["stdErr"][c] for r in cruns) / SEEDS))
        check(max(abs(x) for x in czs) < 3.5, f"C3 spot {i}: comboEquities preflop z {czs}")
        check(all(0.6 <= x <= 1.5 for x in cratios), f"C3 spot {i}: comboEquities sd ratios {cratios}")
        print(f"  spot {i}: exact {float(E):.5f}  ts {big['equity']:.5f} ± {big['stdErr']:.5f} (z={z:+.2f})  "
              f"sd/stdErr={ratio:.3f}  seed-mean z={zm:+.2f}  combo z max={max(abs(x) for x in czs):.2f} "
              f"combo sd ratios={','.join(f'{x:.2f}' for x in cratios)}")
    print(f"C3: {len(refs)} spots")


# ------------------------------------------------------------------ C4 multiway

def joint_exact(args):
    hero, board, dead, ranges = args
    blocked = set(hero) | set(board) | set(dead)
    lists = [[(c, Fraction(w[c])) for c in range(N) if w[c] > 0 and not (set(COMBO[c]) & blocked)] for w in ranges]
    m = len(ranges)
    tot = Fraction(0)
    eq = [Fraction(0)] * (m + 1)
    wn = [Fraction(0)] * (m + 1)
    tn = [Fraction(0)] * (m + 1)
    joint = {}
    for tup in itertools.product(*lists):
        cs = [x for c, _ in tup for x in COMBO[c]]
        if len(set(cs)) != len(cs):
            continue
        p = Fraction(1)
        for _, x in tup:
            p *= x
        joint[tuple(c for c, _ in tup)] = p
        tot += p
        e = O.equity([hero] + [list(COMBO[c]) for c, _ in tup], board, dead, processes=1)
        for k in range(m + 1):
            eq[k] += p * e["equity"][k]
            wn[k] += p * e["win"][k]
            tn[k] += p * e["tie"][k]
    return [x / tot for x in eq], [x / tot for x in wn], [x / tot for x in tn], {k: v / tot for k, v in joint.items()}


def class_combos(spec, rng, lo=0.2, hi=2.0):
    w = [0.0] * N
    for a, b in O.expand_range(spec):
        w[cidx(a, b)] = rng.uniform(lo, hi)
    return w


def c4():
    print("C4 multiway vs exact joint enumeration")
    rng = random.Random(44)
    spots = [
        ("river 2opp overlap", "AhKd", "Kc9s4d2h7c", [], ["AA,KK,AK,AQ,KQ,99", "AA,KK,AK,KQ,K9,QQ"]),
        ("river 3opp overlap", "QhQd", "Ks9s4d2h7c", [], ["AA,AK,KQs", "AK,KQ,AA", "AA,KK,K9s,A9s"]),
        ("river 3opp board straight (chops)", "2c3d", "5h6s7d8c9h", ["Ts"], ["AK,Th9d,JT", "AA,KK,JTs", "QQ,TT,AK"]),
        ("turn 2opp overlap", "JsTs", "Qs9h2s5c", [], ["AA,AK,KQ,AQs", "AA,KK,AK,KJs"]),
        ("turn 3opp heavy collision+dead", "8h8c", "Ad7s6s2d", ["Kc"], ["AK,AQ", "AK,AJ", "AQ,AJ,AK"]),
        ("flop 2opp overlap", "AsQs", "Ks8s3d", [], ["KK,AK", "AK,KQs,KK"]),
        ("flop 3opp heavy collision", "9c9d", "Th7h2c", ["Ac"], ["AhKh,AsKs,AdKd", "AhKh,KhQh,AsKs", "KsKd,AsKs,KhQh"]),
        ("turn 2opp zero weights + dead", "AcAd", "Jh8h4c3s", ["2h", "5d"], ["JJ,88,AhKh,QhTh", "JJ,KhQh,9h7h,T9"]),
        ("river 1opp", "AhKh", "Qh7h2c3d9s", [], ["AA,KK,QQ,AQ,KQ,77,JhTh,8h6h"]),
    ]
    jobs, built = [], []
    for name, hero, board, dead, specs in spots:
        ranges = []
        for s in specs:
            w = class_combos(s, rng)
            for c in rng.sample([c for c in range(N) if w[c] > 0], max(0, sum(1 for x in w if x > 0) // 6)):
                w[c] = 0.0  # some zero weights inside the classes
            ranges.append(w)
        h, b, d = cards(hero), cards(board), cards("".join(dead)) if dead else []
        jobs.append((h, b, d, ranges))
        built.append(name)
        print(f"  {name}: range sizes {[sum(1 for x in w if x > 0) for w in ranges]}")
    t0 = time.time()
    with Pool() as p:
        exact = p.map(joint_exact, jobs, chunksize=1)
    print(f"  exact joint enumeration done in {time.time() - t0:.1f}s")
    TR = 400_000
    tasks = [{"op": "mw", "hero": h, "board": b, "dead": d, "ranges": r, "trials": TR, "seed": 11} for h, b, d, r in jobs]
    SAMPLES = 400_000
    tasks += [{"op": "joint", "ranges": r, "blocked": h + b + d, "count": SAMPLES, "seed": 3} for h, b, d, r in jobs]
    res = ts(tasks)
    maxz = 0.0
    for i, (name, (eq, wn, tn, joint)) in enumerate(zip(built, exact)):
        r = res[i]
        if not check(r["ok"], f"C4 {name}: threw {r}"):
            continue
        pl = r["value"]["players"]
        zs = []
        for k, p in enumerate(pl):
            z = (p["equity"] - float(eq[k])) / p["stdErr"] if p["stdErr"] > 0 else (0.0 if abs(p["equity"] - float(eq[k])) < 1e-12 else 99)
            zw = (p["win"] - float(wn[k])) / math.sqrt(max(float(wn[k] * (1 - wn[k])), 1e-18) / TR)
            zt = (p["tie"] - float(tn[k])) / math.sqrt(max(float(tn[k] * (1 - tn[k])), 1e-18) / TR)
            zs += [z, zw, zt]
        s_eq = sum(p["equity"] for p in pl)
        check(abs(s_eq - 1) < 1e-9, f"C4 {name}: equities sum to {s_eq}")
        mz = max(abs(z) for z in zs)
        maxz = max(maxz, mz)
        check(mz < 4, f"C4 {name}: max |z| {mz:.2f}; ts {[round(p['equity'], 5) for p in pl]} exact {[round(float(x), 5) for x in eq]}")
        print(f"  {name}: exact {[round(float(x), 5) for x in eq]} ts {[round(p['equity'], 5) for p in pl]} "
              f"max|z| (eq/win/tie) {mz:.2f} acc {r['value']['acceptance']:.3f}")
        # sampleJoint frequencies
        jr = res[len(jobs) + i]
        if not check(jr["ok"], f"C4 sampleJoint {name} threw {jr}"):
            continue
        cmb = jr["value"]["combos"]
        cnt = {}
        bad = 0
        h, b, d, _ = jobs[i]
        blocked = set(h + b + d)
        for t in zip(*cmb):
            cs = [x for c in t for x in COMBO[c]]
            if len(set(cs)) != len(cs) or set(cs) & blocked:
                bad += 1
            cnt[t] = cnt.get(t, 0) + 1
        check(bad == 0, f"C4 sampleJoint {name}: {bad} invalid joint draws")
        check(set(cnt) <= set(joint), f"C4 sampleJoint {name}: draws outside support")
        chi2, df, zmax = 0.0, 0, 0.0
        for t, p in joint.items():
            e = float(p) * SAMPLES
            o = cnt.get(t, 0)
            chi2 += (o - e) ** 2 / e
            df += 1
            zmax = max(zmax, abs(o - e) / math.sqrt(e * (1 - float(p))) if p < 1 else 0)
        df -= 1
        # Wilson-Hilferty: z of chi2 with df degrees of freedom
        zc = ((chi2 / df) ** (1 / 3) - (1 - 2 / (9 * df))) / math.sqrt(2 / (9 * df)) if df > 0 else 0.0
        check(zc < 4, f"C4 sampleJoint {name}: chi2={chi2:.1f} df={df} z={zc:.2f}")
        print(f"    sampleJoint: {df + 1} joint cells, chi2={chi2:.1f} df={df} (WH z={zc:+.2f}), max cell |z|={zmax:.2f}, "
              f"acceptance={jr['value']['acceptance']:.3f}")
    print(f"C4: {len(spots)} spots, max |z| {maxz:.2f}")


# ------------------------------------------------------------------ C5 breakdown

def class_index(c):
    a, b = COMBO[c]
    ra, rb = a >> 2, b >> 2
    if ra == rb:
        return (12 - ra) * 13 + (12 - ra)
    if (a & 3) == (b & 3):
        return (12 - ra) * 13 + (12 - rb)  # suited: above diagonal, row = high rank
    return (12 - rb) * 13 + (12 - ra)  # offsuit: below diagonal, row = low rank


NAMES = []
for i in range(13):
    for j in range(13):
        r1, r2 = 12 - i, 12 - j
        NAMES.append(O.RANKS[max(r1, r2)] + O.RANKS[min(r1, r2)] + ("" if i == j else "s" if j > i else "o"))

BUCKET_CASES = [
    # (board, combo, expected bucket)
    ("Ks7d2c", "7h7s", "set"), ("Ks7d2c", "KhKd", "set"), ("Ks7d2c", "AhAs", "overpair"), ("Ks7d2c", "AhKd", "top pair"),
    ("Ks7d2c", "7h6h", "middle pair"), ("Ks7d2c", "3h2h", "weak pair"), ("Ks7d2c", "9h9s", "middle pair"),
    ("Ks7d2c", "5h5s", "weak pair"), ("Ks7d2c", "Kh7h", "two pair"), ("Ks7d2c", "QhJh", "air"), ("Ks7d2c", "AhQd", "air"),
    ("Ks7s2c", "AsQs", "flush draw"), ("Ks7s2c", "AsKd", "top pair"), ("9h8h2c", "Th7c", "straight draw"),
    ("9h8h2c", "JhTh", "flush draw"), ("9h8h2c", "6c5d", "gutshot"), ("9h8h2c", "AhKh", "flush draw"),
    ("9h8h2c", "AcKd", "overcards"), ("7s7d2c", "Ah7h", "trips"), ("7s7d2c", "9h9s", "overpair"), ("7s7d2c", "2h2s", "full house"),
    ("7s7d2c", "7h7c", "quads"), ("9h8h7c", "JcTd", "straight"), ("9h8h7c", "6c5d", "straight"), ("Ah9h4h", "Kh2h", "flush"),
    ("Ah9h4h", "Kh2c", "flush draw"),
    ("5c6d7h8s9c", "AhKd", "straight"), ("5c6d7h8s9c", "TcJd", "straight"), ("2h5h8hJhKh", "AcAd", "flush"),
    ("Ks7d2c4h", "5h3h", "straight draw"), ("Ks7d2c4h9s", "AhQh", "air"), ("9s7d2c4h3s", "AhKd", "overcards"),
    ("KsKd2c", "AhKh", "trips"), ("Ks9d5c2h", "9h8h", "middle pair"), ("Ks9d5c2h", "5h4h", "weak pair"),
    ("Ks9d5c2h", "ThTc", "middle pair"), ("Ks9d5c2h", "6h6c", "weak pair"), ("9h8h7h", "ThJh", "straight flush"),
    ("4c3d9h", "Ah2d", "gutshot"), ("9c7d5h", "Jh8c", "straight draw"), ("Ks7s2s4s", "As3c", "flush"),
    ("Ks7s2s", "Qs3c", "flush draw"), ("7c7d7h", "AsKd", "overcards"), ("Td9c8h", "QsJs", "straight"),
    ("Td9c8h", "Qs7s", "straight draw"), ("Td9c8h", "Js7s", "straight"), ("Ad5c4h", "3s2s", "straight"), ("Ad5c4h", "3s3c", "weak pair"),
    ("Jc8d3h", "JsJh", "set"), ("Jc8d3h", "QsQh", "overpair"), ("Jc8d3h", "Tc9c", "straight draw"),
]


def c5():
    print("C5 breakdown")
    rng = random.Random(5)
    tasks = []
    ws = []
    for k in range(6):
        w = random_weights(rng, rng.choice([1, 10, 300, 1326]), [], 0)
        ws.append(w)
        tasks.append({"op": "classShares", "weights": w})
    for b, c, _ in BUCKET_CASES:
        w = [0.0] * N
        a1, a2 = cards(c)
        w[cidx(a1, a2)] = 1.0
        tasks.append({"op": "buckets", "weights": w, "board": cards(b)})
    # aggregate check: a random weighted range on a few boards, sum to 1 and equal to per-combo sum
    agg_boards = ["Ks7d2c", "9h8h2c4s", "Ah9h4h7c2s", "7s7d2c"]
    agg_w = random_weights(rng, 1326, [], 0)
    for b in agg_boards:
        tasks.append({"op": "buckets", "weights": agg_w, "board": cards(b)})
    # per-combo buckets for the aggregate boards (single-combo ranges), only for live combos
    per_tasks = []
    for b in agg_boards:
        bc = set(cards(b))
        for c in range(N):
            if agg_w[c] > 0 and not (set(COMBO[c]) & bc):
                w = [0.0] * N
                w[c] = 1.0
                per_tasks.append((b, c, {"op": "buckets", "weights": w, "board": cards(b)}))
    tasks += [t for _, _, t in per_tasks]
    res = ts(tasks)
    # class shares
    for k, w in enumerate(ws):
        r = res[k]
        cc = r["comboClass"]
        bad = [c for c in range(N) if cc[c] != class_index(c)]
        check(not bad, f"C5 COMBO_CLASS wrong for {len(bad)} combos e.g. {bad[:3]}")
        tot = sum(w)
        ref = [0.0] * 169
        for c in range(N):
            ref[class_index(c)] += w[c] / tot
        err = max(abs(a - b) for a, b in zip(r["shares"], ref))
        check(abs(sum(r["shares"]) - 1) < 1e-12 and err < 1e-12, f"C5 classShares err {err} sum {sum(r['shares'])}")
    # spot names
    cc = res[0]["comboClass"]
    for s, name in (("AsKs", "AKs"), ("AsKd", "AKo"), ("7h7c", "77"), ("2c3d", "32o"), ("Th9h", "T9s")):
        a, b = cards(s)
        check(NAMES[cc[cidx(a, b)]] == name, f"C5 class of {s} is {NAMES[cc[cidx(a, b)]]}, want {name}")
    counts = [0] * 169
    for c in range(N):
        counts[cc[c]] += 1
    check(all(counts[i] == (6 if NAMES[i][0] == NAMES[i][1] else 4 if NAMES[i].endswith("s") else 12) for i in range(169)),
          "C5 class sizes wrong")
    k = len(ws)
    nb = 0
    for (b, c, exp) in BUCKET_CASES:
        r = res[k]
        k += 1
        got = r["value"]["buckets"][0]["bucket"] if r["ok"] else r
        ok = check(r["ok"] and got == exp and len(r["value"]["buckets"]) == 1 and abs(r["value"]["buckets"][0]["share"] - 1) < 1e-15,
                   f"C5 bucket {c} on {b}: got {got}, want {exp}")
        nb += ok
    agg = {}
    for b in agg_boards:
        r = res[k]
        k += 1
        agg[b] = r["value"]
        s = sum(x["share"] for x in r["value"]["buckets"])
        check(abs(s - 1) < 1e-12, f"C5 buckets on {b} sum to {s}")
    ref = {b: {} for b in agg_boards}
    dref = {b: 0.0 for b in agg_boards}
    for (b, c, _), r in zip(per_tasks, res[k:]):
        bk = r["value"]["buckets"][0]["bucket"]
        ref[b][bk] = ref[b].get(bk, 0.0) + agg_w[c]
        dref[b] += agg_w[c] * r["value"]["draws"]
    for b in agg_boards:
        bc = set(cards(b))
        tot = sum(agg_w[c] for c in range(N) if not (set(COMBO[c]) & bc))
        got = {x["bucket"]: x["share"] for x in agg[b]["buckets"]}
        err = max(abs(got.get(x, 0) - ref[b].get(x, 0) / tot) for x in set(got) | set(ref[b]))
        check(err < 1e-12, f"C5 aggregate buckets on {b} != sum of single-combo buckets (err {err})")
        check(abs(agg[b]["draws"] - dref[b] / tot) < 1e-12, f"C5 draws share on {b} inconsistent")
        shares = [x["share"] for x in agg[b]["buckets"]]
        check(shares == sorted(shares, reverse=True), f"C5 buckets on {b} not sorted")
    print(f"C5: {len(ws)} classShares ranges, {nb}/{len(BUCKET_CASES)} hand-picked bucket cases, {len(agg_boards)} aggregate boards")


# ------------------------------------------------------------------ C6 perf

def c6():
    print("C6 performance")
    rng = random.Random(6)
    tasks = []
    for k in range(4):
        hero, board, _ = random_spot(rng, 3, 0)
        w = [0.05 + rng.random() for _ in range(N)]
        tasks.append({"op": "time", "hero": hero, "board": board, "weights": w, "reps": 7})
    res = ts(tasks)
    worst = 0.0
    for r in res:
        med = sorted(r["times"])[len(r["times"]) // 2]
        worst = max(worst, med)
        print(f"  flop vs {r['combos']} combos: cold {r['cold']:.1f} ms, median {med:.1f} ms, max {max(r['times']):.1f} ms")
        check(med < 150, f"C6 flop exact median {med:.1f} ms >= 150")
    print(f"C6: worst warm median {worst:.1f} ms")


# ------------------------------------------------------------------ C7 progressive

def c7():
    print("C7 progressive runs")
    rng = random.Random(77)
    tasks = []
    chunkings = [[1], [7], [0, 3], [1000], [123, 1, 0, 50], [1e9], [0.5, 2.7]]
    for L, nd in ((3, 0), (3, 2), (4, 0), (4, 1), (5, 0), (5, 3), (0, 0), (0, 2)):
        hero, board, dead = random_spot(rng, L, nd)
        w = random_weights(rng, rng.choice([5, 300, 1300]), hero + board + dead)
        tasks.append({"op": "progressive", "hero": hero, "board": board, "dead": dead, "weights": w,
                      "trials": 30001, "seed": 4, "chunkings": chunkings if L else [[1], [7], [0, 3], [1000], [123, 1, 0, 50], [1e9], [0.5, 2.7], [29999, 5]]})
    res = ts(tasks)
    n = 0
    for t, r in zip(tasks, res):
        for ch, o in zip(t["chunkings"], r["out"]):
            check(o["result"] == r["one"], f"C7 board {len(t['board'])} chunks {ch}: {o['result']} != {r['one']}")
            check(o["extraStep"] is True, f"C7 step after done returned {o['extraStep']}")
            if len(t["board"]) >= 3 and o["calls"] > 1:
                check(o["earlyThrows"] is True, f"C7 exact result() before done did not throw (chunks {ch})")
            n += 1
    print(f"C7: {len(tasks)} spots x {len(chunkings)}+ chunkings = {n} progressive runs, all identical to one-shot")


if __name__ == "__main__":
    which = sys.argv[1:] or ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]
    for w in which:
        t0 = time.time()
        globals()[w]()
        print(f"[{w} {time.time() - t0:.0f}s]\n")
    print("FAILURES:" if FAILS else "ALL CHECKS PASSED")
    for f in FAILS:
        print(" -", f)
    sys.exit(1 if FAILS else 0)
