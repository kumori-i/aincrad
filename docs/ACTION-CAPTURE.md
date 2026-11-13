# Optional local action provenance diagnostics

This is developer-only observation. Ordinary startup does not enable it; no UI,
telemetry, export, policy input or persistent setting is added. No source-kind,
food-label, reward, movement, route or RNG policy changes are made.

On an existing PopulationRuntime, call startActionCapture({capacity:256}), then
drainActionCapture() regularly and stopActionCapture() when done. Start is
explicit, rejects double-start and existing actor ownership, and validates the
bounded per-actor capacity (1..4096 rows). It captures the actors owned by that
runtime at start. Current runtime populations are fixed; replacing the world
requires disposing the old runtime, as ordinary reset already does.

The runtime owns exact capture sessions. Stop returns final rows including
unfinished-action censoring, then clears its ownership. Dispose stops captures
before controller cleanup and discards their output. Call stop first if final
rows are needed. It does not stop a separately replaced capture belonging to
another caller. No diagnostic output survives a save/load or process restart.
State is only WeakMaps plus bounded buffers; returned detached rows belong to
the caller. Callers must not retain unbounded drained output accidentally.

Rows are metadataOnly schemaVersion1. Requests are not inspected until runtime
normalization/admission or completion. Only bounded own scalar action fields
(type, targetId, sourceId, seconds, duration, target x/y), outcome fields (ok,
code, eventId, durationSeconds, distance, materialId, ingestionId,
finishedMaterial), and existing positional/route/token metadata are retained.
Authored text, images, crops, arbitrary nested payloads, model state and gesture
trajectories are omitted. Metadata is still private simulation data; enabling
capture does not authorize publishing or uploading it. No network calls occur.

Tokens identify a request within its capture session, actor and epoch. Exact
active-object identity links asynchronous outcomes to their original request.
Synchronous completion uses the active request scope. Existing learned event IDs
remain unchanged. The observer does not reserve gameplay IDs. A nested request
cannot steal another request's admitted active object. Epoch/learner replacement
invalidates old ownership.

All sequences/counters are diagnostic. Zero drop/error counts are necessary,
not sufficient, for a complete study. Ring overflow drops new rows and reports
it; draining never silently marks a truncated trace complete. The scope stack
is capped16 and overflow increases errors. Disabled calls use a WeakMap lookup
and skip observer scope allocations/try-finally; completion has an early-return
lookup. No zero-overhead or universal equivalence claim is made.

Indication, shared-grasp or other direct entry paths that bypass requestNpcAction
remain explicitly unlinked. Missing active actions are censored at next drain,
request or disposal. Engine ARRIVED reports route completion at the recorded
position; it is not proof of exact coordinate equality, object reach,
acquisition, or an approach-source association. No per-action metabolic/water
causation is inferred.

Research21-test/120-second results precede this privacy/lifecycle hardening and
do not automatically validate it. Candidate-specific tests cover ownership,
cleanup, redaction, exact tracked save bytes/reopen, and a120-tick (2 simulated second) population
state/RNG comparison. Native close/reopen, all possible asynchronous entry paths,
and universal parity require separate evidence. This candidate is not published
or merged.
