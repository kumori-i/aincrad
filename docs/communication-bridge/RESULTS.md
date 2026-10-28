# Protocol 1: first survival/communication comparison

**Result: the bridge executed and updated fresh policies, but this comparison
demonstrated no survival advantage or learned shared language.** Two of three
seed pairs had no eligible exchanges. The third had the same recorded exchange
ledger and terminal body/action aggregates with messages enabled and erased.

## Frozen execution

- [Merged implementation, PR 60](https://github.com/kumori-i/aincrad/pull/60).
- Source `4aad44fecb0ae9ed46a620a991ea2a2781b99bfd`; tree
  `be976d307d662db17636ca150839dc8404bb353e`.
- Renderer fingerprint
  `0797f513343ab4e3d86134ffa7eb768d5a3d2a39c2246303320fcdfc46a8d25f`.
- [Sole reserved execution](https://github.com/kumori-i/aincrad/actions/runs/40758217440),
  create event, attempt 1, branch `experiments/communication-bridge-v1-once`.
  Planned source was recorded before creation in PR comment 6479049983.
- Linux X64, six fresh native processes, all completed 600 simulated seconds.
  Total comparison wall time 1,263,861 ms (21m 3.861s); no retry or warm start.
- Original artifact 12847853589, SHA-256
  `2dd7024a46a4a51eef64fd7ebef75b16d33ed4aa1fc927f9bb329a12f2af9a87`.
  GitHub artifacts expire; [results-v1.json](results-v1.json) retains compact
  metrics, outcome ledgers and model diagnostics. [Protocol](PROTOCOL.md) remains
  unchanged. These are the first results, not replaced by a later improved run.

## Every trial

| Seed | Messages | Exchanges | Updates | Positive | Effort-only expiry | Censored |
|---|---|---:|---:|---:|---:|---:|
| 211 | enabled | 0 | 0 | 0 | 0 | 0 |
| 211 | erased | 0 | 0 | 0 | 0 | 0 |
| 223 | enabled | 13 | 11 | 2 | 9 | 2 |
| 223 | erased | 13 | 11 | 2 | 9 | 2 |
| 227 | enabled | 0 | 0 | 0 | 0 | 0 |
| 227 | erased | 0 | 0 | 0 | 0 | 0 |

An exchange is a symbol-conditioned optional-action selection, not a physical
trade or evidence that a word has acquired meaning. Both positive rows in seed
223 link a paid pull to the listener's later personal ingestion and sustained
relief. These also occurred with messages erased: they are not a demonstrated
communication benefit. All nine negative rewards in each arm were action-cost
penalties with zero attributable benefit before the fixed horizon, **not
attributed sickness**. Two pending opportunities per arm were censored on
disposal at 600 seconds and did not update either policy.

Terminal outcomes below are identical within each enabled/erased pair. Food,
water and energy are displayed 0–100 state values, not rewards. Meals/drinks are
existing runtime counters; conventional social channels remained enabled.

| Seed | Agent | Food | Water | Energy | Meals | Drinks | Samples | Social events |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 211 | Aster | 53.33 | 93.19 | 35.44 | 5 | 2 | 16 | 6 |
| 211 | Mira | ~0 | 81.54 | 39.94 | 0 | 0 | 1 | 3 |
| 223 | Aster | 83.81 | 95.97 | 38.15 | 11 | 2 | 20 | 19 |
| 223 | Mira | 99.05 | 94.44 | 35.98 | 9 | 2 | 17 | 21 |
| 227 | Aster | 94.92 | 96.56 | 39.91 | 14 | 2 | 23 | 7 |
| 227 | Mira | 59.58 | 92.81 | 39.72 | 6 | 2 | 6 | 5 |

All terminal collapse counters were zero. This short run does not establish
long-term survival; Mira's near-zero food in seed 211 remains a negative finding.

## What changed, and what was not established

Initial neural fingerprints matched within each seed pair. In seed 223 both
agents' sender and receiver weights changed, with finite parameters and no
failed updates. Enabled and erased receiver weights ended differently; sender
weights matched across arms. Seeds 211 and 227 had unchanged weights. This
confirms online updates in one pair, not useful meanings or visual concepts.

Seed 223's enabled frozen shuffled-message diagnostic had mean total variation
`0.004411768627040076` and one changed argmax in 13 observations. The erased arm
had zero sensitivity. This is current-weight input sensitivity, not a causal
survival test; random initial networks can already be sensitive. An equivalent
initial-weight diagnostic was not retained, so growth in sensitivity or learned
meaning cannot be inferred. Zero observations in the other seeds cannot test
their policies' message sensitivity.

The 64 categorical symbols and their two-digit display are supplied, not an
invented alphabet or compositional grammar. Whole-object cropping, fixed pixel
pooling, motor channels, communication scheduling and centralized listener
reinforcement are also supplied scaffolding. No pretrained language was used.

## Audit and evidence limits

Independent audit checked execution/source identity, all six horizons, matched
initialization, finite/update-linked weight changes, ledger reward/cost math,
60-second completed windows and null-reward terminal censoring. No ledger rows
were dropped. Recorded ledgers and terminal aggregates match between arms;
**complete trajectories were not retained**, so equality of every physical
action cannot be claimed. The ledger contains receipt/ingestion IDs, but not the
full canonical engine proof records for an independent end-to-end replay.

Native screenshots were visually inspected. Comparison screenshots are captured
before disposal: seed 223 shows zero censored while the final JSON correctly
includes two. The harness updates its trial status label, but leaves form seed
controls at their default and last-exchange crop canvases unsynchronized. Use
serialized source/seed/mode and snapshot records as evidence, not these controls
or blank crop widgets. They are not fully synchronized trial dashboards.

Implementation acceptance is separate: exact-head CI passed 1,391 tests
(1,390 pass, one skip), build, and actual Linux/macOS UI/save-byte close/reopen
checks. Original macOS renewable/sharing job 123023655331 was cancelled near its
time budget despite passing steps/artifact; its one unchanged-source targeted
retry 123047983032 passed. Preserve the cancellation as history. This was an
infrastructure acceptance retry, not a scientific-comparison rerun.

## Next question

Diagnose which eligibility gates prevent opportunities, without loosening
survival priorities or inventing positive outcomes. A separately recorded next
version should distinguish effort-only expiry from discomfort in the UI, retain
bounded canonical receipt evidence, and compare initial/final sensitivity before
testing claims about shared categories. More symbols or longer runs alone would
not resolve these evidence gaps. Do not rerun or move the reserved branch.
