# Offline technique provenance report

Run `node scripts/report-technique-provenance.mjs INPUT.json NEW-REPORT.json`.
The input envelope contains `world`, a retained full snapshot, and optional
`history` entries `{worldId, actorId, serial, receipt}`. The world lineage's actor
serial scopes incarnation identity. Historical scope must come from the original
run's provenance, not be inferred from equal receipt numbers or an actor name.
The CLI accepts at most 32 MiB and writes a new output exclusively; it refuses to
overwrite evidence. It never ticks simulation, loads runtime authority, updates
learning, changes policy or modifies the source artifact. Exit 2 means unavailable
input, not an experimental outcome.

Every identifier is accompanied by world/actor/incarnation and a namespace.
Technique evidence numbers refer to **experiment IDs**, not action receipt IDs.
For example experiment 65 can reference action receipt 210, which produces an
object later sampled by experiment 66/action 212. Numeric equality across these
namespaces or across actors is never a join rule. Aggregate successes/failures
cannot reconstruct evicted details.

The helper reuses existing retained receipt validation and procedure-experience
projection, including ambiguity and continuity gates. It adds no eligibility
rules or runtime capture API. `retained-linked` means one retained experiment
matches its action receipt, not that its whole chain is complete. `materials`
contains the existing projection's continuity classification and separately
reports sample/ingestion and retained feedback recognition. Missing or rejected
feedback remains `missing-or-unverified`, not an adverse outcome or no effect.
Missing experiments remain unresolved even if a historical receipt has the same
number. Contradictory or duplicate identities cannot establish a link.

Historical action receipts are separately marked `historical-trace-only` and
never substituted into the retained projection. Historical condition feedback
is shown only when its exact sample, ingestion, material and recognition links
validate against scoped receipts; it always has `authority: none`. This first
report does not recover an evicted experiment or build an entirely historical
acquisition chain. Historical coverage and absent rows remain unknown. Input
records alone cannot attest that a supplied trace is authentic; retain original
artifact hashes and provenance separately.

This is an observer report of existing evidence, not an additional trial.
Bounded execution and durable technique attribution may be documented separately;
comparable ranking, net benefit, transfer and ordinary learning success are not
established by this report. Frozen producer analyzers/protocols remain unchanged.
