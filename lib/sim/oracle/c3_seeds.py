"""C3 follow-up: sd across many seeds vs reported stdErr (TS only).  python3 lib/sim/oracle/c3_seeds.py"""
import math, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from check import ts, cards, cidx, N

def w_of(pairs):
    w = [0.0] * N
    for s, x in pairs:
        a, b = cards(s); w[cidx(a, b)] = x
    return w

SEED0 = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
for name, hero, w in [("7c2d vs AK x3", "7c2d", w_of([("AhKs", 1.0), ("AcKd", 0.2), ("AdKc", 0.5)])),
                      ("AsKs vs QhQd", "AsKs", w_of([("QhQd", 1.0)]))]:
    for seeds, trials in ((600, 20000), (600, 2000)):
        res = ts([{"op": "eq", "hero": cards(hero), "board": [], "dead": [], "weights": w, "trials": trials, "seed": (SEED0 + s * 2654435761) % 4294967296} for s in range(seeds)])
        est = [r["value"]["equity"] for r in res]
        mu = sum(est) / seeds
        sd = math.sqrt(sum((x - mu) ** 2 for x in est) / (seeds - 1))
        se = sum(r["value"]["stdErr"] for r in res) / seeds
        print(f"{name}: {seeds} seeds x {trials}: mean {mu:.5f} sd {sd:.6f} reported {se:.6f} ratio {sd / se:.3f} (±{1/math.sqrt(2*(seeds-1)):.3f})")
