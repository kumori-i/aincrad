# Stable-save Stage A: isolated worker preparation

Status: **FAILED for promotion.** All 16 arms finished; no stable gameplay integration, rerun, threshold adjustment or Stage B occurred. The prototype remains research-only.

## Result

Moving validation/serialization to a dedicated worker reduced the recorded 900-second world’s measured renderer work, but the whole-world dispatch and synchronous localStorage commit still exceeded their fixed budgets. The larger schema-valid capacity fixture saved successfully in both arms; capacity success did not establish responsiveness.

| Fixture / session | Baseline renderer work p95 ms | Worker renderer work p95 ms | Worker dispatch p95 ms | Worker commit p95 ms | Recorded frame-gap p95 ms | Fixed gates |
|---|---:|---:|---:|---:|---:|---|
| fresh-v8 / 1 | 48.30 | 8.20 | 3.70 | 4.70 | 16.80 | pass |
| fresh-v8 / 2 | 43.30 | 7.40 | 2.20 | 5.50 | 16.80 | pass |
| recorded-900s / 1 | 107.50 | 49.20 | 19.10 | 27.30 | 33.30 | fail |
| recorded-900s / 2 | 171.60 | 46.10 | 16.70 | 28.00 | 66.80 | fail |
| native-juvenile / 1 | 3.00 | 1.90 | 1.00 | 0.60 | 16.80 | fail |
| native-juvenile / 2 | 5.60 | 1.10 | 0.60 | 0.40 | 16.80 | pass |
| physical-cap / 1 | 190.70 | 78.50 | 30.50 | 45.60 | 66.70 | fail |
| physical-cap / 2 | 289.50 | 66.20 | 22.80 | 36.10 | 50.00 | fail |

The fresh-world pairs and one small juvenile pair passed all computed gates. The other juvenile pair missed the relative 50% reduction requirement (3.0→1.9ms), despite low absolute cost. Neither recorded-world nor capacity pair passed. Frame values above are rounded only for display: recorded-world session1 is 33.30000000000018 ms and fails the original strict 33.3 ms comparison. No tolerance was applied afterward. Direct dispatch/commit failures independently prevent promotion.

## Fixed protocol and identities

- Approved plan SHA256: 7fff23a90c08d88e55a87e108c90c13cc1bc6ae04f78e6701c853112af0cf265.
- Executed source commit: e204ae9625f41fede5f662a77fc744b46b1f7947.
- Executed packet SHA256: a0ad86fc6a793da8672b54813b2c4436e883a0ddc372c63c409b888ae68f9798;73 sources,59 served assets,2 privileged executables,8 input files.
- Stable main: 1f20f401f720b61069dcea06d10cc4e885e0b1f6; renderer fingerprint: 37c7c8ed74449e65fdb07ef6ac1b985e315d1d3e232e69fb307389e866f8263f. No production files changed.
- Four A/B pairs differ only in the valid selectedAgentId UI field. Opposite B text was seeded once per arm, followed by 500 ms settling. Each of 25 timed writes alternated A/B and required the exact opposite prior hash. None was an identical-value localStorage no-op.
- Two sessions reversed baseline/worker order. Each arm used a new isolated native profile. 16 cold, 64 warmup and 320 measured samples are retained, 400 total. Upper median is sorted[10] of 20; p95 is nearest-rank sorted[18].
- Run took 160.954 s on cloud Linux x64, Intel Xeon Platinum 8573C, 9 reported logical CPUs, 10,451,460,096 B reported RAM, Electron 44.7.0. This is environment-specific evidence, not a varied-laptop benchmark.
-74 prototype tests, 406 stable tests and build passed. Final runner setup-check relocation received syntax and independent review after aggregate checks began; it was not imported by those suites.

## Correctness/security observed

All 400 commits matched the frozen requested bytes, and all 16 final canonical load comparisons matched. All 16 security probes observed Node absence and enforced connect-src, script-src/eval and worker-src violations. Actual worker arms stayed enabled with 25 captures/commits and maximum coordinator in-flight count 1; these counters do not measure every worker-side allocation. Frozen pre/postflight checks passed. No quota, source-integrity, protocol or watchdog failure occurred. Native quota-failure preservation was therefore not exercised.

The recorded 900-second pair is a canonicalized recorded snapshot: the declared pre-existing agents[0].interrupted=true marker was removed by the ordinary save path. Physical fields were retained; this is not original source-byte identity.

The four pairs contain approximately 0.453 MB fresh, 3.622 MB recorded, 0.059 MB juvenile and 7.239 MB capacity payloads. The capacity case is schema-valid storage stress, including 8 extra rabbits beyond the normal species birth cap, unique finite stocks and rebased initial energy. It is not a naturally reached ecosystem. It adds no actor knowledge. Full construction is in the frozen input manifest. Isolated-profile quota success is not a universal quota guarantee.

## Important limits

1. All capturePage PNGs are 1×1 despite the requested 1440×900 window. Viewport/DPR/drawing dimensions were not recorded. Renderer code and rAF executed, but representative full-sized desktop rendering load is unverified. These frame statistics cannot support desktop smoothness claims.
2. 28/400 frame arrays end 0.1–11.1 ms before the declared observation-window end (23 measured, 4 warmup, 1 cold). Their leading/save-completion portions are covered; all timer arrays bracket both ends. One baseline rAF tail is only 99.7 ms beyond completion, so even the completion + 100 ms target is not universally covered. Frame metrics describe recorded samples, not certified full-window coverage.
3. Physics was paused. No ordinary-play, active Cardinal/provider, real close/reload barrier or production replacement integration was tested in Stage A. Existing unit tests cover coordinator races/protection; they do not replace Stage B.
4. Renderer work sums measured request and outer response-handler spans without double-counting nested commit. Pre-handler message deserialization is not separately attributed. Worker preparation and end-to-end latency are reported separately. Synchronous localStorage remains on the renderer. The recorded-world session 2 worker has an unattributed 166.7 ms maximum frame outlier after its response handler; it must not be presented as measured coordinator CPU.
5. Memory is sampled every 250 ms plus post-window renderer heap. Summed per-process footprints can double-count shared pages and are not unique RSS or universal transient peaks. The maximum sampled summed footprint was 741,604 KiB; maximum post-window renderer heap was 135,001,506 B. Queue bounds are counts, not proof of an 8 MiB/32 GB heap target.
6. No cloud service, paid dependency, GPU requirement, research-model change or new storage backend was added. Windows/macOS behavior remains untested here.

## Evidence

The compact summary and complete raw report, all cold/warm samples, streamed rows, logs, fixed source/input packet and test logs are preserved in the evidence export. Native profiles remain local but are excluded from that export; the exact input/committed bytes are included as frozen pairs and every readback hash is retained. The superseded, unexecuted v1 packet is retained locally but was never executed. This result motivates a read-only comparison of genuinely off-renderer commit options; it does not authorize implementation.
