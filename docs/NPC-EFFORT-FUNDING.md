# Human NPC effort funding

Effort funding closes a physical accounting gap, not a food-satisfaction or survival
balance claim. A human discovery NPC could previously complete a paid action or
move after spending only the energy it happened to have. The engine now funds
work before crediting it.

## Scope and accounting

`npc-effort-funding.js` is an explicit human discovery-NPC API. It limits work to
currently available energy, performs the existing effort charge once, and returns
paid seconds and kcal only after observing the matching positive debit and
metabolic ledger entry. Floating-point verification is bounded by the smaller
of 1e-8 kcal and one ten-millionth of the requested cost. Invalid or mismatched
custom test hooks certify no work. Throwing hooks cannot authorize completion.

The existing `exertPhysiology` API, animal callers, player controls, legacy NPC
body rules, and zero-effort drink/fill macros remain unchanged. The funding subsystem does
not change basal metabolism, reserves, mobilization, digestion, meal satisfaction,
doses, care selection, or rescue grants. Resisted motor attempts cost paid effort;
passive river transport does not.

Interactions keep authoritative runtime-only paid-progress witnesses. An active
object's editable `worked` or `seconds` fields cannot create paid work. No sample,
damage, acquisition, transfer, or other primitive output is committed until the
required funded work is complete. Cancel, throw, reentry, copied actions and
save/reopen cannot replay completion or restore work witnesses. Runtime cancellation receipts describe paid work, not elapsed waiting time.
Saving retains the physical energy debit but not the runtime work witness. On
reopen, the existing unsuccessful `RESTART_INTERRUPTED` receipt does not include
a paid-duration field; it must not be interpreted as completed work.

## Finite waiting policy

An action's allowance is `min(90, 2 * nominal seconds + nominal kcal / 0.2)`
elapsed simulation seconds. Practice still reduces nominal work. The fixed
0.2 kcal/second budget reference equals the unchanged human mobilization minus
awake basal rate; it is an engine allowance, not a controller energy oracle.
Fresh sample/grasp/pull/strike limits are approximately 13.533/11.667/50/54.933
seconds. A reserve-funded 3.5-second sample needs approximately 6.533 elapsed
seconds and can therefore finish. The 90-second cap is a finite safety ceiling,
not a guarantee that arbitrary future primitive costs will be affordable.

The runtime tracks elapsed action time independently and takes the maximum with
the absolute NPC clock, never their sum. Thus direct helper ticks cannot keep an
action alive by freezing the public clock. Paid slices are clipped to the earliest
applicable deadline. A matching admitted learned-run step or travel keeps the
original run's 90-second deadline, forwarded only through the controller's exact
sanitization copy. Unrelated urgent water/contact actions do not inherit it.
Timeout clears the matching run without success. Consent is checked before every
shared-grasp work slice and immediately before transfer; the existing offer hold
is not extended.

## Movement and passive time

Canonical geometry advertises `fundedAdvance`. Its optional funding callback runs
after each existing internal slice's starting terrain classification and before
swept input movement. Walking, wading, climbing and swimming retain their terrain
multipliers. Only paid time drives input, purposeful displacement, and active
climb/swim/slip evidence. Invalid payments fail closed. Test geometry adapters must
implement this contract; an obsolete adapter cannot silently grant free NPC input.

The no-callback geometry path and receipt shape remain unchanged. Fully funded
input segments retain their exact historical partition and trajectory. Every
elapsed NPC movement frame additionally integrates any remaining passive time,
including early returns at waypoints, finished routes and expired commands. This
intentionally corrects previously omitted current/wetness time at exhausted pace;
**total-frame position equivalence in a current is not claimed**. Current uses the
same swept collision geometry, never a coordinate shortcut, and is integrated
once. Rejected deep-water walking can cost effort but cannot gain swimming input.
Passive displacement never contributes to purposeful progress or motor trails.

## Verification and limitations

Tests cover all seven primitives, zero/partial/full funding, exact debit and
metabolic ledger agreement, deadlines, cancellation, reentry, shared consent,
save interruption, current and terrain-dependent movement. A paid input may
oppose current without reaching its destination; the admitted deadline remains
finite, and that outcome must not manufacture a wholly blocked-edge observation.

The [combined native runner](food-balance/NATIVE-ACCEPTANCE.md) checks a genuine
partially funded action across two independent reopens, including exact saved
debits and no replay. Its detached decoded-save probe checks that copied action
objects cannot recreate payment or completion witnesses. Preparation is not a
native desktop pass. Current source-bound results and native status are recorded
in [verification](food-system/VERIFICATION.md).

This accounting does not establish adequate food supply, successful autonomous
foraging, avoidance of exhaustion or survival. Physical funding uses engine
energy stores; action selection still uses qualitative bodily sensations, not
an exposed calorie oracle. Animal and player behavior remain outside this API.
