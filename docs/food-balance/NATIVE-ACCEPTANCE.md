# Native food-system verification

Run `node scripts/verify-combined-food-desktop.mjs` and
`node scripts/verify-food-warning-desktop.mjs` on supported Linux/macOS hosts,
using their isolated disposable profiles and ordinary Electron sandboxing.
`--prepare-only` generates the runner and source/build manifest without claiming
native execution. Record the actual host architecture, exact source and build
fingerprints, process exits and screenshots; never use a real product profile or
bypass sandbox/display restrictions.

## Combined food and funding fixture

The three-process combined runner exercises:

1. A real finite apple pull and six paid 30 g samples. The immediate final-bite
   projection is checked against committed appetite, separately from ingested
   energy, absorption and pending digestion. A 30 g intermediate checkpoint is
   checked inside the renderer; it is not a separate partial-dose UI screenshot.
2. A real water-only drink from an explicitly disclosed 0.5 L starting flask.
   It must add no calories or satisfaction and receive no collection credit.
   The reopened app captures this actor's zero-satisfaction display, as well as
   the whole-apple actor's display. Food satisfaction's tooltip must distinguish
   appetite from stored energy/calorie coverage; Energy, Fatigue and Sleep
   pressure remain separate diagnostics.
3. Actual zero and partial work funding. The depleted actor receives only the
   disclosed half-slice work budget plus one basal slice; no early resource
   output is permitted. Real debit, paid progress and the metabolic ledger agree.
4. A save during that genuinely partial action, followed by two independent
   native reopens. The actual app's physiology, inventories, flask, finite stocks
   and clocks are compared both with original saved bytes and with measurements
   taken before saving. Only the expected unsuccessful restart receipt may be
   added; no completed work or duplicated resources may appear.
5. A separate decoded-byte engine probe verifies that completion/payment witnesses
   are absent and a copied interrupted action cannot replay. This probe does not
   access or modify the live app's private actors. `RESTART_INTERRUPTED` has no
   paid-duration field; exact physical debits are retained, and ordinary
   cancellation-duration accounting is covered separately by unit tests.

The fixture warms the shared world for 60 simulation seconds, then stages the
encounter positions and initial body conditions. No learned proof, food calories
or runtime payment/completion witnesses are inserted. This is controlled
capability verification, not spontaneous foraging or survival evidence.

The saved UI checkpoint is exactly **0.2 simulation seconds after the immediate
last-bite measurement**, because two funding slices follow it. The runner asserts
and reports this offset. The inert native test route does not advance time while
panels render and screenshots are captured; before/after state comparisons check
that no decay or other progression occurs. UI-only actor selection is restored.

## Actual adverse warning fixture

The separate warning runner uses a real paid sample, delayed adverse recognition
and actual nearby speech. Independent full-state/RNG policy branches retain or
remove only warning-report authority. The unprotected branch must select the
exact held sample; warning presence must defer it. Save/reopen must preserve the
attributed report without inventing personal evidence or replaying delivery.
Synthetic testimony is not a substitute.

## Coverage boundaries and status

Engine tests cover 1/2/3-game-hour appetite curves, conservation and water
independence. These hourly curves are **not rendered native checkpoints** in the
minimal runner. A partial-portion renderer assertion is likewise distinct from
an actual app screenshot. The runner reports these limits instead of claiming
complete coverage of every historical native checklist item.

Native execution and screenshot inspection are **not run** before the
release-source Linux/macOS CI runs. Node preparation, JSON roundtrips, build
success and earlier-source screenshots cannot replace them. See the
[source-bound verification record](../food-system/VERIFICATION.md) for the current
status. Archive source/build identities, disclosed fixture inputs, saved bytes,
action/effect evidence, images and normal close/quit records with explicit
passed/failed/skipped/not-run outcomes.
