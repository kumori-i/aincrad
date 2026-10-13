# Verification — Aincrad 0.3

Date: 2026-10-13.

## Source workflow and checks

`npm run check` passes all **62 tests**, including six new regressions for visible dehydration timing/warnings, accelerated rescue opportunity, stationary visit accounting and remembered empty-flask failure, blocked same-tile snapping, exploration when water is unavailable, and bounded exploration save migration. Existing world traversal, collision/caves, lifecycle, acquired procedures, save handling and optional-provider checks remain covered.

`npm run build` creates internal desktop and renderer assets in ignored `dist/`. Tests verify deterministic asset manifests, source hashes, restrictive CSP, stale-module removal and exclusion of desktop/repository files from renderer serving. Generated `play.html` and the old browser-only harness were removed.

The source command structure was compared directly with the current `kumori-i/agentic-workspace` repository. An actual Linux `npm run dev` test in an isolated source copy verified opening the secure application origin, renderer CSS edits rebuilding and reloading with changed computed styles, desktop edits restarting Electron, and Ctrl+C closing the whole process tree. Plain reload retained cached CSS during initial QA; development reload now bypasses cache.

## Rendered desktop verification

`npm run smoke` passes with the actual built Electron application, isolated user profile and inference disabled. It exercises the application protocol, renderer isolation, narrow model bridge, one persistent NPC, real collapse, partial rescue, recovery, identity retention and no rescue teleport or independent rescue credit.

Separate Electron UI verification exercised the title’s Watch Aster control, journal follow, the normal offline controller and visible hydration/collapse countdown. A five-simulation-minute run at the actual 1/60 timestep produced **3 independent drinks, 0 collapses and an acquired procedure**, before the explicitly recorded developer collapse test.

That test saved during collapse with the world paused, closed the whole application, and reopened the same disk-backed profile. Position, identity, procedures, collapsed lifecycle and timers persisted. Exactly one rescue supplied partial hydration without independent drinking credit. Recovery completed normally.

Human keyboard movement, all three cave entry/exit pairs, field map, guide and pause were exercised in Electron. Modal pause stopped the NPC clock. Screenshots at 1440×900 and 900×600 were inspected; follow mode keeps the actor visible beside the journal. HUD region/minimap track the viewed actor and temporary messages stay in the visible world area. No JavaScript runtime errors were reported.

Original pixel art was inspected in river, camp, forest, cliff entrance and cave scenes. Idle-avatar render pixels were identical at separated animation times. Sampled nearest-neighbor 3×3 display blocks had no differing pixels within each block. Trees/idle bodies do not sway or bounce; walking and ripples use discrete frames. The integrated test measured approximately 59 FPS in this headless environment; this is not a sustained hardware performance benchmark.

The isolated Linux tests use headless flags and, where required by the root container/hosted Ubuntu SUID-helper configuration, a test-only `--no-sandbox` flag. Normal launching retains the renderer security configuration and adds no test flags. These tests do not certify an operating-system sandbox or physical user hardware.

## Paired offline evaluation

Eight matched controller seeds per preset use fixed world geometry/seed 74193, the actual 1/60 timestep, 300 simulation seconds and a matched 120-second changed-start phase. Both conditions share physical rules and basic action affordances. The control does not retrieve persistent values, procedures, previous terrain, failed routes or visit histories; it retains current local observations and logs outcomes for measurement.

Means per trial:

| Metric | Persistent learning | Memory disabled |
| --- | ---: | ---: |
| Normal independent drinks | 3 | 0 |
| Normal collapses | 0 | 2 |
| Normal revisited exploration arrivals | 0 | 28.25 |
| Normal repeated invalid actions | 1.125 | 0.25 |
| Normal changed-start independent drinks | 2 | 0 |
| Fast independent drinks | 6.875 | 0 |
| Fast collapses | 0.375 | 5 |
| Fast revisited exploration arrivals | 0 | 25.625 |
| Fast repeated invalid actions | 3.625 | 0.125 |

All normal persistent-learning trials independently drank before any collapse, with first water in roughly 30–87 seconds. Learning did not require death. Revisited exploration arrivals are repeated successful exploratory target tiles within the last twelve such arrivals, not every physical crossing and not resource returns. A revisit may be justified; the metric alone does not prove circling.

The result has a clear tradeoff: learners attempted more resource routes and produced more repeated invalid actions than the disabled control. Some accelerated trials still collapsed. These small controlled results do not establish universal reliability, improvement in every metric, or live-model performance. Complete trial data and definitions are in `npc-evaluation.json`.

## Limits

No actual language model was configured for this update. Local HTTP/provider fixtures are labeled mocks; offline learning is evaluated separately. Windows/Linux source-build and desktop smoke checks run in GitHub Actions. A physical Windows/macOS machine and signed installer have not been tested in this session. Optional distribution commands remain available, but source development does not require packaging.

Player-assisted rescue, additional needs/agents, society, long unattended runs and broader procedural generalization remain future milestones.
