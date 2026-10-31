# Ordinary character and motor observation v3: prospective plan

**Preparation only. No v3 trajectory or activation has occurred.** The first
ordinary pilot ([run 41126563920](https://github.com/kumori-i/aincrad/actions/runs/41126563920))
and the distinct gate diagnostic ([run 41164800920](https://github.com/kumori-i/aincrad/actions/runs/41164800920))
retain their exact source, protocols, receipts, refs and evidence. This plan
starts from the merged neutral-motion source `58bb96cfaf3926301edb9500e9be399df8eb5f2e`
(tree `9068327a15aa6de13264fb692dbec16e53c49806`). The final v3 source
commit and tree will be frozen only after its observer and runner code is
reviewed. Their absence here avoids a source/receipt hash cycle.

## One ordinary observation

Use one fresh, empty, disposable Linux x64 sandboxed Electron profile. Keep
the normal Ozark map, default Aster/Mira spawns, physical seed **74193**,
communication seed **211**, untrained individual policies, body and ecology,
ordinary survival and optional-choice priorities, speed **1**, and fixed step
**1/60 second**. No fixture ownership or test stepping, forced hand motion,
meetings, resources, messages, hints, imported weights, priority changes,
seed search or favorable retry is allowed.

Observe until the first 1,200-simulation-second threshold and pause once by
the ordinary renderer route; cap the native launch at 30 wall minutes. Read
the clock on fixed one-second wall slots and a compact projection no more
often than every ten simulation seconds, committing the actual projection
time. Count missed slots/windows without catch-up. Allow five seconds for
terminal closure, recording incomplete evidence explicitly. Keep at most
32 MiB structured JSONL with 256 KiB reserved for terminal evidence,
16 MiB combined logs/media and 256 KiB per IPC record. Retained event rows,
censor reasons and gate keys keep the existing fixed caps and disclose
eviction, omission or saturation. No private weights, gesture rows, crops,
hidden object IDs or authority cross the projection. Repeated reads must not
draw RNG, train, save or change action selection.

A separate create-only workflow `character-ordinary-motor-v3-once.yml`,
activation ref `experiments/character-motor-observation-v3-once` and single-file
receipt-data ref `experiments/character-motor-observation-v3-receipt` belong to
v3. Creating the receipt ref, opening a PR or pushing main
cannot launch the run. Only the exact named activation branch creation at
attempt 1 can pass; any prior run for that workflow and branch, including a
failed or prelaunch run after delete/recreate, consumes the activation. There
is no manual dispatch or retry. An external reviewed receipt must bind the
final source commit/tree and complete manifest, v3 protocol, runner and
generated observer hashes, built runtime fingerprint and renderer manifest.
The receipt is fetched read-only outside the source tree. The final native
guards must verify clean source, exact host/profile, empty save, expected
seeds, fresh untrained actors, zero measurement/motor/gesture/predictor state
and ordinary start before the sole activation.

## Predeclared readout

For each actor, report exact neutral-motion **decision checks**, eligible
decisions after the supplied body/rate gates, and attempted selections. The
120-second budget is consumed on attempted admission. Separately report
actor-local ticks that actually saw a paid neutral pose and all already
sampled public-pose, visible-absence and unknown-sight ticks. Checks and
samples are neither elapsed opportunity duration nor distinct gestures or
completed physical actions. Zero peer-visible samples after a selection
cannot by itself distinguish interrupted payment from occlusion or distance.
The bounded gesture ring's retained rows, overflow and expiry counts describe
memory coverage; no raw row leaves the renderer.

For the session-only predictor, report forecasts, valid 30-tick targets,
unknown/gap censors, pose/absence targets and onset/offset/stable transitions.
Divide each model, frozen-prior and persistence Brier/log-loss sum by the same
**valid-target** denominator, also showing pose and absence strata. A pending
forecast or a censor is not a wrong prediction. If class variation is sparse,
report insufficient evidence instead of a high overall accuracy. These are
prequential scores on the learner's own training stream, **not held-out
evaluation**, causal response learning or proof of meaning. Generic pose
targets can come from ordinary object indications or neutral motions; the
separate observed-neutral tick count does not assign a predictor target to a
gesture type. Session resets, identity/epoch changes and saturated or omitted
fields make a whole-run learner score incomplete; keep segments separate and
do not impute missing intervals.

Retain the existing communication denominators: optional reference checks,
feasible opportunities, emissions, physically paid inspections and replies,
unique valid listener demonstrations, replay uses, optimizer steps, sender
feedback/updates and each censor stage. Critic accuracy is conditional on
completed demonstrations; censored exchanges are not incorrect choices.
The historical v2 reverse-preflight split no longer describes character
replies: their current interpretation follows the **actual paid** gesture.
Report the current response reasons directly, including ambiguous or unseen
replies, without a fabricated preflight reconciliation. Include health,
energy intake/absorption/expenditure/reserves, water, collapses, rescues,
meals and drinks as survival context. Never multiply attempted selections by
a full-motion energy cost: an interrupted action can pay only part of it.

If motion is never eligible, inspect decision-check coverage and ordinary
priority/body gates before considering a policy change. If eligible but never
selected, the supplied optional-choice competition remains the immediate
bottleneck. If selected but never seen, physical completion versus local sight
remains unresolved without further evidence. If seen but valid predictor
targets remain nearly all absence, prioritize observation diversity and
class-conditional reporting before interpreting a low aggregate loss. Paid
character replies and sender updates remain separately authenticated learning
events. A single fixed-seed trajectory cannot justify tuning for a favorable
result; the next change needs its own source and engineering review.

The same declared seeds and limits permit a **descriptive follow-up** to v1
and v2. Source behavior changed when the neutral motion became available, so
v3 is not a causal control, independent replication, vocabulary test or
survival-benefit trial. The native engineering fixtures validate mechanism;
they do not count as ordinary observations.
