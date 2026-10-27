# Model-proposed appearance names

Aster and Mira can ask an **already configured local model** to propose a short
word for something they have personally observed. A word is optional: the model
can abstain, and missing, failed or invalid model replies do not trigger a seeded
or pretend-model fallback. Offline physical learning and retained vocabulary keep
working. No model download is performed by this feature.

## What the model chooses—and what it does not

The narrow proposal request contains observed shape/color/texture cues, an exact
sampled example, observation times and the agent's relevant existing vocabulary.
The reply supplies only a bounded word or abstention. It cannot contain an action,
recipe, safety label, tool call or a world-state edit. Hidden engine species and
material names are not inputs. A pretrained model is not a blank-slate mind: its
associations are not evidence about this world.

The first-stage similarity rule is intentionally conservative and **supplied by
the simulator**: exact matching of the complete observed shape, color and texture
triple. The model chooses the vocabulary, not a learned biological taxonomy.
Repeated samples are time-separated observations, not proof of independent
encounters. Similar green tufts can share a tentative word instead of acquiring
unrelated individual names. A differently colored or shaped object is not silently
folded into that meaning.

## Personal meanings and changing evidence

A vocabulary belongs to one agent, not a global dictionary. Its original examples
and proposal provenance remain distinct from the current matching members. Changed
or incomplete observations suspend an individual's old membership. A newly
supported appearance can be considered separately; this is a revision or split of
an appearance grouping, not a discovery of a new species. Mere absence is not
disproof, and remembered examples do not restore live sight.

Nearby word-sharing uses a physically grounded example. The listener resolves the
point using its own local perception and retains its own example and the speaker's
identity. It does not receive the speaker's complete category extension. Different
speakers can use different words or give a word different meanings. More than one
matching visible individual requires disambiguation; a category word alone is not
an exact target.

## Names, notes and exact identity

The selected-agent panel distinguishes model proposals, attributed heard words,
current ordinary samples, remembered members and old individual names. New ordinary
experience descriptions and field notes use an available unambiguous name while
retaining the exact object ID. Stored historical text is not rewritten to pretend
the name existed earlier. Secondary annotations are explicitly **current labels**.
Canonical procedure and adverse-material receipts keep their strict exact-ID text;
the panel can show a current name underneath without changing those receipts.

Food benefit, bodily discomfort, procedures and safety remain attached to their
originally sampled or tested **exact instances**. No category-wide food or safety
belief follows from a name, a lookalike, a model association or a peer's word.
Detached pieces, replacement objects and other new identities do not inherit
physical experience from a source's label. Human action-hint grammar is unchanged.

## Local requests and persistence

Requests use the existing bounded loopback-only model service and its shared budget,
queue, timeout and cancellation controls. They do not block physical action. Late
replies after a provider switch, cancellation, actor reset or disposal are excluded.
Repeated requests are bounded rather than issued on every perception tick.

New optional lexical data is bounded and strictly validated. Existing valid current
schema-12 saves and legacy individual bindings are preserved without destructive
migration. Pending model requests and live pointing exchanges are not restored as
running authority. Corrupt current saves remain protected rather than silently
normalized. Save validation is not cryptographic proof that hand-edited historical
evidence really occurred.

## Verification scope

Mechanism tests must distinguish deterministic mocked proposals from a real local
model run. A mocked word demonstrates admission, reuse and provenance behavior; it
does not establish model quality, autonomous frequency or spontaneous shared
language. An unavailable local model is reported as not run, never disguised as a
successful model response. UI rendering checks are separate from supported native
close/reopen and screenshot evidence. Long-term concept formation, biological
classification and improved autonomous survival are not claimed.

Proposal memory retains at most 64 distinct cue triples, with at most 24 own words
and 48 grounded heard meanings. Unadopted proposals can retry after a persisted
five-simulated-minute cooldown, subject to the controller's one-minute spacing and
the shared local service budget. Accepted matching categories never request new
synonyms. Temporary service failure or abstention does not permanently mark a cue
triple as unnameable. Full bounded memory admits no new cue triples.

## Developer verification

- `npm run check` includes state, strict-save, grounded-transport, model-bridge,
  stale-response, reset, journal-label and UI projection checks.
- `node scripts/verify-category-names-desktop.mjs --prepare-only` validates the
  serialized native harness only. It does **not** start Electron or capture UI.
- `node scripts/verify-category-names-desktop.mjs` needs a supported sandboxed
  desktop session. It uses fresh disposable profiles and three independent
  Electron processes for UI/selection and save/close/reopen evidence. Its model
  responses are deliberately mocked, never reported as live Ollama inference.
- The dedicated Linux/macOS category-names native workflow runs focused reset and
  stale-model checks before that native harness and preserves source identity,
  screenshots and process evidence. Existing world-reset native acceptance stays
  separate. A prepared workflow is not evidence that CI or native QA has run.

A real configured local-model quality/latency trial remains a separate check.
Neither mocked tests nor source review establishes spontaneous naming frequency,
long-term shared language, or better autonomous survival.
