# Optional motor prediction: local engineering prototype

This branch adds a small CPU-only predictor and controlled tests. **The main
world does not import or run it.** Aster and Mira still use the existing
authored discovery selector. The prototype measures one narrower question:
can a model predict whether an already eligible optional physical operation
will complete successfully from this actor's own past paid results?

## Boundary

The core is a 12-input logistic model with zero weights, fixed learning rate
0.05 and global gradient norm cap 1. Seven inputs identify the motor primitive;
the others are bounded distance, observation age, own trial count, own failure
share and held-state values. Target ID locates the actor's observation and
trial records but never enters the numeric vector. Authored choice scores,
object type, nutrition, hidden identity, another actor's state and observer
labels are absent. There is no RNG, replay, persistence or background training.

The test-only caller freezes features before action admission. It trains once
only after the same actor's action has a matching completed action event,
matching discovery experiment and a fully paid result. Admission refusal,
incomplete work and priority cancellation are censored. The label is the
physical action's `ok` result. It is **not** food benefit, bodily relief or
survival reward. A successful `pull` can detach material that later proves
useless or harmful. The prototype ranker accepts only the current optional
choice list and abstains when cold, malformed or over its 64-choice cap. That
list is downstream of urgent safety, water, earned food and rest decisions;
it excludes later free-hand exploration. No production controller calls the
ranker or stores its model.

## Fixed engineering case

`tests/optional-motor-benchmark.test.mjs` uses seed 74193 and explicitly keeps
two existing ecology objects at a controlled reachable location. The actor
physically pays for grasp and pull on grass, then freezes predictions before
trying those operations on a different apple tree. The second source has a
different ID and object type, but this model has **no pixel features**. This
tests primitive-level motor prediction in one scene, not visual category
transfer. The test then clones the actor and world at one optional decision:
one branch follows the authored selector, the other temporarily invokes the
prototype hook. Each branch pays only for its own selected action. The
unselected action's outcome is unknown in either branch.

On the available Linux x64 test host, the frozen two-result holdout had Brier
scores 0.244 for the model, 0.250 for an unchanged 0.5 predictor, and 0.111
for a primitive-frequency prior. The tiny authored one-step comparison chose
`inspect_object` (1.8 paid seconds, 1.68 metabolized kcal including background
cost); the prototype chose `pull` (4.786 paid seconds, 10.857 metabolized kcal).
Both physical operations returned `ok`. This is a **negative deployment
signal**, not a survival improvement. Those are controlled action costs, not a
whole-game performance estimate or a calibrated population result. A separate
finite-stock case shows probabilities can fall after this actor's fully paid
pull failures, but it does not establish helpful reversal under bodily harm.

The model is session-only; there is no save/reopen retention. Its tests cover
numeric gradients, clipping, one-use paid receipt handling, cross-actor
isolation, holdout-before-update order, interruption censorship, bounded
ranking and urgent-care precedence. Native app behavior was not tested because
the prototype is not connected to the app. No ordinary or protected experiment
was run.

## Next evidence gate

A policy change would require an actor-owned runtime receipt handle, strict
save/lifecycle design, and a separately reviewed benchmark across held-out
worlds and actor trajectories. Compare learned, no-update, current-rule and
fixed/random controllers under identical **personally earned** histories.
Evaluate paid time and energy, delayed own bodily feedback, non-harmful
reversal and adverse outcomes separately. The current optional hook cannot
compare food with rest or free-hand motion; broadening it would require a
separate safety and authority review. None of those future controls is
presented as an observed result here.
