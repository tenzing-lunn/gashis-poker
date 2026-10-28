"""Math judge for lib/grading: G1..G6. Run from the repo root:

    python3 lib/grading/oracle/judge.py [G1 G2 G3 G4 G5 G6]
"""

from __future__ import annotations

import json
import math
import sys
import time

import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import ref  # noqa: E402
from ref import TS, Tree, same  # noqa: E402

P2 = ["nit", "tag", "lag", "station", "maniac", "micro"]


def configs():
    out = []
    seed = 1000
    # heads-up: every persona as the opponent, hero played by varied personas, equal and unequal stacks
    hu_stacks = [[10000, 10000], [4000, 15000], [20000, 3500], [10000, 6000]]
    for i, bot in enumerate(P2):
        for j, st in enumerate(hu_stacks):
            hero_p = P2[(i + j + 1) % 6]
            out.append({"name": f"hu-{bot}-{j}", "personas": [hero_p, bot], "stacks": st, "button": j % 2, "hero": 0,
                        "seed": seed, "hands": 25})
            seed += 1000
    # 3- and 4-handed, unequal stacks for side pots
    mw = [
        (["station", "lag", "maniac"], [10000, 2500, 12000]),
        (["micro", "station", "tag"], [6000, 10000, 3000]),
        (["maniac", "station", "micro"], [10000, 10000, 10000]),
        (["lag", "maniac", "station", "nit"], [8000, 2000, 10000, 15000]),
        (["station", "micro", "maniac", "station"], [10000, 4000, 10000, 7000]),
    ]
    for i, (ps, st) in enumerate(mw):
        out.append({"name": f"mw{i}", "personas": ps, "stacks": st, "button": i % len(ps), "hero": 0, "seed": seed,
                    "hands": 60})
        seed += 1000
    return out


def street_raised_by_hero(ts, sp):
    v = ts.call(op="node", history=sp["history"], path=[], heroCards=sp["heroCards"], personas=sp["personas"],
                strategy=False)
    return any(e["seat"] == sp["heroSeat"] and e["action"] in ("bet", "raise") for e in v["streetActions"]), v


def live_bots(root, hero):
    return [s for s in range(len(root["folded"])) if s != hero and not root["folded"][s]]


def build(ts, sp, kind, **kw):
    t0 = time.time()
    tree = Tree(ts, sp, ref.Model([], [], np.zeros(0), None))  # root only
    root = tree.root
    seats = live_bots(root, sp["heroSeat"])
    ws = [ref.posterior(ts, sp["history"], s, sp["personas"][s], sp["heroCards"]) for s in seats]
    board = sp["history"]["board"]
    if kind == "hu":
        m = ref.hu_model(seats[0], ws[0], sp["heroCards"], board, **kw)
    elif kind == "mw-exact":
        m = ref.mw_model_exact(seats, ws, sp["heroCards"], board)
    else:
        m = ref.mw_model_sample(seats, ws, sp["heroCards"], board, kw.get("count", 20000), kw.get("seed", 7))
    tree = Tree(ts, sp, m)
    return tree, ws, seats, time.time() - t0


def compare(ts, sp, kind, chosen=None, options=None, tol=1e-9, nsig=None, **kw):
    g = ts.call(op="grade", history=sp["history"], heroSeat=sp["heroSeat"], heroCards=sp["heroCards"],
                personas=sp["personas"], chosen=chosen, options=options or {})
    tree, ws, seats, dt = build(ts, sp, kind, **kw)
    root = tree.root
    rep = {"spot": f'{sp["cfg"]}#{sp["seed"]} {root["street"]} live={len(seats)+1} toCall={root["la"]["toCall"]}',
           "issues": [], "maxErr": 0.0, "maxZ": 0.0}
    # posteriors
    for k, s in enumerate(seats):
        d = float(np.max(np.abs(np.array(g["ranges"][k]["weights"]) - ws[k])))
        if d > 1e-12:
            rep["issues"].append(f"posterior seat {s} differs by {d}")
    # candidates
    mine = ref.candidates(root["la"], root["pot"], max(root["bets"]))
    if chosen is not None and not any(same(c["action"], chosen) for c in mine):
        mine.append({"action": chosen, "kind": None})
    if [json.dumps(c["action"], sort_keys=True) for c in mine] != [json.dumps(o["action"], sort_keys=True) for o in g["options"]]:
        rep["issues"].append(f'candidates differ: mine {[c["action"] for c in mine]} ts {[o["action"] for o in g["options"]]}')
        return rep, g, None
    for c, o in zip(mine, g["options"]):
        if c["kind"] is not None and c["kind"] != o["kind"]:
            rep["issues"].append(f'kind {c["action"]}: mine {c["kind"]} ts {o["kind"]}')
    if abs(g["pot"] - root["pot"]) > 0:
        rep["issues"].append("pot differs")
    vals = []
    for c, o in zip(mine, g["options"]):
        r = tree.evaluate(c["action"])
        vals.append(r)
        err = abs(r["ev"] - o["ev"])
        if nsig is None:
            rep["maxErr"] = max(rep["maxErr"], err)
            if err > tol:
                rep["issues"].append(f'EV {o["label"]}: mine {r["ev"]!r} ts {o["ev"]!r} (diff {err:.3g})')
            if abs(r["foldEquity"] - o["foldEquity"]) > 1e-9:
                rep["issues"].append(f'foldEquity {o["label"]}: mine {r["foldEquity"]} ts {o["foldEquity"]}')
            se, so = r["showdownEquity"], o["showdownEquity"]
            if (se is None) != (so is None) or (se is not None and abs(se - so) > 1e-9):
                rep["issues"].append(f'showdownEquity {o["label"]}: mine {se} ts {so}')
            # responses
            mr = [(json.dumps(a, sort_keys=True), p) for a, p in r["responses"]]
            tr = [(json.dumps(x["action"], sort_keys=True), x["prob"]) for x in o["responses"]]
            if len(mr) != len(tr) or any(a != b or abs(p - q) > 1e-9 for (a, p), (b, q) in zip(mr, tr)):
                rep["issues"].append(f'responses {o["label"]}: mine {mr} ts {tr}')
        else:
            se = math.sqrt(o["stdErr"] ** 2 + r.get("se_ref", 0.0) ** 2)
            z = err / se if se > 0 else (0 if err < 1e-9 else math.inf)
            rep["maxErr"] = max(rep["maxErr"], err)
            rep["maxZ"] = max(rep["maxZ"], z)
            if z > nsig:
                rep["issues"].append(f'EV {o["label"]}: mine {r["ev"]:.4f}±{r.get("se_ref",0):.4f} ts {o["ev"]:.4f}±{o["stdErr"]:.4f} z={z:.2f}')
        # model label
        if kind == "hu":
            exact_shares = len(sp["history"]["board"]) >= 3
            want = "exact" if (not r["continues"] and (exact_shares or not r["card"])) else "ev-now"
            if want != o["model"]:
                rep["issues"].append(f'model {o["label"]}: want {want} ts {o["model"]}')
    rep["multiLayer"] = tree.multi_layer_terminals
    # tiers from TS's own numbers (G5) and from mine
    b, tiers = ref.grade_tiers([o["ev"] for o in g["options"]], [o["stdErr"] for o in g["options"]], root["pot"])
    if b != g["best"] or tiers != [o["tier"] for o in g["options"]]:
        rep["issues"].append(f'tiers: mine best={b} {tiers} ts best={g["best"]} {[o["tier"] for o in g["options"]]}')
    for o in g["options"]:
        L = max(0.0, g["options"][g["best"]]["ev"] - o["ev"])
        if abs(o["loss"] - L) > 1e-9 or abs(o["lossPct"] - L / root["pot"]) > 1e-12:
            rep["issues"].append(f'loss {o["label"]} wrong')
    if g["model"] != ("exact" if all(o["model"] == "exact" for o in g["options"]) else "ev-now"):
        rep["issues"].append("overall model label")
    if chosen is not None:
        ci = g["chosen"]
        if ci is None or not same(g["options"][ci]["action"], chosen):
            rep["issues"].append("chosen not included / wrong index")
    rep["time"] = dt
    return rep, g, vals


def show(rep):
    flag = "OK " if not rep["issues"] else "BAD"
    z = f' maxZ={rep["maxZ"]:.2f}' if rep["maxZ"] else ""
    print(f'  {flag} {rep["spot"]} maxErr={rep["maxErr"]:.3g}{z} layers>1:{rep.get("multiLayer",0)}')
    for i in rep["issues"]:
        print("      -", i)


def gen(ts):
    return ts.call(op="gen", configs=configs())


def pick(spots, pred, n, per_cfg=2):
    out, used = [], {}
    spots = list(spots)
    __import__("random").Random(5).shuffle(spots)
    for s in spots:
        if pred(s) and used.get(s["cfg"], 0) < per_cfg:
            out.append(s)
            used[s["cfg"]] = used.get(s["cfg"], 0) + 1
            if len(out) >= n:
                break
    return out


def G1(ts, spots):
    print("G1 river heads-up exact")
    cats = {"facing bet": [], "first/checked-to": [], "facing raise": []}
    pool_ = {k: [] for k in cats}
    for s in spots:
        if s["street"] != "river" or s["live"] != 2:
            continue
        raised, root = street_raised_by_hero(ts, s)
        cat = "first/checked-to" if s["toCall"] == 0 else ("facing raise" if raised else "facing bet")
        pool_[cat].append(s)
        # synthesize facing-raise spots: hero bets/raises, then the bot raises (if it ever does)
        if root["la"]["canRaise"] and len(pool_["facing raise"]) < 40:
            for c in ref.candidates(root["la"], root["pot"], max(root["bets"])):
                if c["action"]["type"] != "raise" or c["kind"] == "allin":
                    continue
                v = ts.call(op="node", history=s["history"], path=[c["action"]], heroCards=s["heroCards"], personas=s["personas"])
                if v["complete"] or v["street"] != "river" or v["la"]["seat"] == s["heroSeat"]:
                    continue
                bot = v["la"]["seat"]
                w = ref.posterior(ts, s["history"], bot, s["personas"][bot], s["heroCards"])
                for a, act in enumerate(v["concrete"]):
                    if act and act["type"] == "raise" and float(w @ np.array(v["probs"]).reshape(1326, 8)[:, a]) > 1e-6:
                        h = dict(s["history"], actions=s["history"]["actions"] + [c["action"], act])
                        pool_["facing raise"].append(dict(s, history=h, cfg=s["cfg"] + "+r", toCall=1))
                        break
                break
    for k, lst in pool_.items():  # round-robin over configs for persona variety
        by = {}
        for s in lst:
            by.setdefault(s["cfg"], []).append(s)
        order = sorted(by)
        __import__("random").Random(3).shuffle(order)
        while len(cats[k]) < 7 and any(by.values()):
            for c in order:
                if by[c] and len(cats[k]) < 7:
                    cats[k].append(by[c].pop(0))
    ok, n, mx = True, 0, 0.0
    for cat, ss in cats.items():
        print(f" [{cat}] {len(ss)} spots")
        for s in ss:
            rep, g, vals = compare(ts, s, "hu")
            # closed form for call
            if vals is not None and s["toCall"] > 0:
                tree = None
                ci = next(i for i, o in enumerate(g["options"]) if o["action"]["type"] == "call")
                fi = next(i for i, o in enumerate(g["options"]) if o["action"]["type"] == "fold")
                P = g["pot"]
                rootla = None
                v = ts.call(op="node", history=s["history"], path=[], heroCards=s["heroCards"], personas=s["personas"], strategy=False)
                A = v["la"]["callAmount"]
                if A == v["la"]["toCall"]:
                    wts = np.array(g["ranges"][0]["weights"])
                    idx = np.nonzero(wts > 0)[0]
                    board = s["history"]["board"]
                    hv = ref.O.evaluate(list(s["heroCards"]) + board)
                    eq = np.array([1.0 if hv > (bv := ref.O.evaluate(list(ref.COMBOS[c]) + board)) else 0.5 if hv == bv else 0.0 for c in idx])
                    cf = float(np.sum(wts[idx] / wts[idx].sum() * eq) * (P + A) - A)
                    if abs(cf - g["options"][ci]["ev"]) > 1e-9:
                        rep["issues"].append(f'closed form call {cf} vs ts {g["options"][ci]["ev"]}')
                    rep["spot"] += f" closedForm={cf:.6f}"
                else:
                    rep["spot"] += " (call all-in for less: closed form n/a)"
                if g["options"][fi]["ev"] != 0:
                    rep["issues"].append("fold EV != 0")
            show(rep)
            n += 1
            mx = max(mx, rep["maxErr"])
            ok &= not rep["issues"]
    print(f"G1 {'PASS' if ok and n >= 15 else 'FAIL'}: {n} spots, max |dEV| {mx:.3g}")
    return ok


def G2(ts, spots):
    print("G2 turn/flop heads-up")
    ss = pick(spots, lambda s: s["street"] in ("turn",) and s["live"] == 2, 6, 1) + \
        pick(spots, lambda s: s["street"] in ("flop",) and s["live"] == 2, 6, 1)
    ok, mx, labels = True, 0.0, {"exact": 0, "ev-now": 0}
    for s in ss:
        rep, g, vals = compare(ts, s, "hu")
        for o in g["options"]:
            labels[o["model"]] += 1
        show(rep)
        mx = max(mx, rep["maxErr"])
        ok &= not rep["issues"]
    print(f"G2 {'PASS' if ok and len(ss) >= 8 else 'FAIL'}: {len(ss)} spots, max |dEV| {mx:.3g}, labels {labels}")
    return ok


def G3(ts, spots):
    print("G3 multiway (3-way)")
    river = pick(spots, lambda s: s["live"] == 3 and s["street"] == "river", 3, 1)
    turn = pick(spots, lambda s: s["live"] == 3 and s["street"] == "turn", 3, 1)
    flop = pick(spots, lambda s: s["live"] == 3 and s["street"] == "flop", 1, 1)
    ok, side = True, 0
    for s in river + turn:
        rep, g, vals = compare(ts, s, "mw-exact", nsig=4)
        show(rep)
        side += rep["multiLayer"] > 0
        ok &= not rep["issues"]
    for s in flop:
        rep, g, vals = compare(ts, s, "mw-sample", nsig=4, count=10000, seed=11)
        show(rep)
        side += rep["multiLayer"] > 0
        ok &= not rep["issues"]
    # stdErr plausibility: spread of EVs across seeds vs reported stdErr
    print(" stdErr vs seed spread (20 seeds, 2000 particles):")
    for s in (river + turn + flop)[:3]:
        evs, ses = [], []
        for seed in range(1, 21):
            g = ts.call(op="grade", history=s["history"], heroSeat=s["heroSeat"], heroCards=s["heroCards"],
                        personas=s["personas"], options={"seed": seed})
            evs.append([o["ev"] for o in g["options"]])
            ses.append([o["stdErr"] for o in g["options"]])
        evs, ses = np.array(evs), np.array(ses)
        sd = evs.std(axis=0, ddof=1)
        mse = ses.mean(axis=0)
        ratio = sd / np.where(mse > 0, mse, np.nan)
        print(f'   {s["cfg"]}#{s["seed"]} {s["street"]}: sd/stdErr per option = {np.round(ratio, 2).tolist()}')
        if np.nanmax(ratio) > 2.0 or np.nanmin(ratio) < 0.4:
            print("      - implausible stdErr")
            ok = False
    n = len(river + turn + flop)
    print(f"G3 {'PASS' if ok and n >= 4 and side > 0 else 'FAIL'}: {n} spots, side-pot spots {side}")
    return ok


def G4(ts, spots):
    print("G4 preflop heads-up")
    ss = pick(spots, lambda s: s["street"] == "preflop" and s["live"] == 2 and len(s["history"]["actions"]) >= 1, 4, 1)
    ok, mz = True, 0.0
    for s in ss:
        rep, g, vals = compare(ts, s, "hu", nsig=4, preflop_trials=60000)
        show(rep)
        mz = max(mz, rep["maxZ"])
        ok &= not rep["issues"]
    # stdErr plausibility on one spot
    s = ss[0]
    evs, ses = [], []
    for seed in range(1, 13):
        g = ts.call(op="grade", history=s["history"], heroSeat=s["heroSeat"], heroCards=s["heroCards"],
                    personas=s["personas"], options={"seed": seed})
        evs.append([o["ev"] for o in g["options"]])
        ses.append([o["stdErr"] for o in g["options"]])
    evs, ses = np.array(evs), np.array(ses)
    sd, mse = evs.std(axis=0, ddof=1), ses.mean(axis=0)
    print(f"   seed spread sd {np.round(sd,3).tolist()} vs mean stdErr {np.round(mse,3).tolist()}")
    print(f"G4 {'PASS' if ok and len(ss) >= 3 else 'FAIL'}: {len(ss)} spots, max z {mz:.2f}")
    return ok


def G5(ts, spots):
    print("G5 tiers / candidates")
    ok = True
    # boundaries
    pot = 1000
    evs = [0, -5, -5.001, -30, -30.001, -80, -80.001, -200, -200.001]
    r = ts.call(op="tiers", options=[{"ev": e, "stdErr": 0} for e in evs], pot=pot)
    want = ["best", "best", "correct", "correct", "inaccuracy", "inaccuracy", "mistake", "mistake", "blunder"]
    print("  boundaries:", r["tier"], "OK" if r["tier"] == want and r["best"] == 0 else "BAD")
    ok &= r["tier"] == want
    # noise shrink: loss 50 with se 10 each -> shrink 2*sqrt(200)=28.28 -> 21.7/1000 = correct
    r = ts.call(op="tiers", options=[{"ev": 0, "stdErr": 10}, {"ev": -50, "stdErr": 10}], pot=pot)
    print("  shrink:", r["tier"], "OK" if r["tier"] == ["best", "correct"] else "BAD")
    ok &= r["tier"] == ["best", "correct"]
    # argmax best even when its stdErr is huge; ties -> first
    r = ts.call(op="tiers", options=[{"ev": 1, "stdErr": 0}, {"ev": 2, "stdErr": 100}, {"ev": 2, "stdErr": 0}], pot=pot)
    print("  argmax:", r, "OK" if r["best"] == 1 and r["tier"][1] == "best" else "BAD")
    ok &= r["best"] == 1
    # candidates + chosen on real spots (every street, all seat counts), including off-menu chosen sizes
    n = 0
    for s in pick(spots, lambda s: True, 40, 2):
        v = ts.call(op="node", history=s["history"], path=[], heroCards=s["heroCards"], personas=s["personas"], strategy=False)
        la = v["la"]
        mine = ref.candidates(la, v["pot"], max(v["bets"]))
        chosen = None
        if la["canRaise"] and la["maxRaiseTo"] - la["minRaiseTo"] > 3:
            chosen = {"type": "raise", "to": la["minRaiseTo"] + 1}
        g = ts.call(op="grade", history=s["history"], heroSeat=s["heroSeat"], heroCards=s["heroCards"],
                    personas=s["personas"], chosen=chosen, options={"particles": 300, "trialsPerCombo": 50})
        acts = [o["action"] for o in g["options"]]
        want = [c["action"] for c in mine] + ([chosen] if chosen else [])
        bad = acts != want or [o["kind"] for o in g["options"]][: len(mine)] != [c["kind"] for c in mine]
        # legal sizes + label format
        for o in g["options"]:
            a = o["action"]
            if a["type"] == "raise":
                bad |= not (la["minRaiseTo"] <= a["to"] <= la["maxRaiseTo"])
                if o["kind"] == "bet":
                    bad |= o["label"] != f'Bet {ref.js_round(100 * a["to"] / v["pot"])}% ({fmt(a["to"], v["bigBlind"])})'
            bad |= (a["type"] == "fold") != False and not la["canFold"]
        if chosen:
            bad |= g["chosen"] != len(acts) - 1 or g["options"][-1]["kind"] not in ("raise", "bet")
        b, tiers = ref.grade_tiers([o["ev"] for o in g["options"]], [o["stdErr"] for o in g["options"]], v["pot"])
        bad |= b != g["best"] or tiers != [o["tier"] for o in g["options"]] or g["options"][g["best"]]["tier"] != "best"
        # chosen = an existing candidate keeps the list unchanged
        g2 = ts.call(op="grade", history=s["history"], heroSeat=s["heroSeat"], heroCards=s["heroCards"],
                     personas=s["personas"], chosen=mine[-1]["action"], options={"particles": 300, "trialsPerCombo": 50})
        bad |= g2["chosen"] != len(mine) - 1 or len(g2["options"]) != len(mine)
        n += 1
        if bad:
            ok = False
            print("  BAD", s["cfg"], s["seed"], s["street"], la, acts, want)
    print(f"G5 {'PASS' if ok else 'FAIL'}: {n} real spots checked")
    return ok


def fmt(chips, bb):
    x = js_round(chips / bb * 10) / 10
    return f"{int(x) if x == int(x) else x} bb"


js_round = ref.js_round


def G6(ts, spots):
    print("G6 hidden information")
    ok = True
    ss = pick(spots, lambda s: s["street"] != "preflop", 8, 1)
    for s in ss:
        base = ts.call(op="grade", history=s["history"], heroSeat=s["heroSeat"], heroCards=s["heroCards"],
                       personas=s["personas"], options={"particles": 500, "trialsPerCombo": 50})
        # same public history from a different real deal (bots' hole cards + undealt deck reshuffled)
        alt = ts.call(op="redeal", spot=s, seed=4242)
        assert alt["history"] == s["history"], "redeal changed the public history"
        assert alt["realHole"] != s["realHole"]
        g = ts.call(op="grade", history=alt["history"], heroSeat=s["heroSeat"], heroCards=alt["heroCards"],
                    personas=s["personas"], options={"particles": 500, "trialsPerCombo": 50})
        same_out = json.dumps(g, sort_keys=True) == json.dumps(base, sort_keys=True)
        print(f'  {"OK " if same_out else "BAD"} {s["cfg"]}#{s["seed"]} {s["street"]} bots {s["realHole"]} -> {alt["realHole"]}')
        ok &= same_out
    # a history that leaks the future board must be rejected
    s = next(x for x in spots if x["street"] == "flop")
    full = dict(s["history"], board=s["realDeck"][2 * len(s["personas"]): 2 * len(s["personas"]) + 5])
    try:
        ts.call(op="grade", history=full, heroSeat=s["heroSeat"], heroCards=s["heroCards"], personas=s["personas"])
        print("  BAD: a flop history carrying 5 board cards was accepted")
        ok = False
    except RuntimeError as e:
        print("  OK  future-board history rejected:", str(e).splitlines()[0][:100])
    print(f"G6 {'PASS' if ok else 'FAIL'}: {len(ss)} spots")
    return ok


if __name__ == "__main__":
    which = sys.argv[1:] or ["G1", "G2", "G3", "G4", "G5", "G6"]
    ts = TS()
    spots = gen(ts)
    print(f"{len(spots)} hero decisions generated")
    res = {}
    for c in which:
        t = time.time()
        res[c] = globals()[c](ts, spots)
        print(f"  ({time.time() - t:.0f}s)\n")
    print(" ".join(f"{k}:{'PASS' if v else 'FAIL'}" for k, v in res.items()))
