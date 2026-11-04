# Personal sensory outcome gate: local engineering prerequisite

The optional motor model in `src/optional-motor-core.js` predicts whether one
paid action physically completes. The held-out comparison in
[OPTIONAL-MOTOR-HELDOUT-RESULT.md](OPTIONAL-MOTOR-HELDOUT-RESULT.md) showed that
this is not food value: the model lost to a primitive-frequency prior and
selected a longer, more costly pull while the current rule inspected. Those
results remain negative evidence. Production choices are unchanged.

The existing actor-owned records support a **limited test-only** next step.
`tests/fixtures/optional-sensory-window.mjs` accepts original runtime action
objects only after a fully paid pull or grasp and a fully paid sample of its
linked material. The retained receipt, experiment and ingestion chain must
validate. The original sample can open one private window; copies, stale
attachments, other actors and occupied or ambiguous guts cannot. The output
contains only the two witnessed paid durations, rising/steady handling counts
and four bodily category-change bits. It never contains an object ID, food
kind, exact energy, water, toxicity, authored reward, or receipt ID. The gut
ingestion identity is used privately to **censor competing intake**; it is not
an agent sensory feature or a training target.

The window begins **after** the swallow and lasts 120 simulation seconds,
sampled at gaps of at most 0.25 seconds. It asks whether the actor personally
felt hunger, thirst or energy move to a better category, and whether pain
moved to a worse category, at any sampled point in that fixed interval. It waits for
the whole interval before revealing any bits, so early relief cannot suppress
later pain. Missing ticks, event retention gaps, later actions, another
ingestion, injury/rescue/assistance counters, non-body events, identity change and
cancelled observation censor the entire result. A zero means **no category
crossing observed during this interval**. It does not mean no calories, no
benefit, no harm after the interval, or causal attribution. Unlogged outside
interventions remain possible in an engineered fixture.

The after-swallow baseline deliberately misses immediate human satiety changes
on swallowing. A future full food-value target would require a separate
pre-sample frozen body snapshot bound to the original action, followed by the
same delayed harm window and one terminal settlement. This prototype does not
train a model or consume a one-use terminal result. Repeated reads after
settlement are descriptive only. Its measured paid duration omits approach,
waiting, basal expenditure and opportunity cost; `allInCost` remains unknown.

## Controlled evidence and limits

One authored real apple-tree geometry test performed a genuine paid pull and
sample. The two actions took 8.5 paid seconds and both had a rising handling
signal. The fixed 120-second window completed through 1,200 personally sampled
ticks with zero category crossings in all four channels. This is a **negative
coarse-sensor observation**, not a finding that the fruit lacked nutrients.
The same world, character, RNG and existing food-learning state matched a
clone without the shadow window. Separate engineered state perturbations
checked that a later pain rise remains visible after an earlier improvement;
they are not food evidence. Focused tests cover copied authority, competing
meals, delayed attachment, missed ticks, outside events and cancellation.

One local Node 24.19.0 Linux x86-64 run on an AMD EPYC 9V74 host measured about
4 ms total inside 1,200 window reads, excluding the physical simulation and
test setup. This is a noisy hosted CPU observation, not a desktop game
responsiveness claim. The fixture is session-only and is not imported by
runtime entrypoints or persisted.

## Next evaluation gate

No new action-value performance claim or ordinary cohort follows from this
fixture. Before fitting a value predictor, freeze a protocol with previously
untouched source/actor situations, a pre-action sensor snapshot, the same
fixed horizon and a private one-use terminal settlement. Censor unresolved
or interrupted episodes rather than assigning failure. Keep relief, worsening
and paid-time channels separate; any scalar tradeoff is an authored objective
and must be disclosed. Compare the frozen predictor with a no-update model,
actor-owned per-source frequency prior and the current rule on identical
pre-choice states, recording eligibility and all denominators. The present
optional selector sits after urgent care and earned-food priorities and lacks
visual food features. It cannot yet fairly replace a food technique choice or
support another-tree transfer. Seeds 74193, 51001 and 51002 are development
cases already seen and cannot become untouched evaluation.
