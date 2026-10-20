/** Fixed, descriptive H1 measurement. No production policy changes, retries,
 * seed search, power override, save writes or pass condition on a hunt. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';
import { PopulationRuntime } from '../src/population.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { decisionObservation } from '../src/controller.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { ENCOUNTER_PROTOCOL, createCarcassEncounterFixture } from
  '../tests/fixtures/carcass-encounter.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = row => ({ x: row.x, y: row.y });
const protocolBytes = JSON.stringify(ENCOUNTER_PROTOCOL, null, 2) + '\n';

/** This selector receives no actor, world, geometry, species or hidden health.
 * Its retained state consists solely of identities learned from observations. */
export function selectEncounterCommand(observation, operator) {
  const { discovery, condition } = observation;
  const experiments = discovery.experiments;
  const kill = experiments.find(row => row.ok && row.primitive === 'strike' &&
    row.targetId === operator.targetId && row.code === 'object_stopped_moving' &&
    typeof row.resultObjectId === 'string');
  if (kill) operator.carcassId ??= kill.resultObjectId;
  const pull = experiments.find(row => row.ok && row.primitive === 'pull' &&
    row.targetId === operator.carcassId && typeof row.materialId === 'string');
  if (pull) operator.materialId ??= pull.materialId;
  const sample = experiments.find(row => row.ok && row.primitive === 'sample' &&
    row.targetId === operator.materialId && typeof row.ingestionId === 'string');
  if (sample) operator.complete = true;
  if (operator.complete) return { action: null, reason: 'Exact first chain completed; observe only.' };
  if (operator.materialId) {
    if (condition.inventory.objects.some(row => row.id === operator.materialId))
      return { action: { type: 'sample', targetId: operator.materialId }, reason: 'Sample the exact acquired held piece.' };
    return { action: null, reason: 'Exact acquired piece is not observed in hand.' };
  }
  const targetId = operator.carcassId ?? operator.targetId;
  const target = discovery.observations.find(row => row.id === targetId);
  if (!target) return { action: null, reason: 'Designated identity is not in public observations.' };
  if (!operator.inspected && !operator.carcassId) {
    operator.inspected = true;
    return { action: { type: 'inspect_object', targetId }, reason: 'One initial inspection of designated local identity.' };
  }
  const separation = distance(condition.position, target.position);
  if (separation <= 80) return { action: {
    type: operator.carcassId ? 'pull' : 'strike', targetId },
  reason: 'Last public target position is within ordinary reach; native completion rechecks.' };
  const failed = (observation.recentTerrain || []).filter(row =>
    row.action === 'move' && !['ARRIVED', 'MOVED'].includes(row.result) &&
    observation.observedAt - row.at < 10);
  const tiles = observation.knownTiles.filter(tile => tile.walkable &&
    distance(condition.position, tile) > 6 &&
    distance(tile, target.position) < separation - 1 &&
    !failed.some(row => row.target?.x === tile.x && row.target?.y === tile.y));
  tiles.sort((a, b) => distance(a, target.position) - distance(b, target.position) ||
    distance(a, condition.position) - distance(b, condition.position) || a.x - b.x || a.y - b.y);
  return tiles.length ? { action: { type: 'move', target: point(tiles[0]) },
    reason: 'Approach only a public observed walkable tile toward the public target location.' } :
    { action: null, reason: 'No eligible observed approach tile; observe only.' };
}

function body(actor) {
  const f = actor.physiology;
  return { lifecycle: actor.lifecycle, position: point(actor.position),
    health: f.health, stamina: f.stamina, fatigue: f.fatigue,
    availableEnergyKcal: f.availableEnergyKcal, storedEnergyKcal: f.storedEnergyKcal,
    waterDeficitMl: f.waterDeficitMl, totals: { ...f.totals },
    outsideAssistance: copy(f.outsideAssistance), rescues: actor.stats.rescues,
    collapses: actor.stats.collapses, independentMeals: actor.stats.independentMeals };
}

function commandedController(actor, environment, targetId, commands) {
  const operator = { targetId, carcassId: null, materialId: null, complete: false };
  let senseAt = -Infinity, decideAt = 0;
  return {
    tick(dt) {
      tickNpc(actor, dt, environment);
      if (actor.lifecycle !== 'AWAKE') return;
      processDiscoveryFeedback(actor);
      if (actor.elapsed - senseAt >= 1) {
        observeNpc(actor, environment); senseAt = actor.elapsed;
      }
      if (actor.active || actor.elapsed < actor.nextDecisionAt || actor.elapsed < decideAt) return;
      const observation = copy(decisionObservation(actor));
      const selected = selectEncounterCommand(observation, operator);
      const result = selected.action ? requestNpcAction(actor, selected.action, environment) : null;
      commands.push({ at: actor.elapsed, ...selected,
        admission: result ? copy(result) : null, observation });
      decideAt = actor.elapsed + (selected.action ? .65 : 1);
    }, dispose() {}, cancel() {},
  };
}

function summarize(actor, fixture, initialBody, trace, ingestions, travel) {
  const events = trace.filter(row => row.actorId === actor.id && row.type === 'action');
  const strikes = events.filter(row => row.details.action.type === 'strike' &&
    row.details.action.targetId === fixture.targetId);
  const kills = strikes.filter(row => row.details.result.ok &&
    row.details.result.code === 'object_stopped_moving' &&
    typeof row.details.result.resultObjectId === 'string');
  const carcassIds = new Set(kills.map(row => row.details.result.resultObjectId));
  const pulls = events.filter(row => row.details.action.type === 'pull' &&
    row.details.result.ok && carcassIds.has(row.details.action.targetId));
  const pieces = new Set(pulls.map(row => row.details.result.materialId));
  const samples = events.filter(row => row.details.action.type === 'sample' &&
    row.details.result.ok && pieces.has(row.details.action.targetId));
  const sampleIds = new Set(samples.map(row => row.details.result.ingestionId));
  const exact = [...ingestions.values()].filter(row => sampleIds.has(row.id));
  const other = [...ingestions.values()].filter(row => !sampleIds.has(row.id));
  const effects = trace.filter(row => row.actorId === actor.id &&
    row.type === 'condition' && row.details.code === 'DISCOVERY_EFFECT' &&
    sampleIds.has(row.details.feedback?.ingestionId));
  const resultCodes = {};
  for (const event of events) {
    const key = `${event.details.action.type}:${event.details.result.code}`;
    resultCodes[key] = (resultCodes[key] || 0) + 1;
  }
  const scavenged = events.filter(row => row.details.action.type === 'pull' &&
    row.details.result.ok && row.instrumentation?.targetKindBefore === 'carcass' &&
    !carcassIds.has(row.details.action.targetId));
  return {
    actualTravelPx: travel, initialBody, finalBody: body(actor),
    metabolizedKcal: actor.physiology.totals.metabolizedKcal - initialBody.totals.metabolizedKcal,
    waterLostMl: actor.physiology.totals.waterLostMl - initialBody.totals.waterLostMl,
    attemptedStrikeReceipts: strikes.length,
    landedContacts: strikes.filter(row => row.details.result.ok &&
      ['object_recoiled', 'object_stopped_moving'].includes(row.details.result.code)).length,
    reachFailures: strikes.filter(row => ['OUT_OF_REACH', 'object_out_of_reach'].includes(row.details.result.code)).length,
    lineOfSightFailures: strikes.filter(row => row.details.result.code === 'INTERACTION_BLOCKED').length,
    terminalStrikes: kills.length, exactCarcassIds: [...carcassIds],
    exactCarcassPulls: pulls.length, exactPieceIds: [...pieces],
    exactSamples: samples.length, exactIngestions: exact,
    exactSwallowedKcal: exact.reduce((sum, row) => sum + row.originalKcal, 0),
    exactAbsorbedKcal: exact.reduce((sum, row) => sum + row.absorbedKcal, 0),
    exactDelayedEffects: effects, otherIngestions: other,
    scavengedCarcassPulls: scavenged, actionResults: resultCodes,
    firstChainAt: samples[0]?.at ?? null,
    retainedProofError: retainedProofIntegrityError(actor),
    ordinaryPowerHuntingEstablishedByThisRow: samples.length > 0,
    autonomousPolicy: 'autonomous row only; commanded row is externally selected test input',
  };
}

export function runCarcassEncounter(mode) {
  assert.ok(['commanded', 'autonomous'].includes(mode));
  const { state, actor, fixture, blocked } = createCarcassEncounterFixture();
  if (blocked) return { mode, fixture, blocked: true, elapsed: 0, commands: [],
    trace: [], summary: { attemptedStrikeReceipts: 0, landedContacts: 0,
      terminalStrikes: 0, exactCarcassPulls: 0, exactSamples: 0,
      exactSwallowedKcal: 0, exactAbsorbedKcal: 0, exactDelayedEffects: [],
      ordinaryPowerHuntingEstablishedByThisRow: false } };
  const commands = [], trace = [], telemetry = [], ingestions = new Map();
  const initialBody = body(actor), lastEventIds = new Map(), lastActive = new Map();
  const runtime = new PopulationRuntime(state, { cardinal: false });
  // Native initial perception, not a supplied rabbit/food observation.
  for (const npc of state.agents) observeNpc(npc, state.environment);
  const initialExposureObserved = Boolean(actor.discovery.observations[fixture.targetId]);
  if (mode === 'commanded') {
    runtime.controller(actor.id).dispose();
    runtime.controllers.set(actor.id,
      commandedController(actor, state.environment, fixture.targetId, commands));
  }
  let travel = 0, steps = 0, stopped = 'fixed-600-second-endpoint';
  try {
    for (let step = 1; step <= Math.round(600 / CONFIG.fixedStep); step++) {
      const position = point(actor.position);
      // Keep removed portions' final counters, without influencing physiology.
      const portions = [...actor.physiology.stomach];
      const materialsBefore = new Map(state.environment.ecology.materials.map(row => [row.id, row.kind]));
      state.elapsed += CONFIG.fixedStep;
      runtime.tick(CONFIG.fixedStep); steps++;
      travel += distance(position, actor.position);
      for (const portion of [...portions, ...actor.physiology.stomach]) {
        const prior = ingestions.get(portion.id);
        if (!prior || portion.absorbedKcal >= prior.absorbedKcal)
          ingestions.set(portion.id, copy(portion));
      }
      for (const npc of state.agents) {
        const lastId = lastEventIds.get(npc.id) ?? 0;
        for (const event of npc.memory.experience.filter(row => row.id > lastId)) {
          trace.push({ actorId: npc.id, ...copy(event),
            ...(event.type === 'action' ? { instrumentation: {
              targetKindBefore: materialsBefore.get(event.details.action?.targetId) ?? null } } : {}) });
          lastEventIds.set(npc.id, Math.max(lastEventIds.get(npc.id) ?? 0, event.id));
        }
        const activeKey = npc.active ? `${npc.active.startedAt}:${JSON.stringify(npc.active.request)}` : null;
        if (activeKey && lastActive.get(npc.id) !== activeKey)
          trace.push({ actorId: npc.id, at: npc.elapsed, type: 'action-admitted',
            action: copy(npc.active.request), startedAt: npc.active.startedAt,
            position: point(npc.position) });
        lastActive.set(npc.id, activeKey);
      }
      if (step === 1 || step % Math.round(1 / CONFIG.fixedStep) === 0) {
        const target = state.environment.ecology.animals.find(row => row.id === fixture.targetId);
        telemetry.push({ at: state.elapsed, aster: body(actor),
          target: target ? { id: target.id, position: point(target.position),
            health: target.physiology.health, activity: target.activity } : null,
          ecologyElapsed: state.environment.ecology.elapsed,
          materials: state.environment.ecology.materials.length,
          animals: state.environment.ecology.animals.length,
          births: state.environment.ecology.births, deaths: state.environment.ecology.deaths });
      }
      if (actor.lifecycle !== 'AWAKE') { stopped = 'terminal-actor-failure-no-rescue'; break; }
    }
    assert.equal(actor.stats.rescues, initialBody.rescues, 'No actor rescue may enter an unassisted row');
    assert.ok(Math.abs(state.environment.elapsed - state.elapsed) < 1e-8);
    for (const npc of state.agents) assert.ok(Math.abs(npc.elapsed - state.elapsed) < 1e-8);
    return { mode, fixture, blocked: false, elapsed: state.elapsed, steps, stopped,
      initialExposureObserved,
      finalActiveAction: actor.active ? copy(actor.active) : null,
      summary: summarize(actor, fixture, initialBody, trace, ingestions, travel),
      commands, trace, telemetry,
      instrumentation: 'Private body/target telemetry is measured after native ticks and never passed to the command selector. No encounter save is attempted.' };
  } finally { runtime.dispose(); }
}

async function fingerprint() {
  const paths = (await readdir(resolve(ROOT, 'src'))).filter(name => name.endsWith('.js'))
    .map(name => `src/${name}`);
  paths.push('scripts/measure-carcass-encounters.mjs', 'tests/fixtures/carcass-encounter.mjs');
  const rows = [];
  for (const path of paths.sort()) rows.push(`${path}:${digest(await readFile(resolve(ROOT, path)))}`);
  return { sha256: digest(rows.join('\n')), files: rows };
}

async function createOnly(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, 'wx');
  try { await file.writeFile(bytes); } finally { await file.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 4 && args[0] === '--protocol' && args[2] === '--output',
    'Usage: node scripts/measure-carcass-encounters.mjs --protocol <new-or-identical.json> --output <new-report.json>');
  const protocolPath = resolve(args[1]), output = resolve(args[3]);
  assert.notEqual(protocolPath, output);
  try { await createOnly(protocolPath, protocolBytes); }
  catch (error) { if (error.code !== 'EEXIST') throw error;
    assert.equal(await readFile(protocolPath, 'utf8'), protocolBytes, 'Frozen protocol must be identical'); }
  // The protocol is on disk before any ecology, actor, or outcome is generated.
  const source = await fingerprint(), trials = [];
  for (const mode of ['commanded', 'autonomous']) {
    console.error(`Starting fixed ${mode} 600-second row; no hunt-success requirement.`);
    trials.push(runCarcassEncounter(mode));
    console.error(JSON.stringify({ mode, summary: trials.at(-1).summary }));
  }
  assert.equal((await fingerprint()).sha256, source.sha256, 'Source changed during fixed measurement');
  assert.deepEqual(trials[0].fixture, trials[1].fixture, 'Rows require identical independent initial exposure');
  const report = { kind: ENCOUNTER_PROTOCOL.kind, protocolSha256: digest(protocolBytes),
    protocol: ENCOUNTER_PROTOCOL, source, measuredAt: new Date().toISOString(), trials,
    limitations: ['Node invokes native shared simulation APIs; this is not Electron disk verification.',
      'Remote local exposure is not demonstrated access from spawn.',
      'One commanded encounter is not learned or robust hunting; one unchanged-policy row is descriptive.',
      'Negative outcomes remain negative and do not authorize tuning or retries.',
      'Absorption is attributed only by exact retained action/material/ingestion identities; no net-profit or mass/water conservation claim.'] };
  await createOnly(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, sourceSha256: source.sha256,
    protocolSha256: report.protocolSha256, rows: trials.map(row => ({ mode: row.mode,
      elapsed: row.elapsed, summary: row.summary })) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
