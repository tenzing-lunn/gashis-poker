#!/usr/bin/env python3
"""Generate random no-limit hold'em hands through pokerkit, as differential-fuzz fixtures for lib/engine.

Test-only: pokerkit (MIT, https://github.com/uoftcprg/pokerkit) is never bundled with the app.

    python gen_pokerkit_fixtures.py --hands 2000 --seed 1 --out fixtures/pokerkit-hands.json

Each hand varies the player count (2-9, mostly 2-6), the button, the blinds and the stacks (equal 100bb
tables, and wildly unequal stacks including stacks below a blind, to force side pots, blind all-ins and
short all-ins). At every decision the script records pokerkit's actor and legal-action data, the bets,
stacks, pots and total pot, then picks a random legal action with raise sizes biased to edge cases.

Seats and cards
---------------
All per-player arrays in the JSON are in POKERKIT index order. pokerkit index k sits at engine seat
`seatOfPk[k] = (button + 1 + k) % n`, i.e. pokerkit index 0 is the first seat left of the button (the
small blind, or the big blind heads-up) and index n-1 is the button. The replay test applies this mapping.

`deck` is in engine card ids (rank * 4 + suit) and in the engine's dealing order: card j < 2n goes to
pokerkit index j % n (one card at a time, starting left of the button), then the next five cards are
the board. pokerkit's burn cards are taken from further down the same deck (the engine does not burn).

Rule 96 deviations
------------------
pokerkit 0.7.7 counts a raise as "full" (reopening the betting) when its increment is at least the
largest increment so far on the street, which starts at 0 rather than at the big blind. So a short
all-in can reopen the betting when every earlier raise on the street was also below the big blind,
e.g. a limper facing an all-in raise of half a big blind. It also forgets players reopened by
cumulative short all-ins once a further short all-in follows. Our engine follows WSOP Rule 96
literally: a player who has already acted on this street may raise again only if the amount they now
face is at least a full raise (max(largest bet/raise increment on the street, big blind)).

At every decision this script also computes that strict rule. Where it disagrees with pokerkit about
whether a raise is allowed, the step gets a `dev` entry with the strict answer, and the script never
chooses a raise there (so the hand stays legal under both rules). Only disagreements caused by the
Rule 96 check itself are flagged; anything else is an assertion failure.

Heads-up hands never use equal blinds: pokerkit breaks the tie toward the big blind, which then acts
first preflop, while the engine (and the rules) keep the button first.

Format
------
One hand per line: {"n", "button", "seatOfPk", "sb", "bb", "stacks" (pokerkit order), "deck", "steps", "final"}.
To keep the committed file small each decision is a positional array (see STEP_FIELDS):

    [street, boardCards, actor, canFold, call, canRaise, minTo, maxTo, bets, stacks, pots, total, action, dev?]

street is 0..3 (preflop..river); canFold/canRaise are 0/1; call is pokerkit's checking_or_calling_amount;
minTo/maxTo are null when pokerkit forbids a raise; pots are [[amount, [pokerkit indices...]], ...];
total is total_pot_amount (pots + outstanding bets); action is "f", "c" (check or call) or the raise-to
amount; dev (only at Rule 96 deviations) is [strictCanRaise, reason, strictMinTo?, strictMaxTo?].
"final" is pokerkit's stacks once the hand is over.
"""

from __future__ import annotations

import argparse
import json
import random
import warnings

from pokerkit import Automation, NoLimitTexasHoldem

RANKS = "23456789TJQKA"
SUITS = "cdhs"

AUTOMATIONS = (
    Automation.ANTE_POSTING,
    Automation.BET_COLLECTION,
    Automation.BLIND_OR_STRADDLE_POSTING,
    Automation.RUNOUT_COUNT_SELECTION,
    Automation.HOLE_CARDS_SHOWING_OR_MUCKING,
    Automation.HAND_KILLING,
    Automation.CHIPS_PUSHING,
    Automation.CHIPS_PULLING,
)

BLINDS = [(50, 100), (50, 100), (50, 100), (1, 2), (5, 10), (25, 50), (2, 5), (3, 7), (1, 1), (10, 25), (40, 100), (7, 13)]

# pokerkit's error messages for its two Rule 96-style raise checks (see State._verify_completion_betting_or_raising).
PK_RULE96_MESSAGES = (
    "Short all-in cannot be raised.",
    "The player already acted and hence cannot raise in face of a non-full all-in wager",
)


def card_str(card: int) -> str:
    return RANKS[card >> 2] + SUITS[card & 3]


def gen_player_count(rng: random.Random) -> int:
    return rng.choices(range(2, 10), weights=[24, 18, 15, 13, 12, 6, 6, 6])[0]


def gen_stacks(rng: random.Random, n: int, bb: int) -> list[int]:
    mode = rng.random()
    if mode < 0.30:
        return [100 * bb] * n
    if mode < 0.40:
        return [rng.randint(1, 300) * bb] * n
    stacks = []
    for _ in range(n):
        kind = rng.random()
        if kind < 0.12:
            stacks.append(rng.randint(1, max(1, bb - 1)))  # below the big blind (often below the small blind)
        elif kind < 0.42:
            stacks.append(rng.randint(bb, 6 * bb))
        elif kind < 0.72:
            stacks.append(rng.randint(6 * bb, 60 * bb))
        else:
            stacks.append(rng.randint(60 * bb, 300 * bb))
    return stacks


def pick_raise_to(rng: random.Random, lo: int, hi: int, pot: int, max_bet: int) -> int:
    if lo >= hi:
        return lo
    choices = [lo, hi, rng.randint(lo, hi), min(lo + 1, hi), max(hi - 1, lo), min(hi, max(lo, max_bet + pot)),
               min(hi, max(lo, max_bet + pot // 2))]
    return rng.choices(choices, weights=[25, 20, 20, 8, 8, 10, 9])[0]


STEP_FIELDS = ["street", "board", "actor", "canFold", "call", "canRaise", "minTo", "maxTo", "bets", "stacks", "pots",
               "total", "action", "dev"]


def encode_step(step: dict) -> list:
    row = [int(v) if isinstance(v, bool) else v for v in (step[k] for k in STEP_FIELDS[:-1])]
    if "dev" in step:
        d = step["dev"]
        row.append([int(d["canRaise"]), d["reason"]] + ([d["minTo"], d["maxTo"]] if d["canRaise"] else []))
    return row


def pots_of(st) -> list:
    return [[pot.amount, list(pot.player_indices)] for pot in st.pots]


def play_hand(rng: random.Random) -> dict:
    n = gen_player_count(rng)
    sb, bb = rng.choice(BLINDS)
    while n == 2 and sb == bb:
        # pokerkit breaks the tie between equal blinds toward the higher index, so heads-up with
        # SB == BB it has the big blind act first preflop. The engine keeps the button first.
        sb, bb = rng.choice(BLINDS)
    stacks = gen_stacks(rng, n, bb)
    button = rng.randrange(n)
    deck = list(range(52))
    rng.shuffle(deck)

    st = NoLimitTexasHoldem.create_state(AUTOMATIONS, True, 0, (sb, bb), bb, tuple(stacks), n)

    hole_next = 0  # next deck position for hole cards
    board_next = 2 * n
    burn_next = 2 * n + 5
    steps = []
    acted: set[int] = set()  # pokerkit indices that acted voluntarily on the current street
    street = None
    raises_this_street = 0

    while st.status:
        if st.can_burn_card():
            st.burn_card(card_str(deck[burn_next]))
            burn_next += 1
        elif st.can_deal_hole():
            k = st.hole_dealee_index
            assert k == hole_next % n, (k, hole_next, n)
            st.deal_hole(card_str(deck[hole_next]))
            hole_next += 1
        elif st.can_deal_board():
            count = st.board_dealing_count
            st.deal_board("".join(card_str(c) for c in deck[board_next:board_next + count]))
            board_next += count
        elif st.actor_index is not None:
            if st.street_index != street:
                street = st.street_index
                acted.clear()
                raises_this_street = 0
            a = st.actor_index
            bets = list(st.bets)
            stks = list(st.stacks)
            max_bet = max(bets)
            to_call = max_bet - bets[a]
            pk_raise = st.can_complete_bet_or_raise_to()
            assert st.can_check_or_call()  # checking or calling is always possible for the actor
            step = {
                "street": st.street_index,
                "board": len(list(st.get_board_cards(0))),
                "actor": a,
                "canFold": st.can_fold(),
                "call": st.checking_or_calling_amount,
                "canRaise": pk_raise,
                "minTo": st.min_completion_betting_or_raising_to_amount,
                "maxTo": st.max_completion_betting_or_raising_to_amount,
                "bets": bets,
                "stacks": stks,
                "pots": pots_of(st),
                "total": st.total_pot_amount,
            }

            # The strict WSOP Rule 96 check (see module docstring).
            full = max(st.completion_betting_or_raising_amount, bb)
            structural = stks[a] > to_call and any(
                i != a and st.statuses[i] and stks[i] + bets[i] > max_bet for i in range(n)
            )
            strict_raise = structural and not (a in acted and to_call < full)
            if pk_raise != strict_raise:
                if pk_raise:
                    reason = "pokerkit allows a raise; Rule 96 forbids it (already acted, facing less than a full bet/raise)"
                else:
                    try:
                        st.verify_completion_betting_or_raising_to()
                        raise AssertionError("pokerkit verify passed but can_complete_bet_or_raise_to was False")
                    except ValueError as err:
                        assert str(err) in PK_RULE96_MESSAGES, f"unexpected pokerkit raise refusal: {err}"
                        reason = f"pokerkit forbids a raise ({err}); Rule 96 allows it (facing at least a full raise)"
                dev = {"canRaise": strict_raise, "reason": reason}
                if strict_raise:
                    dev["minTo"] = min(stks[a] + bets[a], max_bet + full)
                    dev["maxTo"] = stks[a] + bets[a]
                step["dev"] = dev

            options = []
            if step["canFold"]:
                options.append(("f", 25))
            options.append(("c", 45))
            if pk_raise and strict_raise:
                options.append(("r", 35 * 0.7 ** raises_this_street))
            kind = rng.choices([o[0] for o in options], weights=[o[1] for o in options])[0]
            if kind == "f":
                st.fold()
                step["action"] = "f"
            elif kind == "c":
                st.check_or_call()
                step["action"] = "c"
            else:
                to = pick_raise_to(rng, step["minTo"], step["maxTo"], step["total"], max_bet)
                st.complete_bet_or_raise_to(to)
                step["action"] = to
                raises_this_street += 1
            acted.add(a)
            steps.append(encode_step(step))
        else:
            raise AssertionError("pokerkit state is stuck")

    return {
        "n": n,
        "button": button,
        "seatOfPk": [(button + 1 + k) % n for k in range(n)],
        "sb": sb,
        "bb": bb,
        "stacks": stacks,
        "deck": deck,
        "steps": steps,
        "final": list(st.stacks),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--hands", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    warnings.simplefilter("error")  # any pokerkit warning (e.g. burned chips) is a failure
    rng = random.Random(args.seed)
    hands = [play_hand(rng) for _ in range(args.hands)]
    import pokerkit

    with open(args.out, "w") as f:
        f.write('{"generator":"lib/engine/oracle/gen_pokerkit_fixtures.py","pokerkit":"%s","seed":%d,"hands":[\n'
                % (pokerkit.__version__ if hasattr(pokerkit, "__version__") else "0.7.7", args.seed))
        f.write(",\n".join(json.dumps(h, separators=(",", ":")) for h in hands))
        f.write("\n]}\n")
    devs = sum(1 for h in hands for s in h["steps"] if len(s) > len(STEP_FIELDS) - 1)
    steps = sum(len(h["steps"]) for h in hands)
    print(f"wrote {len(hands)} hands, {steps} decisions, {devs} Rule 96 deviation points -> {args.out}")


if __name__ == "__main__":
    main()
