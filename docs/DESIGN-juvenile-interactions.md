# Finite juvenile strike interactions

Status: behavior contract for a bounded implementation from stable main
`1f20f401f720b61069dcea06d10cc4e885e0b1f6`. No implementation or native result is
claimed by this document.

## Observable behavior and scope

A completed, physically valid `strike` can damage one exact recruited apple
seedling/juvenile. Historical established trees, grass, brambles, animals and
detached materials retain their existing behavior. No historical wood, fruit,
new material type, actor skill, destination or population is created.

The damage rule is an explicit simplified simulation choice, not a measured
biomechanical model: remove up to **10 grams of existing structural mass per unit
power**, with finite nonnegative power capped at 4. The ordinary action supplies
power 1 and keeps its existing duration, practice adjustment and exertion. Invalid
power fails without mutation; zero power removes nothing. If positive damage
would leave less than the existing 0.1 gram terminal threshold, transfer the exact
entire remnant and remove the plant. A new 2 gram seedling can therefore be broken
by one completed ordinary strike; a larger juvenile can survive and shrink.

Only `lifecycleStage === 'juvenile'` with its existing recruited provenance is
eligible. Resolve the exact object ID again at completion. Do not substitute a
nearby plant or its source material. Public feedback is qualitative damage/breakage
and existing visible size/stage; no numeric structural energy, fertility, edible
label or hidden useful-action hint enters an inhabitant observation.

## Finite accounting and mutation

Use a pure strike-loss plan and the same authoritative loss accounting as drought:

- Lost mass takes proportional existing structural kcal and auxiliary water.
  An exhausted/terminal plant transfers all remaining values exactly once.
- Mass and kcal enter detritus at that plant's actual position. Existing regional
  deposition and global detritus admission/overflow rules apply. Rejected overflow
  remains in the existing discarded-mass/kcal counters.
- Auxiliary water is part of the mass proxy, not extra mass; record its release
  in the existing lifecycle water counter.
- Reuse lifecycle `lostMassGrams`, `lostKcal`, `releasedWaterMl` and
  `deadJuveniles`. These counters account for structural exits, with no new field
  distinguishing the cause. Historical drought evidence remains valid.
- Damage gives no immediate soil refund. Existing local litter decomposition
  later releases its abstract fertility units under the ordinary rule. Recorded
  historical nutrient uptake and photosynthetic input are unchanged by damage.
- Retain the same object identity and position while alive; recompute the existing
  seedling/juvenile visible stage from remaining mass. At terminal loss remove the
  object once and invalidate spatial lookup. A later strike on its old ID fails.

Do not mutate the plant array while the growth loop is iterating it. A shared
stock-loss commit may be used, with the existing deferred growth-removal path and
an immediate interaction-removal path. Cardinal total energy stays conserved
except explicitly recorded overflow; damage cannot add available food or grass.

## Action lifecycle, identity and replay

The supported actor path is `requestNpcAction` followed by `tickNpc`; it already
checks observation, reach, scene and line of sight, pays work/effort, and rechecks
the target at completion. Incomplete, canceled, interrupted, sleeping, collapsed,
busy or physically rejected work must not damage a plant. Nonfinite/nonpositive
tick duration must not bypass elapsed work in the exported discovery helper.

The exported `tickDiscoveryAction` currently relies on an optional completion
callback to clear active work. An omitted or observing-only callback can repeat
the same physical completion. Close this boundary without new saved fields:

1. Guard a currently ticking active-action reference against reentrant ticking.
2. If supplied exertion throws, retire and clear that same active reference,
   preserve any replacement, and propagate the error without committing the
   captured action's target effect. Arbitrary side effects already performed by
   a caller-supplied hook are not rolled back. Its already-incremented work
   cannot become an unpaid later completion.
   After exertion returns, require the same action to remain current before any
   physical commit, so cancellation/replacement cannot finish it.
3. Retire a fully worked action reference before its physical completion path.
   Repeated/reentrant use of that exact reference cannot apply a second effect.
4. Let the existing completion callback see its active context, then clear that
   same active reference in `finally` if the callback did not already replace or
   clear it. A throwing diagnostic/completion callback cannot enable replay.

Reference guards are private, garbage-collected runtime state. No journal,
experience, schema or saved replay token is added. Production callbacks retain
their existing result/risk/start-scene recording and next-decision timing.

The API has no caller-supplied request ID. An identical `{type, targetId}` submitted
after completion is a new intentional action and must pay its own work; it cannot
be classified as an external transport duplicate. While busy it is rejected.
Direct `interactEcologyObject` calls are authoritative engine operations, each
representing a new interaction, not idempotent commands. Their repeated use must
still be finite and fail after the target disappears. Arbitrarily reattaching a
cloned private active object is outside the supported command API.

Supported save/reopen cancels in-flight commands with `RESTART_INTERRUPTED`; it
does not resume or replay physical work. Preserve this behavior. A checkpoint
before completion therefore preserves an undamaged plant and an interrupted
action; a checkpoint after completion preserves exactly the damaged/dead state.

## Compatibility and acceptance gates

No new saved field or save version is planned. The existing v8 lifecycle schema
already stores all remaining stocks, cumulative exits, counts and ordinary
experience. Old v8 readers may continue using their previous future strike rule,
but must retain the saved physical result unchanged. No loss counter is reset or
renamed. Legacy migrations, research-save rejection and protected-byte behavior
remain unchanged.

Deterministic tests must establish:

- Pure power bounds, invalid input, zero loss, proportional stock transfer,
  exact terminal remnant and finite repeated damage.
- Exact target identity among nearby juveniles, unchanged source remainder and
  established plants, wrong scene/range/obstruction, stale/dead ID and no mutation
  before actual completion.
- Ordinary actor work/exertion and qualitative result; busy duplicate, canceled
  and interrupted work; repeated tick, omitted/observing/throwing completion and
  reentrant or throwing exertion/completion cannot double-apply one admitted action.
  A replacement admitted by a completion callback must survive terminal cleanup;
  cancellation or replacement during exertion must never commit the old target.
  Exactly-once probes must use a really grown nonterminal juvenile above 40 grams,
  since killing a fresh 2 gram seedling on the first hit would hide duplicate
  completion behind a missing-target refusal. Test those terminal seedlings
  separately.
- Global and regional resource-audit mass/energy/soil accounting, unchanged
  unassigned remainder, released auxiliary water and no immediate soil refund.
  Both partially full and exhausted detritus capacity must retain proportional
  admitted kcal and exact discarded overflow while lifecycle exits count all loss.
  Check once-only death and lookup
  removal, plus unchanged available-food/grass metrics.
- Save/reopen before and after completion, retained action provenance, unchanged
  damaged/dead stocks and counters, repeat round-trip and deterministic continued
  operation. Existing malformed/protected and legacy-save tests still pass.
- Full ordinary check/build and independent source/test review before any
  publication request.

Copied finite source fixtures and deliberate clock/age interventions must be
identified as such. Deterministic tests establish physical/accounting semantics;
they do not establish autonomous use, whole-map sustainability or natural forest
succession. Existing size-dependent drawing is reused. Actual native appearance,
two-process persistence and timing remain separate unqualified evidence; no
renderer/laptop responsiveness claim follows from these tests.
