# Verification boundary

The v2 experiment is separate from the runtime. V1 source, protocol and results
remain unchanged, including its failed seed. Its source hash remains
`512c42db77c823af881c0bd2bf360f3e94b412b7587ffdd9fd7068873c4dc4c5`.

## Before behavioral training

- Independent protocol and implementation review found no blocker.
- The combined lab suite passed 37 tests: 20 v1 and 17 v2.
- V2 tests include exhaustive rectangle factor multiplicities and the analytical
  50% single-factor ceiling; uniform target sampling; independent views; RNG
  replay; distinct masks; separate parameters and matched control initialization;
  gradients to both encoders; candidate permutation equivariance; frozen metric
  reconciliation; configuration bounds; selection rules; tiny temporary full
  artifact-pipeline fixtures; incomplete pilot rejection; and runtime isolation.
- An independent geometry probe found no cross-shape mask aliases over 32,400
  samples per shape spanning the new radius/translation ranges. The actual
  renderer matched the probed formulas at 968 parameter combinations.
- An independent optimized-versus-direct receiver check agreed on 1,088 decisions
  across all 64 messages. These structural tests used unrelated audit streams,
  not reserved final evaluation streams or behavioral model selection.
- Source and protocol were frozen before pilots. The one prospective resource
  adjustment used throughput only, as recorded in [PROTOCOL.md](PROTOCOL.md).

This file describes test coverage, not a guarantee of learned language or
successful replication. Research outcomes are reported separately with every
attempt and seed. Temporary engineering test fixtures never count as research
runs. Final repository and native release checks are recorded at publication.
