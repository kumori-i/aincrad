# Event-driven temporal outcome learning: proposed preregistration

Status: design under adversarial review. No runtime implementation or training
runs yet. This branch starts at stable main
`3db83047c96158b39214b3f5a68ed5929ad1f40d`. Rejected research PRs #5 and #6 remain
unchanged drafts. No default promotion is implied by this design.

## Question and boundaries

Can a small learner assign value to an observed intermediate state, so that
personally acquired material is sometimes investigated and retained when that
leads to benefit, and released or left when it does not? This tests learned
continuation, not a supplied acquire/sample recipe or another cost-ratio score.
No action gets reward for being accepted, acquiring, sampling, inspecting,
novelty, completing a sequence, or changing an observation.

Keep engine physics, finite stock, clocks, native timestep, sensations, current
reach/held/capacity/fullness constraints, failure cooldowns, exact-item aversion
and non-food emergency care unchanged. The first
candidate is an explicit evaluator/runtime option, off by default. It replaces
only ordinary experimental action selection in its arm, including competition
with already constructed observed-route moves. It does not inherit either failed
chooser. Existing exact two-step learned routines remain outside this first
experiment's ordinary chooser; all learning arms use `foodLearning:false` for
those positive routine shortcuts while retaining actual aversion, perception,
navigation and non-food bodily care. This also disables the supported-held
repeat-wait bypass and urgent/depleted learned-food branches; it is a disclosed
shared architecture ablation, not a claim that all food-care behavior is unchanged. Main is reported separately with its ordinary rules.
The architecture comparisons, not main versus candidate alone, identify temporal
learning's contribution.

Minimal additive worked-exertion feedback may be ported from the reviewed research
instrumentation. It reports light/moderate/strenuous only after actual work, with
no label on zero-work refusal. Fixed-action physical equality must be rerun.
No ecology species, nutrition, mass, health, exact bodily reserves, hidden future
state, IDs as numerical features, or test-oracle labels enter this learner.

## Observation and action abstraction (version 1)

Use only snapshots actually available at decision time. A sparse key contains:

- Qualitative hunger, thirst, energy, stamina, fatigue, pain and digestion labels;
  sensed warmth and shelter; held count 0..4.
- Candidate target's observed shape, color, texture, motion, size and smell, each
  bounded by the existing sensory allowlist. Missing stays unknown. No invented
  food/plant/animal categories and no semantic dictionary.
- Target relation: held, in reach, or observed route destination; whether it is
  the current focus or an actually observed output of that focus. Opaque IDs bind
  these relations and provenance only; arbitrary renaming must preserve keys.
- Last two personally completed primitive/outcome classes concerning this target
  or its observed acquisition lineage. Classes are success, physical failure,
  refused, canceled, or unknown; unknown is not no-effect evidence. Also retain
  personally completed work-count bands 0, 1, 2..3, 4..7, 8..15, 16+ on this
  still-bound target. These are remembered attempts, not hidden progress.
- Recent personal exposure counts 0, 1, or 2+ in each age band <45, 45..180,
  180..600, >600 seconds, separately for this target/lineage and other targets;
  include which F/W/H channels have actually been reported for each retained
  exposure (up to 24, with an explicit older-history-censored flag). Presence of old
  digestion must distinguish an unrelated action from an action that caused it.
  An early water or food report does not remove an exposure: later benefit or
  harm may still arrive. This is recent exposure history, not a claim about
  current hidden gut contents. There is no 'safe after waiting' or terminal
  zero-reward label; eviction is explicitly forgetting, not resolution.
- Public coarse count band absent/0/1/2+ when observed. It never supplies grams.

Action key is the primitive or observed-route move/wait plus that candidate
context. All eligible candidates retain their actual request and a separate
opaque binding. Two visibly identical candidates can share predictions while
retaining separate actual safety/provenance constraints. Table generalization is
an experimental prediction, never permission to bypass exact-item aversion.

Use the existing observed movement construction without its legacy score as a
second gate. Wait is a real five-second alternative. Log all candidates and
exclusion reasons in owner diagnostics, never in the agent observation. Emergency
care can interrupt focus and policy; its real elapsed transition remains visible
so the learner cannot pretend its experiment continued uninterrupted.

## One reward ledger, at the time feedback happens

There are five nonnegative channels: sustained food feedback F, water-relief
feedback W, discomfort feedback H, elapsed time T, and felt motor work E.

F/W/H events are generated only when the existing biology/discovery sensor reports
that experienced outcome. F means effect='sustained'; W means thirst='easing'
(including a combined sustained or discomfort message); H means
effect='discomfort'. Each unique ingestion/channel is entered exactly once,
at its actual event time. Exact ingestion/action links are an engineered
attribution sensor, not a claim that human interoception identifies causes this
precisely. A later positive channel never deletes H. No event is moved backward
to the sample, and no second reward is issued to acquisition. Provenance links
label association and pending-state history only. Replay changes predictions;
it does not emit another event or increase event totals.

Admission uses a persisted monotone cursor from the authoritative feedback
source sequence, plus per-ingestion F/W/H bitmasks. The cursor is bookkeeping,
never a state feature. A source event at or below that cursor is never admitted
again, even after its payload rotates out. Combined messages can add only unseen
channels for that ingestion. The source cursor advances on examination, including
rejected history; future-dated saved feedback is removed durably from the source
queue as well as learner history, without changing gut contents or body totals.
Invalid/missing source-order metadata disables new learner credit safely until
valid continuity is established; it does not reset past rows or reset the actor.

Keep at most 256 ingestion receipts/channel masks. If an old receipt must be
evicted, atomically censor/drop dependent replay segments, preserve durable Q,
and do not later re-create reward from an unproved late message for that old
exposure. Mark such messages as censored-credit events; actual sensory/safety
processing still receives them. Payload eviction never resets admission
eligibility. Test 257+ source events and re-presentation of the oldest, plus a
future record re-presented after elapsed time advances and another reopen.

Qualitative hunger changes, weather relief, rest, journal claims and simultaneous
unrelated actions do not create F/W/H. Unresolved ingestion is unresolved; absence
of feedback is not a proven lack of benefit. A zero-work refused command has zero
E. T follows actual shared elapsed time, including genuine scheduler waiting;
there is no fabricated command duration. E integrates the observed ordinal work
label (light=1/3, moderate=2/3, strenuous=1) over actually worked seconds, divided
by 60. T is elapsed seconds divided by 60. These ordinal/time scales are explicit
engineering choices, not measured subjective utility or physiological energy.

## Temporal prediction and choice equations

A transition starts at every actual submitted decision at t_i and ends at the
next actual submission at t_j, including forced care, dialogue and rejected
commands. It records the pre-context, selected candidate, actual successor
request/context, outcome and all ledger events in the half-open interval of authoritative
(time, sequence) pairs between those submissions. Forced care has
its actual singleton successor, never an unexecuted ordinary alternative. Full
choice lists/exclusions belong only to owner diagnostics, not the saved table. A diagnostic proposal alone creates no transition. At equal timestamps an event emitted before a new submission belongs to the
previous interval; a later event belongs to the new one. Each has one immutable
owner selected by authoritative sequence plus biological timestamp. A saved open interval includes that cursor and its events.
New biological feedback is captured at engine emission, including sleep, rather
than relabeled with a later wake/processing time. No completed action can absorb
a later care action as though the original action remained active.
For each channel c, the discounted interval return is:

R_i[c] = sum(exp(-beta*(t_event-t_i))*event[c])

Time/work are integrated over their actual intervals with the same discount.
beta = log(2)/300 real seconds, a preregistered five-minute half-life (two game
hours). This horizon is a design choice motivated by the current delayed digestion
timescale, not tuned to development or held-out outcomes.

This first hypothesis learns predictive total future return, not source-owned
causal action effects. An unrelated action spanning old-food relief can acquire
positive predicted return. Recent exposure context may separate that situation,
but does not prove causality; the old-meal matched control below is a hard gate.
Ingestion provenance alone does not resolve confounding.

Predictions Q_c(context,action) begin at zero and remain separate. Scalarization
occurs only for choice. Proposed fixed need weights:

- F: 0.5 while content, 1 peckish, 2 hungry/ravenous/faint.
- W: 0.5 quenched, 1 dry mouth, 2 thirsty/parched/desperate.
- H: -4 always; T: -0.02; E: -0.02.

U = w_F*Q_F + w_W*Q_W - 4*Q_H - .02*Q_T - .02*Q_E.

These weights are engineered priorities, not learned emotions or kcal estimates.
They may misalign with real energy balance; absolute physiology is an evaluator
outcome, not a hidden reward. Different current needs can change choice without
rewriting prior channel observations.

Use an actual-successor multi-step return, not a few low-rate one-step backups.
For each contiguous retained segment, initialize its tail from the predicted
vector of the actual submitted successor action. Compute backward:

G_i[c] = R_i[c] + exp(-beta*delta_i)*G_next[c].

The last G_next is Q(context_tail, actual_action_tail) from the previous sweep.
All channels use the same actual successor. This is a behavior-return predictor;
it does not maximize channels independently or claim an optimal/off-policy value.
A truly open interval is not trained. The completed prefix may bootstrap only
from a recorded actual next request, with explicit unknown-tail uncertainty if
that next request has no outcome data. An evaluator cutoff is never fabricated
as a zero-return terminal state.

For each row, average its observed G targets for that sweep, then apply
Q += 0.2*(mean(G)-Q) once. Thus the statistical update rate is applied once per
row, not multiplied once at every link of a delayed sequence. Eight deterministic
backward return sweeps update persistent predictions over retained evidence.
Each sweep reads one frozen prediction snapshot, calculates all G targets,
aggregates repeated context/action rows, and only then applies the updates.
No additional trace-decay parameter is used; the sole discount is the stated
300-second half-life. This is an
explicit bounded approximation under partial observation and changing behavior;
no convergence or policy-independent successor-feature guarantee is claimed.
The credit-disabled arm uses only its own R_i target, with the same evidence,
update count and budgets. Replay never adds reward-ledger events.

Before physical learning, verify a 32-distinct-state delayed-reward chain against
its analytical discounted target, including a quantitative error/choice check,
not merely Q>0. Verify exact interval-splitting invariance of ledger integrals and
discount products. Learned estimates can differ if added boundaries introduce
different bootstrap information; do not claim stronger invariance.

## Exploration, replay and persistence budget

Proposed exploration: at the start of a bounded focus episode choose an observed
reachable/held object uniformly by a separate saved learner RNG, retaining its
binding for at most 8 ordinary decisions or 30 seconds. An actual observed
acquisition output can become the same focus relation. This is a working-memory
scaffold, not a required operation sequence. Every ordinary decision still admits
release, move/leave and wait; actual release, departure, disappearance, timeout or
care interruption terminates focus. No outcome labels choose focus.

Within an episode use epsilon=0.2 uniform primitive-group exploration (then
uniform eligible candidate), otherwise maximize U among rows with actual observed visit counts, with independent
random ties. Unknown rows are admitted through the exploration channel; if all
rows are unknown, use the same uniform primitive-group sampler. Never let an
unlearnable row-cap overflow win exploitation forever with a synthetic zero.
A focus candidate wins exact U ties before other targets, not against a strictly
better alternative. The same focus/exploration rules and separate RNG budget run
in all learning controls. No promising result will justify tuning these constants
on the reserved validation contexts.

Keep at most 512 observed transitions, 256 deduplicated outcome events and 4096
context/action rows per actor. Perform at most 8 backward return sweeps after
each actual decision, at most 4096 record-target computations, with no imagined
world rollouts. Persist bounded per-row channel predictions, actual unique-visit
counts and update counts as learned parameters. Replay updates never increase
the actual experience count. These are learned predictions, not authenticated
proof of past achievement or authority to create food techniques. They are not
reinitialized when a replay record rotates out.

Keep a separate bounded canonical learner experience bundle for recent replay. It copies actual
submission/outcome snapshots, sensory context and qualitative feedback at the
engine event boundary. Its evidence does not depend on the shorter existing
400-action/160-experiment/64-effect stores or pin/displace those stores. Retain
required ingestion/action proof with each dependent reward, evict dependencies
atomically, and use exactly the same admission rules live and after restore. Recent replay forgetting limits further credit for evicted segments; it does
not reset their learned row values. This is still not an unlimited lifetime skill
model. Do not evict learned rows during this first experiment. On row-cap
exhaustion, new contexts remain
unknown rather than merging keys or fabricating value, with the exploration-only
fallback above. Replay eviction marks censored history and leaves durable predictions intact;
it must never turn negative evidence into a privileged zero-score exploitation
winner. Missing/corrupt saved rows are unknown and use the same fallback. Report saturation explicitly.

Restore allowlisted learned rows with finite nonnegative channel forecasts
clamped to the declared numerical guard 10000, bounded integer counts and
canonical public feature keys. A hit on this guard invalidates a usefulness claim
and is reported, not silently treated as confidence. Past row values are not
reconstructed from all lifetime evidence; this is an explicit persistence tradeoff.
Reject nonfinite, negative, future or unmatched recent outcome/action history durably.
Never retain future feedback in a queue that can resurrect it after restore. Keep
integer zero values. Reopen must preserve RNG, focus age/termination, reward cursor,
deduplication and update order. Commit focus/RNG/update phase once per actual
submitted decision, including refusals, never per diagnostic/proposal call.
Feedback preceding the first learner submission remains prior/unowned history,
not reward for the first future action. Collapse, recovery and evaluator stop
remain continuing/censored. Include a >400-decision reopen and mid-rest
feedback ownership check. Experimental memory must not displace existing
food/rest/safety proofs or alter default history retention. Measure actual heap,
serialized size and update latency; target <8 MiB and p95 <5 ms per actor decision
on this cloud CPU before discussing laptop suitability.

## Staged falsification, before any valley sweep

First deterministic model tests (including a unique-state chain longer than 8
transitions, interval-splitting invariance and all five channels sharing the same
bootstrap action) and tiny real-engine fixtures, using independent
isolated copied worlds with explicitly reported initial body/environment setup.
Copies are experiments, not reset live inhabitants or replenished live resources.
No agent receives the fixture's hidden identity or expected solution. Externally
scheduled action scripts can verify sensor/update mathematics only; their results
must not be reported as autonomous learning.

Required physical fixtures: beneficial delayed exposure; unhelpful material where
release/leave avoids work; delayed harmful surprise after earlier benefit; old
pending food relief during an unrelated operation; competing pending ingestions;
capacity/reach refusal, interruption/reopen; slow cumulative strike before any
visible effect. Verify finite stocks, real swallowed/pending/absorbed totals and
conservation at native timestep. No benefit is inferred from public unchangedness.

Then a preregistered small development comparison: main, common architecture with
updates frozen at zero, online TD, a learner-only reward-to-history permutation control,
and bootstrap-disabled TD. The permutation uses complete F/W/H discounted interval-return vectors, including
zero vectors, over retained completed records. A separate seeded Fisher-Yates
stream generates the training-view permutation after each completed transition;
T/E and every actual ledger event, time, safety memory and provenance remain
untouched. TD update count and timing stay identical. This intentionally destroys
reward/history association in the learner; its permuted training targets are
not a physical trajectory. Only already observed vectors may be permuted. Report the
fraction of vectors changed and nonzero vectors displaced. A singleton or an
identical-vector buffer is an ineffective control and cannot support a learning
claim. Do not call this an ingestion-identity shuffle. Include a shared learned-checkpoint frozen probe to separate
learning during evaluation from execution of already learned values. Frozen
controls still receive genuine exposure/safety state; only parameter updates
freeze. Neither control may read future records or alter the environment.

Gate: online must improve actual acquisition-to-experienced-benefit completion
and latency over frozen/credit-disabled controls without making beneficial
release or delayed-harm avoidance worse. Count absolute intake/absorption, spent
energy, reserves, water deficit, health, real rest and work; more actions, fewer
releases or an intake/spending ratio alone does not pass. Old-food confounding
must not manufacture a candidate-specific causal advantage: counterbalance
unrelated actual inspect/wait actions from matched pre-states with identical
old-ingestion feedback schedules, and compare the learned positive-channel
advantage separately from genuine time/work costs. A shared positive forecast
for both is allowed; a persistent unrelated-action preference is a failure. Record delayed-harm
latency and unsuccessful trials, including unavailable outcomes.

Exact episode counts, matched initial checkpoints and thresholds will be frozen
before autonomous development runs after feasibility/unit fixtures establish the
sensor protocol; no full valley cohort yet. Fresh-ID renaming, unseen sensory
combinations and similar-looking conflicting outcomes are reserved transfer
falsifiers after development passes. A failed small study stops runtime expansion.

## Storage admission clarification (before autonomous experiments)

The complete optional per-actor temporal wire object has a hard 8 MiB UTF-8
limit. This is neither a whole-world save limit nor a JavaScript heap claim.
The live ledger retains its version-1 string keys. Wire encoding
`temporal-key-dictionary-v1` interns them losslessly, after canonical save
validation; restoration decodes before validating proofs. Dictionary-bearing
world saves use top-level version 7, so older clients reject and preserve them.
Legacy raw temporal memories migrate only when their complete key union and
reserved future growth fit; otherwise load is protected and original bytes stay
untouched. Unsupported/corrupt references are not capacity-unknown experiences.

Admission reserves 2,097,152 bytes for all bounded non-key ledger/proof metadata
and 384 bytes for each of all 4,096 possible model rows, before counting keys.
Each admitted key consumes the actual UTF-8 byte length of its JSON string plus
one separator, including escaping. The dictionary also has a 32,768-entry
structural limit. These are engineered storage choices, not learning outcomes.
The reserve covers maximal numeric representations, full replay/receipt/event
caps, open state and proof growth. A final exact packed-byte check occurs before
any storage write; if the invariant fails, the write fails without replacing the
previous save. Neither serialization nor hypothetical candidate lookup admits a
context or changes learning, visits, phase or randomness.

Only a real submitted context can spend dictionary capacity. Admitted keys are
never discarded to make room, including keys no longer present in model rows or
recent proofs. Existing keys and learned forecasts remain updateable after
saturation. A new unadmitted context gets an explicit null-key, unknown-context
receipt with its true sequence, time, request, completion and swallow provenance.
It creates no learned row and both adjacent replay links are censored: known A,
unknown B, known C never becomes an invented A-to-C transition or zero terminal.
Submission and closure watermarks still advance. Biological feedback during B
consumes its source cursor and matched ingestion/channel at the actual event time
without learned reward; a genuinely new later channel can belong to a later known
interval. Ordinary physiological/safety handling is untouched. Overflow counters
are owner diagnostics, not agent features. This boundary must be tested through
reopen and future proof growth before autonomous evaluation.
