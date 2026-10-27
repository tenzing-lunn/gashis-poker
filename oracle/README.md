# Poker math oracle

Independent, standard-library-only Python reference (hand evaluator, exact equity, range expansion)
used to judge the app's TypeScript math core. Written from first principles; shares no code with `lib/poker/`.

## Run

```sh
python3 oracle/test_oracle.py                      # self-tests (~15 s)
ORACLE_SLOW=1 python3 oracle/test_oracle.py        # + all 133,784,560 7-card hands + naive preflop cross-check (minutes)

python3 oracle/poker_oracle.py equity AhKh QsQc --board 2h7hQd3c [--dead 4h]
python3 oracle/poker_oracle.py equity AhAs KdKc     # preflop, 1,712,304 boards, multiprocess
python3 oracle/poker_oracle.py range "22+,ATs+,KTs-K7s" [--dead As]
python3 oracle/poker_oracle.py eval AsKsQsJsTs9c2d
```

Cross-check the TypeScript core (`lib/poker/`) against the oracle, criteria c1..c7:

```sh
python3 oracle/crosscheck/crosscheck.py [c1 ... c7] [--deep]   # --deep: c2 also matches all 7-card hands value-by-value (~4 min)
```

Equities are exact `Fraction`s (ties split 1/k among k winners).
