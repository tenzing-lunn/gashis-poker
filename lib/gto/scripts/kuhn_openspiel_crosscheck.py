"""Cross-check our Kuhn poker CFR+ policy against OpenSpiel (Apache-2.0; used as a test-only reference, never vendored).

Usage (from the repo root, with a Python env that has `open_spiel` installed):
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./lib/poker/scripts/register-ts.mjs \
        lib/gto/scripts/kuhn-export.ts > kuhn-policy.json
    python lib/gto/scripts/kuhn_openspiel_crosscheck.py kuhn-policy.json [openspiel_cfr_iterations]

Loads our policy into an OpenSpiel TabularPolicy for `kuhn_poker` and prints OpenSpiel's exploitability and
expected value of it, plus OpenSpiel's own CFR+ result for comparison. Exits non-zero if our policy's value is
not -1/18 within 1e-3 or its exploitability is not below 1e-3.
"""

import json
import sys

import pyspiel
from open_spiel.python import policy as policy_lib
from open_spiel.python.algorithms import cfr, expected_game_score, exploitability

GAME_VALUE = -1 / 18


def main() -> int:
    ours = json.load(open(sys.argv[1]))
    os_iterations = int(sys.argv[2]) if len(sys.argv) > 2 else 2000

    game = pyspiel.load_game("kuhn_poker")
    tabular = policy_lib.TabularPolicy(game)
    expected_keys = set(tabular.state_lookup)
    got_keys = set(ours["policy"])
    if expected_keys != got_keys:
        print(f"info-state mismatch: missing {sorted(expected_keys - got_keys)}, extra {sorted(got_keys - expected_keys)}")
        return 1
    for key, probs in ours["policy"].items():
        # OpenSpiel kuhn_poker actions: 0 = Pass, 1 = Bet, the same order as ours.
        tabular.policy_for_key(key)[:] = probs

    root = game.new_initial_state()
    value = expected_game_score.policy_value(root, [tabular, tabular])[0]
    expl = exploitability.exploitability(game, tabular)
    nash_conv = exploitability.nash_conv(game, tabular)

    solver = cfr.CFRPlusSolver(game)
    for _ in range(os_iterations):
        solver.evaluate_and_update_policy()
    os_avg = solver.average_policy()
    os_value = expected_game_score.policy_value(game.new_initial_state(), [os_avg, os_avg])[0]
    os_expl = exploitability.exploitability(game, os_avg)

    print(f"our CFR+ ({ours['iterations']} iterations), as reported by our code: value {ours['value']:.9f}, exploitability {ours['exploitability']:.3e}")
    print(f"OpenSpiel on our policy: value for player 0 {value:.9f} (-1/18 = {GAME_VALUE:.9f}, diff {value - GAME_VALUE:.2e})")
    print(f"OpenSpiel on our policy: exploitability {expl:.3e}, nash_conv {nash_conv:.3e}")
    print(f"OpenSpiel's own CFR+ ({os_iterations} iterations): value {os_value:.9f}, exploitability {os_expl:.3e}")
    print(f"value agreement (ours vs OpenSpiel evaluation): {abs(value - ours['value']):.2e}; exploitability agreement: {abs(expl - ours['exploitability']):.2e}")

    ok = abs(value - GAME_VALUE) < 1e-3 and expl < 1e-3
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
