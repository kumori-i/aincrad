# Working on Aincrad

This is a standalone exploration game, independent of `agentic-workspace`.

## Current milestone and boundaries

Preserve a human-controlled avatar, a large bounded valley, lake/river, meadows/trees, and enterable caves. The central reference crossing must remain approximately five minutes at normal walking speed. An in-game day is one hour of unpaused play.

The owner has authorized the single persistent water-learning NPC milestone and desktop packaging. Keep model access optional and local, through a narrow validated desktop bridge. No game agent may receive OS/filesystem/shell access. Do not add a coding-agent adapter, external command execution, signup, analytics, cloud backend, paywalls, or additional NPCs.

## Boundaries

- `world.js` is authoritative. Human and future NPC controllers must use the same validated movement and actions.
- `renderer.js` and `art.js` only draw. Animation must not advance world rules or declare tasks completed.
- `config.js` is the source for world dimensions, movement speed, and time scale.
- Save only allowlisted, bounded fields. A save must never become executable code.
- Preserve pause-on-blur and clear held keys at scene/menu/focus transitions.
- Preserve local-first, offline-capable play. The web server must bind to loopback and serve only explicit game assets.
- The Electron renderer stays sandboxed, without Node integration or arbitrary native IPC. Do not loosen navigation or permissions for convenience.

## Verification

Run `npm run check` and `npm run bundle` after any code edit. The bundle is generated and committed for immediate play. Keep its CSP hashes valid; normalize text line endings. Visual changes also require actual rendered screenshots. Browser-only checks do not establish that Windows Electron installation or an installer works.

The optional Python UI harness is in `tests/browser_smoke.py`. It requires Playwright and Chromium. Its documented offline mode uses a memory storage adapter because about:blank has no storage origin; do not present that as a physical-disk persistence test.

## Scope discipline

Implement hydration, water actions, local observed navigation tiles, persistent experience, acquired procedures, collapse and divine rescue for one NPC. Keep the offline experiential controller clearly distinguished from configured language-model planning. A game action must actually update world state; narration is not completion. Do not redesign the map or replace the renderer without a concrete reason and the owner's approval.

## Publication

Publication requires an explicit user request or manual invocation of `npm run publish:github`. Use the helper's CLI path, or invoke it with `--prepare-connector <manifest-path>` before publishing through a connected GitHub account. The connected path must verify push permission and the manifest's expected branch head, preserve the existing history, and update the branch without force using that expected head. Never publish from install, launch, or test scripts. Never force-push or overwrite `agentic-workspace`. Preserve the visibility of an existing repository; keep new repositories private by default.
