# Pixel communication v2: preregistered protocol

Written 2026-10-28 before v2 training. V1 and all of its outcomes remain unchanged.
This is a new isolated synthetic experiment, with supplied segmented RGB crops,
not live Ozark vision, natural language, consciousness, or learned segmentation.
No English names, hue/shape IDs, positions, or target indices enter either policy.
The environment computes a binary success reward after a sampled receiver action.

## Hypotheses and changes

V1 demonstrated communication in two of three seeds, with one collapsed run and
weak appearance transfer. Its final outcomes are now development evidence, not
untouched tests. V2 tests a package of changes, not a causal ablation identifying
which change helps: harder contrastive episodes, wider training appearances,
and a label-free sender marginal-entropy term. The cause of v1 collapse is not
established. Entropy, message diversity, gradients, and rewards are recorded.

Both independently initialized small CNN policies still learn by sampled-action
REINFORCE with shared binary reward, Adam, gradient clipping, and exploration
entropy. A bonus for entropy of the sender's batch-average token probabilities
encourages channel diversity without assigning any token meaning. It is an
engineered auxiliary learning bias, not environmental reward or an emergent goal.
There is no pretrained encoder, target-index cross-entropy, or differentiable
message between agents. The sampled two-token channel has 8 symbols per token.

## Episode and split contract

Each four-candidate episode contains a 2-by-2 rectangle: every pairing of two
hues and two silhouettes. Candidate order is independently shuffled; the target
is uniform over the four candidates after their selection. Therefore an ideal
hue-only or shape-only policy has exactly 50% expected accuracy on the complete
(unconditioned) episode distribution. Chance without a target-dependent message
is 25%. This ceiling is a structural benchmark, not a fitted baseline.

Training and validation retain v1's 12 off-diagonal types, but use only the six
rectangles with disjoint hue-index and silhouette-index pairs. Final IID draws
these rectangles with fresh views. Final combination draws the other 30
rectangles, each of which includes at least one previously unseen diagonal
pair. All targets remain uniform; report heldout-target and seen-target counts
separately, but do not apply the 50% ceiling to those conditional subsets.

Training/validation and final IID/combination use independent uniform dark-to-mid
RGB background noise, randomly present horizontal or vertical bands, translation
within +/-2.25 pixels, radius 4.0 to 4.75, and brightness .80 to 1.0. This includes
broader versions of v1's exposed nuisances. New final nuisance/combined use a
previously untrained checkerboard background family and translation within
+/-2.75 pixels, with otherwise specified safe ranges. They are held out until
all confirmatory checkpoints have been sealed. Sender/receiver nuisance draws
have independent RNG streams. Background does not encode identity. Full renderer
constants and seed namespaces are frozen in config/code before pilots.

## Bounded validation-only selection

Two candidates differ only in marginal-entropy coefficient: .02 and .10.
Train both with pilot seed 107, 3,000 steps, batch 128, at most 5 minutes each.
Evaluate 1,024 validation episodes, using the same frozen validation stream.
Select the candidate with larger normal-minus-shuffled validation accuracy;
exact ties select .02. Preserve both pilots, including failures/timeouts.
Both pilots must complete their full horizon and produce finite validation metrics; otherwise stop selection and report the incomplete experiment without choosing a survivor or rerunning.
No other tuning or extension is allowed. Confirmatory seed outcomes cannot
change the selected configuration. Report pilot results and selection before
confirmatory training. Engineering unit tests may use tiny disposable smoke
runs; they must not be used for behavioral selection.

Freeze selected config and source. Train five independent main seeds
113, 127, 139, 151, 163, each 7,500 fixed steps and batch 128, at most 5 minutes.
Train five independently initialized receiver-only controls with the same seeds,
steps, appearances, episodes, optimization, and wall-time allowance, receiving
zero message embeddings. Main and control use separate policy RNG streams so
receiver initial weights are matched despite absent sender construction.
All attempts count, including failure, timeout, and collapse. Any incomplete main or control makes the confirmatory experiment incomplete regardless of partial-checkpoint accuracy; report those diagnostics but do not claim replication. Evaluate final
checkpoints only, not best checkpoints. Total training wall time cap 65 minutes;
CPU only, one thread, expected process memory below 2 GiB, artifact cap 250 MiB.
No paid service, GPU, Ollama, runtime dependency, or live game/save modification.

## Frozen evaluation and acceptance

Seal all ten terminal checkpoints against selected configuration, source, split,
protocol, and hashes before any final inference. For each seed and four final
splits (IID, combination, nuisance, combined), evaluate 2,048 fixed fresh episodes,
argmax inference, and save per-example results. The same episodes serve all
models and interventions. Compare normal messages, cross-episode deranged
messages preserving marginal frequencies, random tokens, zero embeddings, and
separately trained receiver-only controls. Random-token and zero-embedding interventions may be out of distribution;
the separately trained receiver-only control is distinct. No final examples or metrics enter model selection.

Report all seeds and uncertainty conditional on each fitted model. Primary
replicated message-use criterion: positive lower 95% paired-bootstrap bound for
normal-minus-shuffled IID accuracy in all five seeds. Stronger both-feature
criterion: lower Wilson 95% bound above 50% on complete IID rectangles in all
five seeds, plus replicated message use. Apply the same two tests descriptively
to nuisance results, without treating failure as a release blocker. This does
not prove factorized symbols or compositional grammar. Report message usage
by evaluator-only hue/shape, both-feature distractor errors, and heldout-target
subsets with their actual denominators. Don't select successful seeds or hide
collapsed attempts. V1 and v2 accuracy are not directly comparable because
candidate construction and appearance distributions changed.

Preserve model/optimizer, baseline, RNGs, effective config, immutable source
snapshot, environment versions, elapsed time/status and raw evaluation arrays.
Evaluation must not update weights. Safe restricted trusted-local checkpoint
loading only. Standard repository checks/build and independent review precede
publication; no model checkpoints become game assets.

## Pre-pilot resource adjustment

Before any behavioral pilot, an unrelated-seed 100-step engineering throughput
probe took 4.73 seconds with two threads and 3.53 seconds with one. No reward or
accuracy from those disposable probes was logged or inspected. To avoid a
predictably incomplete 10,000-step run under the fixed five-minute cap, freeze
one CPU thread and 7,500 steps uniformly for all main/control attempts. Pilots
remain 3,000 steps. The estimated main runtime is 265 seconds; the five-minute
per-run and 65-minute total training budgets remain unchanged. This prospective
resource adjustment precedes all validation-based selection and is not a
response to behavioral outcomes.
