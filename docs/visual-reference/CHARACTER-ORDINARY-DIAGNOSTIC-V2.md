# Ordinary character-gate diagnostic v2: prospective plan

**Preparation only. No v2 trajectory or activation has occurred.** The first
ordinary pilot, [run 41126563920](https://github.com/kumori-i/aincrad/actions/runs/41126563920),
its source `6612d4d5c0d873130df6f9ef00eba73c71ea96e9`, protocol, approved
receipt and once-only refs remain frozen. Its [result note](CHARACTER-ORDINARY-PILOT-V1-RESULT.md)
records two valid listener demonstrations but no paid replies, and many
composite `no-peer` decisions. This separate run asks which existing first
failed predicates account for those two bottlenecks. It does not change agent
behavior or train from diagnostic labels.

The preparation starts from merged PR #76 main commit
`34885b37fa1ffbcefc28d1252b55345c31091fb2`, tree
`5d65a2a0363380100a548e049ffeb8228f5578b1`. That tree already contains
the observer-only subcause counters. A later reviewed receipt must bind the
exact final preparation commit and tree before any native execution.

## Frozen setup and activation

The protocol ID is `ordinary-character-gate-diagnostic-v2`. Its one-time
activation ref is `experiments/character-gate-diagnostic-v2-once`, its separate
single-file receipt-data ref is `experiments/character-gate-diagnostic-v2-receipt`,
and its dedicated create-only workflow is
`character-ordinary-diagnostic-v2-once.yml`. Creating the receipt ref, opening
a PR, or pushing main cannot start this job. The workflow accepts only the
named branch-create event at attempt 1. A prior run, including a failed or
prelaunch run after branch deletion, consumes that activation. There is no
manual dispatch or retry.

The final source commit and tree are deliberately absent from this tracked
document to avoid a self-hash cycle. Before activation, an external reviewed
receipt must freeze their exact values, the complete tracked-source manifest,
the v2 protocol and runner SHA-256, generated observer SHA-256, built runtime
fingerprint, and renderer asset-manifest SHA-256. The receipt lives outside
the source tree on the separate ref and is fetched read-only once. A dirty,
unsupported, malformed, or mismatched source/profile/receipt fails closed.
The v2 protocol imports the unchanged v1 observation functions and changes
only its ID, workflow and refs; the full source manifest binds both modules.
Parent engineering review of the prospective plan, exact source, native guards
and receipt precedes the sole activation. That gate does not authorize a run
from this preparation commit.

## One ordinary observation

- One fresh, empty, disposable Linux x64 sandboxed Electron profile, normal
  Ozark map, default Aster/Mira spawns, body and ecology, normal survival
  choices, speed 1, fixed step 1/60 second, and untrained character policies.
  Physical world seed 74193 and communication seed 211 are declared in advance.
  No fixture ownership, test stepping, forced meetings, injected resources or
  messages, imported weights, priority suppression, or seed search is allowed.
- Run until the **first observed** 1,200-simulation-second threshold, then
  pause once through the ordinary renderer route. The total wall cap is 30
  minutes. Read the clock on fixed one-second wall slots and a compact detailed
  projection no more often than every ten simulation seconds, committing the
  actual projection clock. Missed slots/windows are counted without catch-up.
  A stop gets five seconds for terminal closure; incomplete or uncertain
  evidence stays incomplete. No outcome-dependent extension or retry.
- Keep at most 32 MiB structured JSONL with 256 KiB reserved for terminal
  evidence, 16 MiB combined process logs/media, and 256 KiB per IPC record.
  Source projections contain at most 256 retained transaction rows and 64
  admission-gate keys, with disclosed eviction, omission and saturation. No
  weights, private crops, trajectories, hidden object IDs or permissions cross
  the observer projection. Reads cannot draw RNG, train or save.

## Predeclared readout

At terminal, reconcile each existing generic `no-peer` gate count against the
sum of fixed `no-peer:*` first-failure counts. Reconcile the generic
`response:response-not-resolvable` count against the fixed
`response-preflight:*` first-failure counts. Require zero omitted gate keys
and unsaturated counters for a complete subcause accounting; otherwise report
the partial coverage and do not infer a missing category. A first failure says
nothing about predicates later in that short-circuit order. `optionalChecks`
are decision-boundary calls, **not seconds of available communication**.

Report emissions, paid inspection starts/completions, unique valid listener
demonstrations, replay uses, optimizer steps, paid reply starts/completions,
sender feedback and updates, original and response censors separately. Critic
accuracy has only completed demonstrations as its denominator; a censored
exchange is not a wrong choice. Include retained-event loss, body and survival
context, and the original source/run/receipt identity in any result report.

The same seed and observation caps make this a **paired descriptive follow-up**
to the first run. It is neither an independent seed replication nor a causal
control, and identical early transactions are not guaranteed across source,
host scheduling or fresh-world lineage. Tiny counts do not establish a stable
word, generalization or survival benefit.

After the run, inspect the largest observed failure classes against actual
source and engineering geometry before proposing a behavior change. Distance
failures suggest ordinary separation; active or urgent failures point to real
life/action priority that must stay intact. Occlusion or reverse-gesture
invisibility calls for sight-geometry review; reverse ambiguity calls for a
parser/visible-distractor review. Missing selected objects or invalid reverse
resolutions under otherwise current transactions warrant a source-bug audit.
If examples or subcause coverage remain sparse, the result is insufficient
evidence for policy or reward tuning. Any later mechanism change needs its own
reviewed scope; this workflow performs observation only.
