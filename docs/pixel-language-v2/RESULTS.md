# Pixel communication v2: measured results

Isolated synthetic RGB reference game; not live Ozark vision or language.

Complete cohort: **False**. Replicated message use: **False**. Replicated both-feature criterion: **False**.

At the observed checkpoints, 3/5 show a positive message-ablation effect and 2/5 exceed the single-feature ceiling. Partial checkpoints remain diagnostic, not completed replications.

All five seeds must meet the predeclared criterion. Failures and incomplete runs remain visible. Each cell uses 2,048 episodes and four candidates. Chance is 25%; the single-factor ceiling is 50% on these complete rectangle distributions.

| Split | Seed | Normal | Shuffled | Receiver-only | Normal − shuffled (95% interval) |
| --- | ---: | ---: | ---: | ---: | --- |
| iid | 113 | 69.7% | 25.4% | 25.2% | 44.3 pp [42.1, 47.3] |
| iid | 127 | 42.8% | 26.0% | 25.1% | 16.8 pp [15.2, 19.5] |
| iid | 139 | 60.2% | 26.3% | 23.8% | 33.9 pp [32.8, 37.8] |
| iid | 151 | 25.0% | 25.0% | 24.3% | 0.0 pp [0.0, 0.0] |
| iid | 163 | 24.2% | 24.2% | 24.8% | 0.0 pp [0.0, 0.0] |
| combination | 113 | 68.3% | 26.4% | 25.0% | 41.9 pp [40.1, 45.6] |
| combination | 127 | 43.7% | 26.3% | 24.3% | 17.3 pp [15.5, 19.5] |
| combination | 139 | 61.6% | 25.2% | 24.8% | 36.4 pp [34.2, 39.1] |
| combination | 151 | 26.0% | 26.0% | 26.0% | 0.0 pp [0.0, 0.0] |
| combination | 163 | 24.9% | 24.9% | 24.7% | 0.0 pp [0.0, 0.0] |
| nuisance | 113 | 55.3% | 24.6% | 25.5% | 30.7 pp [27.4, 32.2] |
| nuisance | 127 | 42.7% | 24.9% | 23.7% | 17.8 pp [15.7, 19.7] |
| nuisance | 139 | 54.1% | 23.9% | 26.1% | 30.2 pp [27.4, 32.1] |
| nuisance | 151 | 26.8% | 26.8% | 25.4% | 0.0 pp [0.0, 0.0] |
| nuisance | 163 | 26.5% | 26.5% | 23.2% | 0.0 pp [0.0, 0.0] |
| combined | 113 | 59.3% | 26.2% | 26.3% | 33.1 pp [30.7, 35.9] |
| combined | 127 | 39.7% | 23.9% | 25.5% | 15.8 pp [13.6, 17.6] |
| combined | 139 | 56.8% | 25.5% | 24.4% | 31.3 pp [30.0, 34.9] |
| combined | 151 | 26.2% | 26.2% | 22.9% | 0.0 pp [0.0, 0.0] |
| combined | 163 | 25.7% | 25.7% | 24.0% | 0.0 pp [0.0, 0.0] |

## Pilot selection

Selected marginal-entropy coefficient: 0.02. Both complete pilots used seed 107 and 3,000 steps. Selection used validation normal-minus-shuffled accuracy only; exact ties favored .02.

| Coefficient | Normal | Shuffled | Distinct messages |
| ---: | ---: | ---: | ---: |
| 0.02 | 70.7% | 23.2% | 11 |
| 0.1 | 56.0% | 23.0% | 12 |

## All attempts

| Attempt | Status | Steps | Training seconds |
| --- | --- | ---: | ---: |
| pilot-002 | completed | 3000 | 108.44 |
| pilot-010 | completed | 3000 | 108.84 |
| main-113 | completed | 7500 | 285.00 |
| control-113 | completed | 7500 | 239.81 |
| main-127 | timeout | 7307 | 300.03 |
| control-127 | completed | 7500 | 234.90 |
| main-139 | timeout | 7321 | 300.02 |
| control-139 | completed | 7500 | 298.85 |
| main-151 | timeout | 6629 | 300.02 |
| control-151 | completed | 7500 | 262.05 |
| main-163 | timeout | 6830 | 300.01 |
| control-163 | completed | 7500 | 253.93 |

Total training: 2991.9 seconds on a cloud CPU, not a laptop benchmark.

## Interpretation boundaries

- A timeout is a compute-budget interruption, not proof of learning collapse. Partial checkpoints are reported, but any incomplete attempt prevents a completed replication claim.
- V1 and v2 tasks differ; their raw accuracy is not a matched improvement estimate.
- The five training seeds are independent replications. Episode intervals are conditional on each fitted policy, not uncertainty across training seeds.
- Complete rectangles test whether both visual features are needed. They do not prove factorized symbols, compositional grammar, or natural language.
- Unseen-target subgroup accuracy changes the target prior. Its single-factor ceiling is not assumed to be 50%.
- Random-token and zero-embedding frozen interventions may be out of distribution; separately trained receiver-only controls are distinct.
- The entropy bonus is an engineered auxiliary bias. The source does not assign English words or semantic labels to policies.
- All checkpoints were sealed before final evaluation; no post-final tuning or best-seed selection.

Full counts, Wilson intervals, random/zero controls, error categories, message usage, subgroup denominators and fingerprints are in [metrics.json](metrics.json).

Frozen source SHA-256: `1bb3fc2d21671048b37a92113bd87b302603d161ebfdd599729240efcf70bb5e`.

Peak measured process RSS: 330.0 MiB.

Evidence archive: `aincrad-pixel-language-v2-evidence.zip` (3,885,155 bytes), SHA-256 `69a5994dc5dfbe57503e40a2f9b09f3fd179750df303013c4b5b1f6f9e8af8ca`.
