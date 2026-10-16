# Increment A: frozen bounded prediction protocol

Frozen on 2026-10-16 before implementation or new assays.

The exact design in `DESIGN-reusable-outcome-prediction.md` is frozen at SHA-256
`8ca160becf1a67f7e33986a4435c4d06cb5666e28570a776031dff676e77b0d6`.
Its numerical constants, model definitions, controls, resource limits and gates
are the protocol; wording identifying earlier proposed/review status records
the design history rather than permission to tune them after results.

Independent design review cleared this version. The project owner authorized
only bounded increment A's model/sensor, immutable matched same-material
prediction-use fixtures, and the explicitly described copied-world delayed-harm
intervention: age the finite remaining material to 288 game hours and mark its
existing spoil state. That intervention is test-only, with accountable finite
stocks and unchanged chemistry; four handling variants are four bookkeeping
controls, not independent discoveries or naturally elapsed aging observations.

No autonomous episode, cohort, planner, production save migration, default
controller activation or main-branch promotion is authorized by this stage.
PR #9 remains a negative research draft. Its failed interactive 5 ms budget and
learning-advantage result are preserved.

Implementation first verifies invariants and resource admission, then the
declared physical prediction/confounding/safety gates. Stop on a gate failure
or an unavailable required physical opportunity, preserving partial evidence;
do not tune thresholds, refill stock, relax masks, or substitute another seed.
Matched controls continue receiving identical factual support and safety
observations while freezing only prediction parameters. All new supervision is
separate from original exactly-once reward ownership.

The full encoded actor, including the new model/sensor and all retained legacy
evidence, must remain at or below 1 MiB. The headless added-decision p95 must be
below 50 ms over at least 200 warmed cases, and the checked single-decision
ceiling remains 1,000 ms. These are noninteractive research limits, not desktop
responsiveness claims.

## Pre-probe capacity clarification (2026-10-16)

Before any physical outcome probe or full resource measurement, the owner
clarified the dictionary ceiling as a **combined** maximum of 512 keys and
256 KiB of actual UTF-8 serialized dictionary bytes across the retained legacy
context dictionary and the new typed-model dictionary. The current representation
stores them separately, so each stored occurrence counts. Counting shared strings
once would require an actually shared wire representation, which this stage does
not introduce. The new 256 typed-row maximum and complete-actor 1 MiB maximum
remain separate limits. No constants or outcome thresholds changed.

An attainable saturated resource fixture may retain 256 legacy keys and 256 new
typed keys, with repeated contexts supplying all bounded receipts/replay entries.
A 512-legacy-plus-256-new fixture is a deliberate rejected boundary test, not an
admissible benchmark case. The measurements must report the actual counts/bytes.

At capacity, never trim retained facts or evict learned negatives. A scripted
submission requiring a new legacy key can be blocked **before** the authoritative
request, without spending action, RNG or ledger sequence. Each numerical-model
label is admitted atomically. If a new-context label would exceed the combined
bound, it is denied while unrelated admitted-context updates continue. A bounded
64-exposure provenance sidecar permanently withholds numerical exposure labels
whose birth or elapsed-risk update was denied, so a later event cannot train
against missing at-risk time. It supplies no identity feature to the predictor.
The factual sensor, biological proof and safety state remain intact. Report such
admission denials explicitly, including which prediction remains unsupported;
existing admitted-context updates must continue. These are bounded admission
outcomes, not additional physical failures or zero-valued learning examples.
This fixture-only admission contract supplies no autonomous capacity policy.

## Gate 1 producer sequence frozen before outcomes (2026-10-16)

Use seed 74193 and the design's fixed first source/first collision-valid
45-unit E/W/N/S approach, with default body and stocks. The owner script performs
pull(source), inspect_object(actual held output), sample(that output), wait(5),
wait(5), honoring the genuine action scheduler throughout. Inspection is an
ordinary eligible held-item primitive; its configured 1.8-second work versus
sample's 3.5 seconds supplies the available cheaper comparison required by Gate 1.
The comparison is physically experienced and its interval closes when sample
starts. This is a static setup rationale, not a measured learning result or
knowledge supplied to an autonomous policy.

Freeze the numerical control after the second wait completes, with sample and
first-wait costs closed and no F report yet. Continue native ticks until the
first genuine matching F before exposure age 180 seconds. Use the first
scheduler-ready scheduled-perception boundary after that report, with no extra
observation or post-feedback action. Construct one immutable actual root set;
if the exact remaining material, sampling eligibility or supported comparison
is absent, mark the assay unavailable. Do not search later times, switch items,
refill stock or try another recipe. Query sixteen declared nuisance projections
with the fixed four draws [0.5, 0.5, 0.5, 0.5], comparing the sample against the
strongest other scorable actual candidate. The same current factual support,
sensations and masks apply to both parameter snapshots. Outcomes are continuing
and right-censored at stop, never terminal biological claims.

## Implementation boundary and measurement order

The predictor and sensor live only in research scripts. The production controller
and production save reader do not import them. Raw snapshots undergo strict
canonical validation. A runtime-only session owns deeply frozen parameter
snapshots and applies validated, copy-on-write row deltas atomically; prediction
indexes belong only to those immutable snapshots. Failed delta or capacity
admission leaves the prior parameter snapshot intact. This implementation detail
changes no rate, shrinkage, cost, outcome or decision equation.

An initial non-admitting synthetic smoke diagnostic exposed repeated whole-model
validation/copying and dictionary construction. Preserve that diagnostic. The
optimization is checked against the original equations before one frozen quiet
resource admission run; its original thresholds remain unchanged. A failed full
resource gate stops this stage without a physical outcome probe or timing retry.

The Gate 1 CLI is `scripts/evaluate-reusable-prediction.mjs`. It requires a hashed
preflight containing the exact source manifest, model/sensor/gate checks, native
harness checks, pure assay-producer tests, full application checks, build evidence,
independent review and the successful full resource report. Run it under an
owned-process external timeout of 315 seconds with a 15-second termination
fallback; the evaluator itself checks the 300-second total wall ceiling and
1,000-millisecond returned added-decision ceiling. Preserve the durable prefix
and explicit missing stop state if an operation never returns. No retry of an
interrupted or failed scientific assay is automatic.

This CLI executes only Gate 1 and preserves the continuing stop checkpoint.
The remaining frozen gates require their corresponding evidence producers and
are reported unrun until executed; a Gate 1 pass alone is not increment-A success.
