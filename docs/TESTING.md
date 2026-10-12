# Verification record

Build date: 2026-10-12. This document distinguishes tested code from unverified distribution paths.

## Automated rule and application checks

`npm run check` validates JavaScript syntax and runs the Node built-in test suite. These tests need no installed npm dependencies, network access or model calls.

Covered: deterministic terrain; five-minute traversal calibration and an actual simulated 300-second walk; mountain, water, bridge, tree and rock collisions; normalized diagonals; sprint speed; frame-gap limits; every cave mouth; reachable cave chambers; cave exits; invalid-coordinate recovery; save round trips; corrupt and incompatible save handling; storage failure behavior; waypoint bounds; HTTP asset allowlisting; and self-contained bundle/CSP integrity.

## Rendered UI smoke test

`tests/browser_smoke.py` executes the real game in headless Chromium and records screenshots. It tests keyboard movement, all three cave entry/exit transitions through E, a pause that stops game time, map opening, a clicked waypoint, the help panel, and restored progress. The completed run reported no JavaScript runtime errors. Screenshot inspection found a fractional cave raster-width defect, which was fixed and the smoke suite rerun.

A fresh verification on 2026-10-12 used the normal loopback HTTP origin in headless Chromium 153. It exercised movement, all cave transitions, map/waypoint interactions, help, pause and save restoration. A persistent browser profile was closed and reopened, and the saved position and all three cave discoveries were restored from disk. The server and browser were launched in the same isolated test environment. The actual self-contained `play.html` was also opened directly from disk and accepted movement with no JavaScript runtime errors.

`npm install` completed successfully and produced the committed dependency lockfile. Electron 44.7.0 downloaded its runtime, loaded the game's `aincrad://app` protocol in a Linux window, and accepted keyboard movement with no JavaScript runtime errors. The configured renderer preferences retained `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`. This container check used test-only root/headless flags; it does not certify the operating-system sandbox on a user's computer.

The tests are not a sustained hardware performance benchmark. Screenshots show the actual application renderer; they are not illustrations or mockups.

### Run normally on a development PC

In one terminal:

```sh
npm run web -- --no-open
```

Install the optional test-only Python dependency, make Chromium available, then in a second terminal:

```sh
python -m pip install playwright
python tests/browser_smoke.py
```

The default executable path is `/usr/bin/chromium`. Set `CHROMIUM_PATH` to your Chromium/Chrome executable on other systems. The regular test path uses `http://127.0.0.1:4173` and real browser localStorage. It is not needed to play the game.

For environments that prohibit browser navigations:

```sh
npm run bundle
AINCRAD_OFFLINE_TEST=1 python tests/browser_smoke.py
```

The environment-variable syntax above is for POSIX shells. In PowerShell, set `$env:AINCRAD_OFFLINE_TEST = "1"` before running the Python command.

## Not verified here

- The Electron window on physical Windows, macOS or Linux hardware; the Linux headless window was tested.
- Installer creation, signing, notarization or packaged release behavior; no installer is included.
- The GitHub CLI publishing path; publication in this session uses the explicitly prepared manifest and connected GitHub account instead.
- Long-duration unattended operation, large-agent populations or multiplayer; those features are not implemented.

## Before a wider release

Run the regular UI test on the target PC, verify save/load across a real app restart, perform a sustained walking test, measure memory and frame pacing during chunk turnover, and verify the optional Electron shell. Choose a project license and release/signing approach separately.

## Publication verification

All 32 Node tests and the offline bundle verification pass. The source is prepared for the existing `kumori-i/aincrad` repository, preserving its initial commit and visibility. The NPC specification remains separate; this archive does not implement NPC behavior.
