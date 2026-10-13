# Working on Aincrad

This is a standalone exploration game, independent of `agentic-workspace`.

## Current milestone and boundaries

Preserve a human-controlled avatar, a large bounded valley, lake/river, meadows/trees, and enterable caves. The central reference crossing must remain approximately five minutes at normal walking speed. An in-game day is one hour of unpaused play.

The owner has approved the 0.4 multi-need survival plan: one persistent Aster balancing food, water, temperature and health; functional feelings; small ponds, finite apples, seeded weather, a nearby temperate cave and ambient animals/fish/plants. Preserve the original pixel presentation and npm desktop workflow. Keep model access optional and local, through a narrow validated desktop bridge. No game agent may receive OS/filesystem/shell access. Do not add a coding-agent adapter, external command execution, signup, analytics, cloud backend, paywalls, or additional autonomous NPCs. Ambient animals and fish are approved scenery for this milestone.

## Boundaries

- `world.js` is authoritative. Human and future NPC controllers must use the same validated movement and actions.
- `renderer.js` and `art.js` only draw. Animation must not advance world rules or declare tasks completed.
- `config.js` is the source for world dimensions, movement speed, time scale and tunable survival/weather values.
- Advance the shared environment exactly once per unpaused fixed step. Weather/resource renewal, body state, observations and rendering must use this same saved simulation clock. Rendering must not mutate resources or body state.
- NPC and human scene transitions are independent. NPC decisions may use only locally observed/current remembered resources and routes, including scene-specific cave maps.
- Save only allowlisted, bounded fields. A save must never become executable code.
- Preserve pause-on-blur and clear held keys at scene/menu/focus transitions.
- Preserve local-first, offline-capable play. The web server must bind to loopback and serve only explicit game assets.
- The Electron renderer stays sandboxed, without Node integration or arbitrary native IPC. Do not loosen navigation or permissions for convenience.

## Verification

Run `npm run check` and `npm run build` after code edits. The application build is generated into ignored `dist/`; do not commit generated renderer bundles or distribute an HTML webpage. Preserve the strict application protocol and renderer CSP; normalize text line endings. `npm start` launches Electron and `npm run dev` rebuilds/reloads the desktop application. Visual changes also require actual rendered screenshots. Browser-only checks do not establish that Windows Electron installation or an installer works.

Use `npm run smoke` for the actual Electron application and rendered desktop screenshots for visual QA. Disk persistence must be tested by closing and reopening an isolated application profile.

## Scope discipline

Implement the approved food/water/temperature/shelter milestone for one NPC. Start new expeditions beside a locally observed water source; preserve existing saves, identity and acquired water procedures. Warning and critical discomfort must provide continuous consequences before collapse; learned water procedures must compete with food and shelter in a shared decision process. Keep the offline experiential controller clearly distinguished from configured language-model planning. A game action must actually update world state; narration is not completion. The owner has explicitly requested the pixel visual redesign. Preserve authoritative collision and exploration scale. The owner has approved additive ponds, apple patches and one nearby refuge; retain the existing valley, trails and distant caves. Do not add unrelated map mechanics or copy proprietary game artwork.

## Publication

Publication requires an explicit user request or manual invocation of `npm run publish:github`. Use the helper's CLI path, or invoke it with `--prepare-connector <manifest-path>` before publishing through a connected GitHub account. The connected path must verify push permission and the manifest's expected branch head, preserve the existing history, and update the branch without force using that expected head. Never publish from install, launch, or test scripts. Never force-push or overwrite `agentic-workspace`. Preserve the visibility of an existing repository; keep new repositories private by default.
