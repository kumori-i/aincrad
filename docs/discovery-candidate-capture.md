# Discovery candidate capture

This is an opt-in diagnostic API at one existing physical-decision boundary. It
does not choose, rank, reject, interrupt or execute actions. The ordinary agent
still follows the existing `discoveryDecision` policy.

## Use

On an existing `NpcController`, call `setDiscoveryCandidateCapture(true)`, advance
the ordinary runtime, and call `takeDiscoveryCandidateSnapshot()`. The drain
returns the latest frozen report, or `null` if no eligible boundary has been
reached since the last drain. `setDiscoveryCandidateCapture(false)` disables and
clears it. Only literal `true` enables capture; enabling again clears an older
report. Disposal also clears it.

There is one private slot per controller. Successive captures overwrite that
slot; there is no queue, event, persisted field or observer callback. The API
does not itself advance simulation time. A report with `status: 'unavailable'`
explains a bounded projection failure using a fixed reason code. It does not
alter the ordinary decision or create a gameplay failure.

Capture is disabled by default. The disabled seam performs a WeakMap lookup and
returns without reading actor evidence or allocating a report. Enabling it adds
bounded synchronous diagnostic work; it is not a zero-cost subscription.

## Exact boundary

The report's phase is `before-discoveryDecision`. In `tickDiscovery`, capture
happens after the existing body tick, feedback processing, due perception and
cognition, contact handling, idle eligibility and dialogue handling. It is
immediately before the existing physical decision call. That call can still
perform its own feedback processing. Capture does not claim to represent an
earlier tick start, a post-decision state or a full-world checkpoint.

An early return for an active action, decision cooldown, sleep, non-awake state,
disposal or performed offline dialogue does not create a new report. A previously
undrained report can still exist, so consumers must use its observation time
and actor epoch rather than treat every drain as fresh sensing, including after
an actor reset.

## What the report means

The candidate list describes retained two-step food procedures, plus local rest
and wait alternatives. It is deliberately incomplete: water, navigation, contact
escape, exploration, dialogue, sleep scheduling and other policy entry paths are
outside this slice. `nextOperation` is a descriptive procedure step, not a
validated executable action or a recommendation.

Food support requires original matching acquisition and sample receipts,
experiments, an ingestion identity and an original retained recognition receipt.
Source continuity additionally needs the complete retained intervening event
interval without release, regrasp, strike or a conflicting material acquisition.
Missing or retired
proof remains unknown. The collector does not repair attribution across handling
chains or infer hidden source identity. Independent support counts unique
ingestions rather than repeated feedback messages.

All retained relevant effects are considered, including adverse effects outside
the technique's selected evidence. A positive historical outcome is not a safety
certificate. Pending markers, unresolved samples, neutral feedback and recognized
harm are distinct. The private physiological feedback buffer is never a fallback
for a missing remembered recognition receipt.

Matching remembered pain also marks an adverse observation when the same witness
reports relief. The diagnostic preserves mixed outcomes rather than assuming that
benefit makes pain impossible or harmless.

`retainedEffectsCoverage` exposes bounded unverified and unassigned effects,
including uncertain adverse counts, without inventing source attribution. Food
candidates retain their diagnostic witnesses when the controller's food-learning
ablation is disabled, but `foodLearning` and `policyEnabled` explicitly report
that setting. Neither historical counters nor the technique's selected evidence
list is used as independent proof.

Observed timings come from original action receipts, including failed actions
where their duration is retained. Discovery completion records active work;
older cancellation receipts can instead contain elapsed command time. Neither
is whole-procedure completion latency. Cooldowns, gaps, remaining work, future
relief, future effort, future harm, route and current availability remain
explicitly unknown. A stale sighting cannot certify that a source still exists.
No numeric utility, learned skill increase or survival improvement is claimed.

The report contains only copied allowlisted identity, sensory, qualitative body
and evidence fields. It excludes raw receipts, exact body stores, `riskCost`,
nutrition, ecology, privileged geometry and other actors' state. It cannot be
passed back as a policy choice. Mutating the report is rejected; subsequently
changing the actor cannot change an already drained report.

## Firsthand handling feedback

Newly executed `inspect_object`, `grasp`, `release`, `pull`, `sample` and `strike`
actions can add one small `handling` object to their existing action result:

- `source: 'experienced'`
- `activeActionSeconds`: positive acknowledged physical work, in simulation seconds
- `effort: 'rising' | 'steady'`: the same net fatigue/stamina trend convention used
  by movement feedback

This is a report of the body's experienced trend, not an estimate of calories,
effort intensity, remaining capacity or nutritional value. `steady` means no
detected net rise. Recovery or a saturated/exhausted body can mask a change, so
it never means free, easy or safe. Concurrent background physiology is part of
the experienced interval; the field does not isolate a causal metabolic charge.

The witness is private to the admitted runtime action and bound to its actor,
physiology/discovery context, primitive and target. It accumulates only work
slices whose existing exertion call returned while that action was still active.
Cancellation or collapse can report earlier acknowledged slices. A synchronously
cancelling or throwing exertion hook cannot certify its in-flight slice; an
omitted slice is not evidence of zero cost. Completion and cancellation consume
the witness once. No observer changes exertion, time advancement or completion.

Immediate refusals, zero-work cancellation, copied/restored active commands and
old receipts have no new witness. Restart retains the existing interruption
behavior and does not reconstruct partial effort from saved body state, current
practice or primitive constants. Existing `durationSeconds` semantics stay intact.

The action receipt remains the sole evidence owner. Its optional nested handling
data uses the existing bounded receipt serialization; no save version, experiment
field, extra event, retention owner or aggregate is added. Only the retained
receipt is accepted as evidence; the existing `lastResult` mirror is never a
fallback after that receipt retires. The active selector and model observation
projection do not read the new field.

Food candidates expose `observedEffort` only for their relevant original receipts
after the usual unique-ID and experiment checks. Each copied row identifies its
action and experiment, outcome, target, observed time, acknowledged seconds and
qualitative effort. Complete coverage cannot be certified from a retained ledger,
so `experienced-effort` stays in `missingCosts` even when all visible rows have
feedback; missing, malformed, retired or truncated witnesses are never zero cost.
`future-effort` also always stays unknown.
Known rows are historical witnesses, never a total procedure cost or a future
prediction. Rest/wait rows remain empty in this food-handling slice.

Handling feedback appears when the physical command finishes or is interrupted.
It cannot become a food benefit or toxicity result. Sample ingestion and later
digestive effects keep their separate original action, ingestion and recognition
proof, including delayed harmful feedback. No hidden food/source identity is
inferred from effort.

## Resource bounds

Input arrays are checked before traversal: at most 400 experience receipts, 160
experiments, 64 effects, 24 techniques and four held identities. The official
qualitative body projection is guarded by the existing 24-row stomach limit.
Relevant observation and pending-marker entries are direct lookups from these
bounded identities; neither map is enumerated. In particular, live pending-marker
history is not assumed to have the save loader's shorter bound.

There are at most 26 candidate envelopes. Per-candidate timing, effort, refusal, effect
and pending output lists, and shared uncertain-effect output, are capped at 16
rows, with retained counts and truncation flags. Refusals include immediate
rejections without a positive completed-action duration.
Adverse/support summaries are computed before truncation. Strings and procedure
depth are bounded. These diagnostic output limits do not trim or modify the
actor's evidence, nor change any production proof-retention bounds.

## Validation and later work

Focused tests compare capture-disabled, capture-enabled and the byte-verified
baseline controller at the real seam. They cover complete actor state, action,
RNG, run and evidence, API lifecycle, malformed/ambiguous proof, contradictions,
stale observations, bounded traversal and hidden-field exclusion. The retained
historical actor fixture is from an older experimental trajectory; its replay is
a current-code counterfactual, not evidence of a current-main survival trajectory.

Handling regressions separately reconstruct the byte-verified pre-feedback
physical action and NPC modules. Short legal-action comparisons strip only the
new receipt/last-result fields and compare the remaining full actor, environment,
RNG and policy choice. They cover paid failure and interruption, runtime witness
identity/lifecycle, immediate work versus delayed beneficial and harmful sample
effects, old/new save reload, strict Ozark persistence and existing bounded
receipt/experiment retirement. These are focused contract tests, not a survival
or action-selection benchmark.

This API is a foundation for inspecting alternatives on the same observed state.
Any future selector needs a separate reviewed contract, explicit safety vetoes,
comparable firsthand cost/outcome estimates, uncertainty and forgetting rules,
entry-path integration tests and declared behavioral acceptance windows before
it can influence actions. Passing noninterference tests here is not acceptance
of such a selector.
