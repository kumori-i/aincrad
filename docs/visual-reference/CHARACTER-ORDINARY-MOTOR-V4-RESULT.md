# Ordinary neutral-motor lifecycle observation v4: frozen result and diagnosis

This note records the single completed [v4 ordinary observation](https://github.com/kumori-i/aincrad/actions/runs/41336920949),
attempt 1. Its source was commit `3be93d7c2f804b3ef17c825b3af4e0871eed14f9`,
tree `814e14953b7c9bc450579a5532f08c6a094401aa`. Retained artifact
`13096481089` has SHA-256
`3823d55c614f07e758e978e420e50762529d3654ab5114e7516abc3b02b757db`.
Independent review reconciled all 118 projections and trackers, 1,202 clock
records, and a complete pause at 1,201 simulation seconds with no missed or
dropped evidence. The [prospective protocol](CHARACTER-ORDINARY-MOTOR-V4.md),
receipt, activation ref and run are frozen and must not be repeated or edited.
This same-seed follow-up is descriptive, not independent replication or a
causal test of communication.

## Physical motor outcome

Aster selected one neutral hand motion. It was physically admitted, then
interrupted with `PRIORITY_CHANGED` **before its first certified paid slice**:
first-paid actions 0, paid seconds 0, own neutral-pose samples 0, completed
motions 0. Mira selected none. Neither actor personally sampled a peer neutral
motion. Admission is not completion, and zero peer samples is not evidence
that a gesture was understood or that no other public pose was visible.

The retained aggregate does not identify which condition caused this one
interruption. During an ordinary discovery tick, physiology and passive
Ozark current advance before the hand action checks its fixed actor position
and bodily safety. Both position change and a newly unsafe body produce the
same `PRIORITY_CHANGED` result before payment. A controlled engineering case
at shallow flowing water `(-1200, 240)` moved Aster 0.376 pixels in one
`1/60`-second tick and reproduced admission followed by zero-paid
interruption while bodily safety remained unchanged. A separate controlled
dry-ground case crossed the qualitative thirst threshold in one tick and
reproduced the same counters through legitimate bodily preemption. Dry-ground
control paid its first `1/60`-second slice normally. These are source and
engineering findings, **not** an attribution of the frozen v4 event to river
current. Exact event-time footing and body evidence would be needed for that.

## Communication, prediction and survival limits

The existing character channel recorded three listener updates, two paid
replies and one sender update. This is personal learning from actual actions,
not a stable shared word meaning. The session-only gesture predictor remained
below its frozen-prior and persistence baselines on its prequential training
stream. There was no held-out demonstration of predictive generalization or
learned social use of the neutral motion.

Neither actor collapsed or was rescued, but intake did not cover expenditure.
Those health and activity observations do not establish sustainable survival
or a benefit from communication. V4's motor lifecycle counters distinguish
admission from paid work; they cannot retroactively repair v3's missing motor
receipt or explain a particular v4 `PRIORITY_CHANGED` without the underlying
personal footing and body observation.

## Food-intake follow-up

A read-only reconciliation of the retained v4 energy ledger found that Aster
ingested 15.833333 kcal, absorbed 15.832806 kcal and metabolized 1,715.639340
kcal. Mira ingested 164.666667 kcal, absorbed 132.175968 kcal and metabolized
1,626.797572 kcal. Even complete absorption of what they ingested would cover
only about 0.923% and 10.122% of expenditure, respectively. Sparse ingestion,
not merely pending digestion, dominates this observed energy deficit.

Aster's only retained ingestion increment occurred around 283–293 simulation
seconds; the `independentMeals` count rose around 333–343 seconds without
another ingestion increment. Source accounting makes this delay plausible: a
30 g apple sample supplies 15.833333 kcal, and its two-game-hour digestion
reaches the human 2.4 kcal sustained-feedback threshold about 45.5 simulation
seconds after ingestion. This calculation does not identify the particular
food object from the aggregate, and `independentMeals` records earned bodily
feedback rather than a full meal.

Aster had 52 learned-run visits, including 40 `run:travel` decisions, one
`run:action` decision and no `run:complete` decision; six visits reported no
known route and five reported a missing or expired run. These are bounded
decision-stage counters, not paid-action receipts or exclusive causes. They
show that learned return was attempted, but the retained aggregate cannot
identify the exact source, route, admission result or reason further food was
not ingested. This retrospective source diagnosis does not change the frozen
v4 run or establish that a particular route or safety guard was defective.
