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

**Historical mechanisms (inert in the default main world):** `social.js` can deliver nearby, visible, awake speech under cooldowns in explicitly opted-in legacy fixtures. A verified sender technique can become a bounded attributed teaching report. `cognition.js` preserves the explicit identity fields needed by that real controller path. A separate runtime-only food-sharing handshake permits a recipient to perform a real timed grasp of one voluntarily offered held material. Consent expires and does not survive reload; ownership changes atomically, and the recipient receives ordinary personal grasp evidence, not the donor’s experience.

The recipient may attempt taught steps without random rediscovery, using only a recognized exact source and its own newly acquired material. Reports never grant personal food proof or proficiency.

Expiry, unavailable source and a failed physical attempt do not by themselves prove a food claim false. Own adverse or beneficial feedback supplies the relevant evidence. Restore must not reset ambiguous completed acquisitions into runnable advice. Human hints use the same reported-versus-experienced distinction and cannot resolve unknown animals through a private species table.

`npc-panel.js` exposes qualitative sensations and the main-world Learning tab: exact emitted character strings, copied emission-time crops, selected actions and pending/settled/interrupted receipts. Assigned numeric symbols remain inspectable archival evidence. English labels are observer-only annotations, not translations. Exact physiology is observer-only: the Learning tab distinguishes modeled satiety from available fuel and stored reserves. `communication-mode.js` owns immutable runtime authority outside all persisted actor/community data. Main populations and standalone controllers default to grounded communication: legacy English/naming producers and report/caution/journal consumers are disabled, including late model completions. Historical fixtures opt explicitly into legacy behavior; there is no user mode toggle. Archived data remains visible but inert. Own bodily outcomes, earned techniques and physical observation remain active. Physical handoffs use supplied nonverbal consent gestures without semantic food payloads. English deprecation changed total agent behavior. The subsequent visual-reference branch replaces the main optional channel; historical studies do not establish results for it. Future studies need a new frozen protocol.

## Main-world visual reference and character messages

`visual-reference-attachment.js` owns one bounded reference transaction per actor,
not a clock or population. `ozark-world-main.js` still calls `beforeTick`, advances
the sole population/environment/body clock once, then calls `afterTick`. An
optional action runs only after ordinary bodily, safety and procedure gates.
The main world selects the `sequence` protocol; explicit historical fixtures may
select the archival `legacy` protocol. The old `communication-attachment.js`
bodily-credit learner is never installed alongside either.

Two distinguishable, mutually visible alternatives must both be geometrically
resolvable before a referent is selected. Independent new random streams govern
pair, referent and order. The sender samples one to six lowercase letters from
its own current 48-feature crop; the listener samples between its own two crops.
It chooses exactly uniformly before a first valid demonstration from that
sender incarnation. The old assigned-symbol inventory, anchor capacity and
legacy pair admission belong only to archival fixtures. Removing those capacity
gates changes the set of main-world opportunities relative to earlier symbol
runs; their exchange rates are not directly comparable.

`character-message-runtime.js` holds each individual's private sender weights,
baseline, sample RNG and revision. Its listener model, choice/replay RNG and
128-example FIFO are private for each actual partner incarnation. A sampled
sender trajectory stays behind an opaque one-use handle bound to the owner,
partner token and sender revision; a pending trajectory freezes sender updates.
The physical attachment consumes the handle only at the authentic completed
reply or cancellation boundary. A listener receives only the original heard
sequence, its own two retained candidate crops and its final own demonstrated
crop. Exactly one candidate must lie within RMS 0.04 with a strictly greater
than 0.02 runner gap. Valid completed demonstrations train once with up to
three uniformly sampled prior examples; ambiguity censors. Sender learning uses
only its own fresh visual match/mismatch after the optional paid reply, with the
baseline read before its one on-policy update. The observer's target identity,
critic correctness and object IDs never enter either numeric model.

The listener's paid inspection issues a private indication permit. The sender's
indication and the later optional listener reply each use the existing 1.8-second,
0.25-effort paid action within the unchanged 12-second transaction deadline.
Reverse reply visibility is checked after the original demonstration, so a
failed reply retains earned listener learning. Urgent care, timeout, collapse,
replacement, disposal and reopen retire unfinished authority. Canonical
runtime funding and success witnesses cannot be recreated from saved
action-shaped objects. The public indication remains the same schematic
24-unit segment and progress, shared by art and local geometry parsing.

`visual-reference-perception.js` uses ordinary local sensing and line of sight;
an exact 96-object raw cap is treated as incomplete. Every projected visible
distractor is considered. The supplied ±6-degree parser extrapolates at most
400 units without expanding sight. The final 0.5 seconds must comprise
consecutive actually sampled full 1/60-second funded intervals. Missing,
partial or ambiguous samples reset the measure; no sight is backdated.
Reference correctness remains an observer-only critic.

`communication-inspector.js` opens the same NPC Learning tab. `learning-view.js`
shows the literal emitted string and completed recipient actions, with English
observer notes separate from messages. It distinguishes unique valid physical
demonstrations, replay uses and optimizer steps from the archival integer-symbol
associations. At most 256 copied observer events are retained, with 32 per actor
shown. Read-only views and saves do not draw policy RNG or train. Pending handles
and observer events never persist.

Current saves remain schema 12, with a mandatory `features.characterMessages:2`
marker on new saves. The communication envelope has a v2 lineage marker and a
strict `characterMessages` v2 section while its validated
`visualReference` v1 subtree retains all old anchors, examples and four RNG
continuations. Exact historical three-key-feature saves, including complete
valid v1 communication sections, migrate in memory, read-only, to untrained
separate models. A missing or partial marked v2 section blocks loading
and preserves occupied bytes. Fresh/reset worlds and replacement individuals
start without acquired character training; continuing individuals resume
their own state. The existing pure current-export registration, compare-and-swap
save gate and confirmed reset still apply.

A fresh-profile, exact `?test=1` engineering installer can temporarily own
bounded manual 1/60 steps for native proof. It cannot mix normal timers,
begin, QA steps or ordinary saves; only its authenticated closure has a
one-attempt explicit checkpoint exception for isolated mid-gesture reopen
testing. No authority is persisted. Actual Linux/macOS native Canvas and
paid-action proof remains a separate gate for this integration. Prior phase
boundaries remain in [Phase A](visual-reference/PHASE-A.md), [Phase B](visual-reference/PHASE-B.md)
and [sender feedback](visual-reference/SENDER-FEEDBACK.md). Sparse ordinary
exchanges establish no stable vocabulary, composition, generalization or
survival improvement.

## Observation-driven inquiry

A runtime-only consumption transport admits actual accepted bites/samples, not feeding activity labels or post-hoc reconstruction. Event-time perception gates a bounded separate inquiry ledger. A sequential generic experiment scaffold can influence ordinary action selection, while outcomes and delayed feedback remain linked to the observer's own canonical receipts. Rendering only projects that state. This is an initial observation-to-experiment cycle, not learned pursuit, broad causal reasoning, parallel deliberation or human cognition. See [the scope and evidence boundaries](OBSERVATIONAL-LEARNING.md).

## Own handling inquiry

`handling-inquiry.js` links a completed paid failed grasp to an earlier own successful pull on a distinct currently similar-looking source. Fresh firsthand cues and ordinary care/access gates permit one exact-source paid pull, never an automatic sample. Non-evicting bounded admissions prevent replay; optional details retire when their receipt proof is compacted. Schema-12 optional metadata is strict, and UI/model views are read-only. See [scope and verification](HANDLING-CURIOSITY.md).

## Grounded individual names and tentative appearance vocabulary

Historical, explicitly legacy-only naming state and runtime modules retain bounded personal lexical evidence and coordinate local pointing and later reference checks. Event-time personal sensing, speech access and bodily priorities gate the protocol. Pending exchanges are not saved; retained names cannot recreate sensory observations. The selected-agent panel only projects chosen, heard-grounded and confirmed labels, without global renaming or model authority. See [scope and evidence boundaries](GROUNDED-NAMES.md).

In historical legacy-only fixtures, `category-names.js` adds an optional actor-owned appearance vocabulary without reinterpreting legacy individual bindings. A narrow local-model proposal returns only a token or abstention against personally sampled cues and existing vocabulary; the model does not choose actions. Conservative membership is derived from the supplied exact-cue rule, and listener grounding retains a local example rather than copying all speaker members. Changed or missing observations suspend membership without rewriting historical evidence. UI annotations distinguish present vocabulary from old event text, while bodily outcomes remain exact-instance evidence. Pending model work is bounded, cancellable and excluded after reset/disposal. See [model naming scope](MODEL-CATEGORY-NAMES.md).

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
members as remembered-only. The optional model-vocabulary layer may consume this
conservative substrate, but the sample store itself grants no lexical or action
authority. Optional schema-12 evidence is strictly validated;
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


## Passive survival decision observation

`survival-decision-observer.js` keeps process-local WeakMap diagnostics, never
actor/save fields or policy inputs. `discovery.js` opens an opaque scope after
its existing feedback, body and sensory reads, records only visited existing
gates, and closes in `finally`. Its original recovery choice is evaluated once;
requested and returned action/need are copied without changing either. Observer
errors are swallowed only at the diagnostic boundary, not policy exceptions.
Compound short-circuit sampling gates retain a composite label; branches not
visited are not failures. Candidate counts are existing filtered results, not
new searches. No body/route/recovery/eligibility query is repeated for narration.

History retains at most 64 decisions and 32 finite-enum notes per decision, with
explicit evictions/truncation and bounded aggregate counters. The Learning view
shows at most eight recent records. These are decisions, not completed actions
or a complete causal explanation. Epoch changes retain tagged records; replacing
the actor, discovery or physiology identity starts fresh. Reopening/reset starts
fresh. Reading the panel copies data and cannot consume RNG, advance time or
change stored history. The exact test route adds only a no-argument copied
selected-actor snapshot for native comparison.

Satiety is the human model's appetite-duration hours on its six-hour scale; zero
does not mean empty fuel or starvation. Available and reserve energy are shown
separately in kcal, alongside cumulative ingestion, absorption and expenditure.
The legacy `independentMeals` count is labeled food-sampling/feedback events,
not full meals. No food policy, physiological rate or save schema changes here.
Exact pre-observer discovery source reconstruction and independently bound clone
parity tests guard the selected results, state, RNG and exception behavior; native
UI evidence is a separate engineering gate, not a new learning cohort.
