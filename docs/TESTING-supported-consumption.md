# Evidence-supported repetition on one held material

This increment lets an inhabitant repeat consumption from one physical held piece after **two distinct, personally experienced nourishing ingestions**. It removes an unconditional wait from that narrowly supported case. It also preserves contradictory harmful evidence when older pending food later produces nourishment. Physiology, food supply, action costs, digestion, rest safety and novelty scores are unchanged.

This is a bounded controller experiment, not completed self-feeding or a claim that two good experiences establish safety. Faster repetition can increase exposure before a delayed harmful effect becomes observable.

## Mechanism and identity

The previous pending guard waits up to 45 simulation seconds after every sample. At the normal timescale that is 18 game minutes. A 30 g apple sample contains 15.83 kcal, giving a single held piece's pending-guard opportunity ceiling of 52.78 kcal per game hour before action costs. This is **not a global controller ceiling**: pending waits are per object, materials differ, and other feedback can arrive earlier.

The candidate permits the next sample during that pending interval only when the exact material is still held and its retained evidence links at least two distinct sustained-benefit ingestion IDs to successful sample action IDs. Two feedback events from one ingestion, water relief, another piece's benefit, or a newly detached piece from a supported source cannot qualify. Missing or rotated detail conservatively removes the permission. The count is reconstructed from bounded existing evidence; it is not a new save field or supplied recipe.

All other gates remain: qualitative fullness, experienced discomfort, recent target failure, and a recent bodily capacity refusal across targets. The real engine still enforces finite mass, the 24-input digestive bound, costs and digestion. The pending marker stays attached to the newest sample; earlier feedback cannot clear it. Positive-association ablation disables the shortcut along with other learned food preferences, while perception, navigation and harmful-outcome avoidance remain.

Harm revises the technique supported by that actual sample/acquisition chain. A later positive still records real nourishment but cannot silently replace the revised confidence. Shared acquisition attribution keeps source and held-item chains distinct, including release and regrasp. This does not declare harmful material non-nourishing, label an entire species, or prove that every generic exploration choice is safe. Explicit re-evaluation of a revised source is future work.

## Finite opportunity assay

`scripts/evaluate-supported-material.mjs` compares the previous merged controller with this candidate using full native 1/60-second environment, ecology and body clocks. Both arms have the same explicit initial-hunger fixture. The harness physically schedules acquisition and each first taste from existing stock; it then executes only learner-selected samples of that held piece and idles when another operation is proposed. Therefore this isolates consumption opportunity and does **not** measure autonomous foraging. The three-piece cycle includes real pulling and handling but no travel.

| Assay | Previous | Candidate |
| --- | ---: | ---: |
| Supported 90 g remainder: elapsed simulation seconds | 146.07 | 11.02 |
| Remainder swallowed, kcal | 47.50 | 47.50 |
| Absorbed during that interval, kcal | 30.84 | 2.36 |
| Calories still pending at finish, including opening digestion | 56.42 | 84.91 |
| Three whole finite pieces: elapsed simulation seconds | 750.88 | 347.78 |
| Three-piece swallowed / game hour, kcal | 56.93 | 122.92 |
| Three-piece swallowed, kcal | 285.00 | 285.00 |
| Three-piece absorbed / spent, kcal | 225.11 / 544.16 | 136.59 / 275.43 |
| Three-piece calories pending at finish | 59.88 | 148.41 |

Faster swallowing leaves more energy awaiting digestion. Neither three-piece arm reaches absorbed-energy balance. The supported remainder is a short burst, not a sustainable intake rate. Reports retain requested target/action/material/ingestion IDs and the matching feedback records; all four start hashes match within pairs and maximum energy residual is below 7e-9 kcal.

## Delayed toxicity and contradictory evidence

An independent paired full-clock assay uses an explicitly aged existing rabbit carcass as a harmful fixture, physical detachment/tastes, and two actually earned same-piece nourishing outcomes. After the shared checkpoint it executes only learner-selected samples of that piece, records competing choices, and continues through complete digestion. No hidden toxicity is shown to the learner. This is a controlled exposure assay, not an ordinary autonomous incidence estimate.

Both arms first observe discomfort at 116.2 simulation seconds. The previous controller had swallowed 90.00 g / 126.00 kcal; the candidate had swallowed 99.79 g / 139.71 kcal. The extra **9.79 g / 13.71 kcal** increases cumulative toxic health loss from **0.16714 to 0.18532 points**, a **10.9% increase**. Net health also includes natural recovery, so it must not substitute for the gross harm measure. Two nourishing outcomes are evidence of benefit, not proof of safety.

After discomfort neither arm selected another sample of the harmful held ID. The old controller's later pending positive wrongly restored source confidence and led to 55 further learned pull selections; the candidate retained revised confidence through later benefits and save/reopen, selecting zero learned pulls. Generic exploration still selected grasp on the carcass (11 candidate, 2 previous); those proposed actions were recorded rather than executed, and the engine would reject that carcass as too heavy. The remaining novelty policy is not a safety guarantee. Per-piece mass/energy, body energy, ecology transfer and newest-pending checks passed in both arms.

## Autonomous matched continuations

Values are absorbed / spent energy over the complete twelve game hours:

| Seed / start | Previous | Candidate | Cold ablation | Warm ablation |
| --- | ---: | ---: | ---: | ---: |
| 74193 / north pond | 26.99% | 23.83% | 2.18% | 13.81% |
| 74193 / west lakeshore | 4.78% | 4.80% | 1.36% | 4.80% |
| 903277 / north pond | 4.97% | 14.21% | 2.90% | 8.99% |
| 903277 / west lakeshore | 3.97% | 8.38% | 0.67% | 7.08% |

The baseline is PR #2, the merged discovery-correctness controller. Sixteen twelve-game-hour native-step trials use development seed 74193 and predeclared unseen seed 903277 at the north pond and west lakeshore. They run ordinary `PopulationRuntime` decisions, finite existing resources and weather with Cardinal disabled. There is no externally scheduled acquisition, initial hunger change, pre-taught food, reset or assistance in these autonomous trials. These are starts in one fixed valley, not independent terrain generation.

Controls retain perception/navigation: cold positive-food-association ablation disables positive food technique formation/use and supported repetition; warm ablation makes the same switch after six game hours of ordinary learning. They preserve actual senses, bodily care, practice, failure/novelty memory and aversion. Full initial-state and pre-positive action hashes match within scenario; each warm arm also matches the candidate's complete first-six-hour action hash. These controls are not described as all learning disabled.

The candidate improves on the new seed, regresses at the development north pond, and changes little at the development lake. All four remain far below energy balance. Positive associations affect these small cohorts, but this is not evidence of a broadly improved autonomous policy. No seed was retuned or removed after seeing its outcome. All sixteen trials passed conservation, finite transfer, no-assistance and privacy checks; maximum human energy residual was 6.12e-8 kcal.

The development lakeshore still makes 130 unsafe-rest retries while depleted, so this change does not solve that loop. Candidate striking occupies 147–373 of each 1,800 simulation seconds. North-pond candidates also retry grasping already consumed object IDs (45 and 48 total `OBJECT_GONE` outcomes), suggesting that reuse needs more than exact-instance recall. These are trace leads for separate policy work, not proof that a particular generalization strategy will succeed.

During these parallel cloud-container evaluations, sampled per-process memory and wall times are recorded in the evidence. They are diagnostic measurements under shared load, not claims about a 32 GB laptop or uninterrupted desktop latency.

The [compact evidence summary](supported-consumption/evidence-summary.json) contains swallowed, pending, absorbed, spent and reserve-change energy, first/second-half outcomes, source fingerprints and raw-report hashes. Raw traces and the independent toxicity assay script are retained in an evidence export, not committed as megabytes of JSON. The recorded parent commit identifies the checkout before publication; exact source fingerprints identify the evaluated candidate.

## Verification and remaining gates

- 352 source tests pass, including 13 new cases for distinct ingestion evidence, missing/rotated proof, new-piece caution, association controls, save/pending identity, actual capacity refusal, finite 90 g consumption, a naturally exhausted 35 g piece, delayed harm, positive-after-harm ordering, and source-versus-regrasp attribution.
- Build, [actual Linux Electron smoke](supported-consumption/native-smoke.json), and [isolated two-process disk reopen](supported-consumption/native-reopen.json) pass. Existing identity, full checkpoint, held item, depleted stock, sleep, clock and Escape-only pause contracts remain. The rendered reopen image was inspected. No physical laptop or live Ollama run is claimed.
- Independent read-only review cleared the runtime and evaluator provenance. The negative-exposure comparison was audited separately. Numerical tolerances remain 1e-6 kcal for body/transfer checks; they were not relaxed to accept a result.
- Cost-blind novelty, energy-depleted unsafe-rest retries, cautious transfer across pieces and bounded evidence rotation remain separate measured or suspected bottlenecks. This patch does not change those policies or rest thresholds. An earlier water effect can still release detail protection before later nourishment; its ordinary incidence remains unmeasured.
- Twelve hours do not test repeated survival, seven-day caloric balance, nutritionally viable corridors, predator-driven relocation or seasonal ecology. Those milestone gates remain open. No generalization or safer-world claim follows from this same-piece shortcut.
