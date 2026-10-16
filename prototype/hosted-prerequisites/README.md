# Read-only hosted prerequisite metadata

This is local source preparation only. It reads metadata to distinguish a missing prerequisite from an unexpected or broken path. It never starts an X server, xauth, xdpyinfo, Electron, a shell subprocess, the application or a simulation. No dependency installation, settings change, artifact upload or cache step is present. The earlier v1/v2 qualifications and application sources are unchanged.

## Fixed observation scope

`diagnose.mjs` observes `/usr/bin/Xvfb`, `/usr/bin/xauth` and `/usr/bin/xdpyinfo`: existence/type, normalized resolved system path, target type/UID/mode/size, or a bounded filesystem-operation/error code. A missing path is an observation, not permission to repair it.

It reads `/var/lib/dpkg/status`, retaining only status/version for `xvfb`, `xauth` and `x11-utils`. Ownership evidence comes only from the six fixed `/var/lib/dpkg/info/{xvfb,xauth,x11-utils}{,:amd64}.list` candidates and is filtered to those tools' expected/resolved paths. No dpkg-query or other process is launched. Package absence means not listed in the observed database; missing list metadata does not prove lack of all possible package ownership. Other package descriptions, package records and file-list paths are discarded.

The report also identifies the triggering source commit, verified script SHA-256, installed workflow SHA-256, GitHub run/attempt/image identity and the existing Node version, resolved system path, byte count and binary SHA-256. Admission requires non-root Linux x64, Ubuntu 22.04, GitHub-hosted/Linux/X64 runner metadata and existing Node 22.12 or later within major 22. No alternate host or install fallback is provided.

## Bounds and interpretation

The script's shared read deadline is 15 seconds, with 320 MiB aggregate input. Individual caps are 16 MiB for package status, 1 MiB for each list and event, 256 KiB for source/workflow files and 256 MiB for the Node binary. Reads reject symlinks at their final file entry, growth, size and identity changes; Node and OS aliases are resolved first. Tool resolution may report a symlink only within normalized system paths of at most 256 characters. These are sequential observations, not an atomic host snapshot. A tool entry that changes during observation is marked CHANGED without unverified target attributes. Directory trees are never enumerated. Error names/codes are snapshotted once, guarded and allowlisted; raw messages, stacks, stderr and environment dumps are not emitted.

One structured public log record is capped at 16 KiB. `observed` means metadata collection completed, including explicit missing-tool observations. It is not a display, sandbox, viewport or simulation qualification. Fatal admission/read errors produce `unavailable` and a nonzero exit, retaining bounded observations already collected. Any errors attached to individual tool/package-list rows must be inspected. A later VM's observations describe that later VM and cannot conclusively identify the discarded v2 VM's failure; record the new image version rather than assuming label stability.

## Proposed publication boundary

`workflow.proposed.yml` is not installed. Its proposed destination is `.github/workflows/hosted-prerequisites.yml`, using standard `ubuntu-22.04`, the pinned official checkout v4.2.2 commit, `contents: read` and `persist-credentials: false`. It uses preinstalled Node and built-in Node APIs only. The proposal embeds the candidate script hash for exact-source review; neither that hash nor a source inventory authorizes execution.

A separately approved sequence would first create `diagnostic/hosted-display-prerequisites` at baseline `7451d71fc78505da38229e2c1e3ff8d139aed809`, then publish the exact reviewed diagnostic commit once. Both pushes trigger existing **Verify world** check/build. The baseline's qualification workflow does not match this branch; Desktop is main-push/manual only. No PR is needed, because a PR would add another check/build run.

The new job and script require that exact repository/branch, run attempt 1, baseline `before`, triggering SHA `after`, and a normal public-repository event with creation/deletion/force flags false. Ordinary subsequent pushes skip/reject. This is not a global lock across rewritten history; force resets, branch recreation and retries are outside authorization. Publication would expose the reviewed source plus the bounded metadata above to the public repository's logs. Publication and execution still require separate exact-source approval.

## Deterministic verification

`node --test prototype/hosted-prerequisites/diagnose.test.mjs` uses pure policy fixtures and newly created temporary files. The read-only fixture adapter is injected directly into the shared entry function; there is no CLI/environment fixture selector. Tests never probe the actual OS/package database or execute native commands. Tests cover transition gates, real bounded fixture reads, absence/broken paths, selected ownership, safe diagnostics, deadlines, source identity and public-output filtering.
