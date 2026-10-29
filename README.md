# Aincrad

A local-first, original pixel-art desktop simulation with **one world: the Ozark watershed**. Explore its structured habitats while Aster and Mira perceive nearby objects, act, experience consequences and exchange experimental numeric symbols. The application opens directly into this world, without an original-world selector or a separate fishing map.

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

## One world: survival and symbol learning

Aster and Mira now learn pixel-grounded symbols **in the main Ozark world**,
alongside their existing survival learning. There is one population and one
clock. No Ollama, trained lab weights or separate session is required.
Open a character’s **Learning** tab (formerly Conversation), or pause with
Escape and use **Learning inspector** as a shortcut to that same tab. It shows
actual symbol emissions, copied local crops, selected actions, pending/interrupted
outcomes and gate counters. English annotations are observer labels, not speech
or translations. Closing the panel does not discard learning or change pause;
Escape still controls the one main clock.
The main world has no 1800-second experimental cutoff.

**Persistence is deliberately partial in this increment:** the existing world,
bodies and memories save as before, but communication weights and pending
communication credit restart when the app reopens. Loaded old samples/effects
cannot originate fresh messages. A new personal sample with a pre-consumption
crop and a canonical bodily effect is required. **Reset world** starts fresh
bodies, memories and policies through the existing confirmed reset flow.

Symbols can influence already-permitted optional physical trials; urgent
survival actions remain upstream. Only the listener's own linked action and
ingestion receipts earn reinforcement. Diagnostics distinguish relief,
discomfort, effort-only expiry and censored attempts. A negative reward can
mean effort with no attributed outcome, not necessarily sickness. Gate counts
show where opportunities stop; they do not change policies or reward rules.

This is an experimental mechanism, **not demonstrated language or improved
survival**. Whole-object crops, motor channels, opportunities and reward mapping
are supplied scaffolding. Prewritten English speech, human journal instructions,
notes as agent messages, peer teaching/warnings and model naming are disabled
in the main world. Old saved messages, names and reports remain archival and
cannot drive new choices. Personal outcomes and physically witnessed actions
remain available. Food handoffs use supplied nonverbal request/offer/consent
gestures—not learned words or semantic food claims.

The NPC **Learning** tab shows actual emitted symbols, original observation
crops, selected actions and pending/settled/interrupted outcomes. English
annotations are for the human observer, not translations or agent speech.
The pause-menu Learning inspector shortcut opens this same tab. No shared
reference/definition game or new reward has been added in this increment.
Removing the old semantic channels intentionally changes agent behavior;
future comparisons require a newly reviewed protocol. Existing worlds may
retain techniques personally earned after old advice, so they are not
language-naive starts. Only an explicit confirmed reset starts fresh.
The displayed token pair encodes one category, not grammar. The isolated
protocol factory remains for automated reproducibility, not a second playable
world. The [frozen protocol](docs/communication-bridge/PROTOCOL.md) and its
recorded comparison are historical evidence; this integration does not rerun
or reinterpret that experiment. The Python labs remain separate research;
their trained networks are never loaded into this runtime.

The [first six-trial results](docs/communication-bridge/RESULTS.md) found no
demonstrated survival benefit: two seed pairs had no exchanges, and the third
had identical recorded outcome ledgers and terminal body aggregates with
messages enabled or erased. Online weight updates are not proof of shared words.

## One physical world

- Ozark terrain, river/pond water and differentiated habitats are the common geometry for the player, people, animals and resources.
- Structural trees and rocks have collision and line-of-sight geometry. Forest density and rocky clearings follow habitat rules. There is no desert biome in this watershed.
- Forest canopy comes from actual structural oak/pine crowns; changing fruit-tree crowns are not yet included. Solar shade and cast shadows vary with the shared day clock; nighttime does not remove foliage.
- Ground, shoreline, tree and map rendering use original pixel artwork. Visual detail does not manufacture food, complete an action or advance simulation time.
- A day lasts one hour at normal speed. Escape pauses explicitly; maps, the journal, blur and minimized windows do not. Closing the application stops progression, without offline catch-up.

## Food satisfaction and paid work

Human **Food satisfaction** is appetite, not stored calories. A 95 kcal apple
adds four gameplay satisfaction-hours before time spent eating; a normal 30 g
portion adds two-thirds of an hour, water adds none, and satisfaction is capped
at six hours. Energy, digestion and expenditure remain separate. See
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
**Learning** tab separates these motor gestures from actual numeric-symbol events
and English observer/debug narration. There is no English agent conversation or
active human instruction entry in the main world. Ollama is not needed for the
current offline survival or symbol learners.

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
