"""Independent poker math oracle (Python standard library only).

Written from first principles to cross-check the app's TypeScript math core.

Cards are ints 0..51: card = rank * 4 + suit, rank 0..12 = '2'..'A', suit 0..3 = 'c','d','h','s'.
Hand values are tuples (category, tiebreak ranks...) that compare correctly with < / == / >.
"""

from __future__ import annotations

import itertools
import re
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from fractions import Fraction

RANKS = "23456789TJQKA"
SUITS = "cdhs"

HIGH_CARD, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH = range(9)
CATEGORY_NAMES = [
    "high card", "pair", "two pair", "trips", "straight",
    "flush", "full house", "quads", "straight flush",
]


# ---------------------------------------------------------------- cards

def parse_card(text: str) -> int:
    if len(text) != 2 or text[0].upper() not in RANKS or text[1].lower() not in SUITS:
        raise ValueError(f"bad card: {text!r}")
    return RANKS.index(text[0].upper()) * 4 + SUITS.index(text[1].lower())


def parse_cards(cards) -> list[int]:
    """Accept 'AsKd', 'As Kd', 'As,Kd', ['As','Kd'] or a list of ints."""
    if isinstance(cards, str):
        compact = re.sub(r"[\s,]", "", cards)
        if len(compact) % 2:
            raise ValueError(f"bad card string: {cards!r}")
        return [parse_card(compact[i:i + 2]) for i in range(0, len(compact), 2)]
    return [c if isinstance(c, int) else parse_card(c) for c in cards]


def card_str(card: int) -> str:
    return RANKS[card // 4] + SUITS[card % 4]


def rank_of(card: int) -> int:
    return card // 4


def suit_of(card: int) -> int:
    return card % 4


# ---------------------------------------------------------------- 5-card evaluator (reference)

def rank5(ranks, is_flush: bool) -> tuple:
    """Value of exactly five cards given their ranks and whether all share a suit."""
    counts = Counter(ranks)
    # Group ranks by multiplicity, biggest group first, then higher rank first.
    groups = sorted(counts.items(), key=lambda rc: (rc[1], rc[0]), reverse=True)
    shape = [count for _, count in groups]
    by_group = [rank for rank, _ in groups]
    distinct_desc = sorted(counts, reverse=True)

    straight_high = None
    if len(distinct_desc) == 5:
        if distinct_desc[0] - distinct_desc[4] == 4:
            straight_high = distinct_desc[0]
        elif distinct_desc == [12, 3, 2, 1, 0]:  # A-2-3-4-5: the ace plays low
            straight_high = 3

    if straight_high is not None and is_flush:
        return (STRAIGHT_FLUSH, straight_high)
    if shape == [4, 1]:
        return (QUADS, *by_group)
    if shape == [3, 2]:
        return (FULL_HOUSE, *by_group)
    if is_flush:
        return (FLUSH, *distinct_desc)
    if straight_high is not None:
        return (STRAIGHT, straight_high)
    if shape == [3, 1, 1]:
        return (TRIPS, *by_group)
    if shape == [2, 2, 1]:
        return (TWO_PAIR, *by_group)
    if shape == [2, 1, 1, 1]:
        return (PAIR, *by_group)
    return (HIGH_CARD, *distinct_desc)


def eval5(cards) -> tuple:
    cards = parse_cards(cards)
    if len(cards) != 5 or len(set(cards)) != 5:
        raise ValueError("eval5 needs 5 distinct cards")
    return rank5([rank_of(c) for c in cards], len({suit_of(c) for c in cards}) == 1)


def best_hand_reference(cards) -> tuple:
    """Best 5 of N cards by trying every 5-card subset. Slow but obviously right."""
    cards = parse_cards(cards)
    return max(eval5(combo) for combo in itertools.combinations(cards, 5))


# ---------------------------------------------------------------- fast 5..7-card evaluator
#
# If no suit appears 5+ times, no 5-card subset can be a flush, so the best hand depends only
# on the multiset of ranks. Rank counts are <= 4, so sum(5**rank) encodes that multiset uniquely
# (base-5 digits). We memoise the rank-only answer per multiset; anything with a possible flush
# falls back to the reference best-of-subsets. Tests check this against the reference.

_RANK_KEY = [5 ** rank_of(c) for c in range(52)]
_rank_memo: dict[int, tuple] = {}


def _rank_only_best(ranks) -> tuple:
    """Best non-flush value of 5..7 ranks, memoised per rank multiset.

    For 6 or 7 ranks, the best 5-subset lies inside some (n-1)-subset, so
    best(n) = max(best(n-1) over the n ways to drop one card). Same answer as trying
    all C(n,5) subsets, but each multiset is solved once.
    """
    key = sum(5 ** r for r in ranks)
    value = _rank_memo.get(key)
    if value is None:
        if len(ranks) == 5:
            value = rank5(ranks, False)
        else:
            value = max(_rank_only_best(ranks[:i] + ranks[i + 1:]) for i in range(len(ranks)))
        _rank_memo[key] = value
    return value


def evaluate(cards) -> tuple:
    """Best 5-card value from 5..7 distinct cards."""
    cards = parse_cards(cards)
    if not 5 <= len(cards) <= 7 or len(set(cards)) != len(cards):
        raise ValueError("evaluate needs 5-7 distinct cards")
    suit_counts = Counter(suit_of(c) for c in cards)
    if max(suit_counts.values()) >= 5:
        return best_hand_reference(cards)
    return _rank_only_best([rank_of(c) for c in cards])


def describe(value: tuple) -> str:
    return CATEGORY_NAMES[value[0]] + " " + "".join(RANKS[r] for r in value[1:])


# ---------------------------------------------------------------- exact equity
#
# Per-card packed key for the enumeration hot loop: low 32 bits = 5**rank (rank multiset, as
# above), high bits = one byte per suit holding that suit's count. Summing keys sums both.
_SUIT_SHIFT = 32
_PACKED = [_RANK_KEY[c] + (1 << (_SUIT_SHIFT + 8 * suit_of(c))) for c in range(52)]
_LOW32 = (1 << 32) - 1
# A suit byte holds 0..7. byte >= 5  <=>  bit 3 of (byte + 3) is set (byte + 3 <= 10).
_PLUS3 = 0x03030303 << _SUIT_SHIFT
_BIT3 = 0x08080808 << _SUIT_SHIFT
_EQ_UNITS = 60  # lcm(1..6): a k-way split gives each winner 60 // k units, exactly


def _tally(hands, board, runouts):
    """Count wins / ties / equity units over an iterable of runouts (tuples of cards)."""
    n = len(hands)
    base = [tuple(h) + tuple(board) for h in hands]
    base_packed = [sum(_PACKED[c] for c in cards) for cards in base]
    wins = [0] * n
    ties = [0] * n
    units = [0] * n
    total = 0
    memo = _rank_memo
    for runout in runouts:
        total += 1
        rp = 0
        for c in runout:
            rp += _PACKED[c]
        values = []
        for i in range(n):
            packed = base_packed[i] + rp
            if (packed + _PLUS3) & _BIT3:  # some suit has 5+ cards: flush possible
                values.append(best_hand_reference(base[i] + runout))
            else:
                v = memo.get(packed & _LOW32)
                if v is None:
                    v = _rank_only_best([rank_of(c) for c in base[i] + runout])
                values.append(v)
        best = max(values)
        winners = [i for i in range(n) if values[i] == best]
        if len(winners) == 1:
            wins[winners[0]] += 1
            units[winners[0]] += _EQ_UNITS
        else:
            share = _EQ_UNITS // len(winners)
            for i in winners:
                ties[i] += 1
                units[i] += share
    return wins, ties, units, total


def _tally_first_card(args):
    """Worker: all runouts whose lowest-index card is deck[i]."""
    hands, board, deck, need, i = args
    first = (deck[i],)
    runouts = (first + rest for rest in itertools.combinations(deck[i + 1:], need - 1))
    return _tally(hands, board, runouts)


def equity(hands, board=(), dead=(), processes: int | None = None, parallel_threshold: int = 300_000):
    """Exact all-in equity by enumerating every remaining board.

    hands: 2..6 two-card hands. Returns a dict with exact Fractions per hand:
    win (sole winner), tie (shares the pot), equity (ties split fractionally), and 'boards'.
    """
    hands = [parse_cards(h) for h in hands]
    board = parse_cards(board)
    dead = parse_cards(dead)
    if not 2 <= len(hands) <= 6:
        raise ValueError("need 2..6 hands")
    if any(len(h) != 2 for h in hands):
        raise ValueError("each hand must be exactly 2 cards")
    if len(board) > 5:
        raise ValueError("board has at most 5 cards")
    used = [c for h in hands for c in h] + board + dead
    if len(used) != len(set(used)):
        raise ValueError("duplicate card among hands/board/dead")
    deck = [c for c in range(52) if c not in set(used)]
    need = 5 - len(board)
    if len(deck) < need:
        raise ValueError("not enough cards left to complete the board")

    from math import comb
    n_boards = comb(len(deck), need)
    if need >= 2 and n_boards >= parallel_threshold and processes != 1:
        jobs = [(hands, board, deck, need, i) for i in range(len(deck) - need + 1)]
        n = len(hands)
        wins, ties, units, total = [0] * n, [0] * n, [0] * n, 0
        with ProcessPoolExecutor(max_workers=processes) as pool:
            for w, t, u, tot in pool.map(_tally_first_card, jobs):
                for k in range(n):
                    wins[k] += w[k]
                    ties[k] += t[k]
                    units[k] += u[k]
                total += tot
    else:
        wins, ties, units, total = _tally(hands, board, itertools.combinations(deck, need))

    assert total == n_boards
    return {
        "boards": total,
        "win": [Fraction(w, total) for w in wins],
        "tie": [Fraction(t, total) for t in ties],
        "equity": [Fraction(u, _EQ_UNITS * total) for u in units],
        "win_count": wins,
        "tie_count": ties,
    }


# ---------------------------------------------------------------- ranges

_COMBO_RE = re.compile(r"^([2-9TJQKA][cdhs])([2-9TJQKA][cdhs])$")
_CLASS_RE = re.compile(r"^([2-9TJQKA])([2-9TJQKA])([so]?)$")


def _class_combos(hi: int, lo: int, kind: str) -> list[tuple[int, int]]:
    """All combos of a hand class. hi >= lo are ranks; kind in '', 's', 'o'."""
    out = []
    for s1 in range(4):
        for s2 in range(4):
            a, b = hi * 4 + s1, lo * 4 + s2
            if a == b:
                continue
            if hi == lo and s1 >= s2:  # pairs: each unordered suit pair once
                continue
            if kind == "s" and s1 != s2:
                continue
            if kind == "o" and s1 == s2:
                continue
            out.append((max(a, b), min(a, b)))
    return out


def _parse_class(text: str):
    if len(text) >= 2:
        text = text[:2].upper() + text[2:].lower()
    m = _CLASS_RE.match(text)
    if not m:
        raise ValueError(f"bad hand class: {text!r}")
    r1, r2, kind = RANKS.index(m.group(1)), RANKS.index(m.group(2)), m.group(3)
    hi, lo = max(r1, r2), min(r1, r2)
    if hi == lo and kind:
        raise ValueError(f"pairs take no suit suffix: {text!r}")
    return hi, lo, kind


def _expand_token(token: str) -> list[tuple[int, int]]:
    norm = token
    if len(token) == 4:  # normalise case of a specific combo like 'ahkh'
        norm = token[0].upper() + token[1].lower() + token[2].upper() + token[3].lower()
    m = _COMBO_RE.match(norm)
    if m:
        a, b = parse_card(m.group(1)), parse_card(m.group(2))
        if a == b:
            raise ValueError(f"combo repeats a card: {token!r}")
        return [(max(a, b), min(a, b))]

    if "-" in token:
        left, right = (part.strip() for part in token.split("-", 1))
        h1, l1, k1 = _parse_class(left)
        h2, l2, k2 = _parse_class(right)
        if k1 != k2:
            raise ValueError(f"range ends differ in suitedness: {token!r}")
        if h1 == l1 and h2 == l2:  # pair range, e.g. 22-55
            lo, hi = sorted((h1, h2))
            return [c for r in range(lo, hi + 1) for c in _class_combos(r, r, "")]
        if h1 == l1 or h2 == l2 or h1 != h2:
            raise ValueError(f"range ends must share the top card: {token!r}")
        lo, hi = sorted((l1, l2))
        return [c for k in range(lo, hi + 1) for c in _class_combos(h1, k, k1)]

    if token.endswith("+"):
        hi, lo, kind = _parse_class(token[:-1])
        if hi == lo:  # 22+ = 22..AA
            return [c for r in range(lo, 13) for c in _class_combos(r, r, "")]
        # ATs+ = ATs, AJs, AQs, AKs (kicker climbs up to one below the top card)
        return [c for k in range(lo, hi) for c in _class_combos(hi, k, kind)]

    hi, lo, kind = _parse_class(token)
    return _class_combos(hi, lo, kind)


def expand_range(text: str, dead=()) -> list[tuple[int, int]]:
    """Expand range notation to a sorted list of distinct combos (hi card, lo card).

    Supports 22, 22+, 22-55, AKs, AKo, AK, ATs+, KTs-K7s, A5s-A2s, AhKh, comma-separated.
    Combos containing a dead card are removed.
    """
    dead_set = set(parse_cards(dead))
    combos = set()
    for token in text.split(","):
        token = token.strip()
        if token:
            combos.update(_expand_token(token))
    return sorted(c for c in combos if c[0] not in dead_set and c[1] not in dead_set)


def combo_str(combo) -> str:
    return card_str(combo[0]) + card_str(combo[1])


# ---------------------------------------------------------------- CLI

def _main(argv):
    import argparse
    import time
    p = argparse.ArgumentParser(description="Independent poker math oracle")
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("equity", help="exact equity, e.g. equity AhAs KdKc --board 2c7d9h")
    e.add_argument("hands", nargs="+")
    e.add_argument("--board", default="")
    e.add_argument("--dead", default="")
    e.add_argument("--processes", type=int, default=None)
    r = sub.add_parser("range", help="expand range notation, e.g. range '22+,ATs+'")
    r.add_argument("text")
    r.add_argument("--dead", default="")
    v = sub.add_parser("eval", help="evaluate 5-7 cards, e.g. eval AsKsQsJsTs")
    v.add_argument("cards")
    a = p.parse_args(argv)

    if a.cmd == "equity":
        t0 = time.perf_counter()
        res = equity(a.hands, a.board, a.dead, processes=a.processes)
        dt = time.perf_counter() - t0
        print(f"boards={res['boards']}  time={dt:.2f}s")
        for h, w, t, eq in zip(a.hands, res["win"], res["tie"], res["equity"]):
            print(f"{h:>6}  win {float(w) * 100:8.4f}%  tie {float(t) * 100:8.4f}%  "
                  f"equity {float(eq) * 100:8.4f}%  (exact {eq})")
    elif a.cmd == "range":
        combos = expand_range(a.text, a.dead)
        print(len(combos))
        print(" ".join(combo_str(c) for c in combos))
    else:
        val = evaluate(a.cards)
        print(val, describe(val))


if __name__ == "__main__":
    _main(sys.argv[1:])
