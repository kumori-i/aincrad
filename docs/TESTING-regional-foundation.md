> Historical, source-specific report. Retired world/version documents are available in Git history; current runtime guidance is in README.md and docs/TESTING.md.

# Regional ecology foundation: measured evidence

Date: 2026-10-15. Scope: the first bounded implementation of milestone A (retired; see Git history), with a diagnostic baseline for B. Package version remains 0.7.0; ecology distribution is 3 and regional metadata is 1. This is not a completed survival, migration, regional Cardinal or seasonal-sustainability release.

## Reproducible evidence

- [Full regional report](regional-foundation/evaluation.json): two predeclared seeds (74193, 3), one ecological game day per seed, plus four predeclared remote human starts per seed. Runtime/evaluator/config hashes match at start and end, including each worker. Source fingerprint: `dbe52cb3e8a71a8f8ee8fae07412fe5c848f2c1419937d95fdb50668146fa2bc`. The report identifies the base commit and uncommitted candidate through exact content hashes rather than claiming a clean commit.
- [Initial check output](regional-foundation/check-output.txt): 325/325 tests passed, including 29 new regional/corridor tests. `npm run build` passed. The publication helper repeats both checks before producing its validated manifest.
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

## Human food throughput: cold-start baseline

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

These actors begin at two game hours since a meal. Hunger remains `content` until four hours; the 120-second probes add only 0.8 game hours. Consequently they test early experimentation before hunger-driven feeding engages, not an inability to feed once hungry. The short horizon also includes pending digestion, so absorbed/spent alone is not a steady-state conclusion. However, even swallowed energy is far below costs. Next work must trace the acquisition pipeline and verify physiological/action units before increasing food or predator pressure. Source-derived leads: 30 g sample cap; apple/berry digestion of 2/1.5 game hours; a 45-s resampling guard (18 game minutes); initial pull/sample duration of 5/3.5 simulation seconds; and human basal demand of 100 kcal/game-hour (80 kcal for an awake 120-s probe, before manipulation/movement). Measured trials include repeated inspect/strike operations, unsuccessful grasp/pull attempts, only one or two successful samples in most cases, and retained partially digested portions. See per-trial primitive durations, complete body checkpoints, ingestion contents, first swallow/absorption and energy totals in the report. A precise causal diagnosis needs longer paired, learning-disabled and action-cost controls; this increment does not supply that evidence.


## Longer diagnostic and explicit digestive cleanup accounting

The unchanged-code [initial six-hour diagnostic summary](regional-foundation/evidence-summary.json) extended the same four seed-74193 starts to 900 simulation seconds (six game hours), without injected experience or hunger. Absorption rose to 12.07–20.05% of expenditure. Swallowed energy was 181.86–367.33 kcal versus 1,239.04–1,269.18 kcal spent, with 28.82–118.88 kcal still in digestion. This crosses the natural hunger threshold and is more informative than the cold 48-minute window, but remains shorter than a full day or a matched warm/learning-disabled experiment. It does not prove a long-term impossibility.

That diagnostic correctly failed its strict human energy check: 0.00467–0.00818 kcal went unaccounted while world ecology and actual ingestion transfer checks passed. An isolated 30 g apple portion reproduced a 0.000527 kcal loss when the nearly empty gut record was removed. `biology.js` was unchanged from v0.7, establishing this as a pre-existing bookkeeping error. The correction records the tiny unabsorbed energy and water in the existing discarded counters before removal. It changes no absorption rate, body store, effort, recipe, decision or threshold. No calorie is credited as food. A regression covers human/rabbit native and coarser steps; independent review compared 24 old/new cases across all four species, ordinary/saturated/water-only inputs and native/coarse steps, and found identical body state except the two corrected loss counters. Repeated empty-gut ticks do not count the loss again, and restoration preserves the corrected counters.

The failed measurements remain explicitly recorded in the summary rather than being relabeled as a pass. Full raw reports are preserved in a development evidence export, with sizes and SHA-256 hashes in the summary; they are not included in this small source update. Final frozen-source measurements and native evidence accompany the correction; see the final verification section below.

## Save safety and native behavior

Distribution 1/2 migration partitions the existing aggregate soil/litter stock once. It adds no plants, animals, fruit or calories and preserves identity, depletion and memories. Zero stays zero. Missing/null regions or regional version in a distribution-3 save cannot trigger repartition or global-pool fallback; disk loading blocks and retains the original bytes. Oversized/future nested saves are protected instead of silently truncating valid objects.

Supported restoration no longer generates two disposable fresh ecosystems. Independent review measured warm validation around 19–37 ms, versus 200–291 ms before this fix; these are container timings, not guaranteed UI budgets. The native two-process test uses an isolated profile, performs a real observed pull action, persists its possession evidence, then closes/reopens Electron and compares the complete canonical checkpoint. Held material, Mira's sleep, depleted grass, 37 soil units, both identities/memories and elapsed time survive. Native smoke verifies shared clocks, map/panel behavior, explicit Escape pause and continued hidden-window simulation. No closed-time backfill occurs.

## Cardinal compatibility and unresolved diagnostic wording

The isolated 2.5× grass-growth candidate is adopted, the destructive 0.25× candidate is rejected, live bodies/resources stay unchanged by shadow work, and rollback passes. Both automatic 1.25× stress proposals are now rejected: measured training gain 0.004762 is below the unchanged 0.01 supervisor threshold. The evaluator retains that outcome rather than requiring a false improvement or weakening thresholds. Eight full-world automatic experiments complete across the two seeds and resumed windows, with zero applied interventions; learned evidence affects subsequent proposal selection in both seeds. None of this demonstrates improved survival.

A pre-existing diagnostic wording defect is exposed: a rejected supervisor record can inherit the copied experiment's “Replicated training gains and held-out safety passed” reason even when the stricter supervisor threshold rejects it. The saved `recommendation`, measured gains and applied-intervention count remain authoritative. Fix the explanatory reason in subsequent Cardinal work; do not interpret this text as acceptance.

## Performance and limits

The frozen regional run took 238.98 wall seconds on a Linux x64 execution container reporting Intel Xeon Platinum 8573C, nine logical CPUs and about 9.73 GiB visible memory, Node 24.19.0. Other test work ran concurrently, so timings are workload-sensitive. Cold fresh ecology creation in worker isolates took 2.58/2.67 s. One ecological day took 72.71/122.67 s; mean authoritative 0.5-s ecology update was 10.02/16.94 ms and p95 was 21.49/47.85 ms. Maximum individual updates reached 307.58/407.27 ms, so low average CPU cost does not eliminate occasional stalls. Human fixed-step p95 ranged 2.58–5.08 ms. Peak sampled shared-process RSS was about 279 MiB; sampling may miss peaks and excludes Electron/renderer memory.

No physical 32 GB laptop, Windows installation, Ollama, model training, seven-day human survival, learned relocation, impossible challenges, held-out learning comparison, 120/240-day seasonal cycle or regional Cardinal intervention was tested here. GitHub CI results are separate from these local measurements. Physical corridors and plentiful initial stocks are prerequisites, not evidence of learned or nutritionally viable migration. Continue with milestone B's controlled throughput diagnosis before adding threat pressure.

## Final verification after cleanup correction

[Final frozen measurements](regional-foundation/evidence-summary.json), fingerprint `5267589201d13bae97fe33d6e2fe024fe1fc0bdb8370dd35085fcb35ae65e2cf`: both one-day ecology trials plus eight 900-second (six-game-hour) human trials pass every recorded accounting, physical, clock and privacy check without assistance. Maximum human energy residual is 2.56e-8 kcal, below the unchanged 1e-6 tolerance. World energy and regional soil residuals remain within the original gates. Source/configuration/evaluator hashes match before/after every worker and the coordinator.

[Final full check](regional-foundation/check-corrected-output.txt): 327/327 tests pass, and the final build passes. [Corrected-source Cardinal compatibility summary](regional-foundation/evidence-summary.json) retains positive adoption, destructive rejection, rollback, eight full-world experiments, zero automatic interventions and saved evidence. [Native smoke](regional-foundation/desktop-smoke-corrected.json) and [two-process reopen](regional-foundation/native-reopen-corrected.json) pass again; the [final native screenshot](regional-foundation/remote-lakeshore-corrected.png) was inspected. Independent review cleared the conservation fix and the connector-only publication branch validation.

| Seed / start | Swallowed kcal | Absorbed kcal | Spent kcal | Absorbed / spent |
| --- | ---: | ---: | ---: | ---: |
| 74193 / pond:oldwood | 181.86 | 152.64 | 1264.51 | 12.07% |
| 74193 / pond:north | 367.33 | 248.45 | 1239.04 | 20.05% |
| 74193 / pond:south | 241.57 | 212.74 | 1244.80 | 17.09% |
| 74193 / lake:west:2 | 209.00 | 179.22 | 1269.18 | 14.12% |
| 3 / pond:oldwood | 304.00 | 236.41 | 1258.67 | 18.78% |
| 3 / pond:north | 133.00 | 132.99 | 1265.70 | 10.51% |
| 3 / pond:south | 190.00 | 149.76 | 1278.53 | 11.71% |
| 3 / lake:west:2 | 228.00 | 180.31 | 1269.14 | 14.21% |

Absorption/spending is 10.51–20.05% in these longer development probes, still with declining reserves. The corresponding seed-74193 action/body/intake outcomes are unchanged by the accounting correction; only previously omitted discarded remainders are now recorded. Neither these cold-to-hungry six-hour runs nor the original 48-minute probes are matched warm-start, learning-disabled, full-day or sustained-survival evidence. Next work must test those controls and diagnose repeated high-cost experiments, acquisition reuse, and the mismatch between mass-based fullness sensations and the additional 24-input digestive bound. Do not weaken metabolism, provide food or fabricate success to remove this gap.

Final evaluation wall time was 400.72 seconds on the same execution container with concurrent verification work. One ecological day took 75.63/93.40 wall seconds. These and the earlier latency/memory figures are development measurements, not laptop, renderer or Ollama benchmarks. The benchmark and native artifacts identify their own source fingerprints rather than borrowing earlier evidence.
