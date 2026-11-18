# Choice diagnostic v2: guarded prospective protocol

This increment supplies a dedicated hosted coordinator, arm, read-only history
guard, evidence journal and analyzer. Ordinary branch publication is inert. Only
the separately approved branch-create activation can execute a cohort. No run has
been activated by development or synthetic tests. Exact-head review/CI gates and
owner-authorized activation remain required before execution.

Frozen before any execution: seed **78217**, 1200 simulated seconds, 72000 ticks
at 1/60; same runtime-source fingerprint `a4f39099b935133fd959541f9896aa3f34cdd7840b9d876f6d3ea9f94dd86412`
in both arms. This seed was checked against available historical protocol files
in the cloud checkout/worktrees; no matching use was found. The future activation
review must also check retained run evidence and remote activation history. Prior
74201/74203/74205, 75211, 76201 and 77201 cohorts are not rerun or modified.

## Question and minimal observation

Which prerequisite actually blocks a comparable actor-local known prefix? This
is not a baseline/candidate policy comparison. Both arms run identical current
policy; off leaves `setProcedureDiagnostics` disabled, on enables it on initial
actors. Read existing `procedureEligibilityDiagnostics` once after each fixed
tick. Do not shadow-evaluate candidates, add pathfinding, query hidden ecology,
change needs, preload evidence, reposition actors, or alter proof gates.

The collector receives initial world/actor references and externally read
snapshots. It grants no authority and never imports runtime policy. It checks
world, actor, incarnation, memory/discovery/physiology references and epoch, every
tick, diagnostic serial continuity and unchanged repeated snapshots. Replacement,
rollback, gaps and disappearance fail closed; partial data must be retained by
the runner and cannot be labeled complete. A latest-only snapshot can lose
multiple entries in one tick: the serial check detects this, not repairs it.
The runner must call capture after every successful tick and finish after exactly
72000 ticks; incomplete coverage or a failed tick invalidates the pair.

Incarnation and diagnostic serial are separate fields. Reached gates report only
what policy examined. After the first barrier all later candidates and downstream
gates remain unknown. An effort barrier follows a successful quote at the same
index but excludes it from the comparable prefix. An empty prefix is not absence
of eligible alternatives. Zero comparable sets is an informative negative result,
not permission to lengthen the run or relax requirements.

## Hosted execution safeguards

The dedicated one-shot workflow uses `experiments/choice-diagnostic-v2-once`
branch-create activation, attempt 1 only. Independently review its complete source
and exact head before activation. Use read-only history checks covering filtered
and unfiltered complete pagination, including deleted/recreated branches, and
reject previous matching activations. Concurrency must not cancel an active run.
Publishing collector files alone is not activation or approval to skip review.

Run off then on continuously and sequentially on the same allowed Linux CPU,
24-minute host timeout per arm, 60-minute job limit with artifact-upload margin.
Remove repository tokens from simulator/analyzer environments. No save/reload,
checkpoint reconstruction, retries, horizon/seed tuning or frozen cohort replay.
Create started markers and all outputs exclusively. Preserve incomplete outputs
and upload on failure. Verify runtime and harness source fingerprints before/after;
record exact commit/tree, Node/host/CPU, raw artifact hashes and invocation.
No timing difference is a policy outcome.

Retain raw initial/save bytes, every paid receipt, one-second public snapshots,
terminal actor state, choices, inquiry transitions and action occupancy. Record
real paid receipt duration separately from occupancy. The analyzer consumes raw
initial/save strings and their SHA-256 claims, not mutable file paths. The caller
must attest the real files, source/harness fingerprints and run identity; an input
JSON cannot authenticate itself. Its aggregate outputs are not proof against a
fabricated input envelope.

Require same initial state and exact off/on equality of receipt trajectories,
public snapshots, actors, choices, inquiry transitions, occupancy and final saved
state. Only the four already-reviewed UUID namespace fields are normalized in
detached comparison copies; raw bytes are preserved. Collector world IDs are
checked against their own arm's initial world, not erased to join actors across
runs. Missing parity fields, incomplete coverage, raw-hash mismatch or source
changes are errors, not a negative behavioral result.

Report first reached gate distributions and exact evaluated prefixes. Do not
infer a blocker for unevaluated candidates. Even successful observer parity and
nonempty comparable sets prove neither improved survival, net benefit, transfer,
nor generalization. Any later behavior change needs a separate rationale and
separately frozen evaluation.

## Engineering checks

`tests/choice-diagnostic-v2.test.mjs` is synthetic collector/analyzer verification,
not an ordinary run. Existing procedure diagnostic parity tests cover genuine
paid engineering fixtures, read purity, private-state/RNG/route-call parity and
fault isolation. The runner needs independent review of its tests for activation,
exclusive writes, timeout/failure capture, terminal cleanup and artifact integrity.
Full aggregate checks/build remain publication gates. Native claims are unchanged.


## Concrete artifact contract

The coordinator checks the checkout HEAD against the activated SHA, records its
Git tree, runtime fingerprint, explicit harness dependency hashes and selected
CPU, and verifies them again after both arms. Files use exclusive creation. Off
and on execute in separate continuous processes on the same checkout and CPU.
Only the coordinator receives the read-only repository token; child environments
strip it. Activation history is checked before simulation preparation.

Each arm writes an exclusive append-only JSONL stream of receipts, changed inquiry
and choice snapshots, changed diagnostic gates, one-second public snapshots and
progress markers. The diagnostic collector is nevertheless called after every
completed tick. Receipt IDs must advance without gaps from their initial prefix,
match the memory next-ID counter and retain unchanged bytes while still visible;
ordinary eviction of already captured receipts is allowed. Scope changes or lost
new receipts invalidate the arm. No unobserved event is reconstructed.

Inquiry and choice APIs expose latest status, not transition queues. Transient
within-tick inquiry phases and choices can remain unseen. Inquiry snapshots alone
are therefore not proof of selection/nonselection. Diagnostic serials detect
lost chooser entries in the on arm; paid receipts provide separate action proof.
A coverage failure appends its observed diagnostic payload, then stops. Progress
and event files survive child termination when the operating system has written
them, but abrupt termination can leave a truncated final line. Such artifacts
remain incomplete and cannot pass the analyzer. No SIGKILL durability guarantee
or save/reload equivalence is claimed.

Raw initial and final saves are separate files. Saves are NOT written every tick.
The JSONL verifier compares complete stream groups with result arrays, diagnostic
rows, all 1200 progress markers and one completed terminal record. It checks raw
bytes against hashes before parity analysis. The coordinator additionally hashes
all surviving artifacts even on a failed child. A successful parity report is
still awaiting independent interpretation, not a beneficial behavior verdict.
