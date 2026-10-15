# Verification — Aincrad 0.6

Session date: 2026-10-14. Engine checks, native desktop behavior, offline discovery and model fixtures are separate evidence. The frozen v0.6 discovery scenario data is [npc-evaluation-v06.json](npc-evaluation-v06.json); the preceding v0.5 evaluation is retained as [historical data](npc-evaluation-v05.json) and must not be interpreted as testing the new body or food rules.

## Source and model contracts

The focused provider suite passed **21 tests** covering both legacy and discovery observations, qualitative bodily signals, actual controller/ecology observations, nested physiology privacy, hidden ecological metadata, restricted output, shared queues/budgets and character-scoped cancellation. Discovery fixtures reject physical experiments, old food macros, procedures, plans, peer recipes and notes from the model. They permit optional human-journal questions and replies only. Actual discovery observations contain opaque sensory objects and no apple inventory, known-food list or legacy procedure menu.

HTTP model tests use explicitly scripted deterministic responses. No live Ollama model was installed or configured for this verification. Rejecting physical output proves the structural contract; it does not prove every generated sentence free of pretrained knowledge, false claims or bias. Model text is not explicit human advice or physically measured evidence.

`npm run check` passed **242 tests**, with syntax checks across 60 JavaScript modules. Complete output is [check-output-v06.txt](check-output-v06.txt). `npm run build` and the actual `npm run smoke` Electron launch passed after the runtime source freeze. Smoke covers the secure bridge, new discovery mode without supplied food knowledge, categorical bodies, two characters and one shared ecology clock, Escape pause from the textarea, a live map view and continued progression while the native window is hidden. Generated `dist/` is excluded from publication.

## Native application, background progression and persistence

Native Electron QA launched the actual `aincrad://app` application with isolated disk profiles. The renderer remained sandboxed with Node integration disabled, and the narrow model/input bridge preserved the application origin restrictions. No JavaScript errors were reported in the integrated run.

Native window blur was observed. Hiding and minimizing the window continued both character/body clocks and the saved ecology clock while clearing held human movement keys. Escape pressed from inside the conversation textarea paused and resumed the simulation. Map and help views continued simulation rather than creating implicit pause states. These checks use actual native window events, not only a synthetic DOM blur.

A test-only validated sequence pulled a finite portion from a tree, then sampled the held result. Matter entered the finite digestive state, followed by a delayed sustained effect and an evidence-backed technique. This checks the mechanism under a controlled action fixture; it does not establish autonomous discovery by itself.

The native window was closed through `BrowserWindow.close`, then the entire application was reopened with the same disk-backed profile. Canonical ecology, both private bodies, a long Mira sleep, digestive contents, held material, technique evidence, effects and human journal messages persisted. Unfinished actions were not fabricated as completed outcomes. The application performs no wall-clock progression while closed.

Presentation QA verified a usable 900×600 conversation composer, state-preserving drawing, static pixel presentation and qualitative character inspection. Screenshots: [discovery journal](pixel-journal-v06.png) and [conversation](conversation-v06.png). Rendering checks do not establish performance across all hardware.

Linux checks use isolated profiles and headless flags. This root container requires a test-only `--no-sandbox`; normal application launch does not add it. Windows/Linux CI launches are recorded separately when completed. Physical Windows/macOS hardware, signed installers and crash-proof persistence are not established by these checks.

## Offline discovery evaluation

The v0.6 evaluator starts fresh discovery characters and an explicitly seeded discovery environment. It rejects any cold-start setup containing carried items, old food lists, acquired skills or discovered techniques. No model, human answer or food technique is supplied. Both characters share the actual finite ecosystem and 1/60-second engine timestep.

Default probes cover seeds 74193 and 3: two game days (7200 simulation seconds) from the ordinary pond start, six game hours (900 seconds) of fixed hot afternoon near an observed refuge, six hours of fixed cold windy night near refuge, and twelve hours (1800 seconds) with generic initial questions that receive no answer. Overrides use the same time/body/ecology rules. A CLI `--seconds` override supports shorter diagnostics; it is recorded explicitly in the output.

Four worker slots execute independent expeditions. Each records SHA-256 fingerprints for the runtime modules; a release run requires all workers to match the main process's source fingerprint. Mixed runs during development are diagnostics, not final validation.

Actual absorbed calories and water, expenditure, remaining stores, body condition and outside assistance are recorded separately from successful samples or beneficial-effect counters. A tiny beneficial sample does not count as a nutritionally sufficient meal. Large initial stores can permit survival despite inadequate intake, so absence of collapse alone cannot establish self-sufficiency. Ecology accounting compares initial/produced energy with remaining material, human removal, animal metabolism, decomposition and discarded energy.

The frozen-source release matrix completed **eight expeditions and sixteen character outcomes**. The separate [600-second cold-start check](npc-cold-start-v06.json) adds two expeditions and four character outcomes. All ten runs used the actual **1/60-second timestep**, aligned character/environment/ecology clocks, and matching SHA-256 hashes for all 22 runtime modules. No human message, answer or model inference was supplied.

Each table value is a per-character mean across two seeds, except retained techniques and collapses, which are totals for the four character outcomes in that scenario. Calories are exact developer measurements; agents do not observe these numbers.

| Scenario | Game hours | Absorbed kcal | Spent kcal | Independent drinks | Sleep seconds | Retained techniques | Collapses |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary pond start | 48 | 1317.5 | 7499.1 | 7.25 | 2375.0 | 96 | 0 |
| Hot afternoon near refuge | 6 | 272.4 | 1243.8 | 0 | 0 | 35 | 0 |
| Cold windy night near refuge | 6 | 196.7 | 1223.6 | 0 | 0 | 26 | 0 |
| Unanswered journal | 12 | 520.4 | 2312.3 | 2.00 | 60.6 | 47 | 0 |

All four ordinary characters autonomously obtained caloric benefit, drank six to eight times, retained the maximum 24 techniques and slept about 15.8 game hours over two days. Final health was at least 99.76, with no collapse or rescue. **Intake remained well below expenditure**: individuals absorbed 1001.5–1686.7 kcal while spending 7340.8–7653.2 kcal. They consumed about 5189–5619 kcal of initial stored reserves. These outcomes demonstrate food discovery and continued body care, not nutritional self-sufficiency. Strong hunger/strain bands accumulated a mean 344.6 simulation seconds of critical cost; this risk band is a game signal, not a clinical diagnosis or universal time-to-death prediction.

The shorter cold-start probe gave every character one to four evidence-backed techniques, 31.0–134.1 absorbed kcal, one independent drink and no collapse within four game hours. Unanswered-journal characters continued obtaining material, drinking, resting, sleeping, conversing and writing notes while their questions remained pending. Near-refuge heat/night windows produced beneficial sampling and no collapse but no independent drink; they do not establish long-term hydration at that starting location.

Across the eight release expeditions, ecological energy-accounting residuals stayed below 1.3×10⁻⁸ kcal. Conservation of the finite budget does not establish sustainable populations. A separate controlled 600-second body/digestion/sleep comparison between 1/60 and 0.1-second steps retained the same feedback effects and differed by less than 0.009 in the recorded body metrics. Both isolated ecosystem comparisons conserved the budget; the fractional-step remainder accounts for the occasional half-second ecology update lag. This sanity check does not establish identical agent policy traces at 10 Hz.

The release code maintains independent absorption feedback channels, persistent object/primitive trial counts and fixed-size physical mouthfuls. Caloric effects require actual absorption, bounded detailed-event history cannot reset novelty, and sampling does not leave an indefinitely shrinking geometric remainder. These mechanics are covered by focused regressions and the frozen-source probes above.

No misleading “learning off” comparison is reported: disabling the old low-level value learner would leave discovery memory, cognition and social scaffolding active rather than form a full ablation.

## Fourteen-day ecological diagnostic

The separate [ecological diagnostic](ecology-long-run-v06.json) advances seed 74193 for **fourteen game days** with actual seeded weather, a 0.5-second ecology timestep, and no humans, model or rescue. It records daily resources, private animal bodies, ledger snapshots and preceding movement/contact traces for fatal losses. This uses the ecology's normal internal step, rather than a human discovery-policy comparison.

The initial population was 18 rabbits, three foxes and two bobcats. After two births and nineteen deaths, only four rabbits and two foxes remained; both bobcats were gone by game day 4.277. Fatal records classify eleven predation losses, three dehydration-associated losses and five energy-deprivation-associated losses. Budget residuals stayed below 5.84×10⁻⁸ kcal across daily checks.

The bobcat traces include large water deficits and repeated stationary positions despite pond targets hundreds of pixels away. Local movement limitations are a plausible contributor supported by these traces; the run does not isolate navigation as a controlled causal variable. **The population is not balanced or indefinitely sustainable.** Animal navigation, search, feeding opportunity and resource distribution need further work despite finite resource transfer and correct accounting.

## Interpretation and limits

Movement, water handling, local navigation, sensory vocabulary, drives, physical primitives, generic exploration and offline dialogue are supplied structure. Food techniques require executed interactions and delayed bodily consequences. Explicit human advice begins as a reported hypothesis; claims and spoken intentions cannot create food, replenish stock or prove a technique.

Two seeds and fixed geometry provide functional evidence, not convergence, optimality or statistical reliability. Two ordinary days do not span the 120-day ecological year or establish indefinitely stable grazing, predation, reproduction or self-sufficiency. Near-refuge boundary profiles do not establish discovery of a distant cave. Approximate body and species rates are configurable simulation rules, not medical or wildlife predictions.

Live Ollama language, human neural networks, consciousness, learned human language and civilization emergence remain unestablished. Aincrad updates gameplay memories and values, not model weights. Fish ecology, large predators, climbing, tools, cooking and cultivation remain later milestones.
