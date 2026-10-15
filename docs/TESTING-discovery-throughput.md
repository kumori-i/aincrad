# Discovery throughput: correctness before policy gains

This bounded increment repairs rejected-action retry and delayed-feedback attribution defects. It does **not** establish sustained self-feeding, migration, or a better long-horizon policy. Physiology, digestion rates, food quantities, action costs, sensory thresholds and Cardinal rules are unchanged.

## Reproduced defects and corrections

1. **Learned sampling bypassed failure history.** The generic experiment chooser avoided retrying a failed operation for 60 simulation seconds, but learned held-food paths ignored that constraint. In the ordinary north-pond seed-74193 six-hour trace, 38 `TOO_FULL` refusals repeated about every 2.88 seconds while the gut held 24 entries but only 261–387 g. A focused urgent-hunger fixture also showed retries preventing needed sleep. The shared consumption gate now respects pending feedback, experienced discomfort and recent failures across all paths. A recent capacity refusal applies across objects; changing the target cannot evade an experienced bodily constraint.
2. **Learned acquisition also bypassed failure history.** An exhausted source was pulled repeatedly every roughly five seconds. Learned steps and source selection now honor the same observed failure cooldown as generic experiments. The last observed success/failure is also retained in bounded per-object trial metadata, because a fully protected 160-entry detail log can immediately evict a new source failure. Additive save validation restores that status from matching retained evidence in old saves; it does not guess an unknown result from a code or confuse a recent success with failure. Source-specific failure still updates technique confidence. A bodily `TOO_FULL` refusal defers the run without declaring that the source is non-nourishing.
3. **Older feedback cleared a newer wait.** With unchanged real apple composition, portion A produced sustained relief, the character swallowed portion B, and A's later water relief cleared B's pending marker about half a second later. The marker is now cleared only if the feedback belongs to that pending sample or a newer one. Action/ingestion identity checks remain intact.

The additional 24-input digestive bound remains a real engine constraint, separate from mass-based fullness sensations. This patch learns from the actual refusal; it neither exposes the hidden entry count to inhabitants nor changes capacity to improve a score. The existing 60-second retry interval is 24 game minutes, and the 45-second pending-feedback guard is 18 game minutes.

## Controls and evidence

`scripts/evaluate-discovery-throughput.mjs` runs native 1/60-second `PopulationRuntime` steps with ordinary weather, finite existing resources and Cardinal disabled. It fingerprints sources before/after workers, retains action/material/ingestion identifiers and bounded learned evidence, hashes initial state and early action traces, and checks energy balance, finite ecology transfer, assistance and observation privacy. It preserves partial results and reports failed checks without weakening the 1e-6 kcal tolerance. Output refuses replacement of an existing report.

The comparison arms are:

- **Baseline:** the merged regional foundation's unchanged controller.
- **Candidate:** the correctness changes with ordinary discovery learning.
- **Positive food-association ablated:** no formation or use of sustained-food techniques or preference for previously beneficial held food. Actual sensory/physiological feedback, perception, navigation, water/refuge memory, contact avoidance, novelty/failure history, motor practice and harmful-outcome avoidance remain. Raw sustained effects are recorded for diagnosis but do not select a food action. This is deliberately **not** called “all learning disabled.” The existing `npc.learning=false` is unsuitable because it disrupts navigation memory while leaving discovery learning active.
- **Warm association ablation:** the candidate learns normally for the first six game hours, then the same positive-association use/formation is disabled. It is a continuation, not a reset or a pre-taught character. Already-started physical work is not undone.
- **Privileged capacity comparator:** a developer-only policy knows actual plant kinds, energy and exact swallowing eligibility among observed objects. It still performs physical movement/pulling/sampling through authoritative APIs and consumes finite existing fruit. This is a diagnostic of short-horizon actuator capacity, never an inhabitant policy, pretrained recipe, survival claim or food addition. The application does not import this script.

The ablation switch is constructor/runtime-only, defaults to enabled, propagates to copied simulations and is not serialized into character saves. Regression tests verify equal pre-feedback physical/navigation behavior, retained raw feedback, suppressed food-technique formation, and ordinary learning after restoration.

## Six-hour pilot

The frozen seed-74193 north-pond pilot measured:

| Arm | Absorbed / spent | `TOO_FULL` refusals |
| --- | ---: | ---: |
| Baseline | 20.05% | 38 |
| Candidate | 15.0% | 0 |
| Positive food-association ablated | 4.0% | 0 |
| Privileged capacity comparator | 111.4% | 0 |

The candidate eliminates the repeat-refusal loop but has **lower intake coverage** in this pilot. Correcting the old-feedback race restores the intended wait, so the previous higher intake partly depended on erroneous pacing. These results are not presented as a feeding-performance gain. The privileged comparator swallowed 1,061.29 kcal, absorbed 949.16 kcal, spent 852.15 kcal and retained 112.10 kcal in digestion, using existing fruit and one physical approach. It demonstrates limited short-horizon capacity, not indefinite resource replenishment or an attainable learned policy.

## Twelve-hour paired continuations

Sixteen ordinary native-timestep trials cover development seed 74193 and predeclared unseen seed 424242 at the north pond and west lakeshore. These are different starts in the same fixed valley, not independent terrain generation. Each arm starts with the same full world/body hash and identical pre-positive-feedback actions. The warm-ablation arm also matches the candidate's complete first-six-hour action hash before its switch.

| Seed / start | Baseline | Candidate | Association ablated | Warm ablated |
| --- | ---: | ---: | ---: | ---: |
| 74193 / north pond | 23.07% | 26.99% | 2.18% | 14.74% |
| 74193 / west lakeshore | 8.79% | 4.78% | 1.36% | 4.78% |
| 424242 / north pond | 11.10% | 11.55% | 3.72% | 6.60% |
| 424242 / west lakeshore | 3.97% | 3.97% | 0.67% | 3.97% |

Values are total absorbed / spent energy over twelve game hours. The initial six hours and continued six hours are separately reported so cold-start learning and digestion cannot be mistaken for steady feeding. Positive food associations have a measurable effect in these small cohorts, but the correctness candidate is mixed relative to baseline and remains far below balance. The lakeshore regression is retained, not excluded. No survival or general learning-efficiency claim follows.

The [compact evidence summary](discovery-throughput/evidence-summary.json) contains swallowed, pending, absorbed, spent and reserve-change energy, action outcomes, controls and exact source/report fingerprints. The candidate was evaluated before publication: its per-file/source fingerprints identify the tested code, while `sourceCommit` records the checkout parent. Full raw traces remain in a separate evidence export rather than being routinely committed as megabytes of JSON. The durable-history correction was followed by a fresh source-frozen rerun, rather than relabeling measurements from an older candidate.

## Verification and remaining limits

- Full source/build checks: 339 tests pass. Twelve new regressions cover ordinary/urgent sampling, cross-object refusals, learned steps, depleted-source retries, real overlapping apple feedback, isolated association controls, durable failure history, successful reuse and old-save restoration.
- [Native Electron smoke](discovery-throughput/native-smoke.json) and [two-process disk reopen](discovery-throughput/native-reopen.json) pass in the Linux development container. Both identities, complete migrated checkpoint, held material, depleted grass/soil, sleep and clock survive; Escape-only pause and hidden-window progression remain intact. The rendered reopen screenshot was inspected; it remains with the raw evidence export.
- Independent review verified action/event ordering, save-roundtrip timing and the isolated ablation. Physical laptop/Ollama and multi-day/seasonal claims remain untested.
- Cost-blind novelty is a separate policy limitation: successful action duration/effort does not affect its score, so expensive striking can remain attractive. Do not conflate fixing retries with cost-aware learning.
- A separately reproduced pre-existing bounded-history limitation remains: an early water effect can release evidence protection, then enough unrelated experiments can evict an acquisition/sample before a later energy effect. Its ordinary-seed incidence is unmeasured; this patch does not claim to fix it.
- Next work should test learned, evidence-supported repetition and efficiency against these controls, retaining negative evidence and real costs. Do not increase food supply, lower metabolism, remove delayed digestion or supply recipes just to improve a benchmark. Seven-day caloric balance and learned relocation remain later gates.
