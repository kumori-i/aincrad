# Native player-lesson held-out timing repair

The PR112 macOS failure is retained, not reclassified as a pass. Both paid
lessons completed without renderer errors, but a later held-out crop was absent.
The failed crop's exact snapshot was not recorded. Later diagnostics show agent
movement and changed visibility; this supports a timing-sensitive fixture
assumption, not a proven runtime or Canvas defect.

This engineering harness now captures the two identity-disjoint recipient-owned
Canvas crops on the loaded authored state before starting time. Capture is
read-only, checked against the complete original snapshot, and its numeric
inputs are retained and SHA-256 recorded outside the runtime learning bank.
Neither crops nor predictions are sent to teaching, controllers, saves or action
selection. After both genuine paid lessons pass their existing assertions,
prediction uses the earned bank on this fixed evaluation corpus. The unchanged
swapped-word, exact-input-match and RMS controls remain descriptive. Different
object identities need not produce different pooled features.

This changes evaluation timing: it does not assert later visibility, temporal
generalization, transfer or autonomous vocabulary. Failed pre-time captures now
retain the exact queried snapshot and ordinary sight result before aborting.
No runtime or ordinary producer-retest protocol changes are included. Hosted
native Linux/macOS execution is still required; source-only checks cannot prove
native Canvas success.

## Capture-stage diagnostic instrumentation

The subsequent macOS run completed both pre-time crops but timed out during the
first paid screenshot. Its capture callback included both `capturePage()` and
the after-witness renderer IPC, so the old timeout could not distinguish them.
New attempt telemetry records each operation's start/completion using the main
process monotonic clock. These are not simulation-time or renderer timestamps.
The attempt record is serialized before asynchronous evidence writes so late
completion cannot revise a retained timeout. The five-second total deadline,
single paid-capture attempt, paid-work assertions and visual review requirement
are unchanged. Instrumentation supplies diagnosis, not a pass or a retry.
