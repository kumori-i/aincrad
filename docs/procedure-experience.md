# Descriptive retained procedure experience

This is a structurally testable, policy-disconnected stage, not a survival fix.
`createProcedureExperience(npc)` derives a fresh frozen view solely from the
supplied actor's bounded canonical action, experiment and recognition ledgers.
Nothing imports it at runtime. There is no flag, selection weight, new memory,
save field, action, RNG call or physical change.

## Contract

- Input limits: 400 retained events, 160 experiments, 64 recognized effects.
  Oversized arrays fail before row inspection. No technique, hidden physiology,
  ecology, source stock, donor actor, lifecycle deadline or world access.
- At most 160 episodes, 160 total samples and 64 total verified effects. Output
  rows are detached and frozen. Recompute after retention changes; do not retain
  this projection as a replacement ledger.
- Each own successful pull with material or grasp starts a handling episode.
  The latest matching acquisition must have original action/experiment identity
  and complete intervening event continuity to own a sample. A later grasp does
  not inherit an earlier producer. Unprovable chains become exact-item-only
  sample episodes; no retired acquisition or original recognition is restored.
- Every effect binds the original sample, ingestion, item and condition receipt,
  including qualitative fields and original emission and recognition times.
  Duplicate identities are ambiguous, not extra evidence. Future timestamps
  cannot establish knowledge. Adverse observations remain visible alongside
  earlier relief and take precedence in descriptive status, not action ranking.
- Hunger, energy and thirst observations are separate. Water relief alone is an
  other effect, not food relief. Pain stays on each effect. Unchanged means only
  that recorded observation, not zero calories or an ineffective future source.
- Acquisition-to-sample, sample-to-emission and sample-to-recognition elapsed
  intervals are distinct. Original action durations and qualitative handling
  effort have their own witnessed rows and separate lower-bound sums. Do not add
  the two sums, or add either to elapsed time. They are overlapping descriptions,
  exclude approach/rest/unrelated work, and are not exclusive causal or all-in
  costs. Missing/invalid duration contributes no asserted seconds.
- Completion, remaining cost, future relief/harm/adequacy, availability and
  historical coverage always remain unknown, including after positive effects.
  Missing pending markers or elapsed lifecycle timeout never means failure.
  Pending/ready admission context is unknown because these retained receipts do
  not capture that decision context. It is not reconstructed from elapsed time.

## Ownership and coverage limits

Canonical receipts carry actor-local IDs, not authenticated actor/epoch fields.
The actor object is the trust boundary: the API never takes a donor ledger or
combines actors. Donor effects without this actor's original chain are rejected.
An entire forged internally consistent copied actor history cannot be detected
from these data alone. `actorId` and `actorEpoch` label the supplied actor, not an
independent ownership certificate. Do not use this view across actor epochs.

This stage describes retained acquisition/sample procedures only. Existing
receipts do not establish rest/exploration need-effect chains or whole-procedure
fatigue relief, readiness, complete historical cost or net maintenance. Those
remain unavailable; no substitute claims are inferred. Source refusal and other
unlinked work are not rolled into an episode's cost. There is no policy use or
claim of improved survival, generalization, or passing the prior rejected gates.

## Baseline and provenance

The clean detached worktree starts at shipped `2601d6e`, not either rejected or
unfinished behavior candidate. Only the bounded receipt validation helpers were
extracted from the staged `care-evidence.js` into `procedure-receipts.js`; its
technique candidates, policy fields, admission, continuation and alternatives
were deliberately not retained. Durations in this narrower primitive-only
projection are accepted only within the existing 30-second primitive bound.

Tests cover structural binding, ownership limits, water separation, future
knowledge, adverse revision, retirement, reacquisition, duplicate/misbound IDs,
bounds, hidden-field independence, immutability, unknown costs, no runtime
imports and a fresh physical pull/sample/recognition fixture. The physical
fixture compares the next decision and post-decision actor with and without
calling the projection. No long autonomous survival experiment is appropriate
for a disconnected descriptive module.
