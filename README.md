# Aincrad

**Your own desktop world, with one persistent life learning to survive.**

Aincrad 0.2 is a single-player Electron application: a mountain-ringed valley, river and lake, meadows, trees, three enterable caves, your controllable avatar, and one persistent NPC named Aster.

## Run the application

Download **Aincrad-0.2.0-Windows-x64.zip**, extract the **entire ZIP into a folder**, then double-click **Aincrad.exe**. Keep the supporting files beside it. The chat delivery includes this Windows build; automated builds are also available under [Desktop application workflow artifacts](https://github.com/kumori-i/aincrad/actions/workflows/desktop.yml).

The packaged app opens its own window. Playing does not require a browser, Node.js, an application account, an API key or a model service. The default controller learns locally from its game experience. Saved progress stays in your application profile.

This is an unsigned portable prototype, not a signed installer. The Windows package was built in Linux; desktop runtime verification was performed in Linux. A physical Windows/macOS machine has not been tested in this development session.

To run from source, install Node.js **22.12.0 or newer**:

```sh
git clone https://github.com/kumori-i/aincrad.git
cd aincrad
npm ci
npm start
```

For a development build:

```sh
npm run package:win    # Windows x64 portable ZIP in release/
npm run package:linux  # Linux application folder in release/linux-unpacked/
```

The initial setup downloads Electron; subsequent offline play needs no network connection. The repository’s `play.html` and `npm run web` remain optional browser/development paths. Local model connection is available in the desktop app.

## Watch Aster learn

Enter the valley and press **N** for Aster’s inspection drawer. Choose **Follow Aster** to watch its view. The drawer shows hydration, flask contents, lifecycle, current action/procedure, observed water sources, a remembered tile map, recent authoritative results, acquired procedures and supporting evidence.

Aster begins with an empty flask, no known source coordinates and an empty procedure library. The default offline experiential controller tries bounded actions and updates its action values from their actual outcomes. Successful collection/drinking sequences become candidate procedures; successes under changed starting conditions provide validation evidence. Those acquired procedures affect later choices.

Collecting fills the flask and does not hydrate the body. Drinking consumes its contents. Hydration drains in unpaused simulation time. At zero, Aster collapses and its current action is cancelled. After an interval, divine rescue restores partial hydration; the flask, position, identity, discoveries and memories are retained. A golden effect distinguishes rescue from normal drinking. Rescue is not counted as independent water acquisition.

For quicker observation, open **Development controls → Accelerated survival cycles**. This changes Aster’s hydration rate and recovery intervals; your movement speed and the world’s one-hour day are preserved. Use normal gameplay settings for long journeys and live-model latency. **Demonstrate collapse and rescue** is an explicitly recorded debug action; it gives no independent-survival credit. Rescue presentation can be a benevolent presence or quiet recovery. Player-assisted rescue is not implemented yet.

A meaningful independent success is a collected-water drink restoring at least 15 hydration, credited at most once per fill. Tiny top-ups and full-health drinking cannot farm the counter.

## Optional local language model

The offline learner works without a language model. For model-assisted decisions, use an already running local OpenAI-compatible server, such as [Ollama](https://docs.ollama.com/api/openai-compatibility).

For example, after installing Ollama, download a local model:

```sh
ollama pull llama3.2:3b
```

Start `ollama serve` if its background service is not already running. In Aincrad press **N → Local model planning**, enter:

- Endpoint: `http://127.0.0.1:11434/v1`
- Model: `llama3.2:3b` (or the exact name of another installed model)

Click **Use local model**. **Use offline learner** returns to local experiential control. No rented GPU or hosted model account is required. Model runtime speed depends on your hardware. Only loopback endpoints are supported in this version; the game never executes model-generated host code.

Configuration is stored as `agent-model.json` inside Electron’s Aincrad user-data folder. The example in [docs/local-model.example.json](docs/local-model.example.json) documents timeout, token and hourly-call limits. The model receives the NPC’s local/remembered observations, condition, relevant experience and acquired procedures. It cannot see the complete map or the player’s private state, or call rescue as a tool.

The model’s ordinary language knowledge comes from pretraining; this is not a blank-slate mind. Live language-model behavior was **not tested** because no actual model was configured. The HTTP/IPC integration was tested with a clearly labeled mock server, and the default learner was tested separately.

## Controls

| Control | Action |
| --- | --- |
| WASD / arrow keys | Walk your avatar |
| Hold Shift | Run |
| E | Enter/exit caves or read the trail sign |
| N | Open Aster’s live inspection drawer |
| M | Field map; click to set a waypoint |
| Right-click field map | Clear waypoint |
| Mouse wheel / + / − | Zoom |
| H | Guide |
| Esc | Pause/resume or close a modal menu |
| Ctrl+S / Command+S | Save |
| F11 | Desktop fullscreen |

Modal menus and focus loss pause the world and Aster. The inspection drawer stays live. Closing the app stops simulation; it does not run a settlement in the background. A new expedition explicitly replaces the saved world and Aster’s memory.

## What is supplied and what is learned

The developer supplies physical rules, senses, action schemas, collision handling, observed-tile navigation, feedback, high-level motivation and the rescue mechanic. Aster acquires resource knowledge, contextual action values and restricted procedures from actual experience. There is no seeded water route or preloaded survival procedure.

The visual world still uses its original Canvas renderer. Tile-based navigation and memory are implemented. A Phaser tile/sprite world like `agentic-workspace` is feasible as a later renderer milestone, while preserving these simulation rules.

The east–west reference span remains 45,000 logical pixels at 150 pixels/second: approximately five minutes on foot. One world day takes one hour of unpaused play. Human cave exploration, maps, waypoints and save recovery remain available; Aster stays in the valley for this milestone.

Not included: additional NPCs, professions, society, combat, crafting, farming, multiplayer, sound, a signed installer or a pretrained/finetuned custom model.

## Verification and evaluation

```sh
npm run check     # Source syntax and deterministic rules/provider tests
npm run bundle    # Rebuild the optional offline browser build
npm run smoke     # Isolated desktop lifecycle/UI check, no live inference
npm run evaluate  # Eight matched offline learning/memory-disabled trials
```

The evaluation uses fixed world geometry, matched controller RNG seeds, 300 simulation seconds per initial trial and a matched 120-second changed-starting-position phase. It measures independent drinking, collapses, rescues, invalid repetition, time to water and procedure use. Memory-disabled runs still log outcomes for inspection, but do not retrieve learned values/procedures and retain only current local map observations.

Results are in [docs/npc-evaluation.json](docs/npc-evaluation.json). These are small controlled offline trials, not a live-LLM benchmark or a guarantee that every successive attempt improves. See [verification](docs/TESTING.md) and [architecture](docs/architecture.md).

## Development

Read [AGENTS.md](AGENTS.md). Keep the engine authoritative; edit source modules and regenerate `play.html`. Original procedural artwork remains in `src/art.js`. The restricted model bridge is in `desktop/`. The NPC brief is preserved in [docs/NPC-MILESTONE.md](docs/NPC-MILESTONE.md).

The explicit publication helper can prepare reviewed repository files for a connected GitHub account:

```sh
npm run publish:github -- --prepare-connector ../aincrad-publication.json
```

The manifest includes the source checkout’s commit as its expected remote head. Verify target push permission and that head before a normal, non-forced update. Installation, launching and tests never publish. For ordinary development, use Git commits in a regular checkout.

A project license has not been selected. Electron and other development dependencies retain their own licenses.
