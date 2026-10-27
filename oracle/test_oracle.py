"""Self-tests proving the oracle is right.

    python3 oracle/test_oracle.py            # fast tier (~30 s)
    ORACLE_SLOW=1 python3 oracle/test_oracle.py   # + exhaustive 7-card + naive preflop check
"""

import itertools
import os
import random
import sys
import time
import unittest
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from fractions import Fraction
from math import comb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import poker_oracle as po  # noqa: E402
from poker_oracle import (  # noqa: E402
    FLUSH, FULL_HOUSE, HIGH_CARD, PAIR, QUADS, STRAIGHT, STRAIGHT_FLUSH, TRIPS, TWO_PAIR,
    best_hand_reference, equity, eval5, evaluate, expand_range, parse_cards,
)

SLOW = os.environ.get("ORACLE_SLOW") == "1"

FIVE_CARD_COUNTS = {
    STRAIGHT_FLUSH: 40, QUADS: 624, FULL_HOUSE: 3_744, FLUSH: 5_108, STRAIGHT: 10_200,
    TRIPS: 54_912, TWO_PAIR: 123_552, PAIR: 1_098_240, HIGH_CARD: 1_302_540,
}
SEVEN_CARD_COUNTS = {
    STRAIGHT_FLUSH: 41_584, QUADS: 224_848, FULL_HOUSE: 3_473_184, FLUSH: 4_047_644,
    STRAIGHT: 6_180_020, TRIPS: 6_461_620, TWO_PAIR: 31_433_400, PAIR: 58_627_800,
    HIGH_CARD: 23_294_460,
}


def E(cards):
    return evaluate(cards)


class FiveCardEnumeration(unittest.TestCase):
    def test_all_2598960_hands(self):
        t0 = time.perf_counter()
        cats = Counter()
        distinct = set()
        for hand in itertools.combinations(range(52), 5):
            v = eval5(hand)
            cats[v[0]] += 1
            distinct.add(v)
        dt = time.perf_counter() - t0
        print(f"\n  [5-card enumeration of 2,598,960 hands: {dt:.1f}s]", end=" ")
        self.assertEqual(sum(cats.values()), 2_598_960)
        self.assertEqual(dict(cats), FIVE_CARD_COUNTS)
        self.assertEqual(len(distinct), 7_462)
        per_cat = Counter(v[0] for v in distinct)
        # distinct values per category: 10 SF, 156 quads, 156 FH, 1277 flush, 10 straights,
        # 858 trips, 858 two pair, 2860 pair, 1277 high card
        self.assertEqual(per_cat, Counter({STRAIGHT_FLUSH: 10, QUADS: 156, FULL_HOUSE: 156,
                                           FLUSH: 1277, STRAIGHT: 10, TRIPS: 858,
                                           TWO_PAIR: 858, PAIR: 2860, HIGH_CARD: 1277}))


class EvaluatorSpotChecks(unittest.TestCase):
    def test_wheel_is_lowest_straight(self):
        wheel = E("As2d3h4c5s")
        six_high = E("2d3h4c5s6d")
        self.assertEqual(wheel, (STRAIGHT, 3))
        self.assertLess(wheel, six_high)
        self.assertGreater(wheel, E("AsAdAhKcQs"))  # beats trips
        # lowest of all ten straight values
        all_straights = {E([top * 4, (top - 1) * 4 + 1, (top - 2) * 4, (top - 3) * 4, (top - 4) * 4])
                         for top in range(4, 13)}
        self.assertEqual(len(all_straights), 9)
        self.assertLess(wheel, min(all_straights))
        self.assertEqual(E("Th Jd Qs Kc Ad"), (STRAIGHT, 12))

    def test_steel_wheel_and_royal(self):
        steel = E("As2s3s4s5s")
        self.assertEqual(steel, (STRAIGHT_FLUSH, 3))
        self.assertLess(steel, E("2h3h4h5h6h"))
        self.assertGreater(steel, E("AsAdAhAcKs"))
        self.assertEqual(E("TsJsQsKsAs"), (STRAIGHT_FLUSH, 12))

    def test_no_wraparound(self):
        self.assertEqual(E("Qs Kd Ah 2c 3s")[0], HIGH_CARD)

    def test_seven_card_choices(self):
        # three pairs: best two pairs + best remaining kicker
        self.assertEqual(E("AsAdKsKdQsQd2c"), (TWO_PAIR, 12, 11, 10))
        # two sets -> full house, higher set over
        self.assertEqual(E("9s9d9h5c5s5d2c"), (FULL_HOUSE, 7, 3))
        # six suited cards -> top five of the suit
        self.assertEqual(E("2h4h6h8hThQh3c"), (FLUSH, 10, 8, 6, 4, 2))
        # straight and flush both present but not together -> flush
        self.assertEqual(E("5h6d7h8c9hKhAh")[0], FLUSH)
        # 6-card straight run picks the top
        self.assertEqual(E("4c5d6h7s8c9dKs"), (STRAIGHT, 7))
        # wheel plus a 6 makes a 6-high straight
        self.assertEqual(E("Ac2d3h4s5c6dKs"), (STRAIGHT, 4))
        # quads use best kicker even when a pair is present
        self.assertEqual(E("7s7d7h7cKdKs2c"), (QUADS, 5, 11))
        # kicker decides
        self.assertGreater(E("AsAdKc7h5d"), E("AhAcQd7s5c"))
        # board-playing two pair: fifth card kicker
        self.assertEqual(E("KsKdQhQc3s"), (TWO_PAIR, 11, 10, 1))

    def test_fast_matches_reference_random(self):
        rng = random.Random(20261026)
        deck = list(range(52))
        for n, trials in ((5, 30_000), (6, 30_000), (7, 60_000)):
            for _ in range(trials):
                cards = rng.sample(deck, n)
                self.assertEqual(evaluate(cards), best_hand_reference(cards), cards)

    def test_fast_matches_reference_flushy(self):
        # bias toward flush/straight-flush situations where the fast path falls back
        rng = random.Random(7)
        for _ in range(20_000):
            suit = rng.randrange(4)
            suited = [r * 4 + suit for r in rng.sample(range(13), rng.randint(4, 7))]
            others = [c for c in range(52) if c not in suited]
            cards = (suited + rng.sample(others, 7))[:7]
            self.assertEqual(evaluate(cards), best_hand_reference(cards), cards)


def naive_equity(hands, board=(), dead=()):
    """Straightforward reference: every board, reference evaluator, no tricks."""
    hands = [parse_cards(h) for h in hands]
    board = parse_cards(board)
    used = set(c for h in hands for c in h) | set(board) | set(parse_cards(dead))
    deck = [c for c in range(52) if c not in used]
    eq = [Fraction(0)] * len(hands)
    total = 0
    for runout in itertools.combinations(deck, 5 - len(board)):
        total += 1
        vals = [best_hand_reference(h + board + list(runout)) for h in hands]
        best = max(vals)
        winners = [i for i, v in enumerate(vals) if v == best]
        for i in winners:
            eq[i] += Fraction(1, len(winners))
    return [e / total for e in eq]


class HandCountedEquity(unittest.TestCase):
    def test_turn_flush_draw_vs_set(self):
        # AhKh vs QsQc on 2h7hQd3c. 44 rivers. Hearts left: 3h4h5h6h8h9hThJhQh (9).
        # 3h/7h-pair... 3h pairs the 3 (QQQ33 full house), Qh gives quads -> 7 clean outs.
        r = equity(["AhKh", "QsQc"], "2h7hQd3c")
        self.assertEqual(r["boards"], 44)
        self.assertEqual(r["equity"][0], Fraction(7, 44))
        self.assertEqual(r["tie"][0], 0)
        # kill one out with a dead card: 6 outs of 43
        r = equity(["AhKh", "QsQc"], "2h7hQd3c", dead="4h")
        self.assertEqual(r["equity"][0], Fraction(6, 43))

    def test_flop_straight_flush_draw_vs_quads(self):
        # QhJh vs AsAc on AhAdTh: villain has quads. Hero wins only with a straight flush:
        # any runout containing Kh (44 of C(45,2)=990), or exactly 9h+8h (1). 45/990 = 1/22.
        r = equity(["QhJh", "AsAc"], "AhAdTh")
        self.assertEqual(r["boards"], 990)
        self.assertEqual(r["win_count"][0], 45)
        self.assertEqual(r["equity"][0], Fraction(1, 22))

    def test_flop_overpair_vs_underpair(self):
        # AhAs vs KdKc on 2c7d9h: KK needs a king (87 of 990 runouts have one of Ks/Kh)
        # but loses the 4 runouts that are K + A. 83/990, no ties possible.
        r = equity(["AhAs", "KdKc"], "2c7d9h")
        self.assertEqual(r["win_count"][1], 83)
        self.assertEqual(r["equity"][1], Fraction(83, 990))
        self.assertEqual(sum(r["tie_count"]), 0)

    def test_board_plays_split(self):
        r = equity(["2c3d", "4h5h", "7c8c"], "AsKsQsJsTs")
        self.assertEqual(r["boards"], 1)
        self.assertEqual(r["equity"], [Fraction(1, 3)] * 3)
        self.assertEqual(r["tie"], [1, 1, 1])

    def test_split_with_partial_tie(self):
        # River AsKcQd3h3s: both AK hands make aces-and-kings with a queen kicker and chop;
        # 2c2d makes threes-and-twos and gets nothing.
        r = equity(["AhKd", "AcKh", "2c2d"], "AsKcQd3h3s")
        self.assertEqual(r["equity"], [Fraction(1, 2), Fraction(1, 2), 0])

    def test_matches_naive_reference(self):
        cases = [
            (["AhKh", "QsQc", "Jd9d"], "2h7hQd", ""),
            (["AsKd", "7c7d", "JhTh", "5s4s"], "9h8s2c3d", "Ac"),
            (["Ac2c", "KdQd"], "3c4c9d", "5c"),
        ]
        for hands, board, dead in cases:
            r = equity(hands, board, dead)
            self.assertEqual(r["equity"], naive_equity(hands, board, dead), (hands, board))
            self.assertEqual(sum(r["equity"]), 1)

    def test_symmetries(self):
        # swapping hand order permutes results; relabelling suits changes nothing
        a = equity(["AhKh", "7c7d", "QsJs"], "2h9s")
        b = equity(["QsJs", "AhKh", "7c7d"], "2h9s")
        self.assertEqual(a["equity"], [b["equity"][1], b["equity"][2], b["equity"][0]])
        c = equity(["AsKs", "7d7h", "QcJc"], "2s9c")  # h->s, c->d, d->h, s->c
        self.assertEqual(a["equity"], c["equity"])
        self.assertEqual(sum(a["equity"]), 1)

    def test_six_way(self):
        hands = ["AhAd", "KsKc", "QhJh", "Tc9c", "8s8d", "6h5h"]
        r = equity(hands, "2c7hJd")
        self.assertEqual(r["boards"], comb(52 - 15, 2))
        self.assertEqual(sum(r["equity"]), 1)
        self.assertEqual(r["equity"], naive_equity(hands, "2c7hJd"))

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            equity(["AhKh", "AhQd"])
        with self.assertRaises(ValueError):
            equity(["AhKh"])
        with self.assertRaises(ValueError):
            equity(["AhKh", "QdQc"], "2c3c4c", dead="2c")


class Ranges(unittest.TestCase):
    def n(self, text, dead=()):
        return len(expand_range(text, dead))

    def test_counts(self):
        self.assertEqual(self.n("22"), 6)
        self.assertEqual(self.n("22+"), 78)
        self.assertEqual(self.n("TT+"), 30)
        self.assertEqual(self.n("22-55"), 24)
        self.assertEqual(self.n("55-22"), 24)
        self.assertEqual(self.n("AKs"), 4)
        self.assertEqual(self.n("AKo"), 12)
        self.assertEqual(self.n("AK"), 16)
        self.assertEqual(self.n("KA"), 16)
        self.assertEqual(self.n("ATs+"), 16)   # ATs AJs AQs AKs
        self.assertEqual(self.n("ATo+"), 48)
        self.assertEqual(self.n("AT+"), 64)
        self.assertEqual(self.n("K9s+"), 16)   # K9s KTs KJs KQs
        self.assertEqual(self.n("KTs-K7s"), 16)
        self.assertEqual(self.n("A5s-A2s"), 16)
        self.assertEqual(self.n("AhKh"), 1)
        self.assertEqual(self.n("ahkh"), 1)
        self.assertEqual(self.n("AKs, AhKh"), 4)  # duplicates collapse
        self.assertEqual(self.n("22+,AKs,ATs+,KTs-K7s,A5s-A2s,AhKh"), 78 + 16 + 16 + 16)
        # full deck of starting hands
        everything = ",".join(f"{a}{b}" for i, a in enumerate(po.RANKS) for b in po.RANKS[:i + 1])
        self.assertEqual(self.n(everything), 1326)

    def test_exact_members(self):
        self.assertEqual({po.combo_str(c) for c in expand_range("AKs")},
                         {"AcKc", "AdKd", "AhKh", "AsKs"})
        self.assertEqual({po.combo_str(c) for c in expand_range("KTs-K8s")},
                         {f"K{s}{r}{s}" for r in "T98" for s in "cdhs"})
        self.assertEqual({po.combo_str(c) for c in expand_range("A5s-A3s")},
                         {f"A{s}{r}{s}" for r in "543" for s in "cdhs"})
        self.assertEqual(len({po.combo_str(c) for c in expand_range("QQ")}), 6)

    def test_card_removal(self):
        self.assertEqual(self.n("AK", dead="As"), 12)
        self.assertEqual(self.n("AA", dead="Ah"), 3)
        self.assertEqual(self.n("AA", dead="AhAs"), 1)
        self.assertEqual(self.n("AKs", dead="Ks"), 3)
        self.assertEqual(self.n("AKo", dead="As"), 9)
        self.assertEqual(self.n("22+", dead="2c7d9h"), 78 - 3 - 3 - 3)

    def test_rejects_garbage(self):
        for bad in ["KTs-Q7s", "AAs", "AKx", "AhAh", "22-AKs", "ATs-A5o", "1A"]:
            with self.assertRaises(ValueError, msg=bad):
                expand_range(bad)


# ---------------------------------------------------------------- slow tier

def _seven_card_shard(first):
    """All 7-card hands whose lowest card is `first`, via the fast evaluator."""
    cats = Counter()
    distinct = set()
    for rest in itertools.combinations(range(first + 1, 52), 6):
        v = evaluate((first,) + rest)
        cats[v[0]] += 1
        distinct.add(v)
    return cats, distinct


def _naive_preflop_shard(args):
    hands, deck, i = args
    eq = [Fraction(0), Fraction(0)]
    for rest in itertools.combinations(deck[i + 1:], 4):
        runout = [deck[i], *rest]
        a = best_hand_reference(hands[0] + runout)
        b = best_hand_reference(hands[1] + runout)
        if a > b:
            eq[0] += 1
        elif b > a:
            eq[1] += 1
        else:
            eq[0] += Fraction(1, 2)
            eq[1] += Fraction(1, 2)
    return eq


@unittest.skipUnless(SLOW, "set ORACLE_SLOW=1")
class Slow(unittest.TestCase):
    def test_all_133784560_seven_card_hands(self):
        t0 = time.perf_counter()
        cats, distinct = Counter(), set()
        with ProcessPoolExecutor() as pool:
            for c, d in pool.map(_seven_card_shard, range(46)):
                cats.update(c)
                distinct |= d
        print(f"\n  [7-card enumeration: {time.perf_counter() - t0:.1f}s]", end=" ")
        self.assertEqual(sum(cats.values()), comb(52, 7))
        self.assertEqual(dict(cats), SEVEN_CARD_COUNTS)
        self.assertEqual(len(distinct), 4_824)

    def test_preflop_fast_matches_naive(self):
        hands = [parse_cards("AhAs"), parse_cards("KdKc")]
        deck = [c for c in range(52) if c not in set(hands[0] + hands[1])]
        t0 = time.perf_counter()
        fast = equity(hands)
        t_fast = time.perf_counter() - t0
        t0 = time.perf_counter()
        eq = [Fraction(0), Fraction(0)]
        with ProcessPoolExecutor() as pool:
            for e in pool.map(_naive_preflop_shard, [(hands, deck, i) for i in range(44)]):
                eq[0] += e[0]
                eq[1] += e[1]
        print(f"\n  [preflop fast {t_fast:.1f}s, naive {time.perf_counter() - t0:.1f}s]", end=" ")
        total = comb(48, 5)
        self.assertEqual(fast["equity"], [eq[0] / total, eq[1] / total])


if __name__ == "__main__":
    unittest.main(verbosity=2)
