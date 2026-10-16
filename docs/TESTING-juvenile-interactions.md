# Juvenile strike interaction checks

Base: stable main `1f20f401f720b61069dcea06d10cc4e885e0b1f6`.
Behavior contract: `docs/DESIGN-juvenile-interactions.md` (reviewed SHA-256
`11b9966151c5458707fd8eaa2c3198ff21a7b45926481fa44684732f92a91a80`).

## Mechanism

An ordinary completed strike uses a 10 g damage budget on one exact recruited
young apple tree, bounded by remaining stock, and also transfers any sub-0.1 g
terminal remnant. The existing four-second novice work and bodily effort are retained;
practice can shorten later actions through the existing rule. This is an explicit
simplified physical rule. Lost mass and proportional stored kcal enter local
litter; finite litter capacity sends overflow to existing discarded counters.
Auxiliary water is recorded as released. Normal later decomposition handles soil
fertility; contact itself returns no soil nutrients. Small terminal remnants are
transferred in full and the plant is removed once. Established trees keep their
historically untracked structure.

The action helper now owns settlement even without a completion callback. Its
private runtime reference guards prevent a completed reference, reentrant hook,
or throwing callback from repeating a physical effect. Cancellation/replacement
wins over old work; throwing exertion retires the affected work. A fresh identical
request after completion is a new paid action, because this API has no external
request nonce. An unsupported cloned private active object is not a replay token.
No saved field or save version was added.

## Deterministic fixtures and limits

`tests/fixtures/juvenile-interactions.mjs` is a copied finite-world fixture:

- Seed 74193; retain one existing fruit-bearing tree and existing regional soil,
  remove other plants and animals, and rebase the opening energy ledger before
  tested transfers. No structural stock or chemistry is fabricated.
- Pull and release one real apple at the specified local placement. Explicitly set
  ecology/environment clocks to day 4 and its age to 96 hours, then advance the
  ordinary 0.5-second ecology step to recruit a 2 g seedling from the 180 g apple.
- For nonterminal action/replay cases, hold the fixture at noon/rain and advance
  eight 3,600-second ecology inputs. Each input executes the engine's ordinary
  0.5-second substeps, actual local soil uptake and photosynthetic accounting.
  The target reaches 50.63751662303633 g. Cached fixtures are independently cloned
  for tests; they are shared setup, not independent ecological discoveries.
- The fresh actor then joins the copied world. Actor unit cases advance the body
  and action against a fixed environment snapshot, isolating the completion effect.
  A separate obstruction case deliberately relocates the target/actor into an
  actual cave obstruction after admission to check completion-time rejection.
- Capacity-boundary fixtures explicitly construct finite litter occupancy and
  rebase its opening/regional accounts. They test arithmetic and bounded behavior,
  not naturally reached litter saturation.

Checks cover proportional and terminal stock transfer; invalid/zero/capped power;
exact target and source identity; regional/global conservation; partial and full
litter overflow; no immediate soil/food/grass gain; once-only death; public
qualitative feedback; paid work; busy/canceled/collapsed/asleep/rejected actions;
callback omission, reentry, replacement and failure; invalid durations; and
save/reopen before and after completion with deterministic continuation.

The save tests use actual `writeSave`/`loadSave` with an in-memory storage adapter.
They preserve the existing in-flight `RESTART_INTERRUPTED` behavior. They do not
establish operating-system disk durability or two-process Electron persistence.
Rendering code is unchanged; no new native visual or frame-timing result is
claimed. The hosted qualification route remains unavailable before native launch.
These fixtures do not establish autonomous use, forest balance, natural mortality,
or laptop responsiveness.

## Verification record

On Node 24.19.0, `npm run check` passed **433/433** tests and
`npm run build` passed. Independent focused review passed **60/60** action,
accounting, pure-planner and existing lifecycle integration cases. All seven
runtime/test fixture hashes stayed unchanged across the final checks. Build
fingerprint: `ff4539ef8b61075785d1831239c6cf30d104a562c3991f07be8b1a9f05b68fe1`.

A separately retained deterministic capture uses the ordinary NPC action path at
1/60-second steps:

- The 2 g seedling transfers its 1.0555555555555556 kcal and 1.7 ml auxiliary water,
  then disappears once. Soil is unchanged and ecology energy is unchanged.
- The grown target falls from 50.63751662303633 g to 40.63751662303633 g. Local
  litter gains 10 g and 5.010971224353131 kcal; released auxiliary water is
  7.059244611505903 ml. Soil is unchanged. The calculated total-energy difference
  is −1.14e−13 kcal, floating-point roundoff within the existing accounting rule.
- Both require 240 body/action steps (four seconds to floating-point precision),
  and both reopen with exactly matching ecological state through the actual save
  API. The target's original finite apple remainder stays unchanged by the strike.

These two records share the declared fixture history; they are examples of the
mechanism, not two independent ecological experiments. Exact inputs, source
hashes, output hashes and limitations are in
`docs/juvenile-interactions-summary.json`. Raw logs and the capture source are in
`test-results/juvenile-strikes/` and the bounded evidence export. Generated build
files are not source changes.

The pre-implementation contract was reviewed at SHA-256
`75e1d5f1ab02e2756d279fed8d6eb28a36b03eab8178ad59b7e70328c3af0168`.
The final wording only clarifies that a throwing exertion hook cannot commit the
captured action's target effect; arbitrary caller hook side effects are not
rolled back. The physical rule and acceptance gates are unchanged.
