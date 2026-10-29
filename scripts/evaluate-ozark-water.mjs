/**
 * Bounded, headless baseline for autonomous water discovery in the persistent
 * Ozark world. No source, route, waypoint, body deficit, or skill is supplied
 * to an actor. Replicates vary only the actors' initial random streams;
 * physical positions and the world seed remain the approved canonical ones.
 *
 * Usage: node scripts/evaluate-ozark-water.mjs --seconds 300 \
 *   --seeds 74193,74203,74213 --output /tmp/ozark-water-baseline.json
 * Output is create-only. Omitting --output prints the complete JSON report.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, loadOzarkSave, writeOzarkSave,
  OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { PopulationRuntime } from '../src/population.js';
import { bodySignals } from '../src/interoception.js';
import { retainedEffectProofError } from '../src/proof-retention.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STEP = CONFIG.fixedStep;
const SAVE_EVERY = 10;
const DEFAULT_SEEDS = Object.freeze([74193, 74203, 74213]);
const MAX_STEPS = 120000;
const OLD_KEY = CONFIG.saveKey;
const OLD_SENTINEL = '{"syntheticOriginal":"untouched"}';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const finite = value => Number.isFinite(value) ? value : null;
const point = position => ({ x: position.x, y: position.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const oneDecimal = value => Number.isFinite(value) ?
  Math.round(value * 10) / 10 : null;

function parseSeeds(raw) {
  const seeds = raw.split(',').map(Number);
  assert(seeds.length >= 1 && seeds.length <= 6 &&
    new Set(seeds).size === seeds.length &&
    seeds.every(seed => Number.isSafeInteger(seed) && seed >= 0 &&
      seed <= 0xffffffff), 'Use one to six distinct uint32 start seeds.');
  return seeds;
}

export function baselineOptions(argv = process.argv.slice(2)) {
  const options = { seconds: 300, seeds: [...DEFAULT_SEEDS], output: null };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index], value = argv[++index];
    assert(value !== undefined, `Missing value for ${flag}`);
    if (flag === '--seconds') options.seconds = Number(value);
    else if (flag === '--seeds') options.seeds = parseSeeds(value);
    else if (flag === '--output') options.output = resolve(value);
    else throw new Error(`Unknown option ${flag}`);
  }
  assert(Number.isSafeInteger(options.seconds) &&
    options.seconds >= 1 && options.seconds <= 1800,
  'Seconds must be an integer from 1 through 1800.');
  assert(options.seconds * options.seeds.length / STEP <= MAX_STEPS,
    `Trial budget exceeds ${MAX_STEPS} total authoritative steps.`);
  return options;
}

function bodySnapshot(npc) {
  const body = npc.physiology;
  return {
    thirst: bodySignals(npc).thirst,
    waterDeficitMl: oneDecimal(body.waterDeficitMl),
    absorbedWaterMl: oneDecimal(body.totals.absorbedWaterMl),
    waterLostMl: oneDecimal(body.totals.waterLostMl),
    outsideAssistanceWaterMl: oneDecimal(body.outsideAssistance.waterMl),
    stomachWaterMl: oneDecimal(body.stomach.reduce((sum, row) =>
      sum + row.remainingWaterMl, 0)),
    health: oneDecimal(body.health),
    stamina: oneDecimal(body.stamina),
    flaskWater: oneDecimal(npc.flask.water),
    lifecycle: npc.lifecycle, collapses: npc.stats.collapses,
    rescues: npc.stats.rescues,
  };
}

function newTracker(npc) {
  return {
    id: npc.id, start: point(npc.position), initialBody: bodySnapshot(npc),
    known: new Map(), seenWaterCells: new Set(),
    firstVisibleWaterAt: null, firstSourceAt: null, firstApproachAt: null,
    firstCollectAt: null, firstDrinkAt: null,
    visibleWaterCellCount: 0, observedSourceCount: 0,
    peakConcurrentSources: 0,
    sourceKnownMoveAttempts: 0, towardObservedSourceMoves: 0,
    towardObservedSourceDistance: 0, fills: 0, drinks: 0,
    independentDrinks: 0, collectedDrinkMl: 0,
    collectedIngestions: new Map(),
    sampledWaterReliefEffects: 0,
    actionResults: {}, waterActionFailures: {}, lastEventId: 0,
  };
}

function track(npc, row) {
  for (const cell of Object.values(npc.memory.cells)) {
    if (!['surface-water', 'internal-pond'].includes(cell.terrain) ||
        row.seenWaterCells.has(cell.key)) continue;
    row.seenWaterCells.add(cell.key);
    row.firstVisibleWaterAt ??= cell.observedAt;
  }
  row.visibleWaterCellCount = row.seenWaterCells.size;
  const sources = Object.values(npc.memory.sources);
  row.peakConcurrentSources = Math.max(row.peakConcurrentSources,
    sources.length);
  for (const source of sources) {
    if (row.known.has(source.id)) continue;
    row.known.set(source.id, {
      x: source.x, y: source.y, firstSeenAt: source.observedAt,
    });
    row.firstSourceAt ??= source.observedAt;
  }
  row.observedSourceCount = row.known.size;
  for (const event of npc.memory.experience) {
    if (event.id <= row.lastEventId) continue;
    row.lastEventId = event.id;
    if (event.type !== 'action') continue;
    const action = event.details?.action, result = event.details?.result;
    const type = action?.type, code = result?.code;
    if (!type || !code) continue;
    const key = `${type}:${code}`;
    row.actionResults[key] = (row.actionResults[key] || 0) + 1;
    if (type === 'move') {
      const before = event.details?.startPosition;
      const after = event.details?.position;
      const knownAtAction = [...row.known.values()].filter(source =>
        source.firstSeenAt <= event.at);
      if (before && after && knownAtAction.length) {
        row.sourceKnownMoveAttempts++;
        const toward = Math.max(0,
          Math.min(...knownAtAction.map(source => distance(before, source))) -
          Math.min(...knownAtAction.map(source => distance(after, source))));
        if (toward > 2) {
          row.towardObservedSourceMoves++;
          row.towardObservedSourceDistance += toward;
          row.firstApproachAt ??= event.at;
        }
      }
    }
    if (type === 'fill_flask') {
      if (code === 'COLLECTED') {
        row.fills++;
        row.firstCollectAt ??= event.at;
      } else row.waterActionFailures[key] =
        (row.waterActionFailures[key] || 0) + 1;
    }
    if (type === 'drink') {
      if (code === 'DRANK') {
        row.drinks++;
        row.firstDrinkAt ??= event.at;
        if (result.independent === true) row.independentDrinks++;
        if (result.provenance === 'collected' &&
            Number.isFinite(result.waterConsumed)) {
          row.collectedDrinkMl += result.waterConsumed * 1000;
          if (typeof result.ingestionId === 'string')
            row.collectedIngestions.set(result.ingestionId, {
              consumedMl: result.waterConsumed * 1000,
              maxObservedAbsorbedMl: 0,
            });
        }
      } else row.waterActionFailures[key] =
        (row.waterActionFailures[key] || 0) + 1;
    }
  }
  // The action receipt identifies the exact ingestion. A stomach entry's own
  // absorbed counter is causal evidence from that portion, unlike aggregate
  // absorbedWaterMl, which can also include sampled plants. A fully digested
  // portion may be removed within one step, so this sum is a lower bound.
  for (const item of npc.physiology.stomach) {
    const ingestion = row.collectedIngestions.get(item.id);
    if (ingestion) ingestion.maxObservedAbsorbedMl = Math.max(
      ingestion.maxObservedAbsorbedMl, item.absorbedWaterMl || 0);
  }
  row.sampledWaterReliefEffects = npc.discovery.effects.filter(effect =>
    effect.effect === 'water relief').length;
}

function finishTracker(npc, row) {
  const collectedAbsorbedLowerBoundMl = [...row.collectedIngestions.values()]
    .reduce((sum, item) => sum + item.maxObservedAbsorbedMl, 0);
  const outcome = !row.observedSourceCount ? 'no-source-observed' :
    !row.fills && !row.towardObservedSourceMoves ?
      'observed-without-approach-progress' :
      !row.fills ? 'approached-without-collection' :
        !row.drinks ? 'collected-without-drinking' :
          collectedAbsorbedLowerBoundMl > 0 ?
            'collected-drink-absorption-observed' :
            'drank-awaiting-collected-absorption';
  return {
    id: npc.id, start: row.start, end: point(npc.position),
    displacement: oneDecimal(distance(row.start, npc.position)),
    visibleWaterCellCount: row.visibleWaterCellCount,
    firstVisibleWaterAt: finite(row.firstVisibleWaterAt),
    observedSourceCount: row.observedSourceCount,
    peakConcurrentSources: row.peakConcurrentSources,
    firstSourceAt: finite(row.firstSourceAt),
    firstApproachAt: finite(row.firstApproachAt),
    firstCollectAt: finite(row.firstCollectAt),
    firstDrinkAt: finite(row.firstDrinkAt),
    sourceKnownMoveAttempts: row.sourceKnownMoveAttempts,
    towardObservedSourceMoves: row.towardObservedSourceMoves,
    towardObservedSourceDistance: oneDecimal(
      row.towardObservedSourceDistance),
    fills: row.fills, drinks: row.drinks,
    independentDrinks: row.independentDrinks,
    collectedDrinkMl: oneDecimal(row.collectedDrinkMl),
    collectedIngestionCount: row.collectedIngestions.size,
    collectedAbsorbedLowerBoundMl:
      oneDecimal(collectedAbsorbedLowerBoundMl),
    sampledWaterReliefEffects: row.sampledWaterReliefEffects,
    waterSkills: npc.memory.skills.filter(skill =>
      skill.need === 'water').length,
    actionResults: row.actionResults,
    waterActionFailures: row.waterActionFailures,
    initialBody: row.initialBody,
    finalBody: bodySnapshot(npc), outcome,
    proofError: retainedEffectProofError(npc),
  };
}

function storage() {
  const bytes = new Map([[OLD_KEY, OLD_SENTINEL]]);
  return { getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => bytes.set(key, value) };
}

/** One isolated, reproducible start. Negative actor outcomes are data. */
export function evaluateOzarkWaterStart(seed, seconds = 300, onFinalRawSave = null) {
  assert(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  assert(Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 1800);
  const geometry = createOzarkWorldGeometry();
  const disk = storage();
  const state = createOzarkState(geometry);
  for (const npc of state.agents) {
    assert.deepEqual(npc.position, geometry.agentSpawns[npc.id]);
    npc.seed = seed;
    npc.rng = seed;
    assert.equal(Object.keys(npc.memory.sources).length, 0);
    assert.equal(npc.flask.water, 0);
    assert.equal(npc.memory.skills.length, 0);
    bindOzarkWorldAgent(npc, geometry, state);
  }
  const trackers = new Map(state.agents.map(npc =>
    [npc.id, newTracker(npc)]));
  const runtime = new PopulationRuntime(state, { cardinal: false });
  assert.equal(writeOzarkSave(disk, state, geometry), true,
    'Fresh Ozark world could not write its separate slot.');
  let saveCount = 1;
  try {
    for (let step = 1; step <= Math.round(seconds / STEP); step++) {
      state.elapsed += STEP;
      runtime.tick(STEP);
      for (const npc of state.agents) track(npc, trackers.get(npc.id));
      if (step % Math.round(SAVE_EVERY / STEP) === 0) {
        assert.equal(writeOzarkSave(disk, state, geometry), true,
          `Ozark autosave failed at ${state.elapsed} simulated seconds.`);
        saveCount++;
      }
    }
  } finally { runtime.dispose(); }
  assert.equal(writeOzarkSave(disk, state, geometry), true,
    'Final Ozark save failed.');
  saveCount++;
  const raw = disk.getItem(OZARK_SAVE_KEY);
  const effects = state.agents.map(npc => structuredClone(
    npc.discovery.effects));
  const bodies = state.agents.map(bodySnapshot);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), raw,
    'A read rewrote Ozark saved bytes.');
  assert.equal(disk.getItem(OLD_KEY), OLD_SENTINEL,
    'Ozark simulation changed synthetic historical bytes.');
  for (let index = 0; index < state.agents.length; index++) {
    const before = state.agents[index], after = reopened.state.agents[index];
    assert.deepEqual(after.discovery.effects, effects[index],
      `${before.id} changed learned effects on load.`);
    assert.deepEqual(bodySnapshot(after), bodies[index],
      `${before.id} changed physical state on load.`);
    assert.equal(retainedEffectProofError(after), null,
      `${before.id} lost exact learned effect proof on load.`);
  }
  // Optional test observer sees the exact final bytes only after readback,
  // strict reload and per-agent physical/learned proof checks have passed.
  if (onFinalRawSave !== null) {
    assert.equal(typeof onFinalRawSave, 'function');
    onFinalRawSave(raw);
  }
  return {
    seed, startKind: 'approved-spawns-varied-actor-rng',
    seconds, saves: saveCount, ozarkRawSha256: digest(raw),
    historicalBytesPreserved: true, loadProofValidated: true,
    agents: state.agents.map(npc => finishTracker(npc,
      trackers.get(npc.id))),
  };
}

async function sourceFingerprint() {
  const files = [];
  async function collect(dir) {
    for (const entry of await readdir(resolve(ROOT, dir),
      { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile() && /\.js$/.test(name)) files.push(name);
    }
  }
  await collect('src');
  files.push('scripts/evaluate-ozark-water.mjs');
  const rows = [];
  for (const file of files.sort()) rows.push(`${file}:${digest(
    await readFile(resolve(ROOT, file)))}`);
  return digest(rows.join('\n'));
}

export async function runOzarkWaterBaseline(options = baselineOptions([])) {
  const { seconds, seeds } = options;
  const fingerprint = await sourceFingerprint();
  const geometry = createOzarkWorldGeometry();
  const trials = seeds.map(seed => evaluateOzarkWaterStart(seed, seconds));
  assert.equal(await sourceFingerprint(), fingerprint,
    'Source changed during evaluation; mixed results are invalid.');
  const agents = trials.flatMap(trial => trial.agents);
  return {
    kind: 'ozark-autonomous-water-baseline-v1',
    sourceSha256: fingerprint,
    geometryIdentity: geometry.profile.identity,
    settings: { seconds, seeds, stepSeconds: STEP,
      saveIntervalSeconds: SAVE_EVERY,
      totalAuthoritativeSteps: seconds * seeds.length / STEP,
      startSelection: 'Every replicate uses both approved spawns and the same pinned world. Only the fresh actors’ random streams vary by seed; no water proximity, route, source, or waypoint is selected.' },
    priorKnowledge: 'Both fresh agents begin each trial with empty source memory, empty flask, and no learned skill. The ordinary local controller receives only its normal perceptions.',
    developerInstrumentation: 'Exact body stocks, source counts, and action receipts are evaluation measurements, never observations supplied to either actor.',
    outcomeDefinition: 'Stages report first locally visible water tile and bank source, any move attempted after source sighting, physical progress toward an observed source, collection, drinking, then absorption from the exact collected-drink ingestion ID. Progress is measured from receipts and already observed sources, not inferred intent. Per-ingestion absorption is the maximum seen in the stomach before removal, a lower bound; aggregate body absorption includes sampled materials. Sampled-material water relief is separate from a flask or crossing skill.',
    totals: { actors: agents.length,
      sourceObserved: agents.filter(row => row.observedSourceCount > 0).length,
    waterApproached: agents.filter(row =>
      row.towardObservedSourceMoves > 0).length,
      collected: agents.filter(row => row.fills > 0).length,
      drank: agents.filter(row => row.drinks > 0).length,
      collectedDrinkAbsorptionObserved: agents.filter(row =>
        row.outcome === 'collected-drink-absorption-observed').length,
      outcomes: Object.fromEntries([...new Set(agents.map(row => row.outcome))]
        .sort().map(key => [key, agents.filter(row =>
          row.outcome === key).length])) },
    limitations: [
      'This uses the native fixed simulation step, but runs without Electron rendering or player input.',
      'A 300-second start is a short behavior probe, not a survival or ecosystem viability result.',
      'A credited independent drink precedes bodily absorption. Per-ingestion stomach counters attribute a lower bound to collected drinks; cumulative body absorption may include sampled materials.',
      'Different actor random streams are evaluation replicates; production start seeds, spawns and world geometry remain unchanged.',
    ],
    trials,
  };
}

async function main() {
  const options = baselineOptions();
  const report = await runOzarkWaterBaseline(options);
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true });
    const file = await open(options.output, 'wx');
    try { await file.writeFile(serialized); }
    finally { await file.close(); }
    console.log(JSON.stringify({ output: options.output,
      sourceSha256: report.sourceSha256, totals: report.totals }));
  } else process.stdout.write(serialized);
}

if (process.argv[1] && resolve(process.argv[1]) ===
    fileURLToPath(import.meta.url)) await main();
