# Single-world dependency and coverage inventory

## Supported pipeline

`desktop/main.cjs` → `src/entry.js` → `src/ozark-world-main.js` uses one structural Ozark geometry, renderer and current save codec. There is no original-world chooser, world-switch IPC, recovered-profile runtime or old-save migration. The single key is `aincrad.world.v1` (schema 11). Unread historical keys remain untouched. Invalid occupied current bytes block play and replacement.

## Removed exclusive implementations

- Original `src/main.js`, `renderer.js`, `save.js`, `cardinal-panel.js`, and `recovered-profile-boot.js`.
- Isolated pilot/session/render/geometry/action-evidence and preview traversal runtime modules. Offline geography source-generation utilities remain because current Ozark terrain depends on their pinned descriptor.
- Desktop recovered-profile manager, recovered/pilot/world-switch IPC, old welcome/recovery choices and their exclusive tests/workflow.
- Old original/regional/plant/pilot native scripts and unsupported old-world evaluation CLI entries. `npm run evaluate` now observes the one untouched current world without injecting hints or treating short adoption as a gate.
- Obsolete original-world development/compatibility documents, old scene screenshots and obsolete check-output files. Git retains the removed history. User-computer files are not deleted.

## Retained dependencies

Ecology, physiology, primitive actions, proof retention, perception, navigation, cognition, social interaction, world rules, shared art and geographic source-generation helpers remain where imported by current Ozark. Shared modules may still contain low-level historical fixture helpers used by independent unit tests; these are not a second application entry/save/render pipeline. Cardinal's core measurement/diagnostic modules remain, but no Cardinal runtime UI or adaptive governor is claimed. Procedure-receipt diagnostics remain.

## Coverage retained or re-expressed

- The full shared proof mutation matrix, capped histories, sleep-delayed feedback after FIFO rollover, missing acquisition/observation, pending ingestion, alternate technique witness and 65-effect stress assertions remain in `proof-retention.test.mjs`. Actor normalization replaces obsolete whole-world codec tails only.
- `ozark-save.test.mjs` applies the 15-link action/sample/effect/proof mutation matrix to the current occupied slot and asserts exact-byte protection. It also rejects future nested schemas, body/default/clamp laundering, learner data loss, malformed environment settings/rules, stale writes and impossible observations.
- Current authoritative physiology, thermal, flask, inventory, lifecycle, stats and authored learner-memory fields must survive normalization exactly. Derived body projections, explicitly reconstructed practice counts and interruption-safe peer-advice state are not incorrectly compared as immutable whole-actor data.
- `learner-feature-bounds.test.mjs` now uses the current codec for exact weights/scores/RNG and malformed-zero protection. Firsthand depletion and food-handling interruption tests retain their non-codec assertions. Juvenile strike accounting retains actor/ecology normalization, exact stocks, interruption and deterministic continuation without restoring a legacy world reader.
- Current aquatic and H1 suites retain cross-object identity/ownership, finite ledgers, atomic refusal, action identity/replay, delayed effects, active-work restart and byte-preserving corruption tests. Peer teaching tests exercise actual controller communication and current save stages without crediting testimony as personal experience.
- The sandboxed direct-boot smoke, aquatic close/reopen and H1 close/reopen scripts are distinct native gates. Screenshots use the real renderer; synthetic local exposures are labeled, and view-only landscape previews cannot change saved state.

Historical failed autonomous fishing trials remain failed diagnostics. The revised current landscape has its own measurements; no historical green test count is presented as current-build verification.
