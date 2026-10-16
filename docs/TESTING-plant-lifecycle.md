# Finite juvenile lifecycle verification

Based on stable main `3db83047c96158b39214b3f5a68ed5929ad1f40d`.
Final test and artifact fingerprints are listed in [the compact summary](plant-lifecycle-summary.json).
The final source passed 406/406 tests, build, actual Electron smoke, both
two-process persistence fixtures, and all three bounded physical diagnostics.
The native build fingerprint is
`37c7c8ed74449e65fdb07ef6ac1b985e315d1d3e232e69fb307389e866f8263f`.
This is a bounded plant-physics increment. It does not establish forest succession,
hydrology, improved autonomous survival, or learned migration.

## What changes

Newly detached apples, including actual natural fruit drops, carry one saved
recruitment opportunity. After 96 game hours, an unheld valley apple with at least
2 g may transfer exactly 2 g and proportional existing calories/water to a nearby
fruitless seedling. Search is confined to 17 points within 24 world units, with
terrain, water-distance and spacing checks. No distant relocation occurs.

At most four due opportunities are attempted per half-second ecology step,
ordered by saved deadline and numeric object ID. Capacity/placement refusals keep
all material and retry after 12 game hours. The 768-plant limit remains unchanged.
Juveniles grow to at most 250 g using actual admitted local soil, daylight,
moisture and crowding. Their captured energy and auxiliary water are explicit
inputs. They never enter mature fruit production in this increment.

Structural energy participates in total ecological/Cardinal balance but is not
counted as available food or grass carrying capacity. Public observations reveal
qualitative stems/leaves, never structural calories, seed flags or soil stocks.
Rendering is read-only; both stages are visible above their retained source apple.

## Physical diagnostics

1. **Unaltered clocks, reduced one-tree world.** One existing apple tree and the
   existing finite regional soil are retained; other plants and all animals are
   removed, and the diagnostic initial-energy ledger is rebased after that
   reduction. No age, fall, season, weather or germination deadline is advanced
   manually. Native 1/60-second input steps run for just over ten game days.
   The first actual apple falls at 21,600.5 simulated seconds; its seedling appears
   at 36,000.5, four game days later. The source identity matches. Energy residual
   is zero, and juvenile mass/energy/water residuals are below 3e-16 units.
   This finite fixture establishes the timed path, not whole-map succession.
2. **Accelerated full-layout placement fixture.** All 745 original plants remain;
   animals are removed and initial energy is rebased. Apple fall clocks are set
   to 144−0.001 game hours, then one ordinary half-second step creates 21 finite
   fruit drops. The shared clock advances four game days and those materials'
   ages become 96 hours. Six ordinary steps attempt 4/4/4/4/4/1 opportunities.
   All 21 recruit at their actual source positions, leaving 766 plants and two
   free slots. No source is displaced; energy residual is 4.1e-10 kcal.
   This is placement/batch coverage with explicit clock interventions.
3. **Normal full-population execution.** The original full world, Aster and Mira
   run for 900 simulated seconds with native input steps. Cardinal is explicitly
   off. Fifteen copies are save-validated at 60-second intervals, followed by a
   final write. The running world is not replaced by those copies. All retained
   ecology fields compare exactly; only pre-existing nonpersisted animal
   `feelings.relief` is excluded. Energy residual is 7.4e-9 kcal. This horizon is
   too short for new recruitment and does not establish survival improvement.

The first evaluator attempt passed cases 1–2 but its case-3 comparison included
that transient animal projection and stopped. Its report is retained. The
comparison was corrected to the documented persistence contract; physics and
save code were unchanged before the completed run.

## Conservation, refusal and corruption regressions

Tests exercise real ingestion before recruitment with 90 g, 2.05 g, 2 g and
1.99 g remaining, including every positive fractional remainder; natural drop;
held/young/cave/underweight rejection; unsuitable placement; full-cap refusal;
deadline/ID ordering; freed-cap retry after reopen; no night or exhausted-local-
soil growth; actual aggregate-limited soil admission; and structural versus
available-food accounting.

Low-moisture fixtures exercise proportional drought loss, detritus overflow,
actual terminal removal and exact final remnants. The near-terminal fixture
explicitly places prior loss into local detritus and all diagnostic accounts.
It is not evidence that drought mortality occurred naturally. Suitable apple
sites' current clear-weather moisture equilibrium is above the mortality
threshold; no claim of natural drought deaths is made here.

Version-8 saves require the lifecycle feature and complete validated metadata.
Genuine v1–v6 saves preserve existing objects, stocks, people and history while
adding zero structural history and no seeds to old materials. New fields or
juvenile stages disguised as old saves are rejected. Version 7 and any temporal
research payload are protected rather than erased. Direct validation cannot
produce an autosave-authorized fresh replacement for rejected input.

Corruption checks cover object IDs, scenes, geometry, null/missing material
stocks, species/kinds, new-stage misuse, clocks, next IDs, detritus, regional
stocks and lifecycle accounting. A real rabbit death at a radius-seven-only
position, followed by an actual NPC flesh acquisition and accepted consumption,
round-trips exact material coordinates and stocks. Extra nested position data is
discarded. Small numerical roundoff is preserved under the documented bounded
policy; meaningful corruptions protect the original bytes.

## Actual Electron checks

The actual sandboxed Electron application is launched twice with one isolated
profile. The fixture performs finite detachment and a real accepted 30 g
consumption, recruitment, and 28,394 half-second ecology growth steps. It saves
both a roughly 20 g juvenile and a roughly 2 g seedling, their positive original
material remainder, a placement-deferred seed opportunity and Mira's sleep.
The second process restores the whole JSON-normalized checkpoint exactly, with
no closed-time progression. Paused rendering leaves ecology unchanged.

This native fixture is intentionally reduced to one original tree with animals
removed. It uses fixed noon/clear conditions, three four-game-day clock jumps,
and an unsuitable point for the deferred material. Actor bodies are held static
while the ecology is stepped. These interventions are recorded in its report.
It tests native rendering/storage contracts, not human survival or natural time.
[The actual native screenshot](plant-lifecycle-native.png) shows both young
stages beside their retained fruit.
A separate native verifier covers genuine old distribution-2 save migration.

## Compatibility and save cost

A separate 900-second main/candidate comparison has identical complete live
state after removing only the additive save envelope and lifecycle metadata.
The actual main-version reader refuses the new save and makes zero storage
writes, preserving the original bytes. A later allocation/duplicate-check
optimization also preserves the entire normalized snapshot and serialized bytes
exactly. Its old-comparator oracle and independent malformed-save probes retain
the strict rejection semantics.

The first paired warm write measurement was 69.80/100.28 ms median/p95 on main
and 118.77/178.30 ms on the initial candidate. That original report is retained.
After the narrow optimization, the same recorded snapshots were measured in a
three-arm, alternating-order run: main 58.72/68.49 ms, pre-optimization candidate
103.51/120.90 ms, final candidate 74.84/117.03 ms. Each arm had four warmups and
20 measured writes. The reported p50 is the upper median (sorted index 10 of
20), and p95 is sorted index 18. The final candidate still adds roughly 16 ms median and
49 ms p95 in that run. This is a disclosed remaining synchronous-save cost,
not a responsiveness pass. No threshold was relaxed and no facts were cached,
trimmed or omitted to improve the result.

These timings include validation and JSON encoding to an in-memory sink; they
exclude localStorage and actual renderer-frame timing. They are small cloud-CPU
samples, with no laptop smoothness or statistical generalization claim. The
retained final snapshots contain 3,520,344 bytes on main and 3,622,461 bytes with
the lifecycle. The comparison process holds multiple worlds; its RSS is not a
per-world memory estimate. A future save-path responsiveness change needs its
own coherent-snapshot and failure-protection design.

## Limits and next work

The default world has only 23 spare plant slots. Recruitment does not silently
raise that cap, erase older plants or promise endless woodland expansion.
Maturation, seed dispersal through animals, finite watershed dynamics, structural
wood interactions and learned reasons to explore need later compatible designs.
No Windows installer, varied laptop or live Ollama behavior is claimed from this
Linux cloud development environment.

Resource comparisons are recorded separately in the compact summary. They must
not be read as a smooth-frame or laptop-performance guarantee. The original
high-capacity research learner's failed resource gates remain untouched.
