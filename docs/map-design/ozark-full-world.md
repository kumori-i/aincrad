# Historical separate-world design

This describes the retired v9 separate-world implementation. It is retained as geography/design history, not current launch or save instructions. The current application launches one structural Ozark world directly; see ../../README.md and ../SINGLE-WORLD-CLEANUP.md. The former native script was replaced by current direct-boot, aquatic and carcass native checks.

# Separate Ozark world

The approved 96 × 72 Ozark landform is now a fresh, playable world. Its
continuous sampler supplies the terrain displayed on screen and the physical
rules for walking, wading, swimming, climbing, current, and sight. The playable
bounds are 38,000 × 28,400 logical pixels. The immutable world profile pins the
descriptor digest, terrain policy, actor sizes, and three starting positions.
The earlier bounded walking pilot remains an isolated test route.

## Identity and saved state

The desktop opens this world from the original world's welcome, recovery, or
pause screen. It uses the exact route `?ozarkWorld=1` and the separate local
save key `aincrad.ozark.v1`. An unpackaged disposable test profile uses
`?test=1&ozarkWorld=1`. The historical `aincrad.save.v1` key and the recovered
profile are not read or written by the Ozark world. Invalid, forged, stale, or
unsupported Ozark bytes visibly block play and remain unchanged for inspection.
The app never silently substitutes a fresh world for an occupied invalid slot.

Aster and Mira start with separate bodies, memories, and no learned crossings.
Both agents and the player share the same physical geometry. Agents perceive
only nearby visible ground, objects, and their own bodily outcomes. The atlas is
for the human player; it does not fill the agents' maps or supply a route.
Attempts at water and slopes produce action receipts and bodily effort, and
learned effects retain their physical sample and action proof through saving.

River, spring, and internal pond shores expose deterministic dry-bank water
points only when an agent can see them locally. A thirsty agent can remember an
observed bank, walk to it, fill a flask, and drink through the ordinary bodily
path; the observed source survives the strict Ozark save and reload. Neither
agent starts within sight of a bank. A bounded route from each approved spawn
has been exercised, but autonomous long-run survival, nutrition, and cave play
are not established by that route.

## Living map

The new ecology places finite producers, wildlife, materials, and local soil and
water stocks across the whole landform. Placement and climate use the same
Ozark geometry. Ecology advances once per world step and can be restored at a
fractional clock time. Cardinal's historical valley experiments do not run in
this world. No agent is supplied a resource location, food effect, or crossing
procedure at creation.

## Controls and verification

Use WASD or arrow keys to walk, hold Space to attempt swimming, hold G to
attempt climbing, and press M for the full map. Current can move a body in deep
water even without input. The world continues on window blur and pauses only
when Escape is used. The save button, periodic autosave, and close path validate
the same separate state.

Run `npm run check`, `npm run build`, and
`node scripts/verify-ozark-world-desktop.mjs` for source, build, and actual
Electron verification. The native script creates its own disposable test
profile, closes the app, reopens that profile, and checks exact saved identity,
body state, agent evidence, ecology, and historical save bytes. It writes
screenshots and a result JSON under `test-results/ozark-world-desktop/`.
