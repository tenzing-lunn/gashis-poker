"""Bias probe for multiway: TS EV with many particles vs the exact joint enumeration (river/turn 3-way).
    python3 lib/grading/oracle/mw_bias.py"""
import sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import judge
ts = judge.TS()
sp = judge.gen(ts)
for s in judge.pick(sp, lambda s: s["live"] == 3 and s["street"] in ("river", "turn"), 4, 1):
    rep, g, vals = judge.compare(ts, s, "mw-exact", nsig=4, options={"particles": 60000, "seed": 3})
    judge.show(rep)
