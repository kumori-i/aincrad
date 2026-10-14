# Verification — Aincrad 0.5

Session date: 2026-10-14. This record distinguishes engine checks, native desktop behavior, offline simulation and language-model fixtures. Full rule snapshots and scenario results are in [npc-evaluation.json](npc-evaluation.json).

## Source and desktop checks

`npm run check` passes **171 tests** across world geometry, environment, physiology, learning, cognition, social communication, persistence, navigation, builds and the restricted model bridge. The complete output is [check-output.txt](check-output.txt). New regressions cover separate character bodies and inventories, subjective sensations without numeric physiology, real exertion/rest/sleep, unsafe waking, evidence-tagged reports and corrections, renewal hypotheses from visits, actual travel estimates, bounded plans with physical postconditions, unknown-food search limits, shelter commitment, optional replies and targeted answer state, locally readable notes, clock migration, fair model queuing and character-scoped cancellation.

`npm run build` produces ignored desktop assets in `dist/`. Existing deterministic manifest, CSP and stale-module checks remain covered. `npm run smoke` launched the actual built Electron application with inference disabled and passed: secure application origin, renderer isolation, narrow bridge, two independent bodies, qualitative observations, character selection, optional journal messages, a single shared clock, and isolated collapse/rescue with retained identity and no independent rescue credit.

HTTP model tests use deterministic response fixtures. They exercise qualitative request validation, restricted action/plan output, journal replies, shared queuing/budgets, cancellation and stale responses. No live Ollama model was installed or configured for this verification.

## Native journal, scenes and persistence

Native Electron QA used the actual `aincrad://app` application at 1440×900 and 900×600. Both fixed identities were present with independent state; selecting Mira switched the journal and camera. The normal body card displayed words without reserve percentages, while numeric development inspection started hidden.

The rendered offline simulation delivered actual nearby peer speech. Posting “How are you feeling?” through the composer produced a grounded, explicitly labeled offline journal reply from each character. An injected unanswered Mira question remained pending while both bodies advanced another 90 seconds and continued taking actions. At approximately 137 simulation seconds, each character had consumed **one useful meal and one independent drink**, acquired two procedures, and suffered no collapse. Questions and a field note were explicitly supplied through test-only validated actions for the nonblocking/persistence checks; the meal/drink outcomes and initial conversations were autonomous.

Typing WASD in the conversation textarea did not move the human avatar. At 900×600 the Send button remained inside the viewport. Changing the recipient after clicking Reply cleared the old reply context and successfully sent a new message. A later targeted reply answered the pending question. Following Mira in Willow Refuge changed the rendered scene and field map while the human and Aster remained outdoors. Modal pause froze both body clocks and the shared environment. Human keyboard movement, help, and all four cave entry/exit pairs passed. No JavaScript runtime errors were reported.

The test paused, saved, closed the native window and reopened the entire application using the same disk-backed profile. Both characters' body values, scenes, positions, inventories, lifecycle, statistics, learned procedures and relationships persisted. The conversation, unanswered question, field note, selected character and weather settings persisted. Canonical version-4 disk saves contain each character once and restore the historical Aster alias. Legacy versions 1–3 retain Aster's progress while adding Mira without retroactive bodily depletion.

For a controlled mid-plan restart check, each character received a bounded three-step wait/observe/wait fixture through the test-only controller. Goal, plan ID, steps, cursor, original return point and total travel budget survived restart. The unfinished physical action was discarded and made retryable; the step did not receive fabricated completion credit. Unit tests separately verify an actual exploration intention preserves its original origin and spent travel budget.

Original pixel scenes were inspected with both characters, speech bubbles, rain/night, rest poses and cave views. Renderer checks confirmed that drawing did not change physical state, a selected character drove cave follow, field-note markers respected their scene, subjective gauges did not reveal different numeric values within the same sensation, and sampled nearest-neighbor display blocks had zero differing pixels within a block. Screenshots: [two-character journal](pixel-journal-v05.png) and [conversation](conversation-v05.png). These are functional visual checks, not a hardware benchmark.

Linux checks used isolated profiles and headless flags. The root container requires a test-only `--no-sandbox`; normal launch does not add it. Windows/Linux GitHub Actions run source checks, builds and actual Electron smoke launches. Physical Windows/macOS hardware, signed installers and crash-proof disk persistence are not established by these checks.

## Offline scenario evaluation

Two seeds per scenario, with low-level persistent learning enabled and disabled, exercise two characters sharing finite supplies and one environment. All runs use the actual 1/60-second timestep and make no model requests. Ordinary trials run 900 seconds, crossing the 600-second food-renewal cycle; hot afternoon, cold windy night, unanswered journal and deliberately depleted-food scenarios run 300 seconds each.

Both conditions share physiology, qualitative drives, planning and social rules. The disabled condition removes retained low-level terrain/resource/action values, temporal credit and acquired procedures. It retains higher-level cognitive and conversation data. It is **not** a memory-free agent or an ablation of every new subsystem.

The completed matrix contains **20 runs and 40 character outcomes**. All shared and personal clocks remained aligned. Values below are per-character means across two seeds; each cell is **persistent low-level learning / low-level learning disabled**. Critical time includes severe food/water or exposure states. Plan and communication totals are recorded separately in the JSON.

| Scenario | Seconds | Useful meals | Independent drinks | Critical seconds | Collapses |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary pond start | 900 | 9.00 / 3.00 | 3.50 / 1.25 | 35.4 / 272.6 | 0 / 2.25 |
| Hot afternoon near refuge | 300 | 2.50 / 1.50 | 0 / 0 | 54.1 / 58.3 | 0 / 0 |
| Cold windy night near refuge | 300 | 1.75 / 1.50 | 0 / 0 | 40.2 / 48.0 | 0 / 0 |
| Unanswered human journal | 300 | 2.50 / 1.50 | 1.00 / 0.75 | 20.8 / 34.6 | 0 / 0 |
| All food depleted | 300 | 0 / 0 | 0.25 / 0.50 | 123.0 / 125.3 | 1 / 1 |

All four ordinary learners completed 900 seconds without collapse or rescue. Each ate nine useful meals and drank three or four times. They completed 47 physically verified preparation/exploration plans and wrote 11 notes in total. Critical time ranged from zero to 105 seconds, and mean accumulated injury was about 16 points per character. Three finished at full health; Mira in rainy seed 3 finished at about 49.8 health. They took real rests, but the window did not drive sleep pressure high enough for autonomous sleep; sleep mechanics and interruption are covered by focused body tests. Surviving these trials does not mean comfort or reliable avoidance of dangerous states.

Learners also avoided collapse in the near-refuge heat/night and unanswered-journal windows. Shelter fixtures begin beside an observable cave and apples, so they do not establish distant shelter discovery. Neither heat nor cold fixture produced an independent drink. Hot-fixture characters finished with only 6.5–8.8 hydration, so locating water from an unfamiliar refuge start remains unreliable; these windows do not establish long-term hydration. One cold-fixture Mira exhausted her food and ended at 67.6 health despite avoiding collapse. Unanswered-journal characters continued physical care and produced notes without any human response. The depleted-food boundary intentionally offered no obtainable apples; each character eventually collapsed and received one uncredited rescue.

The ordinary learning comparison improved meals, drinking and survival in these seeds, but learning retained more invalid actions. The warning-cue, refuge-route and exertion fixes reduced severe losses observed during development. Risk remains: Mira ended one unanswered-journal trial at **36.9 health**, and the unfamiliar refuge profiles did not locate water within their windows. These are mixed functional results from an unfinished policy, not a claim of healthy stability, statistical superiority or optimal behavior. The shared cognitive/social scaffold in both conditions prevents attributing the difference to every new feature.

## Interpretation and limits

Physiology, sensory vocabulary, drives, action affordances, navigation, bounded preparation/exploration strategies, offline dialogue and procedure-recognition templates are supplied. Experiential values, discovered geography, beliefs, observed travel estimates and evidence-backed procedures accumulate from actual gameplay. Reports from the human or a peer remain claims until local evidence supports or contradicts them.

The trials use fixed geometry and only two seeds. They establish working behaviors within these windows, not optimal paths, convergence, indefinite self-sufficiency, learned human language, consciousness, a human neural network or emergent civilization. Warning/critical exposure, route failures, food availability and longer-range shelter discovery remain development targets. Offline replies are templates; live Ollama language and planning need separate trials. Aincrad changes gameplay memory and values, not LLM weights.
