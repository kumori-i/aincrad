/** Current-world observation only. No success horizon is a release gate. */
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { PopulationRuntime } from '../src/population.js';
import { aquaticStockAudit } from '../src/aquatic-state.js';
let seconds = 600, output = null;
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i], value = process.argv[i + 1];
  if (flag === '--seconds' && value !== undefined) seconds = Number(value);
  else if (flag === '--output' && value) output = value;
  else throw Error(`Unknown or incomplete argument: ${flag}`);
}
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw Error('Seconds must be positive and at most 86400');
const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
for (const actor of state.agents) bindOzarkWorldAgent(actor, geometry, state);
const initialFish = state.environment.ecology.aquatic.fish.length;
const runtime = new PopulationRuntime(state, { cardinal: false });
try {
  for (let at = 0; at < seconds - 1e-9; at += CONFIG.fixedStep) {
    const dt = Math.min(CONFIG.fixedStep, seconds - at);
    state.elapsed += dt; runtime.tick(dt);
  }
} finally { runtime.dispose(); }
let raw = null;
const saveValid = writeOzarkSave({ getItem: key => key === OZARK_SAVE_KEY ? raw : null,
  setItem: (key, value) => { if (key === OZARK_SAVE_KEY) raw = value; } }, state, geometry);
const report = { schema: state.version, features: state.features, elapsed: state.elapsed,
  boundary: 'One untouched current world. No hints, supplied food knowledge, teleports or policy success requirement. Fish are finite and can die; longer runs do not replenish learning opportunities.',
  initialFish, finalFish: state.environment.ecology.aquatic.fish.length,
  aquaticStockAudit: aquaticStockAudit(state.environment.ecology), saveValid,
  saveSha256: raw ? createHash('sha256').update(raw).digest('hex') : null,
  agents: state.agents.map(actor => ({ id: actor.id, position: actor.position,
    physiology: actor.physiology, stats: actor.stats, practice: actor.discovery.practice,
    techniques: actor.discovery.techniques, effects: actor.discovery.effects,
    reports: actor.discovery.reports, decision: actor.decision })) };
const json = JSON.stringify(report, null, 2) + '\n';
if (output) await writeFile(output, json, { flag: 'wx' });
console.log(json);
if (!saveValid) process.exitCode = 1;
