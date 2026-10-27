# Verification boundary

The lab is an optional Python research tool. It changes no game runtime code,
Electron configuration, model-provider configuration, current-save schema,
actual user profile, or existing save file. No model is loaded by the game.

Local cloud checks on the released `612da25` baseline plus this isolated lab:

| Check | Result |
| --- | --- |
| Python lab unit suite | 20 passed: renderer, privacy boundary, distinct encoders, shared reward gradients, permutation invariance, RNG replay, safe checkpoint loading, frozen evaluation, seal tamper protection. |
| `npm run check` | 1,347 passed; 0 failed; 1 pre-existing native-autonomous test skipped (1,348 total). |
| `npm run build` | Passed. Generated `dist/` remains ignored. |
| `git diff --check` | Passed. |
| `npm run smoke` locally | Attempted; blocked because Electron is not installed in this cloud checkout. This is **not** a native desktop pass. |
| Linux/macOS desktop CI | Required before merge; includes actual isolated smoke/persistence and packaging checks. Exact commit results remain on the PR/Actions record. |
| New pixel lab CI | CPU-only dependency installation and the same 20 structural tests; no long research training in CI. |

The supplied RGB crop example was rendered from the synthetic training pool and
visually inspected. It is not a screenshot of live Ozark perception or of a
learned detector. No application UI changed, so there is no new desktop visual
claim. Existing native CI must remain green; a Python experiment cannot replace
those checks.

Behavioral success is deliberately separate from software correctness. The
[results](RESULTS.md) preserve the failed initial pilot and every fixed-seed main
and receiver-only attempt, including unsuccessful learning. Final metrics are
not used as a release-success test or a license to retune the experiment.
