# Discovery count normalization at proof retirement

The original proof-retention repair preserved learned effects and their exact
sample, action, and condition evidence. It left some live aggregates above what
the save validator could reconstruct after old evidence retired. The historical
diagnosis below remains an observation of that earlier source, not a current
outcome claim.

In the copied `000045` historical world, after 3,600 fixed steps (60 simulated
seconds), Mira's `object:2765|sample` trial changes from 3 attempts / 3 successes
to 1 / 1 on save, and `object:2763|sample` changes from 3 / 3 to 2 / 2. Their
accumulated seconds change from 5.775 to 1.9250000000000003 and
3.8500000000000005 respectively. Both observations have rotated out, so the
existing validator reconstructs those optional trials from retained experiments.
Mira's eighth technique changes from 11 live successes to 8 retained-witness
successes. The copied-world diagnosis is preserved in
`test-results/diagnosis/000045-marked-sixty-second-normalization.json`
(SHA-256 `aee10020a0f7131839de8e072caf83f0ca664dd5e64ddf969f49daf6015399cd`);
that ignored diagnostic file must accompany any distribution of this note. The
earlier red 900-second probe remains in the test source, outside the scoped
3,600-step acceptance.

The current repair reconciles the live actor at the same bounded proof-retirement
commit. A technique counts only distinct retained acquisition, sample and
sustained-effect chains; its `revised` adverse status remains sticky. An optional
trial without retained sight is rebuilt from its retained paid action receipts,
or removed if none survive. Missing keys backed by retained receipts are
reconstructed. At most 768 trial keys remain; only optional observed summaries
can lose a slot to proof-backed keys. Practice is derived from the resulting
trial ledger. The save validator uses the same bounded proof and trial reduction.

For supported live actors within the existing caps, a later reopen does not
silently change these proof-derived counts or the confidence gate. Retirement
itself can lower a count and alter future choices, because the older physical
proof is no longer stored. Cumulative lifetime success is not promised.
The current-save regression uses Map-backed storage through the production
serializer and validator. It does not establish native disk close/reopen.
Existing observed-object trial summaries and technique failure summaries remain
historical aggregates subject to the save validator's limits, not newly
authenticated evidence. No word meanings, food identities, nutrients, or
safety labels are inferred.
