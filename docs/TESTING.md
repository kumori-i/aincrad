# Verification — Aincrad 0.4

Session date: 2026-10-13. Results below refer to the final calibrated rules, including cold strain of 0.12 points per degree per second. Full rule snapshots and per-trial results are in [npc-evaluation.json](npc-evaluation.json).

## Source and desktop checks

`npm run check` passes **101 tests** across world geometry, environment, body, learning, navigation, persistence, builds and the restricted model bridge. Added regressions cover finite apples and inventory provenance, continuous warning costs, gradual damage, independent cave scenes, local exit perception/navigation, competing food/water/shelter priorities, useful whole-apple consumption, bounded temporal credit, thermal-context cancellation and old-save migration. The original five-minute traversal and one-hour day remain covered. The complete output is [check-output.txt](check-output.txt).

`npm run build` generates ignored internal desktop assets in `dist/`. Build tests verify deterministic manifests, restrictive CSP and removal of stale modules. The source remains an npm-built Electron application.

`npm run smoke` passes using the actual built application, an isolated profile and inference disabled. It verifies the secure application origin, renderer isolation, local model bridge, observed starter water, food/water drain, shared weather clock, visible body controls, collapse, partial rescue, retained identity and no independent rescue credit or teleport.

## Rendered application and persistence

Native Electron QA ran the actual `aincrad://app` application at 1440×900 and 900×600. A normal 180-second simulation at the actual 1/60 timestep produced **two useful meals, one independent drink, two acquired procedures and no collapse**. This exercises real collection/consumption rather than narrative output.

Following Aster into Willow Refuge left the human outdoors, switched the rendered scene and field map, and exposed the physical 18°C cave conditions. Modal pause froze both environment and body time. Human keyboard movement, guide, field map and all four cave entry/exit pairs passed. No JavaScript runtime errors were reported.

The test paused during a recorded developer collapse, saved, closed the entire application and reopened the same disk-backed profile. Body values, position, scene, inventory, learned procedures, depleted food stocks, weather overrides and collapse timers persisted. Exactly one rescue supplied partial bodily relief, retained carried supplies and gave no independent meal/drink credit. Recovery completed normally.

Repeated shutdown testing exposed pending DOMStorage writes. The main process now requests a storage flush after renderer unload saves during shutdown. Five consecutive immediate native-window closes and reopens preserved the latest paused body, position, scene, climate and lifecycle. The flush API has no completion promise; the repeated disk tests establish the observed behavior, not crash-proof persistence.

Original pixel scenery was inspected beside ponds, apple patches, the refuge and inside caves, including rain at night. Rendering leaves physical state unchanged. Full/depleted fruit visuals differ. Sampled nearest-neighbor display blocks have no differing pixels within each block. The journal remains readable and scrollable in the smaller window. These are functional visual checks, not a hardware performance benchmark.

Linux tests use isolated profiles and headless flags. A test-only `--no-sandbox` flag is necessary in the root container; normal launch does not add it. Source-build and actual desktop smoke checks also run in Windows/Linux GitHub Actions. Physical Windows/macOS hardware and signed installers were not tested in this session.

## Matched offline scenarios

Two seeds per scenario, with learning enabled and disabled, give **20 runs** at the actual 1/60 timestep. World geometry is fixed; weather and controller seeds vary. Both conditions share physiology, action affordances and priorities. The control retains current local observations but excludes previous resource/terrain/route memory, learned values and procedures. No model endpoint is called.

Each paired entry below is **persistent learning / memory disabled**, averaged over the two seeds. Critical time includes either reserve or thermal critical states. Warning time includes critical time.

| Scenario | Seconds | Useful meals | Independent drinks | Critical seconds | Collapses |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary pond start | 600 | 6.0 / 6.0 | 3.0 / 2.0 | 29.4 / 0.0 | 0 / 0 |
| Hot afternoon near refuge | 240 | 2.0 / 1.0 | 1.0 / 0.5 | 0.0 / 51.7 | 0 / 0 |
| Cold windy night near refuge | 240 | 2.0 / 0.0 | 0.0 / 0.0 | 0.0 / 103.5 | 0 / 0 |
| All food depleted | 300 | 0.0 / 0.0 | 0.5 / 1.0 | 125.3 / 125.3 | 1 / 1 |
| Starting pond unavailable | 300 | 3.0 / 2.0 | 1.5 / 0.0 | 45.5 / 27.0 | 0 / 0 |

Both ordinary learners obtained six meals and three drinks in ten minutes without collapse or rescue. Seed 74193 stayed outside warning/critical states without injury. Rainy seed 3 survived but spent 58.8 seconds critical and accumulated 24.15 points of injury before later recovery; it had not discovered a cave. Slower cold buildup supplies more opportunity to respond without disabling thermal damage.

The near-refuge heat/night trials intentionally start beside a locally visible cave and food patch with empty supplies. Learners obtained food and learned shelter procedures without critical states, injury or collapse. These establish use of discovered shelter, not reliable discovery from the ordinary starting pond. The cold trial needs no drink within its four-minute window.

With the starting pond unavailable, learners collected alternate water. With all apples deliberately unavailable throughout the window, both conditions eventually collapsed; this is an impossible-food boundary rather than a success test.

The comparison is mixed. Learning improved some resource and shelter outcomes, but retained route choices produced more invalid actions and worse ordinary exposure than the control. These small functional probes do not establish a statistically reliable improvement, optimal paths, convergence or unlimited unattended survival. Shelter discovery, failed-route recovery and longer food-renewal cycles still need further development.

## Model and learning limits

No live Ollama model was configured for verification. HTTP/provider tests use explicitly labeled fixtures; the evaluation uses the offline experiential learner. These results do not establish live model behavior or model weight training.

Physiological costs, action affordances, navigation and restricted procedure-recognition templates are supplied. Aster learns bounded gameplay values, resource/route memory and evidence-backed procedures from actual outcomes. Learning can occur before collapse; it does not guarantee avoidance of every dangerous state. Ambient animals, fish and plants remain scenery, with finite apples as the usable food. Hunting, fishing, additional autonomous agents and player-assisted rescue remain outside this milestone.
