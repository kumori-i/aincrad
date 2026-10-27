# Pixel communication pilot: protocol v1

Predeclared 2026-10-27, before training or final evaluation. This is an isolated
synthetic reference game, **not** Ozark sight, world training, English, Ollama,
consciousness, or evidence of compositional language. No game runtime imports it.

## Inputs and learning

- A renderer supplies perfect object segmentation and a 16 x 16 RGB object crop.
  Segmentation/cropping is a supplied capability, not learned object detection.
  Four distinguishable hues and four silhouettes make 16 observable types.
  Latent type identifiers are available only to the environment/evaluator; policies
  receive pixels and (receiver only) discrete message tokens. No semantic strings,
  coordinates, target index, shared embeddings, or pretrained weights enter them.
- Candidate types are sampled uniformly without replacement; the target index is
  uniform **after** candidate selection. Train on four candidates; evaluate 2/3/4.
  Sender and each receiver crop have independently drawn nuisance variables.
  The receiver's target is an independent rendered view, never the same image.
- Distinct, randomly initialized sender/receiver CNNs: two stride-2 convolutions,
  a 32-dimensional projection, approximately tens of thousands of parameters.
  Sender emits two independent categorical tokens from eight arbitrary symbols
  (64 possible messages); receiver embeds these tokens and scores its candidates.
  This deliberately small channel is a capacity choice, not a grammar.
- Both policies sample actions and learn only from the same binary match reward
  using REINFORCE with a detached moving-average reward baseline; Adam, gradient
  clipping and an entropy bonus. No receiver target-index cross-entropy training.
  A separately trained receiver-only control receives constant zero message
  embeddings and exactly the same reward-learning budget.

## Split contract

The four diagonal hue/silhouette pairs (hue == silhouette) are held out of all
training and validation candidate sets. Train/validation use the other 12 types.
Train/validation backgrounds are dark independently randomized RGB noise;
translations, scale and brightness vary independently in each crop. Final IID
uses new episode RNG streams with the same nuisance distribution. Final
combination uses only the four unseen pairs. Final nuisance uses the 12 seen
pairs with unseen brighter striped backgrounds and larger translations. Final
combined uses unseen pairs and unseen nuisance. These partitions test this tiny
renderer only, not natural-image or whole-scene generalization. All silhouettes
remain distinguishable under these nuisance ranges; there are no duplicate
visual types within an episode.

## Compute and stopping

CPU only, two torch threads, no GPU/model downloads, at most 2 GiB process RAM
expected, and at most 250 MiB experiment artifacts excluding the environment.
Official PyTorch 2.8.0 CPU wheel is 183.9 MB (+ approximately 3 MB dependencies),
installed into a task-only virtual environment. Cloud host: 9 visible CPUs,
9.7 GiB RAM, 28 GiB initially free. Laptop speed is not established here.

1. Engineering smoke tests and a seed-101, 400-step pilot (batch 128), at most
   five minutes; inspect train/validation only. Preserve pilot even if it fails.
2. At most one train/validation-only adjustment, documented in an amendment
   before confirmatory runs. Do not choose among seeds or inspect final splits.
3. Freeze configuration; independent main seeds 17, 29, 43, each 2,500 steps,
   batch 128, at most ten minutes per training run. Three receiver-only controls
   use the same seeds and horizon. Total training wall-clock budget 65 minutes.
   A timeout is an incomplete attempt, not success, and must remain in reports.
4. Evaluate the last checkpoint, never a best evaluation checkpoint. No updates
   during evaluation. Freeze all main/control checkpoints before opening final
   evaluation. Final results cannot be used to tune this protocol.

## Evaluation and acceptance matrix

For each seed, split, and candidate count: 2,048 fresh episodes (one fixed episode
set shared between models and interventions), deterministic argmax inference.
Report count, accuracy and Wilson 95% intervals (conditional on that trained
model, **not** uncertainty across seeds); separately report every seed and range.

| Question | Evidence / acceptance |
| --- | --- |
| Honest implementation | Separate trainable weights; gradients reach both CNNs; reward-only learning; reproducible saved states and split/config hashes; all attempts retained. |
| No target shortcut | Uniform target index after unordered candidate sampling; permutation equivariance; independent nuisance draws; receiver-only trained control near 1/K. |
| Message use | Primary: normal accuracy minus **deranged cross-episode message** accuracy on paired four-candidate final IID episodes; report paired 95% CI and all seeds. Requires positive lower CI in each seed to call replicated message use. |
| Channel controls | Same frozen receiver with zero embedding (OOD intervention), uniform random tokens (OOD intervention), and deranged messages preserving exact message marginals. Report analytical 1/K chance and trained receiver-only control separately. |
| Generalization | Report the same metrics on held-out combinations, nuisance and both; failures are valid results, not release blockers or license to retune. |
| Meanings | Report evaluator-only type/message counts and message diversity. These are measured usage associations, not assigned English definitions or proof of compositionality. |
| Frozen evaluation | Model/optimizer fingerprints unchanged, eval/inference mode, no optimizer in evaluator; held-out streams never called by trainer. |
| Reproducibility | Model + Adam states, reward baseline, RNG states, config, split definition, source hash, environment versions, seed, steps, wall time, termination reason and raw evaluation counts. |
| Isolation/release | No runtime/save/settings changes; lab tests, npm check/build and relevant CI pass; independent review before merge. |

A delivered research harness does not imply successful communication. No minimum
accuracy gates release; behavioral claims must match the measurements above.

## Frozen implementation details

Exact hyperparameters and RNG split identities are recorded in
`scripts/pixel_language_lab/config-v1.json` before the pilot. A percentile paired
bootstrap resamples episode rows and re-deranges their messages on every one of
1,000 replicates, using the frozen receiver's choices for every possible message.
No-message means zero token embeddings **before** the receiver's learned affine
projection, leaving its constant query trainable; both the intervention and
independent receiver-only control have a valid candidate-scoring policy.

The diagonal held-out pool correlates hue and silhouette: a hue-only code could
succeed there. Accordingly, combination results mean only narrow unseen-pair
transfer. They cannot establish factorization or compositionality. Per-example
targets, candidate types, transmitted symbols and choices are preserved in
compressed, evaluator-only evidence arrays, never passed to policies.

## Pilot-informed amendment 1 (2026-10-27, before main training)

The seed-101 pilot completed 400 steps in 6.6 seconds, with 25.1% mean training
reward over its final 100 steps. Validation: 146/512 (28.5%) normal **and**
shuffled accuracy, one distinct argmax message, normal-minus-shuffled interval
[0, 0]. It did not demonstrate communication. The pilot is retained unchanged.

Use the protocol's single permitted train/validation-only adjustment to extend
all six main/control runs from 2,500 to **7,500 fixed steps** (same batch and
optimizer), approximately two minutes each at measured pilot speed. The
10-minute per-run and 65-minute total training limits remain unchanged. This
allows more optimization without promising learning. No final split metrics
were opened. No further tuning is permitted in this protocol, including after
an unsuccessful main run.
