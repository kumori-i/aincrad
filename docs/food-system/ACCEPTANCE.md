# Food-system validation specification — release revision 1

This is a new public technical specification, not a rewrite of historical
experimental protocols. It governs current release validation only. Historical
runs retain their original source, protocol and evaluator identities; this text
does not retroactively certify them. See [verification](VERIFICATION.md) and
[historical reproducibility](HISTORICAL-EVIDENCE.md).

## Scope and frozen identities

The integrated runtime fingerprint is
`d68d8146a91467f80f62fd2e5645df3e5c91578a648f8206b27ebc4e869f092d`.
It hashes sorted JavaScript source files plus package.json and package-lock.json
using the evaluator's documented algorithm. The baseline runtime is
`ebaef37d61a50d994a0dbcb7e6e5a1c2a064c6c7e952a6de0dc4337e3c98b788`,
from main commit `49f476d93028566c7ab60110aa97776724446ced`.

Freeze the exact committed source tree, complete runtime-file manifest, this
specification, both current evaluators, the packaged baseline fixture and prerequisite report
hashes before an assay. Recheck them afterward. Changed test/document metadata creates a new tree
identity even when runtime bytes do not change. Never discard differing clocks,
receipts or cognitive state to manufacture a matched comparison.

The current known-food evaluator is `scripts/evaluate-food-release-budget.mjs`;
its controlled worker retains the prior v4 physical logic, but uses this release
specification and an explicit schema-5 release report. The current single-runtime
capability evaluator is `scripts/evaluate-food-combined-capability.mjs`; it accepts
only a passed same-source release-budget prerequisite with the exact expected
schema, source/protocol/evaluator identities and recomputed numerical gates.
Old standalone reports cannot masquerade as release results.

Default current commands use the packaged
`tests/fixtures/food-release/baseline-controlled.json`, not a private checkout,
scratch report or live save. This curated generated-simulation fixture contains
only the exact historical baseline controlled trial, a full starting state
reconstructed from frozen main and verified against the original recorded raw
state hash, the full baseline runtime manifest and extraction provenance. Its own SHA-256 is
pinned independently. The original failed experiment's complete-report hash is a
provenance identifier; a curated subset alone cannot cryptographically reproduce
that complete hash. Packaging its measured baseline arm does not make the failed
candidate experiment pass, nor claim the baseline600-second run was just rerun.

Validate finite raw values and exact schema/source/fixture identities, recompute
the original FULL initial-state hash, then derive the comparison using the same
unchanged v4 projection: exclude only human satietyHours, actor nourishment and
feelings, time-zero observation nourishment, and the duplicate top-level npc
alias. Compare that derived hash to the current actor's initial state. The raw
identity is retained separately; do not substitute the older normalized hash or
add exclusions to manufacture equality. Exact baseline actor metrics remain the
historical debt/reference evidence. The prior wrapper regenerated only the
baseline starting state; this packaging replaces that external dependency, not
its measured results, physics, comparison rule or acceptance thresholds.

## Required gates

- Run the complete source/test check and build on the final release tree, retain
  raw logs and distinguish all passes, failures, cancellations and skips. Review
  the exact changes. No source editing during a validation process.
- Known-food controlled budget: seed74193, native1/60-second steps,600 simulation
  seconds/four game hours, with the unchanged initial700kcal/4h-satiety/2h-meal-age
  fixture, physical placement, first pull/taste schedule and disclosed suppression
  of travel/unrelated targets. Validate the packaged original raw baseline
  starting state and compare its unchanged derived physical-start hash. Require conservation, finite resource transfer, complete unique
  physical receipts and no rescue/unrecorded assistance. The late two-game-hour
  absorbed/spent ratio must be>=1 and total energy debt no worse than the original
  main baseline. Report satiety separately from debt, pending digestion and finite
  source exhaustion. A failed prerequisite stops the dependent capability assay;
  thresholds, seed, doses and horizons are not adjusted after seeing results.
- Run the real warning gate and single-runtime own-source capability below.
- Exercise supported Linux/macOS native smoke, rendered UI and separate-process
  save/reopen; preparation alone is not actual desktop acceptance.

This release specification changes documentation/provenance bindings, not body,
policy, physics, seed, horizon, assistance, dose or behavioral thresholds. Current
results must be rerun under its own hash. Historical ordinary observations remain
source-specific; no extra seeds or autonomous-survival claim follows from these
bounded assisted gates.

## Real warning gate

Use `createFoodWarningScene` and its actual speech transport, not inserted report
objects. Physical paid extraction/sample, delayed adverse recognition, local
speech access, exact-item transfer and witnessed consumption precede choices.
Branch the whole state and RNG independently, restore normal geometry/ecology
bindings, and remove only the warning report in the ablated branch. Require a
real sample opportunity: within30 simulation seconds of actual receipt, control
selects the exact held material and warned policy does not. Selection latency,
material/source/receipt identities and both actions must be retained. Merely
selecting something else in both branches is inconclusive, not protection.
No copied recipient effects, skills, practice, calories or causal certainty.
Same-source sibling materials do not inherit peer caution. Preserve own direct
adverse and own-source caution independently; report-only ablation removes neither.
Existing warning save/reopen and malformed-testimony negatives remain mandatory.

## Combined delayed-own-source capability assay

This is a new single-combined-runtime capability assay, NOT a clean v3/v4 causal
comparison. The release evaluator uses the same physical setup and read-only metrics.
Historical standalone evaluators and their exact cross-source checkpoint/hash
checks remain unchanged; release output has a separate identity and filename.

Use the same seed74193, finite staged carcass conversion/aging, initial available
energy700, meal age12h and satiety0 as the existing toxicity fixture. Disclose all
initial body/position changes and external staging strikes/aging, not as earned
hunting or an autonomous encounter. Source and materials remain finite; do not
replace swallowed mass, restore reserves or insert learning. Run actual paid
pull/sample actions and earn two distinct personal beneficial ingestion chains
before adverse recognition, with each paid setup action bounded to1200 fixed steps (20s) and each benefit
wait bounded to24000 fixed steps (400s).
Record the full starting state and learned checkpoint without exclusions. Failure
to earn an eligible checkpoint is inconclusive (or a physical failure if an
invariant fails), never repaired by fabricated receipts or retuned timing.

From that independently earned checkpoint, use exactly300 simulation seconds of
ordinary decisions while awake and inactive, at least.65s after the previous
decision, with observations refreshed every60 steps (1s), then900 seconds of digestion-only
time, at1/60-second steps. Preserve the original disclosed suppression of travel
and unrelated targets; record every suppressed decision. Do not suppress any
same-source sample to manufacture a pass. If policy selects an implicated sample
after recognized discomfort, record a failed gate before any harness cancellation;
an incomplete exposure is not a completed passing assay. Cancel unfinished
acquisition/ingestion at the fixed exposure boundary with explicit paid receipts,
not before it to manufacture avoidance. Shared physiology/ecology clocks continue.

Required observations:

- Actual delayed discomfort with sample/ingestion/condition identity and paid
  action closure; time and cumulative mass/calories BEFORE recognition, first
  physical harm and cumulative gross toxic harm remain visible.
- A personally extracted held successor with valid own-source attribution at one
  or more post-harm decision opportunities. Count these opportunities explicitly;
  an empty hand, missing provenance or no later decisions cannot pass vacuously.
- At least one actual live finished-material shortcut activation, independently
  earned through paid consumption and benefit, never restored from a saved flag.
- Zero post-recognition implicated-material sample choices and zero implicated
  learned-care repeats. Report unrelated/generic feeding separately, including
  those suppressed by the fixture; they are not evidence of safe exploration.
- Every ingestion linked to its actual receipt, unique ingestion identity and
  finite material stock. Record piece spoil decay separately from swallowed mass;
  each tracked piece
  must reconcile opening mass with intake, decay and remaining physical stock
  within absolute1e-7g; require finite terms and absolute residuals.
- Finite absolute energy residual |r|<=1e-6kcal, physical human-transfer closure, no unrecorded
  assistance/rescue/external ecology energy, and no invented energy coverage.
- Complete exposure/drain horizons and empty gut after the fixed drain. Preserve
  all pending/effect state; failed digestion completion remains failed.

The result can establish combined capability under this exposure, not spontaneous
use, safe dosing, elimination of initial risk, lower harm than a counterfactual,
or survival. If a causal caution comparison is later requested, both arms must
hold funding and all other combined code constant and independently earn matched
full checkpoints. Such a comparison needs a separately reviewed prospective
protocol; do not infer it from standalone v3 or by disabling all learned caution.

## Strict provenance and exhaustion regressions

Fresh combined tests must cover cap168/scan169 and raw malformed/ambiguous claims;
true-only paired finishedMaterial metadata; absent runtime authority after clone
or load; four recent own origins plus held roots; gap-free actual memory attribution;
donor/borrowed evidence, unrelated sources and interrupted regrasp negatives.
Neutral receipt helpers may validate proof but diagnostic effort projections must
not enter policy. Warning snapshots must omit completion authority.

Funding acceptance includes zero/partial/full payment, all primitive outputs,
certified duration on cancellation, bounded admitted run deadlines and runtime-only
travel ownership. Movement tests cover terrain-specific effort, zero/partial input,
passive current once per elapsed frame and no free escape. Confirm unchanged
zero-effort drink/fill, human-only scope and player/animal semantics. Invalid payer
hooks or edited public progress fields must not certify work. Fresh save tests must
preserve real debits without completing or replaying interrupted work.

## Native acceptance and honest status

A combined isolated fixture/runner must complement the existing real warning
runner. Exercise paid six-portion apple ingestion, immediate satisfaction
projection, partial30g/water-only negatives and separate energy/pending digestion.
Measure zero and fractional funded work without early physical outputs, save an
actual partial action and perform two fresh native process reopens. Retain exact
stocks/body/debits/history and interrupted-action evidence; no restored runtime
payment/completion witness, duplicate receipt or fabricated completion. Include
actual Food satisfaction label/tooltip and separate Energy rendering. The minimal
three-process runner asserts30g/water-only values inside the real sandboxed
renderer; add a representative small-portion or water-only rendered checkpoint
within that fixture when straightforward. Its whole-apple screenshot may follow
the two short funding slices: separately record the immediate last-bite numeric
projection and exact screenshot-time delta rather than claim an immediate image.
Verify paused/no-decay around capture. The bounded1/2/3-game-hour curves remain
engine tests, not native hourly screenshots; no extra worlds solely for all curve
images are required in this increment. Evidence must list every rendered state
versus numerical-only state and never claim the entire historical visual checklist.
RESTART_INTERRUPTED has no paid-duration field: verify actual pre-save paid
progress/debit and unchanged restored debit with no output/witness resurrection;
normal cancellation paid-duration accounting remains separately tested.

Use repository sandboxed Linux/macOS infrastructure, isolated temporary profiles,
build fingerprints and normal window-close paths. Record host architecture,
source/build manifests, raw saves, checkpoints, actual rendered screenshots and
process/lifecycle evidence. Inspect screenshots rather than infer validity from
file size. Preparation/Node roundtrips are not native execution. A denied native
environment remains blocked/not run; never weaken sandboxing or touch user saves.
