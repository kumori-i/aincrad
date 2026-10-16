# Headless temporal diagnostic v1

Status: separately authorized research protocol, before any autonomous outcome.
Original implementation/resource checkpoint: `40d32fa`.
The interactive protocol in DESIGN-finite-source-temporal.md remains unchanged:
its 5 ms resource gate failed and its original plain/cohort progression is blocked.

## Question and unchanged experiment

Can the reviewed small temporal learner complete an actual finite acquisition,
swallow and delayed sustained-food chain when it chooses its own actions? Does
its observed behavior differ from no-bootstrap and frozen-zero controls?

Run exactly the original three plain starts: seed 74193, first existing fruit
source, first valid east/west/north/south 45-unit approach, selector seed 1729,
default body, 600 simulation seconds at native 1/60 steps per arm. Keep all policy,
capacity, public observations, physics, feedback, exploration draws, care masks,
need weights and efficacy/energy/safety metrics unchanged. No renderer, Ollama,
Cardinal, rescue, replenishment, reset during a run, action recipe, or extra trials.
The timing of wall-clock execution never changes simulation time or decisions.

This is a separate `headless-diagnostic-v1` stage. It cannot authorize the original
cohort. All three arms must finish intact for an efficacy comparison; a censored
arm is not counted as zero performance. Even three completed arms are a tiny
feasibility result, not generalization, autonomous survival or readiness for play.

## Separate resource ceilings

- Admission: every original warmed benchmark case has added-decision p95 <50 ms
  and complete encoded actor <=1 MiB. Require the original nine-case report,
  exact runtime/benchmark hashes, original evaluator bytes and new protocol's
  reviewed evaluator/test evidence. Never rewrite the original failed report.
- Actual single added decision >1,000 ms: stop after that call returns, retain the
  resulting state and evidence, and mark the arm censored. This is a noninteractive
  research ceiling, not an acceptable UI stall or a preemptive interruption.
- Total wall time >300 seconds per arm: stop at the next evaluator boundary and
  retain partial evidence. The in-process timer starts just after opening the
  trace file; an unusually slow initial open is covered by the external startup
  watchdog. No retries, outcome-dependent extension or tuning.
- The external owner-only supervisor uses a monotonic 315-second deadline per
  observed active arm, plus the same bounded startup/no-current-arm fallback. It
  signals only its spawned evaluator with SIGTERM, escalating to SIGKILL after
  15 seconds if needed. No remaining arm is retried after process termination.
  Preserve the flushed report/trace prefix; a separate sidecar lists all three
  scheduled arms, completed/censored/blocked status and available/absent stop
  files with hashes. It never rewrites the original report or reconstructs state.
  Record the supervisor source hash and outcome in that sidecar.
- Keep the original actor-byte checks and all other integrity checks. The actual
  5 ms p95 remains reported, but is not a pass requirement for this separately
  named phase. Original interactive admission still reads FAILED.

The measured 769 ms submission outlier coincided with large reset/construction
tails. Its cause is unknown. The 1,000 ms ceiling tolerates that observed shared
execution variability while bounding a scientific run; it does not relabel that
outlier as harmless, subtract it, or prove an algorithmic latency bound.

## Provenance and stopping

The original evaluator SHA256 is
`bb71b76ba84a1522569973284fc816d1c44781ab84c1bd5b217a0d9963fc513e`.
The original failed budget SHA256 is
`eabb0c3b890d9c946ce69192cffea9f4adf389bd39c363bafa94c34358efe2e4`.
The runtime source fingerprint must remain
`79ad0454075dbe27a7a138b0dbb89eea876ae36a3f9034f7f0cfc681fe89910f`.

Record every scheduled arm, every failure and partial trace, source hashes before
and after, elapsed simulation/wall time, actual decision tails, gross injury,
contact-event count, swallowed/pending/absorbed energy, and the exact material /
action / ingestion chain endpoint. Evaluation stops after these three arms.
No interactive promotion, main merge, toxicity experiment, held-out sweep or
original cohort follows automatically from this diagnostic.
