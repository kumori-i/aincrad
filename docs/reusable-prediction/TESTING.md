# Reusable outcome prediction: bounded research checkpoint

The original saturated resource gate **failed**. A separately preregistered,
one-shot scripted prediction-use diagnostic **passed its first gate**. Neither
result enables the model in gameplay. The compact machine-readable evidence is
[summary.json](summary.json); full traces and exact frozen sources are retained in
the evidence export identified there.

## What changed

A research-only factorized predictor pools personally observed physical action
outcomes separately from delayed ingestion-channel evidence. Stable observed
appearance and action relations can reuse evidence despite nuisance history/focus
changes. Exact material identity, current observation, ingestion provenance and
negative evidence remain necessary for supported use. The state abstraction,
priors, shrinkage, need weights and selection formula are engineered choices;
parameters are updated from actual observed receipts and feedback. No neural or
LLM weights are trained.

The implementation lives under `scripts/lib`; production gameplay imports none
of it. The finite native fixture uses the existing physics, qualitative public
observation and finite stocks. It supplies an owner-scripted action sequence for
testing, not a recipe learned by an autonomous inhabitant.

## Original resource admission: failed, preserved

One quiet-window run used 40 warmups and 240 measured samples per completed case
on the cloud Xeon 8573C / Node 24.19 environment. This is not a laptop benchmark.

| Case | Added-decision p50 | p95 | measured max | Encoded actor/metadata |
| --- | ---: | ---: | ---: | ---: |
| Cold | 0.84 ms | 1.85 ms | 5.02 ms | 8,931 B |
| Full-cap known | 54.79 ms | **77.07 ms** | 169.05 ms | 728,683 B |
| Full-cap unknown | Not run | Not run | Not run | Not measured |

The unchanged gate required p95 below 50 ms. Execution stopped at its first failed
case; no unknown-cap workload was subsequently measured. The full-cap known
fixture had 256 old plus 256 new dictionary entries, 256 new typed rows, 64 retained
exposures, and 128 retained replay/event entries. All known update work was
performed. Label updates dominated the measured time. The maximum including
warmup/cold/tail checks was 265.57 ms. These timings do not include external size
serialization/reset overhead, which is separately retained in the raw report.
The encoded size fits 1 MiB but does not imply a JS heap or whole-world-save bound.

The report remains pinned at SHA-256
`1750246f089497c235f4beb0fc4b9c193fe3db28aba3b43bb2942dc315e5cffd`.
Its 131 source entries are unchanged. The existing interactive readiness failure
also remains unresolved; this checkpoint makes no responsiveness claim.

## Separately approved scripted diagnostic: Gate 1 passed

[The separate protocol](../PREREG-scripted-prediction-use-v1.md) was committed at
`6bbc6cc` before its only execution. It preserves the scientific implementation
and every original scientific efficacy threshold, while using a noninteractive 1000 ms checked
returned-work ceiling, 300-second wall ceiling and 1 MiB sampled actor-size bound.
An owned-child watchdog enforced an absolute 315-second startup/run deadline plus
15-second kill grace. No timeout, retry or capacity denial occurred.

In the default seed 74193 copied world, the supplied script pulled one finite
material, inspected it, sampled it, and completed two five-second waits. One
3.5-second sample produced ingestion 1 at 11.616667 simulation seconds. The frozen
numerical control was captured at 22.95 seconds, before its first genuine F event
at 57.10 seconds. At 57.80 seconds the first eligible scheduled observation still
contained the exact remaining held material.

All 16 immutable nuisance queries produced the same result:

- Learned discounted F forecast: 0→0.8929944544.
- Matched selected action: inspect→sample on that exact material.
- Sample advantage over the strongest supported comparison: 0.4457471283,
  exceeding the unchanged 0.05 threshold.
- Frozen numerical control: forecast 0 and inspection choice unchanged.
- Both query arms had the same factual firsthand support and action masks.
  Physical parameters, saved state and RNG were unchanged by the queries.

These are 16 sensitivity variants of **one earned material example**, not 16
independent discoveries. The 0.893 value is an engineered discounted channel
forecast; it has not passed prospective calibration or established safety. No
second sample or other action was executed after the comparison. The finite
material changed from 180 g to 150 g remaining plus 30 g swallowed; the ingestion
contained 15.833333 kcal, with no outside assistance. Its H prediction remained
unsupported and uncertain, with safe=false. A nourishing event is not safety proof.

The diagnostic completed in 6.37 wall seconds. The largest measured combined
construction/forecast was 22.25 ms. The conservative whole returned-work segment
maximum was 50.50 ms, including intervening native/owner work; it is not isolated
model latency. Sampled peak encoded actor size was53,178 B. The full stop envelope,
including the world, is 1,075,703 B and is outside the per-actor bound. The stop has
`terminal:false`; future biological effects remain unobserved. Continuation is
explicitly false and all later gates remain unrun.

## Correctness and native checks

The full suite passed 682 tests with zero failures, and the application build
passed. Final protocol/evaluator/owned-child checks passed 24 tests; the independent
implementation worker's overlapping focused suite passed 28. These are overlapping
checks, not additive counts. The finishing changes were confined to protocol
supervision, reporting and tests; the 131 scientific files remained byte-identical.

Actual Electron smoke and isolated close/reopen checks passed on the frozen
production build. They verify the existing local application workflow, background
simulation and explicit pause/save behavior. The experimental predictor is not
integrated into that renderer, so native checks do not establish model/UI latency.
No live Ollama, user laptop, GPU or Windows/macOS hardware performance was tested.

## Decision and remaining evidence

Keep this as a research draft. The first scripted reuse result supports the narrow
representation mechanism and justifies considering the already designed causal
state/old-meal, delayed-harm and prospective new-ingestion checks under a separately
reviewed diagnostic protocol. Those checks have not run. Autonomous acquisition,
action sequencing, self-sufficient intake, transfer to novel materials and the
original saturated performance target remain unestablished. No main promotion or
gameplay setting change follows from this checkpoint.
