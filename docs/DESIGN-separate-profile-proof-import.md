# Separate-profile import for the protected Aincrad world

Status: draft implementation in PR #16. This local candidate passed disposable
macOS Electron checks; the preceding draft passed Linux native CI. Exact-head
Linux and Windows checks remain before publication. Recovered-copy creation
and opening are explicitly unavailable on Windows; support is deferred.
This supersedes the in-place commit path in
`DESIGN-legacy-pending-ingestion-migration.md`. Scope is the approved
proof-retention proposal SHA
`aecb4f02bf9972d85d31efc64b7fe0ea3c47534890e94af367996ec55cc37442`.
The existing read-only migration candidate and raw backup bridge remain the
starting point. The original profile is never a commit destination.

## Why this route is needed

An isolated two-process Electron probe showed that the old build and the new
build can both run against the same profile: the new build obtained its
single-instance lock while the old build was still alive. A lock added only to
the new build cannot make in-place migration exclusive. Therefore the protected
default-profile screen continues to forbid play, autosave and in-place commit.

## Profile identity and launch route

- On Windows, the original profile remains the normal launch route. The
  recovered-copy mode flag is rejected before selecting a copy profile or
  changing Electron paths. The trusted bridge reports the capability as
  unavailable and refuses create, open, import, ready and restart operations.
  The renderer says this plainly and still offers exact raw backup export and
  verification for a protected original save. A valid original world can play
  and save normally. Any occupied copy slot is left untouched. This is a
  deliberate temporary platform limit, not a claim that Windows recovery
  passed its native import test.

- Support **one** recovered copy for this one default-profile world. Its fixed
  identity is `recovered-proof-v1` and its directory is an app-owned sibling of
  the normal `Aincrad` user-data directory, derived from Electron's `appData`
  path. It is never nested within the legacy directory. The renderer and CLI
  supply no filesystem path. A second, divergent import requires a later,
  separately reviewed profile chooser; this flow never replaces the slot.
- An ordinary launch always uses the original default profile. A fixed
  `--recovered-proof-v1` mode alone selects the copy, before Electron is ready.
  In that mode, the main process verifies the fixed directory and manifest,
  then sets both `userData` and `sessionData` to the copy directory before
  making a window or session. Test/smoke profile flags cannot route to a
  product copy. Unknown or mixed profile flags fail closed.
- Every new-build process obtains `requestSingleInstanceLock()` **after**
  selecting its profile path and before opening a window. A second process
  cannot act as a writer; a `second-instance` event never changes the running
  process's profile in response to flags from that second process. The old
  build has no route to the sibling directory. Native two-process tests must
  prove lock scope, relaunch timing and path behavior on each supported
  platform before import is enabled.
- The trusted bridge exposes only fixed operations such as `profileStatus`,
  `createRecoveredCopy` and `openRecoveredCopy`. It accepts no path, process
  executable, URL or shell command from the renderer. Main owns relaunch with
  the fixed mode flag, and the current process quits; an ordinary launch is
  never silently redirected. A normal restart opens the original profile,
  where an explicit **Open recovered copy** action remains available. A
  restart from within the copy keeps the copy mode.
- The renderer obtains `profileStatus` before loading any saved state or
  constructing `PopulationRuntime`. An unavailable or inconsistent status
  fails closed; an empty copy must never take the normal fresh-world path.
- A test-only injected root may exercise the route with disposable profiles,
  but only under `--test` in an unpackaged development build. It must never
  resolve to either product profile. Smoke tests remain isolated.
- Both the title and a persistent in-game label say **Recovered copy** while
  that profile is active. The original recovery screen says **Original world**.
  The copy label includes its creation time and a short source-backup hash.
  UI explains that progress in the original and copy may diverge and there is
  no merge or automatic copy-back.

## Backup and slot creation

1. In the protected original profile, the user explicitly exports the exact
   renderer-observed raw `aincrad.save.v1` value using the existing native
   save dialog. The
   bridge verifies UTF-8 bytes, length and SHA-256, writes exclusively outside
   either profile, syncs and reads back the backup. Import also rejects a
   selected backup stored inside either profile. The original raw value is
   checked again after export. A previously exported file may instead be
   selected and verified against the *currently renderer-observed* exact raw
   value before use. This is a backup snapshot, not a claim that an older
   concurrent writer cannot subsequently change the original. The UI shows
   its timestamp and full SHA-256 and explains possible divergence.
2. The user explicitly chooses **Create recovered copy from this backup**.
   The native bridge retains a short-lived ticket for the successfully
   exported or selected backup, bound to its verified bytes, hash and path.
   Create accepts no renderer path or process command; it reopens and
   re-verifies that ticket's file and checks equality with the raw source value
   and hash supplied by the protected first-party renderer. Cancel or process
   restart invalidates the ticket.
3. Main checks real paths to exclude the original profile and symlink aliases.
   It stages the verified raw bytes in an app-owned temporary sibling,
   syncing and reading them back. It reserves the fixed slot with an exclusive
   directory creation, publishes the verified raw with an exclusive file
   create/link, and publishes the pending manifest **last** with an atomic,
   no-clobber file operation. A reader treats the slot as available only when
   the manifest and staged raw verify together. The manifest records fixed
   profile identity, import phase, original byte length, source SHA-256 and
   creation time, but no user-selected path. This commit-marker sequence avoids
   a portable `rename` replacing an occupied empty directory. A crash before
   the manifest leaves an inert slot. The same verified source may fill only
   known missing pieces when a valid in-slot reservation identifies its hash;
   an empty unidentified slot, partial/corrupt marker or divergent/corrupt
   staged file fails closed and is never replaced. It never writes the original
   save key. An occupied valid slot
   is never deleted or overwritten: matching source hash may reopen/resume;
   different hash fails visibly.
4. Main relaunches into the fixed copy mode. The pending copy opens a paused
   import screen before `PopulationRuntime`, `SimulationClock` updates,
   `writeSave`, fresh-world controls or autosave can run. Staged bytes are
   reverified against the manifest. A missing or corrupt stage blocks import.

## Import and crash recovery

1. In the copy, the existing pure `prepareLegacyPendingMigration(raw)` runs
   on the verified stage. It must pass the strict original action/ingestion
   receipt check, physical and learned-effect continuity audit, ordinary
   `loadSave` round trip, proof validation, and the current bounded ownership
   rules. The screen shows the exact pending rows and explains that their
   feedback remains physical only. No further save-schema change is allowed.
2. On a separate explicit **Import into recovered copy** action, require the
   copy save key to be absent. Write only the candidate to the copy's
   `aincrad.save.v1`, read back exact bytes, run `loadSave` and the continuity
   audit, then flush the copy's DOM storage and restart in copy mode. The UI
   does not announce success or enable play before a full closed-process
   reopen confirms the on-disk candidate. A quota, write, readback or restart
   failure leaves the profile pending and paused.
3. On reopened pending copy, recompute the candidate from staged original
   bytes. If Local Storage is absent, offer the same explicit import again.
   If it exactly matches the candidate and validates, atomically mark the
   manifest ready. Any other value, malformed marker or proof failure stays
   protected; never overwrite it or fall back to a fresh world.
4. On every later ready-copy start, require a valid copy manifest and a valid
   saved world with `legacyPendingPhysicalOnly:1` and strict proof checks.
   Its current bytes may differ from the initial candidate because the copy
   has progressed. If absent or invalid, block runtime and saving. The
   original and the external backup remain available; recovery can resume a
   sound pending slot, but no automatic rollback or world merge occurs.

## Required verification before enabling import

The supported recovered-copy path currently covers macOS and Linux. The
proposed Windows CI job checks the unavailable capability, direct-route
rejection, unchanged original/copy bytes after refused operations, the full
source suite and an ordinary-profile smoke launch. Its previous native
import attempt failed at directory `fsync` with `EPERM` after protected-original
checks ([run 38940674942](https://github.com/kumori-i/aincrad/actions/runs/38940674942));
no Windows recovered copy was published. Native Windows import remains deferred
until a separately reviewed implementation and verification are available.

- Unit coverage for fixed path/flag parsing, real-path and symlink rejection,
  exclusive slot creation, manifest phases, same-hash resume, divergent-hash
  refusal and an empty/unknown copy save gate. Keep the full source suite green
  with `npm run check` and `npm run build`.
- Native two-process tests for one writer on the copy, old-default/new-copy
  coexistence, correct `defaultSession.storagePath`, relaunch timing, and no
  userData or sessionData aliasing. Use only disposable profiles and mock old
  processes.
- Native import with copied archived raw fixture: export, stage, preflight,
  explicit commit, close and reopen, candidate/proof/physical continuity,
  visible active-copy label, and unchanged original raw bytes. Exercise
  quota/failure/crash phases and divergent slot rejection. No live world or
  running user profile is touched.
- Independent source review and exact changed-file/test status before any
  publication or merge. This design creates no publication authorization.

## Deliberate limit

The one-slot route is narrow enough for the blocked world. A corrupt occupied
slot is not automatically reset, because that could erase progressed copy
history. Supporting several independent copies, choosing among them at normal
launch, or replacing a divergent slot would require a registry and general
profile lifecycle UI; those changes are outside this repair.
