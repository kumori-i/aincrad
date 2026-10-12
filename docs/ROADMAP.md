# From an explorable valley to a living world

## Completed foundation: World Zero

Controllable avatar, mountain boundary, lake and river, bridge crossings, meadows and trees, three cave entrances/interiors, minimap and field atlas, local saves, and a configurable one-hour day. A runnable source project and offline build exist. GitHub publishing is prepared but must be performed by the owner with the included helper.

## Next: physical resources and inventory

Make a small set of trees/rocks gatherable. Add inventory with quantities and capacity. Resource state must persist and be separate from cosmetic artwork. The human can inspect and perform each action. Tests must prove resource conservation and save/reload consistency.

## Then: one crop, with real consequences

Till, plant, water, grow and harvest one crop. Growth uses authoritative game time, not animation timing. Add visible feedback and simple tooltips explaining rules. Keep a viable starting food/seed supply. Test that seeds and harvests cannot duplicate through interrupted actions.

## Then: constrained building

Allow a few grid-validated pieces or predefined small structures. Material cost, location checks, ownership, collision and save migration precede freeform construction. Confirm that buildings cannot trap the player or block every crossing.

## Then: baseline inhabitants

Begin with one rule-driven NPC using the same inventory, movement and game-action API as the human. Add needs only after the world can actually satisfy them. Test a settlement's resource budget and recovery with an accelerated developer clock.

## Later: optional adaptive planning

An optional model may choose high-level goals and discuss commitments. Routine execution remains conventional game code. Add observation boundaries, memory budgets, inference limits, truthful action status and behavior when inference is unavailable. Do not replace working survival routines with continuous model calls.

Multiplayer, background hosting, offline catch-up, distinctive cave generation and a larger world are separate design decisions, not implicit commitments for the next milestone.
