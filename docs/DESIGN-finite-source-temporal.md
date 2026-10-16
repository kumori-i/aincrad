# Finite-source temporal policy: capacity-constrained preregistration

Status: proposed; design review precedes runtime changes and autonomous trials.
This separate research branch starts from the reviewed PR #7 tree at
`ae1b453b2e182b112a13fb789c15a805b53953fc`. PR #7's 4,096-row/8-MiB targets and
failed responsiveness gates remain unchanged. PR #8's save-worker experiment is
not included. Main remains `3db83047c96158b39214b3f5a68ed5929ad1f40d`.

## Question and scope

Can the reviewed observed-trajectory return model, in a small physical setting,
learn to continue acquisition into cautious sampling and delayed benefit better
than the same architecture without parameter updates or temporal propagation?
This is a cold-start, capacity-constrained experiment, not a transfer, survival,
whole-valley, emotion, or optimal-control claim. No further reward/ranking patch
is added. All successful and failed trials will be retained.

Use a headless, evaluator-owned driver around the real NPC/environment/ecology
APIs. The default application does not instantiate it. Its non-food care and
ordinary action eligibility come from the existing discovery decision code. A
narrow optional ordinary-choice interface exposes the already constructed
eligible candidates; the absent-option path keeps its exact legacy behavior,
ordering, RNG use, and history retention. Main's controller is a separate
reference, not the causal learning control. The experimental driver has no LLM,
human suggestions, second actor, social messages, or Cardinal interventions.
Those integrations are out of scope rather than silently credited as covered.

## Shared physical opportunity and masks

All three learning arms use the same candidate construction, observations,
non-food care, clocks, and `foodLearning:false`. This disables the old two-step
positive routines, supported-held repeat bypass, and urgent learned-food care;
it retains exact-item harm aversion, pending-sample caution, fullness and
capacity/reach constraints, failed-action cooldowns, perception and navigation.
No helpful-operation mask or species/edibility dictionary is introduced.

Ordinary choices include every currently eligible existing primitive, existing
observed-route moves, and a real five-second wait. Existing observed-route
construction may nominate only a subset of observed destinations; this remains
an engineered opportunity constraint, shared across arms. The chosen action's
own predicted value competes directly with movement/wait. There is no unrelated
legacy-score sponsor or second novelty threshold. Non-food care bypasses the
learner's competition but its actual submission still closes/opens a ledger
interval. An unreachable or exhausted source receives no oracle repair.

The driver reuses the shared PopulationRuntime environment/ecology/harm/wake step
with one explicitly selected actor and dialogue disabled in every arm. No second
body is inserted on restore. It observes on the existing one-second schedule, uses native 1/60-second
steps, and advances the shared environment/ecology once per step. It respects
real active actions, actual completion/cancellation, sleep/collapse and the
existing next-decision schedule (including the 0.65-second refusal delay).
Contact-driven interruption uses the same existing observed-contact care path.
No free observation is added between every primitive beyond existing action
observations and that schedule. No command is resubmitted to manufacture a
completed receipt. Driver parity with the ordinary controller, using its legacy
chooser and the same disabled dialogue, is required on an eventful finite trace
before interpreting results, including cognition and condition-event cadence.

## Public state, bindings, and choice

Use the canonical version-1 context/key described in
`DESIGN-temporal-learning.md`, without new features:

- qualitative body/thermal/shelter bands and held-count band;
- the candidate's actually observed, allowlisted appearance and count band;
- held/reach/route relation, current focus and observed-output-of-focus relation;
- last two personally completed target/lineage primitive-outcome classes and
  actual completed-work count band;
- bounded recent personal exposure age/channel-count bands and censoring flag.

Coordinates, object IDs, event IDs, ingestion IDs, source species, exact reserves,
calories, mass, hidden gut contents and health are absent from prediction keys.
Opaque IDs are allowed only for actual requests, exact safety and relational
binding/provenance. Renaming every opaque ID while preserving those relations
must leave keys and corresponding choices invariant. Movement has route relation
and an unknown appearance unless it approaches a genuinely observed bound object;
no terrain coordinate or hidden destination category is inserted. Wait uses an
explicit empty/unknown target projection, not the last inspected object's value.

Recent target history is derived from canonical personally observed receipts,
not world state. The binding rules are directed and at most one hop:

- A successful pull/grasp result with materialId different from targetId proves
  target -> material. A successful grasp of the same material is an acquisition
  of that exact item, not a self-edge or evidence of its former source.
- For a material, use its latest successful acquisition receipt before the
  relevant time. A later release/regrasp replaces the older source association;
  it cannot resurrect or attribute a later swallow to an earlier detached source.
- Candidate history/work includes completed requests targeting that exact item
  plus its one latest producing acquisition receipt, if there is a retained
  distinct-parent edge. Sort by receipt sequence, deduplicate the acquisition,
  take the last two outcome classes and band the retained positive-work count.
  Do not include other operations on its parent or descendants. Source history
  is therefore its own requests, not an aggregation of its children's samples.
- Exposure is 'own' for exact sampled material. It is also 'own' for a candidate
  source only when the sample's latest prior acquisition proves that candidate
  directly produced the sampled item. Sibling materials never inherit each
  other's 'own' exposure. All other retained exposures are 'other'. This is a
  prediction context, not a generalization of exact-item safety eligibility.
- A successful acquisition on the focused target that produces a distinct
  observed material transfers focus to that material; no other operation
  transfers it. Retain that acquisition sequence as the one-hop proof and
  preserve the original focus start/deadline and already consumed eight-submission
  budget. outputOfFocus is true only for that output while
  this proof survives. Later regrasp ends the producing relationship. Loss of
  the transfer proof ends the transferred focus; it cannot be rebuilt by IDs.
- Eviction of a required acquisition/sample receipt removes the relationship and
  marks history censored. No ancestry is inferred from ID values, naming, nearby
  objects, or hidden ecology. A death-created carcass discovered by scanning
  world IDs is not an attributable output.

Exposure summaries use the most recent 24 retained successful personal swallow
receipts, including reports already received; early benefit does not declare
later harm impossible. A missing public object count remains unknown, never 2+.
Expected-key fixtures must cover exact item, source, sibling, release/regrasp,
proof expiry, missing count and opaque renaming. Counts describe retained
personally observed work, not an uncensored lifetime total or hidden progress.

Keep the prior scaffold: focus is selected uniformly from currently observed,
held or in-reach objects, lasts at most eight ordinary submissions or 30 elapsed
seconds, and follows an acquisition output only by the exact rule above. Release,
departure beyond observed reach, disappearance, care interruption or timeout ends
it. Focus is a tie preference, never an operation recipe or mandatory action.

At each ordinary submission, with epsilon=0.2 choose a primitive group uniformly
and then a candidate uniformly; otherwise maximize U among visited known rows.
If none are known, use that same group-uniform sampler. Unknown/capacity-refused
contexts do not win exploitation as synthetic zero-value rows. Exact U ties
prefer a focus-related candidate, then a uniform tie draw. Release, wait and
movement remain eligible even within focus. Exploration can interrupt a useful
sequence; that is part of this fixed hypothesis.

The experimental ordinary candidate builder is a transaction: build once from
the current observed snapshot with a local copy of the existing NPC opportunity
RNG; retain the exact candidate order, scores, routes and resulting RNG. Bind
that proposal to the actor clock, starting RNG and submission sequence. Commit
the resulting opportunity RNG exactly once only when submitting its selected
action. Do not rebuild routes, rescore, or consume draws for owner diagnostics.
A stale/duplicate commit fails the trial; it never silently selects again. The
absent experimental option retains the original builder path. Repeated policy
proposals operate on the immutable candidate snapshot, not repeated calls to the
existing impure discovery decision function.

Use a separate saved 32-bit selector RNG, never the NPC/world RNG. Consume exactly
four draws per actual ordinary submission: focus nomination, epsilon, group/tie,
and within-group candidate. Draw unused slots too. Forced care consumes no
ordinary-selection draws and terminates focus. Construct proposals without
mutating RNG, focus, visits, capacity or replay; commit one selected proposal only
when its actual request is submitted. Repeated diagnostic calls are inert.
Different arms may take different numbers of decisions as behavior diverges;
matching means the same per-decision schedule/initial stream, not identical
wall-clock trajectories. Save and reopen preserve phase and next draws.

## Return, update and attribution

The five channels, exact-once biological ledger, 300-second discount half-life,
alpha=0.2 and eight deterministic backward sweeps are unchanged from PR #7.
Food F is sustained feedback, water W is actual reported relief, harm H is
reported discomfort, T is actual elapsed minutes, and E is ordinal interaction
work integrated over actual worked time. Movement has no new exertion sensor;
it incurs T and its existing physiological cost, which is measured only by the
evaluator. Do not claim complete learned physical-effort valuation.

U = wF*QF + wW*QW - 4*QH - .02*QT - .02*QE.
wF is .5/content, 1/peckish, 2/stronger hunger; wW is .5/quenched,
1/dry mouth, 2/stronger thirst. These weights, epsilon, focus, state abstraction
and replay budget are engineering choices, not learned affect or neural weights.

Every biological channel is owned once at its original engine event time.
Acquisition and sampling receive no immediate bonus or second retroactive reward.
The ledger captures newly emitted feedback after every native body tick, including
sleep, before another submission. Exact action-result receipts are captured
before later actions can overwrite the result. Events at the same timestamp use
the existing authoritative ordering. Within a native NPC tick biology emits
feedback before the active action is completed, so the adapter admits those
feedback messages before that completion receipt; an immediate new refusal is
captured after its own submission. Feedback predating the first submission is
unowned. No environmental/weather or unrelated bodily-band change becomes food
reward. Returns predict experienced continuation, not proven causal effects;
the existing old-meal counterexample remains a required diagnostic.

At an actual decision boundary, first flush preceding completion and biological
feedback and perform the scheduled observation; only then construct the immutable
pre-action candidate/context snapshot. No asynchronous work occurs between
proposal and submission. Recheck clock, epoch, starting RNG, idle/awake state and
submission sequence. Apply the same pure cognitiveAction normalization/mask as
NpcController.perform, then invoke the authoritative request with that captured
normalized action. A genuinely invalid proposal fails this experiment rather
than silently substituting a different learner action.
Require either the matching active action or a newly recorded authoritative
immediate outcome. Only then commit the saved opportunity RNG/four selector draws
and focus, begin the ledger interval at the captured unchanged simulation time,
capture an immediate outcome, and run one eight-sweep update. The new choice uses
the table before this update. The supported request set emits no sampled
biological feedback synchronously during submission; test that contract. If that
changes, buffer and order such feedback after the new submission instead of
silently assigning it backward.

An expected authoritative enter_shelter/exit_shelter scene/epoch change after
submission is valid and is recorded as that actual care outcome; it is distinct
from a stale epoch before submission. Test both care scene changes and immediate
refusals through the real normalization path.

A busy/asleep/pre-submission guard without an actual action event commits no
phase, RNG, replay successor or update. An unexpected request mutation, exception,
wrong action or concurrent clock advance invalidates and stops the trial with
its original evidence; do not attempt a physiological rollback or report it as a
normal refusal. Immediate authoritative refusals have zero work; elapsed
scheduler time remains real. Open intervals, evaluator stops, collapse and
recovery are continuing/censored, never zero-return terminals.

## Explicit small capacity and checkpoint contract

Named experiment profile `finite-temporal-v1`:

- 256 durable context/action value rows; never evict or reset them;
- 128 recent completed replay intervals;
- 512 admitted canonical context keys, also bounded to 256 KiB of their actual
  UTF-8 JSON dictionary representation;
- 384 canonical submission/outcome receipts, 64 ingestion/channel proofs,
  128 biological event payloads, one open interval;
- existing monotone submission/source cursors and exact-once channel masks;
- at most 24 exposure summaries and two target-history outcomes used in a key.

These are explicit experimental caps, not replacements for PR #7 defaults.
Core admission/eviction functions may accept a validated runtime profile, with
the existing default unchanged. All paths, including rows created for an actual
successor, respect that profile. Capacity loss remains unknown/censored; it never
aliases keys, forgets a negative row into optimistic exploitation, invents a
terminal, or resets ingestion credit. Dependency eviction censors both closed
and open replay exactly as in the reviewed core. Retained admitted keys/rows
remain usable after saturation. Candidate lookup and encoding spend no capacity.

A versioned experiment checkpoint envelope contains the exact named profile,
arm, selector state/focus, driver observation schedule, source fingerprints and
canonical single-actor/environment payload. It is not an application save
replacement: the full-game validateSave always reconstructs both canonical
characters, so this envelope instead uses the existing validateNpc and
validateEnvironment contracts and temporal wire codec directly. Restore
checks the raw envelope profile, all nested array cardinalities and encoded-key
UTF-8 bytes against the smaller caps BEFORE invoking permissive default
validators. It then validates that actor/environment/ledger normally, rechecks
the canonical result, and reapplies the profile before any update or choice.
An oversized raw history cannot become admissible merely because normalization
drops or slices it. No truncation is used to make the checkpoint fit. A
missing/unknown profile, oversized checkpoint, invalid focus or conflicting
source/arm metadata fails the experiment restore; it must not silently run with
large defaults or delete learning. No profile is inferred from current lengths.
The original input bytes are retained on failure. The experimental envelope is not accepted by the production save reader and
cannot enable this headless policy. The profile and selector state
stay in the experiment envelope rather than a new application schema.

Actual interrupted-command restoration follows the existing game's contract;
no unfinished command is claimed completed by the learner. A missing completion
censors work credit while keeping true feedback chronology. Test exact continuation
at an idle pre-feedback checkpoint and explicit interrupted-active/rest behavior
separately, without claiming they are identical situations. The driver censors an
unfinished restored interval while preserving its receipt and consuming later
feedback channels at their real times; no reward is assigned to that unowned
interval. Existing environment validation omits animal feelings.relief, a transient
signal that the animal policy does not read. World-continuation tests explicitly
exclude only that pre-existing normalization while requiring every other world
field and complete actor physiology/ledger to agree at the idle checkpoint.

## Gates and fixed development protocol

1. Before autonomy, pass: no-work/canceled-work sensors; exact ledger/return math;
   old-meal confounding diagnostic; opaque-ID renaming; all-known/unknown and
   saturation choices; repeat-proposal/commit-once RNG; forced care and sleeping
   feedback ownership; >400 decisions, proof eviction and reopen; unknown-context
   gaps; malformed/future history; no default game/controller change.
2. Measure actual full encoded actor bytes (ordinary memory + model + dictionary
   + receipts/replay/proofs + envelope policy state), whole-world save bytes,
   heap/RSS and decision timings on this cloud CPU. Gate before trials: full actor
   <=1 MiB, total newly added per-decision work p95 <=5 ms over >=200 warmed
   submissions. That timed boundary includes public projection/context/keys,
   candidate value lookup, proposal/selection, profile admission, receipt/feedback
   bookkeeping and training; report existing legacy candidate/route construction
   separately and also report combined decision latency. Capture per-tick sensor
   overhead separately so work cannot be hidden outside the decision timer. Record
   ordinary synchronous save/frame-gap timing against paired baseline.
   Report max/tails and generation/validation separately; no laptop or smooth-frame
   claim. The 1-MiB gate is a measured admission to this experiment, not a proven
   bound on every future ordinary NPC memory. During trials, measure after each
   actual submission, every 15 seconds, and at the stop; label the maximum a
   sampled peak, not a per-tick bound. Any measured crossing fails the capacity
   gate and is retained, not silently trimmed/restarted.
   Before the first episode, add this conservative progression check: the actual
   episode's recorded added-decision p95 must also be <=5 ms, using all observed
   decisions including cold samples and owner trace-sink overhead. Report that
   overhead and the actual sample count separately; do not subtract an average
   sink cost. A quiet or care-heavy episode need not contain 200 decisions and
   must never be padded with extra activity. The >=200 warmed samples remain
   the separate pre-trial benchmark gate. An episode timing miss blocks cohort
   progression but does not stop its fixed physical horizon or erase outcomes.
   This is not an uninstrumented renderer or laptop responsiveness claim.
3. Tiny plain physical trial: default discovery body, unmodified finite source
   and initial resources, one actor placed on a valid reachable point 45 units
   from the first existing fruit source in development world seed 74193, using
   the first collision-valid direction in fixed east/west/north/south order. The
   fixture selector may use engine identity only to establish initial conditions;
   neither it nor expected actions enter policy inputs. Record source/body/world
   hashes, initial energy/water/material ledgers and every request/receipt/event.
   No scripted acquisition, taste, handoff, nutrition or safety label. Other
   existing nearby objects and observed routes remain available. Run 600 real
   seconds at native step with selector seed 1729, all three arms. This is a
   feasibility trace, not a selected best seed. A failed acquisition or delayed
   benefit stays a failure/right-censored result, never an excuse to supply food.
4. Only if correctness, budget and at least one online-arm unassisted acquisition -> sample
   -> same-ingestion sustained-F feedback are observed, run the fixed small development cohort:
   same physical seed, the first two distinct collision-valid 45-unit approaches
   in fixed east/west/north/south order; abort the fixture if fewer than two are
   valid, never search based on outcomes. Use selector seeds
   1729/8191/65537, 900 real seconds each, three arms = 18 trials. Each is a separate
   explicit cold-start copied-world episode with recorded initial stores. No
   survivor reset, free replenishment or training carried across episodes.

Arms: `online` uses actual-successor returns; `no-bootstrap` uses each interval's
own R only, with the same update schedule and eight sweeps; `frozen-zero` preserves
zero Q while retaining identical evidence admission, visits, sensors, masks,
capacity and exploration schedules. Frozen-zero still learns ordinary aversion
and experiences all real feedback. Its parameter-work omission is reported in
CPU measurements. Main reference uses the original controller and is labeled a
separate architecture comparison; it cannot establish temporal-credit causality.

Report completion counts and right-censored acquisition-to-first-sample and
sample-to-F/W latencies, each channel separately; exact held releases before any
sample, releases after harm, repeated valid samples, work/time by primitive,
source depletion, real rest/sleep/collapse, health/reserves/water deficit, and
swallowed/pending/absorbed/spent energy separately. Report saturation/censoring,
known/unknown choice fractions, exposure counts and useful operation diversity.
Inspect neither action-count reductions nor intake/spending ratio alone as a win.

The primary completion count is distinct physical material IDs with their first
personally completed acquisition (pull/grasp) -> successful swallow -> matching
same-ingestion sustained-F event. Count a physical item at most once, even after
release/regrasp or further portions. Report W chains and additional beneficial
portions separately. Derive these chains from actual engine receipts and feedback,
not independentMeals/foodDiscoveries, whose positive update is disabled here.

A promising development result requires online's primary count to exceed each
control's count on at least four of six matched starts. Its pooled absorbed-kcal
increment over all six must be no lower than either control's (1e-6 numerical
tolerance). In every matched pair, online must have no extra collapse, no larger
count of distinct ingestions producing discomfort, and no lower minimum health
(1e-6 tolerance) than either control. Report accumulated gross injury from all
physiology/contact sources, separately count actual CONTACT_INJURY events, and
retain all reserve/health trajectories even when these gates pass. Existing
contact-event receipts do not expose exact contact-only damage amounts. These are deliberately
small development decision gates, not statistical proof or a claim that observed
feedback measures all physical harm. Report effect sizes and every pair. If the
gates fail, stop the larger sweep and diagnose state coverage/temporal
continuation before adding rewards or tuning these seeds.

Only after the plain fixture passes, preregister a separate finite distractor /
delayed-toxic-lookalike assay using existing physical materials, with all initial
alterations disclosed. It must test beneficial release and harmful surprise,
including earlier nourishment followed by later discomfort. No transfer or safe
reuse claim before that test. Fresh world seeds 104729, 130363, 15485863 and
32452843 remain reserved and unused by this development protocol. Any changed
abstraction, budget or constants require a new preregistration before those
held-out trials. No main merge or default enabling follows merely from unit tests.
