# Selection-consistent gate: rejected development diagnostic

**Decision: keep this research draft out of main. No held-out sweep.** The first
start alone invalidates promotion: it gains movement but loses nourishment. The
predeclared second start was completed without tuning. Default play remains the
legacy chooser, and the preceding failed selector remains unchanged in PR #5.

## What was isolated

See [design and falsifiers](DESIGN-selection-gate.md). The same candidate array,
legacy scores, ordering, random draws and learned model are retained. The one
intervention compares the actual nominated object's original legacy score with
the best existing movement, rather than letting another object sponsor it.
No reward, bodily threshold, action duration or physical resource was changed.

The actual controller is identical to the original online policy for its first
1,145 native frames. At 19.1 seconds, an inspection of object:65 scores 10.432 and
sponsors an inspection of object:52 scoring 4.057, while movement scores 5.705.
The candidate executes that movement. World, physiology, cost estimates, selector
phase/RNG and actor RNG are identical at this first split. This confirms the
structural mechanism, not a survival improvement. Main does not have this
substitution defect: it executes its own legacy winner.

## Frozen development results

One development ecology seed 74193, two predetermined starts, three source roots,
3,600 seconds per trial (24 game hours), native 1/60 timestep. All six trials passed checks for
finite ecological transfer, body energy balance within 1e-6 kcal, no assistance and
sampled observation privacy. Initial physical hashes match within each start.
Only original-online versus corrected-online isolates the gate; the main
comparison also includes the earlier experimental model/history differences.

| Start | Arm | Absorbed kcal | Swallowed kcal | Spent kcal | Pieces detached | Arrivals | Final water deficit ml | Actual rest sec | Retained techniques |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| pond:north | baseline | 661.4 | 677.7 | 3896.3 | 25 | 137 | 89.0 | 375.1 | 11 |
| pond:north | selector-reference | 604.8 | 604.8 | 3440.9 | 16 | 52 | 809.4 | 0.0 | 6 |
| pond:north | selector | 0.0 | 0.0 | 3628.7 | 10 | 253 | 451.3 | 225.1 | 0 |
| lake:west:2 | baseline | 114.0 | 114.0 | 4010.6 | 8 | 111 | 762.0 | 525.1 | 3 |
| lake:west:2 | selector-reference | 143.2 | 184.5 | 3357.6 | 23 | 16 | 750.7 | 0.0 | 3 |
| lake:west:2 | selector | 142.5 | 142.5 | 3751.2 | 21 | 437 | 832.7 | 150.0 | 1 |

At the north pond, the corrected policy makes 253 successful arrivals versus 52
for the original online policy, yet absorbs 0 kcal versus 604.8 (main 661.4). It
physically detaches 10 pieces, nominates and completes one sample, then learns no
food technique. Nine detached pieces are released without sampling. 118 movement
vetoes comprise 115 inspections, one grasp and two releases; no sample nomination
is vetoed. Thus direct suppression of sampling by the movement comparison is not
the observed mechanism. The trace supports lost multi-step continuation; it does
not record every eligible alternative or establish that sampling was legal at
every release. The remaining cost ranker often chooses brief release operations.

At the lakeshore, absorption is 142.5 kcal versus 143.2 for the original online
policy, while expenditure rises 3357.6→3751.2 kcal and arrivals 16→437. The gate
vetoes 148 sample nominations; 143 carry positive learned benefit from exact
prior water-relief feedback on the same two held pieces. This is hydration
evidence, not assumed nourishment or proof of safe consumption. The movement
threshold overrides that learned preference. All observed animal-strike chains
remain right-censored in every arm: no target-stopping sequence completes.
The raw evaluator field `completedWorkAttempts` is a mislabeled recorded-result
count that includes zero-work refusals. Compact evidence separates
`recordedStrikeAttempts` from `positiveDurationStrikeAttempts`; raw data stays frozen.

More movement and lower inspection count do not count as better learning. Health
can remain high for one day while substantial stored reserves decline. No arm
establishes sustained self-feeding, migration, open-ended skill learning or society.
Technique counts are retained exact-source two-step records, not learned general
programs. Observed animal-strike chains and any right-censored completion times
are reported explicitly; absent chains do not demonstrate preserved hunting or
slow-prerequisite learning. The gate can still delay familiar useful nominees,
and its one-in-eight exploration schedule guarantees nominations, not execution.

## Verification and provenance

- 441/441 tests, build, actual Linux Electron smoke and two-process disk reopen pass.
- 26 pure gate/diagnostic tests plus five real-controller/save tests cover action
 identity, strict ties/order, saved RNG/phase, copied traces, completed work,
 rejected/canceled outcomes and throwing diagnostic sinks. Sink failure disables
 the observer out of band; evaluation rejects incomplete traces without interrupting
 physiology/collapse. No diagnostic record enters actor memory or observations.
- Default play matches merged main for 900 seconds with two actors, an actual save/load
 at 450 seconds, 531 actions and 104 feedback events. 108,000 physical/RNG actor-frame
 comparisons, 1,800 full physiology comparisons, 1,221 retention comparisons and
 eight full normalized world checkpoints pass. Only the preceding additive effort
 fields are normalized. This is a measured valid-save case, not exhaustive proof.
- Native smoke and reopen share build fingerprint
 `ed998b8a3bd3e61e7b146aece3ef6ee3cc397ace924b32d53314cfff03f90d65`.

Main source is merged 3db83047c96158b39214b3f5a68ed5929ad1f40d. The reference
worktree reports pre-merge c2908ea, whose runtime/package bytes are identical to
that main commit. Original online source is exact research
aceae25296ec9fdd807a0b17862e6678c14c8f96. Candidate was measured as an uncommitted patch on that research base; its full
source-file hashes identify the tested bytes. Candidate source hashes, evaluator hash,
per-trial metrics, source maps and raw-report fingerprints are in the compact
[evidence summary](selection-gate/evidence-summary.json) and
[verification summary](selection-gate/verification-summary.json). Full traces,
replay scripts and logs are retained in the fingerprinted
[evidence export](selection-gate/evidence-export.json), not embedded in Git.

Cloud wall time and sampled process RSS are diagnostic measurements under shared
load. These are not 32 GB-laptop, Windows installation, Ollama or long-run ecology
benchmarks. Fresh seeds 104729, 130363, 15485863 and 32452843 remain unused by this
experiment. No runtime changes are planned from these results without a separate
architecture design and causal evaluation.
