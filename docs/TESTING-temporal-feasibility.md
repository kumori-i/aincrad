# Temporal-return feasibility checkpoint

This is a locally tested research checkpoint based on stable main `3db8304`.
It contains a bounded return model and a manually driven observation ledger. It
has no temporal action chooser, focus policy, movement-effort sensor, or automatic
runtime event hook. Default gameplay does not create temporal memory.

## Measured result

Five native-step, finite-world scripted cases pass. An externally scheduled pull
and sample transfer an actual 30 g portion from existing stock. Twenty-four real
short operations occur before the food report at 53.983333 seconds; the water
report follows at 57.916667 seconds. Ingestion/action/object identities, biological
report time, immutable interval ownership, and the analytical five-channel
first-row return agree. Replay does not create additional biological rewards.

A save one frame before feedback preserves admission and body state. A separate
actual sleep request continues physiologically across reopening and receives
feedback before awake discovery processing resumes. Existing persistence cancels
active commands: the independent learner receipt remains unfinished. This proves
open-interval/body continuity, not completed-command or autonomous-care parity.

A matched old-meal inspect/wait control has identical positive return and elapsed
time at the shared boundary. Actual work differs. This does not establish causal
credit assignment generally; the model predicts subsequent behavior-policy return.

A fifth case takes two real finite portions. The remaining held material is aged
in an isolated copied-world fixture before the second swallow. Fresh/aged
provenance remains distinct; early food/water benefit does not prevent a later
harm report. Reopening between benefit and harm retains the surprise. Whole-world
energy accounting includes genuine decay into detritus; digestive calorie/water
balances remain checked. No food, recipe, energy or assistance is injected during
these scripts. Initial placement, hunger/fatigue and material age are explicit
fixture conditions, not autonomous achievements.

## Verification

- 433 tests passed; build passed.
- Independent review passed 56 model/ledger/persistence checks and the first four
  physical cases. The added two-portion harm case passed the subsequent full suite.
- 44 direct physiology cases, 84 fixed requests and 24 cancellations preserve
  physical state against main. Across 33,513 body/RNG frames and 642 environment
  checkpoints there were no differences after removing only additive effort fields.
- Two 120-second ordinary-controller traces include real save/load at 60 seconds:
  82 native-step actions and 71 quarter-step actions match. The native run uses
  ordinary Cardinal scheduling; the supplemental quarter-step run controls its
  wall-clock-dependent shadow-work budget. Neither creates temporal memory.
- Actual Linux Electron smoke and two-process disk reopening passed, including
  optional learned time-return rows and an open observation interval. Existing
  held identity, sleep, depleted resources and regional migration also persist.

This does not test Windows, a 32 GB laptop, Ollama, learned sequences, beneficial
release, or autonomous survival. The old command duration field is preserved;
actual worked seconds and qualitative exertion are additive primitive sensors.
Movement effort is not yet represented by this narrow sensor port.

## Resource gate still open

The frozen core probe uses 4,096 rows and 512 recent transitions, with 100 warmup
and 200 measured updates per case. Warm p95 update times are 2.49 ms for a typical
context, 3.87 ms for dense ASCII contexts and 3.15 ms for dense Unicode contexts.
These are core training timings, not full decision/save latency or laptop results.

Core-only serialized sizes are 2,064,070, 4,444,870 and 11,013,830 bytes respectively.
The Unicode stress case exceeds the preregistered 8 MiB per-actor target before
ledger overhead. Whole-process RSS spans roughly 87–213 MB across sequential
stress cases; it is neither incremental per-actor memory nor a clean isolated peak.
Earlier 10–12 ms provisional timings motivated a lossless compact public-key
encoding and deferred sweep writes; constants, field information, horizons and
count caps were retained. No autonomous comparison starts until a reviewed
UTF-8 byte-admission guard and complete-ledger measurements pass.

The scripted physics supports the feasibility of temporally distributed credit.
It does not yet support enabling or merging a new policy. A strict fixture with
many strikes before *any* visible effect is unavailable under current mechanics:
animal strikes already report recoil. A later slow-prerequisite assay must state
that fact rather than fabricate invisible progress or alter physics.

See [the preregistered design](DESIGN-temporal-learning.md), the executable
`tests/temporal-*.test.mjs`, and the [compact evidence summary](temporal-feasibility/evidence-summary.json).
Raw parity traces, source snapshots, logs and reproducible probes are retained in
the development evidence export; their hashes are recorded in the summary.

## Reviewed storage checkpoint (3959b27)

The lossless dictionary and actual-submission admission guard now cap the entire
optional per-actor wire object at 8 MiB of UTF-8, including reserved future row,
receipt and proof growth. Existing admitted evidence remains updateable when
full. A new context becomes explicitly unknown, with no learned reward or replay
bridge; its real chronology and ingestion/channel consumption still persist.
Malformed references, unsupported nested models and oversized legacy candidates
block loading/writing while preserving the previous bytes. Version-7 envelopes
prevent older clients silently erasing the optional memory. Ordinary saves stay
version 6. All 449 tests pass, including 15 storage tests; independent review,
actual Linux Electron smoke and version-7 two-process disk reopening pass.
The full 44-case physical/RNG comparison and both 120-second default-controller
save/reopen traces were rerun against main on the final sources: all 33,513 body
frames and 642 environment checkpoints match, with no optional temporal memory
created in default play.

Complete stress-ledger wire sizes range from 5,110,277 to 5,270,248 bytes. Depending
on public string size, byte admission retains 1,769–13,870 contexts; model rows
remain capped at 4,096, replay at 512 and receipts at 768. This is an explicit
capacity consequence, not a reduction of the configured horizon or silent
truncation of already learned facts. One-pass exposure accumulation and a Set
for duplicate-row validation preserve canonical keys/forecasts; 2,000 old/new
randomized comparisons and an independent equivalence review passed.

**The responsiveness gate still fails.** With 100 warmup and 200 measured full
submission/completion/training steps, cloud-process p95 values were 4.21 ms
(typical), 5.86 ms (dense ASCII), 8.58 ms (Unicode) and 5.32 ms (escaped strings).
Individual encoding samples ranged from 16.10–44.20 ms; canonical restoration
samples ranged from 305.56–1,037.32 ms. These are measured samples, not guaranteed bounds. Process-memory
measurements include retained fixture contexts and wire data and are neither
isolated per-actor heap nor laptop measurements.

Actual Electron testing calls the same synchronous save function used by
autosave, on a copied world with synthetic saturated learner memories. One- and
two-actor payloads of 5,501,324 and 10,619,437 bytes both saved successfully in the
isolated profile. Their saves took 479.6 and 907.2 ms, with following animation
frame gaps of 484.6 and 922.5 ms (ordinary copied-world save: 47.3 ms). This is a
real renderer-stall problem, not a demonstrated quota failure at those sizes.
Each case is one instrumented sample, with UTF-8 payload measurement inside the
storage wrapper; it is neither a latency distribution nor an exact measurement
of uninstrumented autosave.
A separate deliberately filled disposable profile reached a real
QuotaExceededError after 49 one-MiB filler entries; the next learner save failed
and the previous expedition bytes remained identical. That measured quota is
specific to this Electron environment and is not a portable guarantee.

No temporal chooser, autonomous learning comparison or main merge is justified
by this checkpoint. The next bounded engineering step must measure cloning,
validation, encoding and storage separately, then move expensive snapshot work
off the render path with coherent state, bounded backpressure and safe quit
semantics. Runtime update scheduling remains a separate unresolved gate. Do not
shrink the learner to fit a guessed quota or change the save backend without
measured need and an independent security review.

The [storage evidence summary](temporal-feasibility/storage-summary.json)
identifies frozen sources, test logs, complete stress reports, native results and
raw hashes. Earlier pre-optimization/shared-load probes are retained alongside
these final results rather than discarded. This supplements, rather than
rewrites, the earlier core feasibility evidence above.
