# Private visual associations — bounded implementation

This extends the same main-world physical channel proven in [Phase A](PHASE-A.md).
There is no second playable world, imported model, English dictionary, shared
global vocabulary or concurrent old bodily-credit communication learner.

## Supplied memory rules

Each actor owns at most 16 immutable visual anchors using its own 48 pooled RGB
features from supplied 16×16 object crops. A privately shuffled inventory of 64
arbitrary symbols assigns a distinct stable symbol to each anchor. Symbols are
never silently reused and anchors do not drift or evict. These budgets, RMS
metric and thresholds are engineering biases, not learned concepts or creativity.
Allocation is seeded and deterministic: the same seed and encounters can repeat
the same arbitrary labels after reset, without retaining any learned memory.

Both mutually visible alternatives must pass pure anchor preflight before any
referent draw. A match requires exactly one anchor at RMS distance ≤ .04 and a
runner-up margin ≥ .02. Only distances all > .08 allow a new anchor. Gray-zone,
ambiguous or saturated plans abstain. Both alternatives must receive distinct
symbols, including prospective additions. The chosen pair commits atomically;
then separately owned domain-separated streams choose a uniform referent and candidate order. There
is no redraw after seeing the referent or outcome.

A listener stores at most four immutable own-view demonstration examples per
current-partner symbol. It compares both current own candidate crops to the
nearest retained example. A confident choice requires exactly ONE candidate
within .04 and a runner-up margin ≥ .02. If both match, neither matches, the
entry is unknown or conflicted, choice is uniform over both candidates. The
sender's target identity, pixels, features, gaze and critic result are not inputs.

Only canonical completed paid indication plus the final valid sampled visibility
window authorizes one corrective observation. The listener stores its OWN final
fresh crop from the physically parsed demonstration. Any missing, ambiguous,
changed-referent or unfunded sample clears pending demonstration data. Canonical
completion does not substitute for perception. Correction authority is consumed
even if no example is added, and duplicate terminal callbacks cannot update again.

Within .04 of an existing example, correction records support without moving the
example. If all distances exceed .08, it adds a new example; gray-zone evidence
does not update. A fifth novel example permanently marks that symbol entry as
conflicted rather than remapping or evicting evidence. Conflict is ambiguity, not
sickness or negative physiological reward.

## Identity and persistence

Partner keys bind actual actor, discovery and physiology object identities, not
names or reusable engine IDs. Normal collapse, rescue and recovery change the
bodily epoch and cancel pending transactions but retain memory. Actor/discovery/
physiology replacement retires identity and purges old partner bindings before
any choice or correction. Partner maps contain only current actual partners.

Private associations are runtime-only: reopening, new attachments and world
reset start empty. Ordinary survival bodies and memories still save. No user
save is deleted by this change, and serialized action/observer fields cannot
restore executable authority or learned associations.

## Evidence and scope

The inspector distinguishes optional opportunities/abstentions, attempted
messages, observed canonical demonstrations, new examples, repeated support,
conflicts, matched choices, exploration and independent reference correctness.
Observer English is not agent speech or a translation of their symbols.

Tests establish bounded state and causal authority properties. A deliberately
scheduled native retrieval fixture, when passed on its exact source, can show
actual own-view example acquisition and message-dependent retrieval. The narrow
fresh-profile QA reader consumes one no-input capability over the FIRST completed
transaction, reacquires its two candidate crops through complete current own sight,
and compares actual-memory known-symbol, absent-symbol and reversed-order queries
on that identical timestamped pair. It never samples a policy action, updates
support or consumes policy RNG, and does not fall back to old views if sight fails.
Reports retain capture timestamps/hashes and before/after state identity. That is
not an autonomous learning rate, held-out generalization, abstract categorization,
grammar or survival benefit. Identical art on a new object ID is not abstraction.

No new autonomous cohort or outcome-tuned parameter search is authorized by this
implementation. Future evaluation requires its own reviewed frozen protocol,
fresh seeds, bounded training/freeze and intact/shuffled/erased/fresh controls on
the same own observations. Historical protocol fixtures remain unchanged.

## Deterministic randomness correction

The initial Phase B implementation used XOR-related seeds for linear xorshift32
streams. This made target-bit XOR candidate-order-bit seed-independent at each
exchange round: individually balanced bits were not enough. That source's native
proof remains engineering evidence for its own fingerprint, not this revision.

The reference channel now uses the fixed `weyl-fmix32-v1` noncryptographic
counter/avalanche generator in `visual-reference-random.js`. Pair, target, order,
exploration and symbol inventories have fixed purpose domains; actor identity is
a separate numeric input for inventories. The uint32 Weyl increment is
`0x9e3779b9`; both seed derivation and each output use the documented
[MurmurHash3 fmix32](https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp)
finalizer. There is no exceptional zero fallback or shared mutable root stream.

Before executing regression diagnostics, the formula and bounds were fixed:
seeds 0..4095 plus five explicit boundary/high-bit cases, 64 rounds, each
per-round target/order joint cell fraction .15–.35 and each marginal/ordered-target
fraction .35–.65. Inventories use seeds 0..4095 and identities 1/2: every result
is a 64-label permutation, each first-position label count must be 8..192, and
cross-identity first-position equality must be .001..08 (denominator 4096).
These broad structural guards, the retired-generator negative control and
independent BigInt arithmetic checks are not proofs of statistical independence
or cryptographic quality. No generator, bounds or native default seed 211 was
selected from favorable behavioral outcomes. Revised runtime requires new native
proof; no autonomous acquisition or survival result is implied.
