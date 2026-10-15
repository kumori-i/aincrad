# Regional ecology foundation: measured evidence

Date: 2026-10-15. Scope: the first bounded implementation of [milestone A](DEVELOPMENT-v08.md), with a diagnostic baseline for B. Package version remains 0.7.0; ecology distribution is 3 and regional metadata is 1. This is not a completed survival, migration, regional Cardinal or seasonal-sustainability release.

## Reproducible evidence

- [Full regional report](regional-foundation/evaluation.json): two predeclared seeds (74193, 3), one ecological game day per seed, plus four predeclared remote human starts per seed. Runtime/evaluator/config hashes match at start and end, including each worker. Source fingerprint: `dbe52cb3e8a71a8f8ee8fae07412fe5c848f2c1419937d95fdb50668146fa2bc`. The report identifies the base commit and uncommitted candidate through exact content hashes rather than claiming a clean commit.
- [Check output](regional-foundation/check-output.txt): 325/325 tests passed, including 29 new regional/corridor tests. `npm run build` passed. The publication helper repeats both checks before producing its validated manifest.
- [Cardinal compatibility report](regional-foundation/cardinal-compatibility.json): frozen-source actual candidate/control runs, positive adoption and negative rejection, automatic diagnostic outcomes and persisted learning.
- [Native smoke](regional-foundation/desktop-smoke.json) and [two-process disk reopen](regional-foundation/native-reopen.json): actual Electron, Linux headless container. [Starter screenshot](regional-foundation/desktop-smoke.png) and [remote lakeshore screenshot](regional-foundation/remote-lakeshore.png) were visually inspected. These are application screenshots, not browser substitutes.

Reproduce with `npm run check`, `npm run build`, `npm run smoke`, `npm run verify:regions`, `npm run evaluate:regions -- --days 1 --seeds 74193,3 --human-seconds 120 --output /absolute/new-report.json`, and `npm run evaluate:cardinal -- --output /absolute/new-cardinal-report.json`. Regional output is create-only: use a new path. On this restricted cloud machine Electron used a writable temporary download cache; ordinary installed desktops do not require that override.

## World structure and accounting

Both seeds have five habitat types, plants in all 49 bookkeeping regions, animals concentrated in 11 resource-supported regions, and 15 hydric anchors connected by 14 collision-checked paths. Seed 74193 starts with 745 plants; seed 3 has 744. Both start with 106 rabbits, one fox and one bobcat. All actual final placements pass species-radius collision and producer suitability checks. Predators are placed using a declared initial prey-production heuristic; no long-term support is inferred from it.

The route audit reports one connected component, no failed/unreachable anchors and real drinking-bank access. Maximum sampled distance from a corridor point to vegetation is 109.01 world units, but distance to fruit-bearing vegetation reaches 4,494.59 units. These are sampled nearest-plant distances, not maximum longitudinal food-free spans, edible supply, usable paths known by the inhabitants or a travel-energy proof. The same fixed valley geometry is used for both seeds. Route budgets/failure reporting, opposite river banks/real bridges and actual discovery-mode regional temperature effects on physiology have explicit tests.

At the native ecology update of 0.5 simulation seconds, 7,200 updates produce one full game day per seed:

| Seed | Rabbits, opening → closing | Rabbit births / deaths | Maximum sampled global energy residual | Maximum regional soil residual |
| --- | --- | --- | --- | --- |
| 74193 | 106 → 167 | 69 / 8 | 1.33e-7 kcal | 1.40e-10 nutrient units |
| 3 | 106 → 172 | 74 / 8 | 1.36e-7 kcal | 5.10e-11 nutrient units |

Both predators remain present in these short trials. Finite stocks, independent energy calculations, local soil and detritus mass/energy equations pass; no external energy or assistance is added. These growing rabbit populations are not evidence of equilibrium. Regional soils are a game approximation (.004 nutrient units per gram produced/mineralized), not elemental nutrient conservation. Excretion, runoff, finite surface-water hydrology and a closed nutrient cycle are not modeled.

Tests cover depletion blocking local grass and fruit growth despite remote fertility, destination-local decomposition (including held material), cave material staying unassigned, carcasses, bounded overflow with explicit losses, malformed metadata and no remote fertilization. Floating residuals are reported rather than forcibly zeroed. The evaluator records its actual tolerance in each audit; fixtures use stricter independently calculated assertions.

## Human food throughput: failed adequacy baseline

Each of the eight human probes runs for 120 simulation seconds, or 48 game minutes, at 1/60-second human steps. The controller receives no food recipe, remote knowledge, human answer, model, Cardinal adjustment or assistance. Every start produces some absorbed food, but none meets expenditure:

| Seed / start | Ingested kcal | Absorbed kcal | Spent kcal | Absorbed / spent |
| --- | ---: | ---: | ---: | ---: |
| 74193 / Oldwood | 15.83 | 2.98 | 194.88 | 1.53% |
| 74193 / north pond | 15.83 | 2.56 | 205.86 | 1.24% |
| 74193 / south pond | 15.83 | 2.92 | 199.79 | 1.46% |
| 74193 / west lake | 32.12 | 5.88 | 205.35 | 2.86% |
| 3 / Oldwood | 15.83 | 3.54 | 205.67 | 1.72% |
| 3 / north pond | 15.83 | 2.30 | 198.92 | 1.16% |
| 3 / south pond | 15.83 | 2.01 | 210.98 | 0.95% |
| 3 / west lake | 15.83 | 5.85 | 210.28 | 2.78% |

The short horizon includes pending digestion, so absorbed/spent alone is not a steady-state conclusion. However, even swallowed energy is far below costs. Next work must trace the acquisition pipeline and verify physiological/action units before increasing food or predator pressure. Source-derived leads: 30 g sample cap; apple/berry digestion of 2/1.5 game hours; a 45-s resampling guard (18 game minutes); initial pull/sample duration of 5/3.5 simulation seconds; and human basal demand of 100 kcal/game-hour (80 kcal for an awake 120-s probe, before manipulation/movement). Measured trials include repeated inspect/strike operations, unsuccessful grasp/pull attempts, only one or two successful samples in most cases, and retained partially digested portions. See per-trial primitive durations, complete body checkpoints, ingestion contents, first swallow/absorption and energy totals in the report. A precise causal diagnosis needs longer paired, learning-disabled and action-cost controls; this increment does not supply that evidence.

## Save safety and native behavior

Distribution 1/2 migration partitions the existing aggregate soil/litter stock once. It adds no plants, animals, fruit or calories and preserves identity, depletion and memories. Zero stays zero. Missing/null regions or regional version in a distribution-3 save cannot trigger repartition or global-pool fallback; disk loading blocks and retains the original bytes. Oversized/future nested saves are protected instead of silently truncating valid objects.

Supported restoration no longer generates two disposable fresh ecosystems. Independent review measured warm validation around 19–37 ms, versus 200–291 ms before this fix; these are container timings, not guaranteed UI budgets. The native two-process test uses an isolated profile, performs a real observed pull action, persists its possession evidence, then closes/reopens Electron and compares the complete canonical checkpoint. Held material, Mira's sleep, depleted grass, 37 soil units, both identities/memories and elapsed time survive. Native smoke verifies shared clocks, map/panel behavior, explicit Escape pause and continued hidden-window simulation. No closed-time backfill occurs.

## Cardinal compatibility and unresolved diagnostic wording

The isolated 2.5× grass-growth candidate is adopted, the destructive 0.25× candidate is rejected, live bodies/resources stay unchanged by shadow work, and rollback passes. Both automatic 1.25× stress proposals are now rejected: measured training gain 0.004762 is below the unchanged 0.01 supervisor threshold. The evaluator retains that outcome rather than requiring a false improvement or weakening thresholds. Eight full-world automatic experiments complete across the two seeds and resumed windows, with zero applied interventions; learned evidence affects subsequent proposal selection in both seeds. None of this demonstrates improved survival.

A pre-existing diagnostic wording defect is exposed: a rejected supervisor record can inherit the copied experiment's “Replicated training gains and held-out safety passed” reason even when the stricter supervisor threshold rejects it. The saved `recommendation`, measured gains and applied-intervention count remain authoritative. Fix the explanatory reason in subsequent Cardinal work; do not interpret this text as acceptance.

## Performance and limits

The frozen regional run took 238.98 wall seconds on a Linux x64 execution container reporting Intel Xeon Platinum 8573C, nine logical CPUs and about 9.73 GiB visible memory, Node 24.19.0. Other test work ran concurrently, so timings are workload-sensitive. Cold fresh ecology creation in worker isolates took 2.58/2.67 s. One ecological day took 72.71/122.67 s; mean authoritative 0.5-s ecology update was 10.02/16.94 ms and p95 was 21.49/47.85 ms. Maximum individual updates reached 307.58/407.27 ms, so low average CPU cost does not eliminate occasional stalls. Human fixed-step p95 ranged 2.58–5.08 ms. Peak sampled shared-process RSS was about 279 MiB; sampling may miss peaks and excludes Electron/renderer memory.

No physical 32 GB laptop, Windows installation, Ollama, model training, seven-day human survival, learned relocation, impossible challenges, held-out learning comparison, 120/240-day seasonal cycle or regional Cardinal intervention was tested here. GitHub CI results are separate from these local measurements. Physical corridors and plentiful initial stocks are prerequisites, not evidence of learned or nutritionally viable migration. Continue with milestone B's controlled throughput diagnosis before adding threat pressure.
