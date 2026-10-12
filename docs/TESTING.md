# Verification — Aincrad 0.2

Date: 2026-10-12.

## Automated checks

`npm run check` passes all 56 tests. These cover the preserved human world rules and five-minute traversal; save migration and recovery; hydration timing; collection versus drinking; invalid, out-of-range and unavailable interactions; local perception and occlusion; unconscious perception; observed-only navigation; blocked-route feedback and revision; candidate acquisition and changed-condition validation; meaningful credit limits; collapse/action cancellation; idempotent rescue and provenance; retained identity/skills and no rescue teleport; interrupted saves; late/paused model responses; bounded local endpoints; restricted output; call limits and cancellation.

`npm run bundle` produces a deterministic self-contained build with verified CSP hashes. Browser development remains available, while the desktop application is the primary deliverable.

## Rendered application verification

`npm run smoke` exercises the actual Linux Electron window in an isolated profile, with inference disabled. It checks the custom application protocol, sandboxed renderer configuration, narrow model bridge, one persistent NPC, collapse, partial rescue, recovery, identity retention and no rescue teleport.

A separate Playwright desktop run exercised the real IPC and HTTP request path with an explicitly scripted local mock server. It then switched to the offline learner, observed actual independent water drinking and acquired procedures in the running renderer, saved during collapse, closed the application and reopened the same disk-backed profile. Identity, position, acquired procedures and collapsed state were retained; exactly one rescue occurred after recovery. No JavaScript runtime errors were reported.

Rendered screenshots were inspected. The inspection drawer preserves visible space for the followed character at small window widths. Existing human keyboard movement, every cave entry/exit, map, help and pause were exercised with the NPC integrated. Pause stopped the NPC clock.

This isolated Linux container requires test-only headless/root launch flags. Normal launching keeps the renderer sandbox configured and does not add those flags. These checks are not a sustained hardware performance benchmark or an operating-system sandbox certification.

## Controlled offline evaluation

Eight matched controller-seed trials use the actual game timestep (`1/60` second), fixed world geometry/seed 74193, accelerated hydration, 300 simulation seconds and a matched 120-second changed-starting-position phase. Both conditions use the same controller; the disabled condition does not retrieve learned values/procedures and keeps only current local map observations. Both still log authoritative outcomes for measurement.

Mean per trial:

| Metric | Learning enabled | Learning disabled |
| --- | ---: | ---: |
| Initial independent drinks | 1.25 | 1.375 |
| Initial collapses | 0.25 | 0.625 |
| Initial rescues | 0.25 | 0.625 |
| Repeated unsuccessful requests | 0.25 | 5.75 |
| Changed-start independent drinks | 1.125 | 0.875 |
| Changed-start collapses | 0 | 0 |
| Changed-start acquired-procedure uses | 1.875 | 0 |

Memory changed later selection, reduced collapse/repetition in these trials, and supported acquired-procedure reuse at changed starting conditions. It did not improve every metric: initial independent drink counts were slightly lower with learning enabled. These small controlled results do not establish universal improvement or live language-model performance. Full trial data, timing and definitions are in `npc-evaluation.json`.

An independent drink restores at least 15 hydration from collected water and is credited once per fill. The changed starting position is an explicit matched evaluation setup, not a rescue teleport. No model service or paid inference is used by evaluation.

## Packaging and remaining limits

The portable Windows x64 ZIP is built with Electron 44.7.0 and Electron Builder 26.15.3. It includes the runtime and opens as `Aincrad.exe` after extracting the full folder. Linux application packaging is also available. The Windows build is unsigned; it is not a signed installer. A physical Windows/macOS machine has not been tested in this session. The desktop workflow supplies Windows/Linux checks and build artifacts for further verification.

No actual language model was configured here. Provider/HTTP fixtures are labeled mocks and are not claimed as live inference or learned behavior. Use the README’s exact local-model setup to evaluate your own installed model. Player-assisted rescue, long unattended runs, additional needs/agents and a complete visual tile-world conversion remain outside this milestone.
