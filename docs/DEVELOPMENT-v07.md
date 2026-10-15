# Approved v0.7 Cardinal and atlas contracts

The owner authorizes development and publication of an autonomous Cardinal world manager, ecology across the entire walkable valley, and an M atlas that zooms/pans and shows both human characters. This extends v0.6 without replacing the desktop/npm workflow, pixel art, explicit Escape pause, strict discovery, qualitative human senses or existing saved progress.

## Authority and data

Cardinal observes full engine diagnostics and governs world parameters through validated authoritative APIs. Its first live abilities include ecological growth/yield, animal habitat/foraging/reproduction and climate parameters, with bounded changes, paired experiments and persisted outcome learning. Cardinal never injects edibility, techniques, completed actions or memories into an inhabitant. World management can guide opportunities; the inhabitants still learn through experience. New mechanics/arbitrary source rewriting need a separate tested development process, not executable text in a save.

Canonical manager state is `state.cardinal`, schema 1. World save schema is 6; versions 1–5 migrate. V5 discovery worlds preserve all actors, materials, IDs, memories and histories while missing regional habitats are added once with their external energy recorded. Legacy worlds keep legacy agents/rules and do not silently become discovery. Unsupported future world/component versions remain protected from overwrite.

Canonical live knobs are `environment.worldRules = {version:1, revision:0, values:{plantGrowthMultiplier:1, fruitYieldMultiplier:1, animalForagingRangeMultiplier:1, animalReproductionMultiplier:1, temperatureOffsetC:0, rainfallMultiplier:1, windMultiplier:1, seasonLengthMultiplier:1}}`. No duplicate `environment.rules`. `world-rules.js` exports `createWorldRules`, `validateWorldRules`, `getWorldRule(environment,key)` and atomic `applyWorldRules(environment,patch,{expectedRevision}) -> {ok,code,changes,before,after,revision}`. Reject unknown/nonfinite/out-of-range changes. Human physiology, time scale, perception and evidence criteria are not automatic tuning shortcuts. Do not automatically change season length in this initial release, because elapsed-calendar rescaling could jump seasons.

## Cardinal core

Owner: cardinal_core_v07. New cardinal.js, cardinal-state.js, cardinal-config.js and focused tests. Export createCardinal, validateCardinal, CardinalRuntime(state,{experimentFactory,...}). Methods tick(dt), work(budget), setMode(off/observe/adaptive), cancel/dispose. Fresh discovery defaults adaptive. Observation is cheap and runs on saved simulation time; expensive experiments run incrementally outside physics ticks. Persist bounded diagnoses, hypotheses, proposals, decision/rollback history and contextual intervention statistics. Actual measured results, not persuasive narration, update the intervention policy. Diagnose navigation/engine failures separately from resource scarcity.

## Controlled experiments

Owner: cardinal_experiments_v07. New cardinal-experiments.js and cardinal-metrics.js plus tests. Inject a runtime factory to avoid imports/cycles through population. `createCardinalExperiment(snapshot,proposal,{runtimeFactory,seeds,horizonSeconds})` returns work(maxSteps), done/result, cancel, serialize. Proposal has id, parameter, from, to, reason, context, at. A candidate uses the same checkpoint/seed as its control, with only the proposed world rule changed; include held-out conditions. Default shadow dt .25 is explicitly recorded. Limit work chunks to roughly 8 ms, total steps/memory, and concurrent jobs. Every shadow runtime has Cardinal disabled. Running replicas are transient and must not be serialized as successful or replay their outcomes after restart.

Collect actual absorbed/spent energy, water balance, condition, critical burden, actual grounded skills/practice, rescues/outside assistance, route stalls, resources/populations and ecological budgets. Passing a structural invariant is not proof of long-term stability. Reject harmful or unsupported proposals; adopt only actual validated improvements. Preserve candidate/control evidence, seeds, source/rules versions, rationale and measured limits. Require a frozen-world comparison and distinguish learning progress from extra free support.

## Ecology and distribution

Owner: ecology_controls_v07. Own ecology.js, ecology-config.js, world-rules.js and ecology tests. Cover all walkable map regions including far north/south/east/west and quadrants, with deterministic habitat sampling and water/food-aware animals. Failed placement must not fall back to the Trailhead. Raise bounded capacity as needed and use local/spatial queries so broad coverage remains usable. Export `migrateEcologyDistribution(ecology,version=2)` for additive one-time migration, returning change/addition/energy metadata. Fix observed animal navigation stalls with physical movement/path logic; Cardinal should not hide defects by removing thirst. Draw from canonical ecology; no decorative duplicate animal populations.

## Persistence and runtime

Owner: persistence_v07. Own save.js, environment.js, population.js, world.js freshState only and integration tests. Wire dynamic climate rules into actual conditions, validators and saves. PopulationRuntime(state,{cardinal:false}) constructs shadow runtimes without a recursive manager. Inject actual experiment/runtime factories into CardinalRuntime. Tick environment/ecology/each body once; observe Cardinal after physical results. Expose runtime.workCardinal(...) for root's independent timer and manager controls for the owner UI. Pausing/not-yet-started stops both physical progression and experiment work; background/minimized continues. Disposing/reset/restart cancels transient jobs without manufactured results or loss of learned outcome history.

## Atlas and presentation

Owner: atlas_ui_v07. Own renderer.js, new atlas.js, cardinal-panel.js, index.html, style.css and presentation tests/isolated QA. Renderer atlas methods: drawAtlas(target,state,{scene?}), atlasPoint(canvasX,canvasY), atlasZoom(factor,canvasX?,canvasY?), atlasPan(dxCanvas,dyCanvas), atlasFit(), atlasCenter(id,state), atlasMarkerAt(canvasX,canvasY), atlasStatus(). Valley overview independent of camera follow; cave occupants anchor to their actual world entrances with labels. Distinct visible player/Aster/Mira markers, live refresh, wheel/+/- zoom, pointer drag, fit and center controls. Point transforms stay correct across zoom/pan and letterboxing; dragging cannot create a waypoint. Cardinal panel shows modes, diagnoses, measured experiments, world changes and learning history, using textContent and pixel styling. All drawing/refresh is read-only; owner UI knowledge never becomes NPC knowledge.

## Evaluation and docs

Owner: cardinal_eval_v07. README, architecture, ROADMAP, TESTING, evaluate-cardinal script and recorded results. Preserve historic v0.6 data as historical evidence. Run actual manager experiments/adoption/rejection/learning, guard against live mutation and causal confounding, measure distributed-world performance. Clearly identify accelerated test scheduling versus normal rates; never report unrun checks or assume indefinite ecosystem balance.

## Root integration and publication

Root owns main.js, desktop/main.cjs, package/version, config VERSION only, AGENTS, this contract, source verification, native QA, check output and publication. Wire atlas controls and Cardinal work/UI, preserve secure desktop bridge/background behavior, test actual map gestures/live markers/owner controls, native pause/background and disk restart. After source freeze run all checks/build/smoke, review actual Cardinal evaluation, prepare the publication helper manifest, preserve history with expected-head/no-force update, and verify Windows/Linux CI.
