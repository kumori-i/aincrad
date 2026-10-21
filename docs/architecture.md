# Aincrad: one Ozark world

## Runtime

`src/entry.js` always selects `ozark-world-main.js`. Normal startup loads the current save or creates one current world and begins immediately. Exact disposable native-test routes expose bounded QA hooks; they do not select another world. There is no original/recovered/pilot world routing or old-save migration service.

`desktop/main.cjs` owns the sandboxed window, allowlisted application asset protocol and narrow local-model/raw-backup IPC. `desktop/profile-route.cjs` confines native test profiles beneath OS temporary storage, rejects symlink suffixes and product-profile aliases, and rejects retired launch options. The renderer has no Node or arbitrary filesystem access. Asset containment uses canonical paths.

## Authoritative state and geometry

`ozark-world-geometry.js`, the Ozark terrain profile and structural helpers define the single watershed, water, collision and sight. Structural objects are deterministic, biome-appropriate and bounded by local caches. A visible tree/rock obstacle must match its physical geometry. Forest canopy coverage derives from structural oak/pine crowns (not mutable fruit-tree growth), while solar shade derives from those crowns and the saved environment time. Ground textures and cutaway visibility do not change physical shade or obstruction.

`ozark-agent-world.js` binds inhabitants to that geometry. `population.js` coordinates independent agents and nearby communication. `environment.ecology` is the single owner of finite resources. The shared clock advances environment, ecology and each body once; renderer frames never provide extra simulation ticks.

`ozark-save.js` validates one current format under `aincrad.world.v1`. Current corrupt data is protected, and writes preserve compare-and-swap expectations. Retired keys are not read or migrated. Reload interrupts unfinished actions without completing them or inventing action receipts. No closed-time catch-up occurs.

## Physical capabilities

`discovery-actions.js` and `ecology.js` execute paid actions. A terminal strike may refer to the actually created carcass through a separate result identity, not an acquired-item identifier. Carcass extraction is failure-atomic under capacity limits.

Aquatic modules own finite, moving shore fish, independent body compartments, metabolism and provenance accounting. A successful timed interception transfers an actual fish into an owned specimen. Pulling transfers tissue into a new material; sampling is admitted by the recipient's real finite gut. Misses, full hands and unavailable targets cannot create resources. No aquatic feeding or births exist yet.

The physical layer is available even when short ordinary-controller trials do not discover a whole chain. Diagnostic failure must remain visible. No source-wide food oracle, automatic hunt macro or guaranteed livelihood follows.

## Firsthand learning and secondhand guidance

Discovery experiments and delayed effects are recorded against actual actions and material identities. Retained techniques are supported by personal evidence. `proof-retention.js` and related helpers validate exact ownership and effect chains under bounded retention.

`social.js` delivers nearby, visible, awake speech under cooldowns. A verified sender technique can become a bounded attributed teaching report. `cognition.js` preserves the explicit identity fields needed by that real controller path. The recipient may attempt taught steps without random rediscovery, using only a recognized exact source and its own newly acquired material. Reports never grant personal food proof or proficiency.

Expiry, unavailable source and a failed physical attempt do not by themselves prove a food claim false. Own adverse or beneficial feedback supplies the relevant evidence. Restore must not reset ambiguous completed acquisitions into runnable advice. Human hints use the same reported-versus-experienced distinction and cannot resolve unknown animals through a private species table.

`npc-panel.js` exposes qualitative sensations, nearby messages, teaching provenance and actual action outcomes. Exact physiology stays in developer inspection. Optional local language models serve conversation rather than generating trusted physical results.

## Presentation and remaining work

`ozark-world-renderer.js` and `art.js` draw the same authoritative state, with original pixel artwork, habitat substrates, water/banks, trees, rocks, cast shadows and maps. Camera canopy cutaways improve readability without removing objects or changing agent sight/shade.

The retired original-world Cardinal panel is not part of this runtime. Some engine/diagnostic building blocks remain for future bounded supervision work. Reliable autonomous pursuit, long-term self-maintenance, renewable aquatic production, food transfer, generic taught hunt plans and richer social reasoning remain separate features.

See [verification](TESTING.md) for required evidence, and [roadmap](ROADMAP.md) for explicit limits.
