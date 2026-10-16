# Proposed bounded repair: preserve complete learned-effect proof

Status: design for independent review and parent scope approval. No production implementation or new census is authorized. The completed correctness-only experiment and its archive remain immutable.

## Problem and selected approach

The preserved 900-second baseline loses four water-relief effects only when saved. Their original sample/action dependencies have rotated out, while live effects, condition proofs, physiology feedback and seen-feedback cursors remain. This is a dependency-retention mismatch; no physical resource loss or changed sustained-food/discomfort choice was demonstrated by those four losses.

Use existing fields and fixed buffers. Retain a learned fact together with its complete original proof. When optional knowledge competes for finite space, forget complete owners explicitly during live processing, in a deterministic order. Save/reopen must not make an additional hidden forgetting decision. No memory-capacity refusal or delay of drinking, eating or another physical action is permitted.

A feedback or DISCOVERY_EFFECT record is not a substitute for a missing successful sample/action pair. The strict identity/time/result/provenance checks remain. A new compact proof store is the larger alternative, described in analysis.md; it is not selected. No new persisted fields or research-model changes are proposed.

## Exact bounded core

The guarantee applies to discovery-mode actors; legacy-mode semantics remain outside this change.

- At most 24 actual digestive inputs plus 64 genuinely unseen feedback identities: at most 88 distinct ingestion identities. Sampled identities retain their successful sample experiment and exact action receipt. Non-sampled intake retains its existing action receipt without being promoted to sampled knowledge.
- Each of 64 retained personal effects owns its exact successful sample/action and at most one original matching condition proof.
- At most 4 physically held items each retain one valid acquisition/action witness and their already-observed sensory identity. Multiple rows merely mentioning that item are not all mandatory.
- Keep current flask-fill proof, latest rest/sleep outcome and the last valid entry proof for each of the 4 physically defined shelters.
- Stage at most one completion experiment and a bounded two-event synchronous linkage window. No bookkeeping event may consume the action ID already passed to ingestion.

Conservative experiments:24+64+64+4+1=157, within160. Conservative experience:160 selected experiment receipts+88 extra non-sampled pending receipts+64 effect condition proofs+1 flask+1 rest+4 shelters+2 staging=320, within400. This overcounts shared identities; it does not depend on overlap. A transient 65th learned effect adds at most one condition record before ordinary FIFO retirement, so the conservative staging bound is321. Four held sensory identities reserve4 of128 observation slots. Derive and assert all arithmetic from current source constants and the actual shelter list.

The original acquisition needed to recognize a future source technique is soft support. It is not necessary to learn that a swallowed exact material produced a personal effect. Treating both sample and source acquisition as mandatory for all pending portions would invalidate the smaller bound. Losing soft acquisition support must never invent a technique, fail a sample, or erase its personal effect.

The bound covers supported fixed-cap runtime states with genuine linked witnesses. Malformed arrays, conflicting IDs and old orphaned claims do not create new mandatory proof. Existing physiology/body contents remain authoritative even if historical learning proof is incomplete.

## Atomic mutation boundary

A pure bounded planner returns keep/remove sets and whole-owner retirements. It does not observe the world, perform actions, allocate IDs, draw RNG or modify physiology. Live application is atomic after all causal links for the current operation exist.

1. Complete the ordinary physical action once. Stage its original action receipt without trimming; register its experiment/owners; compact once. Preserve the existing ingestion/action ID binding and completion reentrancy safeguards.
2. Recognize one genuine feedback result. Stage effect and original condition receipt, assign proofEventId, finish its technique/report links, then compact once. A 64-feedback batch is a bounded sequence of commits, not one unbounded staging transaction.
3. Unrelated event insertion protects the same complete existing closure. Restart-interruption logging must not discard proof immediately after restore validated it.
4. Every supported recognition route must use the authoritative condition recorder. The present callback-free processDiscoveryFeedback path cannot silently create an effect whose only proof will later vanish from the separate physiology queue. Resolve that linkage without inventing condition records for historical orphaned conclusions.
5. Pending ownership ends only after the ingestion is absent from the stomach, no emitted unseen feedback remains, and its current recognition commit is finished. First water relief, deleted per-object pending marker, consumed object, or the 45-second behavioral wait is not sufficient. No calories/species/toxicity inference is exposed to the policy by this bookkeeping.

The shared planner runs after biology's existing bounded feedback append/trimming, never between its transient 65th append and trim. It preserves the existing biological feedback FIFO; it does not retain every lost unprocessed message forever.

## Deterministic forgetting proposal

Retain hard causal/physical owners and all currently retained effects. First remove oldest unowned detail/history bundles, preserving survivor order. If full closure still exceeds a cap, remove whole soft owners in this order:

1. Oldest executed report owner, including support/status/cursor. Never reset its cursor and replay instructions. Retirement itself must not automatically re-import the report from retained community/journal data. A later real read_note or newly heard message may legitimately introduce a new report under existing rules; no persistent tombstone or permanent duplicate-suppression claim is added.
2. Oldest discovery-mode learned template skill owner, leaving independently mandatory flask/rest/shelter evidence intact.
3. Oldest source technique owner, cancelling only future steps of a transient run of that exact technique. An already-started physical action is neither cancelled nor rewritten; its ordinary completion and receipt remain authoritative.
4. Oldest optional source-acquisition support for future technique discovery, while retaining its pending sample/action.

Within a class use earned/created time, then numeric actor-local ID, then original array order; no locale/RNG tie break. A shared bundle may free no records: retire that owner once and continue, never delete a still-protected dependent.

Effects keep their existing 64-entry FIFO policy. When a 65th effect is admitted, retire the oldest effect explicitly in live state. Reconcile a dependent technique/report only if no valid alternative complete witness remains; retire unsupported owners as whole units. Do not add extra effect loss below 64 to make the implementation fit.

At most 215 optional/staged owners can be considered under the conservative bound in analysis.md; each retirement removes at least one owner and creates none. At most 215 retirements plus a final closure check. Scan at most 161 experiments and 402 staged experience rows. The implementation must test these exact bounds and idempotence, not rely on likely overlap or an unbounded retry loop. Planner diagnostics are fixed reason enums and bounded integer counts for owners/rows kept or retired. They allocate no experience IDs, persist no new fields, and create no accumulating production log. The returned keep/remove sets are limited to the same capped input arrays; test instrumentation may retain them outside actor state.

This explicitly changes retention priorities under capacity pressure. It may change live future choices by forgetting a routine earlier. It must not change choices only because save/reopen happened, and it must not obstruct bodily primitives.

## Historical saves and strict validation

Complete existing chains can retain their current schema. The frozen validator's successful action/sample/effect checks must not become weaker. Save verification should reject unexplained loss of a retained valid effect; it must not silently run the forgetting planner as an extra save-only mutation.

The failed 900-second live fixture has already lost four original sample/action pairs. Preventive retention cannot recover them from feedback/condition text. Preserve that exact fixture and keep its original failure verdict. For imported orphaned states, the proposed safe behavior is an explicit protected incomplete-provenance result that keeps original bytes; no autosaveable silently downgraded state and no invented replacement IDs. The already-canonical fixture has erased the four effects and cannot reveal every historical loss without an external log. Ordinary loading must not use the research trace to reconstruct history.

A second historical case is valid under the old validator: original sample/action plus currently retained physiology feedback, but no original condition receipt because recognition used the callback-free path. Treat that queue-dependent state as protected migration-limited input. Do not mint or backdate a historical condition. Complete original durable chains remain admissible.

Delayed recognition itself needs no validator change: the existing condition predicate compares embedded details.feedback.at with effect.at, while the outer condition timestamp remains the genuine later recognition time. Preserve both clocks and test sleep followed by physiology-queue rollover. No timestamp relaxation is proposed.

A new proof reserve or changed proof contract would need a separate versioned migration and old-reader protection. That larger option is excluded here. Use the existing protected-save recovery path: a fixed incomplete-learned-provenance warning and nonenumerable saveBlocked latch, zero storage writes, and only an explicit new expedition may replace the original. Apply protection to direct validate→write as well as load/write entry points. This is a compatibility limitation to approve with the repair, not a new repair/import UI.

## Explicitly deferred technique-count issue

Parent has selected direct-effect continuity only. Current technique successes accumulate live, but restore derives successes/confidence from distinct retained witnesses; the failures≤successes+2 policy gate reads that value. Do not reset or redefine those counters, confidence, or eligibility in this repair. Record an exact reproducible isolated case for later follow-up.

The required parity claim is retained effects/proof plus isolated effect-driven decisions across save/reopen, subject to existing declared transient interruption. It is not universal policy parity. Tests must expose the unrelated technique normalization explicitly rather than weakening expected equality or counting that mismatch as fixed. Report/cursor and held-possession retention checks prevent new dependency loss; unrelated trial/practice/cognition behavior remains out of scope.

## Acceptance gates before publication

- Preserve exact failed L/C/R fixtures and hashes. Demonstrate explicit incomplete-proof rejection without reconstructing the four missing chains. Use a separate fully evidenced fixture for preventive retention.
- Real successful sample→effect chains for water relief, sustained relief, discomfort and no-change. Roll 160 experiments and 400 events while preserving exact retained effects/proof through write/reopen. No synthetic labels replace real callback evidence.
- 64-effect FIFO,64-physiology-feedback rollover,24-input gut saturation, sleep-delayed recognition and same-object multiple ingestions. Early water relief must not release later personal-effect proof.
- Full distinct-owner157/320 bounds and staged158/321 or other precisely justified temporary counts; joint soft-owner saturation; deterministic whole-owner retirement, shared dependencies and planner idempotence. Verify no care refusal and unchanged physical result/material accounting.
- Append-before-link, callback failure/reentry, newest receipt, restart interruption at full buffers, paused/active actions, duplicate deliveries, actor-scoped IDs and no additional RNG draws.
- Current held identity/acquisition survives 128-observation rollover and save; no invented observations or owner reassignment. Flask/rest/shelter anchors survive competing soft history.
- Tamper each action/result/object/ingestion/time/provenance linkage independently. Failed samples, debug/rescue effects, peer reports, aggregate-only claims and conflicting duplicate IDs cannot create knowledge. No weaker feedback-only path.
- Exact effects/proof and selected eligible actions before versus after save for valid states, with only declared transient interruption. Any pre-existing technique-counter mismatch is recorded separately and remains unresolved; it is not waived silently.
- Ordinary source-wide tests/build, focused save protection/legacy parity and bounded planner-cost measurement before publication. No autonomous comparison, native timing claim, schema expansion or main merge is implied by these fixtures.

The longer source audit, cap inventory, alternatives and test considerations are in analysis.md (SHA 82dc0c337e9b0e674d0722ce75acc151f303dc15e9c94b18b5209616b487951b). This proposal governs the selected option; unselected reserve-specific tests in that appendix do not authorize a reserve implementation.
