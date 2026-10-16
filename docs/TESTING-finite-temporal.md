# Finite temporal policy: interactive gate failed

This research branch adds an evaluator-owned, capacity-constrained temporal action
chooser. Desktop gameplay never instantiates it. Its explicit 256-row/128-replay
profile is a separate experiment; PR #7's full-capacity targets remain unresolved.

Before autonomy, the frozen implementation passed 528 tests, build, actual Electron
smoke/reopen, and 7,200 native-step default-game comparisons. The two default actors
and full world were equal, including exact production save bytes and continuation
after reopening at 60 seconds. Independent review cleared correctness and the
bounded measurement scripts. These results do not establish useful learning.

The original interactive resource gate **failed**. Each case used 240 measured
submissions after 60 warmups, on the recorded cloud Xeon CPU:

| Retained history | Online p95 | No-bootstrap p95 | Frozen-zero p95 |
| --- | ---: | ---: | ---: |
| Cold | 1.694 ms | 1.499 ms | 1.072 ms |
| Full-cap known contexts | 11.869 ms | 5.322 ms | 4.410 ms |
| Full-cap unknown contexts | 18.970 ms | 4.535 ms | 2.802 ms |

The limit was 5 ms. All complete encoded actors fit within 1 MiB, with a measured
maximum of 343,413 bytes. Full-known online p50/p99/max were
3.796/27.252/29.082 ms. Full-unknown online had a 769.188 ms maximum alongside
large construction/reset tails; the cause is unassigned. Neither scheduler delay
nor garbage collection nor algorithm cost has been isolated as its cause.

These are copied-state submission measurements, with synthetic bounded histories
and one real initial opportunity set. They include 128 distinct retained replay
update keys but do not establish worst-case later learned-state timing. The
complete benchmark process sampled 189.3 MB heap and 358.3 MB RSS; this includes
fixtures, traces and serialization, not isolated actor allocation. Save measurements
use an in-memory storage sink and do not establish renderer responsiveness.

No autonomous trial was admitted under this failed gate. Original plain/cohort
progression remains blocked. No threshold was changed, no timing samples discarded,
and no retry/tuning performed to convert this result into a pass.

The compact source hashes, checks, raw evidence fingerprints and limitations are in
[the interactive-gate summary](finite-temporal/interactive-gate-summary.json).
Full raw reports/logs and the original evaluator are retained in the evidence
export rather than committed as large traces. No laptop, Ollama, survival,
interactive-readiness or default-game improvement claim is established.

## Separate headless diagnostic

After preserving the failed interactive result, a separately approved and reviewed
[headless protocol](DESIGN-finite-headless-diagnostic.md) ran exactly three fixed
600-second arms. Policy, physics, seeds, body, context profile and outcome metrics
were unchanged. Admission was explicitly research-only: original measured p95
below 50 ms and actor below 1 MiB, with a checked-after-return 1,000 ms decision
ceiling, 300-second wall ceiling per arm, and external process supervision.
The original 5 ms failure and original cohort block remain unchanged.

All three scheduled 600-second runs finished with identical initial states and valid
conservation. The stop is continuing (`terminal:false`): biological outcomes are
right-censored at 600 seconds, with online/frozen pending calories shown below.
No-bootstrap’s release and frozen-zero’s movement remain unfinished in the
preserved stop states. Resource `censored:false` means no ceiling truncated a run;
it does not make these continuing physical outcomes terminal.


| Arm | Distinct food-chain materials | Swallowed kcal | Absorbed kcal | Pending kcal | Spent kcal |
| --- | ---: | ---: | ---: | ---: | ---: |
| Online temporal return | 1 | 31.67 | 4.83 | 26.84 | 723.03 |
| No-bootstrap control | 3 | 54.29 | 54.28 | 0 | 745.59 |
| Frozen-zero control | 1 | 19.00 | 4.60 | 14.40 | 676.95 |

Every food chain links a real acquisition, successful swallow and same-ingestion
sustained-F report. Each physical material is counted once. Online's first food
chain began with a pull at 498.02 seconds, sampling at 520.02 and food feedback at
565.50. This establishes that autonomous sequencing can occur in the driver; it
does **not** show that temporal bootstrapping improves it. No-bootstrap completed
more food chains and absorbed more energy in this one matched development start.
There was no held-out test, transfer claim or broader cohort.

Minimum health remained 100, with no collapse, discomfort ingestion or recorded
injury. Large initial body stores buffered the substantial energy deficits. These
600-second outcomes do not establish self-sustaining behavior or long-run survival.
Water-benefit material counts were 9/6/7; nourishment does not establish safety
against later unobserved toxicity. No toxic-lookalike trial was run.

Online/no-bootstrap/frozen-zero chose unknown forecast contexts on 78.6/80.5/75.3%
of ordinary decisions. Their final row counts were 123/128/115, below the 256-row
cap, with no dictionary overflow or unknown-capacity receipts. Replay reached its
128-record limit and reported censored history. These are trace observations,
not yet a causal attribution of the weak learning result.

Actual instrumented decision p95 was 3.48/3.05/2.31 ms, maxima 8.08/4.78/4.95 ms,
and wall time 16.38/16.03/15.76 seconds per arm. Sampled complete actor peaks were
393,444/393,101/361,436 bytes. These small real trajectories pass the separate
headless ceilings; they do not reverse the saturated interactive benchmark failure
or establish laptop/renderer responsiveness. Maximum energy residual was below
5.3e-9 kcal, all finite-transfer checks passed, and no outside assistance occurred.

The final evaluator/supervisor version passed 541 tests and build; 31 focused
checks passed independently. Runtime fingerprints were unchanged from the earlier
actual Electron/reopen and default-parity checks. No policy is enabled in play.
The [compact headless summary](finite-temporal/headless-diagnostic-summary.json)
contains exact chains, paired metrics, source hashes and the raw-evidence manifest.
Chain order fields count only driver submission/outcome/feedback callbacks, not
the global owner traceOrder that also includes snapshots.
The full trace/world export is retained separately. The research branch remains a
draft; no further trial, weight change, cohort or main promotion follows here.
