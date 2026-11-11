# Stable-world routine save preparation: read-only proposal

Status: design/measurement only, no new runtime edits or new measurements.
Baseline: merged main 1f20f401f720b61069dcea06d10cc4e885e0b1f6, tree
6154cd156ed0ef1dbf873fefb7ab1d7b9fa3b970. Local aincrad-world has the identical
tested tree. Its feature milestone and both exact-merge CI workflows are complete.

## Finding and smallest approach

src/main.js calls synchronous writeSave for the 10-second autosave and also
selection, panels, focus/visibility, waypoints, scene transitions and lifecycle
changes. save.js validates the entire world and JSON-encodes it before a single
localStorage setItem. Current matched warm in-memory measurements are main
58.72/68.49 ms and juvenile main 74.84/117.03 ms upper-median/p95. These exclude
actual localStorage and renderer-frame costs.

Use a constrained static worker only to prepare routine snapshots. Keep the same
v8 schema, same localStorage key, same validators, and renderer-only one-key
commit. Explicit Save/Ctrl-S, new expedition, reload and final unload retain a
synchronous current-state barrier. This avoids a storage migration, native
filesystem bridge, async-close/provider-suspension rewrite and any research
learner changes. It is a hypothesis about routine-save responsiveness, not a
promise that dispatch or localStorage becomes nonblocking.

Earlier aincrad-save preparation research offers a fixed prepare/release worker
protocol, explicit blocked flag, pure prepareSave factoring and actual worker-CSP
tests. Reuse only these ideas adapted to stable v8. Do not merge its temporal
wire encoding, schema versions, synthetic memory fixtures or proposed IDB/close
integration. Its 10.6 MB learner timings do not predict this 3.6 MB world.

## Proposed correctness contract

1. Factor stable writeSave into pure prepareSave(state,{blocked}) and one storage
   call. Synchronous and worker preparation use the identical function and retain
   every current raw-feature/lifecycle guard. The function throws instead of
   turning an unsupported source into an authorized fresh save. Input objects,
   RNG, active commands, clocks and body/resource stocks are never mutated.
2. Dispatch the current plain world once with postMessage, without a preceding
   structuredClone. The send is one coherent JS-turn snapshot. Check coordinator
   protection AND the non-enumerable state.saveBlocked before dispatch and carry
   protection explicitly. Recheck protection and world identity at commit.
3. One worker, one admitted request, one dirty flag, no retained second snapshot,
   no promise list for repeated UI events. Each snapshot has a world epoch,
   coordinator-instance identity and monotonically increasing request sequence.
   Only the matching current worker's exact in-flight response is eligible.
   Apply the same guard to error/messageerror/timeout callbacks and UI changes.
   Retire an admitted request before invoking commit/status callbacks. Replies
   from an invalidated worker/epoch and already-retired duplicate IDs are ignored;
   they release no current request and never write or claim success. Unexpected
   future IDs or malformed current protocol responses fail the worker closed.
4. A completed routine response may commit only in the same epoch and with a
   sequence newer than the last committed sequence. If requests coalesced during
   preparation, commit that coherent snapshot then dispatch one fresh snapshot;
   show pending until the coalesced request is covered. Never return an old
   prepared string from a queue after a newer synchronous save.
5. A synchronous barrier first invalidates the in-flight generation, clears the
   dirty flag and terminates/detaches that worker, then calls existing writeSave
   on the current live state in the same JS turn. New/load/replacement/reset must
   invalidate the world epoch BEFORE changing the state reference. UI test reset
   is included. Cancelled unload can create a fresh worker for a later request;
   it neither cancels actor commands nor advances closed time. No async wait is
   introduced in beforeunload/pagehide, and current native DOMStorage flushing
   remains. This preserves the existing normal-close contract; it is not a new
   power-loss guarantee, and app.exit/crash cannot establish latest-save success.
6. Infrastructure failure (worker error/timeout/malformed protocol response)
   ends the attempt, retains disk bytes, releases its snapshot and latches the
   worker off for this session. Clear the dirty drain intent; do not immediately
   retry in the same frame. The NEXT independently scheduled/user-triggered
   ordinary save uses baseline synchronous writeSave with all protection checks,
   so routine saving is not silently disabled. Explicit Save and the final
   barrier also remain synchronous. No worker recreation loop or hidden pending
   retry. Validation/protected-source rejection is a separate failure, never
   reclassified as infrastructure to bypass guards. Storage/quota rejection
   likewise retains the prior committed record. Those failures end the attempt
   and clear coalesced drain intent; a later independent request can retry only
   under the unchanged source/storage guards. Status remains failed until a
   genuinely successful commit or a new truthful pending attempt.
7. Saved status follows successful setItem only. A prepared response is not a
   save. Initialize fresh worlds as unsaved and protected loads as protected,
   rather than inheriting the HTML default label. Distinguish preparing/pending,
   committed snapshot and failure; stale replies cannot change UI status. Manual Save keeps its existing synchronous
   boolean result. A failed storage write cannot announce success.
8. Single-key writes are the atomic unit. No write/remove/write sequence or
   backup migration is introduced. This coordinator orders one renderer's writes;
   localStorage has no cross-process compare-and-swap. Multi-instance conflict
   prevention is an existing separate limitation, not a new guarantee here.

## Bounds and security

- Structurally bounded ownership: one source clone in flight, one canonical worker
  result, one returned text, one dirty bit; no second queued world or unbounded
  waiters. Release references on commit, rejection, timeout, replacement/dispose.
- Keep the reviewed 64 MiB UTF-8 prepared-output transport ceiling, explicit ID
  bounds and timeout. Exceeding it refuses this async path without trimming or
  invalidating the original source; manual/exit synchronous protection remains.
  That is not a 64 MiB JS-heap claim or a proof that inbound cloning has no cost.
  Inputs come only from the existing bounded live world, not arbitrary UI JSON.
  Measure actual heap/RSS and retained-count behavior; cap failure is reported.
- A manifest-listed same-origin module worker, fixed prepare/release messages,
  no persistence command, URLs, paths, code strings, shared memory or native IPC.
  Keep sandbox/Node/navigation/permissions unchanged. Add explicit renderer
  worker-src self and worker-entry response CSP blocking fetch, eval and nested
  workers on the actual app protocol and loopback test server. Independent
  security review and actual negative probes are required.
- Renderer response checks are bounded protocol checks: exact allowlisted fields,
  protocol version, boolean outcome, current worker/epoch/request, finite timings,
  nonempty bounded string length and plausible UTF-8 byte count; error codes
  use a fixed allowlist. No second full JSON parse
  or semantic world validation is proposed on the renderer. Semantic correctness
  relies on the fixed trusted worker running the common stable validator; this
  does not claim detection of arbitrary Byzantine text from a compromised worker.
  Tests must distinguish malformed protocol fields from arbitrary text semantics.
  Include every implemented response check in main-thread timing. Worker failure,
  validation rejection and storage quota/error remain separate diagnostic kinds.
  Any failed validation/storage attempt latches that attempt's error and clears
  coalesced drain intent; it cannot drain the same dirty flag into retries.
  A later independent request is distinct from recursive failure handling.
- Disable the async worker path in hot-development mode, signaled by a fixed
  desktop launch flag to the renderer; dev saves remain synchronous. The build
  copies modules sequentially, so a generation/fingerprint alone cannot prevent
  mixed worker imports during rebuild. Native worker QA uses a clean immutable
  build. Normal renderer reload is tested, but desktop dev restart/SIGTERM,
  app.exit and process kill are last-committed-save cases, not final-barrier proof.
  CSP does not remove IndexedDB capabilities; absence of persistence is a
  property of the fixed worker code/protocol, not a general capability sandbox.

## Fixed proposed measurement and promotion gates (approval pending)

Stage A is instrumentation in disposable test builds/profiles only. Its harness
uses the actual proposed coordinator and fixed worker protocol, so their overhead
is included rather than replaced by a direct worker-only microbenchmark. Before any
integration, decompose the current synchronous path and a preparation-worker
prototype on four frozen physical inputs: fresh v8, the recorded unmodified
900-second full-population save, the actual saved juvenile/remainder/deferred
fixture, and a legal physical-cap stress copy (768 plants,256 animals,256
materials; the same two recorded actors). The latter uses declared test-only
initial-stock construction, unique IDs, valid producer coordinates and rebased
initial-energy accounting, with full canonical v8 validation before freezing.
It is not an ecological outcome or a maximum-size actor-history claim. No
research learner or synthetic knowledge is inserted. Record all input hashes
and stress construction before measurements.

Each physical fixture is a frozen matched A/B input pair: A has
selectedAgentId=aster and B has selectedAgentId=mira; every physical field is
identical. Both are valid v8 snapshots with the same two actors. Precompute and
verify canonical A/B text and hashes. Preseed B once before each arm/session,
then allow the same 500 ms settling period. Execute A/B alternation continuously
across the cold, warmup and measured saves in both arms. Do not preseed between
samples. Assert and retain the prior-text hash versus requested-text hash before
every measured commit; they must differ. Preconditioning/hash verification is
outside timed windows with the same declared settling/sampling schedule in both
arms. Same-value writes, if included at all, are a separate named control and
cannot satisfy the write/frame gates. This avoids localStorage's specified
identical-value no-op path.
Use two isolated sessions per fixture, reverse arm order in session two, retain
the first cold sample separately, then four warmups and 20 measured saves per
arm/session, with the renderer drawing and
physics paused. Keep all measured samples/outliers. Record renderer dispatch,
worker validation+JSON time, response handling, actual localStorage setItem,
end-to-end completion, full frame/event-loop gaps over dispatch through
completion+100 ms (including reply deserialization before handler entry),
process/heap peaks and maximum retained snapshot/request counts. Compare exact
canonical bytes and restored states. Timing intervals must include all added
coordinator/commit work; do not time only the worker. Renderer synchronous work
means directly timed dispatch/request, response-handler and commit spans. Do not
infer pre-handler deserialization CPU from round-trip minus worker time: full
frame/event-loop windows are the complementary observation of that hidden cost.

Proposed engineering gate, fixed before outcomes: in every fixture/session,
p95 total synchronous renderer save work is at most half the matched baseline;
p95 of each dispatch and commit stage is <=16.7 ms; p95 maximum frame gap around
saves is <=33.3 ms and no worse than matched baseline. Report upper-median and
nearest-rank p95 conventions, maxima and all raw values. These are limited
cloud-development targets, not laptop certification. If any fails, do not
integrate/promote or tune the threshold: preserve the result and identify the
dominant measured stage. No storage-backend migration in this task.

Before any promotion, bounded deterministic tests must cover same-time/stale/
duplicate/malformed replies, request storms, replacement/new/load/reset, explicit
save during preparation, successful/failed/cancelled unload, timer/error disposal,
quota/storage errors, protected v7/future/malformed v8, non-enumerable saveBlocked,
legacy migration, real active actions, sleeping bodies, pending digestion,
Cardinal pending work and resolved/rejected optional model calls,
juvenile local accounting and actual radius7 carcass ownership. All existing
406 tests and native smoke/reopen remain gates. Demonstrate exact bytes and the
same canonical restart behavior as synchronous main; do not claim uninterrupted
active-command resumption that current validators do not promise.

Stage B, only after A passes and review: integrate the coordinator, run finite
fixed-step default parity with asynchronous delays injected, then actual native
routine autosave/manual-save/new-game/close/reload in two processes. Confirm
Escape-only pause and background progression, no stale overwrite, no changes in
world/actor evolution or extra simulation time, and bounded live request/clone
counts during a 60-second request-storm fixture. Normal close must use real
BrowserWindow.close/reload/app.quit with work pending, without an explicit
pre-close save or settling wait that hides the race, rather than app.exit.
Do not deduplicate beforeunload/pagehide solely by elapsed time because same-clock
UI mutations can change saves. Report cancelled-close and failed
storage behavior without claiming crash durability. Independent correctness and
security review, exact-head CI and main permission remain the final gate.
Also retain one matched 120-second ordinary-play segment per arm with native
physics and Cardinal active, original 10-second autosave cadence, same start and
scripted UI schedule. Report every save, frame/event-loop gap, step backlog and
Cardinal workload alongside baseline. It is a concurrent-load check, not a
large-sample responsiveness distribution. Any save loss, queue growth, new
causally linked renderer work span >50 ms, or simulation/pause regression blocks
promotion; unresolved outliers must be investigated rather than attributed to
Cardinal or host noise without evidence. Paused Stage A can support only its
isolated-save claim.

## Platform sources checked 2026-10-16

- https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-setitem
  setItem returns early for identical text and checks inability to store before
  replacing its value; the standard
  warns that cross-agent-cluster locking is not defined.
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy
  Worker data is copied; its entry response needs its own CSP.
- https://www.electronjs.org/docs/latest/api/session#sesflushstoragedata
  flushStorageData writes unwritten DOMStorage data to disk; it is not an
  asynchronous-application completion protocol.
