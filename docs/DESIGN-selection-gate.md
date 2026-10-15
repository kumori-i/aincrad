# Selection-consistent gate: bounded structural diagnostic

Status: development experiment, not approved for default play or merging to main.
The preceding experienced-selector policy failed its four-start study and remains
in draft PR #5. This branch retains that exact model and changes one arbitration
step. It does not introduce new reward, physiology, food knowledge, or movement
cost estimates.

## Hypothesis and intervention

The failed selector first lets the highest legacy-scored object beat movement,
then substitutes a different object using learned utility. An unexecuted sponsor
can therefore keep its novelty and open this gate repeatedly. This is a code-level
mechanism; it is absent from main, which executes its own legacy winner.

Build and descending-sort the same candidate array, in the same order, with the
same legacy random draws. If movement is already the legacy winner, keep it.
Otherwise call the unchanged object selector exactly once. Recover its nominee's
original candidate by action-object identity, not primitive, target alone, or the
selector's overwritten score. The highest existing movement wins only when its
legacy score is strictly greater than the nominee's original legacy score.
Ties retain the nominee. No movement is reconstructed or rescored. With no
movement, the original nominee is kept.

This tests consistency of the legacy object/movement boundary, not learned
movement valuation or a unified score. The empirical model, benefit/cost weights,
uncertainty, primitive nomination schedule, candidate order and saved selector
random stream are unchanged. Two selector draws and one phase advance occur per
nomination, including movement vetoes. One-in-eight refers to nomination
opportunities, not guaranteed executed object exploration. A veto can delay a
useful familiar action whose legacy novelty score is low; that is a falsifier.
All care, known food, exact-item safety, pending ingestion and failure gates retain
their existing precedence.

## Diagnostics and invariants

An explicit developer callback receives copied, out-of-band choice records:
sponsor, nominee, best existing movement, chosen winner, original legacy scores,
returned pre-increment learned score/details and a session-local decision ID.
Controller request/start and authoritative completion records link that ID to the
actual request and experience action ID, including rejection/cancellation. Runtime
assertions check that the request carries the winner's own score. The callback
must not re-enter policy or mutate the actor; callback exceptions disable that observer and are recorded out of band so the
physical engine continues. The evaluator must fail an incomplete trace explicitly. No callback is installed by ordinary play.

Diagnostics do not enter observations, experience, journal, saves, estimates or
actor random streams. Repeated proposal calls alone are not physical execution.
Session IDs reset when a diagnostic observer is installed and must be paired with
the run identity. Save/reopen must explicitly restore the experimental runtime
mode (a WeakMap option, deliberately not saved). Ecology seeds do not independently
reseed the selector, which starts with its documented zero seed.

Required checks: exact action identity with same-primitive different targets;
strict comparisons/ties; stable movement ties; original movement and no-movement
bypasses; unchanged candidate order/random draws; exactly two selector draws when
invoked; trace-on/off full-state equality; real controller request and completion;
no learning from unexecuted nominees; immediate rejection/cancellation; reopen
following a veto with no cost records and at phase seven/capped choice count;
care/food bypasses; productive repeated actions and real slow strike prerequisites.

## Predeclared development and held-out gates

Three arms use separate source roots:

1. Merged main 3db83047c96158b39214b3f5a68ed5929ad1f40d, legacy policy.
2. Exact failed source aceae25296ec9fdd807a0b17862e6678c14c8f96, original online
   experienced selector. "Frozen source" does not mean frozen learned estimates.
3. This source, corrected gate with the same online model.

Only arms 2 versus 3 isolate this gate. Main versus candidate also includes the
preceding experimental model, instrumentation and history retention differences.
Each world uses the same physical initial state, native 1/60-second timestep,
finite resources and 3,600 seconds (24 game hours), without assistance or resets.
Start with development seed 74193 at pond:north and lake:west:2. Report actual
absorbed/swallowed/pending energy, spending, reserves, water deficit, health,
useful acquisitions/arrivals, first sustained food-feedback latency, skill evidence and
actual rest/sleep. Fewer inspections, more movement or a better calorie ratio
alone is not success. Require conservation, no hidden observation leakage and
no new unmatched safety regression. If this development comparison does not
improve absolute behavior, stop and preserve the negative result instead of
running a broad seed sweep.

If development supports the hypothesis, reserve fresh seeds 104729, 130363,
15485863 and 32452843 at both starts before any tuning. Frozen/shuffled causal
controls and further independent review are required before claiming useful
learning or considering main promotion. A null result is acceptable. No
inspection blacklist, saturation model, reward rewrite or threshold tuning is
part of this experiment.
