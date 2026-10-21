> Historical finite-stock milestone (schema 11). The current single world uses schema 12 and `aincrad.world.v2`, with bounded feeding, growth and reproduction. The finite-stock trials below remain historical evidence, not a description of the current lifecycle. See [renewable ecology](RENEWABLE-AQUATIC-ECOLOGY.md).

# Finite shore fishing v1

This is one bounded ecological capability, not sustainable fishing or a survival result. The sole current Ozark world (schema v11) contains at most 32 individual, nonrenewing fish, biome structures and witnessed carcass handling together. No world choice or separate fishing mode exists. Retired save slots are not loaded or modified; an empty current slot starts this complete world.

## Physical boundary

The engineered `shore_fish_v1` phenotype begins with 200 g wet mass: 80 g removable tissue (80 kcal, 56 ml water), 100 g structural residue (30 kcal, 60 ml water), and 20 g metabolic reserve (40 kcal, 10 ml water). Water is already within wet mass. These are fixed model coefficients, not measurements for a named biological species.

Fish live only in authoritative signed surface-water/internal-pond containment. Their 3 px footprint remains inside the declared 5–35 px littoral band; motion sweeps at most 2 px per substep. Cruise 6 px/s for 3 s and dart 18 px/s for 1 s, deterministic saved headings/phase/RNG, and the existing surface current rule at a fixed 10 px actor-reference proxy. Ponds have no invented current. This is not measured bathymetry.

Maintenance and active swimming each cost 0.25 kcal/body-hour, including blocked exertion. Only finite reserve funds them. Reserve wet mass leaves through an explicit respiration/export counter and its water through an auxiliary released-water counter. Reserve exhaustion causes death. There is no feeding, growth, birth, immigration, respawn, or refill.

Global energy includes live fish explicitly. The fish-origin mass/energy/water subledger follows live bodies, same-ID specimens, detached tissue, human ingestion, detritus, respiration and cleanup/overflow. Detritus is an export from provenance but remains internal ecological energy. Postdigestive human mass/excretion and full nutrient cycling are not claimed.

## Motor and ownership chain

A genuine recent firsthand observation supplies a fixed aim. Timed `catch` is explicitly seize-and-compress/dispatch, 4 s with effort 1.5 before existing practice reductions. The actor must be awake on dry ground, with current LOS, target within 80 px, and free hands/material capacity. Fish keep moving. At completion the live target must still be in valid water and within 12 px of the observed aim. Misses pay work; no random loot roll, target freeze, reservation, or private re-aim exists.

Capture synchronously transfers the same object ID from live fish to a held whole specimen. Capacity or ownership failure changes no stock. `pull` is ordinary physical tearing, not cooking or cleaning. It transfers at most 100 g actual tissue to a new held material ID. An 80 g specimen is therefore exhausted by its first successful pull; the 120 g-or-less residue remains. Whole-body sampling fails. Detached tissue uses ordinary 30 g samples, finite gut admission, 4-hour digestion, raw-flesh toxicity 0.025 and 3-day spoilage. These reused parameters are not a raw-fish safety claim.

Fish and their materials are not implicitly added to land-fauna diets. Rendering projects only actual objects, including real held specimens/tissue; animation cannot advance physics.

## Honest learning boundary

Capture proves ownership and motor practice only. Actual specimen pull, tissue sample and matching delayed bodily effect can establish the existing exact-specimen `pull → sample` technique. Neither capture-to-sample nor a three-step catch/pull/sample recipe is admitted. No species-wide benefit, habitat return, or capture reuse is learned. Catch is a direct motor action only; it is rejected from multistep model plans rather than accepting a plan that cannot be restored faithfully. Since the first pull exhausts tissue, earned reuse means another sample of the same held piece, not another acquisition from residue. Bare residue displays removable count 0 and cannot be reopened indefinitely by sightings.

Observations contain opaque IDs, local positions, appearance, motion and visible counts, not private compartments, calories, recipes or success probabilities. Generic held pulling is available in the current world, with actual hand capacity and real failures on unsuitable objects.

## Persistence and verification

The current storage key is `aincrad.world.v1`. Schema v11 requires exactly `{plantLifecycle:1,finiteAquatic:1,worldStructures:1}` and the approved structural geometry. There are no old-format migrations or legacy runtime modes. Unknown modes, malformed stocks/IDs/positions, inconsistent ownership or forged retained proofs protect occupied bytes. Active catches restart interrupted with no runtime aim/work witness. No closed-time backfill occurs.

Focused checks:

- `node --test tests/aquatic-physics.test.mjs tests/aquatic-discovery.test.mjs tests/aquatic-save-render.test.mjs tests/aquatic-transactions-native.test.mjs`
- `AINCRAD_NATIVE_AQUATIC=1 node --test tests/aquatic-discovery.test.mjs` runs the separately declared native-policy encounter trials. These are local actor-exposure fixtures, not autonomous travel or survival benchmarks.
- `node scripts/verify-aquatic-desktop.mjs` is the actual Electron two-process disk/render harness. It requires a supported sandbox-preserving desktop executor; a Node roundtrip is not a substitute.
- `npm run check`, `npm run build`, `npm run smoke` remain release checks.

The initial t=0 motor screen missed all 32 fish under normal current. A later physical-motion screen found naturally returning targets and the real timed motor chain succeeds without altering coefficients. Catchability at selected encounters is not robust cold-start autonomous discovery, and gross absorbed energy is not net profitability after misses, work, basal cost and travel. Native desktop evidence and native-policy evidence must be reported separately, including failures or unavailable stages.

## Historical PR38 checkpoint outcome (unchanged diagnostic)

The following results describe the original v10 fishing branch, not the current combined terrain/schema. They are preserved as failures, not relabeled as successful adoption. The user explicitly removed short autonomous-policy success as a capability-release blocker on 2026-10-21. Current release still requires physical, conservation, proof, corrupt-save, native-close/reopen and sandbox gates. A long run may offer more exploration, but finite fish can die or deplete; no feeding, reproduction or replenishment extends that opportunity.

The physical slice and strict regression suite pass, but autonomous adoption does **not** pass. The three predeclared 600 simulated-second local-policy fixtures (74193, 74194, 74195) all produced zero captures, zero fish pulls and zero fish-origin calories. This remained true after the single reviewed v10-only correction allowing generic observed-object experiments to compete with optional understanding-driven swimming/climbing. Urgent bodily care and water escape stayed ahead of experiments; old-world policy stayed unchanged. No coefficients, stocks, seeds, exposure positions or observation windows were retuned.

In the corrected primary trace, a genuine four-second catch starts at approximately 7.317 s, but the moving target leaves the 80 px reach limit by completion at 11.317 s. The actor then explores away from the bank; later catch requests either fail the shore condition or target nonfish objects through generic motor exploration. This is a failed local-policy encounter, not evidence of learned interception or a useful food strategy. The separate manually commanded native-motion chain demonstrates that a naturally returning target can be captured and processed, not that the local policy can select that opportunity.

That historical aggregate check reported 928 tests: 915 passed, zero failed, 11 explicitly skipped and two todo; the native-policy acceptance gate is separate and failed as described above. Build passes. At that local checkpoint, actual Electron rendering and two-process disk persistence were unverified because the executor rejects Chromium's process-singleton socket before app startup. Subsequent PR38 native Linux and Windows checks passed. Those prior-platform results do not validate the current combined build: its own native and regression evidence is required.
