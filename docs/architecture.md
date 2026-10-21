# Aincrad: one Ozark world

## Runtime

`src/entry.js` always selects `ozark-world-main.js`. Normal startup loads the current save or creates one current world and begins immediately. Exact disposable native-test routes expose bounded QA hooks; they do not select another world. There is no original/recovered/pilot world routing or old-save migration service.

`desktop/main.cjs` owns the sandboxed window, allowlisted application asset protocol and narrow local-model/raw-backup IPC. `desktop/profile-route.cjs` confines native test profiles beneath OS temporary storage, rejects symlink suffixes and product-profile aliases, and rejects retired launch options. The renderer has no Node or arbitrary filesystem access. Asset containment uses canonical paths.

Desktop primary targets are Linux and macOS, with host-architecture builds. Other Unix platforms are unverified. macOS retains the app after last-window closure and recreates its sandboxed window on activation; normal Quit closes the app. Simulation remains renderer-owned and cannot progress while no window exists.

## Authoritative state and geometry

`ozark-world-geometry.js`, the Ozark terrain profile and structural helpers define the single watershed, water, collision and sight. Structural objects are deterministic, biome-appropriate and bounded by local caches. A visible tree/rock obstacle must match its physical geometry. Forest canopy coverage derives from structural oak/pine crowns (not mutable fruit-tree growth), while solar shade derives from those crowns and the saved environment time. Ground textures and cutaway visibility do not change physical shade or obstruction.

`ozark-agent-world.js` binds inhabitants to that geometry. `population.js` coordinates independent agents and nearby communication. `environment.ecology` is the single owner of finite resources. The shared clock advances environment, ecology and each body once; renderer frames never provide extra simulation ticks.

`ozark-save.js` validates one current format under `aincrad.world.v2`. Current corrupt data is protected, and writes preserve compare-and-swap expectations. Retired keys are not read or migrated. Schema 12 requires aquatic v2. The retired v1 storage slot is not consulted: this increment starts fresh without destroying it. Reload interrupts unfinished actions without completing them or inventing action receipts. No closed-time catch-up occurs.

## Physical capabilities

`discovery-actions.js` and `ecology.js` execute paid actions. A terminal strike may refer to the actually created carcass through a separate result identity, not an acquired-item identifier. Carcass extraction is failure-atomic under capacity limits.

Aquatic modules own finite, moving shore fish, independent body compartments, metabolism and provenance accounting. A successful timed interception transfers an actual fish into an owned specimen. Pulling transfers tissue into a new material; sampling is admitted by the recipient's real finite gut. Misses, full hands and unavailable targets cannot create resources. Bounded local producer stocks admit explicit primary-production inputs; feeding transfers those stocks into reserve, growth pays reserve costs, and reproduction transfers parental compartments into offspring. The global energy ledger includes both live fish and producer food. Bounded retained origin records track live fish and remaining physical materials. No automatic immigration or extinction respawn exists.

The physical layer is available even when short ordinary-controller trials do not discover a whole chain. Diagnostic failure must remain visible. No source-wide food oracle, automatic hunt macro or guaranteed livelihood follows.

## Firsthand learning and secondhand guidance

Discovery experiments and delayed effects are recorded against actual actions and material identities. Retained techniques are supported by personal evidence. `proof-retention.js` and related helpers validate exact ownership and effect chains under bounded retention.

`social.js` delivers nearby, visible, awake speech under cooldowns. A verified sender technique can become a bounded attributed teaching report. `cognition.js` preserves the explicit identity fields needed by that real controller path. A separate runtime-only food-sharing handshake permits a recipient to perform a real timed grasp of one voluntarily offered held material. Consent expires and does not survive reload; ownership changes atomically, and the recipient receives ordinary personal grasp evidence, not the donor’s experience.

The recipient may attempt taught steps without random rediscovery, using only a recognized exact source and its own newly acquired material. Reports never grant personal food proof or proficiency.

Expiry, unavailable source and a failed physical attempt do not by themselves prove a food claim false. Own adverse or beneficial feedback supplies the relevant evidence. Restore must not reset ambiguous completed acquisitions into runnable advice. Human hints use the same reported-versus-experienced distinction and cannot resolve unknown animals through a private species table.

`npc-panel.js` exposes qualitative sensations, nearby messages, teaching provenance and actual action outcomes. Exact physiology stays in developer inspection. Optional local language models serve conversation rather than generating trusted physical results.

## Observation-driven inquiry

A runtime-only consumption transport admits actual accepted bites/samples, not feeding activity labels or post-hoc reconstruction. Event-time perception gates a bounded separate inquiry ledger. A sequential generic experiment scaffold can influence ordinary action selection, while outcomes and delayed feedback remain linked to the observer's own canonical receipts. Rendering only projects that state. This is an initial observation-to-experiment cycle, not learned pursuit, broad causal reasoning, parallel deliberation or human cognition. See [the scope and evidence boundaries](OBSERVATIONAL-LEARNING.md).

## Presentation and remaining work

`ozark-world-renderer.js` and `art.js` draw the same authoritative state, with original pixel artwork, habitat substrates, water/banks, trees, rocks, cast shadows and maps. Camera canopy cutaways improve readability without removing objects or changing agent sight/shade.

The retired original-world Cardinal panel is not part of this runtime. Some engine/diagnostic building blocks remain for future bounded supervision work. Reliable autonomous pursuit, long-term self-maintenance, generic taught hunt plans and richer social reasoning remain separate features.

See [verification](TESTING.md) for required evidence, and [roadmap](ROADMAP.md) for explicit limits.
