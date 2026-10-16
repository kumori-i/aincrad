# Local exploration and route admission

Candidate against main `0c3c319355c566cc6d618355a2fb2fd0d42a292b`: 494/494 tests and build passed. Independent exact-source focused review passed 61/61. Publication still requires final evidence review and exact-head CI.

## Behavior

Discovery decisions no longer exclude nearby observed objects or routes merely because they lie more than 4,200 units from the first observation. They also no longer insert a return toward that saved point solely for crossing that radius. The saved point remains compatible with existing saves.

The policy still uses only scene-specific observed or remembered terrain and objects. Local distance, action duration, physiological speed, held-item capacity, actual failures, pending digestion, fullness and exact-item discomfort constraints remain. This is a change to candidate eligibility. It does not establish natural exploration, learned migration, nutritional sufficiency or whole-map survival.

## Rejected intermediate candidate

The initial four-gate deletion was stopped before full checks or publication. A controlled retained-memory fixture had a real remembered river, a connected 80-unit approach, and 24 disconnected walkable cells that had genuinely been observed elsewhere. The actor felt desperate thirst. The old selector chose the approach; the deletion-only selector waited because the disconnected cells occupied its nearest-24 list. Reducing distractors to 23, or restoring only the original route gate, restored the water action.

The retained subset was deliberately constructed. It demonstrates a selector regression without establishing how frequently natural histories produce it. The baseline source, failed source and patch, script and exact report are preserved in the evidence export.

## Bounded correction

Endpoint eligibility now comes from one lazy shared observed-map breadth-first search per route selection. An endpoint must pass the same route constraints before it can occupy a nearest-24 slot. Disconnected, over-step, over-length and current-body-ineligible candidates no longer displace a valid care approach.

The search keeps the original start/anchor fallback, four-neighbor order, observed blocked-edge expiry, 2,500-dequeue limit and discovered-frontier semantics. The existing public knownRoute call still stops early at its goal. Both paths share the same implementation. Separate cumulative lengths preserve the nominal 1,800-unit check and the returned path used by the stricter sensed-speed 11-second check, including the existing six-unit start-center trimming rule.

For a canonical 4,096-cell remembered map, each shared search uses at most 2,500 dequeues and 10,000 neighbor examinations, amortized across at most 4,096 endpoint queries and bounded sorting. It advances only as far as the ordered candidate queries require, suspending after a complete node expansion. It reuses that same queue and total budget after an invalid endpoint. No graph is saved or reused across route calls. This avoids repeated searches; it is not a universal speedup claim.

The correction can also expose a legal route that used to be hidden behind an exhausted nearest-24 list inside the old home radius. Exact baseline trace parity is therefore limited to cases where candidate eligibility did not change and an old usable route was already admitted. Care-source choice and the surrounding care ordering are unchanged.

## Preserved capacity-cost finding

The first shared-search implementation eagerly visited the entire bounded graph before checking endpoints. It passed 479/479 tests and build, but publication was blocked by the paired Node capacity probe: p95 rose from 8.508 to 32.337 ms (upper median 3.941 to 15.160 ms) on the artificial 4,096-cell grid. The fresh-perception case had p95 1.204 to 0.761 ms. Every cold, warmup and measured sample is retained.

The reviewed lazy variant preserves the eager selector result while stopping its shared search after the first fully eligible choice. Its separate comparison uses exactly the same two input hashes, original baseline, five warmups and 30 paired alternating measured samples. Search counters come from an untimed replay of the actual selection queries, with action/state equality asserted. A fresh unused lazy index is not counted as measured search work.

## Evidence scope

Tests include a frozen original navigation oracle, deterministic randomized/adversarial route comparisons, the original failed water fixture, connected detours, slower-body and learned-speed limits, actual paid movement and object interaction, consumption safety and JSON save/reopen continuation. Any controlled position, retained-memory subset, copied-world stock or aging fixture is identified in the test source; these are not autonomous trials.

### Final deterministic checks

- 14 original-route differential tests include 3,840 seeded/adversarial comparisons against the frozen pre-change function.
- 15 lazy-route tests include 2,952 reordered comparisons against original/eager routes and metrics, 64 seeded action selections, complete-node suspension, repeated/failed query budgets, fallback enumeration and graph-read bounds.
- 16 care tests cover disconnected and connected-but-too-long crowding, actual paid approach completion, five slowed-body cases, strict speed equality, contact/water/refuge/earned-food order, fullness, pending ingestion and exact-item discomfort.
- 16 behavior tests cover home-only invariance, frozen nonbinding decision/RNG expectations, actual outward movement and remote-object inspection, refused invalid routes, legacy/cave behavior and real JSON save/reopen continuity with finite depleted stock.
- Full application verification: 494 passed, zero failures/skips; build passed. The new 61 focused cases also passed independently on the same frozen bytes.

The outward fixture observes actual terrain and completes a move across the old radius, with more than 150 units traveled and more than one second of elapsed action work, metabolic expenditure and water loss. The river-care test completes an approach; it does not claim completed collection or relief. These fixtures deliberately position actors and retain specified observed histories, rather than demonstrating a naturally learned journey.

### Final paired cost observations

The first lazy measurement invocation failed during generated-module import because its counter wrapper lacked a closing brace. It created no fixtures or timing rows. Its exact source and failure log remain in the export. A separate corrected harness was reviewed and its actual generated modules imported in a no-timing check before the one approved corrected comparison. Runtime, input hashes, baseline and sampling schedule were unchanged.

Each case retains one cold sample per arm, five warmups per arm and 30 paired alternating measured samples per arm (144 rows across both cases). Timed functions are uninstrumented; counters are from an untimed replay of the identical selector queries. Values below are milliseconds; p50 is the upper median and p95 uses nearest rank.

| Fixed case | Arm | Upper median | p95 | Maximum |
| --- | --- | ---: | ---: | ---: |
| Fresh actual perception (79 cells) | Baseline | 1.023 | 7.487 | 9.579 |
| Fresh actual perception (79 cells) | Lazy | 0.342 | 3.833 | 6.404 |
| Artificial 4,096-cell grid | Baseline | 3.653 | 7.064 | 7.844 |
| Artificial 4,096-cell grid | Lazy | 4.065 | 6.842 | 6.871 |

Cold baseline/lazy costs were 3.655/5.619 ms for fresh perception and 14.469/7.432 ms for the artificial grid. All raw rows, including warmups and outliers, remain available. No attribution of individual outliers is established.

The grid's lazy search used 377 expansions, 1,508 neighbor examinations and 435 discovered nodes, versus the earlier eager run's 2,500 expansions/10,000 examinations/2,612 nodes. The fresh case used 59 expansions/236 examinations/59 nodes. Actual-query replays examined one grid endpoint and three fresh endpoints, with identical actions and unchanged NPC/RNG state. These counters explain work in these fixed cases only.

The large eager regression is no longer present in this paired observation. The lazy capacity upper median still exceeds its paired baseline by 0.412 ms, about 11.3%; p95 is slightly lower. This residual cost is disclosed and is not a universal speedup or UI responsiveness claim. The unchanged-input cases were run once per reviewed stage, rather than repeated until favorable.

Host: Node 24.19.0, Linux 6.18.44, Intel Xeon Platinum 8573C, nine reported logical CPUs; measured-run load averages 1.94/0.97/0.66. Process RSS before/after was 55,234,560/73,101,312 bytes and heap-used was 13,772,368/19,550,536 bytes. These are process observations, not per-search allocation or peak-memory measurements. Cloud timings do not qualify a user's laptop.

### Reproducibility and retained evidence

The compact [evidence summary](local-exploration/evidence-summary.json) records source/input/report hashes, exact raw-derived summaries and all intermediate outcomes. The separate full export preserves the four-gate failure, eager implementation and measurement, aborted lazy import, corrected harness, all raw samples, final source/tests and check/build logs. Tests need no native display or external dependency; run `npm run check` and `npm run build` from the candidate checkout. The two oracle modules are self-contained fixtures in the repository.

Final runtime SHA-256:
- `src/navigation.js`: `9fc42a8264fbe5e079feee37feaf934bcfbbe2f38fe4a2d9a47c7b13a00f3944`
- `src/discovery.js`: `013e8dd40675f72f2e4d01d1887d8975e125bce98245d74c39d9fbd6319d173b`
- Corrected raw cost report: `0912002705b899889b2fddec4d308017f244870c7f5982e65a36ab088a8ca5b1`

No new native rendering, Electron timing or laptop responsiveness assurance is claimed. The resource/access audit motivating this patch remains separate: physical connectivity and removing a home-radius filter do not establish that all regions have sufficient food or that agents will learn to survive there.
