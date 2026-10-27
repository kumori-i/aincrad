# Explicit local world reset

**Reset world…** is available in the pause menu and the protected-save recovery
screen. Opening it pauses the session and suspends all save writes. Cancel,
Back, or Escape dismisses confirmation without resetting; the game remains
paused. While a native backup is still finishing, cancellation immediately prevents reset and dismissal waits for that operation to settle. No validation error automatically resets a world.

The confirmation offers two explicit actions:

- **Export stored backup, then reset** opens the native save dialog. Cancellation
  or export failure aborts reset. The export contains the exact last stored
  `aincrad.world.v2` value, not unsaved live progress. Invalid or empty stored
  values can be exported without claiming they are playable.
- **Delete active world and start fresh** requires acknowledgement that reset
  without a backup cannot be undone through the app.

Reset replaces only the active `aincrad.world.v2` value. The old world's agents,
memories, discoveries, journal, ecosystem changes, physical progress and clocks
are replaced by the canonical fresh factory state. Model configuration and
unrelated storage/legacy backups are untouched. Validated per-agent rescue
presentation preferences are retained; test hour/weather and learning overrides
are not. Preferences cannot be recovered from an invalid world without trusting
its contents, so that case uses fresh presentation defaults.

This is logical replacement of the active save, **not secure disk erasure**.
Electron/OS storage may retain historical disk blocks. Existing exported backup
files and obsolete save keys are deliberately not deleted.

## Save-failure diagnosis

When saving pauses play, the status and pause menu show a bounded category:
strict live-state validation, stale stored bytes, serialization/size, storage
read access, quota-reported write failure, other write failure, or unverified
readback. These labels contain no saved content or arbitrary exception messages.
They do not claim the world is corrupt, diagnose total disk usage, or promise
that an unverified write preserved the prior value. Reset is still an optional,
explicit destructive action, not automatic remediation.

## Storage and lifecycle contract

`world-reset.js` prepares the new state using the ordinary factory and strict
save/load codec against an isolated in-memory slot before any active write.
`world-reset-ui.js` captures the exact stored value when confirmation opens.
All old-session saves, including paused autosave, keyboard, panel callbacks,
pagehide and unload, are blocked until cancellation or renderer replacement.

After any requested backup completes, the old population is disposed, pending
provider generations are invalidated, the simulation timer is stopped, and the
old session is permanently write-quarantined. The final stored-value comparison
and one `localStorage.setItem` occur synchronously with no intervening await.
There is no clear/remove-first interval and no rollback that could overwrite a
newer save. Changed snapshots refuse replacement. Readback must match the new
bytes before success is reported. Unreadable/ambiguous outcomes remain stopped
and explicitly uncertain; reload is offered instead of claiming preservation.

The desktop enforces one instance per profile and one application window.
`localStorage.setItem` replaces a value atomically, but the preceding comparison
is not a cross-process atomic compare-and-swap. Arbitrary external processes
that bypass the supported profile lock are outside that concurrency guarantee.

A guarded page reload starts a new session rather than reusing old controllers.
The existing fail-closed current-save validation and ordinary exact-byte save
expectations are not relaxed by the reset path.

## Backup format and security

The narrow `aincradWorldSave.exportCurrentWorld(raw)` preload method has a fixed
current key. The renderer cannot supply filesystem paths or select another key.
Native main-frame/origin/window checks and the sandbox remain enforced. Only the
native file dialog chooses a destination; exports refuse application profile
paths and existing files, use restrictive file permissions, and verify readback.
No save bytes are uploaded.

The current backup manifest uses `aincrad.current-world-raw-backup.v1`, labels
`aincrad.world.v2`, and encodes the original JavaScript string as UTF-16LE/base64
with a SHA-256 checksum and code-unit/byte lengths. This preserves even malformed
JSON, empty strings and lone surrogate code units. Export size limits can refuse
an oversized value, in which case the combined reset does not proceed.

There is **no in-app current-backup import or undo control**. The exported
`decodeCurrentWorldBackup` native helper verifies and reconstructs the exact
stored string for recovery tooling/isolated tests; it does not make an invalid
world valid. A valid decoded string restored to the current key in an isolated
profile is subject to the same strict startup validation. The older raw-backup
bridge remains separately labelled for its obsolete key and is not the current
world export feature.

## Verification

Focused generated-fixture tests cover transaction failure and concurrency
branches, confirmation/cancel/repeated clicks, backup outcomes, fresh state,
preferences and exact-byte export. They never access real user profiles.

Run normal repository checks and build:

```sh
npm run check
npm run build
```

The Linux/macOS native CI jobs provide isolated displays and real OS dialog input tools. They run:

```sh
node scripts/verify-world-reset-desktop.mjs
```

The harness uses disposable sandboxed profiles and five independent processes
to exercise cancel, native Escape, repeated clicks, normal/protected reset,
old-autosave exclusion, exact close/reopen persistence, retained preferences and
screenshots. Real native backup dialog cancellation, an unsafe-profile destination
refusal, and successful exact-byte export are mandatory in isolated CI. The OS
input helper requires CI=true and AINCRAD_NATIVE_DIALOG_CI=1 and never grants
Accessibility/Automation/Screen Recording permissions. Missing permissions fail
the gate rather than being silently skipped. Inspect the captured confirmation and fresh-world screenshots.
`--prepare-only` prepares the application/harness but is **not native execution**.
Do not bypass sandbox, display, socket or profile restrictions to run this test.

In addition to CI, the following interactive acceptance checklist uses only
disposable test profiles and generated saves. It includes extra destination-error
and valid-backup recovery cases beyond the automated native runner:

1. Start a generated world, advance/save, pause, open Reset, inspect loss warning
   and focus. Cancel/Back/Escape must leave exact active bytes and remain paused.
2. Request backup; cancel the native dialog. Confirm there is no replacement.
   Try an existing filename or unwritable destination; failure must not reset.
3. Export to a new file outside every application profile. Verify the current
   manifest and decoded original bytes. Confirm reset, fresh state and preserved
   app/model settings; close/reopen the process and verify the replacement.
4. Repeat with generated invalid/empty current bytes. They must stay protected
   until confirmation; exported bytes remain exact and invalid, not repaired.
5. Restore a verified valid backup only into another disposable profile, reopen
   through normal validation, and compare its recorded state. Restoring the
   invalid fixture must instead show protected recovery.
6. Check confirmation at the minimum supported window size, keyboard-only
   focus, repeated clicks, background inertness, and stale provider completion.

Native pass/fail, screenshot inspection, file-dialog acceptance and Node-only
preparation must be reported separately. A prepared runner is not evidence of
successful native reset or persistence.
