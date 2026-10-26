# Historical evidence and reproducibility

The release specification is [ACCEPTANCE.md](ACCEPTANCE.md). It has its own hash;
it does not replace the identities or conclusions of earlier experiments.
Original development records, complete raw reports and original source snapshots
are retained outside this release. Their text is not presented as current release
documentation. The historical hashes below identify preserved bytes, not newly
validated results or files available at those old paths in this checkout.

## Reproduction boundaries

The unchanged historical `evaluate-food-balance`, `evaluate-food-balance-v3`,
`evaluate-food-balance-v4`, `evaluate-food-factorial`, and
`evaluate-food-toxicity-v3/v4` scripts retain their original hashes and input guards.
They are archival tools, not self-contained release commands. Reproduction needs
the exact original protocol/report/source inputs, including the paths specified
by each script. Those complete input packages are not bundled here; running an
archival tool without them will fail. Do not fabricate files, relax hashes, or
call a release-specification run a replay of an earlier protocol.

The current release budget evaluator uses a bundled, separately hash-pinned
technical fixture containing the exact original controlled baseline arm, its full
initial state reconstructed from frozen main and verified against the original
recorded raw-state hash, baseline runtime manifest and extraction provenance. Only generated
simulation data is included, not a live user save or coordination records. The
full original failed-report hash remains a provenance identifier; the curated
subset has its own integrity hash and does not make the failed original candidate
pass. The baseline metrics are historical measurements, not a fresh baseline run.
The evaluator executes the current runtime under the new release specification. The current capability evaluator
requires that passed same-runtime release-budget report. Their manifests name
source, protocol, evaluators and input hashes; their outputs have separate paths
and identities. These are fresh release runs, not retroactive edits to history.

## Preserved numerical summaries

- [v2 results](../food-balance/v2-summary.json): budget gate and initial comparison
  failed. The original full check was1,057 passed/23 failed/1 skipped, not release
  acceptance. The controlled late absorbed/spent ratio was0.883, below1.
- [factorial diagnosis](../food-balance/factorial-summary.json): bounded component
  comparison, not release acceptance or a universal causal model.
- [v4 results](../food-balance/v4-summary.json): standalone balance/source-caution
  results, explicitly excluding the later funding integration. Original source,
  protocol, evaluator and report identifiers remain unchanged.

The v3 controlled gate passed but its harm gate failed: three later samples from
an implicated successor material. An earlier toxicity setup wrongly expected40g
remaining while real decay left39.797168g; that failed output remains a failure.
The corrected v2/v3 comparison retained seven cognitive differences and is not a
clean causal harm-size comparison. The subsequent matched v3/v4 comparison
observed three versus zero post-harm samples; initial129.790g exposure remained.

The initial warning comparison was inconclusive: its report-ablated control
selected an unrelated inspection, so it did not establish an eligible sampling
opportunity or avoidance. A later cache/save fixture failed because cloning lost
runtime geometry/save bindings; that remains a fixture failure, not a physical
simulation result. Subsequent valid encounter tests do not relabel either event.

The six-hour ordinary v4 trials matched v3 for all four actor/seed trajectories;
they did not establish calorie adequacy. Seed74193 Mira consumed less and lost
55.631kcal more reserve than main; her25 blocked-movement outcomes versus20 and
Aster's reduced rest remain disclosed. Seed74203 matched main. These standalone
results cannot establish combined-runtime ordinary survival.

## Preserved original document fingerprints

| Historical artifact identifier | SHA-256 |
| --- | --- |
| `docs/FOOD-WARNING-PROTOCOL.md` | `09d466efab9832ab02fd1195dbddea6e05f18437e70287cf5e9cbab229670349` |
| `docs/npc-effort-funding/protocol.txt` | `70baefb2b20011be0b33fa1d3b86fa3df3cb57097ca96cf596cf7b791a021ac5` |
| `docs/npc-effort-funding/verification.json` | `2d8b2719952d0c2ce7a35e0dcc390cea070de0a285c1e946df4ce7fdad25fd49` |
| `docs/food-balance/COMBINED-ACCEPTANCE-ADDENDUM.md` | `547cdbc0a47545bd019378359c67d05752fbce7894e3134be14d3a8a9ce5adc6` |
| `docs/food-balance/FACTORIAL-PROTOCOL.md` | `ff027031a2883f470eb982f4ba8b53b6c8aaf1c267070c6980dd86e8dffb56f8` |
| `docs/food-balance/PROTOCOL.md` | `54a00f24b94c094c1358ab59f73c7ea737a5b4cc89601399a44feebba6d1aecc` |
| `docs/food-balance/V3-PROTOCOL.md` | `420ed0b1c122ce0cd7f6f519cc2f2f969bcb6b34b424dade8273288b669ef964` |
| `docs/food-balance/V3-RESULTS.md` | `8aa9be53b2178ee7b65b3eeb4de7d3e769ccbebeecf7756d9b8d85cd296f1e6b` |
| `docs/food-balance/V3-TOXICITY-ADDENDUM.md` | `6eaff22abee45f5d2230e4198e59ba7690aa68ea795865a6b0776f47b722726b` |
| `docs/food-balance/V4-PROTOCOL-superseded-latest-acquisition.md` | `9c3d037926d617ea7ee8acdd4afa948fa62a4b918829387d2e56871c7fa7aaff` |
| `docs/food-balance/V4-PROTOCOL.md` | `85b8546f83b50ac2fce2990ba40d471ec660b5850963ce85eb319536eb4bfdf4` |
| `docs/food-balance/V4-RESULTS.md` | `15d2cc4b8b8f4d937ee6538cf5969d9a7d3bdd86fef4afe6fded7f95e6b755cf` |

Current release mechanics are documented separately in the food satisfaction,
warning and effort-funding feature guides. Failed observations, source-specific
limits and the lack of autonomous-survival evidence remain part of the record.
