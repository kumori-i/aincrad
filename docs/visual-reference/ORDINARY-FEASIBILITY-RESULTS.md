# Ordinary visual-reference acquisition: one bounded result

**Both agents acquired a small amount of private visual-reference memory during
ordinary survival play; Mira later used hers in completed exchanges.** This is evidence that the integrated path
can operate without scheduled teaching fixtures—not evidence of generalized
language, abstract concepts, superior survival or sustainable food management.

One prespecified Linux x64 run used the default world (seed **74193**), communication
seed **211**, normal **1×** and the existing **1/60-second** clock. No meetings,
actions, resources or learning examples were forced. No rerun or retuning occurred.
The [pre-run receipt](https://github.com/kumori-i/aincrad/pull/65#issuecomment-6490412661)
authorized this exact source before execution. The [original prospective protocol](ORDINARY-FEASIBILITY-PROTOCOL.md)
is retained unchanged as historical pre-run text; this report records its later
execution. Exact values and the complete seven-transaction ledger are in the
[bounded machine-readable result](ordinary-feasibility-results-v1.json).

## Acquisition and actual subsequent choices

| Recorded quantity | Result |
| --- | ---: |
| Optional-channel invocations (`opportunities`) | 471 |
| Exchanges initiated | 7 |
| Canonically observed post-choice demonstrations | 5 |
| Censored exchanges / pending at stop | 2 / 0 |
| New listener-owned visual exemplars / support-only updates | 3 / 2 |
| Sender anchors allocated / receiver conflicts | 4 / 0 |
| Correct observed references | 4 of 5 |

The **four association-matched choices were not four successes**: two completed
observed exchanges were correct and two were censored. The three exploratory
choices yielded two correct and one incorrect observed reference. These tiny,
nonrandomly selected subsets do not establish a comparative success rate or causal
benefit of memory. A wrong exploratory choice still supplied a corrective example
only after the listener observed the paid demonstration.

At the end, **Mira held two partner-symbol entries with two own-view examples;
Aster held one entry with one example**. Each also held two sender anchors. These
are private associations, not three shared dictionary definitions. The supplied
crop/metric/matching rules and symbol inventory remain engineering biases, not
learned segmentation, grammar or creative abstract concepts.

### All seven transactions

Times are simulation seconds, rounded here; the JSON retains original numbers.

| ID | Sender → listener | Emitted → ended | Choice | Outcome | Correction |
| --- | --- | --- | --- | --- | --- |
| 1 | Aster → Mira | 2.100 → 9.933 | Exploratory | Observed, correct | New example |
| 2 | Aster → Mira | 17.850 → 25.383 | Exploratory | Observed, correct | New example |
| 3 | Aster → Mira | 42.667 → 43.267 | Association match | Censored: identity or position changed | None |
| 4 | Aster → Mira | 379.400 → 386.750 | Association match | Observed, correct | Support only |
| 5 | Aster → Mira | 398.367 → 401.800 | Association match | Observed, correct | Support only |
| 6 | Mira → Aster | 410.333 → 416.717 | Exploratory | Observed, incorrect | New example |
| 7 | Aster → Mira | 423.783 → 425.767 | Association match | Censored: identity or position changed | None |

The first memory-matched selection occurred at **42.667 seconds**, but was
interrupted. The first **completed** matched-reference exchange began at
**379.400** and ended at **386.750** seconds. Exact listener-inspection completion
timestamps were not archived. Both completed matched references were Mira's;
Aster acquired one example but had no later completed retrieval in this run.
No further exchanges occurred after the seventh ended at 425.767 seconds.

## Why communication remained sparse

`no-peer` occurred **421 times among 471 optional invocations**. It is a composite
eligibility gate: a sender must be distinct, awake, nonsleeping, nonurgent,
inactive, not already reference-busy, in the same scene, within 250 units and
visible. The receiver has already passed its own eligibility/cooldown gates.
Thus 471 is not a count of available meetings and `no-peer` does not mean simply
“too far away.”

A read-only analysis of **119 retained snapshots** (initial, 117 detailed, terminal)
found the agents within 250 units in 16 snapshots and beyond it in 103. Of the
16 near snapshots, 15 had at least one active agent. No-peer increments were
bracketed by two distant endpoints for 380 counts, two near endpoints for 29,
and a changed range category for 12. These roughly ten-second endpoints cannot
assign individual failures to distance, prove continuous separation or recover
unrecorded urgency, private busy state or line of sight at each invocation.
Availability is a plausible bottleneck, not a demonstrated causal explanation.

## Survival stayed active; food sustainability was not established

Both actors moved, ate/sampled, drank and spent energy under ordinary policy.
Neither collapsed or was rescued. Final partner identities remained unchanged.

| Body/food measure | Aster | Mira |
| --- | ---: | ---: |
| `independentMeals` counter | 8 | 30 |
| Independent-drink counter | 5 | 3 |
| Ingested kcal | 114.000 | 468.667 |
| Absorbed kcal | 43.844 | 388.413 |
| Metabolized kcal | 1,684.098 | 1,651.772 |
| Available kcal, initial → final | 1,100 → 213.255 | 1,100 → 556.061 |
| Stored reserve kcal, initial → final | 84,000 → 83,246.491 | 84,000 → 83,280.580 |
| Final nourishment / health | 49.422 / 99.984 | 95.711 / 100.000 |

In this discovery-mode path, **`independentMeals` counts supported sustained
food-sampling/feedback events linked to personal acquisition evidence**, not full
meals, portions or adequate caloric intake. See [the feedback increment](https://github.com/kumori-i/aincrad/blob/1f76f4898fd63859810e75a1111ed05a7f0381c3/src/discovery.js).
Human `nourishment` is exactly a satiety-hours projection; it is not the
available-energy pool or stored reserves ([physiology projection](https://github.com/kumori-i/aincrad/blob/1f76f4898fd63859810e75a1111ed05a7f0381c3/src/biology.js)).

Aster's nourishment was **zero in 32 sampled snapshots**, from **724.967 through
1041.017** seconds. A nonzero value was next sampled at **1051.333** seconds;
its final value was 49.422. This does **not** prove it was
continuously zero between those samples. Both available and reserve energy fell;
Aster absorbed only 43.844 kcal while spending 1,684.098 kcal. High initial reserves
and zero collapses do not demonstrate sustainable survival, resolution of the food-balance
concern, or benefit caused by communication. This short run also says nothing
about multi-day stability.

## Protocol and evidence checks

- Native launch: **2026-10-29 07:14:06.792 UTC**; ready: **07:14:16.026**;
  ordinary pause: **07:34:16.926**.
- First stop reason: simulation target. Paused elapsed **1200.766667 seconds**;
  overshoot **0.766667**, below the prespecified 2-second deviation threshold.
  Total launch-to-close accounting: **1210.504 wall seconds**, below 30 minutes.
- **120 JSONL records**, including 117 detailed samples. Detailed intervals were
  **10.05–11.35 simulation seconds**. All seven events were retained; missing-ID
  and missing-terminal coverage counters were both zero; nothing remained pending.
- Actual structured evidence: **722,689 bytes**, including the final record;
  logs/media: **1,354 bytes**. Neither the 32 MiB nor 16 MiB cap was reached and
  no evidence bytes were dropped. The final record explicitly labels its budget
  snapshot as pre-final-write; it is not the full byte total.
- **1,176 polls** consumed 19,284 ms of measured read time (maximum 845 ms);
  117 detailed reads consumed 3,920 ms (maximum 534 ms). These are observer costs,
  not a no-observer performance baseline.
- Clean exact source, source-manifest hashes and reconstructed harness hash
  matched. The actual isolated Linux x64 renderer reported Node integration off,
  context isolation on, sandbox on and web security on. Process exit was clean.
- No images, per-poll raw clock ledger, private visual vectors, symbol contents,
  raw save or profile archive were retained. This compact record cannot provide
  visual inspection or independent replay of the entire world.
- The source record retains a static preparation field `executionApproved:false`.
  It was not rewritten after the run. Authorization is the earlier public receipt
  and exact guarded create event; native-ready/final records separately confirm
  execution. This metadata inconsistency is disclosed rather than hidden.

## Immutable provenance

- [Run **40834043973**](https://github.com/kumori-i/aincrad/actions/runs/40834043973),
  exact create ref `experiments/reference-acquisition-v1-once`, attempt **1**.
- Commit `1f76f4898fd63859810e75a1111ed05a7f0381c3`;
  complete tree `57197286e044d1fb04644baabcce0749535b598e`.
- Pinned runtime commit `0d6c5a4eeeda33108405ce5ac7dd86af3b90dee0`,
  tree `9954ebcc14f1789021489f28158e21ea9ef03c08`, fingerprint
  `9c96950360a457000269093ff6fd58f6ef9b5d4b11cfb59fc94cbcd48b8b7d60`.
- Source-manifest SHA256:
  `73b7491b871f0d698f982888c3ad5a7616769d13290ab484223ef74f888dc2bf`.
- Protocol SHA256:
  `52b2693aaa8d92efc8a8fe2fad81b6d40657034bb33ef95dab7859cc193ddfe7`.
- [Artifact **12881200646**](https://github.com/kumori-i/aincrad/actions/runs/40834043973/artifacts/12881200646),
  `ordinary-reference-once-linux-x64`: 57,268 ZIP bytes; SHA256
  `206003a8f40972f9a92e47bf30d3d1acf8c50adf7982fa1db168aba7e07a0319`.
  GitHub's recorded expiry is 2026-11-05 07:34:17 UTC; access is not promised after it.
- Raw `run-ezofJS/observations.jsonl` SHA256:
  `c8410e4119a28e38e11767ab760ee743c5e05e21eed7b9f5529b56a03bedaf5d`.

The original ZIP and raw records were retained and digest-verified; a separate
reviewer reproduced the ledger/coverage accounting. This results-only addition
changes neither the frozen protocol nor the run source/ref. It authorizes no
additional trajectory, controls, rerun or outcome-based parameter changes.
