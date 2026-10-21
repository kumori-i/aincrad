# Local voluntary food sharing

This increment adds a bounded local capability, not reliable communal living or a food oracle.

- A hungry empty-handed discovery agent can ask a visible nearby peer whether it wants to share.
- An agent may offer exactly one personally held material or whole fish specimen. Offer data retains the exact identity; speech describes the observed shape without code-like IDs, not the donor's inventory or the item's private nutrition.
- The recipient can accept or refuse. The donor can withdraw. Neither speech nor accepting an offer grants food or bodily relief.
- Accepting starts the recipient's ordinary timed grasp. Physical time and effort are paid; only completion can transfer the same object. Both remain awake, in the same scene, within physical reach and mutually visible. The donor must still consent, hold the item and not be doing another action. Receiver capacity is rechecked.
- The transaction moves one identity between inventories and changes its holder/location. Mass, energy, water, fish origin, tissue, residue and ecological ledgers are unchanged. No cloning or drop-and-reacquire shortcut is used.
- The recipient receives its own genuine grasp receipt and sensory observation. It receives no donor meal, technique, effect or practice. Its later sample and digestion can create its own firsthand evidence.

## Runtime and persistence

`food-sharing.js` keeps a maximum of one request and one offer per sender. Requests expire after 60 simulated seconds; offers expire after at most 15. Requests have a 120-second per-speaker cooldown. Pending consent is private runtime state, not serialized. Saved messages remain attributed conversation; they cannot recreate authorization after reopening. Partially completed grasps interrupt normally on reload.

`FoodSharing.action` supports `request_food` with a peer target, `offer_food` with a peer target and held object ID, `accept_food` with an offer ID, and `decline_food` with an offer/request ID. Refusal and withdrawal of an existing exchange are not delayed by ordinary unsolicited-speech cooldowns. The ordinary controller gives pending exchanges a decision opportunity outside the generic 12-second dialogue cadence. Offering voluntarily reserves up to 15 seconds of donor attention, without stopping physiology or ecology. Completion, refusal, withdrawal, expiry, lost locality, urgent body signals, contact escape or water danger releases that attention. A busy recipient is not forcibly interrupted. Optional language-model conversation cannot execute physical transfers.

Offline choices remain deliberately conservative. Hunger comes from the existing qualitative body signals. A donor only proposes sharing when it is not hungry and has retained validated relief from sampling that exact held identity, with no retained adverse effect. A recipient with hunger and hand capacity may choose the offered material unless it has its own contrary experience. These are explicit starter social decision rules, not learned general social reasoning. Nothing infers edibility from species, a diet table, another agent's private state, or a universal food tag. No forced pursuit, navigation, indefinite wait-for-donor routine or automatic eating is added.

## Verification scope

A controlled local encounter supplies real donor sample/feedback preparation, then lets both ordinary controllers run to request, offer, accept and finish a handover, including when the recipient recently spoke. This is not evidence of autonomous food discovery or communal survival. Focused tests exercise actual paid grasp completion, voluntary refusal/withdrawal, interruption/replay resistance, no premature transfer, capacity and ownership races, local reach/awake checks, unchanged matter, personal delayed sampling evidence, save/reopen and retained aquatic acquisition proof. Static encounter fixtures disclose that they do not advance ecology and are not evidence of autonomous fishing or survival. Native integrated evidence is maintained separately from these unit tests.
