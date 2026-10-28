"""Math judge's independent reference for lib/grading (gradeDecision).

Only the engine (public states) and the bots' strategy tables come from TypeScript (ts_rpc.ts). Everything
else is redone here: posteriors (Bayes over strategy tables), hero's candidates, pot layering, hand values
and equities (oracle/poker_oracle.py), the current-street tree with best-responding hero, tiers.
"""

from __future__ import annotations

import itertools
import json
import math
import os
import random
import subprocess
import sys
from fractions import Fraction
from multiprocessing import Pool

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "oracle"))
import poker_oracle as O  # noqa: E402

COMBOS = [None] * 1326
for x in range(1, 52):
    for y in range(x):
        COMBOS[x * (x - 1) // 2 + y] = (x, y)
NA = 8


class TS:
    def __init__(self):
        self.p = subprocess.Popen(
            ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./lib/poker/scripts/register-ts.mjs",
             "lib/grading/oracle/ts_rpc.ts"],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

    def call(self, **req):
        self.p.stdin.write(json.dumps(req) + "\n")
        self.p.stdin.flush()
        res = json.loads(self.p.stdout.readline())
        if not res["ok"]:
            raise RuntimeError(res["error"])
        return res["value"]


def same(a, b):
    return a["type"] == b["type"] and (a["type"] != "raise" or a["to"] == b["to"])


def js_round(x):
    return math.floor(x + 0.5)


# ------------------------------------------------------------------ posteriors

def posterior(ts, history, seat, persona, dead):
    decs = ts.call(op="lik", history=history, seat=seat, persona=persona)
    known = set(history["board"]) | set(dead)
    w = np.array([0.0 if (x in known or y in known) else 1.0 for (x, y) in COMBOS])
    for d in decs:
        probs = np.array(d["probs"]).reshape(1326, NA)
        match = [a for a in range(NA) if d["concrete"][a] and same(d["concrete"][a], d["action"])]
        assert match, "observed action never taken"
        w *= probs[:, match].sum(axis=1)
    return w / w.sum()


# ------------------------------------------------------------------ candidates (spec, independent)

def candidates(la, pot, max_bet):
    out = []

    def add(a, kind):
        if not any(same(a, b["action"]) for b in out):
            if a["type"] == "raise" and a["to"] == la["maxRaiseTo"]:
                kind = "allin"
            out.append({"action": a, "kind": kind})

    if la["canFold"]:
        add({"type": "fold"}, "fold")
    if la["canCheck"]:
        add({"type": "check"}, "check")
    if la["canCall"]:
        add({"type": "call"}, "call")
    if la["canRaise"]:
        if la["isBet"]:
            sizes = [0.33 * pot, 0.66 * pot, 1 * pot]
            kind = "bet"
        else:
            sizes = [la["minRaiseTo"], max_bet + pot + la["toCall"]]
            kind = "raise"
        for s in sizes:
            to = max(la["minRaiseTo"], min(la["maxRaiseTo"], js_round(s)))
            add({"type": "raise", "to": to}, kind)
        add({"type": "raise", "to": la["maxRaiseTo"]}, "allin")
    return out


# ------------------------------------------------------------------ pots

def layers(committed, live):
    """Side pots from contributions: [(amount, eligible seats)]."""
    levels = sorted(set(committed[i] for i in range(len(committed)) if live[i] and committed[i] > 0))
    out = []
    prev = 0
    for k, lv in enumerate(levels):
        amt = 0
        for i, c in enumerate(committed):
            top = lv if k < len(levels) - 1 else max(lv, c)  # folded chips above the top live level go to the top layer
            amt += max(0, min(c, top) - min(c, prev))
        elig = [i for i in range(len(committed)) if live[i] and committed[i] >= lv]
        out.append((amt, elig))
        prev = lv
    assert sum(a for a, _ in out) == sum(committed), (committed, live, out)
    return out


# ------------------------------------------------------------------ showdown models

class Model:
    """particles: combos[k] (np int array) per live bot seats[k]; weights; share(mask) -> np array."""

    def __init__(self, seats, combos, weights, share_fn):
        self.seats = seats
        self.combos = combos
        self.w = weights
        self.n = len(weights)
        self._share = share_fn
        self._cache = {}

    def share(self, mask):
        if mask not in self._cache:
            self._cache[mask] = self._share(mask)
        return self._cache[mask]


def _eq_hu(args):
    hero, combo, board = args
    r = O.equity([list(hero), list(combo)], board, processes=1)
    return r["equity"][0]


def _mc_hu(args):
    hero, combo, n, seed = args
    rng = random.Random(seed)
    deck = [c for c in range(52) if c not in hero and c not in combo]
    runouts = (tuple(rng.sample(deck, 5)) for _ in range(n))
    wins, ties, units, total = O._tally([list(hero), list(combo)], [], runouts)
    p = units[0] / (O._EQ_UNITS * total)
    # per-trial share in {0, 1/2, 1}: var = E[x^2] - p^2
    ex2 = (wins[0] + ties[0] / 4) / total
    return p, math.sqrt(max(0.0, ex2 - p * p) / total)


POOL = None


def pool():
    global POOL
    if POOL is None:
        POOL = Pool(8)
    return POOL


def hu_model(seat, w, hero, board, preflop_trials=100_000, seed=1):
    idx = np.nonzero(w > 0)[0]
    ww = w[idx] / w[idx].sum()
    if len(board) >= 3:
        eqs = pool().map(_eq_hu, [(hero, COMBOS[c], board) for c in idx], chunksize=16)
        share = np.array([float(e) for e in eqs])
        se = np.zeros(len(idx))
    else:
        res = pool().map(_mc_hu, [(hero, COMBOS[c], preflop_trials, seed * 100003 + int(c)) for c in idx], chunksize=4)
        share = np.array([r[0] for r in res])
        se = np.array([r[1] for r in res])
    m = Model([seat], [idx], ww, lambda mask: share)
    m.share_se = se
    return m


def _fast_eval(cards):
    """oracle evaluate() via its packed rank key + memo (same values, much faster)."""
    packed = 0
    for c in cards:
        packed += O._PACKED[c]
    if (packed + O._PLUS3) & O._BIT3:
        return O.best_hand_reference(cards)
    v = O._rank_memo.get(packed & O._LOW32)
    if v is None:
        v = O._rank_only_best([O.rank_of(c) for c in cards])
    return v


def _mw_shares(args):
    """Exact hero shares vs masks of bots for one joint holding over all remaining runouts."""
    hero, combos, board, nb = args
    used = set(hero) | set(board) | {c for cb in combos for c in cb}
    deck = [c for c in range(52) if c not in used]
    need = 5 - len(board)
    nmask = 1 << nb
    sums = [0.0] * nmask
    total = 0
    for run in itertools.combinations(deck, need):
        b = list(board) + list(run)
        hv = _fast_eval(list(hero) + b)
        vs = [_fast_eval(list(cb) + b) for cb in combos]
        total += 1
        for mask in range(1, nmask):
            beaten = False
            ties = 0
            for k in range(nb):
                if (mask >> k) & 1:
                    if vs[k] > hv:
                        beaten = True
                        break
                    if vs[k] == hv:
                        ties += 1
            if not beaten:
                sums[mask] += 1 / (1 + ties)
    return [s / total for s in sums]


def mw_model_exact(seats, ws, hero, board):
    """Exact joint posterior over disjoint holdings (product of marginal likelihoods), river or turn.
    Hero's share vs every subset of bots is enumerated over every remaining river card (turn)."""
    supports = [np.nonzero(w > 0)[0] for w in ws]
    nb = len(seats)
    # all disjoint joint holdings
    grids = np.meshgrid(*supports, indexing="ij")
    cols = [g.ravel() for g in grids]
    hi = np.array([c[0] for c in COMBOS]); lo = np.array([c[1] for c in COMBOS])
    ok = np.ones(len(cols[0]), bool)
    for i in range(nb):
        for j in range(i + 1, nb):
            a1, b1, a2, b2 = hi[cols[i]], lo[cols[i]], hi[cols[j]], lo[cols[j]]
            ok &= (a1 != a2) & (a1 != b2) & (b1 != a2) & (b1 != b2)
    cols = [c[ok] for c in cols]
    wts = np.ones(len(cols[0]))
    for k in range(nb):
        wts *= ws[k][cols[k]]
    wts /= wts.sum()
    n = len(wts)
    rivers = [None] if len(board) == 5 else [c for c in range(52) if c not in set(hero) | set(board)]
    def val(cards):
        return O.evaluate(cards)
    hv_t = [val(list(hero) + list(board) + ([r] if r is not None else [])) for r in rivers]
    # per bot: value of each support combo with each river (None if the river card is in the combo)
    table_vals = []
    for k in range(nb):
        m = {}
        for t in supports[k]:
            m[t] = [val(list(COMBOS[t]) + list(board) + ([r] if r is not None else [])) if (r is None or r not in COMBOS[t]) else None
                    for r in rivers]
        table_vals.append(m)
    allv = sorted({v for v in hv_t} | {v for m in table_vals for row in m.values() for v in row if v is not None})
    rank = {v: i for i, v in enumerate(allv)}
    H = np.array([rank[v] for v in hv_t])  # per river
    V = []
    for k in range(nb):
        arr = np.full((1326, len(rivers)), -1)
        for t, row in table_vals[k].items():
            arr[t] = [rank[v] if v is not None else -1 for v in row]
        V.append(arr[cols[k]])  # n x R ; -1 = river card used by this bot
    valid = np.ones((n, len(rivers)), bool)
    for k in range(nb):
        valid &= V[k] >= 0
    cnt = valid.sum(axis=1)
    table = np.zeros((n, 1 << nb))
    for mask in range(1, 1 << nb):
        beaten = np.zeros((n, len(rivers)), bool)
        ties = np.zeros((n, len(rivers)))
        for k in range(nb):
            if (mask >> k) & 1:
                beaten |= V[k] > H[None, :]
                ties += V[k] == H[None, :]
        sh = np.where(beaten, 0.0, 1.0 / (1.0 + ties))
        table[:, mask] = (sh * valid).sum(axis=1) / cnt
    return Model(seats, cols, wts, lambda mask: table[:, mask].copy())


def mw_model_sample(seats, ws, hero, board, count, seed):
    """Independent large sample of joint holdings (rejection), exact runouts per particle."""
    rng = np.random.default_rng(seed)
    nb = len(seats)
    cols = [[] for _ in range(nb)]
    known = set(hero) | set(board)
    while len(cols[0]) < count:
        draws = [rng.choice(1326, size=4096, p=w) for w in ws]
        for j in range(4096):
            cards = [c for k in range(nb) for c in COMBOS[draws[k][j]]]
            if len(set(cards)) != len(cards) or known & set(cards):
                continue
            for k in range(nb):
                cols[k].append(int(draws[k][j]))
            if len(cols[0]) >= count:
                break
    cols = [np.array(c) for c in cols]
    jobs = [(hero, [COMBOS[cols[k][i]] for k in range(nb)], board, nb) for i in range(count)]
    table = np.array(pool().map(_mw_shares, jobs, chunksize=64))
    m = Model(seats, cols, np.full(count, 1 / count), lambda mask: table[:, mask].copy())
    m.sampled = True
    return m


# ------------------------------------------------------------------ the tree

class Tree:
    def __init__(self, ts, spot, model, max_raises=4):
        self.ts = ts
        self.spot = spot
        self.m = model
        self.max_raises = max_raises
        self.hero = spot["heroSeat"]
        self.cache = {}
        root = self.node([])
        self.root = root
        self.street = root["street"]
        self.stack_now = root["stacks"][self.hero]
        self.hero_start = root["startingStacks"][self.hero]
        self.col = {s: k for k, s in enumerate(model.seats)}
        self.multi_layer_terminals = 0

    def node(self, path):
        key = json.dumps(path)
        if key not in self.cache:
            sp = self.spot
            v = self.ts.call(op="node", history=sp["history"], path=path, heroCards=sp["heroCards"],
                             personas=sp["personas"], seed=99)
            if "probs" in v:
                v["probs"] = np.array(v["probs"]).reshape(1326, NA)
            self.cache[key] = v
        return self.cache[key]

    def visit(self, path, reach, acc, first_bot=None):
        s = self.node(path)
        if s["complete"] or s["street"] != self.street or s["folded"][self.hero]:
            return self.terminal(s, reach, acc)
        seat = s["la"]["seat"]
        if seat == self.hero:
            return self.hero_node(path, s, reach, acc)
        return self.bot_node(path, s, seat, reach, acc, first_bot)

    def terminal(self, s, reach, acc):
        h = self.hero
        base = self.hero_start - s["committed"][h] - self.stack_now
        if s["folded"][h]:
            acc["value"] += reach * base
            return
        live = [not f for f in s["folded"]]
        if sum(live) == 1:
            acc["value"] += reach * (base + sum(s["committed"]))
            acc["foldout"] += reach
            return
        if not s["complete"]:
            acc["continues"] = True
        fixed = base
        won = np.zeros(self.m.n)
        contested = 0
        L = layers(s["committed"], live)
        if len([1 for a, e in L if h in e]) > 1:
            self.multi_layer_terminals += 1
        for amt, elig in L:
            if h not in elig:
                continue
            mask = 0
            for seat in elig:
                if seat != h:
                    mask |= 1 << self.col[seat]
            if mask == 0:
                fixed += amt
            else:
                acc["card"] = True
                won += amt * self.m.share(mask)
                contested += amt
                acc["grad"] += reach * amt  # d EV / d share (heads-up)
        acc["value"] += reach * (fixed + won)
        acc["sdchips"] += reach * contested
        acc["sdwon"] += reach * won

    def new_acc(self):
        n = self.m.n
        return {"value": np.zeros(n), "foldout": np.zeros(n), "sdchips": np.zeros(n), "sdwon": np.zeros(n),
                "grad": np.zeros(n), "continues": False, "card": False, "botacted": False, "responses": []}

    def hero_cands(self, s):
        c = candidates(s["la"], s["pot"], max(s["bets"]))
        raises = sum(1 for e in s["streetActions"] if e["action"] in ("bet", "raise"))
        if raises >= self.max_raises:
            c = [x for x in c if x["action"]["type"] != "raise"]
        return c

    def hero_node(self, path, s, reach, acc):
        best, best_score = None, -math.inf
        for c in self.hero_cands(s):
            sub = self.new_acc()
            self.visit(path + [c["action"]], reach, sub)
            score = float(self.m.w @ sub["value"])
            if score > best_score:
                best, best_score = sub, score
        for k in ("value", "foldout", "sdchips", "sdwon", "grad"):
            acc[k] += best[k]
        for k in ("continues", "card", "botacted"):
            acc[k] = acc[k] or best[k]

    def bot_node(self, path, s, seat, reach, acc, first_bot):
        k = self.col[seat]
        probs = s["probs"][self.m.combos[k]]  # n x 8
        groups = []
        for a, act in enumerate(s["concrete"]):
            if not act:
                continue
            g = next((g for g in groups if same(g[0], act)), None)
            if g:
                g[1].append(a)
            else:
                groups.append((act, [a]))
        acc["botacted"] = True
        for act, ab in groups:
            child = reach * probs[:, ab].sum(axis=1)
            mass = float(self.m.w @ child)
            if not mass > 0:
                continue
            if first_bot is not None:
                first_bot.append((act, mass))
            self.visit(path + [act], child, acc)

    def evaluate(self, action):
        acc = self.new_acc()
        resp = []
        self.visit([action], np.ones(self.m.n), acc, first_bot=resp)
        w = self.m.w
        ev = float(w @ acc["value"])
        sd = float(w @ acc["sdchips"])
        out = {
            "ev": ev,
            "foldEquity": float(w @ acc["foldout"]),
            "showdownEquity": float(w @ acc["sdwon"]) / sd if sd > 0 else None,
            "responses": resp,
            "continues": acc["continues"],
            "card": acc["card"],
            "botacted": acc["botacted"],
            "values": acc["value"],
        }
        if getattr(self.m, "share_se", None) is not None:
            out["se_ref"] = float(np.sqrt(np.sum((w * acc["grad"] * self.m.share_se) ** 2)))
        if getattr(self.m, "sampled", False):
            v = acc["value"]
            out["se_ref"] = float(np.std(v, ddof=1) / math.sqrt(len(v)))
        return out


TIERS = [(0.005, "best"), (0.03, "correct"), (0.08, "inaccuracy"), (0.2, "mistake")]


def tier_of(x):
    for t, name in TIERS:
        if x <= t:
            return name
    return "blunder"


def grade_tiers(evs, ses, pot):
    b = 0
    for i in range(1, len(evs)):
        if evs[i] > evs[b]:
            b = i
    out = []
    for i in range(len(evs)):
        loss = max(0.0, evs[b] - evs[i])
        if i == b:
            out.append("best")
        else:
            out.append(tier_of(max(0.0, loss - 2 * math.sqrt(ses[b] ** 2 + ses[i] ** 2)) / pot))
    return b, out
