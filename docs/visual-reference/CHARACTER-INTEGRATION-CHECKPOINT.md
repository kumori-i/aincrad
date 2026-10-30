# Main-world character-message integration checkpoint

This is a **local, unpublished engineering checkpoint** for the same Ozark
survival world. The unintegrated numeric starting point is recorded in
[the core checkpoint](CHARACTER-CORE-CHECKPOINT.md). The main world now samples
actual one-to-six-letter `a`–`z` messages from each sender's own current crop
and shows those exact strings and paid recipient actions in Conversation. No
English meanings, grammar, word dictionary, pretrained weights, lab checkpoint
or other agent's crop are supplied to a policy. Ordinary autonomous language,
stable vocabulary, composition, generalization and survival improvement remain
unestablished. There has been no new ordinary cohort or resource injection.

## Physical and numeric authority

`ozark-world-main.js` installs the `sequence` protocol in its existing optional
channel. Explicit historical fixtures retain the `legacy` protocol and its
old integer-symbol associations. The sequence protocol preserves
target-independent geometric pair selection, mutual visibility,
own-view distinguishability, the original inspection and indication paid
actions, the optional post-correction reply, the 12-second deadline and urgent
survival priority. It removes legacy anchor-capacity and assigned-symbol pair
admission. This changes opportunity counts relative to earlier ordinary
symbol runs, so those rates are not directly comparable. Reverse reply sight
is checked after the listener's completed demonstration; failure preserves
that earned listener update.

Each individual owns a separate 1,931-parameter sender, baseline, revision and
sample RNG. Each listener owns a separate 1,472-parameter model, choice/replay
RNG, counters and at most 128 completed examples for the current partner
incarnation. Random weights begin without a word mapping. Before its first
valid own-view label, the listener chooses with exact `[0.5, 0.5]` probability.
The sender's sampled trajectory stays behind a private, opaque, one-use handle
bound to that owner, actual partner token and parameter revision. It freezes
sender updates until authentic reply settlement or cancellation. The sequence
path never accepts the old `(symbol, signal, features, time)` feedback tuple.
The runtime consumes authority on success, rejection, timeout, urgency,
collapse, identity replacement, disposal and reopen. A copy, stale handle,
reused string or observer ID cannot settle it.

Listener training occurs only at the consumed-once canonical post-choice
demonstration boundary. It uses the original heard sequence, retained two
listener-local candidate feature vectors and final listener-local demonstrated
crop. A label requires exactly one candidate RMS `<= 0.04` and a runner gap
**strictly greater** than `0.02`. Ambiguous sight provides no label or gradient.
One valid physical example plus up to three uniformly sampled prior examples
produce one clipped SGD step. Counters distinguish unique valid physical
demonstrations, replay uses and optimizer steps. The sender receives at most
one on-policy REINFORCE step from its own fresh match/mismatch after a paid
reply, with the prior baseline read before the update. Censoring changes no
reward, baseline or weights. The numeric core accepts only feature arrays,
sampled token paths and numeric labels/reward; it has no world, object ID,
critic correctness, action receipt or other person's sight input.

## Strict current-save continuation

Current saves remain schema 12 under `aincrad.world.v2`. Their communication
envelope now has `worldLineage.version:2` and `characterMessages.version:2`.
The `visualReference.version:1` subtree retains every old private anchor,
example and the four old pair/target/order/choice RNG continuations unchanged.
Those old examples are inspectable history and never become recurrent training
examples or words. A **complete, valid** v1 communication envelope migrates
read-only in memory to independently seeded untrained character models without
advancing an old RNG. The v2 lineage and mandatory top-level feature markers
make deletion of the new section, or all three communication sections, invalid
instead of treating it as an old save. Partial, unsupported,
non-finite, wrong-shape, oversized or crossed-lineage data fail closed; occupied
bytes cannot be overwritten by a failed load or stale writer.

The version shape is intentionally asymmetric: a migrated or fresh envelope is
`{worldLineage:{version:2,...}, visualReference:{version:1,...},
characterMessages:{version:2,...}}`, paired with mandatory top-level
`features.characterMessages:2`. A v1 current save has the exact historical
three-key feature set, only the first two communication sections and
`worldLineage.version:1`; those two sections are strictly validated before
the third is initialized. Exact pre-extension schema-12 saves with no
communication sections also migrate read-only. A marked new save missing even
all three communication sections, or a version-2 lineage without its character
section, cannot take either migration path. Every ordinary save obtains the
attachment's current full export and validates it. After optional-channel
retirement, the save gate re-exports and compares the **entire** normalized
envelope with the last completed capture, including sender/listener weights,
baseline, examples, replay counters, all new RNG states and the four retained
legacy RNG states. Any change or failed export blocks an ordinary save instead
of writing an older learner checkpoint.
Coordinated rewriting of the marker and all sections into a genuinely valid
historical shape cannot be distinguished from that old save without an
external authenticity record.

Only model weights, baseline, bounded counters/examples and explicit new RNG
states persist. Pending handles, trajectories, gradients, action permissions,
queues and observer events do not. Fresh/reset worlds and replacement actors
start without acquired character learning; continuing actors resume their own
durable state. The pure current-export registration, compare-and-swap save gate
and confirmed reset behavior remain in place. The actual paid v1 fixture is
`tests/fixtures/visual-reference-v1-actual-paid-save.json.gz`; its decompressed
JSON SHA-256 is
`7c7faf91bfcc4ee262d1737acf3f300c35da78b1c569f45ebaabef67db8ff438`.
The fixture contains two earned anchors, one listener example and paid receipts.

## Local evidence

- Central finite differences cover every sender/listener parameter family,
  recurrent paths, sampled EOS and the no-EOS-gradient forced six-letter cap.
  Extreme logits remain finite; clipping, CE decrease, opposite sampled-path
  likelihood movement, seeded continuation, candidate permutation and own
  pixel/prefix effects are tested. Independent numeric review found no
  remaining material math or authority defect.
- The final combined core, runtime, physical adapter, migration, save-gate,
  Conversation and native-preparation focused suite passed **58/58**. It covers identical visible
  strings in distinct transactions, copied/stale handles, positive and negative
  own-view replies under the same observer critic, critic/object-ID
  interventions with sensory input fixed, ambiguous labels, one-use response
  cancellation after listener learning, lifecycle and identity boundaries,
  repeated read-only views/saves, and exact next message, choice, replay and
  update after reopening. The **7/7** native-harness synthetic and
  `--prepare-only` subset is preparation, not native proof.
- The historical full-state parity correction passed **41/41** focused tests:
  it verifies three bound world IDs and fresh-world uniqueness, then normalizes
  only those nonsemantic IDs while comparing every remaining physical, model,
  replay and RNG field. Feature-marker save/fixture and save/reset focused
  suites passed **37/37** and **36/36**; final migration/writer checks passed
  **20/20**, including deletion of all three marked communication sections and
  stale character-model/replay/RNG exports.
- Independent exact-source reviews of learning math, runtime authority,
  persistence and the native harness found no remaining concrete defect after
  fixes to diagnostic pending/ambiguity counts, the v2 section marker, and
  native-harness reopen/model/screenshot assertions. No local Electron app was
  launched and no remote branch or PR was written.

An engineered synthetic-pixel scene with a **full 128-example listener FIFO**
and four-example replay batch was timed on Linux x64, Node v24.19.0, AMD EPYC
9V74. It completed one actual paid inspection, indication and reply, with one
listener and one sender update. Among 1,460 paired attachment hook calls,
`beforeTick` median/p95/max were `0.0028/2.4576/5.7106 ms` and `afterTick`
were `0.0082/2.5052/6.2835 ms`. The first opportunity's
`listenerOptionalAction` was `34.4271 ms`; its geometry and 48-feature pair
search dominate this shared admission path. A separate warmed paired source
comparison found similar legacy and sequence median opportunity times
(`32.668` versus `32.016 ms`). These are measured **hook** costs in a Node
engineering scene, not a native whole-frame bound, Canvas timing or a 32 GB
laptop guarantee. Paid callbacks, Canvas capture and desktop rendering require
the native gate; the first opportunity may cause a visible frame hitch.

## Remaining gate

The prepared Linux/macOS native workflow must run in authorized isolated CI
profiles with actual Canvas crops, paid actions and screenshots. It must show
the emitted string and completed recipient action, one genuine listener and
sender parameter update, a mismatch update, and pending-message save/reopen
without duplicate learning. Repeated screenshots, saves and inspection must
not draw RNG or train. The exact tested source tree, host architecture and
screenshots need inspection before publication. The full unmodified
publication-helper source check/build must also pass at the final release gate.
