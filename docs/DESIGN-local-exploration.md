# Locally grounded exploration: bounded route admission

Status: parent approved this bounded shared-search scope expansion on 2026-10-16; exact design review remains required before implementation. The four-gate deletion is held locally and is not publishable after its urgent-water regression. No route-index implementation has begun.

## Intended change and limits

Remove the four discovery-policy tests that use the first observed position as a 4,200-unit travel boundary: route endpoint exclusion, generic object exclusion, forced return, and frontier exclusion. Preserve saved home/start fields for compatibility. Actions still depend on observed scene-specific terrain, current or retained perception, physiological constraints, finite inventories, actual work, failures and sensory feedback. This removes an artificial eligibility limit; it does not establish autonomous whole-map exploration or survival.

The unchanged nearest-24 endpoint budget exposed a regression. A controlled actor with desperate thirst has a real remembered river and a connected 80-unit approach. Adding 24 actually observed, walkable but disconnected retained cells outside the old disk puts those cells first by goal distance. Old policy chooses the water approach; the deletion-only candidate waits. The retained subset is an explicit memory-selection fixture, not a naturally generated travel history. Preserve that failing candidate and repro.

## Two bounded corrections considered

### A. Full observed-route admission (recommended)

Before the nearest-24 ranking, compute one bounded breadth-first predecessor tree using only the current scene's remembered walkable cells and remembered failed edges. Use exactly the existing knownRoute start/anchor fallback, edge expiry, four-neighbor order, and 2,500-node expansion limit. Admission means that the endpoint is discovered in that bounded tree, including nodes enqueued by the last permitted expansion, matching current knownRoute behavior.

Filter endpoints by the complete existing route contract before ranking: bounded-tree discovery, at most 30 edges, nominal action-distance limit, and strictly less than the current-body/learned-speed 11-second length. Retain the 45–900-unit local candidate distance, goal-distance sort, 20-unit progress condition and nearest-24 limit. Mere connectivity is insufficient: 24 connected but over-length endpoints must not crowd out a useful care route. Physical request and completion validation remain authoritative.

The tree records each node’s predecessor, depth and two cumulative lengths in the same left-to-right arithmetic order as the existing route reductions. The nominal limit includes actor→start-center and the exact final cell→target segment. The stricter sensed-speed length describes the returned route: when actor→start-center is at most 6 units, that center is removed, so the first remaining segment is actor→first returned node instead. A root-only target then uses actor→exact target. Both lengths include the exact final target, with no hopCount×tileSize approximation. Shared metric/reconstruction helpers serve both the existing knownRoute API and indexed admission; differential tests must establish exact old output and threshold behavior before any candidate test is accepted.

Expose a small navigation helper that supplies this tree's membership and route reconstruction. Factor the common start/search/metric/reconstruction logic needed to prevent semantic drift. Existing knownRoute keeps its early-goal search and public return contract; exact-route oracle tests compare the refactored API and indexed paths against the frozen pre-change function for all test targets. No graph or path is saved, and no cached tree survives a routeTarget call. Each call reads its current state synchronously, without changing RNG, memory or failed-edge evidence.

Computational bound per routeTarget call:

- At most the existing 4,096 remembered cells are considered; no terrain/world query is added.
- At most 2,500 dequeued nodes and 10,000 neighbor examinations in one BFS, with at most 4,096 distinct queued remembered nodes.
- At most 4,096 constant-time endpoint admissibility checks using retained per-node metrics, then the existing bounded sort and nearest-24 selection. Reconstruct at most 24 paths of at most 30 edges if required by the caller; discovery selection itself only returns the chosen endpoint.
- No repeated BFS per endpoint. This replaces the previous worst case of 24 searches of up to 2,500 nodes. A first-choice success may now scan more nodes than its old early-stopping search, so no universal latency improvement is claimed. Record bounded work counts and a small deterministic timing comparison, without a laptop responsiveness claim.
- The number of routeTarget calls made by care, contact, object and frontier logic is unchanged. No second fallback scan, extra candidate budget, or unbounded retry.

Tradeoffs: this admits only connectivity proved within the existing search budget, not all physically reachable places. Unknown/disconnected/search-censored cells do not become negative memories. Disconnected, over-step, over-length and body-ineligible endpoints are excluded before the nearest-24 list. This does not change which water source, refuge, learned technique or escape goal the surrounding policy considers. Where old radial gates were nonbinding and an old route was actually found, the same ordered first passing route must remain identical. A previously exhausted nearest-24 list, including inside the old home disk, can now expose a valid later endpoint; that is an explicit additional eligibility change, not global baseline parity.

### B. Preserve a baseline care candidate as fallback (not recommended)

Retain the old home-filtered care candidate if unrestricted selection fails. Keeping both legacy per-endpoint search loops complete costs up to 48 endpoint searches instead of 24. Splitting the existing 24 attempts between old/new pools cannot guarantee retention of a baseline route that was the old 24th candidate. Computing a legacy fallback cheaply requires the same shared route tree as option A while preserving home-dependent selection. It also needs a definition of which care branches receive the fallback. These are larger or less coherent changes than filtering known disconnected endpoints before the existing ranking.

## Required tests before a frozen candidate

1. Preserve the deletion-only urgent-water failure; candidate A must restore the exact connected water action without using unobserved terrain. Check the 24 disconnected cells, connected-but-over-length/body-ineligible crowding, a connected valid control, empty-map refusal and search-budget exhaustion.
2. Navigation oracle: same start/anchor fallback, blocked self entry and edges, expired blocks, neighbor ties, disconnected components, 2,500-expansion frontier, 30-edge and nominal distance boundaries. Refactored and indexed routes must exactly equal the frozen old knownRoute output for seeded randomized and adversarial maps, including root distance just below/at/above 6, off-center targets and exact-length boundaries. Legacy/cave callers retain their route API semantics.
3. Identical state/RNG with only saved home varied yields identical new decisions and preserves home. Old successful decisions/RNG remain identical in fixtures where removed radial constraints and new connectivity admission do not alter eligibility. Explicitly retain a baseline nearest-24 exhaustion case as an intentional difference.
4. Real observe → decide → cognitive validation → request → completed outward move with elapsed time/effort; a real visible remote ecology object. Preserve blocked, unobserved, wrong-scene, too-long, slow-body and learned-travel-cost refusals.
5. Preserve contact/water/refuge/learned-food care ordering, fullness, actual stomach refusal, pending feedback, exact-item discomfort and foodLearning:false behavior.
6. Fresh state and actual JSON save/reopen retain next decision/RNG and finite stocks. No new saved fields, reset, resource allocation or biology changes.
7. Full check/build, independent exact-source/evidence review, then separate publication approval. Native rendering/timing remains unqualified.
