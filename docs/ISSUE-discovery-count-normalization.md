# Deferred discovery count normalization

The proof-retention repair preserves learned effects and their exact sample,
action, and condition evidence. It does not make every live discovery aggregate
identical after save and reopen. The validator and proof/timestamp rules remain
unchanged.

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

These changes can affect future choices. Trial counts and duration feed discovery
scoring; technique successes and confidence can affect the
`failures <= successes + 2` eligibility gate. This is an unresolved, separate
behavioral continuity issue. The current repair neither changes those counts
nor claims universal decision or memory parity. A future fix needs its own
design and acceptance criteria under the existing history caps.
