# Current-world peer-teaching UI fixture

Use `scripts/peer-teaching-ui-fixture.mjs` from the existing native harness.
It adds no native process harness and is not shipped as a runtime module.
Both exports are self-contained and can be serialized with `toString()`.

1. Start a separate **empty disposable profile** on the current `?test=1`
   route. Wait for `window.__ozarkWorld`; do not call `start()`.
2. Evaluate the serialized `createPeerTeachingUiFixture` function with
   `document.baseURI` as its argument. The returned `{saveKey, raw, summary}`
   uses the actual current schema and strict save validator. Assert the key is
   `aincrad.world.v2`, version is 12, and the isolated slot is still empty.
3. Store `raw` under `saveKey` in that profile, flush storage through the
   existing native harness, and reload the same `?test=1` route. Wait for the
   current hook again. This is a fixture install, not an ordinary save write.
4. Evaluate the serialized `presentPeerTeachingUi` function with
   `('conversation', summary)`. It opens `#npc-panel` via `#open-npc`, selects
   Mira through `#npc-select` and its change event, then clicks
   `#npc-tab-conversation`. It asserts the exact message body and
   `#journal-messages .journal-entry[data-sender="aster"] .message-meta`:
   `Aster → Mira · nearby · taught procedure`. Capture the actual native
   window after one rendered frame, e.g. `05-peer-teaching-journal.png`.
5. Evaluate `presentPeerTeachingUi('knowledge', summary)`. It clicks
   `#npc-tab-character`, opens `#npc-discovery-details`, and scrolls the exact
   report in `#npc-object-knowledge .knowledge-entry` into view. Assertions
   require `Taught by Aster`, `Pull → Sample`, `taught procedure; not yet tried`,
   and `Advice does not grant proficiency.` in its `.provenance`. Capture
   `06-mira-taught-knowledge.png` after one rendered frame.
6. Save the returned DOM evidence and the fixture `summary` beside the
   screenshots. The existing harness owns real window closure and profile
   archival. No build artifacts or full generated save belong in Git.

The helper also checks exact restored time and a still-naive recipient:
unverified report, cursor zero, no evidence, no own effects or techniques.
Simulation is intentionally not started while screenshots are taken, so no
automatic attempt can race the inspection. The ordinary journal UI renders
before start on this explicit test route; no DOM text is injected or replaced.

The fixture explicitly places the two agents near one real finite source.
Aster then pays for pull and sample, waits for genuine delayed feedback, and
speaks through automatic dialogue and the actual controller. Mira observes
the source herself and receives only attributed advice. This demonstrates the
teaching presentation and save contract, not autonomous encounter frequency,
travel, survival, general species knowledge, or a complete hunting recipe.
