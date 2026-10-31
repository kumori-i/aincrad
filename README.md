# Aincrad

A local-first, original pixel-art desktop simulation with **one world: the Ozark watershed**. Explore its structured habitats while Aster and Mira perceive nearby objects, act, experience consequences and attempt experimental character messages about visible objects. The application opens directly into this world, without an original-world selector or a separate fishing map.

## Run locally

Primary desktop targets are Linux and macOS. Windows compatibility, packaging and testing are intentionally retired; other Unix systems are unverified, not promised targets. Requires Node.js 22.12.0 or newer:

```sh
git clone https://github.com/kumori-i/aincrad.git
cd aincrad
npm ci
npm start
```

The first installation downloads Electron. After installation, offline play needs no account, API key or model service. `npm start` builds and launches the desktop application; `npm run dev` rebuilds during development. Generated `dist/` files are not committed or deployed as a website.

## Experimental pixel communication lab

An [isolated offline research lab](docs/pixel-language/README.md) trains two small,
randomly initialized neural networks to communicate about synthetic RGB object
crops using arbitrary discrete symbols. It does not run in the game or change
Aster, Mira, live vision, settings or saves. Results include failed attempts and
held-out message-ablation controls; harness delivery is not a language claim.
The [v2 follow-up](docs/pixel-language-v2/README.md) adds contrastive color/shape
episodes, broader appearances and a predeclared multi-seed replication test.

## Character messages in the same survival world

The main optional channel now samples one to six `a`–`z` letters from each
sender's own current object crop. No English words, object definitions, grammar,
pretrained language model or trained lab checkpoint are supplied. A listener
chooses between two objects using its private model for that sender; before its
first valid own-view demonstration it chooses uniformly. The listener's paid
inspection and the sender's paid visible indication can produce one own-view
training example. A later optional paid listener reply can give the sender one
match or mismatch update from its **own** fresh sight. Unseen, ambiguous or
interrupted actions provide no invented training signal. Urgent survival remains
upstream, with one population and one clock.

The original physical reference work is retained in the [Phase A](docs/visual-reference/PHASE-A.md),
[Phase B](docs/visual-reference/PHASE-B.md) and [sender feedback](docs/visual-reference/SENDER-FEEDBACK.md)
records. Its assigned integer-symbol anchors and examples remain archival,
inspectable private evidence in continuing valid saves. New character models
start untrained and never train from those old examples. Character messages
remove the old anchor-capacity admission rule, so their available object pairs
are not directly comparable with earlier ordinary symbol runs. The same
target-independent geometry, own-view distinguishability, paid actions,
12-second deadline and survival interruptions remain.

Open a character's **Conversation** tab, or pause with Escape and use **Learning
inspector**. It shows exact emitted letters, actual recipient action receipts,
copied own-view crops and separate listener/sender updates. English annotations
are for the human observer, not translations or messages sent to agents.
Opening, saving and closing the view cannot draw policy randomness or train a
model. Events are session-only; pending gesture and message authority do not
survive reopening.

Each actor also keeps a bounded, session-only numeric memory of public pointing
poses it actually sees. A visible peer with no pose is distinct from an unseen
peer or a hidden pose; gaps do not count as continuous observation. The memory
contains relative geometry and the actor's own action context, not an object
label, partner intention or correctness signal. A separate private,
session-only model predicts whether the actor will see a public pose or visible
absence half a second later, using only uninterrupted own sight. It learns
temporal sensor correlations and controls no action or character model; neither
the memory nor prediction is learned gesture meaning or a clarification convention.

Strict current-world saves keep the old visual associations and their four RNG
continuations intact while adding bounded private character weights, examples,
counters and separate RNG states. Valid old visual-reference saves migrate
read-only to untrained models; malformed current data blocks overwrite. Fresh,
reset or replaced individuals begin without acquired character training. The
existing confirmed **Reset world** flow remains the way to start fresh; this
development does not delete user saves.

Ordinary fresh and reset worlds draw a new communication seed while the physical
Ozark seed stays fixed. Reopening keeps the saved seed, models and RNG continuations.
Identical letter strings can still occur by chance; a new seed does not by
itself give a string a stable meaning.

Prewritten English speech, human journal instructions, agent notes, peer
teaching/warnings and model naming remain disabled in the main world. Old names,
messages and reports are archival. Personally earned techniques and real physical
observation remain. Food handoffs use supplied nonverbal consent, not learned
words or food facts. Existing worlds may retain personally earned effects of old
advice, so they are not language-naive starts.

This integration passed exact-source and native Linux/macOS engineering
verification. A completed update is not evidence of stable vocabulary, grammar,
generalization, improved survival or a measured ordinary learning rate. The
[historical communication protocol](docs/communication-bridge/PROTOCOL.md) and
lab results remain unchanged; no new autonomous cohort was run.

## One physical world

- Ozark terrain, river/pond water and differentiated habitats are the common geometry for the player, people, animals and resources.
- Structural trees and rocks have collision and line-of-sight geometry. Forest density and rocky clearings follow habitat rules. There is no desert biome in this watershed.
- Forest canopy comes from actual structural oak/pine crowns; changing fruit-tree crowns are not yet included. Solar shade and cast shadows vary with the shared day clock; nighttime does not remove foliage.
- Ground, shoreline, tree and map rendering use original pixel artwork. Visual detail does not manufacture food, complete an action or advance simulation time.
- A day lasts one hour at normal speed. Escape pauses explicitly; maps, the journal, blur and minimized windows do not. Closing the application stops progression, without offline catch-up.

## Satiety, energy and paid work

Human **Satiety** is modeled appetite duration, not stomach fullness or stored calories. A 95 kcal apple
adds four gameplay satisfaction-hours before time spent eating; a normal 30 g
portion adds two-thirds of an hour, water adds none, and satisfaction is capped
at six hours. Energy, digestion and expenditure remain separate. The Learning tab
shows available fuel, stored reserves and cumulative calories independently, plus
a bounded session-only record of actually visited survival decision gates.
“Food-sampling/feedback events” is a legacy counter, not a count of whole meals.
These observer annotations do not guide agents or change food policy. See
[food mechanics and limitations](docs/food-balance/README.md).

Human NPC actions and purposeful movement now require
[paid work](docs/NPC-EFFORT-FUNDING.md) before progress or physical output is
credited. Strict personal adverse-source evidence can defer sampling, but does not
establish general food safety. Received warnings are archival and inactive
in the grounded main world. Saves
retain physical debits and bounded learning, not unfinished work authority.
Controlled feeding improvements do not establish reliable autonomous survival;
[source-bound verification](docs/food-system/VERIFICATION.md) separates historical
results, release reruns and native checks still awaiting execution.

## Hunting, fishing and handling

Agents have real timed primitive actions, including strikes and shore catches. They do not start with a complete hunting or fishing routine.

A successful terminal strike can identify the actual resulting carcass. Processing refuses safely when capacity is unavailable, without destroying the source. Existing terrestrial carcass yields remain energy-derived game abstractions, not anatomically calibrated edible mass.

Fishing uses visible, moving, finite fish. Catching is a paid interception that can miss; success produces an owned whole specimen. Pulling removes its finite raw tissue, and sampling produces delayed bodily effects through ordinary digestion. Fish feed from bounded local aquatic food stocks, grow with paid metabolic inputs, and transfer actual parental biomass into offspring. Local primary production renews food; population limits, starvation and age mortality still apply. Overharvesting can deplete a population, and extinction does not cause automatic respawning. This is an engineered ecology model, not a calibrated nutrient cycle.

These mechanics being available **does not establish reliable autonomous use or self-sustaining survival**. Short policy trials are reported as diagnostics rather than a prerequisite for making the physical abilities available. Long runtime alone does not guarantee discovery. Historical failures remain recorded in [finite fishing](docs/FINITE-FISHING-v1.md) and [carcass processing](docs/WITNESSED-CARCASS-PROCESSING.md).

## Current learning and communication

Fresh agents receive basic movement, bodily drives, senses and action primitives,
not food labels or recipes. Personal techniques require their own completed
actions and experienced feedback. Their own adverse outcomes still protect
against repeating a harmful exact-material/source trial.

A genuinely witnessed eating event can motivate an uncertain, exact-source
experiment. The observer must pay for its own acquisition and sampling, then
learn from its own delayed feedback. This [observation-driven inquiry](docs/OBSERVATIONAL-LEARNING.md)
is supplied scaffolding, not an invented recipe or transmitted food knowledge.
A bounded [own-failure-led handling inquiry](docs/HANDLING-CURIOSITY.md) can compare
a failed grasp with a personally successful pull on another currently similar
source. It does not automatically sample or infer safety.

[Visual similarity memory](docs/TENTATIVE-VISUAL-GROUPS.md) groups personally
sensed objects after repeated observations using a supplied shape/color/texture
rule, not discovered concepts. [Movement recovery](docs/MOVEMENT-RECOVERY.md)
uses actual failed walking and recent personal travel, without guaranteeing escape.

Food sharing uses supplied nonverbal requests, offers and consent. A real timed
handoff still requires a visible held item, locality, capacity, voluntary acceptance
and a paid grasp. No message grants nutrition or firsthand knowledge. The
**Learning** tab separates these motor gestures from actual character-message events
and English observer/debug narration. There is no English agent conversation or
active human instruction entry in the main world. Ollama is not needed for the
current offline survival or character-message channel.

### Historical communication mechanisms — disabled in the main world

Earlier increments supported [spoken procedure teaching](docs/METHOD-TRANSFER.md),
[exact-material warnings](docs/FOOD-WARNINGS.md), restricted
[human journal instructions](docs/HUMAN-HINTS.md), notes,
[grounded individual names](docs/GROUNDED-NAMES.md) and local-model
[appearance naming](docs/MODEL-CATEGORY-NAMES.md). Those documents and explicit
legacy test fixtures retain historical scope and evidence; they do **not** describe
active main-world channels now. No UI switch restores them.

Old messages, names, beliefs and received reports remain bounded archival data.
They cannot trigger new teaching, sampling cautions, naming exchanges, model
conversation or actions. Saved model settings are preserved but are not used by
the grounded communication channel. Personally earned techniques remain available,
including ones historically tested after advice; continuing an old save is therefore
not a language-naive experiment. Explicit confirmed reset is available for a fresh
start. No current shared meanings, grammar, improved survival or broad skill
generalization have been established.

## Controls

| Control | Action |
| --- | --- |
| WASD / arrows | Move the player avatar |
| Shift | Run while moving |
| Space / G while moving | Attempt swimming / climbing |
| Mouse wheel / + / − | World-camera zoom |
| M | Map; zoom, pan and locate each person |
| N | Character observations, Learning and archive |
| H | Guide |
| Escape | Pause / resume |
| Ctrl+S / ⌘S | Save the current world |

The player avatar explores and observes. Agent hunting/fishing actions are not a separate player-inventory game.

## Saves and scope

There is one supported current save format and key, `aincrad.world.v2`. This increment starts a fresh world instead of loading the earlier v1 slot; those earlier bytes are left untouched. A valid current save resumes; an absent slot starts a fresh current world. Corrupt current data is protected rather than silently overwritten. **Reset world…** in the pause menu or protected-save screen offers an explicit fresh start, with optional local export of the exact stored bytes. Confirmation is required; there is no in-app undo/import. App/model settings and unrelated storage are preserved. See [reset safety and backup details](docs/WORLD-RESET.md). Original-world and historical save migrations are retired. Old save files are not required or automatically imported, and are not deleted by the new bootstrap.

Cardinal diagnostic/supervision building blocks remain development work; the unified Ozark runtime does not expose the former original-world Cardinal panel. No complete ecology, reliable living, autonomous pursuit, agriculture, construction or emergent society is claimed.

## Development

- [Architecture](docs/architecture.md)
- [Current roadmap and limitations](docs/ROADMAP.md)
- [Verification](docs/TESTING.md)
- [Contributor boundaries](AGENTS.md)

Run `npm run check` and `npm run build` for source checks, then `npm run smoke` in a supported **sandboxed** Electron environment. Actual desktop screenshots and isolated close/reopen evidence are required for visual and persistence claims; a Canvas fixture or JSON roundtrip alone is insufficient. Keep failed diagnostics distinct from passing physical tests.

## Desktop platform verification and packaging

CI runs sandboxed native smoke and isolated capability close/reopen on Linux and macOS, recording the actual host architecture and checkout commit/tree. A passing row covers that runner's architecture only, not both Intel and Apple Silicon or every Unix system. Linux window lifecycle checks use Xvfb with a window manager; macOS uses its native desktop session.

On macOS, closing the last window stops simulation while the application remains open. Activating it recreates the window from the current save without closed-time catch-up. The standard application, File, Edit and Window menus provide Close, Quit and clipboard shortcuts. Native QA exercises the framework activation event programmatically, not a literal Dock click.

`npm run package:linux` and `npm run package:mac` create unpacked host-architecture development bundles in `release/`. The macOS `.app` is unsigned and not notarized; CI packaging is not an installation or Gatekeeper-distribution claim. `npm start` remains the primary local development route. No signing credentials are needed.
