# Food satisfaction, energy and learned feeding

## Appetite is not stored energy

Human appetite now has a separate bounded satisfaction state. A physically
accepted 95 kcal apple adds four **gameplay satisfaction-hours**, capped at six;
one satisfaction-hour expires per game-hour. A normal 30 g portion contains
about 15.833 kcal and adds two-thirds of a satisfaction-hour. Plain water adds
none, and water mixed with food does not create extra satisfaction. Time spent
acquiring and eating also consumes satisfaction, so six sequential bites do not
leave exactly four hours at the end.

The **Food satisfaction** display is distinct from Energy, Fatigue and Sleep
pressure. Committed ingestion updates its projection immediately without an
extra physiology tick. Four satisfaction-hours do **not** mean that 95 kcal
covers four hours of metabolic expenditure. These are game parameters, not
clinical predictions. Calorie transfer, digestion, reserves, toxicity and bodily
expenditure remain separate physical accounts; animal appetite is unchanged.

## Learned care and bounded caution

Qualitative waning-energy sensations can motivate food care even with a content
appetite, after higher-priority safety/rest/sleep needs. This does not expose
hidden calorie stores to cognition. Every bite still requires ordinary physical
access, capacity and [funded work](../NPC-EFFORT-FUNDING.md).

A supported exact-source technique may acquire the next portion after the
previous material was physically finished, rather than waiting for every prior
pending effect. That exception requires actual runtime completion plus retained
personal benefit chains. A saved `finishedMaterial: true` flag alone cannot
recreate the runtime witness. Each new portion must still earn its own outcomes;
pending digestion and adverse evidence are not erased. Positive outcomes are
not safety proof.

Direct adverse material evidence, strict own-source caution and received
[exact-material warnings](../FOOD-WARNINGS.md) independently protect central
sampling eligibility. Own-source caution requires personal, gap-free receipt
provenance; it cannot use donor knowledge, appearance or hidden ancestry.

## Saves and proof bounds

The current schema remains 12. A human save missing only `satietyHours` derives
`clamp(6 - hoursSinceMeal, 0, 6)`; malformed authored values fail closed. Loading
never credits another meal or replays digestion, feedback or interrupted work.

Retained experiments are capped at 168, with a bounded 169-row staging scan.
Four recent own extraction origins and origins needed by at most four held
materials are deduplicated within the proof budget. Missing evidence stays
unknown. Optional completion flags are literal-true-only, successful-sample
metadata paired with their action receipts, not persistent action authority.
Older builds enforcing the former 160-row cap may reject larger new saves;
there is no silent reset or compatibility promise for those older binaries.

## Evidence and limits

On historical combined commit `374894e225530dfbc7c90e89f911e040c3edab2e`
(runtime fingerprint
`d68d8146a91467f80f62fd2e5645df3e5c91578a648f8206b27ebc4e869f092d`),
under protocol
`547cdbc0a47545bd019378359c67d05752fbce7894e3134be14d3a8a9ce5adc6`:

- The full local test suite recorded **1,197 passed, 0 failed, 1 skipped**.
- A disclosed assisted four-game-hour known-food assay reached a late two-hour
  absorbed/spent ratio of **1.11180975**. This is finite-source throughput, not
  autonomous discovery or indefinite feeding.
- Real warning delivery affected an eligible paired decision **3.7 simulation
  seconds** after receipt; the comparison removed only report authority.
- A delayed-harm capability assay recorded **367** nonvacuous caution
  opportunities, **0** implicated-source samples after recognized harm and
  **1** genuine finished-piece shortcut. Initial harmful exposure still occurred:
  cumulative modeled toxic harm was approximately **0.241032**. This number is
  a model harm measure, not grams or a medical risk estimate.

These results belong to that earlier exact source/protocol. The release-facing
specification has separate freshly completed budget/capability runs, with their
actual source identity and report hashes recorded in the verification guide.
The earlier runs are not relabeled as those new runs. See [verification](../food-system/VERIFICATION.md)
for identities, retained historical failures, individual ordinary-run limitations
and current status. Earlier budget failures and individual regressions remain
negative evidence, not overwritten successes. Neither this controlled result nor
passing tests establishes reliable autonomous feeding or survival.

[Native verification](NATIVE-ACCEPTANCE.md) distinguishes prepared fixtures from
actual sandboxed desktop execution. The new native checks remain **not run**
until release-source Linux/macOS CI evidence is available.
