# Off-render save preparation: staged experimental design

Status: preparation-only slice implemented and reviewed; see [checkpoint evidence](TESTING-save-worker.md). Backend/close integration is deferred. Development branch: `feat/off-render-save-snapshot`, based on the reviewed temporal-core tree in draft PR #7. No autonomous temporal policy or default promotion is authorized by these measurements. The five-millisecond learning-update budget is a separate, still-failed gate.

## Motivation and measured limits

Actual isolated Linux Electron 44.7.0, three instrumented samples per case, synthetic saturated learner copies:

- Two actors: explicit structured clone 35.6–87.2 ms; validation 691.6–693.7 ms; wire encoding 72.8–78.4 ms; JSON serialization 34.7–36.4 ms; localStorage write 46.8–60.9 ms. Whole save about 10.62 MB.
- Sending that live object through MessageChannel takes 23.9–31.3 ms synchronously. Receiving it on the same renderer is not a measurement of a separate worker's scheduling or allocation.
- A strict IndexedDB transaction completes in 24.3–27.9 ms, with a 15.6–20.8 ms synchronous put and 19.4–23.3 ms observed frame gaps. Those put costs can themselves run in a worker.
- A redundant structuredClone before postMessage is unnecessary: message serialization is a coherent copy within one JavaScript turn. Mutation after the send must not change the copied world.

These are small development samples, not laptop results, a latency distribution, or a responsiveness pass. A 24–31 ms snapshot dispatch already exceeds a 16.7 ms frame. Moving validation off-thread does not solve that cost, nor the separate training-update cost.

## First implementation slice and stopping condition

Implement the pure bounded save-preparation contract and a static same-origin module worker, with independent security tests and actual Electron measurements. Keep the application on its existing save path during this slice. Exercise both renderer-owned localStorage commit and worker-owned strict IndexedDB in disposable profiles before choosing application integration.

The worker accepts only fixed messages, never paths, script text, URLs, action instructions or arbitrary native operations. Preparation performs the same `validateSave(..., {restoring:false})`, temporal wire encoding and serialization as the synchronous path. Factor this into one pure function used by both paths; preserve all existing validation, unsupported-version handling and exact-byte guards. It must reject protected states through an explicit envelope flag because `saveBlocked` is non-enumerable and does not survive structured cloning.

First-slice evidence must show:

1. Same canonical bytes for synchronous and worker preparation across discovery/legacy worlds, active actions, two saturated memories and protected/malformed saves.
2. Coherent snapshot under mutations immediately after dispatch; no mutation of the live world by preparation.
3. One request in flight and bounded messages. A second prepare is rejected, not queued as another multi-megabyte snapshot.
4. Actual worker imports succeed under the application protocol; worker network, eval and nested workers are blocked. Renderer Node access/navigation/permissions remain unchanged.
5. Separate timings for sender serialization, worker preparation, return transport, commit, frame gaps and maximum concurrent retained snapshots. Keep all failures and outliers.

After these results, review the integration/backend choice. Do not declare the long-lived application migrated merely because a test transaction succeeds. Do not introduce incremental mutable-object validation caches, copy-on-write world rewrites, a new filesystem bridge, or policy changes in this slice.

## Deferred application coordinator (requires a separate future review)

A renderer coordinator owns one worker, one in-flight snapshot, one pending/dirty flag, current world epoch and a monotonically increasing request ID. Repeated autosave/focus/panel requests coalesce without retaining additional snapshots or unbounded promise waiters. An explicit save succeeds only when its requested generation or a later snapshot in the same epoch is durably committed. “Saving…” and “Saved locally” are distinct states.

Snapshot dispatch reads the actual state once and sends it directly. Check both coordinator protection and state.saveBlocked before sending and again before authorizing a commit. Existing non-enumerable protection must never be inferred from the clone. New expedition and test reset invalidate the epoch. Preparation cannot train, advance simulation, consume RNG, alter active commands or mutate the live world.

Use prepare → authorize → commit, not an implicit worker write. A prepared reply contains only epoch/request metadata and bounded diagnostics. If keeping renderer localStorage, the reply also carries the serialized string and the renderer commits only after rechecking the current epoch/protection. If the worker owns IndexedDB, it retains at most one prepared string and awaits the matching authorization. Discard releases that string. Commit success is transaction.oncomplete, not request.onsuccess.

An already authorized write may complete after a new-world request. Serialize it before the replacement commit; never report the replacement saved or close as successful until the newer generation supersedes it. Stale replies cannot update UI or authorize another write. World replacement must have an explicit pending replacement state until its durable commit. Storage errors preserve the previous committed record and remain visible. Crash/worker failure does not silently fall back to a new save.

## Conditional IndexedDB backend and compatibility

Only adopt this if real end-to-end worker/localStorage results still show unacceptable commit stalls. The current measurements justify investigating it, but backend migration is separate from moving pure validation.

Use one fixed same-origin database and a fixed store, schema version 1. No user-supplied database names or paths. Current, previous and metadata update atomically in one strict read-write transaction. Bounded envelopes include format version, monotonically increasing durable generation, canonical world text, UTF-8 byte length and a corruption-detection digest. The digest is not authentication. Retain current and previous generations; never accumulate world history indefinitely. A whole-world transport cap must be explicit and protect any larger source instead of trimming it; it does not reduce either actor's 8 MiB memory budget.

Startup resolves authoritative storage before any begin/watch/test action can create or advance a world. Read-only startup failures, unsupported envelope/database/save versions, malformed records, checksum errors or missing current state in an already committed store produce a protected load. They never fall back to stale localStorage. Only a proven never-committed database may consult legacy localStorage.

Old-client compatibility requires more than leaving localStorage untouched: an old binary would otherwise run and overwrite a stale world. A proposed migration stores the exact original localStorage bytes in a durable fixed legacy-backup record in the same transaction as the first current snapshot. Only after strict completion and verification does the renderer replace the old key with a small version-8 unsupported-backend marker. Existing readers reject/preserve version 8. Re-read the old key immediately before installing the marker and require it still equals the original bytes; read the expected marker back exactly afterward. Marker failure or an uncertain write is a visible incomplete migration, not success. Never roll back the database or restore legacy bytes after an uncertain marker write. The original bytes remain recoverable in the backup; they are never deleted. On reopen before a marker exists, compare the observed legacy bytes against the stored migration source; a changed legacy copy is a protected conflict, never silently chosen or overwritten. Check the expected marker on every later save/close too: an already-open old client can still overwrite it. Any differing value or marker is a protected conflict. Recovery accepts only identical original bytes or the exact expected marker; backup export/explicit recovery and every crash phase require tests before integration.

Do not use session.flushStorageData as an IndexedDB durability barrier; it is documented for DOMStorage. Do not use an unverified backup as justification to overwrite an old key.

## Native close, reload and suspension

An async save cannot be made reliable by beforeunload/pagehide alone. Native integration needs a narrow close handshake, separately reviewed:

- Intercept an actual window close or application quit. Main creates one bounded request ID and sends a fixed save-close request to its own current main-frame renderer.
- Preload exposes a fixed subscription and a fixed bounded result, not generic IPC. Main verifies sender webContents/mainFrame, exact application origin/path and the currently pending ID. Reject replay/foreign results.
- At the renderer's closing boundary, stop simulation steps, Cardinal work, HUD discovery mutations and UI input. Clear held keys. Blur/minimize remain ordinary background simulation, not closing.
- Do not call population.dispose/cancel as if it were mutation-free. Proposed runtime-only suspension defers one complete provider settlement record per actor (success/error and final cleanup), replayed once on cancel with normal generation/epoch checks; no manufactured stale-response event. Defer already-in-flight panel configure/status provider switches too. Actual exit discards deferred delivery. This proposal needs focused resolved/rejected call, panel-promise and exact world/RNG continuity tests before adoption.
- Capture the final state after the boundary; allow close only after that generation commits, or explicitly acknowledge a protected/no-write state whose original bytes remain preserved.
- On error/timeout, keep the window open and let the user retry, cancel, or explicitly close without latest changes. Never claim saved. Cancel resumes the prior explicit-pause state and resets the wall-clock accumulator so closing time is not simulated.
- Repeated close clicks coalesce. Cover window.close, app.quit, macOS last-window behavior, development reload and renderer crash. app.exit bypasses normal close and cannot establish persistence evidence.

Browser QA can retain ordinary best-effort unload behavior, but must not claim native close durability. Native separate-process reopen is the gate.

## Security boundary

A static module worker uses existing manifest-listed `src/*.js` assets. Keep the renderer sandbox, Node integration disabled, fixed origin, denied window/navigation/permissions and local-only model bridge. Add explicit worker-src 'self' to the renderer policy. A worker has its own CSP: serve its entry with a response header on both application protocol and loopback server; script-src 'self', connect-src 'none', worker-src 'none', no eval/blob relaxation. Test actual behavior, not only strings in HTML.

Sources for the reviewed platform contracts:
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy
- https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction
- https://www.electronjs.org/docs/latest/api/session#sesflushstoragedata

## Promotion criteria

No change is promoted for test count alone. Require independent correctness/security review, native close/reopen, old-save preservation and migration interruption tests, default simulation parity, bounded queue/heap evidence and actual frame-gap measurements. Report remaining snapshot and training stalls explicitly. If the smallest worker slice is insufficient, preserve its measured result and design the next bottleneck rather than relaxing the original learning budget or hiding data loss.
