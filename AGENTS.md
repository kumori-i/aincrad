# Working on Aincrad

This is a standalone exploration game, independent of `agentic-workspace`.

## Current milestone and boundaries

Preserve a human-controlled avatar, a large bounded valley, lake/river, meadows/trees, and enterable caves. The central reference crossing must remain approximately five minutes at normal walking speed. An in-game day is one hour of unpaused play.

The owner has approved the 0.7 Cardinal milestone: an autonomous world governor observes full private diagnostics, diagnoses problems, runs controlled copied-world experiments, learns from their outcomes, and applies validated world changes. Spread real ecology across the entire walkable valley and provide a zoomable/pannable map showing both humans and the player. Preserve strict experiential food discovery, physiological time, vulnerable sleep, finite ecology, Aster and Mira, the optional journal, pixel desktop presentation and npm workflow. Cardinal may manage world rules but must not insert answers or completed skills into inhabitants' minds. Keep model access optional/local and no agent OS/filesystem/shell access. No signup, analytics, cloud services or additional human characters. New physical mechanics and arbitrary source modification remain a separate tested development process.

## Current regional development

The next bounded stage follows docs/DEVELOPMENT-v08.md: differentiated terrain/water/climate habitats, finite regional soil/litter accounting, physically verified corridors, and preserved saves. Subsequent work must measure food throughput, learned relocation and bounded regional Cardinal interventions before claiming survival or open-ended society. Use local-only runtime/behavior training, optional Ollama language, CPU-capable 32 GB RAM / 1 TB laptop constraints, and no paid/cloud runtime dependencies. The implementation may be developed/tested in the cloud without deploying a simulation service.

Regional bookkeeping must partition existing stocks without adding or replenishing any existing-world objects or calories. A damaged v3 save must not fall back to global soil or fresh allocation. Preserve history and use feature branches and reviewable pull requests; test and review before any authorized merge. Do not confuse physical corridor connectivity with learned or nutritionally viable migration.

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

Keep the Cardinal/map contracts in docs/DEVELOPMENT-v07.md and use docs/DEVELOPMENT-v08.md for the current regional stage. Preserve historical save identity/progress; regional migration partitions old stock without additions or population replacement. Old legacy worlds retain prior agent rules. Cardinal operates through authoritative world APIs; shadow experiments must not alter the live world, leak hidden information to agents, fabricate results, or block explicit pause. Animal reproduction consumes resources and has population bounds. Preserve collision, the valley, original pixel art and source application workflow. Human construction, reproduction and larger societies remain later milestones.

## Publication

Publication requires an explicit user request or manual invocation of `npm run publish:github`. Use the helper's CLI path, or invoke it with `--prepare-connector <manifest-path>` before publishing through a connected GitHub account. The connected path must verify push permission and the manifest's expected branch head, preserve the existing history, and update the branch without force using that expected head. Never publish from install, launch, or test scripts. Never force-push or overwrite `agentic-workspace`. Preserve the visibility of an existing repository; keep new repositories private by default.

For a feature-branch connector update, use `--prepare-connector <manifest-path> --branch <existing-feature-branch>` while HEAD equals that branch's verified remote head. Verify the manifest blobs against the local candidate. GitHub `create_tree` supports inline UTF-8 contents: batch changed text entries in one tree based on the verified existing tree, and reuse/create SHA-addressed blobs for binary artifacts. Check the resulting tree against local Git, create a commit with the expected parent, and advance only the feature ref with its expected SHA and `force:false`. This avoids per-file write approval loops without altering permissions or bypassing any required approval. Inspect uncertain outcomes before retries; stop on actual denied access.

Keep connector requests bounded: publish compact measurement summaries and raw-report fingerprints; retain full traces in an explicit evidence export rather than routinely committing megabytes of raw JSON. Use existing blob SHAs and small inline text entries. Inspect a pending operation and report its status promptly instead of leaving a large upload unobserved.
