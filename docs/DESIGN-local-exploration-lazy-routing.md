# Lazy shared route admission

Status: proposal for independent review before implementation. Preserve the reviewed eager shared-search candidate and its failed capacity-cost observation.

## Observed blocker

The original route admission design (SHA256 32433926a7a9ee1164c0f4438c21bcd6ff27fddb95c51f072ab8adc42369282d) fixes the demonstrated care regression and passes the new focused suites. Its full eager BFS is nevertheless a publication blocker: in the fixed 4,096-cell connected-grid Node fixture, 30 paired samples gave old/new upper medians 3.941/15.160 ms and p95 8.508/32.337 ms. The actual fresh-perception fixture gave p95 1.204/0.761 ms. These are isolated Node routeTarget costs, not renderer or laptop measurements. The grid is artificial capacity stress, not actual ecological terrain.

## Option A: one resumable shared search (recommended)

Keep precisely the eager candidate's endpoint eligibility and returned action. Sort local observed endpoints by existing goal distance first. Visit that order lazily, admitting an endpoint only after the same shared metrics prove its full nominal, step and body/sensed-speed route contract. Invalid endpoints do not consume the nearest-24 budget. Return the first admitted endpoint satisfying the existing progress condition. At most 24 fully admissible endpoints are considered, exactly as if the eager admissible list had been built first. Sorting/admission has no RNG or memory side effects, so evaluating only the required prefix does not change policy state.

The index is one ephemeral BFS cursor owned by this routeTarget call. It retains the same start selection, queue, next expansion position, predecessor/depth/two-length records, neighbor order and blocked-edge snapshot inputs. A query for an undiscovered walkable endpoint advances that same queue until the endpoint is discovered, the queue is exhausted, or the total 2,500 expansion budget is exhausted. It never restarts for another endpoint and never consults private terrain.

First discovery fixes a node's shortest-edge predecessor in this unchanged unweighted BFS. Stop only between complete node expansions: all four neighbors of the last expanded node are processed in their original order, so a later query can resume without skipping an unexpanded node or a neighbor. Already discovered endpoints need only constant-time shared metric checks. A nonwalkable/unobserved goal is refused without graph expansion. A discovered endpoint with excessive steps/length is refused; its retained BFS state may still answer later candidates. After budget exhaustion, every discovered frontier node remains eligible for the same metric checks as before, including a node enqueued by the final allowed expansion.

The public knownRoute call keeps its existing early-goal behavior and exact path result through the same start, node-expansion, metric and reconstruction helpers. It must not accidentally discard an unexpanded goal from a resumable queue. The new index is local-only and is never persisted or retained between decisions, state changes or ticks. Runtime metrics/route calls may advance this cursor, but never mutate the NPC, graph, blocked-edge evidence or RNG.

Bound per routeTarget: at most one start selection; 4,096 local remembered candidates and constant-time query admissions; 2,500 total node expansions/10,000 neighbor examinations across all queries; at most 4,096 discovered observed nodes; existing stable goal sort and at most 24 admitted candidate checks. Rejected candidates may number up to the remembered-cell cap, but cannot trigger independent repeated searches. No map cap, care mask, action budget or learning rule is reduced.

## Option B: independent first-choice fast path plus eager fallback

An original knownRoute call for the first ranked candidate would recover the fast success case. If it fails, a fresh eager shared search can repeat up to 2,500 expansions, yielding a 5,000-expansion bound. Splitting the original budget between two restarted searches can lose proofs and break the eager result contract. Reusing the first search's state to avoid either problem is option A. Therefore the independent fallback is not recommended under the agreed single-search work bound.

## Required evidence

1. Preserve current sources, all 46 focused tests, original four-gate failure and first paired timing report unchanged as earlier stages.
2. Differentially compare lazy index routes/metrics and final routeTarget actions against both the frozen original route oracle and the eager candidate across the same seeded/adversarial maps. Query order must not change results: include near-first/far-first/repeated/invalid/overlength targets and partial resume after first discovery.
3. Instrument graph accesses and cumulative search counters: early success must stop early; many failed queries must share the same 2,500 cap; no skipped neighbors, root/fallback changes, hidden-map access, repeated admission state or RNG effect.
4. Retain all original care crowding, slow-body, actual action, consumption and save/reopen tests. Add a connected invalid-first/valid-later lazy case if absent.
5. Repeat the unchanged two-input paired cost protocol once on the frozen lazy variant, with the same old baseline, sample counts and alternating order. Counter evidence must come from an untimed replay of the exact routeTarget selection using a captured index, with identical action/state asserted; merely constructing an unused lazy index reports zero work and is not valid evidence. Keep timed calls uninstrumented and disclose this separation. Keep original eager results prominent; any result remains descriptive. Parent/reviewer assess whether the material capacity regression is resolved before publication; no threshold tuning or success claim based only on theoretical bounds.
6. Full check/build and independent exact-source/claim review remain required. No native, autonomous, storage or schema expansion.
