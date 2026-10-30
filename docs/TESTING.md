# Current verification contract

Run `npm run check`, `npm run build`, then `npm run smoke` in a supported sandboxed Electron environment. Native QA uses explicit disposable profiles and must not read/write the real product save. Test-path confinement includes canonical product aliases, symlink suffixes, packaged-mode refusal and retired flags.

## Required checks

- One entry module, normal direct-start and no world selector. New current saves include all current mechanics on the same watershed.
- Current strict save validation, occupied-byte protection, compare-and-swap writes, bounded proof/report fields and interruption/no-replay behavior. Old-save compatibility is intentionally not a requirement.
- Shared geometry and biome placement; spawn/bank accessibility, collision/swept movement, sight, actual-tree canopy and time-dependent shadows.
- Bounded aquatic primary production, fair local feeding, paid growth, parent-funded births, age/starvation mortality, extinction without respawn and bounded provenance. Separate synthetic long-run ecology, real-geometry trajectories and actual native evidence.
- Voluntary exact-item requests/offers, real recipient grasp, both-controller participation, safety withdrawal, atomic inventories and lost consent after restart.
- Finite physical capture/processing/sample chains, honest misses/refusals, ownership/capacity failures and energy/provenance closure.
- Real controller peer teaching: sender actually earns a technique, recipient gets attributed guidance, pays for its own actions and receives its own delayed feedback. No copied proof, benefit at speech, or replay after reload.
- Human hints with known/unknown targets, explicit attempted primitives and honest unresolved advice.
- Current rendering checkpoints and native screenshots for world, map, journal/teaching and dense-forest readability. Profile frame time, cold generation and bounded cache memory; cloud timings are not a guarantee for a user's laptop.
- Actual native close/reopen, partial paid action interruption, raw disk preservation, pause and background window behavior on Linux/macOS. JSON/Canvas tests are useful but do not replace these native rows.
- Strict desktop sandbox, context isolation, Node-disabled renderer, navigation/permission denial, canonical allowlisted assets and narrow IPC. Do not add `--no-sandbox` to obtain a pass.

Run `node scripts/verify-renewable-sharing-desktop.mjs` for the new two-process feeding/handoff evidence, alongside the existing aquatic and carcass native harnesses. Its short run does not establish multi-day reproduction; see [renewable native QA](RENEWABLE-SHARING-NATIVE-QA.md) and [ecology evidence](RENEWABLE-AQUATIC-ECOLOGY.md).

Run `node scripts/verify-structural-movement-desktop.mjs` for the targeted old-coordinate collision regression. Three independent sandboxed Electron processes write a valid near-tree save with a real failed and partially paid unfinished move, restore exact coordinates/clocks/history, exercise paid blocked and retreating ordinary player steps, and reopen the resulting save. Actual before/after screenshots and close/quit evidence are retained under `test-results/structural-movement-desktop/`. Existing history must remain exact; unfinished movement may add only an honest restart-cancellation receipt, not completion. The fixture uses disclosed initial placement and controlled movement, not learned recovery. `--prepare-only` and Node fixture/assertion tests prepare the runner but are not native evidence. This targeted path runs in the existing Linux/macOS desktop CI job without new application hooks, IPC or sandbox exceptions.

The aquatic native harness waits for optional terrain refinement, two animation-frame opportunities and the existing 100 ms compositor allowance before each screenshot. It retries only small/empty captures, at most four attempts within a five-second readiness/capture deadline. Renderer errors and timeouts fail; fixture actions, saved-byte checks and UI assertions are not retried. Every attempt retains PNG bytes when available (including empty bytes) and JSON metadata beside the named screenshot. The final greater-than-10,000-byte assertion remains. Frame signals and file size are not semantic image validation: inspect the native screenshots. This hardening does not establish the cause of the earlier macOS naming-reopen size failure, whose original rejected bytes were not retained. Production rendering, timing, sandbox and source checks are unchanged.

## Diagnostics, not physical-feature gates

Keep fixed ordinary-controller discovery/adoption results and failures. Do not silently turn failures green, substitute externally commanded actions for autonomy, or promise longer runtime will discover a skill. CI may label these jobs nonblocking diagnostics while keeping their actual assertion outcomes and artifacts visible.

When deleting old-world test files, preserve codec-independent proof mutation, delayed feedback, ownership and retention coverage in current tests. Report skipped and not-run tests separately from passes.

Publication/merge requires the exact reviewed source tree, terminal CI evidence and a verified resulting main tree. Historical reports in this directory are source-specific evidence, not an assertion that their retired worlds or workflows remain supported.

## Main-world character-message verification

The current main world samples literal `a`–`z` messages during the optional paid
visual-reference transaction. `tests/character-message-core.test.mjs` checks
finite-difference gradients across every parameter family, sampled EOS versus
the forced six-letter cap, numerical stability, update direction, clipping and
seed continuation. `tests/character-message-runtime.test.mjs` checks private
ownership, identical strings with distinct one-use handles, stale/copy rejection,
128-example replay, candidate permutation and exact restoration. The physical
adapter suite checks canonical inspection/demonstration/reply receipts, authentic
match and mismatch, critic/object-ID intervention, ambiguity, urgent interruption,
timeout, identity replacement, pending-save cancellation and repeated read-only
views/saves. Migration tests use an actual saved v1 paid transaction, preserve
legacy examples and four RNG states, and require a marked current save's full
v2 envelope even if all three communication sections are removed. Missing or
malformed v2 sections block loading without rewriting occupied bytes.

The Linux/macOS native engineering workflow must still use actual Canvas crops
and paid actions to show the literal message, recipient action, listener and
sender parameter changes, one mismatch, and a pending-message save/reopen with
no duplicate learning. Its `--prepare-only` and synthetic Node fixture tests
establish harness readiness only. Native screenshots must be inspected and the
tested source tree reconciled with any proposed publication. No ordinary cohort
or stable-vocabulary claim follows from those engineering scenes. The new
sequence admission lacks the old symbol-capacity constraint, so historical
exchange counts are not a direct rate comparison.

## Platform-specific evidence

The desktop and three native capability workflows target Linux and macOS, never Windows. `test-results/host.json` records actual `process.platform`, `process.arch`, OS release, Node version, git commit/tree and worktree status. The renderer source fingerprint remains renderer-only: it is not proof of the desktop/harness source tree. Archive host metadata alongside native process logs and results; release verification must reconcile the tested tree with the published head.

The renewable native harness also checks macOS last-window retention, standard Close/Quit menu roles, programmatic `activate` recreation of a sandboxed window, exact save bytes and no closed-time progression before another close and explicit `app.quit()`. This is actual Electron lifecycle coverage, not a physical Dock click or menu-keypress test. The recreated native QA window uses the explicit inert test route to compare the saved clock exactly; it does not establish normal automatic simulation restart after a Dock click. Separate-process reopening remains required on both OSes.

Filesystem checks retain canonical asset containment, temporary-root alias handling, symlink-suffix refusal and product-profile overlap guards. A case-sensitive host tests distinct-cased paths as distinct; a case-insensitive host must reject a differently cased alias into the product profile. Existing directory overlap is also checked by device/inode identity because realpath does not normalize case. No path is blindly lowercased. Unix backup mode 0600 is asserted, not skipped.

Packaging uses the actual host architecture. Linux produces an unpacked application directory; macOS produces an unsigned, unnotarized development `.app`. CI archives the bundles with tar to preserve executable modes and symlinks. Packaging success does not establish installation, Gatekeeper acceptance, or support for a different architecture. Other Unix systems are not tested desktop targets. Historical Windows artifacts remain unchanged and are not current support claims.

### Controller-selected movement recovery

`node scripts/verify-movement-recovery-desktop.mjs` runs a separate sandboxed
three-process native regression on Linux/macOS. A controlled first walk produces
a real blocked receipt; the ordinary controller must select and admit the next
recovery action, and actual motion/body time must be paid. A second scene saves
after one paid recovery tick. Reopen compares all clocks (including ecology
pending time), body, action history and pose, and a third process rules out a
duplicate restart interruption. Screenshots and process-close evidence accompany
the result. A decoded actor separately checks that saved observations cannot
restore live retreat authority; it is not claimed to be the app's private actor.

`--prepare-only` builds the harness without running Electron and never counts as
native execution. Native execution requires an unprivileged supported display,
without sandbox bypass. This narrow controlled trial is not a survival evaluation.

The controller recovery harness uses the same bounded native capture-readiness
helper as the aquatic harness. Only small/empty captures retry; every attempt is
retained. No controller action, save operation, assertion or physical outcome is
retried, and the final image-size threshold is unchanged.

### Bounded naming follow-up timing

`node scripts/verify-naming-followup-desktop.mjs` runs three independent sandboxed
Electron processes on Linux/macOS. A disclosed close placement and repeated paid
inspection establish an owner-chosen individual name; ordinary `PopulationRuntime`
ticks then drive introduction, request, independent selection and confirmation.
A second fixed encounter saves immediately after a real request, before confirmation.
It does not pause another agent, manufacture a shared dictionary, or retry dialogue.

The actual app reopens the exact saved bytes and compares pose, physiology,
lexicons/checked-with records, history and every clock (including ecology pending
time). Its grounded-name journal is captured read-only. A further save and third
process reopen rule out duplicate history or fabricated confirmation. Conversation
interruption alone is not a paid-action restart receipt; only genuine active bodily
actions may receive the existing codec cancellation. A separately decoded-actor
check observes the target afresh and runs beyond the ordinary speech cooldown,
asserting no restored opportunity or pending conversation and no replay. This
separate runtime check is not represented as access to the app's private actors.

Evidence under `test-results/naming-followup-desktop/` includes raw checkpoints,
live world and actual reopened journal captures, distinct process IDs, normal
close/quit records, source identity and strict sandbox settings. The existing
bounded capture-readiness helper preserves all failed capture attempts without
retrying actions or saves. Inspect the screenshots; byte size is not semantic QA.
`--prepare-only` and serialized Node fixture tests are preparation, not native
execution. Missing display/runtime is reported as not run, never bypassed. This
controlled timing trial does not establish spontaneous language, mutual attention,
long-run survival or autonomous discovery of the initial encounter.

### Bounded naming clarification

`tests/naming-repair.test.mjs` and `tests/naming-repair-state.test.mjs` cover the
listener-triggered clarification, current-sight re-point and separate word-only
retry, including negative ambiguity/conflict controls and strict optional receipt
validation. Controlled observation overrides are diagnostic fixtures, not evidence
of naturally occurring language. Restart and compaction must retain consumed
budgets without restoring a runnable exchange; prior schema-12 saves remain valid.
Native execution still requires a supported sandboxed display/runtime. Node
roundtrips do not establish native close/reopen behavior.

`node scripts/verify-naming-repair-desktop.mjs` prepares and runs a targeted
three-process sandboxed repair/save regression on supported Linux/macOS displays.
The disclosed fixture initially places the listener outside source sight but near
the speaker, waits for an actual unresolved request and explicit clarification,
then externally relocates the listener to permit current-sight re-pointing. An
isolated `SocialCoordinator`, not ordinary autonomous controllers, drives the
exchange while body, ecology and paid-action time continue. It captures one
completed repair and another interrupted just after the fresh word-only retry.
Exact saved bytes, consumed budgets, clocks, physiology and history are compared
on actual app reopening and again in a third process; a separate decoded-actor
probe checks no replay after fresh sight. This is not autonomous travel evidence.

`--prepare-only` and the serialized Node fixture tests establish preparation only,
never native execution. Native logs and capture attempts are retained under
`test-results/naming-repair-desktop/`; inspect actual screenshots when that runner
is executed. Missing display or sandbox capability is a blocked verification row,
not permission to weaken the sandbox.

### Passive tentative visual groups

`tests/visual-group-memory.test.mjs` covers the supplied exact-cue rule, bounded
retention, time deduplication, changed/missing cues, strict ownership and read-only
projection. Integration fixtures use real ordinary perception on disclosed
controlled exposures, test speech refresh exclusion and optional schema-12
roundtrips/invalid input protection. A test-only disabled observer comparison
must preserve all other world state; it is not a production policy switch.

`node scripts/verify-visual-groups-desktop.mjs --prepare-only` prepares a targeted
three-process native harness. Without `--prepare-only`, supported sandboxed native
execution records actual selected-actor panel captures and exact save/reopen
comparisons, using the existing inert disposable test route. Controlled placement
and time-separated sensing are not independent encounters or autonomous concept
formation. Preparation and Node fixture passes are not native execution. Never
bypass display, socket or sandbox denials to run the native row.

## Combined food satisfaction, funding and warnings

Run `npm run check` and `npm run build` on the exact release tree. Preserve the
actual test counts, failures and skips. Focused preparation or a pass on a prior
runtime is not a substitute. The [acceptance specification](food-system/ACCEPTANCE.md)
and [verification record](food-system/VERIFICATION.md) distinguish historical
observations from pending/current release-source evidence.
Use the [self-contained running guide](food-system/RUNNING.md) to generate exact
release manifests and run the budget and capability gates without private inputs.

Coverage includes appetite dose/time and water controls, immediate committed
projection, finite paid portions, energy conservation, strict save validation,
completion/payment witness loss on restore, exact source provenance, bounded
retention, action deadlines, movement funding and passive current. Reentry hooks
must delegate a real debit before claiming paid completion; a callback invocation
alone is not energy payment. Obstructed-edge fixtures must distinguish genuinely
blocked input from paid wading opposed by current.

`tests/food-warning.test.mjs` covers canonical adverse proof, speech access,
independent full-state/RNG eligible choices, delayed harm, exact identity, expiry,
malformed saves and bounded reports. Own-source caution tests separately reject
missing, ambiguous or donor provenance. Retain failed/inconclusive opportunities
and harmful pre-feedback exposure; do not count an ineligible control choice as
successful avoidance.

`node scripts/verify-combined-food-desktop.mjs --prepare-only` and
`node scripts/verify-food-warning-desktop.mjs --prepare-only` prepare isolated
three-process runners. Node fixture/harness tests and preparation do not establish
native execution. Linux/macOS desktop CI runs both real runners with sandboxing,
normal close/reopen and exact source/build identities. Inspect actual screenshots.
Native execution remains **not run** until those release-source checks complete.

The [native coverage contract](food-balance/NATIVE-ACCEPTANCE.md) distinguishes
whole/water app screenshots, partial-dose renderer assertions, engine-only hourly
curves and detached decoded-save witness probes. No browser substitute, older
source evidence or sandbox bypass satisfies the native row.
