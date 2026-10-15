# v0.8 development plan: regional ecology and grounded adaptation

Status: **first bounded regional ecology foundation implemented; later milestones planned**. This is a development contract and acceptance plan, not a record of completed implementation or successful survival. [TESTING.md](TESTING.md) records the v0.7 evidence; new results must identify their own source revision and horizon. The package version need not change merely because this plan exists.

The goal is a materially constrained valley in which different places offer different opportunities, inhabitants can learn useful physical sequences and choose relocation from experience, and Cardinal can test bounded local changes. More objects, longer-lived initial reserves, or a persuasive explanation do not establish those capabilities.

## 1. Preserved boundaries

- Preserve the human-controlled avatar, Aster and Mira, valley geometry, lake/river, enterable caves, pixel desktop application, npm workflow, approximately five-minute reference crossing, and one-hour game day.
- Preserve all valid saved objects, identities, held material, bodies, histories, memories and authored artifacts. A migration must never replenish a depleted old world. Do not restart an expedition to hide a failure.
- Keep `world.js` and the physical action APIs authoritative. Drawing, model text, plans, tests and Cardinal proposals cannot complete physical actions or grant inventory, health, techniques or memories.
- Inhabitants receive local observations and their own remembered experience. Private regional stocks, prey estimates, future weather, supervisor diagnoses and the owner's atlas remain outside their observations.
- Use the saved simulation clock. Explicit pause stops physics and shadow work; minimizing does not. Closing the application does not advance or backfill time.
- Keep local-first, offline-capable runtime and behavior training. No signup, telemetry, required cloud runtime, paid inference API, dedicated GPU or agent OS/shell access. The Electron sandbox, strict asset protocol and narrow local model bridge remain intact.
- Additional human population, construction and society remain later work. Do not obtain apparent complexity by granting ready-made professions, recipes or social roles.

## 2. Baseline and immediate diagnosis

The v0.7 code distributes repeated habitat templates across the valley, uses an aggregate detritus/soil pool, and exposes bounded global Cardinal rules. Its discovery controller records executed primitive outcomes and delayed bodily effects; it also contains supplied exploration, water care, navigation, two-step technique construction and urgency priorities. These are concrete starting mechanisms, not a blank mind or a trained general behavior model.

Historical v0.6 trials found food discovery but inadequate intake and substantial animal losses. The v0.7 full-world probes rejected adjustments that failed to help within their short windows. The isolated producer fixture demonstrated automatic intervention on actual grass growth, without humans or animals. None establishes adequate human nutrition, reliable relocation, stable predator populations or seasonal balance.

Important time conversions, with normal `CONFIG.dayRealSeconds = 3600`:

| Simulation duration | Game time | Appropriate interpretation |
| --- | --- | --- |
| 30 seconds | 12 game minutes | Lifecycle/debug probe |
| 900 seconds | 6 game hours, one quarter-day | Current normal Cardinal candidate window |
| 3,600 seconds | 1 game day | Diurnal/body-cycle check |
| 7,200 seconds | 2 game days | Short baseline comparison |
| 25,200 seconds | 7 game days | Initial repeated-survival gate |
| 108,000 seconds | 30 game days | Longer depletion/population diagnostic |
| 432,000 seconds | 120 game days | One current ecological year |
| 864,000 seconds | 240 game days | Two current ecological years |

A 900-second experiment cannot establish multi-day survival or seasonal sustainability. With a changed calendar multiplier, report the actual calendar interval as well as simulation seconds. Do not accelerate biology or shorten a season merely to call a short test a seasonal run.

## 3. Milestone A: regional ecological foundation

**Status: first bounded increment implemented; measured limits in [regional verification](TESTING-regional-foundation.md).** This first bounded increment concerns world structure, local accounting, initial placement and safe migration. It does not include a completed relocation learner or regional Cardinal policy.

### Regional habitat contract

Derive stable region descriptors from actual terrain, water access and climate/exposure inputs. Distinguish wetter banks, meadow/wooded areas and drier/exposed ground when the engine supports those distinctions. Derive names and suitability from real features; a checkerboard label alone does not establish ecological variation. Record the derivation/version and deterministic region ID.

Use bounded suitability rules to vary producer mix, capacity, moisture and animal starting density. Not every region must contain every species. A walkable region can be naturally sparse. Distinguish a region's potential production, its accessible current material and a human's learned ability to obtain that material.

Fresh predator placement must be sparse, water-accessible and supported by reachable prey/forage under a declared initial heuristic. Record predator density, reachable prey, travel cost and failed placement reasons. An initial prey count is not evidence of sustainable predation; later population/energy measurements must test it. Failed placement remains absent rather than falling back to the Trailhead.

### Finite local stocks and transfers

Maintain finite regional soil stocks. Plant production draws from the plant's actual region; litter and decay return nutrients at their physical location. Carried material moves with its carrier, and dropped material/carcasses enter the destination region through a recorded transfer. Prevent remote regions from spending the same aggregate stock or instantly sharing returned nutrients.

Keep energy and nutrients distinct. Photosynthesis is an explicit energy input; digestion and metabolism dissipate energy. Recycling nutrients does not recreate consumed calories. Declare the units and approximations of the soil model, including any unmodeled erosion, weathering, runoff or water reservoir. Do not call an approximate nutrient pool a complete hydrological or biogeochemical model.

Each resource audit must expose opening stock, production/input, transfers in/out, consumption, decay/loss, closing stock and residual. Retain the global energy ledger as a separate conservation check. Initial stocks, migration transfers, later outside additions and divine assistance need distinct provenance.

### Corridors and stepping stones

Audit habitat connectivity with authoritative collision and actor radii. Check actual traversable segments/routes and drinking-bank access; straight-line distance between anchors is insufficient. Emit connected components, unreachable anchors, maximum uncovered path gap, route length and detour ratio.

Fresh worlds may receive vegetated stepping stones on verified corridors, subject to local soil, placement and object-count bounds. Count those plants in the initial world ledger. Do not assert that a corridor is viable for a hungry human solely because it is walkable or contains grass. Report available material, travel/effort cost and actual acquisition demands separately. These audits are developer knowledge, not an inhabitant route oracle.

### Migration contract

1. Validate and preserve the existing state before constructing regional metadata. Do not call fresh-world seeding to restore an old save.
2. Partition the old aggregate soil/detritus stocks deterministically into regional state. The sum must match the pre-migration stock within a declared numerical tolerance; never add a default stock to every region. Where old material lacks location history, disclose the chosen allocation approximation.
3. Preserve object IDs, positions, quantities, depletion, held ownership, carcasses, animals, body stores, Aster/Mira memory, notes, world time, Cardinal evidence and existing outside-assistance history. No additions of fruit, animals, plants or calories as a side effect of the new migration.
4. Persist an explicit migration/version marker and prove idempotence through repeated validation and disk restart. A zero-stock world stays zero-stock on migration. A migrated world need not acquire the richer fresh-world layout.
5. Keep historical legacy rules rather than silently converting legacy expeditions to discovery. Reject unsupported future versions without overwriting their source save. Never silently discard valid content to meet a new cap; surface an incompatible state and retain the original.

### Acceptance gates for this increment

- Identical seed/version produces identical regional layout; deliberately different terrain/water conditions produce measurably different habitat descriptors or suitability. Record distributions rather than just the number of occupied cells.
- Fresh placements pass collision/radius checks and recorded water/prey prerequisites. Corridor failures are reported and not relabeled as connected.
- Exhausting one region's soil prevents its nutrient-limited growth even while another region remains fertile. Local decomposition benefits the destination region; it does not refill all regions.
- Local transfer, decay and plant-growth fixtures reconcile their stock ledgers. Proposed numerical gate: residual no greater than `max(1e-6 units, 1e-9 * total ledger throughput)` for each conserved accounting unit; publish the exact tested tolerance.
- Migration fixtures include empty/depleted, partially depleted, held-material, carcass, sleeping/digesting, legacy and future-version saves. Compare canonical before/after fields and total stocks, then repeat migration and real disk reopen. Only explicitly permitted metadata/representation changes are allowed.
- Run native-step headless baseline, `npm run check`, `npm run build`, and affected native persistence/visual checks after the implementation freezes. Report failures and unrun stages. Structural passes alone do not pass the later survival gates.

## 4. Milestone B: caloric throughput and learned physical sequences

**Status: planned. Depends on A's accounting and reproducible fixtures.** Diagnose the bottleneck before adding food or another action priority. A beneficial taste or technique counter does not prove sufficient meals.

### Measure the full acquisition pipeline

For each actor and scenario record:

- time to local encounter, first relevant manipulation, detached material, swallowed portion and delayed absorbed benefit;
- attempted/valid/failed primitives, failure codes, action duration and actual effort, navigation stalls, interrupted sequences and retry loops;
- observed source stock, detached mass, held mass, discarded/spoiled mass, bite size, digestion delay and stomach/carry limits;
- absorbed kcal versus basal/activity/metabolic expenditure, reserve trend, water intake/loss, condition, sleep opportunity, injury and rescue/imported energy;
- time spent searching, manipulating, waiting for feedback, eating, resting/sleeping and travelling;
- provenance for every retained technique and contribution of practice, empirical effect memory, sequence choice and supplied action priorities.

Test concrete candidate causes independently: insufficient portions, long feedback waits, discarding useful held material, repeated exploration after useful evidence, failure to repeat a supported sequence, exhaustion interruptions, source depletion and unreachable water/food. Do not infer all failures are scarcity from a low body-energy score.

A sequence learner may rank/reuse bounded sequences from executed experience and link later effects to the exact ingestion/action chain. It must preserve uncertainty, revise harmful hypotheses, pay every physical cost, handle depletion and interruptions, and transfer cautiously across locally observed similar objects. It cannot receive a food dictionary, successful recipe, hidden nutrition label or fabricated positive example.

### Local CPU learning and causal controls

Start with an inspectable small policy/value or sequence-selection baseline rather than assuming a large neural model is necessary. If a learned model is added, document its trainable parameters, features, update rule, reward provenance, replay size, random seeds, checkpoint format and measured CPU cost. Learning-disabled must mean exactly which updates/read paths are disabled, not merely removal of one legacy learner.

Use matched copies with the same initial world, bodies, senses, primitives, supplied care/navigation, action budget and RNG policy:

1. Current supplied controller as the unchanged baseline.
2. Learning-enabled candidate with actual observation/action/outcome updates.
3. Same candidate with persistent learning updates disabled and no preloaded successful experience; retain transient execution state needed to perform the same primitives.
4. A trained-policy checkpoint with updates frozen during evaluation, when training across episodes is used. Keep this distinct from a zero-knowledge cold start.

Add targeted ablations for sequence reuse, delayed credit assignment and practice where useful. Preserve necessary local perception/navigation in the main learning-disabled control so its failure is not simply blindness or inability to move. Counterfactuals that erase all memory are separate destructive ablations. Training/test leakage, model-origin language and direct human advice must be tracked independently.

### Remote starts and acceptance

Predeclare at least eight development and eight disjoint held-out scenario seeds, spanning at least four terrain/water-access classes and distant starts in every quadrant. Include low-stock/depleted starts, changed opaque IDs/appearances, an interrupted/reopened run, misleading reports in a separate condition, and a reachable-resource control. Do not pick starts after seeing results. Reusing the fixed valley with different RNG seeds or checkpoints is not independently generated terrain; describe it accurately.

Run two-day diagnosis first, then seven-day matched trials before claiming useful repeated self-care. For held-out trials, report every actor/seed, paired effect sizes and uncertainty. Initial engineering advancement targets, to be frozen before final evaluation:

- Every technique credited as learned has a valid executed evidence chain; no privacy-boundary violations or unaccounted gains.
- Learning-enabled median absorbed/metabolized kcal ratio over the final three days is at least 1.0, with at least 75% of evaluated actors meeting that ratio, no outside assistance, and reported reserve/condition trends. This is a finite-horizon nutrition target, not a universal survival promise.
- The paired learning-enabled minus disabled improvement in final-three-day energy ratio is positive with a reported 95% paired-bootstrap interval above zero (resample matched scenario-seed clusters, not correlated actors as independent trials), and the enabled controller does not materially increase injury, collapse or water-deficit burden. Freeze the resampling method and non-regression margins in the evaluation manifest.
- Inspect failures individually. An unreachable or deliberately barren start can be an expected failure if declared before the run; it cannot be removed afterward to improve the result.

If these gates fail, publish the failed result and address its measured mechanism. Do not lower thresholds after inspecting held-out results or treat remaining stored reserves as successful feeding. Any revised hypothesis receives a new evaluation version and fresh held-out conditions.

## 5. Milestone C: observed threat, viable relocation and animal movement

**Status: planned. Depends on A and B.** The existing local escape after experienced contact is a baseline, not completed relocation reasoning.

Humans should build bounded local threat memories from actually perceived pursuit, contact, pain, disturbance or other observable events. Innate/supplied responses and learned threat estimates must be labeled separately. Test both anticipatory behavior from locally observed danger and correction after painful contact. Hidden predator species, distant positions and developer risk maps cannot become human knowledge.

Relocation must choose among remembered reachable places or progressively observed frontiers, using uncertain remembered water, material, shelter and threat evidence. Explore unseen ground step by step. No injected safe destination, teleportation, preloaded path, global food scan or arbitrary reset of the exploration home. A new home/working area must follow actual movement and observations. Old memories retain provenance rather than being rewritten to justify the move.

Animal displacement uses physical locomotion, collision, perception/forage rules, travel time and metabolic costs. Track identity across region boundaries. Distinguish resident movement, emigration, births, deaths and outside immigration. A new external animal is an explicit addition with origin, energy and any supervisor intervention cost; moving an existing predator is not immigration. Do not teleport predators away to pass a safety fixture.

Acceptance fixtures include no threat, transient visible threat, repeated pursuit/contact, lost contact, competing threats, a safe but resource-poor alternative, a viable remembered alternative, and an occluded/disconnected apparent escape. Keep the world identical except for the declared threat condition. Measure threat exposure, injuries, route validity, decision latency, relocation distance/cost, arrival, subsequent food/water acquisition and return to danger.

Before advancement require zero knowledge leaks/teleports, physical evidence for every region crossing, and reproducible reduction in threat-exposure time and injury burden versus the baseline on the declared solvable held-out fixtures. Register effect thresholds before running. Continue each successful arrival for at least one game day and require actual water/food acquisition without assistance; mere distance from a predator does not establish viable relocation. Report unsolved starts without supplying a destination to make them pass.

## 6. Milestone D: bounded regional Cardinal interventions

**Status: planned. Depends on A's regional ledgers and B/C's diagnostic separation.** Cardinal retains private diagnostics, but regional knowledge never enters inhabitant memory. Global parameter adaptation already present in v0.7 is separate from this proposed capability.

Every new regional actuator needs an engine-defined contract with:

- intervention ID, allowed region(s), mechanism and version, expected world-rule revision;
- observable/private diagnostic justification and explicit prerequisites, including source stock, water, habitat suitability and actor/resource availability;
- magnitude/area bounds, start time, finite duration and expiry rule;
- physical resource/work cost, or an explicitly external intervention budget where no in-world physical mechanism exists;
- maximum concurrent operations, per-region and global cooldowns, rate limits and conflict rules;
- measured expected benefit, non-regression checks, monitoring window, rollback/abort conditions and historical provenance.

A rainfall adjustment must account for its modeled external water input and bounds. A nutrient transfer requires a source, destination and debited quantity. A managed introduction is recorded immigration rather than spontaneous birth. Increasing access/foraging range cannot skip physical travel. No intervention may heal bodies, refill inventories, teach recipes, grant route knowledge or erase the costs of a previous attempt.

Each experiment starts candidate/control copies from the same complete checkpoint and frozen runtime, with Cardinal disabled inside both. Change one declared intervention only. Use multiple training pairs, untouched held-out seeds and disjoint regional checkpoints. Separate fast 900-second screening from at least two-day and then seven-day promotion tests for effects involving intake, reproduction or relocation. Slower ecological effects require their appropriate season horizon. Failed/insufficient experiments yield rejection or more observation, never invented evidence.

Adoption requires a preregistered positive effect on the diagnosed target and no material damage to bodies, local/neighbor stocks, population viability, resource ledgers or outside-assistance burden. Compare against observation-only worlds and a frozen-policy control over the same interval. End interventions and continue observation to test whether a gain persists or merely spent finite reserves sooner.

Rollback restores reversible settings or stops remaining work. It does not resurrect organisms, rewind time, remove memories, refund spent nutrients or undo travel. Record irreversible losses and any permitted compensating action separately. Save/restart must preserve duration/cooldown/cost/monitor state, discard incomplete replicas as interrupted, and never claim their result. Avoid a cycle of repeatedly adopting, rolling back and retrying the same failing intervention without new evidence.

## 7. Milestone E: seasonal persistence and laptop readiness

**Status: planned; shorter resource/performance checks apply at every earlier milestone.** Stability claims must be limited to measured conditions and horizons.

### Ecological persistence gates

Use 7-day and 30-day diagnostics, then at least one complete 120-day cycle for every declared seasonal start class. Require two consecutive cycles on selected untouched held-out scenarios before describing the tested system as seasonally persistent. Include resource-poor, predator-heavy and drought/exposure conditions, observation-only controls, and an intervention-off continuation. The existing evaluator's 30-day cap must be explicitly extended or replaced with a tested continuation runner before attempting year-length claims.

Measure region/species population trajectories, births/deaths, age structure, feeding and water intake, predation/contact attempts, chase costs, migration, producer/soil recovery and decline, detritus, carried stock and outside inputs. Separate extinction, replenishment, static survivors living on reserves and real reproduction. Publish minimum/maximum/final populations and stocks, not just the final count.

Required structural gates remain zero unaccounted creation, valid nonnegative stocks, bounded populations, no save-induced refills and physical transfer provenance. Ecological outcome targets must be specified per habitat/species: natural sparse habitats need not support every species, and local extinction is a possible measured outcome. A claim of persistence requires the declared populations/resource processes to remain viable across the tested cycles without unreported reintroduction or rescue. A finite test never proves indefinite sustainability.

Check checkpoint/resume against uninterrupted controls, including season boundaries, actor movement between regions, pending digestion, long sleep, material decay and Cardinal expiry. Large timesteps require convergence comparisons against native `1/60`-second slices, especially for encounters and starvation; record divergence rather than claiming interchangeable traces.

### Local hardware budget

Target varied laptops with 32 GB RAM and 1 TB storage, including CPU-only integrated-graphics machines. Treat those as total system resources, not an allocation entirely available to Aincrad. Benchmark at least three named CPU/OS configurations before claiming broad laptop suitability; record cores, RAM, power mode, OS, game population and model settings. A container benchmark is not a physical-laptop result.

Initial budgets, to be measured and revised explicitly before release claims:

- ordinary engine plus renderer peak resident memory at most 4 GB in the declared bounded world;
- combined game, optional local language and optional behavior training under 24 GB, with training/inference reduced or deferred before memory pressure harms play;
- native-step engine p95 at most 8 ms and p99 at most 16.7 ms on each target machine, alongside measured rendered frame pacing and UI/pause latency;
- one active bounded training/shadow job by default on constrained hardware, cancellation on explicit pause, bounded checkpoints/replay/logs, and a default artifact/cache cap of 100 GB;
- offline launch, play, persistence and behavior learning pass with external networking disabled. Optional Ollama unavailable, stopped or over budget cannot break care or physical decision-making.

Measure cold start, long-session memory growth, autosave size/latency, checkpoint-copy spikes, full-valley rendering, shadow concurrency, training throughput and background/minimized operation. Keep CPU training pausable/checkpointable; do not promise a training duration before measuring it. Test power-saving/constrained modes with fewer shadow steps and lower diagnostic frequency without changing physiology or simulation semantics.

Ollama is optional local language generation, separately evaluated and budgeted. Pretrained language associations, experiential records, local policy/value training and Cardinal outcome statistics are different mechanisms. No claim of LLM fine-tuning follows from saving gameplay memories. No paid cloud service is a fallback dependency.

## 8. Later mechanics and society

After material and learning gates pass, develop one mechanism at a time in isolated source-tested copies: additional seasonal plants/invertebrates, finite aquatic prey/fish, reachable climbing, material processing, tools, traps, cooking, cultivation and construction. Each needs explicit inputs, work/time/energy costs, spatial/reach constraints, failure modes, observable outputs, save migration and conservation tests. Descriptions never create finished tools or food.

New executable mechanics are a separate software-development process. Cardinal may propose a hypothesis, but runtime text/saves cannot edit source, execute code or deploy it. Review the isolated change, run focused plus aggregate tests and physical experiments, then promote through a versioned application update with rollback compatibility. Preserve the live expedition while experiments run.

Only then evaluate transfer of uncertain knowledge, exchange of finite supplies, joint work, conflicting needs, specialization from practiced competence and persistent shelter/settlement activity. Cooperation must improve measured outcomes against matched solo/control conditions and pay coordination/material costs. New human population and reproduction require separate explicit designs and gates. Do not label scripted dialogue or assigned jobs emergent society.

Research can inform hypotheses without importing claims or implementations. Keep original code; do not copy EVAAA noncommercial/share-alike implementation code into Aincrad. Check the actual license before any external code reuse, and attribute any research used. No outside paper's result is proof that Aincrad's mechanism works.

## 9. Evidence and release protocol

1. Freeze a candidate revision before evaluation. Hash every relevant runtime/configuration module, evaluator/fixture, dependency lockfile, training checkpoint and initial save. Record the commit, dirty state, seeds, versions, dt, clock/calendar, overrides, learning mode, Cardinal mode and hardware.
2. Allocate development and held-out scenarios before tuning. Preserve that manifest. Held-out means unused in selection; changing future RNG on the same snapshot is a paired continuation, not a new independently generated world.
3. Check hashes at launch and completion, including worker processes. Any changed/mixed source makes the run diagnostic only; rerun against the final frozen source. Keep historical results labeled with their original version.
4. Save machine-readable per-trial measurements, stock/energy residuals, failure reasons, raw counts and summary definitions. Distinguish measured zero, missing instrumentation, failed runs and unrun tests. Do not fabricate outcomes or silently omit timeouts/extinctions.
5. Run `npm run check` and `npm run build` after the final code changes. Use actual Electron smoke/rendered screenshots for visual work and close/reopen an isolated profile for disk persistence. Test cold start, pause, minimize, resume, interruption and relevant migration paths.
6. When publishing an authorized change, preserve repository history with no force push, verify the expected commit on the remote, and inspect CI for that exact commit. Report local test results, native QA, platform CI and physical-laptop measurements separately.

Completion reports state exactly which milestone and gates passed, which failed, and which remain unrun. A delivered regional foundation is valuable on its own; it must not be presented as completed learning, safe relocation, sustainable ecology or civilization.
