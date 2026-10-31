# Ordinary character and motor observation v3: frozen result

This note describes the **single completed ordinary v3 observation**, not a
change to its prospective [protocol](CHARACTER-ORDINARY-MOTOR-V3.md) or retained
evidence. The once-only GitHub Actions [run 41244048812](https://github.com/kumori-i/aincrad/actions/runs/41244048812)
(attempt 1) used source commit `9c1de543a1fc26c673eda25d1e71111fa9f65ce7`,
tree `da5f49b9aaa4c3e66d68aef5c2fb509a03e707ea`. Retained artifact
`13058988235` has SHA-256
`e6ac5cdd272983fa3410bbda2537441639028847c212310858ba368659e6bbb3`.
Independent evidence review reconciled 118 projections and the counters,
with no missed or dropped records. The world paused at `1200.983` simulation
seconds. The v1, v2 and v3 sources, protocols, receipt and activation refs,
and runs remain frozen; this run is not to be repeated.

## Motor and local observation

| Actor | Motor decision checks | Eligible decisions | Selected attempts | Peer-visible neutral-motion samples |
| --- | ---: | ---: | ---: | ---: |
| Aster | 79 | 51 | 1 | 0 |
| Mira | 211 | 190 | 0 | 0 |

Aster's one selection was near 476.933 seconds. `selectedAttempts` increments
before physical admission, so this evidence does **not** establish whether the
motion started, received paid work, was interrupted, or completed. Aster was
moving at the next detailed projection, but sparse projections cannot supply
the missing action receipt. Zero peer-visible neutral samples could also mean
that a real funded motion occurred outside the partner's sight. Mira's 190
eligible decisions with no selection identify optional-choice competition at
those decision boundaries, not a lack of eligible motor actions. Counts are
decision checks and sensor ticks, not elapsed opportunity time or distinct
gestures.

Each actor had 72,059 sampled sensor ticks. Aster recorded 321 general public
pose, 12,137 visible-absence and 59,601 unknown-sight samples; Mira recorded
214 pose, 12,244 visible-absence and 59,601 unknown. General pose samples can
include paid object indications; they are not evidence of neutral hand motion.
The predictor had 410 valid 30-tick targets per actor, with only 11 Aster and
6 Mira pose targets, and 12 unknown-sight censors each. Valid targets stopped
increasing by about 258 seconds. The 12,458 visible ticks per actor could
support roughly 415 nonoverlapping 30-tick windows, so sparse later sight is
consistent with that plateau; it does not prove that no later brief sighting
occurred.

| Mean prequential Brier score, valid targets only | Aster | Mira |
| --- | ---: | ---: |
| Model | 0.098095 | 0.092869 |
| Frozen prior | 0.027856 | 0.016272 |
| Persistence | 0.021707 | 0.017805 |

These are scores on each learner's own training stream, not held-out evaluation
or evidence of causal social response. The model trails both simple baselines
in this sparse observation. This one trajectory is not a basis for tuning it.

## Character exchange and survival context

The character channel recorded three listener updates, two completed paid
replies and one sender visual-match update. The `lvfvty` reply was paid but
ambiguous; the `ybzgwa` reply start was rejected; `ubsoqe` received a paid
visual match. This is authentic local feedback, not a shared word meaning or
stable vocabulary. Among 299 optional reference checks, the first-failed
`no-peer` predicates included active partner (213), too far (22), and urgent
need (25). A first failure does not establish later predicates, and these
checks are not durations.

| Physical context | Aster | Mira |
| --- | ---: | ---: |
| Absorbed energy (kcal) | 15.833 | 132.173 |
| Metabolized energy (kcal) | 1715.613 | 1626.760 |
| Combined available and stored energy change (kcal) | -1699.780 | -1494.587 |
| Sustained-sample feedback events counted as `independentMeals` | 1 | 13 |
| Independent drinks | 4 | 3 |

Both finished near 100 health with no collapse or rescue. Aster ended at zero
satiety with 1.128 `starvationHours`, which counts time with low **available**
energy rather than exhausted stored reserves. An `independentMeals` increment
is personally supported sample feedback, not a full meal or calorie threshold.
The energy changes exactly equal absorbed minus metabolized calories; low
absorption may involve small portions or delayed digestion. The run does not
establish sustainable intake or a survival benefit from communication.

The subsequent observer-only lifecycle increment separates selections from
admissions, first certified paid work, certified paid seconds, completed
actions, interrupted actions and personally sampled funded poses. Each terminal
witness is counted once; lost identity or authority is marked unavailable
rather than inferred as completion. Counts saturate and reset with the actor's
session, and neither the new counters nor pending authority enter saves or
learning. The frozen v3 result cannot retroactively resolve Aster's selected
action. Any later ordinary observation needs its own reviewed source and
protocol.
