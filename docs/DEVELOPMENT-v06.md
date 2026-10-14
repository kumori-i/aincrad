# Approved v0.6 implementation contracts

The first ecosystem milestone includes discovery primitives and learned routines, human physiology/digestion in game time, vulnerable sleep, finite seasonal grass/bramble/mature apple resources, simple rabbits/bobcats/foxes, decomposition, and explicit pause independent of focus. Later: fish ecology, large predators, climbing, tools, cooking, cultivation. This is a configurable simulation, not validated clinical physiology or a human brain.

## World and compatibility

- Fresh `freshState()` has save version 5, `simulationMode: 'discovery'`, two `createNpc({id,mode:'discovery'})` characters, and authoritative `environment.ecology`.
- `createNpc()` defaults to legacy for historical engine fixtures/API compatibility. New NPCs with mode discovery have version 4 and `mode:'discovery'`. v1–v4 world saves restore as `simulationMode:'legacy'`, with existing memories/body rules. New expeditions use discovery; never silently delete an existing saved world.
- Ecology lives ONLY in `environment.ecology`, not a duplicated root property. `tickEnvironment` advances the single clock/weather; discovery skips the old 600-second apple refill. `PopulationRuntime.tick` calls `tickEcology` once, then human controllers. Runtime attaches appropriate body/awakening callbacks if needed.
- Native test hooks remain test-only. Renderer and UI never change bodies/ecology as a side effect of drawing/refreshing.

## Body owner

Own `src/biology.js`, `src/biology-config.js`, `src/npc.js`, `src/npc-state.js`, `src/interoception.js`, new biology tests. Preserve legacy functions/rules. Export `createPhysiology`, `validatePhysiology`, `tickPhysiology(actor,dt,conditions,options)`, `ingestMaterial(actor,material,provenance)`, `exertPhysiology(actor,seconds,effort)`, `wakePhysiology(actor,reason)`, and `isSleeping(actor)`. Signatures may be refined via owner messages before integration.

Discovery actors keep existing projected `hydration/nourishment/energy/stamina/fatigue/sleepPressure/thermal/health` fields for drawing/debug; private `physiology` owns digestive inputs, available/stored energy, deficit water, sleep state/inertia and delayed qualitative feedback. Physiology is in game hours/days, scaled from CONFIG.dayRealSeconds. Animals may reuse generic helpers with species profile overrides. No exact bodily telemetry in agent-facing data.

`requestNpcAction` dispatches discovery object primitives to `requestDiscoveryAction(npc,raw,environment,{complete})` and `tickNpc` dispatches their timed completion to `tickDiscoveryAction(npc,dt,environment,{complete,exert})`. Those exports live in `src/discovery-actions.js`; it MUST NOT import npc.js (avoid cycle). Active object interactions have `kind:'interaction'` so they never enter route processing. Existing physical movement, water and cave actions remain bounded/validated. Food macros (`gather_food/eat`) are refused for discovery characters. Sleep may last game hours, continues physiological cost and has limited arousal rather than perfect visual perception. Legacy action behavior remains intact.

## Ecology owner

Own `src/ecology.js`, `src/ecology-config.js`, new ecology tests. APIs: `createEcology(seed,elapsed=0)`, `validateEcology(raw,{seed,elapsed})`, `tickEcology(ecology,dt,environment,agents,callbacks={})`, `senseEcology(ecology,position,scene,radius)`, plus physical object/harvest/interaction APIs agreed with discovery owner.

Canonical bounded state tracks plants/biomass/finite seasonal fruit, animals with species bodies/local instincts, detached materials/carcasses, decomposing matter, births/deaths and resource budget. All objects have stable opaque IDs (`object:N` etc), scene and position. Private species/material/energy/diet metadata never appears in senseEcology. Public sensory objects expose appearance (shape/color/texture/motion/sound), position, visible quantities and observed changes, without food/prey/edibility/nutrition labels. Physics lookup and mutation APIs are for authoritative action execution only, not agent queries.

Animals feed/flee/rest/sleep/seek water via deterministic non-LLM controllers and finite shared resources. Body size/diet/speed/sleep/reserves vary. Predation consumes effort and requires contact/physical results; threat can wound/wake humans through callbacks, never silently manipulate inventories or fabricate human outcomes. Avoid permanent human predator corpses in divine recovery mode; outside rescue energy must be counted.

## Discovery owner

Own `src/discovery.js`, `src/discovery-state.js`, `src/discovery-actions.js`, `src/discovery-config.js`, `src/controller.js`, `src/cognition.js`, `src/npc-memory.js`, `src/perception.js`, new discovery tests.

`createDiscoveryMemory/validateDiscoveryMemory` reside in discovery-state.js and are imported by npc-state/save validation owners. Branch NpcController for mode discovery, keeping legacy behavior intact. Discovery controller advances tickNpc once, observes only awake (sleep senses limited), uses generic primitives and measured qualitative effects, handles water/caves via locally observed routes, actual bodily care and social actions without supplied food recipes. Do not use a pretrained model as the physical experiment/food oracle in strict mode. Keep optional model use explicitly labeled and separated from physical cold-start choices.

Primitive examples: inspect_object, grasp, release, pull, sample, strike. No initial forage/hunt/climb recipes. Implement low-level anatomy/reach/ownership/physical material effects, elapsed time/exertion and delayed digestion. Material inventory uses `inventory.items` (legacy apples retained only legacy). Confidence in material effects is separate from proficiency; macros require actually executed evidence and positive effects. Repetition without actual valid practice gives no free skill/energy. Only own grounded observations or explicit human reports can seed food beliefs. Animal motion/diet metadata cannot become human food instructions.

## Persistence/social owner

Own `src/save.js`, `src/world.js` freshState ONLY, `src/environment.js`, `src/population.js`, `src/social.js`, save/population/social tests. Coordinate validators and initialization above. Preserve unknown future saves/read errors without overwriting. Update social templates in discovery to use discovered facts/uncertainties, never generic apples-are-food scripts. Human instructions are reported hypotheses/proposed techniques until physical confirmation; replies optional and sleep delivery queued. Sleeping actors do not receive full visual peer/object knowledge.

## Presentation owner

Own `src/art.js`, `src/renderer.js`, `src/npc-panel.js`, `index.html`, `style.css`, renderer QA tests if useful. Draw actual persisted plants/animals/materials in discovery, remove duplicated ambient decorative animals there; legacy scenery remains supported. Show qualitative body/digestion/sleep and discovered object/skill journals, provenance and experimental progress. No exact hidden properties/answer buttons in ordinary agent displays. Show expedition mode and explicit speed controls (root main wires them). Avoid page-like styling; keep static pixel parchment/wood design.

## Bridge/docs owner

Own desktop/model-provider.cjs, desktop/preload.cjs, provider tests and README/architecture/ROADMAP/local-model example. Discovery observation/optional dialogue contracts coordinated with discovery owner: strict physiology strings/opaque sensory objects, grounded experience; no old apple recipes in discovery prompts. Label pretrained suggestions and prevent them from becoming direct cold-start physical actions/verified facts. Legacy bridge remains compatible. Docs report capabilities and limits accurately; no validation claims before root confirms final checks.

## Root

Own src/main.js, desktop/main.cjs, package/version, config VERSION only, explicit background timer/keyboard pause/speed wiring, AGENTS, final evaluation script/results, TESTING/check-output, native QA, integration and GitHub publication. Root coordinates interfaces, tests realistic game-time windows including sleep/arousal and food renewal, runs desktop/minimized/background/explicit pause checks, verifies disk persistence, then publishes with expected head and checks Windows/Linux CI.
