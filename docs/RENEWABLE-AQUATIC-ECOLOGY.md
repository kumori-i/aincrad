# Bounded renewable aquatic ecology

Aquatic schema 2 adds food production, local feeding, growth, offspring allocation and finite lifespan to the existing paid interception, specimen, pulling, ingestion and material-decay physics. This is an engineered shore-fish phenotype, not calibrated Ozark population biology, a closed nutrient cycle, or a claim that the people autonomously discover useful fishing.

## Physical production and consumption

The same signed-water/bank seed search establishes at most eight food patches and 32 initial adult fish. Patches begin empty. Each admits up to 12 kcal per body-hour of time-averaged aquatic primary production, until its 240 kcal capacity is reached. Unadmitted potential production is not accumulated or credited. Wet biomass and water are explicitly imported by this abstraction: each admitted kcal adds .5 grams and .25 ml, with all three quantities entered in the aquatic input ledger. Energy also enters the global photosynthesis ledger exactly once. This does not claim measured light response, nutrient limitation or water withdrawal from a modeled reservoir.

Fish can feed only within 240 pixels of a patch with native line of sight. They turn toward nearby patch habitat during ordinary movement; no teleportation, habitat replacement or edible stock is created by this steering. Feeding is at most 8 kcal per fish body-hour, bounded by actual food and reserve space. Competing demands receive proportional shares, avoiding array-order starvation. Feeding debits patch food and credits fish reserve with identical mass, energy and water.

Maintenance and swimming still cost .5 kcal per body-hour. Maintenance precedes feeding, so an exhausted fish cannot be revived by a later meal. Fish food is not exposed as a human food label or harvesting object.

## Growth and offspring

Adult compartment maxima remain 80 g tissue / 100 g residue / 20 g reserve with the pre-existing compositions. Juvenile tissue and structural residue grow together, by at most .012 adult fractions per body-hour. Growth consumes enough actual reserve to cover *all three* output quantities and leaves a 4 kcal maintenance buffer. The remaining nonnegative mass, energy and water are waste exported through existing regional detritus/overflow accounting. Nothing is added to the global energy input for growth.

A mature, near-full-sized fish with at least 30 kcal reserve may allocate 20% of each own compartment into one offspring, after 96 body-hours since its previous allocation. The newborn begins at the parent's valid water position, with a new unique object identity and zero experienced age. Parent stock is debited synchronously. This is a coarse reproduction allocation model, not simulated mating, egg development, sex or genetic inheritance. Both the diminished parent and juvenile must pay to regrow. Birth requires available identity space and fewer than 64 live fish. It never recreates an extinct population.

Fish die on reserve exhaustion or at 720 body-hours. Their actual remaining tissue, residue and reserve become the same unowned specimen as before; full material capacity sends the real stock to regional detritus, with overflow loss accounted. Captured fish do not feed, grow or reproduce.

## Boundaries and persistence

The native half-second ecology clock remains authoritative. Larger direct calls subdivide into these same fixed steps; closing the app does not advance time. Arbitrary smaller step partitions are not claimed equivalent to the authoritative fixed-step numerical model. Rendering never advances ecology.

Initial IDs remain fixed. Active origin records track the current tissue ceiling of each live fish or retained corpse/piece. Parent division reduces its ceiling; actual growth raises it; a juvenile gets its own ceiling. The record survives capture and all owned pieces. Records with no remaining physical object are pruned on the next aquatic tick. The hard bound is 64 live fish plus the global 256-material cap, permitting same-tick terminal removal without invalidating a save. No ever-growing list of all historical births is saved.

Validation checks strict field allowlists, stock compositions and capacities, valid water positions, unique object identities, per-origin tissue limits, population births/deaths/captures, reserve debits, feeding versus production, finite lifespan and global/aquatic ledger bridges. Floating-point closure uses a small magnitude-scaled tolerance, not stock repair. Schema 1 is not silently upgraded or refilled.

## Verification scope

`tests/aquatic-renewal.test.mjs` uses a cheap deterministic signed-water pond for a 1,000-body-hour run across original-cohort mortality. It separately checks fixed-step partition/JSON continuation, food saturation after complete capture, starvation when feeding paths are blocked, spawned-origin handling/decay, and corrupt lifecycle data. These are physical engine tests, not paid-controller traces or desktop close/reopen evidence. Existing native capture/provenance tests remain necessary, as do actual platform close/reopen tests for the combined source tree.

A renewable population is not an unlimited harvest guarantee. Harvest can exceed production or remove every reproducing fish. Controller adoption and reliable human self-maintenance remain separate unresolved questions.

### Development evidence (2026-10-21)

The deterministic pond fixture passed 1,000 body-hours: 8 initial fish, 32 births, 24 natural deaths and 16 survivors at the endpoint; no initial-cohort fish survived its lifespan. Maximum recorded end-to-end stock closure error was approximately 0.0000011 kcal. A separate, predeclared 400-hour low-level harvest fixture captured one largest fish every 100 hours (four captures), retained living fish and produced offspring. This is a bounded example, not a sustainable-yield guarantee or autonomous fishing success.

Native Ozark geometry exposed a limitation rather than a uniformly replenishing watershed: all 32 initial fish and all eight patches classify as surface water. At 80 body-hours all 32 initial fish remained, but by 90 hours 28 had starved. The four remaining fish produced four offspring by 100 hours; at 120 hours there were eight live fish, four births, 28 natural deaths and zero captures. Existing river-current drift can move fish away from sparse finite food patches; returning steering does not cancel a stronger current. Native food availability is therefore geographically uneven. Neither the current physics nor food coefficients were retuned merely to turn that finding green.

The instrumented 120-hour real-geometry rerun verifies all four births and all eight endpoint survivors in surface water, with no pond fish. Each 10-hour aquatic validation passed; endpoint energy closure error was 2.97e-8 kcal. Survivor distances from the nearest food patch were 223–250 pixels, crossing the feeding radius during movement. Reproduce with `node tests/fixtures/renewable-aquatic-geometry-probe.mjs`; retained checkpoints and endpoint physical positions are in [the CPU-probe evidence](verification/renewable-aquatic-geometry-2026-10-21.json). This probe advances aquatic physics only, not bodies, land ecology or an Electron window.
