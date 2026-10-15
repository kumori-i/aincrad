# Verification — Aincrad 0.7

Session date: 2026-10-15. Current Cardinal evidence is recorded separately from [the historical v0.6 verification](TESTING-v06.md), [v0.6 discovery trials](npc-evaluation-v06.json) and [v0.6 ecological diagnostic](ecology-long-run-v06.json). The historical trials established useful food discovery but inadequate intake and substantial animal losses. They do not establish that Cardinal fixes those limitations.

## Source verification

Release verification passed syntax checks for **75 JavaScript modules** and **296/296 tests**, with zero failures, cancellations or skipped tests. The complete release TAP output is [check-output.txt](check-output.txt). It covers the existing body/discovery/model/save contracts and new Cardinal adaptation, paired experiments, accounting/assistance guards, rule validation, distribution migration, predator water access and atlas transforms. Scripted model fixtures do not establish live Ollama behavior.

Native application evidence below is separate from these engine tests. Windows/Linux CI outcomes are checked after publication and are not claimed by this local test record.

## Reproducible Cardinal evaluation

Run the actual offline engine probes with:

```sh
npm run evaluate:cardinal
```

The default output is [cardinal-evaluation-v07.json](cardinal-evaluation-v07.json). It records source SHA-256 hashes, exact horizons, timesteps, seeds, settings, candidate/control measurements, decisions, utility estimates, outside assistance and limitations. A changed runtime source fingerprint fails final verification; its output is diagnostic only and must be rerun after source freeze.

The evaluation contains four distinct checks:

| Check | Setup and measurement | What it can establish |
| --- | --- | --- |
| Distributed-world performance | Fresh worlds with seeds 74193 and 3; two humans and the complete valley-wide ecology; 20 simulation seconds at the native 1/60-second timestep. | Traversable distant habitat coverage, aligned clocks, accounted resources and headless engine step cost. It does not measure rendering or native UI latency. |
| Isolated causal actuator | One real grass node at 1200/2500 g and moisture .9; fixed rainy 14:00; no humans or animals; a reconstructed finite initial ledger. Candidate growth 1→2.5 and 1→.25; three paired seeds each, 900 seconds per branch at .25 seconds. | Actual resource-rule effects, positive/negative utility decisions, application and rollback, unchanged live resource state while replicas run. It does not establish human learning or population balance. |
| Fully automatic producer adjustment | Ten real grass nodes at 45/2500 g and moisture 1; fixed rainy 14:00; no humans/animals/materials; a reconstructed finite initial ledger. No owner proposal. Normal 900-second paired horizon and .01 acceptance threshold. | Cardinal observes actual low biomass, proposes a growth change itself, tests it and applies an evidence-backed setting. The intentionally depleted checkpoint is a producer stress fixture, not a complete ecosystem. |
| Automatic adaptation and restart | Two fresh humans, no food advice, model or initial technique; 120 seconds then a validated save restoration and another 30 seconds, for both seeds. | Automatic diagnoses/proposals, real replicated outcomes, persistent utility estimates, future choice influenced by those estimates and the inhabitant privacy boundary. Biological improvement requires longer evidence. |

Full-world automatic probes deliberately accelerate Cardinal scheduling: observations every 2 seconds, 6 seconds of history, 12 seconds between eligible experiments, 30-second sandbox horizons and a 15-second monitoring window. The fully automatic producer fixture accelerates only initial observation/history/eligibility to 1/2/1 seconds and retains the normal 900-second horizon, .01 acceptance threshold and 300-second live monitoring setting. Normal scheduling remains 30-second observations, 90 seconds of history, 120 seconds between eligible experiments, 900-second sandbox horizons and 300-second monitoring. These configurations are saved in the report. Scheduling overrides do not change biology rates, plant physics or the world clock.

The automatic evaluation uses a .25-second live and shadow timestep. Its decisions need not reproduce native 1/60-second traces. Sandbox seeds alter future choices/weather at the same checkpoint and geometry; they are not independent new maps. Every candidate/control pair retains identical starting bodies, memories, materials, resource stocks and time. Only the candidate's one world rule changes.

Positive and negative experimental results update persisted parameter/context records. A counterfactual proposal comparison retains versus removes only completed utility records at the same live state. This measures whether the implemented selection actually uses learned evidence; it is not a learning-disabled ablation of the inhabitants' cognitive systems.

Work-chunk audits compare the live inhabitants, community, ecology and time before and after shadow execution. Copied-world work cannot assign a live skill, health value, item or outcome. Inhabitant observations are checked for private supervisor/world-rule/physiology/species/material fields. Live environmental changes use the authoritative actuator; resource production remains accounted, and outside rescue/imported energy remains separately measured.

## Completed frozen-source results

The default evaluation completed in **47.134 wall-clock seconds**, with matching start/end SHA-256 fingerprints for all **29 runtime modules**. Both fresh seeds contained **336 plants and 132 animals**: 112 rabbits, 13 foxes and seven bobcats. Both plant and animal coverage reached **all 49 regions**, every quadrant and coordinates beyond ±20,000 along each axis. Plant placements passed authoritative traversability checks; human/environment/ecology clocks stayed aligned.

Across the two 20-second native-timestep headless probes, mean engine step cost was **0.419–0.566 ms**, the 95th percentile was **1.947–2.115 ms**, and peak steps reached **45.577–45.879 ms**. These are measurements on this container, including initialization/JIT effects. They do not establish a frame rate or smooth rendering on another computer. Ecological accounting residuals were below 4.7×10⁻¹⁰ kcal in those probes.

The owner-requested isolated growth candidate 1→2.5 produced a utility gain of **0.0157165** in each training/held-out pair, was applied through the real actuator and was reversed through recorded rollback. The destructive 1→.25 candidate produced **−0.0088781** and was rejected. No outside resource energy was added.

The separate fully automatic stress fixtures passed for **both starting seeds**. Cardinal observed low producer biomass, independently proposed **plant growth 1→1.25**, completed two training and one held-out 900-second comparison, retained accepted utility evidence and applied the live rule. No owner proposal or lowered acceptance threshold was supplied. Each candidate ended with **315.8122 kcal** of real plant energy versus **281.2537 kcal** in its control, a utility gain of **0.0108687** above the normal .01 threshold. The fixture's remaining budget residual was about 10⁻¹² kcal. This proves a working automatic physical intervention in that controlled producer problem, not stable animal populations or adequate human nutrition.

The two full-world runs completed **nine additional automatic experiments**, each containing three actual paired seed comparisons. They rejected all nine: increased growth/yield did not improve the diagnosed human intake gap within the short horizon. No live full-world adjustment was adopted. These measured rejections updated persistent negative evidence rather than inventing a successful intervention. Both runs showed different next choices when actual learned records were retained versus removed at the same checkpoint; validated restoration preserved the utility records exactly and later experiments continued updating them.

The full-world runs diagnosed nutrition deficits, animal decline and blocked motion. They introduced no food technique, model response, human answer, rescue or external resource energy. Their short duration and use of initial reserves cannot establish self-sufficiency. Full-world budget residuals stayed below 1.1×10⁻⁹ kcal.

Incremental sandbox work targets 8 ms slices. A physical step or checkpoint copy can exceed that target. Live completion timestamps and the number of jobs completed during a fixed live window can vary with machine load. Each paired comparison retains its identical checkpoint and fixed simulation timestep; the report records the actual live timings and completed jobs.

## Interpretation and limits

Cardinal's supplied objective combines actual nutrition/hydration, health, fatigue, critical burden, movement, animal nutrition, diversity, resources and physically grounded practice. Its learned records summarize measured utility differences for implemented environmental actuators. No LLM weights, human neural network or general world model are trained.

An experiment can safely reject an adjustment that fails to help. Rejection and persistent negative evidence demonstrate working adaptation; they do not establish successful ecological balancing. The isolated producer fixtures distinguish owner-requested and fully automatic adoption through actual measured evidence, rather than a fabricated successful result. They are separate from autonomous full-world outcomes.

Finite held-out comparisons do not establish indefinite survival, optimal settings, full seasonal stability, permanent animal populations or civilization development. Large stored reserves can conceal poor nutritional intake, and keeping an organism alive with outside help is not independent self-sufficiency. Settings and candidate policies remain bounded engine design choices. New executable mechanics are outside this runtime supervisor.

## Native application and disk persistence

The actual Electron application passed atlas QA at **1440×900 and 900×600**. Native gestures covered cursor-anchored wheel zoom, button zoom, drag/pan without accidentally placing a waypoint, correct waypoint placement after transformed views, right-click clearing, distant Aster, cave-entrance Mira markers and accessible small-window controls. Atlas refresh and Cardinal controls continued the simulation. Rendering remained read-only and produced no JavaScript errors. The result is retained in [native-atlas-v07.json](native-atlas-v07.json); screenshots are [atlas-v07.png](atlas-v07.png) and [cardinal-v07.png](cardinal-v07.png).

Integrated native QA completed in **17.954 seconds**, with the experiment's 64-character SHA-256 matching the actual built renderer-source fingerprint. Native blur, hiding and minimizing continued both characters and ecology; Escape from the journal textarea froze physical progression and Cardinal work. Map/help views continued simulation. A validated physical sample produced delayed digestion feedback.

The application completed a real three-pair Cardinal experiment and recorded its rejection. This **explicitly accelerated lifecycle fixture used a one-second horizon**; it checks native execution, evidence and pause behavior rather than biological optimization. The separate 900-second engine fixtures above establish actual physical adoption.

Closing and reopening the entire application with the same isolated disk profile preserved both bodies, a long sleep, digestive contents, held material, actual discovery evidence, ecology, journal messages, world rules, completed Cardinal experiments and learned utility records. An unfinished replica was discarded and recorded as interrupted; restoration did not fabricate a completed outcome. No progression was backfilled for closed time. The integrated run reported no JavaScript errors; its measurements are retained in [native-integrated-v07.json](native-integrated-v07.json).

Linux native checks used isolated profiles and headless flags. This root container requires a test-only `--no-sandbox`; normal application launch does not add it. Native checks do not establish physical Windows/macOS hardware performance, signed installation or crash-proof disk persistence. Windows/Linux CI results are separate evidence.
