# Interoception trend development assay

This follows the negative optional-motor comparison and the test-only
[personal sensory window](OPTIONAL-SENSORY-VALUE-GATE.md). It asks whether a
finer, source-blind body trend can honestly become an action-value target.
Most controlled cases in `tests/optional-interoception-assay.test.mjs`
directly exercise physiology; a separate engineered case performs real paid
pull/sample actions. None is an ordinary trajectory or held-out performance
evaluation. The previous real paid pull/sample window remains separate
evidence. Production selection and learning are unchanged, and no new model
is trained.

## Candidate signals

| Candidate | What it can describe | Blocking limitation |
| --- | --- | --- |
| Existing hunger, thirst, energy and pain categories | Personally felt coarse state without source labels | Small food and harm effects remain below thresholds; the post-swallow baseline misses immediate satiety. |
| Time spent in better/worse categories | Duration of a categorical trend, with a fixed horizon and censored gaps | More samples cannot recover an effect hidden inside one category. A meal can look worse as its immediate fullness naturally decays. |
| Quantized or hysteretic projected energy change | Aggregate reserve trend with limited precision | Stored reserve mobilization raises projected energy without eating; exertion can reverse the sign after the same absorption. Hysteresis can reject brief boundary flicker but cannot establish food causality. |
| Existing `bodySignals.relief` or `DISCOVERY_EFFECT` | A qualitative engine-recognized response | Both are set from private per-item absorption or harm thresholds. Feeding either to a new independent value learner would reuse an authored food oracle. |
| Raw physiology or calorie difference against an unfed clone | Sensitive diagnostic accounting | Exact nutrients and a counterfactual the actor cannot perceive must remain evaluator-only. |

The test uses only the four ordinary `bodySignals` categories for its
source-blind sensory projection. Source IDs, feedback queues and legacy
`relief` can change without altering those categories. Exact calories,
absorption and health are read **only by assertions describing why a candidate
sensor fails**; they are never returned to an agent or used as training labels.

## Fixed controlled findings

The authored 30 g taste is one sixth of a 180 g apple. During 120 simulation
seconds, a matched no-intake body with low available energy gained 1.714
points of projected energy through reserve mobilization alone. The tasted body
gained 2.167 points while absorbing about 6.33 kcal. Both remained in the
same `low` energy category. A rule that calls any upward raw-energy trend
"food benefit" would therefore falsely credit the no-intake branch.

Swallowing immediately raised the tasted body's appetite category from
`hungry` to `peckish`, before absorption. Relative to that **post-swallow**
baseline, it later appeared worse at 350 of 1,200 sampled ticks as fullness
waned; the no-intake body stayed `hungry`. More detailed category dwell time
does not repair the missing pre-sample reference. Adding moderate effort to
the same taste reversed the projected energy trend from positive to negative
while absorption remained the same. This is a mixed-activity confound, not a
different food outcome.

A mildly harmful 30 g taste reduced actual health but never moved the `pain`
category from `none`. Its private digestion feedback reported discomfort;
using that tag as the new sensory target would violate this assay's boundary.
Two otherwise identical bodies initialized just 0.000002 satiety-hours apart
around a later category threshold ended in different hunger categories.
An isolated three-sample hysteresis rejects a one-tick flicker and keeps a
sustained crossing; a missing reading censors. It cannot reveal the mild harm
or separate mobilization from food absorption.

The existing physical physiology round-trips through validation; no trend or
pending sensory authority is saved. The preceding test-only window cancels
when its actor is copied or reopened. Its 120-second result is descriptive
and repeatable, not a one-use learner update.

## Physical and source-blind negative controls

The further controlled assay uses two actual funded `pull` then `sample`
actions on finite apple material. The fruit's toxicity and digestion duration
are authored only in the evaluator fixture before sampling; the actor does
not receive those fields. Both branches pay the same action time and have no
absorbed calories at sample completion. Over the next 120 simulation seconds,
the harmful branch loses aggregate health and receives a private digestion
`discomfort` record, yet all four candidate felt categories (hunger, thirst,
energy and pain) match the safe branch at every sampled tick. Pain remains
`none`. This demonstrates a missing *sensation*, not food safety or a failed
paid action. The private feedback record is an existing separate learning
path; it is not an independent bodily-sensation input.

The controls also show that an unrelated physical injury can lower aggregate
health with no intake and no pain-band crossing. Two concurrent tastes with
opposite source assignments produce the same source-blind body categories;
their private item-linked feedback differs. Timing and aggregate change alone
cannot assign either effect to a particular food. At fixed tick sizes of
0.05, 0.1, 0.2 and 0.25 seconds, internal mild harm develops while the felt
pain band stays unchanged. Repeated reads do not mutate the actor or append a
sensory history. A one-tick boundary flicker can be filtered by the earlier
three-sample check, and a missing observation censors that check. No candidate
threshold was fitted to the harmful taste; no new sensory state or learner
memory was installed. The 120-second bound describes this assay only, not a
guarantee that later harm will be absent.

These cases cover no intake, delayed digestion, mixed exertion, non-food
injury, a small toxic dose, tick granularity, category noise and multiple
sources. They are engineered controls, not a new ordinary-world cohort or
held-out proof of predictive usefulness. Internal health and per-item tags
are assertion-only diagnostics; the existing actor-local signal is the coarse
`bodySignals` projection.

## Decision

These controls do **not** support an action-value update or production sensor
change. A source-blind ordinal trend is safe as descriptive data but is not
informative enough for this small taste, and a raw energy trend is
confounded. The actor cannot observe the no-intake clone; that comparison
cannot become its label. No new rule, frequency or no-update value scores are
reported because there is no defensible new value target to score. The
earlier optional-motor Brier and physical-cost comparisons remain intact.

A later candidate needs a separately reviewed physiology and actor-local
sensor contract. Current `bodySignals.pain` reports `none` until health falls
to 90, so it contains no reliable below-band information about the small
damage demonstrated here. Reading exact internal health as a new felt value
would silently add high-resolution perception; selecting a threshold just
below this controlled dose would tune to it without a noise floor. A proposed
new aggregate somatic-change sensation would need prospective precision and
hysteresis, quantified healing and environmental noise, non-food-injury and
multiple-intake controls, delayed-effect windows, bounded session memory,
missing-observation censorship, and independent held-out validation. Even a
valid sensation would describe the actor's condition; it would not establish
which recent action caused it. No per-item toxicity, exact nutrients, source
identity, evaluator control or automatic credit to the latest food may enter
the sensation. The present batch therefore leaves production selection,
learning, physiology and saves unchanged.
