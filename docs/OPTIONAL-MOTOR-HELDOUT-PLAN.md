# Optional motor held-out engineering evaluation plan

This plan was committed before executing the paid evaluation actions below.
It follows the negative seed 74193 development fixture without changing its
model or using its apple outcomes to choose evaluation cases. The main world
does not import the prototype. This is a controlled CPU-only engineering
comparison, not an ordinary simulation or a protected experiment.

## Fixed split and actions

- Evaluation seeds: **51001 and 51002**, each with a separate fresh discovery
  actor and private zero-initialized model. Never copy weights between actors.
- In each seed, select the lowest-ID bramble for warm-up. Select the lowest-ID
  apple tree whose original position is more than 800 units from that bramble
  for evaluation. Selection uses only original geography and kind in the test
  fixture; those kinds are never learner features or labels. If a source is
  absent or unreachable, record an unavailable case and do not replace it.
- For both sources try vantage offsets in this exact order: (-45,0), (45,0),
  (0,-45), (0,45), (-60,0), (60,0). The first standable, line-of-sight point
  within interaction reach is used. Repositioning the actor between regions
  is authored and unpaid; report it as setup, not learned navigation.
- Warm-up on the bramble: grasp, pull, grasp, pull, in that order, with actual
  paid work. Train once on each matching completed own action receipt. Admit
  refusals and interruptions as censored rather than negative labels.
- At the distant apple, freeze the model and the pooled and per-primitive
  Laplace(1,1) frequency priors. Assert it has no previous action trials,
  effect or technique. Freeze the numeric vectors and probabilities for
  inspect_object, grasp, pull and strike **before** any apple action. Evaluate
  each action from a separate exact clone of that pre-action actor and world,
  physically paying the action. There is no fit on evaluation outcomes.

## Measures and controls

Report every case, including censored admissions and partial work. Score only
fully paid and matched action outcomes with Brier and log loss, pooled and by
primitive: model, frozen 0.5 no-update, frozen pooled frequency, and frozen
per-primitive frequency. Small denominators are explicit. Do not optimize the
learning rate or feature set after reading these outcomes.

At the same pre-action apple boundary, clone the actor and world for a separate
one-step choice comparison. Compare the existing authored rule, the numeric
ranker, cold/no-update abstention, frozen per-primitive frequency ranking,
fixed first eligible object action, and a deterministic independently seeded
uniform eligible-object-action control. Each pays its own chosen action once.
Report action, admission/censor, physical result, paid seconds, total
metabolized kcal, same-duration idle-control kcal, excess over idle, water
deficit and physical stock/held changes. Warm-up time and energy are reported
separately and never hidden from the prototype's acquisition cost. The
policies can choose different operations with different information/material
effects; raw success or kcal alone is not a common survival utility.

No favorable seed/source retry, resource injection, hidden edibility label,
observer score, copied actor knowledge, protected cohort or production policy
change is allowed. The model has no pixels, so this evaluates only bounded
primitive-level motor prediction across two authored same-map regions, not
visual word or food transfer. A later reversal and durable retention study
would need a separate plan and actor-owned runtime authority.
