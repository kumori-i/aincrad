# Experienced action selection: bounded experimental comparison

This is a **research candidate, not approved for a main merge**. The selector is disabled by default even on this branch. It is a small local numeric model with engineered scoring/need/exploration weights, not neural training. [Design and exact equations](DESIGN-experienced-selection.md) describe the experiment and its limits.

Actual physical operations now return an action-local qualitative exertion label and their worked duration. Only the experimental selector learns those costs. It ranks already-eligible object operations after the unchanged legacy chooser selects an object opportunity; it does not replace bodily care, navigation, sampling eligibility or physical rules. Delayed food/water/harm association requires the actual sample and ingestion identities. Acquisition association is separately capped and is not a second overall reward.

## Verification

The final frozen source passes **410/410 tests**, `npm run build`, actual Linux Electron smoke, and a two-process isolated-profile reopen. The latter preserves a physically earned cost record as well as the existing finite ecology, held material, sleep and refusal memory. [Native smoke](experienced-selection/native-smoke.json) and [reopen](experienced-selection/native-reopen.json) identify the exact build fingerprint.

An independent two-actor default-policy comparison runs 900 simulated seconds (six game hours), saving and reopening at 450 seconds. Both versions produce the same 531 normalized actions and 104 feedback events, all 108,000 actor-frame physical/RNG checks, 1,800 full-physiology checkpoints and eight whole-world checkpoints. Both 400-event histories rotate after reopening with identical retained evidence; the default creates no selection records. Valid gut contents, physiological totals and feedback survive the real JSON save path unchanged. This establishes parity for that trace, not every possible future run.

Separate fixed-action probes compare 44 direct physiological cases and 114 complete actor/environment checkpoints across 78 completed actions, three seeds, and both 0.25-second and native 1/60-second ticks. Physical states and finite ledgers are exactly equal to merged PR #4.

- The new work suite covers real successful/failed work, zero-work rejection, partial cancellation, practice, finite swallowing, equal-work/name reversal, non-finite metadata, qualitative privacy and reopening.
- The model suite covers counterfactual learned ranking, exact outcome provenance, no reward for accepted no-change commands, persistent exploration, duplicate ingestion handling, future evidence, bounded proof reconstruction, integer zero, independent RNG, runtime-only controls and new-piece motor-cost transfer without inferred edibility.
- Fixed-action comparisons check entire physiological and environmental states against merged PR #4. A separate ordinary default-policy comparison runs through bounded-history rotation and checks normalized actions, feedback, RNG, physiology, the complete world and retained evidence. Normalization removes only additive qualitative work instrumentation.
- Native Linux Electron smoke and two-process isolated-profile reopen include a physically earned learned cost record. Windows is checked separately by exact-head CI; local cloud tests do not establish physical laptop or Ollama performance.

## Causal controls

The new evaluator arms are `selector`, `selector-cold`, `selector-frozen`, and `selector-shuffled`. Cold starts with neutral fixed estimates; it retains ordinary perception, navigation, successful practice, food associations, direct aversion and care. Warm controls run the identical online selector for 900 seconds (six game hours), then freeze cost and exact-target outcome estimates. Shuffled applies a fixed cyclic permutation of operation channels to that same frozen prediction snapshot. It never changes actual world events or saved proof. This is a joint cost/outcome control, not an isolated measurement of one coefficient.

The persisted actor's model in frozen/shuffled arms is the warm checkpoint, not an evolving estimate or a replacement for ordinary negative safety memory. Existing food-association ablation is a separate experiment; these controls do not disable that older learning.

## Interpretation boundaries

A higher intake-to-expenditure ratio can come from reduced work alone. Compare absolute swallowed and absorbed energy, pending digestion, reserve loss, health, first useful discovery, rest and exploration coverage as well. Fewer strikes or a better internal score is not sufficient.

One in eight eligible object opportunities remains exploratory. That is not proof the model can learn long arbitrary prerequisite chains such as hunting. Existing generic acquisition of a previously harmful source remains possible; direct sampling aversion, pending feedback and capacity gates remain authoritative. Two nourishing portions do not establish safety against delayed toxicity.

No food, recipes, destinations, physiology resets, assistance or Cardinal interventions are supplied in the autonomous comparisons. Fresh regions and finite source depletion remain real. No sustained self-feeding, seven-day balance, learned migration or season-scale stability claim follows from this experiment.

## Frozen 24-hour result: reject this scorer

**Do not merge or enable this policy.** All 20 predeclared trials completed, but the online selector absorbed less energy than main in three of four starts and less than its cold fixed-estimate control in all four. Reduced expenditure sometimes improves the ratio or preserves reserves while useful acquisition and movement regress. That is not evidence of useful learned autonomy.

Each row runs 3,600 seconds at native 1/60-second ticks, equal to 24 game hours. Development seed is 74193; seed 773377 was held out for this scorer and is now consumed by diagnosis. The four starts share the same fixed valley, not independently generated terrain. No score was tuned after the development pilot. The raw baseline checkout records pre-merge commit `c2908ea`; all 41 fingerprinted runtime/package files are byte-identical to merged main `3db8304`, which is the study baseline.

| Seed / start | Arm | Absorbed kcal | Spent kcal | Absorbed/spent | Final health | Retained techniques |
|---|---|---:|---:|---:|---:|---:|
| 74193 / pond:north | baseline | 661.4 | 3896.3 | 16.98% | 99.35 | 11 |
| 74193 / pond:north | selector | 604.8 | 3440.9 | 17.58% | 99.31 | 6 |
| 74193 / pond:north | selector-cold | 613.3 | 4072.0 | 15.06% | 99.31 | 10 |
| 74193 / pond:north | selector-frozen | 490.8 | 3365.9 | 14.58% | 99.31 | 4 |
| 74193 / pond:north | selector-shuffled | 1048.7 | 3620.3 | 28.97% | 99.32 | 18 |
| 74193 / lake:west:2 | baseline | 114.0 | 4010.6 | 2.84% | 99.42 | 3 |
| 74193 / lake:west:2 | selector | 143.2 | 3357.6 | 4.27% | 99.37 | 3 |
| 74193 / lake:west:2 | selector-cold | 333.5 | 4046.1 | 8.24% | 99.46 | 7 |
| 74193 / lake:west:2 | selector-frozen | 142.5 | 3330.6 | 4.28% | 99.47 | 3 |
| 74193 / lake:west:2 | selector-shuffled | 142.5 | 3882.8 | 3.67% | 96.40 | 3 |
| 773377 / pond:north | baseline | 702.5 | 3938.8 | 17.84% | 98.73 | 18 |
| 773377 / pond:north | selector | 240.1 | 3447.0 | 6.97% | 98.73 | 5 |
| 773377 / pond:north | selector-cold | 883.8 | 3969.2 | 22.27% | 98.71 | 9 |
| 773377 / pond:north | selector-frozen | 429.5 | 3409.7 | 12.60% | 98.73 | 8 |
| 773377 / pond:north | selector-shuffled | 456.0 | 4091.2 | 11.15% | 98.73 | 1 |
| 773377 / lake:west:2 | baseline | 190.0 | 4015.2 | 4.73% | 98.73 | 3 |
| 773377 / lake:west:2 | selector | 95.0 | 3280.4 | 2.90% | 98.69 | 1 |
| 773377 / lake:west:2 | selector-cold | 403.2 | 4070.4 | 9.91% | 98.76 | 8 |
| 773377 / lake:west:2 | selector-frozen | 169.5 | 3349.3 | 5.06% | 98.69 | 2 |
| 773377 / lake:west:2 | selector-shuffled | 95.0 | 3836.1 | 2.48% | 88.27 | 1 |

These are retained exact-source acquisition/sample techniques, not a count of general skills or independently demonstrated survival strategies. Their confidence labels are existing evidence counts, not calibrated safety probabilities. [Complete compact trial measurements](experienced-selection/evidence-summary.json) include swallowed and pending energy, reserve changes, first feedback time, primitive/source diversity, confidence counts, work/rest time, water condition and action outcomes.

The most severe online north regression is held-out seed 773377: absorption falls from 702.5 to 240.1 kcal, first positive feedback moves from 106.0 to 826.2 seconds, completed inspections rise from 108 to 874, and completed arrivals fall from 91 to 8. At the held-out lake, absorption falls from 190.0 to 95.0 kcal, completed arrivals from 77 to 1, and final water deficit rises from 615 to 3,641 ml. Final health alone conceals this deterioration over the one-day horizon because the body still has stored reserves.

The controls are mixed rather than a new winning policy: shuffled wins development north intake but damages lake behavior, reaching final health 88.27 and a 7,071 ml water deficit at the held-out lake. Cold exceeds online absorption at every start. Online performs zero ordinary rest seconds in all four trials; actual sleep remains 1,187.5 seconds in each, while baseline also completes 375.1–600.1 seconds of rest. All arms lose substantial reserves; none establishes sustained self-feeding.

All four groups have identical initial state hashes. Online/frozen/shuffled also have identical action hashes and recorded physical checkpoints at the six-hour freeze boundary. Those checkpoints contain selected body aggregates/totals, position and scene; they do not include the full gut, world or RNG. Every trial passes the unchanged human energy residual limit of 1e-6 kcal, finite ecology-transfer checks, no-assistance checks and observation privacy checks. The largest residual is 1.168e-7 kcal. [Verification fingerprints and parity counts](experienced-selection/verification-summary.json) connect the measurements to the frozen source and full check logs.

Measured cloud wall time is 95.4–224.7 seconds per 24-game-hour trial, with sampled process RSS 249–327 MiB, while two trial drivers and other development checks share the host. This is a development measurement, not a physical laptop, Windows Electron or Ollama performance claim.

The earlier 12-hour development pilot appeared better on the online ratio (29.51% versus baseline 23.83%) but shuffled was higher still (34.03%). The longer fixed comparison did not support promotion. The pilot remains in the raw evidence export with its own predecessor source fingerprint; it is not substituted for the final frozen cohort.

[Evidence export fingerprint](experienced-selection/evidence-export.json) identifies the separately retained raw reports, parity traces/checkpoints, replay programs and logs. The export is available without committing megabytes of raw traces. Exact-head platform CI is reported on the research pull request; correctness passing does not reverse the negative policy result.

### Failure mechanism under investigation

The experimental override can let one unexecuted high-novelty primitive win the legacy object-versus-movement comparison, then execute a different cheap operation. The unexecuted primitive keeps its legacy novelty. Repeated inspections can therefore continue receiving object opportunities while movement remains excluded. Passive sensing and explicit inspection currently expose the same public descriptor, so an accepted inspection is not evidence of additional information. The completed action traces show the resulting inspection-heavy behavior; the evaluator does not record the pre-override sponsor, so attributing every individual choice to this interaction remains a code-level diagnosis rather than a measured causal decomposition.

This substitution is absent from merged main, which executes its own legacy winner. The failed experiment does **not** establish that main needs an equivalent gate fix. A separate hypothesis must demonstrate its own benefit against main.

Unchanged coarse observations also do not imply no physical progress: repeated strikes can reduce hidden animal health without changing the current public descriptor, and a small swallowed portion can leave a coarse quantity display unchanged. Future experiments must distinguish no new observed information from no physical effect, preserve exact delayed ingestion evidence, and test slow useful prerequisites. No health, nutrition or hidden effect label should be exposed merely to make selection easier.

## Owner opt-in

For an explicit local experiment, set `experimentalSelection` to `true` in `src/discovery-config.js`, then restart with `npm start` (which rebuilds the desktop app). Set it back to `false` to return to the current default. Keep a normal save backup before comparing behavior; changing the flag does not reset an inhabitant, refill resources, erase prior experience or alter physiology. Learned records remain in the save when the experiment is disabled, but default ranking does not use or add to them. There is no UI toggle in this increment.

The owner flag enables only the online selector. Cold/frozen/shuffled prediction controls require an explicitly supplied developer runtime/evaluator option; saved values and language-model output cannot select those modes.
