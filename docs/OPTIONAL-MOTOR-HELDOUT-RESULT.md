# Optional motor held-out engineering result

The fixed plan in [OPTIONAL-MOTOR-HELDOUT-PLAN.md](OPTIONAL-MOTOR-HELDOUT-PLAN.md)
was committed at `f5b95f5692f177465ecf49bb156d8f9218c5cf90` before paid evaluation;
its independent random seed was fixed in `42e07920c74d41755f07347eb69c1268b86c2b97`
before those actions. This is a CPU-only test of real paid operations in an
authored legacy discovery scene. It does not run in the main Ozark population.

## Prediction

Both declared seeds (51001 and 51002) admitted the first bramble (`object:2`)
and a distant, previously unseen apple tree (`object:18`), 5,773.225 units
apart. Each fresh actor privately trained on its own four completed bramble
actions: grasp failed, pull succeeded, grasp failed, pull succeeded. Per actor,
that warm-up paid 14.9 seconds and metabolized 28.424 kcal, including 9.933
kcal in a same-duration idle control. The authored relocation between sources
was unpaid setup and is not included in those costs.

Before any apple action, the test froze each actor's model, frequency priors
and four feature vectors. Separate clones then paid for inspect, grasp, pull
and strike on that apple. All eight evaluation actions completed; there were
no admission or interruption censors. In each seed, the physical `ok` outcomes
were **1, 0, 1, 1** respectively. The model never trained on these outcomes.

| Frozen predictor | Brier, each seed (4 outcomes) | Log loss, each seed |
| --- | ---: | ---: |
| Numeric model | 0.243682 | 0.680509 |
| No update (0.5) | 0.250000 | 0.693147 |
| Pooled Laplace frequency | 0.250000 | 0.693147 |
| Per-primitive Laplace frequency | **0.156250** | **0.490415** |

The two seeds produced the same action pattern and map positions, so the eight
physical results are not eight independent task types or a population study.
The per-primitive prior again predicts these results better than the numeric
model. A fixed small SGD step remains near 0.5 after four examples; changing
its learning rate to fit this tiny authored result would be outcome tuning.
No learner setting or feature was changed.

## One-step choices and physical costs

Each choice branch started from the same frozen actor/world state within its
seed. The optional hook was reached with the same 17-item candidate list, and each
branch paid only for its selected action. The list still contained bramble
material held during warm-up; it was **not** restricted to the apple.

| Control | Selected action and target | Paid seconds | Total metabolized kcal | Excess over same-duration idle kcal | Physical change |
| --- | --- | ---: | ---: | ---: | --- |
| Current authored rule, seed 51001 | inspect held `object:853` | 1.8 | 1.680 | 0.480 | No plant quantity change |
| Current authored rule, seed 51002 | inspect apple `object:18` | 1.8 | 1.680 | 0.480 | No plant quantity change |
| Numeric model, both seeds | pull apple `object:18` | 4.786 | 10.857 | 7.657 | Plant quantity −1; held +1 |
| Frozen per-primitive frequency, both seeds | pull apple `object:18` | 4.786 | 10.857 | 7.657 | Plant quantity −1; held +1 |
| Cold/no-update fallback | Same exact authored action in each seed | 1.8 | 1.680 | 0.480 | No plant quantity change |
| Fixed first eligible object action | inspect held `object:852` | 1.8 | 1.680 | 0.480 | No plant quantity change |
| Independently seeded random object action | release held `object:853` | 1.2 | 1.120 | 0.320 | Held −1 |

All listed physical actions returned `ok`. Pulling took 14.765 ml of water
deficit during its action window versus 1.8 ml for inspecting; this is another
cost of the differing actions. Total kcal includes basal expenditure. The
same-duration idle difference is a closer measure of added work, not a claim
about long-term survival. Inspect, pull and release offer different information
and material consequences, so a raw `ok` or lower immediate cost does not
rank them by usefulness. None of the detached material was sampled here; no
food relief, transferable skill or learned word is established.

The authored rule favors an untried inspection through its novelty bonus. The
prototype maximizes predicted physical completion and has no cost or delayed
bodily-value objective. Its longer pull is therefore expected, but these two
one-step cases do not prove either policy is generally better. The original
seed 74193 case remains development evidence and was not used to choose or
replace these evaluation seeds.

The main agents still use the existing selector. A later policy trial would
need actor-owned one-use receipt authority, a prospectively defined own-outcome
objective, more independent contexts, and a separate safety review. No
ordinary or protected experiment, native app run, or remote publication was
performed for this result.
