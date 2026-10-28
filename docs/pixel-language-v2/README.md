# Offline pixel communication v2

An isolated follow-up to [v1](../pixel-language/README.md), still outside the
live game. Two distinct randomly initialized CNNs receive only RGB crops and
(receiver only) two arbitrary symbols. Perfect object crops are supplied.
A harder four-candidate game forces both visual factors to matter: each episode
contains every pairing of two colors and two shapes. Either factor alone has a
50% expected ceiling; no target-dependent message has 25% chance.

The learning remains sampled-action REINFORCE with shared binary reward. A
label-free batch marginal-entropy bonus encourages varied sender symbols.
This auxiliary bias is supplied by the developer, not a discovered goal or a
human dictionary. Training appearances are broadened, and unseen checkerboard
backgrounds are reserved for final evaluation. Token meanings are empirical
usage, not definitions assigned by the code. The experiment does not establish
compositional grammar, natural language, full-scene vision, or consciousness.

Read the [measured results](RESULTS.md), [verification boundary](VALIDATION.md),
and [predeclared protocol](PROTOCOL.md) before running. V1 is preserved;
its exposed tests informed v2 and are not reused as untouched evidence. V1 and
v2 accuracy are not directly comparable because the tasks differ.

## Reproduce locally

Use the Python 3.12 CPU-only environment installation in the
[v1 instructions](../pixel-language/README.md#reproduce-locally). No game runtime
or npm dependency is added. Mac CPU training has not been benchmarked here.
Run from the repo root, with output **outside** scripts/docs/tests:

```sh
PY=.pixel-lab-venv/bin/python
OUT=../pixel-v2-runs
"$PY" -m unittest scripts.pixel_language_lab.test_lab scripts.pixel_language_v2.test_lab -v
"$PY" -m scripts.pixel_language_v2.train --pilot --seed 107 --coefficient .02 --output "$OUT/pilot-002"
"$PY" -m scripts.pixel_language_v2.train --pilot --seed 107 --coefficient .1 --output "$OUT/pilot-010"
"$PY" -m scripts.pixel_language_v2.evaluate select --output "$OUT/selection.json" "$OUT"/pilot-*/checkpoint.pt
for SEED in 113 127 139 151 163; do
  "$PY" -m scripts.pixel_language_v2.train --seed "$SEED" --selection "$OUT/selection.json" --output "$OUT/main-$SEED"
  "$PY" -m scripts.pixel_language_v2.train --control --seed "$SEED" --selection "$OUT/selection.json" --output "$OUT/control-$SEED"
done
"$PY" -m scripts.pixel_language_v2.evaluate seal --selection "$OUT/selection.json" --output "$OUT/seal.json" "$OUT"/{main,control}-{113,127,139,151,163}/checkpoint.pt
for RUN in "$OUT"/{main,control}-{113,127,139,151,163}; do
  "$PY" -m scripts.pixel_language_v2.evaluate run --checkpoint "$RUN/checkpoint.pt" --seal "$OUT/seal.json" --output "$RUN/evaluation"
done
```

The brace expansions require Bash. All output folders must be new. Both pilots
must complete, or selection stops. Both pilots and every main/control attempt
remain in the report. Incomplete main/control attempts invalidate a complete
replication claim, although their partial-checkpoint diagnostics remain useful.
Main/control runs are capped at five minutes each and the predeclared twelve
training attempts have a combined maximum of sixty minutes. Evaluation and
installation are additional time. One CPU thread per process is configured;
run attempts sequentially to keep resource usage modest. Hardware speed and
floating-point differences can change completion or scores; matching seeds do
not promise bit-identical results across platforms.

Restricted trusted-local checkpoint loading uses `weights_only=True`; do not
load untrusted files. Checkpoints record Adam/model state, reward baseline, RNGs,
config, source snapshot, version and elapsed time/status. Final evaluation checks
source/checkpoint fingerprints and does no optimization. Raw per-example arrays
include all 64 possible message choices so the ablations can be audited without
retraining. Compact measured results belong in Git, checkpoints in the separate
evidence export. Nothing here is loaded by Aster, Mira, settings or saves.
