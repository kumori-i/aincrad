# Experimental save-preparation worker checkpoint

This checkpoint isolates save validation/encoding in a constrained static worker. **The application still uses synchronous localStorage saves.** There is no backend migration, async-close change, new temporal action chooser, or main-merge recommendation.

The frozen implementation is local commit `f906c286d0405df8e1b4ee8cdfadadba8c1135fe`, based on the byte-identical reviewed tree of [temporal core PR #7](https://github.com/kumori-i/aincrad/pull/7). Final renderer fingerprint: `23b9037c8e76dd4f4b2a3389e4212a1f7cb580ef10db6aaa3aee55f0541065bf`. Exact source/artifact hashes and every worker timing row are in [the compact evidence manifest](save-worker/evidence-summary.json). Raw reports, harness versions and logs are retained in the evidence export.

## Correctness and security

- 461 full-suite tests passed; no failures. Build passed.
- An independent review passed 51 focused save/protocol, persistence/storage, bridge/build and server tests.
- Actual Electron smoke and separate-process version-7 disk reopen passed. Existing identities, held material, sleep, depleted ecology stocks and temporal memory survived.
- Pure preparation produces exactly the former canonical save bytes and does not mutate the live state. A real active action stays active in memory; its saved form retains the existing interruption marker. This does not promise active-command resumption.
- Actual worker checks cover fresh/two-memory states, a real active wait, legacy saves, unsupported versions and damaged temporal metadata. Mutation immediately after postMessage does not change the copied save.
- Both sender and worker bound concurrent preparation. Non-enumerable protection is checked before dispatch and carried explicitly. Wrong epochs/IDs, invalid replies, failures, timeout and disposal cannot yield a successful prepared save. The worker has no persistence command.
- Static-worker CSP blocks fetch, eval and nested workers in actual Electron; same-origin module imports work. No renderer/worker Node access was observed. The response policy also applies on the loopback asset server.
- Native testing used Linux headless Electron and the existing root-only `--no-sandbox` test flag. Source sandbox configuration is preserved; these tests do **not** establish that the production OS-process sandbox was exercised. No Windows, laptop or Ollama claim.

## Measured costs and remaining limits

All timings are development probes on this cloud environment. The welcome renderer runs, but simulation and Cardinal do not advance during measurements. Runs were sequential and the reviewer paused CPU tests; unrelated host load was not measured. Baseline phase timings and later worker probes are not a formally paired performance trial. Initial, intermediate and final runs are retained, including outliers.

The original decomposed two-learner save had roughly 692 ms of validation, 73–78 ms encoding, 35–36 ms JSON serialization and 47–61 ms localStorage write time. Sending a snapshot avoids an additional explicit structuredClone, but still occupies the renderer for tens of milliseconds.

Final source, six saves per isolated two-learner arm:

| Operation | Observed range |
| --- | --- |
| Pure-worker snapshot dispatch | 28.5–98.5 ms |
| Renderer maximum frame gap during each pure-worker preparation | 33.1–464.1 ms |
| Following localStorage write | 55.9–193.0 ms |
| Frame gap around that localStorage commit | 59.7–229.6 ms |
| Test-only worker-IDB snapshot dispatch | 33.2–43.9 ms |
| Test-only strict IDB transaction completion | 20.9–46.0 ms |
| Renderer maximum frame gap during each worker-IDB trial | 36.2–47.7 ms |

Earlier isolated runs had smaller pure-worker gaps (27.5–41.2 ms), while an earlier IDB run had a 133.5 ms outlier and the mixed probe had a 378.9 ms outlier. Those are not discarded. These samples support moving expensive preparation off the renderer, but **neither path demonstrates a robust smooth-frame budget**. We have not established the cause of the outliers. The test-only IDB transaction is not a production migration or close-durability implementation.

The final two-actor canonical text is 10,619,437 UTF-8 bytes. Each synthetic saturated actor has 14,076 admitted contexts, 4,096 model rows, 512 replay transitions and 768 receipts. The worker refuses output above 64 MiB without trimming; this is a separate experimental transport bound, and each actor's original 8 MiB wire admission remains unchanged. These measurements do not bound JS heap or establish multi-hour memory behavior.

## Reproduce

Run `npm run check`, `npm run build`, and `npm run smoke`. With the repository's installed Electron dependency, run:

- `node scripts/verify-save-worker.mjs --arm=worker-localstorage`
- `node scripts/verify-save-worker.mjs --arm=worker-idb`
- `node scripts/verify-save-worker.mjs` for the mixed 0/1/2-actor probe

The script uses a new disposable profile, installs a static security/storage probe only into the generated test build, then rebuilds to remove it. Production worker messages remain prepare/release only. The IDB probe waits for a strict transaction's completion and verifies exact stored text; ordinary application persistence is untouched.

## Decision

Stop this storage stage at a reviewed preparation-only research checkpoint. Do not migrate autosave or spend more trials chasing maximum-capacity frame outliers. PR #7's full-capacity update/save targets remain unresolved. The next scientific step is a separately preregistered, explicitly capacity-constrained finite-source learning experiment, with measured costs at its actual small state size. A smaller experiment must not be presented as meeting the original full-capacity target.
