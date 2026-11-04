# Held-out source handling: bounded engineering benchmark

```sh
node --test --test-concurrency=1 tests/handling-heldout-benchmark.test.mjs
```

This is a test-only first-choice selector ablation, not a learned policy,
autonomous acquisition study, survival experiment, or protected v1–v5 protocol.
No runtime source, frozen protocol, reward, or reference is changed.

## Final bounded design

Two stocked-target conditions, same appearance and different appearance, each
have handlingCuriosity off and on arms: four one-choice episodes. The physical
Ozark world is fixed; communication initialization uses seed 51001. This is one
fixture per condition, not an independent multi-world or multi-seed sample.

The harness chooses the first geometrically eligible stocked apple source and
apple target in existing world order. Eligibility uses walkability, distance and
actual line of sight, never selector success. The different-appearance condition
is an explicitly authored within-type perturbation: target stage is set to
flowering, changing normal sensed color to green and pale blossoms. Shape and
texture remain unchanged. The actual ecology validator must preserve stage and
quantity. This is not a different food type or natural seasonal co-occurrence.
Both objects remain distinct identities. The target has no prior action
experience, although it may have been passively seen.

Each arm earns its own paid source pull and paid failed target grasp through
requestNpcAction/tickNpc. State is independently replayed and the entire trained
state, including RNG, is deep-compared before selection. Only the four known
fresh-world lineage UUID fields are normalized in the comparison copy; these
identities are not selector inputs. No live state is changed by normalization.
Replaying rather than cloning preserves live sensory/action receipts that are
deliberately not serializable. No learned record, appearance descriptor, label,
or reward is injected into the actor. Actual ecology descriptions enter via
observeNpc. The selector receives only its ordinary actor and the
handlingCuriosity switch. Condition names and private plant kinds are harness
metadata, never optional-policy inputs.

## Explicit fixture interventions and limits

- Actor placement beside each source is supplied, not paid navigation.
- Start clocks are set to 60 seconds. Only the tested body advances. Other actors
  do not act, teach, or provide evidence. Ecology renewal/motion is frozen while
  environment time/weather and the actor's body/actions advance normally.
- Target flowering stage is authored before observation and validated at time
  zero. It is not learned appearance variation or a naturally sampled season.
- The source's detached material remains held. Control arms may choose to inspect,
  manipulate, sample, move, or do other ordinary work. They are never forced to
  fail or restricted to the target. No line-of-sight override is used.
- Exactly one selector decision and one bounded execution (70 simulated seconds)
  are recorded, with rejections or unfinished work reported, not retried until
  success. A harness assertion failure is not scientific evidence of improvement.

Diagnostics include action, result, selection provenance, elapsed time, actual
metabolic cost, target stock reduction, held-item delta and inquiry status for
both arms. Costs cover the evaluation action only; setup training is paid but
excluded from these deltas. The same-appearance on arm exercises the supplied
exact shape/color/texture motor analogy. Different appearance should leave both
arms identical because this mechanism cannot generalize across that cue boundary.
Time reduction alone is not evidence of transfer: per-verb practice already
changes action duration globally, and is matched across arms here.

No multi-step success rates, sample benefit, food learning, cross-appearance
learned generalization or population survival claims follow from these rows.
A future learned selector needs a separate reviewed training/evaluation design.

## Development findings and excluded cells

The first run exposed nondeterministic world UUIDs in the parity assertion; the
comparison now normalizes only those four fields. The initial broader matrix
found no natural stocked apple-to-bramble pair satisfying the fixed 120–260
distance and three line-of-sight conditions with +45-x vantages. Those cross-type
cells did not run and are not evidence of failure to generalize.

An exploratory quantity-zero intervention produced inspection in both arms,
consistent with ordinary visible-count availability gating. However, adding
actual ecology validation rejected that intervention as unbalanced energy.
Those observations are invalid-state exploratory diagnostics, not benchmark
results. The final benchmark excludes depleted targets rather than fabricating
ledger corrections or expanding into a forced physical depletion protocol.

The final appearance-only design is therefore a smaller, valid engineering
comparison, not a complete stock-by-type matrix. Each design change and failed
validation is retained here; no seed or choice was rerolled for a desired result.

## Measured final focused run (2026-11-04)

All four episodes completed; the parent test and two condition tests passed
(3 tests, about 19.7 seconds wall time on the shared Linux host).
Source was object:671 and held-out target object:679; pre-choice actor RNG was
74193 in every arm.

- Same appearance, off: target inspection, OBJECT_OBSERVED, 1.8 simulated seconds,
  1.68 metabolized kcal, zero target stock reduction and zero held-item change.
- Same appearance, on: target pull, piece_detached, 4.9 simulated seconds,
  11.0911 metabolized kcal, one target piece removed and one new held item.
- Different appearance, off and on: identical target inspection, OBJECT_OBSERVED,
  1.8 simulated seconds, 1.68 metabolized kcal, zero stock/held-item change.

The handling question remained pending after same-appearance control inspection,
completed as detached after same-appearance enabled pull, and was absent in both
different-appearance arms. No food technique was earned. These results show the
supplied analogy boundary, not cross-appearance learning. Syntax and focused
checks passed. Full check/build/smoke/native-platform checks were not run for
this isolated test-only increment because another full suite was using the host.
