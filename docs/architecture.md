# Aincrad: one Ozark world

## Runtime

`src/entry.js` always selects `ozark-world-main.js`. Normal startup loads the current save or creates one current world and begins immediately. Exact disposable native-test routes expose bounded QA hooks; they do not select another world. There is no original/recovered/pilot world routing or old-save migration service.

`desktop/main.cjs` owns the sandboxed window, allowlisted application asset protocol and narrow local-model/raw-backup IPC. `desktop/profile-route.cjs` confines native test profiles beneath OS temporary storage, rejects symlink suffixes and product-profile aliases, and rejects retired launch options. The renderer has no Node or arbitrary filesystem access. Asset containment uses canonical paths.

Desktop primary targets are Linux and macOS, with host-architecture builds. Other Unix platforms are unverified. macOS retains the app after last-window closure and recreates its sandboxed window on activation; normal Quit closes the app. Simulation remains renderer-owned and cannot progress while no window exists.

## Authoritative state and geometry

`ozark-world-geometry.js`, the Ozark terrain profile and structural helpers define the single watershed, water, collision and sight. Structural objects are deterministic, biome-appropriate and bounded by local caches. A visible tree/rock obstacle must match its physical geometry. Forest canopy coverage derives from structural oak/pine crowns (not mutable fruit-tree growth), while solar shade derives from those crowns and the saved environment time. Ground textures and cutaway visibility do not change physical shade or obstruction.

`ozark-agent-world.js` binds inhabitants to that geometry. `population.js` coordinates independent agents and nearby communication. `environment.ecology` is the single owner of finite resources. The shared clock advances environment, ecology and each body once; renderer frames never provide extra simulation ticks.

`ozark-save.js` validates one current format under `aincrad.world.v2`. Current corrupt data is protected, and writes preserve compare-and-swap expectations. Retired keys are not read or migrated. Schema 12 requires aquatic v2. The retired v1 storage slot is not consulted: this increment starts fresh without destroying it. Explicit [world reset](WORLD-RESET.md) prepares and validates a fresh world before replacing only the active value; it freezes old save paths, requires confirmation, checks the captured bytes, disposes the old population and reloads. The current-world native backup route is separate from the obsolete raw-save bridge. Reload interrupts unfinished actions without completing them or inventing action receipts. No closed-time catch-up occurs.

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

## Own handling inquiry

`handling-inquiry.js` links a completed paid failed grasp to an earlier own successful pull on a distinct currently similar-looking source. Fresh firsthand cues and ordinary care/access gates permit one exact-source paid pull, never an automatic sample. Non-evicting bounded admissions prevent replay; optional details retire when their receipt proof is compacted. Schema-12 optional metadata is strict, and UI/model views are read-only. See [scope and verification](HANDLING-CURIOSITY.md).

## Grounded individual names

Separate naming state and runtime modules retain bounded personal lexical evidence and coordinate local pointing and later reference checks. Event-time personal sensing, speech access and bodily priorities gate the protocol. Pending exchanges are not saved; retained names cannot recreate sensory observations. The selected-agent panel only projects chosen, heard-grounded and confirmed labels, without global renaming or model authority. See [scope and evidence boundaries](GROUNDED-NAMES.md).

## Presentation and remaining work

`ozark-world-renderer.js` and `art.js` draw the same authoritative state, with original pixel artwork, habitat substrates, water/banks, trees, rocks, cast shadows and maps. Camera canopy cutaways improve readability without removing objects or changing agent sight/shade.

The retired original-world Cardinal panel is not part of this runtime. Some engine/diagnostic building blocks remain for future bounded supervision work. Reliable autonomous pursuit, long-term self-maintenance, generic taught hunt plans and richer social reasoning remain separate features.

See [verification](TESTING.md) for required evidence, and [roadmap](ROADMAP.md) for explicit limits.

## Passive visual similarity memory

`visual-group-memory.js` retains at most 32 actor-owned exact cue triples with
at most two ordinary sensory sample times each. Only the ordinary
`rememberObservation` ingress opts into recording; speech/naming refreshes and
action descriptions do not. Derived tentative groups require two individuals
with two distinct-time samples each, not independent encounters. The supplied
shape/color/texture rule changes no policy or action authority. The journal
projects support separately from individual names and shows restored/unseen
members as remembered-only. Optional schema-12 evidence is strictly validated;
reload never senses. See [scope](TENTATIVE-VISUAL-GROUPS.md).

## Adverse-material testimony

`food-warning.js` validates bounded delivered sender-proof snapshots and binds
them to exact heard peer messages and separate unverified reports. Local speech
constructs canonical uncertain wording from actual adverse personal evidence.
`sampleEligible` consults unexpired exact held-material caution without changing
physiology or copying personal learning. Optional schema-12 metadata is strict;
heard eviction retires authority, and reload does not re-deliver. See
[scope and limitations](FOOD-WARNINGS.md).

## Appetite, funded work and retained food evidence

Human `satietyHours` is bounded appetite memory, independent of available/stored
energy. Accepted food credits it and ordinary physiology time decays it; water
alone does not. `projectPhysiology` reflects committed ingestion immediately
without advancing simulation time. Qualitative hunger and energy remain distinct
inputs to care selection; exact calorie stores are not cognition inputs.

`npc-effort-funding.js` certifies physical work only after a matching energy debit
and metabolic ledger entry. Runtime-only witnesses gate interaction progress and
movement input, with finite deadlines and separately integrated passive current.
Controller sanitization forwards learned-run travel ownership only for the
original admitted request; unrelated urgent care does not inherit its deadline.

`discovery-completion.js` pairs optional literal-true final-mouthful metadata with
actual successful sample receipts. A separate transient witness permits only the
bounded finished-piece acquisition exception; save metadata cannot recreate it.
`food-source-caution.js` uses the actor's own retained exact extraction/adverse
receipt chain, never donor knowledge or hidden ancestry. Direct adverse material,
own-source caution and received peer warnings independently gate sampling.

`receipt-proof.js` contains neutral provenance checks; diagnostic procedure
projections do not become action authority. Retention permits 168 experiments
and a 169-row staging scan, including four recent own extraction origins plus
origins needed by held materials. Strict schema-12 validation rejects malformed
appetite, completion and testimony data instead of inventing or replaying proof.
See [food mechanics](food-balance/README.md), [funding](NPC-EFFORT-FUNDING.md) and
[source-bound verification](food-system/VERIFICATION.md).
