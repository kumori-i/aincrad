# Proposed experiment: experience-weighted exploration

Status: reviewed research candidate, disabled by default. The completed frozen comparison rejects promotion: see [negative result and measurements](TESTING-experienced-selection.md). Passing correctness tests does not authorize promoting or merging an ineffective policy. Baseline is merged PR #4, main `3db83047c96158b39214b3f5a68ed5929ad1f40d`. The target is useful learned action selection, not a lower strike count by itself.

## Motivation and observability

Current generic exploration scores `8 / (1 + attempts) - 3 * failures` plus noise. An accepted no-change strike is not a failure, so success counts cannot substitute for useful consequences. Existing `trials.seconds` is successful practice duration, not total experienced work; preserve that meaning and measure all actual completed/partially completed durations separately.

A physical same-source probe finds inspect/grasp/pull/strike durations of 1.8/2.5/5/4 seconds with diagnostic expenditure about 1.68/3/11.33/12.05 kcal, while all existing qualitative body labels remain unchanged. The kcal values are evaluator-only. Existing body transitions are too coarse for these short operations and can mix digestion, weather and contact. The legacy learned-value/risk path reads exact reserves and must not supply this selector.

Add an engine-owned **action-local qualitative exertion outcome**, based only on work actually performed through the existing physical exertion calls. Accumulate work during real execution; emit an allowlisted label at completion/cancellation. Do not predict a cost from the operation name or reveal effort tables, calories, reserve fractions or hidden resource state. Instant rejected requests have zero performed work. This instruments an existing physical consequence without changing its cost. Initial implementation must test equal operation names with different actual work and equal work across different names.

## Small inspectable model

Keep the existing safety gates, goal priorities, personally earned sequences, pending-food cautions and contact/water/refuge care. Replace only ranking among eligible object/primitive experiments after the existing chooser selects an object-experiment opportunity. Preserve the existing movement-versus-object opportunity comparison; do not compare the new normalized scores against old frontier scores. The pure ranking model takes only allowlisted worked-action records, exact observed consequences, eligible commands and qualitative need/context labels. The integration reads discovery memory, never raw ecology, exact physiology or legacy risk scores.

Store bounded numeric data in an optional additive `discovery.selection` block with its own schema marker; keep the enclosing discovery/save versions compatible. First increment:

- `cost[operation, felt-fatigue-band]`: count, observed-duration sum/squared sum, and qualitative-exertion category counts; back off to the same operation's experienced aggregate when context is sparse. All physically worked failures/cancellations count. Zero-work refusals remain failure evidence, not fabricated costs.
- Derived exact-target rows: observed attempts and linked food/water/harm counts from existing experiments/effects. No species or material kind keys; no additional saved outcome means.
- Exact-target benefit/adverse estimates remain tied to the existing verified acquisition/ingestion evidence. Sensory-feature benefit transfer is deferred to a separate ablation, not silently included in the first selector. Operation-level experienced motor cost is the first transferable skill.
- A bounded recent evidence window retains action ID, observed context, actual duration and qualitative exertion. Recompute cost estimates from matching retained authoritative action records on save validation; never trust arbitrary finite saved value means. Derive bodily benefit from unique existing validated ingestion effects and exact acquisition links. Missing old-save effort evidence starts unknown, without resetting bodies or existing knowledge.

Initial caps: 24 contextual cost rows and 96 recent worked-action records; exact-target outcome/benefit estimates reuse the existing bounded experiment/effect tables rather than creating an unbounded parallel learner. Bounded deterministic eviction, finite-number validation, label allowlists, version checks, duplicate suppression and idempotent reopen are required. Saved learned estimates are data, not executable routines or permission to eat; restoration must reproduce them from verified recent evidence. A rolling window also adapts to practice-dependent duration, rather than retaining a stale lifetime cost forever. Food safety/technique permission continues to require the existing provenance checks.

## Credit and observable outcome semantics

Do not reward `ok`, a printed result code, making a new opaque ID, or arbitrary post-action comfort.

- Accepted result codes and new possession alone have no utility. This first increment uses attempt counts for uncertainty; richer sensory-transition prediction is deferred. Repeated inspection or release/regrasp cannot earn benefit merely because the command succeeds.
- Food/water benefit and discomfort come only from an existing validated sample action ID + ingestion ID + target ID and matching experienced delayed feedback. Apply benefit once per ingestion/channel. An acquisition receives capped prerequisite credit only through that exact executed acquisition-to-sample chain. Later nourishment never erases harmful evidence.
- Keep nourishing and harmful outcomes as separate dimensions. Generalized estimates may rank a cautious experiment, never promote a new piece to safe/supported consumption or bypass its pending interval.
- Do not credit unrelated actions performed while old food digests, passive store mobilization, favorable weather or a third party's outcome.

## Initial ranking and exploration budget

Use an explicit small optimistic outcome model rather than raw surprise as reward. For the first increment, outcome/benefit counts stay exact-target. Experienced operation cost transfers broadly through the same body and felt-fatigue context. A later separately enabled feature prior may contribute at most two effective observations, but is not required for this implementation.

Proposed engineering baseline (constants frozen before held-out runs):

- `n`: exact-target physically observed attempts; new opaque IDs start without an outcome estimate.
- `u = min(1, sqrt(2 * log(2 + total_choices) / (1 + n)))`: capped epistemic allowance, not a claim of a valid confidence interval in this changing world.
- `benefit = food_need * p_food + water_need * p_water - 2 * p_harm`, where need is 0 while the corresponding qualitative sensation is content/quenched and 1 otherwise. Probabilities are empirical estimates from validated exact-target consequences. No benefit is initialized from object appearance.
- `cost = 1 + learned_duration / max(1 second, median_observed_duration) + learned_exertion_rank / 3`. Unknown costs share the same neutral prior; there is no per-operation initial cost table. Sparse estimates are explicitly marked uncertain rather than treated as exact.
- `score = (benefit + 0.5 * u) / cost` for ordinary generic-choice opportunities. Observed attempts reduce uncertainty; command success alone earns no utility.
- Reserve **one in eight generic-choice opportunities** for exploratory selection across eligible operation groups, then under-tested exact targets, with deterministic seeded tie-breaking. This allowance persists after initially disappointing trials so delayed-payoff operations are not permanently excluded. It preserves existing direct-sample aversion, bodily capacity, failure cooldowns and action legality. Generic acquisition of a previously harmful source remains a possible cautious experiment under existing rules; this patch does not impose a new source-wide ban. Learned care and urgent safety are outside this generic-choice budget.

These are supplied optimization choices, not proven human motivation. Prefer this bounded, shrinking epistemic allowance to rewarding raw prediction error: irreducibly noisy outcomes should not remain attractive forever. A rolling learning-progress term is deferred until it can be shown to distinguish genuine improvement from noisy change. The existing movement-versus-object opportunity choice stays intact. Once it selects an object experiment, this model chooses among the already eligible object/primitive candidates. This avoids silently placing new score units against the old frontier score or rewarding movement itself; the interaction still needs remote-source coverage tests.

## Causal experiment and stop criteria

First run physical direct cases: identical cues with different experienced duration/effort; name-swapped effort; costly failed work; no-change accepted strikes; repeat inspections; release/regrasp; delayed nourishing/harmful feedback; noise/distractor; depletion; interrupted and reopened learning. A useful delayed-payoff action must retain exploration opportunities. Demonstrate changed ranking follows actual observed outcomes, including a reversal where striking really helps, not its name.

Then matched ordinary cohorts compare (1) merged baseline, (2) learned selector, (3) empty/frozen selector with identical sensing and gates, and (4) shuffled learned cost/outcome estimates with matched counts. Separate warm frozen transfer from a cold zero-learning control. Keep the existing positive-food-association control distinct. Transfer tests first use new opaque IDs to test experienced operation-cost transfer without transferred food beliefs. Held-out appearances and misleading lookalikes remain negative controls: they must not acquire positive food values or safe-consumption permission. A feature-benefit transfer arm requires a separate explicitly reviewed extension.

Predeclare development/held-out scenarios and constants before measuring final results. Measure swallowed/pending/absorbed energy, realized expenditure, condition, rest, acquisition/benefit latency, finite-stock transfer, meaningful information gained, action time and actual effort. Fewer strikes, more actions, lower cost or a higher reward surrogate alone do not pass. Require causal improvement in useful acquisition/condition without material harm or loss of delayed-payoff exploration; otherwise keep the selector experimental and report the negative result. Survival, seven-day balance and broad relocation remain separate gates.

All training is online local numeric updates, CPU-only, bounded memory and saved checkpoints; optional Ollama remains language-only. Review migration, conservation, privacy, ablations and final evidence independently before a feature PR/CI/authorized merge.

## Research inspiration, not a transferred guarantee

[Keramati and Gutkin (2014)](https://elifesciences.org/articles/04811) motivate linking learned value to experienced physiological consequences. Their formal homeostatic assumptions are not established by this coarse partial-observation game. [Oudeyer, Kaplan and Hafner (2007)](https://www.pyoudeyer.com/ims.pdf) motivate learning progress rather than undirected novelty; this proposal initially uses a bounded uncertainty budget and does not implement their architecture. No external code is copied.

## Implementation details frozen before evaluation

The six primitive operations share three engineered exertion thresholds on accumulated actual motor effort: at most 2 weighted seconds is light, at most 6 moderate, otherwise strenuous. These are coarse proprioceptive design choices, not measured human perception. A missing/invalid old label remains unknown. Context-specific means require four worked observations; otherwise the same operation aggregate is used. The 96-record window implies at most 24 context rows plus six operation aggregates.

The saved model also carries bounded choice count, an independent modulo-eight phase and a separate uint32 selector RNG; integer zero is valid. Two selector draws are consumed per generic opportunity. Navigation/legacy RNG is untouched by ranking. The default baseline does not collect selector records or add their protection to history. Learned mode collects them; cold/frozen/shuffled modes retain ordinary sensing and safety memory but do not update the selector estimates. A frozen control snapshots both costs and exact-target outcome counts; shuffled is the same warm frozen control with a fixed cyclic permutation of operation channels, never changed physical events or saved evidence. The one-in-eight phase continues after the total counter saturates.

Exact acquisition credit is a separate prerequisite association, capped once per acquisition and consequence channel even when a piece supplies many portions. It is never added to an overall reward total. No neural weights are trained. The score, need weights, category boundaries, context threshold and exploration schedule are engineered choices; the duration, exertion and consequence counts are learned from performed experience.

The first increment does not infer the utility of an arbitrary long action sequence such as striking an animal repeatedly, then acquiring a separate carcass. Only the already verified direct acquisition-to-sample link receives prerequisite association. Persistent exploration gives such operations opportunities, but is not evidence that this model learns hunting or every delayed-payoff task.

## Predeclared final scenario set

Without tuning the score after the development pilot, the final comparison uses 24 game hours (3,600 simulated real seconds at 1/60) for development seed 74193 and selector-held-out seed 773377, each at pond:north and lake:west:2. All four starts run merged baseline, online selector, cold fixed-estimate selector, and the two six-hour-warm frozen/shuffled controls. The last two controls must match the online selector's first-six-hour action hash. These seeds belong to the existing fixed valley; this is not held-out terrain generation. A successful single north-pond pilot is insufficient to enable the selector in default play.
