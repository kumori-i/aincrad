# Pixel communication pilot: measured results

This is an isolated synthetic experiment, not live-world language or vision.

**Replicated message-use criterion: not met** under the predeclared rule: a positive lower paired-bootstrap bound for normal-minus-shuffled four-candidate IID accuracy in every independent seed.

## All independent four-candidate results

Each cell uses 2,048 frozen episodes; analytical chance is **25%**. Same episode sets and candidate order are used for normal/ablated inference and the separately trained receiver-only control. No model or seed was selected.

| Split | Seed | Normal | Shuffled | Random | Zero embedding | Trained receiver only | Normal − shuffled (95% CI) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| iid | 17 | 91.1% | 26.1% | 25.0% | 25.3% | 23.1% | 64.9 pp [63.9, 67.9] |
| iid | 29 | 24.8% | 24.8% | 23.3% | 24.6% | 23.5% | 0.0 pp [0.0, 0.0] |
| iid | 43 | 93.6% | 25.3% | 25.8% | 24.5% | 26.1% | 68.2 pp [66.7, 70.6] |
| combination | 17 | 89.5% | 25.4% | 24.4% | 25.7% | 23.2% | 64.1 pp [62.4, 66.9] |
| combination | 29 | 25.9% | 25.9% | 25.9% | 26.9% | 25.5% | 0.0 pp [0.0, 0.0] |
| combination | 43 | 98.4% | 25.8% | 24.7% | 25.7% | 24.8% | 72.7 pp [71.4, 75.2] |
| nuisance | 17 | 49.1% | 25.4% | 26.6% | 24.2% | 26.9% | 23.6 pp [21.5, 26.0] |
| nuisance | 29 | 24.2% | 24.2% | 24.2% | 25.1% | 24.6% | 0.0 pp [0.0, 0.0] |
| nuisance | 43 | 60.3% | 25.8% | 24.8% | 24.8% | 25.6% | 34.5 pp [32.4, 37.1] |
| combined | 17 | 41.5% | 26.3% | 25.3% | 25.5% | 24.9% | 15.2 pp [14.1, 17.9] |
| combined | 29 | 24.7% | 24.7% | 23.5% | 25.3% | 24.6% | 0.0 pp [0.0, 0.0] |
| combined | 43 | 66.0% | 23.8% | 24.5% | 24.4% | 24.0% | 42.2 pp [38.9, 43.2] |

All 2/3/4-candidate results, Wilson intervals, exact counts, message diversity and source/checkpoint fingerprints are in [metrics.json](metrics.json). Chance is 50%, 33.3%, and 25%, respectively.

## Attempts and compute

| Attempt | Status | Steps | Training seconds |
| --- | --- | ---: | ---: |
| pilot-101 | completed | 400 | 6.61 |
| main-17 | completed | 7500 | 236.75 |
| control-17 | completed | 7500 | 139.73 |
| main-29 | completed | 7500 | 114.47 |
| control-29 | completed | 7500 | 111.29 |
| main-43 | completed | 7500 | 109.39 |
| control-43 | completed | 7500 | 87.99 |

Total recorded training time: 806.2 seconds, on the cloud CPU host with two torch threads per run. This is not a laptop benchmark.

The initial 400-step pilot collapsed to one argmax message: normal and shuffled validation were both 146/512 (28.5%). It did not demonstrate communication. The single allowed validation-only amendment increased the fixed horizon to 7,500 steps for every main and control run. Final heldout metrics were opened only after all six checkpoints were frozen and sealed; there was no post-final tuning.

## Interpretation limits

- A positive ablation effect supports message-dependent matching in this task, not natural language, consciousness, English definitions or full-scene understanding.
- The diagonal heldout pair set correlates hue and silhouette. Transfer there is **not** evidence of compositionality; a hue-only code can succeed. A perfect hue-only reference policy would score 90.91% / 82.42% / 74.55% on this IID pool with 2 / 3 / 4 candidates, yet 100% on diagonal pairs (analytical structural benchmark, not an additional fitted model).
- Random-token and zero-embedding interventions can be out-of-distribution. The marginal-preserving shuffled condition and independently trained receiver-only control are reported separately.
- Confidence intervals are conditional on each fitted policy. The three seeds, not 2,048 episodes, are the independent training replications. All seed outcomes remain visible.
- Perfect segmentation and a tiny renderer are supplied capabilities. Nothing was integrated into Aster, Mira, the live Ozark world, settings or saves.

## Measured symbol usage

- Seed 17: 13 distinct argmax messages on four-candidate IID episodes.
- Seed 29: 1 distinct argmax messages on four-candidate IID episodes.
- Seed 43: 14 distinct argmax messages on four-candidate IID episodes.

The compact JSON records empirical top messages per evaluator type. Tokens are arbitrary integer symbols; evaluator hue/silhouette identifiers are never policy inputs or assigned dictionary meanings.

## Provenance

Frozen source/protocol/config SHA-256: `512c42db77c823af881c0bd2bf360f3e94b412b7587ffdd9fd7068873c4dc4c5`.

Evaluation specification SHA-256: `2fd079fd6b646e8f5041e128e07edbe8a11c88e47c42b5206bc37cc9b5429d14`.

Models, Adam states, reward baselines, RNG states, source snapshots and per-example evidence are retained in the bounded experiment archive; compact metrics reference their SHA-256 fingerprints. No checkpoint is loaded into the game. See [protocol](PROTOCOL.md) and [reproduction instructions](README.md).

Evidence archive: `aincrad-pixel-language-v1-evidence.zip` (2,396,428 bytes), SHA-256 `66268e5717fd76893917a44b48d4705f8d7d8ca6b2d541b262770c6a27f74ca1`.
