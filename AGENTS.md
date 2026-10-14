# Working on Aincrad

This is a standalone exploration game, independent of `agentic-workspace`.

## Current milestone and boundaries

Preserve a human-controlled avatar, a large bounded valley, lake/river, meadows/trees, and enterable caves. The central reference crossing must remain approximately five minutes at normal walking speed. An in-game day is one hour of unpaused play.

The owner has approved the 0.6 first ecosystem release: strict experiential food discovery, physiological time in game hours/days, vulnerable naps/sleep and rudimentary survival animals (rabbits, bobcats and foxes), seasonal grass/brambles/mature apple trees and decomposition. Preserve Aster and Mira, the optional human journal, pixel desktop presentation and npm workflow. Human food methods must not be supplied through object labels, action menus, fallback policies or peer templates; physically executed outcomes or explicit human advice supply evidence. Legacy saves remain available with their previous rules; fresh expeditions use discovery rules. Fish, large predators, climbing, tool construction, cooking and cultivation are later milestones. Keep model access optional/local and no agent OS/filesystem/shell access. Do not add signup, analytics, cloud services or additional human characters.

## Boundaries

- `world.js` is authoritative. Human and future NPC controllers must use the same validated movement and actions.
- `renderer.js` and `art.js` only draw. Animation must not advance world rules or declare tasks completed.
- `config.js` is the source for world dimensions, movement speed, time scale and tunable survival/weather values.
- Advance the shared environment exactly once per unpaused fixed step. Weather/resource renewal, body state, observations and rendering must use this same saved simulation clock. Rendering must not mutate resources or body state.
- NPC and human scene transitions are independent. NPC decisions may use only locally observed/current remembered resources and routes, including scene-specific cave maps.
- Save only allowlisted, bounded fields. A save must never become executable code.
- Keep exact physiology in the engine and optional developer inspection. Agent/model observations and the ordinary journal describe bodily sensations rather than exact reserve percentages. Peer observations never reveal another character's hidden body state or private memory.
- Conversations and notes are data. Human replies are optional and reported information, not verified world facts; agents continue caring for themselves while awaiting replies. Claims, plans and spoken intentions never count as completed physical actions.
- Continue simulation on blur, hiding and minimizing. Clear held keys on focus loss. Explicit Escape pause controls simulation independently of map/help/journal visibility; opening those views does not pause. No progression occurs while the application is closed.
- Preserve local-first, offline-capable play. The web server must bind to loopback and serve only explicit game assets.
- The Electron renderer stays sandboxed, without Node integration or arbitrary native IPC. Do not loosen navigation or permissions for convenience.

## Verification

Run `npm run check` and `npm run build` after code edits. The application build is generated into ignored `dist/`; do not commit generated renderer bundles or distribute an HTML webpage. Preserve the strict application protocol and renderer CSP; normalize text line endings. `npm start` launches Electron and `npm run dev` rebuilds/reloads the desktop application. Visual changes also require actual rendered screenshots. Browser-only checks do not establish that Windows Electron installation or an installer works.

Use `npm run smoke` for the actual Electron application and rendered desktop screenshots for visual QA. Disk persistence must be tested by closing and reopening an isolated application profile.

## Scope discipline

Implement the approved first ecosystem and discovery milestone using the contracts in docs/DEVELOPMENT-v06.md. Start new expeditions beside locally observed water. Preserve historical save identity/progress without claiming old supplied food routines were cold-start discoveries. Keep drives concurrent, evidence and bounded budgets. Animal reproduction consumes resources and has population bounds. Preserve collision, the valley, original pixel art and source application workflow. Human construction, reproduction and larger societies remain later milestones.

## Publication

Publication requires an explicit user request or manual invocation of `npm run publish:github`. Use the helper's CLI path, or invoke it with `--prepare-connector <manifest-path>` before publishing through a connected GitHub account. The connected path must verify push permission and the manifest's expected branch head, preserve the existing history, and update the branch without force using that expected head. Never publish from install, launch, or test scripts. Never force-push or overwrite `agentic-workspace`. Preserve the visibility of an existing repository; keep new repositories private by default.
