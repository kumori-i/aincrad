# Local character-message numeric core checkpoint

This checkpoint adds an **unintegrated** numeric learner. The main Ozark world,
current symbols, saves, renderer, physical transaction, and user conversation
remain on the previously merged behavior. No model checkpoint or English text
is loaded. There is no remote branch or PR for this work yet.

## Exact base and scope

The isolated checkout began from main commit
`c3531d221acbb6a3613499949b91b134251c679b`, tree
`71dd8e04a9af9db12be5ed7eff5ba7f9248cc19c`. A clean HEAD build yielded
renderer fingerprint
`b15f2ac26d879d2efeb1cef97df9b9c7e8d9c9c0efacd2cf51639753f467a172`.
The only implementation module is `src/character-message-core.js`; its focused
acceptance tests are `tests/character-message-core.test.mjs`. Neither imports
world state, object IDs, critic outcomes, Canvas, a model service, nor a language
corpus.

Visible messages contain one to six lowercase `a`–`z` letters. The sender's
initial hidden state is its implicit BOS state; EOS is eligible only after the
first letter. A sixth sampled letter ends the message at the cap, without an
additional EOS decision. The sender has 1,931 Float64 parameters: a 48-to-16
visual initializer, a 16-unit recurrent transition with letter embeddings, and
27-token output logits. The listener has 1,472 Float64 parameters: a 16-unit
letter recurrence from zero state and a shared 48-to-16 candidate visual
projection. It scores two candidates by `dot(message, candidate) / 4`. A
private adapter must supply the per-partner demonstration gate; when false,
`listenerDistribution` and `sampleListener` choose with exact `[0.5, 0.5]`
probabilities despite random weights. There are no partner slots or word entries
in either model.

Model initialization uses small seeded weights and zero biases. Five eligible
stopping decisions each have an initial EOS chance near 1/27, so approximately
`(26/27)^5 = 83%` of initial messages should reach six letters. This is an
engineering expectation, not a measured vocabulary or learned structure.

## Numeric APIs

| API | Contract |
| --- | --- |
| `createSenderParameters`, `createListenerParameters` | Independent deterministic weights; explicit seed and individual numeric identity. |
| `initialCharacterRandomState`, `nextCharacterRandom` | Explicit uint32 continuation points for separate initialization, sender sampling, listener choice, and listener replay purposes. The four existing reference streams are untouched. |
| `sampleSender`, `senderNextTokenDistribution`, `senderLogProbability`, `senderGradient`, `trainSender` | Sample actual letters and optional EOS; compute a frozen-trajectory REINFORCE gradient and one SGD update from only observed `+1`/`-1` sender-local feedback and the prior baseline. A censor is not a valid reward. |
| `listenerDistribution`, `sampleListener`, `listenerCrossEntropy`, `listenerGradient`, `trainListenerBatch` | Uniform untrained choice; then candidate scoring and averaged cross-entropy SGD over one to four supplied own-view examples. |
| `classifyOwnDemonstration`, `samplePriorExampleIndices` | An optional label only if exactly one original own candidate is within RMS 0.04 of the final own crop and the runner gap is strictly above 0.02; bounded uniform prior-example sampling without replacement. |
| `applyClippedGradient` | Fixed learning rate 0.01 and one global norm clip at 1 across all tensors. |

Each API validates fixed dimensions, finite numeric values, message length and
feature range; model outputs and updates are independent copies. The core has
no mutable RNG singleton, replay bank, baseline storage, transaction queue or
authority handle. Numeric `trainSender` alone cannot attest that a caller's
trajectory was sampled on-policy. The runtime adapter must enforce that.

## Verification and bounded cost

Focused acceptance tests compare central finite differences for every sender
and listener parameter family, including recurrent paths and EOS decisions.
They also test an impossible EOS after the six-letter cap, stable log-softmax
at 2,000-logit gaps, frozen-example CE decrease, opposite likelihood movement
for positive/negative feedback, global clipping including extreme finite
gradients, exact seeded continuation, candidate-order equivariance, distinct
pixel/prefix responses, label censorship and validation. Independent exact-source
review found and resolved the post-cap EOS, overflowed gradient norm, unbounded
public softmax input and inherited parameter-field defects. It found no remaining
material defect in the numeric core. This review did not inspect an adapter.

Final local checks: `node --test tests/character-message-core.test.mjs` passed
14/14. `npm run check` reported syntax OK for 365 JavaScript modules, 1,602
tests passed, zero failed and one skipped. The skipped test is the existing
“predeclared native autonomous local encounter and two fixed replications”
test; no scientific replication was rerun. `npm run build` passed and produced
renderer fingerprint
`a5acda71f5c88ee2012d870b6191da81410497e277d776b06a1b739d487002b3`.
No native desktop app was launched for this unintegrated core.

The largest inference paths perform at most about 4,640 sender or 3,104 listener
matrix multiply-accumulate pairs, plus bounded activation and softmax work.
Replay selection considers at most 128 indices; a training batch holds at most
four examples. This excludes the later Canvas, physical-action, save and UI work.

An inline benchmark warmed each call 200 times and measured 1,000 calls on a
Linux x64 cloud host, Node v24.19.0, AMD EPYC 9V74 (5 visible logical CPUs).
It used frozen example inputs and models, so these are per-call numeric-core
measurements, **not** laptop or native-game timings.

| Operation | Median | p95 |
| --- | ---: | ---: |
| Sample sender | 0.092 ms | 0.185 ms |
| Sample trained listener | 0.054 ms | 0.133 ms |
| One sender update | 0.380 ms | 0.560 ms |
| Listener update, one example | 0.290 ms | 0.439 ms |
| Listener update, four examples | 0.794 ms | 1.079 ms |

RSS after the benchmark was 54.3 MiB for the Node process, including runtime
and benchmark overhead, not an isolated model footprint.

## Required second slice

1. Keep the existing original pair, target, order and choice admission paths
   intact until the explicit new-protocol branch. Preserve the supplied
   geometry, own-view distinguishability, paid 1.8-second actions, 12-second
   deadline and urgent survival interrupts; remove legacy symbol/capacity gates
   only for the new sequence protocol, and disclose the changed opportunity set.
2. Give each continuing individual its own sender weights, baseline and new
   RNG streams. Give each listener a private per-partner-incarnation model and
   bounded 128-example FIFO. Use one new valid demonstration plus up to three
   uniformly sampled prior examples per step; count physical demonstrations
   separately from replay uses and optimizer steps. A fresh partner stays
   exactly uniform until its first valid own-view label.
3. Carry the actual sampled trajectory behind an opaque, private, single-use
   transaction handle bound to owner, partner incarnation and model revision.
   Freeze that sender's weights while pending. Train only from the completed
   sender-visible match/mismatch; cancel stale, copied, interrupted and duplicate
   handles. Never join feedback by displayed string, event time or critic ID.
4. Validate strict v2 communication persistence without changing the legacy
   anchors, examples or four reference RNG states. Fresh v2 models start from
   separate streams; old examples are not relabeled or trained. Save only
   bounded weights, baseline, counters, replay and new RNG states. Never save
   pending handles or gradients. Loading must not write storage; malformed,
   partial, oversized, nonfinite or cross-lineage data must block overwrite.
5. Show exact emitted letters and actual recipient actions in Conversation,
   keeping observer English separate. Then run adapter causal tests and native
   Linux/macOS close/reopen proof in authorized isolated CI profiles before
   making any runtime or learning claim.

Sparse ordinary exchanges make learned stable vocabulary, composition,
generalization and survival improvement open questions. No new scientific
cohort, forced opportunity or resource injection is part of this checkpoint.
