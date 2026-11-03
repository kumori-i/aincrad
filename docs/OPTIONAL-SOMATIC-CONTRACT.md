# Aggregate somatic signal: test-only contract

This design follows the negative [interoception assay](OPTIONAL-INTEROCEPTION-ASSAY.md).
It tests a possible *new* actor-local sensation. It does not add one to the
game, train an action value, change optional selection or alter saves. Existing
`bodySignals.pain` remains `none` above 90 health. Exact health is currently
private engine state, so allowing an actor to sense a smaller change would be
an authored capability requiring separate review.

## Physical source and candidate boundary

The only proposed physical input is a continuous series of the actor's own
**aggregate** health values, after all digestion, injury, deprivation,
exposure and healing have affected the body. The test-only probe binds one
actor object, physiology object and incarnation, takes time from that actor,
and reads no gut item, food ID, action result, feedback tag, relief score or
other actor. It freezes a starting level and reports `worsening` only after
three consecutive observations at least one resolution step below it for at
least **0.25 seconds**. This duration rule prevents faster observation rates
from making a three-sample crossing almost instantaneous. It
reports `unresolved` after a complete 120-second window without that crossing,
never `safe`. A missing observation, changed identity/body, or missed window
censors a pending probe. A single window uses constant-size private state and at most 7,201
samples. Readout is a defensive fixed-size status, with no numeric health or
source. This is **aggregate sensor fidelity**, not food credit or prediction.

Before evaluating the cases below, the resolution sweep is fixed at **0.05,
0.25 and 1 health point** on the existing 0–100 scale, with the fixed dwell
rule and maximum 0.25-second observation gaps. None is selected for
production. The 0.05-point option is deliberately sensitive and may report
small physical or perceptual variation. The simulation has no measured
somatic noise floor to validate that precision. The larger options can miss
small real harm. A detected non-food injury is a correct *body* observation,
not proof of food causality.

## Fixed evaluation cases

The test-only engineering set compares: no intake; matched taste with and
without exertion; delayed harmful tastes at toxicity 0.25 and 0.75 (held out
from the earlier toxicity-1 demonstration), digestion delays of 0.1 and 2
game hours, and starting health of 100 and 92; contact injury of 0.1 health
point; dehydration-driven damage; a small injury followed by natural healing;
two simultaneous foods with their source IDs exchanged; source metadata and
feedback changes with identical aggregate body state; one-tick jitter and
slow bounded drift; missed samples; actor copy/replacement simulating reopen.
This is not an actual save/load or native reopen test. The exact
health path is evaluator truth for these fixtures, not a learner target.
No favorable seed, resolution, dose or horizon is chosen from their outcomes.

Latency is measured from the first **net observed** aggregate health drop to the
first status change, and reported as engineering behavior only. A status can
remain `unresolved` after real below-threshold harm or after healing masks a
decline. A false crossing under synthetic drift is a design limit. Complete
silence is uncertainty, not a safe-food label. The existing qualitative
signals provide a conservative comparison: they do not resolve the small
development taste, but also do not create a new high-resolution body oracle.

## Controlled results and limits

All eight held-out combinations of starting health (100 or 92), digestion
duration (0.1 or 2 game hours), and toxicity (0.25 or 0.75) kept the existing
`pain` signal at `none`. The hypothetical 0.05-point probe reported aggregate
`worsening` only for the two faster 0.75-toxicity cases, first at 6.4 simulation
seconds; the first net observed health decrease occurred at 0.1 seconds.
The 0.25- and 1-point probes remained `unresolved` for every combination.
Some slow small-dose trajectories never had a net sampled health decline
because concurrent healing offset it. This is a failure to sense that damage,
not evidence that the item was safe. These timings are deterministic fixture
observations, not a calibrated sensory latency or human physiology claim.

No-intake, safe taste and the **same safe taste with exertion** produced no
health-worsening report. Contact injury and dehydration without any food
produced the sensitive probe's `worsening` report. A smaller contact injury
was followed by net healing and finished `unresolved`. Exchanging the source
IDs of overlapping foods, and changing private feedback metadata, left the
aggregate trace and readout identical. A one-tick artificial jitter was
filtered, while sustained artificial measurement drift created a false
crossing. Four sampling intervals from 0.01 to 0.25 seconds respected the
minimum dwell rule; missing observations, actor replacement, and the fixed
7,201-sample cap censored. The clone test simulates identity replacement and
does not establish actual save/load behavior.

This comparison supports **preserving uncertainty** as the current choice.
The fine probe detects some below-band change but would introduce unsupported
health precision and responds to unrelated harm and plausible drift. The
coarser probes miss the small effects. Existing `bodyRisk` also mixes numeric
health with other private needs in a prior cost path; it is not an independent
felt harm label for this candidate. No setting is selected, no safety or food
value score is derived, and no production sensor or save field is added.

## Production decision gate

The default is to preserve the current coarse sensations and existing
uncertainty. A production change would require a separately reviewed physical
transduction model with prospective precision and noise, non-food and mixed
cause validation, actor-owned lifecycle, and exact save compatibility. An
ephemeral pending window could be discarded on reopen; a persistent physical
somatic state would need a new strict save feature/version and explicit old
save migration without backfilling past pain or learner evidence. Neither
path may use per-item toxicity or absorption labels. Any eventual value learner
would need its own one-use paid-action authority and confound censors; this
sensor alone cannot assign a bodily change to a recent food or action.
