# Aincrad

A local-first, original pixel-art desktop simulation with **one world: the Ozark watershed**. Explore its structured habitats while Aster and Mira perceive nearby objects, act, experience consequences and talk. The application opens directly into this world, without an original-world selector or a separate fishing map.

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
credited. Strict personal adverse-source evidence and attributed exact-material
warnings can defer sampling, but do not establish general food safety. Saves
retain physical debits and bounded learning, not unfinished work authority.
Controlled feeding improvements do not establish reliable autonomous survival;
[source-bound verification](docs/food-system/VERIFICATION.md) separates historical
results, release reruns and native checks still awaiting execution.

## Hunting, fishing and handling

Agents have real timed primitive actions, including strikes and shore catches. They do not start with a complete hunting or fishing routine.

A successful terminal strike can identify the actual resulting carcass. Processing refuses safely when capacity is unavailable, without destroying the source. Existing terrestrial carcass yields remain energy-derived game abstractions, not anatomically calibrated edible mass.

Fishing uses visible, moving, finite fish. Catching is a paid interception that can miss; success produces an owned whole specimen. Pulling removes its finite raw tissue, and sampling produces delayed bodily effects through ordinary digestion. Fish feed from bounded local aquatic food stocks, grow with paid metabolic inputs, and transfer actual parental biomass into offspring. Local primary production renews food; population limits, starvation and age mortality still apply. Overharvesting can deplete a population, and extinction does not cause automatic respawning. This is an engineered ecology model, not a calibrated nutrient cycle.

These mechanics being available **does not establish reliable autonomous use or self-sustaining survival**. Short policy trials are reported as diagnostics rather than a prerequisite for making the physical abilities available. Long runtime alone does not guarantee discovery. Historical failures remain recorded in [finite fishing](docs/FINITE-FISHING-v1.md) and [carcass processing](docs/WITNESSED-CARCASS-PROCESSING.md).

## Learning, advice and conversation

Fresh agents receive basic movement, bodily drives, senses and action primitives, not food labels or recipes. Their personal techniques require their own completed actions and experienced feedback.

An agent can communicate an actually learned, exact-source procedure through nearby speech. The recipient can try the taught steps without randomly rediscovering the sequence. The advice remains attributed testimony, not copied firsthand experience, proficiency or a free meal. Physical availability, effort, ownership and adverse feedback still matter.

A real adverse personal sample can now produce a [local exact-material warning](docs/FOOD-WARNINGS.md). An awake listener who actually hears it temporarily defers sampling that same identified material. The warning remains attributed, uncertain testimony—not the listener's own illness, a species-wide food label or a promise that other portions are safe. Dropping/regrasping preserves physical identity; reload does not replay missed warnings.

Human journal advice can suggest actions against something the agent has observed, but only through a [restricted whole-command grammar](docs/HUMAN-HINTS.md). Unsupported procedures produce no partial steps; saved human requests do not resume after reload. A vague phrase such as “kill the animals” does not identify a target or guarantee a hunting sequence. The interface distinguishes unresolved advice from a usable suggestion. Existing qualitative feeling reports describe modeled bodily sensations, not a claim of humanlike consciousness or complete social reasoning. Nearby food requests and voluntary offers can lead to a real timed handoff of an exact held item. The recipient must independently accept and grasp it; ownership, capacity and proximity are rechecked, and learning still requires their own subsequent experience. Broad skill generalization and richer social relationships remain future work.

An initial observation-led learning cycle lets a genuinely witnessed eating event motivate an uncertain, exact-source question. When access and bodily priorities permit, the observer can try a paid acquisition-and-sampling experiment and revise its expectation from its own delayed feedback. The knowledge panel keeps witnessed consumption separate from personal evidence. This uses a supplied bounded experiment scaffold, not an invented hunting recipe, species-wide food knowledge, or parallel humanlike reasoning. See [observation-driven inquiry](docs/OBSERVATIONAL-LEARNING.md).

A bounded [local method-transfer trial](docs/METHOD-TRANSFER.md) can use a speaker's earned procedure and fresh appearance report to test one different, uniquely matching source within the listener's reach. Similar appearance is uncertain, not food or safety proof. Only the listener's own actions and bodily feedback establish its outcome. This uses a supplied three-cue matching abstraction and one-shot admission, not broad skill generalization.

A bounded [own-failure-led handling inquiry](docs/HANDLING-CURIOSITY.md) can contrast a failed paid grasp with a retained successful pull on a different, currently similar-looking source. It may select one paid local pull, without automatically sampling or inferring food, safety or cause. This is supplied analogy machinery using personal outcomes, not an invented action grammar.

A bounded [grounded-name exchange](docs/GROUNDED-NAMES.md) preserves existing names for individually encountered objects, grounds a peer’s word through local pointing, and can check a later visible reference. An unresolved word can prompt one listener clarification, one fresh re-point and one independent retry; it cannot retry indefinitely. Chosen, heard and confirmed names stay separate. This is supplied communication machinery, not categories, invented grammar or food knowledge.

A passive [tentative visual similarity memory](docs/TENTATIVE-VISUAL-GROUPS.md) groups individually sensed objects only after two time-separated observations each. Its exact shape/color/texture rule is supplied, not discovered. The private journal distinguishes remembered support from current sight.

An already configured local model can now propose [tentative appearance names](docs/MODEL-CATEGORY-NAMES.md), reusing a personal word for observed matching objects instead of assigning unrelated seeded syllables. Each agent keeps its own vocabulary and locally grounded peer examples, not a shared global dictionary. Changed or missing cues can suspend a membership; names never propagate food benefit or safety. Notes and conversation retain exact instance IDs beneath or alongside names. Offline play stays usable, but new model naming pauses rather than fabricating a model-chosen fallback.

Movement feedback can detect a paid walk making negligible progress and propose one short, physically tested retreat along the actor's own recent trail. This [bounded recovery scaffold](docs/MOVEMENT-RECOVERY.md) does not guarantee escape or replace urgent care; it is distinct from fixing collision geometry.

The optional local model assists conversation and proposes bounded appearance words. It is not required for offline learning, and neither text nor names bypass the physical action engine. The pretrained model's familiar associations are not firsthand knowledge or species truth.

## Controls

| Control | Action |
| --- | --- |
| WASD / arrows | Move the player avatar |
| Shift | Run while moving |
| Space / G while moving | Attempt swimming / climbing |
| Mouse wheel / + / − | World-camera zoom |
| M | Map; zoom, pan and locate each person |
| N | Character journal, observations and conversation |
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
