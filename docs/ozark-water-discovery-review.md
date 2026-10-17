# Ozark local water discovery: review evidence

This candidate starts from merged `main` commit `fa26441c42afb4649b75edaeeec3150b7caecddb`. It changes only the separate persistent Ozark discovery policy. The historical world keeps its prior dry-mouth behavior and save identity.

## Method

Run `node scripts/evaluate-ozark-water.mjs --seconds 300 --seeds 74193,74203,74213 --output <new-json-path>` on both the base and candidate. Each run uses both canonical fresh agent spawns, the same saved world geometry, and a native `1/60`-second fixed step. Only fresh actor random streams vary by seed. No source, route, waypoint, body deficit, or skill is supplied. Agents act through `PopulationRuntime` with their normal local perception and physical actions. The evaluator records action receipts and checks a separate Ozark write/load every ten simulated seconds against a synthetic unchanged historical-save sentinel. It attributes bodily water absorption to an independently collected flask drink only by following that drink receipt's ingestion ID into the stomach's absorption ledger.

| 300-second outcome | Base | Candidate |
| --- | ---: | ---: |
| Agents with locally observed bank source | 0/6 | 6/6 |
| Agents with movement toward an observed bank | 0/6 | 6/6 |
| Agents with physical `COLLECTED` receipt | 0/6 | 6/6 |
| Agents with independent `DRANK` receipt | 0/6 | 6/6 |
| Agents with absorption from collected-drink ingestion | 0/6 | 6/6 |
| Synthetic historical bytes preserved; strict Ozark reload/proof valid | 3/3 trials | 3/3 trials |

The first bank sightings were at 86.27–113.72 seconds; first independent drinks were at 92.68–119.20 seconds. All six candidate agents ended quenched, awake, and at health 100, with zero collapses, rescues, or outside-assistance water. Total absorption from sampled material is tracked separately and is not credited as collected water.

The observed-frontier survey uses only remembered visible cells, visits, blocked edges, and bounded routes. Unverified reported positions do not steer it. After urgent food and rest care, a dry mouth can motivate a survey when no remembered bank gives an admissible action. Previously observed alternative banks are tried before another survey. A successful swim no longer prompts another curiosity swim after reaching dry land; the existing first swim attempt and in-water safety behavior remain.

## Limits and reproducibility

This is a 300-second acquisition test at two canonical physical spawns with three actor random streams, not a geographic-start sweep or proof of sustained survival. In seed `74203`, Aster completed 14 swims and had 2 blocked swims; Mira completed 29 swims and had 13 blocked swims. Neither learned a water skill. Repeated swimming and long-term care remain unproven.

The evaluator source SHA-256 was `74f0724232c0570548d789602f680eefb6a0e8a2b1298b145946b378c9e3dacf` for both runs. The create-only raw reports are retained locally at `test-results/ozark-water-discovery/baseline.json` (SHA-256 `faf9b2c4a52cf8294288e76dc027b6302674d86bad6fdf6227ef2b5b826223e6`) and `test-results/ozark-water-discovery/candidate.json` (SHA-256 `4d666f10a5dbe379ec194891f8a34a6276270c1832da8b3d7e26799c8998c187`). Their source-plus-evaluator fingerprints are `0d6a1dd758665ad44692cfd6555b5466c8c2d8ca20569454e729c0d0c3fe7f95` and `b5a901f1c4106f11c65e6e3cbbac1d39957232ba04de5ba924e9bb0e4949ecb1`, respectively.
