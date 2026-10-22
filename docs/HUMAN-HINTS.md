# Restricted human hints

Human conversation is not a general natural-language planner. Physical hints are admitted only when the entire input matches a small command grammar. Unsupported text is still an attributed report, not a partially understood plan or personal evidence.

- One to six clauses, separated by a comma, `and`, `then`, or `and then`.
- Operations: inspect / inspect_object / look at; grasp / pick up / take; pull / pick / pluck; release / drop; sample / taste / bite / eat; strike / hit / kill; catch when available. Each clause is one attempt. In particular, `kill` is only an alias for one strike, not a promised death.
- One already observed `object:N`, or a unique appearance description using the existing limited cue vocabulary (red, purple, green, round, fibrous, prickly, rough, sweet, furry, soft, trunk, blades, clusters). Optional articles and object/fruit nouns do not supply species knowledge. All explicit references must resolve to the same object. `it` and implicit references can use an earlier target or a previous own question containing exactly one object ID, never a later reference. After a pull, only implicit sample/release clauses are allowed, because the acquired material has a new identity; explicitly naming the original source or another acquisition is rejected rather than silently retargeted.
- Case, whitespace, an opening `please` / `can you` / `could you` / `would you`, a trailing `please`, and one final punctuation mark are accepted.

For example, `Please pull object:123, then sample it.` proposes two attempts if that object was observed. Successful pulling binds later sample/release to the actual acquired material through the existing outcome path. No text creates a material, completes an action, or establishes food benefit.

Conditions, negation, quoted or descriptive prose, repetition instructions, unknown operations, multiple targets, resulting-object references, trailing qualifications and more than six clauses are not understood. No executable prefix is kept. Rejection means no steps are proposed by this hint, not that all autonomous behavior stops. In particular, a rejected “do not strike” is not installed as a prohibition or safety rule; ordinary autonomous behavior may still select its own actions. The user's example “get close to the object, strike it repeatedly then gather the resulting object and eat it” is therefore retained but proposes zero steps, even with an observed ID. This is deliberately not a hunting loop or general semantic parser. A sequence of explicit repeated clauses requests that fixed number of attempts only.

## Persistence and boundaries

Human attempts are session-local. Saving preserves attributed text and real executed evidence, but serializes human reports without executable proposals. Reload does not reparse old text or rearm partially completed requests. The interface explicitly asks for a fresh simple command if another attempt is wanted. Legacy schema-12 human reports also become inert, rather than silently upgrading earlier fragment parsing. Peer teaching retains its separate evidence-checked persistence behavior.

The optional version-1 `hint` field has only an allowlisted status code; it is explanatory, never execution authority. Invalid new metadata protects the current save instead of resetting it. Current physical data/proof validation and schema 12 remain unchanged. Reports remain bounded to 600 characters; direct oversized input is rejected for execution before truncating the stored report preview. Journal transport keeps its existing maximum and rejects oversized messages. Local language models cannot override this physical grammar; general chat stays chat.

## Verification

`tests/human-hint-validation.test.mjs` exercises whole-input rejection, ordinary forms, material binding and restart safety. Existing discovery, peer-teaching and current-save suites remain required. The existing isolated native peer-teaching fixture also posts an unsupported conditional hint, verifies its bounded reply and zero proposals after reopening, and captures `social-rejected-human-hint.png`. Native screenshots require a real sandbox-capable desktop run; source/fixture tests alone do not count as native evidence.
