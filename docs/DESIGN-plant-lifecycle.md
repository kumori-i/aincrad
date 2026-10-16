# Finite plant recruitment: proposed bounded world milestone

Status: juvenile-only implementation is under final integration review. See
`TESTING-plant-lifecycle.md` for the frozen verification and remaining limits.
Based on main `3db8304`.

## User-visible objective

Make the existing world develop through finite plant recruitment and visible young
plant growth, without refilling old regions, moving inhabitants, or pretending
that a moisture proxy is a hydrological simulation. This is the first plant-life
increment, not a claim of realistic forests or whole-valley ecological balance.

The default-world audit found 745 plants with only 23 free slots under the existing
768-object limit. All 49 regions contain plants, but many remote regions have only
one or two grass patches. The western-lake region has 203 plants and 72 animals;
the central region has 44 plants and four animals. Thus central settlement bias
cannot be diagnosed from total plant coverage or assumed central abundance.
Current trees age but have no structural-growth or recruitment model. Their
energy ledger includes fruit, not historical woody tissue.

## Proposed smallest implementation

1. Newly detached, finite apple materials may contain one recruitment opportunity.
   Historical materials acquire no seed capacity on load. Held material cannot
   germinate. Consumed or decomposed matter is never recreated.
2. A sufficiently aged unheld material in a suitable, collision-valid valley site
   may transfer a declared small fraction of its existing mass and energy into a
   new seedling. The remainder remains in the original material. A successful
   transfer consumes the recruitment opportunity; failed placement/capacity does
   not consume matter. Use saved, deterministic attempt timing and bounded search.
3. The new plant retains finite structural biomass/energy. Subsequent growth
   consumes local soil and records newly captured photosynthetic energy. Moisture,
   daylight, habitat suitability and crowding bound growth. Water remains the
   existing environmental proxy; do not claim finite watershed accounting.
4. Recruited plants remain capped juveniles with zero fruit in this increment.
   Maturation and reproduction are deferred. Existing mature plants retain their
   existing fruit rules and zero
   newly inferred historical structure. No legacy woody energy is invented.
5. Drought loss transfers actual new structural mass/energy to local detritus.
   Every terminal remnant is accounted for. No phantom nutrient return or global
   borrowing. No automatic replacement population.
6. Public appearance and pixel rendering distinguish seedlings and juvenile plants
   from mature crowns. Rendering remains read-only. New plants do not receive
   hidden food labels or grant inhabitants a route, recipe or destination.

## Engineering choices to settle during review

- Keep the current 768 plant cap in this increment and report cap-limited
  recruitment. Do not increase it without an explicit performance/save study.
- Proposed transfer: 2 g of an existing apple with proportionate existing energy
  and water; one opportunity per detached apple. These are simulation choices,
  not botanical measurements. Review whether the existing finite material
  representation supports this without inventing seed chemistry.
- Set juvenile growth and size-cap constants explicitly in engine-only configuration.
  Choose measurable simulation scales and document that they are simplified;
  do not represent accelerated sapling maturation as real-world validation.
- Place seedlings only at authoritative dry standing points with minimum spacing
  from existing woody plants (32 units from established trees and 24 from other
  juveniles), under a bounded attempt budget. Use the exact material position or
  a search within 24 units; never the existing 700-unit safePoint relocation.
  Test the actual natural fruit-drop offset of 45 by 30 units. Do not mutate static
  terrain or collision obstacles in this stage. Physical obstruction by growing
  trees is a separate interaction milestone.
- Use a new top-level version-8 save with an explicit lifecycle feature version.
  Stable v6 and research v7 clients must reject it rather than discard structure.
  This branch must reject v7 temporal saves until an explicit combined schema is
  implemented; it must not silently strip research learning.
- Old supported discovery saves migrate without adding plants, material, fruit,
  energy, soil or seed capacity. Preserve existing IDs, body states and memories.
  Missing or contradictory new-version lifecycle fields must protect the source
  save, not default to a fresh ecosystem.

## Explicit juvenile accounting contract

This uses the existing engine material-mass proxy, not a botanical dry-mass model.
`structureMassGrams` and `structureKcal` are separate from grass `biomassGrams`.
`structureWaterMl` is an auxiliary material property included in the mass proxy;
never add it to mass totals as a second mass stock. No closed elemental or
hydrological balance is claimed.

- Germination transfers fraction f = 2 / material.massGrams from
  the source mass, energy and auxiliary water into the juvenile. Sources below
  2 g are rejected without mutation. It creates no
  energy, soil or water. Only a successful atomic transfer consumes seed capacity.
- Growth admits g grams only after consuming g * .004 local nutrient units.
  Its mass and auxiliary water are declared external environmental inputs,
  recorded separately; its energy is recorded as photosynthetic input. Nutrient
  units are an abstract fertility budget, not grams added again to biomass.
- Drought transfers proportional structural mass and energy to local detritus.
  Existing detritus caps apply, including explicit discarded mass and kcal.
  Auxiliary water loss is recorded as released water, not added to mass balance.
  Terminal death transfers the exact remaining stock, with no floating remnant.
- Historical trees retain zero tracked structure. No aging-based retrospective
  biomass inference and no recruitment capacity added to historical materials.
- Cardinal total energy includes structural kcal. Available food and grass
  abundance exclude it. Test both metrics after germination and growth because
  Cardinal currently duplicates the plant-energy calculation.
- Juvenile fruit stays exactly zero regardless of season, age or yield rules.

## Acceptance and falsification

- Exact mass/energy transfer from one real fallen material to one seedling;
  zero changes under unsuitable, held, exhausted, blocked or full-cap conditions.
- Deterministic replay, pause and split-step behavior; at most one successful
  recruitment per actual opportunity, including save/reopen across its boundary.
- Growth consumes the plant's region only, with measured photosynthetic input;
  zero growth at exhausted soil and explicit response to daylight/moisture.
- Immature fruit exclusion, finite drought loss, detritus limits and terminal
  remainder accounting. Historical woody tissue remains outside the new budget.
- Old-save stock/identity equivalence; new-save lossless restoration; malformed,
  future-version, research-version and old-client overwrite protection.
- Actual Electron renders of young/mature stages and two-process persistence.
- Remote suitable and unsuitable copied-world fixtures with identical physical
  constants, plus bounded main-world checks. Distinguish fixtures from naturally
  occurring recruitment, and accelerated test clocks from native-step evidence.
- CPU/object-budget measurements and spatial reports. No claim that inhabitants
  learned exploration or that a few seedlings fix regional nutritional viability.

## Later work, excluded here

Finite water reservoirs and runoff, reproductive dispersal through animals,
general forest succession, wood harvesting/construction, dynamic tree collision,
and autonomous migration need separate, compatible physics/learning milestones.

## Current implementation checkpoint

The pure accounting module is integrated into authoritative ecology ticks. The
new-format save envelope is version 8 with `features.plantLifecycle: 1`.
Historical versions 1–6 migrate to zero historical structural stocks and no
seed opportunity on old materials. Version 7 and any temporal research payload
are protected until a separately tested combined schema exists.

Raw lifecycle fields, new juvenile stages, object identity, capacity, stocks,
scene and timing are checked before permissive legacy normalization. New-format
canonical retained ecology fields must survive restoration unchanged. The
pre-existing transient animal `actionHours` and omitted `feelings.relief` are
not persistent stock; no other physical value is exempted from comparison.
Unknown script/text fields remain discarded. Invalid sources protect the
original storage bytes, including direct `validateSave` fallback followed by
`writeSave`. Explicit `freshState` is the only intended replacement path.

Material positions use the actual producer clearance union: the generic
10-unit drop placement, the human radius, and each animal species radius.
Carcasses and flesh can validly inherit a rabbit's narrower position. Such
coordinates are retained exactly, with only finite x/y fields copied, rather
than relocated through generic `safePoint`.

Floating-point handling is explicit. Finite material energy/water and ecology
ledger values within a scale-relative 128-machine-epsilon envelope of their
bounds are retained verbatim, never rounded into a new transfer. Lifecycle
aggregate residual checks allow 1e-7 absolute units plus the same relative
roundoff envelope for cumulative arithmetic. Meaningful corruption fails
closed. This numerical convention does not excuse missing stocks, metadata or
body fields. The strict research checkpoint failure is preserved independently.

Recruitment preserves every positive source remainder, including less than
0.1 g. Exactly exhausted sources disappear only when mass, energy and auxiliary
water are all zero. Later ordinary material decay/removal retains its existing
semantics; this increment does not claim a whole-material water ledger.

The provisional engine constants are 96 game hours before germination, 2 g seed
transfer, 250 g juvenile cap, up to 8 g growth per game day scaled by local
conditions, .5 kcal/g captured energy, .7 ml/g auxiliary water, .004 nutrient
units/g and .12 daily fractional drought loss below .1 moisture, using exponential
retention (1 - .12) raised to elapsed game days for partition consistency. These are
explicit simplified simulation choices, rather than calibrated botany.

Integration order:

1. Add lifecycle feature version and exact raw save validation before enabling
   new materials. Reject v7 saves and any actor.discovery.temporal payload even
   when mislabeled as an older top-level version. Keep original disk untouched.
2. Preserve all existing plant/material stocks on migration, initialize only
   zero-valued lifecycle counters, and strictly round-trip new structural fields.
3. Wire newly detached apple opportunities, bounded physical placement and an
   atomic source-to-juvenile transfer. Give every juvenile its own ordinary ID;
   never call the mature `plant()` constructor. Use a saved deterministic attempt
   deadline and bounded per-step work. Unsuitable and full-cap attempts debit no
   material. A later ingestion must debit the same remaining source stock.
4. Apply juvenile-only growth before the mature seasonal branch, consume exact
   local soil admission, and skip all fruit production/fall logic. For mortality,
   use the existing bounded local detritus function and remove the dead plant
   after its exact remaining stock has transferred.
5. Count structural energy in ecology total and Cardinal balance only. Keep
   available-food and grass-capacity metrics unchanged by purely structural growth.
6. Add visible juvenile appearance and read-only rendering, actual Electron
   image inspection, two-process save continuation, fixed-step replay tests,
   natural drop placement and bounded multi-region tests. Only then consider a PR.

Do not run CPU-heavy world benchmarks during the separate, preregistered learner
validation's quiet measurement window. Coordinate the resource window first.
