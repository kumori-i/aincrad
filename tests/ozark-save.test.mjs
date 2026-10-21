import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry, OZARK_WORLD_PROFILE } from '../src/ozark-world-geometry.js';
import { OZARK_SAVE_KEY, createOzarkState, loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';
import { policyContext } from '../src/npc-memory.js';

const geometry = createOzarkWorldGeometry();
function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('fresh Ozark world creates both distinct lives and writes only its own slot', () => {
  const disk = storage(), historical = '{"protected":"original bytes"}';
  disk.setItem(CONFIG.saveKey, historical);
  const opened = loadOzarkSave(disk, geometry);
  assert.equal(opened.blocked, false);
  assert.equal(opened.exists, false);
  const state = opened.state;
  assert.equal(state.version, 11);
  assert.equal(state.geometryIdentity, OZARK_WORLD_PROFILE.identity);
  assert.deepEqual(state.agents.map(actor => actor.id), ['aster', 'mira']);
  assert.strictEqual(state.npc, state.agents[0]);
  assert.deepEqual(state.player, geometry.spawn);
  for (const actor of state.agents) {
    assert.deepEqual(actor.position, geometry.agentSpawns[actor.id]);
    assert.equal(actor.mode, 'discovery');
    assert.equal(actor.memory.experience.length, 0);
    assert.equal(geometry.canOccupy(actor.position.x, actor.position.y), true);
  }
  assert.deepEqual(state.playerBody,
    { wetness: 0, effort: 0, stamina: 100, health: 100 });
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  assert.equal(disk.getItem(CONFIG.saveKey), historical);
  const stored = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  assert.equal(stored.geometryIdentity, OZARK_WORLD_PROFILE.identity);
  assert.equal(Object.hasOwn(stored, 'npc'), false);
  assert.equal(Object.hasOwn(stored, 'cardinal'), false);
  assert.equal(loadOzarkSave(disk, geometry).blocked, false);
});

test('exact body and physically occupied swim and climb positions survive write/load', () => {
  const disk = storage(), state = createOzarkState(geometry);
  state.player = { x: -1200, y: 220 };
  state.agents[0].position = { x: -12000, y: 9800 };
  state.agents[1].position = { x: -11800, y: 11800 };
  state.playerBody = { wetness: 64.25, effort: .71, stamina: 39.5, health: 88.25 };
  assert.equal(geometry.classify(state.player.x, state.player.y).walkable, false);
  assert.equal(geometry.classify(state.agents[0].position.x,
    state.agents[0].position.y).walkable, false);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.deepEqual(reopened.state.player, state.player);
  assert.deepEqual(reopened.state.playerBody, state.playerBody);
  assert.deepEqual(reopened.state.agents.map(actor => actor.position),
    state.agents.map(actor => actor.position));
  assert.strictEqual(reopened.state.npc, reopened.state.agents[0]);
});

test('fractional ecology clock persists between half-second ecosystem steps', () => {
  const disk = storage(), state = createOzarkState(geometry);
  state.elapsed = .25;
  state.environment.elapsed = .25;
  state.environment.ecology.pending = .25;
  for (const actor of state.agents) actor.elapsed = .25;
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.equal(reopened.state.elapsed, .25);
  assert.equal(reopened.state.environment.elapsed, .25);
  assert.equal(reopened.state.environment.ecology.elapsed, 0);
  assert.equal(reopened.state.environment.ecology.pending, .25);
});

test('forged geometry, impossible positions, missing agents and altered body block without rewriting bytes', () => {
  const disk = storage(), state = createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const good = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  const cases = [
    raw => { raw.geometryIdentity = 'sha256:' + '0'.repeat(64); },
    raw => { raw.player = { x: 19000, y: 0 }; },
    raw => { raw.agents[0].position = { x: -19000, y: 0 }; },
    raw => { raw.agents.pop(); },
    raw => { raw.playerBody.wetness = 101; },
    raw => { raw.environment.ecology.geometryIdentity = 'sha256:' + '1'.repeat(64); },
    raw => { raw.futureWorldRule = true; },
  ];
  for (const change of cases) {
    const candidate = structuredClone(good);
    change(candidate);
    const bytes = JSON.stringify(candidate);
    disk.setItem(OZARK_SAVE_KEY, bytes);
    const opened = loadOzarkSave(disk, geometry);
    assert.equal(opened.blocked, true);
    assert.equal(opened.state, null);
    assert.match(opened.error, /protected/i);
    assert.equal(writeOzarkSave(disk, state, geometry), false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes);
  }
});

test('a source state cannot replace newer bytes and storage failures are reported', () => {
  const disk = storage(), state = createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const loaded = loadOzarkSave(disk, geometry);
  assert.equal(loaded.blocked, false, loaded.error);
  const newer = disk.getItem(OZARK_SAVE_KEY) + ' ';
  disk.setItem(OZARK_SAVE_KEY, newer);
  assert.equal(writeOzarkSave(disk, loaded.state, geometry), false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), newer);
  assert.equal(writeOzarkSave({getItem:()=>null,setItem(){throw new Error('full');}},
    createOzarkState(geometry), geometry), false);
});

test('malformed occupied Ozark bytes remain protected, including from a stale state', () => {
  const disk = storage(), state = createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const damaged = '{"version":9,"geometryIdentity":';
  disk.setItem(OZARK_SAVE_KEY, damaged);
  const opened = loadOzarkSave(disk, geometry);
  assert.equal(opened.exists, true);
  assert.equal(opened.blocked, true);
  assert.equal(opened.state, null);
  assert.match(opened.error, /^Ozark save protected:/);
  assert.equal(writeOzarkSave(disk, state, geometry), false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), damaged);
});

test('an interrupted action is cancelled once after restoration', () => {
  const disk = storage(), state = createOzarkState(geometry);
  state.agents[0].active = { request: { type: 'move' } };
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  assert.equal(JSON.parse(disk.getItem(OZARK_SAVE_KEY)).agents[0].interrupted, true);
  const opened = loadOzarkSave(disk, geometry);
  assert.equal(opened.blocked, false, opened.error);
  const interruptedReceipts = actor => actor.memory.experience.filter(event =>
    event.type === 'action' && event.details?.result?.code === 'RESTART_INTERRUPTED');
  assert.equal(interruptedReceipts(opened.state.agents[0]).length, 1);
  assert.equal(writeOzarkSave(disk, opened.state, geometry), true);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.equal(interruptedReceipts(reopened.state.agents[0]).length, 1);
});

test('swim and climb learned categories survive cancelled action restoration', () => {
  for (const type of ['swim', 'climb']) {
    const disk = storage(), state = createOzarkState(geometry);
    const actor = state.agents[0], context = policyContext(actor);
    actor.memory.values[`${context}::${type}`] = { attempts: 3, value: .75 };
    actor.memory.features[`${type}:thermal`] = .25;
    actor.active = { request: { type } };
    assert.equal(writeOzarkSave(disk, state, geometry), true);
    const opened = loadOzarkSave(disk, geometry);
    assert.equal(opened.blocked, false, opened.error);
    const restored = opened.state.agents[0];
    assert.deepEqual(restored.memory.values[`${context}::${type}`],
      { attempts: 3, value: .75 });
    assert.equal(restored.memory.features[`${type}:thermal`], .25);
    assert.equal(restored.memory.experience.at(-1).details.action.type, 'wait');
    assert.equal(restored.memory.experience.at(-1).details.result.code,
      'RESTART_INTERRUPTED');
  }
});

test('forged sample/effect proof and future timestamps protect the exact Ozark slot', () => {
  const disk = storage(), state = createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const good = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  for (const change of [
    raw => raw.agents[0].discovery.effects.push({
      id: 'feedback:1', at: 1, objectId: 'object:1', actionId: 1,
      ingestionId: 'ingestion:1', effect: 'water relief', source: 'experienced',
      proofEventId: 2,
    }),
    raw => raw.agents[0].memory.experience.push({
      id: 1, at: 1, type: 'action', details: { action: { type: 'sample',
        targetId: 'object:1' }, result: { ok: true, code: 'SWALLOWED' } },
    }),
  ]) {
    const forged = structuredClone(good);
    change(forged);
    const bytes = JSON.stringify(forged);
    disk.setItem(OZARK_SAVE_KEY, bytes);
    const opened = loadOzarkSave(disk, geometry);
    assert.equal(opened.blocked, true);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes);
  }
});

test('Ozark agent clocks and discovery observation times cannot exceed the shared world clock', () => {
  const disk = storage(), state = createOzarkState(geometry);
  state.elapsed = 10;
  state.environment.elapsed = 10;
  state.environment.ecology.elapsed = 10;
  for (const actor of state.agents) actor.elapsed = 10;
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const good = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  for (const change of [
    raw => { raw.agents[0].elapsed = 0; },
    raw => { raw.agents[0].discovery.observations['object:1'] = {
      id: 'object:1', scene: 'valley', position: { ...geometry.agentSpawns.aster },
      appearance: {}, observedAt: 11,
    }; },
    raw => { raw.agents[0].discovery.observations['object:999999'] = {
      id: 'object:999999', scene: 'valley', position: { x: 23000, y: 0 },
      appearance: {}, observedAt: 0,
    }; },
    raw => { raw.agents[0].discovery.observations['object:999999'] = {
      id: 'object:999999', scene: 'valley', position: { x: 8000, y: 8000 },
      appearance: {}, observedAt: 0,
    }; },
    raw => { raw.agents[0].discovery.samplesPending['object:1'] = 11; },
    raw => { raw.agents[0].discovery.trials['object:1|inspect_object'] = {
      attempts: 1, successes: 1, failures: 0, seconds: 1,
      lastAt: 11, lastCode: 'INSPECTED', lastOk: true,
    }; },
  ]) {
    const forged = structuredClone(good);
    change(forged);
    const bytes = JSON.stringify(forged);
    disk.setItem(OZARK_SAVE_KEY, bytes);
    assert.equal(loadOzarkSave(disk, geometry).blocked, true);
    assert.equal(writeOzarkSave(disk, state, geometry), false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes);
  }
});

// Deliberately constructed codec proof, not paid-controller capability evidence.
function learnedWaterFixture() {
  const disk = storage(), state = createOzarkState(geometry);
  state.elapsed = 20;
  state.environment.elapsed = 20;
  state.environment.ecology.elapsed = 20;
  for (const actor of state.agents) actor.elapsed = 20;
  const actor = state.agents[0];
  const objectId = 'object:1', ingestionId = 'ingestion:1';
  actor.discovery.observations[objectId] = {
    id: objectId, scene: 'valley', position: { ...actor.position },
    appearance: {}, observedAt: 2,
  };
  const sample = {
    id: 1, at: 10, primitive: 'sample', targetId: objectId,
    ok: true, code: 'SWALLOWED', durationSeconds: 1,
    actionId: 1, ingestionId,
  };
  const effect = {
    id: 'feedback:1', at: 12, objectId, actionId: 1,
    ingestionId, effect: 'water relief', hunger: 'unchanged',
    thirst: 'easing', energy: 'unchanged', pain: 'none',
    source: 'experienced', proofEventId: 2,
  };
  actor.discovery.nextId = 2;
  actor.discovery.experiments.push(sample);
  actor.discovery.effects.push(effect);
  actor.memory.nextId = 3;
  actor.memory.experience.push(
    { id: 1, at: 10, type: 'action', details: {
      action: { type: 'sample', targetId: objectId },
      result: { ok: true, code: 'SWALLOWED', ingestionId },
    } },
    { id: 2, at: 12, type: 'condition', details: {
      code: 'DISCOVERY_EFFECT', feedback: { ...effect },
    } },
  );
  return { disk, state, actor, sample, effect };
}

test('complete learned water effect keeps its exact sample and action proof through Ozark write/load', () => {
  const { disk, state, actor, sample, effect } = learnedWaterFixture();
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  const restored = reopened.state.agents[0];
  assert.deepEqual(restored.discovery.effects, [effect]);
  assert.deepEqual(restored.discovery.experiments, [sample]);
  assert.deepEqual(restored.memory.experience, actor.memory.experience);
  assert.equal(writeOzarkSave(disk, reopened.state, geometry), true);
  assert.equal(loadOzarkSave(disk, geometry).blocked, false);
});

test('current save protects the entire authoritative body and learned state against normalization', () => {
  const state = createOzarkState(geometry), disk = storage();
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  const good = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  for (const mutate of [
    a => { delete a.physiology.availableEnergyKcal; },
    a => { a.physiology.version = 99; },
    a => { a.physiology.profile = 'unknown'; },
    a => { a.physiology.totals.metabolizedKcal = -1; },
    a => { a.memory.features['unknown-category:thirst'] = 0; },
    a => { a.memory.values['invalid::wait'] = {attempts:1,value:99}; },
    a => { a.memory.effects.forged = {samples:1,hydration:1,nourishment:1}; },
    a => { a.stats.collapses = -1; },
  ]) {
    const bad = structuredClone(good); mutate(bad.agents[0]);
    const bytes = JSON.stringify(bad); disk.setItem(OZARK_SAVE_KEY,bytes);
    const opened = loadOzarkSave(disk,geometry);
    assert.equal(opened.blocked,true); assert.equal(opened.state,null);
    assert.equal(writeOzarkSave(disk,state,geometry),false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);
  }
});

test('current codec preserves exact bytes for every forged effect provenance link and duplicate ID', () => {
  const { disk, state } = learnedWaterFixture();
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  const good = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  const changes = [
    (a,s,r) => {r.details.action.targetId='object:999999';},
    (a,s,r) => {r.details.result.ok=false;},
    (a,s,r) => {r.details.result.ingestionId='ingestion:999999';},
    (a,s) => {s.targetId='object:999999';}, (a,s) => {s.ok=false;}, (a,s) => {s.at++;},
    a => {a.discovery.effects[0].objectId='object:999999';},
    a => {a.discovery.effects[0].ingestionId='ingestion:999999';},
    a => {a.discovery.effects[0].at=9;}, a => {a.discovery.effects[0].proofEventId=999999;},
    (a,s,r,p) => {p.details.feedback.source='reported';},
    (a,s,r,p) => {p.details.feedback.at++;}, (a,s,r,p) => {p.at=11;},
    (a,s,r) => {a.memory.experience.push(structuredClone(r));},
    (a,s) => {a.discovery.experiments.push(structuredClone(s));},
  ];
  for (const change of changes) {
    const bad=structuredClone(good), a=bad.agents[0];
    change(a,a.discovery.experiments[0],a.memory.experience[0],a.memory.experience[1]);
    const bytes=JSON.stringify(bad);disk.setItem(OZARK_SAVE_KEY,bytes);
    assert.equal(loadOzarkSave(disk,geometry).blocked,true);
    assert.equal(writeOzarkSave(disk,state,geometry),false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);
  }
});

test('current thermal, flask, lifecycle and world settings cannot be silently repaired', () => {
  const state=createOzarkState(geometry),disk=storage();
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  const good=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  for(const mutate of [
    raw=>{delete raw.agents[0].thermal.wetness;},
    raw=>{raw.agents[0].thermal.hot=-1;},
    raw=>{raw.agents[0].flask.water=2;},
    raw=>{raw.agents[0].lifecycle='unknown';},
    raw=>{raw.agents[0].memory.explorationCredit=-1;},
    raw=>{raw.agents[0].discovery.version=99;},
    raw=>{raw.agents[0].cognition.version=99;},
    raw=>{raw.agents[0].social.version=99;},
    raw=>{raw.community.version=99;},
    raw=>{raw.environment.schemaVersion=99;},
    raw=>{raw.environment.worldRules.version=99;},
    raw=>{raw.environment.worldRules.values.rainfallMultiplier=-1;},
    raw=>{delete raw.environment.worldRules.values.temperatureOffsetC;},
    raw=>{raw.environment.settings.hourOverride=25;},
    raw=>{raw.environment.settings.weatherOverride='invented';},
  ]) {
    const bad=structuredClone(good);mutate(bad);const bytes=JSON.stringify(bad);
    disk.setItem(OZARK_SAVE_KEY,bytes);assert.equal(loadOzarkSave(disk,geometry).blocked,true);
    assert.equal(writeOzarkSave(disk,state,geometry),false);assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);
  }
});
