# Prospective ordinary character-message pilot v1

**Protocol preparation only. No pilot has run.** The final instrumentation source,
complete Git commit/tree, renderer fingerprint, protocol SHA-256 and runner/source
manifest SHA-256 must be recorded in an external pre-run receipt after exact-source
review and **before** any behavioral outcome is observed. This document cannot
contain its own final commit or hash. The parent review must approve that receipt
and a separate one-time activation; publishing this document does not activate a
run. If the final source or any bound value changes, review and freeze a new
prospective receipt before execution. An observed outcome cannot justify changing
this protocol and rerunning it.

## Question and one ordinary trajectory

During 1,200 simulation seconds of the normal Ozark survival world, how many
optional character-message opportunities progress through emission, paid
listener inspection, an own-view demonstration and authentic sender feedback?
What fraction of completed, evaluable listener choices does the observer critic
mark correct? This is a descriptive acquisition and bottleneck pilot, not a test
of vocabulary stability, causal communication benefit or survival improvement.

Run **one** fresh disposable Linux x64 desktop profile with an empty current-save
slot through the existing `?test=1` native route. Its blank-world communication
seed is explicitly **211**; the physical world seed is **74193**. Use the default
map, Aster and Mira spawns, bodies, ecology, policy, normal **1×** speed and existing **1/60-second**
fixed step. The route exposes read-only native observation and ordinary
start/pause controls; it must not take fixture ownership or invoke test stepping,
action, learner-update, pixel-capture or save-mutation hooks. The source guard
must confirm an empty current-save slot, fresh untrained character models and
zero completed communication counters before starting once. No imported model
weights, prior examples or old symbol associations may be installed. Ordinary
autosave may write the disposable profile; the observer does not call save.

Seed 211 is chosen now because the current disposable route already declares
it; this observer milestone does not add a new seed-injection path. The earlier
**legacy integer-symbol** ordinary run also used seed 211 and reported seven
exchanges in 1,200 seconds. Its outcome is known, but it cannot predict a
recurrent character-message result or provide an independent seed replicate.
Controlled native engineering fixtures also used 211/212. No ordinary recurrent
pilot outcome informed this choice. The sequence protocol has different
admission rules from the legacy symbol protocol, so counts are not directly
comparable. Do not search seeds or describe this one trajectory as representative
of random fresh worlds.

No forced meetings, moved agents, injected resources, scripted messages,
favorable retry, urgency suppression, changed action costs/deadline, alternate
geography or continued run after a sparse result are allowed. Survival remains
active and can interrupt communication. If there are no completed exchanges,
the run still stops at the prespecified target.

## Clock, observer and evidence bounds

The prepared runner anchors clock slots at ordinary start and reads once at
the first observed slot boundary at or after each **1 wall second** interval.
If a read runs late, it skips catch-up reads and records how many wall slots
were missed. It makes a compact detailed projection at the first clock read
at least **10 simulation seconds** after the previous detailed projection,
plus initial and terminal projections. A late detailed read records the number
of crossed 10-second windows it missed; it does not backdate or invent samples.
At the first passive observation of elapsed time
**≥ 1,200 simulation seconds**, request ordinary pause once; record observed
threshold time, confirmed paused time, wall time and overshoot. Overshoot above
**2 simulation seconds** is a retained deviation, never a rerun reason. Do not
step, resume or extend the world to improve a result.

The immutable launch-to-stop wall limit is **30 minutes**, including boot.
Structured JSONL evidence is capped at **32 MiB**, including a **256 KiB**
reserve for terminal/failure evidence. Native stdout/stderr and any media share
a separate **16 MiB** cap. Count actual UTF-8 bytes including separators;
reject an over-cap record whole rather than truncating a sample silently.
Bound individual IPC records in the eventual runner. The current source retains
at most **256** event rows and **64** distinct censor-reason keys, and exposes
at most **64** admission gate keys. Its measurement counters saturate at
**2,147,483,647** with a saturation flag; admission gate counters have their
separate safe-integer cap.
Report evicted-row and identity-retired counts separately, omitted gate keys,
overflowed censor reasons, dropped output records, observed missing-ID ranges and
terminal outcomes that became unknown. Do not reconstruct individual evicted
events from aggregate counts.
Record observer poll/read counts and durations so its cost is visible. Retain
compact projections and bounded logs, not raw saves, profiles, private pixel
vectors, model weights, trajectories or authority handles.

At a cap, renderer/IPC fault, clock rollback, unexpected pause, identity or
source mismatch, or other invariant failure, record the **first** stop cause
without overwriting it and retain additional causes within a bounded list.
Request ordinary pause once, allow **5 seconds** for terminal evidence and
child closure, then terminate if necessary. A pause that cannot be confirmed,
nonzero exit, missing terminal record or early stop makes the trajectory
incomplete. A prelaunch source/profile guard failure is a no-run blocker.
Neither case authorizes an unchanged retry or a local native fallback.

## Prespecified observations and denominators

Use only passive snapshots from the actual main-world attachment and world.
Project bounded aggregate counters, finite gate/censor reasons and retained
transaction transitions. Keep observer correctness, object identity, body
diagnostics and peer pixels outside both learners. Count each physical event
once across repeated reads; report ledger evictions and unresolved pending
events rather than reconstructing unseen outcomes.

Report, overall and by sender/listener where available:

1. `optionalChecks` for every optional-channel callback, `feasibleOpportunities`
   once per callback with at least one valid distinguishable pair **before**
   any pair/target/message random draw, and the bounded admission gates. An
   optional check is **not** a mutually eligible meeting; even a
   feasible pair is not a completed exchange.
2. Committed exact-letter `emissions` (one per initiated transaction, excluding
   samples canceled before a listener choice), `paidInspectionStarts`,
   `paidInspectionCompletions`, `canonicalDemonstrations`,
   `validListenerDemonstrations`, `ambiguousListenerLabels`,
   `rejectedListenerLabels` and `listenerOptimizerSteps`.
   `paidInspectionCompletions` requires a successful inspection receipt; even
   that can occur without a canonical demonstration. Reconcile this physical
   receipt before a same-tick priority or visibility censor. A started action
   whose outcome cannot be verified after owner identity loss is counted in
   `paidInspectionOutcomeUnavailable`, never as a completed inspection.
3. `validListenerDemonstrations` as unique valid physical examples,
   `listenerReplayUses` as uses of earlier examples, and retained partner-bank
   examples as separate quantities. A replay use is not a new experience.
4. `paidReplyStarts`, `paidReplyCompletions`, sender-local `visualMatches` and
   `visualMismatches`, accepted `senderUpdates`, `originalCensors` and
   `responseCensors`, with bounded stage/reason detail. Visual comparisons
   occur before sender settlement; they must not be reported as updates.
   Ambiguous gray-zone feedback is a response censor reason, not a mismatch.
   `paidReplyOutcomeUnavailable` separately records started reply actions whose
   physical outcome cannot be verified after owner identity loss. Valid old
   actor receipts still count if replacement occurs after physical completion.
5. Completed, canonically demonstrated listener choices with a boolean
   **observer-only** critic result: numerator = `criticCorrect`; denominator =
   `canonicalDemonstrations`; critic-incorrect = denominator minus numerator.
   Report both integers, their fraction only when the denominator is positive,
   and censored/unknown-correctness choices separately. A later failed reply
   does not erase an earned listener demonstration. Censoring is never scored
   as an incorrect choice.
6. Initial, periodic and terminal survival context: elapsed/world clocks,
   locations and active action types, health, satiety hours, available and
   stored energy, water deficit, stamina, collapses/rescues and physical food
   and drink counters. The legacy `independentMeals` counter is a food-feedback
   event count, not whole meals or adequate caloric intake.

The current test hook combines compact communication counts/events, actor
partner-bank occupancy and both actors' bounded survival-body/decision summaries.
The prepared runner projects further world clocks and identity checks
from `fullSnapshot()` **inside the renderer**, and allowlist only the numeric
body and bank summaries needed above. A full world, private feature vectors,
crops and model weights must not cross IPC.

Report `emissions / optionalChecks`, `emissions / feasibleOpportunities`, and
later-stage ratios with their explicit
stage denominators; do not quietly divide by all optional checks when claiming
meeting eligibility. A zero denominator yields **undefined**, not zero
percent. If counts are small or evidence is lost to eviction, state
**insufficient evidence**. Distinct or repeated strings alone do not establish
shared meanings; a learned update does not establish useful vocabulary,
generalization, grammar, composition or improved survival. One observational
trajectory supports no causal comparison.

## Source freeze and later work

The prepare-only runner `scripts/prepare-character-ordinary-pilot.mjs` creates
source inventory, generated observer and candidate receipt artifacts without
starting Electron. Its execution mode requires a separate external reviewed
receipt and a new attempt-1 GitHub branch-create event. No workflow activates
it in this checkpoint, and no pilot has run. The later one-time workflow must
verify the externally approved exact
commit/tree, source inventory and hashes, built renderer fingerprint, Linux x64
host, unprivileged sandboxed Electron preferences, isolated profile, fixed
seeds, default start and normal speed before ordinary progression. It must use a
**new** one-time ref and attempt-1 activation gate, with no mutable-main lookup,
manual dispatch, fallback trigger or rerun. The parent will review the written
protocol and exact instrumentation source before any pilot dispatch. No runner
or workflow is activated by this document.

The existing Linux/macOS character-message native engineering fixture separately
checks the new passive measurement counters, actual paid Canvas actions and
repeated-read purity. Those authored scenes test instrumentation and do not
consume the ordinary pilot or count as an ordinary outcome.

Length-matched shuffled-message controls and novel-instance evaluation are
possible later, but require separately frozen source, sampling and outcome
rules. They are not part of this pilot. Preserve the historical
`experiments/reference-acquisition-v1-once` ref, its sole run **40834043973**,
original protocol and all failed evidence unchanged.
