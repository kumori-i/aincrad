import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';
import { freshState } from '../src/world.js';
import { beginSleep, ingestMaterial, projectPhysiology, tickPhysiology } from '../src/biology.js';
import { validateEnvironment } from '../src/environment.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { loadSave, prepareLegacyPendingMigration, writeSave } from '../src/save.js';
import { planProofRetention, retainedEffectProofError, retainedProofIntegrityError } from '../src/proof-retention.js';

const marker = 'legacy-physical-unknown';
const currentCopy = resolve(dirname(fileURLToPath(import.meta.url)),
  '../../evidence/live-original-save-20261016-1343.json');
const currentSha = 'c93c68e8777de00be6fd302f1a188fe693cccc3245befd24503056883295eae5';

function storage(value = null) {
  const values = new Map(value === null ? [] : [[CONFIG.saveKey, value]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, next) => values.set(key, next) };
}

function savedText(state) {
  const { npc: historicalAlias, ...saved } = state;
  return JSON.stringify(saved);
}

function protectedBytes(text, state = JSON.parse(text)) {
  const disk = storage(text);
  assert.equal(loadSave(disk).blocked, true, 'ordinary load cannot admit unproven history');
  assert.equal(writeSave(disk, state), false, 'ordinary write cannot commit unproven history');
  assert.equal(disk.getItem(CONFIG.saveKey), text, 'protected disk bytes stay exact');
}

function synthetic(count, { feedback = false, energyKcal = 0, waterMl = 1 } = {}) {
  const state = freshState({connectedEcology:false}), actor = state.agents[0], rows = [];
  for (let i = 0; i < count; i++) {
    const actionId = actor.memory.nextId++;
    const result = ingestMaterial(actor,
      { massGrams: 1, energyKcal, waterMl, digestHours: 2 },
      { source: 'sampled', objectId: 'object:1', actionId, at: actor.elapsed });
    assert.equal(result.code, 'SWALLOWED');
    rows.push(actor.physiology.stomach.at(-1));
    if (feedback) addFeedback(actor, rows.at(-1));
  }
  projectPhysiology(actor);
  return { state: JSON.parse(savedText(state)), actorId: actor.id,
    ids: rows.map(row => row.id) };
}

function addFeedback(actor, row, overrides = {}) {
  const feedback = { id: `feedback:${actor.physiology.nextId++}`, ingestionId: row.id,
    at: row.at, objectId: row.objectId, actionId: row.actionId,
    provenance: 'sampled', effect: 'water relief', hunger: 'unchanged',
    thirst: 'easing', energy: 'unchanged', pain: 'none', ...overrides };
  actor.physiology.feedback.push(feedback);
  return feedback;
}

function prepare(raw) {
  const result = prepareLegacyPendingMigration(savedText(raw));
  assert.equal(result.ok, true, result.reason);
  return result;
}

function assertPhysicalCopy(before, after, actorId) {
  const prior = before.agents.find(actor => actor.id === actorId);
  const copied = after.agents.find(actor => actor.id === actorId);
  const expected = structuredClone(prior.physiology);
  for (const row of expected.stomach) {
    if (row.provenance === 'sampled' && !prior.memory.experience.some(event => event.id === row.actionId) &&
        !prior.discovery.experiments.some(experiment => experiment.ingestionId === row.id))
      row.provenance = marker;
  }
  const receiptless = new Set(expected.stomach.filter(row => row.provenance === marker).map(row => row.id));
  for (const row of expected.feedback) if (receiptless.has(row.ingestionId)) row.provenance = marker;
  assert.deepEqual(copied.physiology, expected, `${actorId}: only named provenance changes in body`);
  assert.deepEqual(copied.discovery.effects, prior.discovery.effects, `${actorId}: retained effects exact`);
  assert.deepEqual(copied.discovery.experiments, prior.discovery.experiments, `${actorId}: experiments exact`);
  assert.equal(retainedEffectProofError(copied), null, `${actorId}: each learned effect has exact proof`);
  assert.equal(retainedProofIntegrityError(copied), null, `${actorId}: pending closure holds`);
  assert.equal(planProofRetention(copied).ok, true, `${actorId}: bounded proof plan holds`);
}

function advance(state, actor, seconds) {
  actor.elapsed += seconds;
  state.elapsed += seconds;
  state.environment = validateEnvironment(state.environment,
    { elapsed: state.elapsed, mode: state.simulationMode });
  tickPhysiology(actor, seconds);
}

function noLearning(actor, prior) {
  for (const key of ['effects', 'experiments', 'reports', 'techniques'])
    assert.deepEqual(actor.discovery[key], prior.discovery[key], `no ${key} credit`);
  assert.equal(actor.discovery.foodDiscoveries, prior.discovery.foodDiscoveries);
  assert.equal(actor.stats.independentMeals, prior.stats.independentMeals);
  assert.equal(actor.cognition.knowledgeGained, prior.cognition.knowledgeGained);
}

test('the exact current raw copy stays protected until explicit preflight, then preserves all 89 proofs and bodies twice', {
  skip: !existsSync(currentCopy),
}, () => {
  const bytes = readFileSync(currentCopy);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), currentSha, 'unaltered current raw copy');
  const original = bytes.toString('utf8'), before = JSON.parse(original);
  protectedBytes(original);
  const prepared = prepareLegacyPendingMigration(original);
  assert.equal(prepared.ok, true, prepared.reason);
  assert.deepEqual(prepared.report.migrations.map(row => [row.actorId, row.ingestionId, row.actionId]),
    [['mira', 'ingestion:4861', 42855]], 'exact receiptless current row');
  const candidate = JSON.parse(prepared.candidate);
  assert.equal(candidate.features.legacyPendingPhysicalOnly, 1);
  assert.equal(candidate.agents.reduce((sum, actor) => sum + actor.discovery.effects.length, 0), 89);
  for (const actor of before.agents) assertPhysicalCopy(before, candidate, actor.id);
  const mira = candidate.agents.find(actor => actor.id === 'mira');
  assert.equal(mira.physiology.stomach.find(row => row.id === 'ingestion:4861').provenance, marker);
  assert.equal(mira.physiology.feedback.find(row => row.id === 'feedback:4895').provenance, marker,
    'already seen feedback also loses learning authority');
  assert.ok(mira.discovery.seenFeedback.includes('feedback:4895'));
  assert.equal(prepareLegacyPendingMigration(prepared.candidate).ok, false, 'migration is single use');

  const disk = storage(prepared.candidate);
  for (let i = 0; i < 2; i++) {
    const opened = loadSave(disk);
    assert.equal(opened.blocked, false, `reopen ${i + 1}`);
    for (const actor of before.agents) assertPhysicalCopy(before, opened.state, actor.id);
    assert.equal(writeSave(disk, opened.state), true, `write ${i + 1}`);
    assert.equal(JSON.parse(disk.getItem(CONFIG.saveKey)).features.legacyPendingPhysicalOnly, 1);
  }
  assert.equal(createHash('sha256').update(readFileSync(currentCopy)).digest('hex'), currentSha,
    'test never writes the copied original');
});

test('zero, one, two and 24 independent receiptless rows use only the existing stomach bound', () => {
  const zero = synthetic(0).state;
  assert.equal(prepareLegacyPendingMigration(savedText(zero)).ok, false, 'zero eligible rows need no migration');
  assert.equal(loadSave(storage(savedText(zero))).blocked, false);
  for (const count of [1, 2, 24]) {
    const { state: raw, ids } = synthetic(count);
    protectedBytes(savedText(raw));
    const result = prepare(raw);
    assert.deepEqual(result.report.migrations.map(row => row.ingestionId), ids, `${count} rows admitted`);
    const candidate = JSON.parse(result.candidate);
    assertPhysicalCopy(raw, candidate, 'aster');
    assert.equal(candidate.agents[0].physiology.stomach.length, count);
    assert.ok(candidate.agents[0].physiology.stomach.every(row => row.provenance === marker));
    const disk = storage(result.candidate);
    assert.equal(loadSave(disk).blocked, false);
    assert.equal(writeSave(disk, loadSave(disk).state), true);
    assert.equal(loadSave(disk).blocked, false);
  }
  const tooMany = synthetic(24).state, actor = tooMany.agents[0];
  actor.physiology.stomach.push({ ...actor.physiology.stomach.at(-1),
    id: `ingestion:${actor.physiology.nextId++}`, actionId: actor.memory.nextId++ });
  assert.equal(actor.physiology.stomach.length, 25);
  assert.equal(prepareLegacyPendingMigration(savedText(tooMany)).ok, false);
  protectedBytes(savedText(tooMany));
});

test('marked digestion, sleep feedback, a pre-feedback save and a drained reopen grant no knowledge', () => {
  const raw = synthetic(1, { energyKcal: 16, waterMl: 24 }).state;
  const disk = storage(prepare(raw).candidate), opened = loadSave(disk);
  assert.equal(opened.blocked, false);
  let state = opened.state, actor = state.agents[0];
  const prior = structuredClone({ discovery: actor.discovery, stats: actor.stats,
    cognition: actor.cognition, totals: actor.physiology.totals });
  assert.equal(beginSleep(actor, { hours: 2 }).ok, true);
  advance(state, actor, 90);
  assert.ok(actor.physiology.stomach.length, 'absorption remains delayed');
  assert.ok(actor.physiology.totals.absorbedKcal > prior.totals.absorbedKcal);
  assert.ok(actor.physiology.feedback.some(row => row.provenance === marker), 'sleep emits inert feedback');
  assert.equal(writeSave(disk, state), true, 'unseen marked feedback survives a save');
  state = loadSave(disk).state; actor = state.agents[0];
  assert.ok(actor.physiology.feedback.some(row => row.provenance === marker &&
    !actor.discovery.seenFeedback.includes(row.id)));
  processDiscoveryFeedback(actor);
  noLearning(actor, prior);
  advance(state, actor, 350);
  assert.equal(actor.physiology.stomach.length, 0, 'physical digestion completes');
  processDiscoveryFeedback(actor);
  noLearning(actor, prior);
  assert.equal(writeSave(disk, state), true);
  state = loadSave(disk).state; actor = state.agents[0];
  noLearning(actor, prior);
  assert.equal(state.features.legacyPendingPhysicalOnly, 1, 'guard remains after the stomach drains');
  assert.ok(actor.physiology.feedback.every(row => row.provenance === marker));
});

test('a drained but unseen marked feedback row stays inert through write and reopen', () => {
  const raw = synthetic(1, { feedback: true, energyKcal: 16, waterMl: 24 }).state;
  const prepared = prepare(raw), disk = storage(prepared.candidate);
  let state = loadSave(disk).state, actor = state.agents[0];
  const prior = structuredClone({ discovery: actor.discovery, stats: actor.stats, cognition: actor.cognition });
  advance(state, actor, 350);
  assert.equal(actor.physiology.stomach.length, 0);
  assert.ok(actor.physiology.feedback.some(row => row.provenance === marker &&
    !actor.discovery.seenFeedback.includes(row.id)));
  assert.equal(writeSave(disk, state), true, 'unseen feedback is a valid post-drain physical owner');
  state = loadSave(disk).state; actor = state.agents[0];
  assert.equal(planProofRetention(actor).ok, true);
  processDiscoveryFeedback(actor);
  noLearning(actor, prior);
  assert.equal(writeSave(disk, state), true);
  assert.equal(loadSave(disk).blocked, false);
});

test('a seen-cursor rollover cannot reclassify current historical feedback as sampled learning', {
  skip: !existsSync(currentCopy),
}, () => {
  const raw = JSON.parse(readFileSync(currentCopy, 'utf8'));
  const prepared = prepare(raw), disk = storage(prepared.candidate);
  const state = loadSave(disk).state, mira = state.agents.find(actor => actor.id === 'mira');
  const prior = structuredClone({ discovery: mira.discovery, stats: mira.stats, cognition: mira.cognition });
  assert.ok(mira.discovery.seenFeedback.includes('feedback:4895'));
  mira.discovery.seenFeedback = [...mira.discovery.seenFeedback.filter(id => id !== 'feedback:4895'),
    'feedback:1'];
  assert.equal(mira.discovery.seenFeedback.length, 128);
  assert.equal(mira.discovery.seenFeedback.includes('feedback:4895'), false);
  processDiscoveryFeedback(mira);
  assert.ok(mira.discovery.seenFeedback.includes('feedback:4895'));
  noLearning(mira, prior);
  assert.equal(planProofRetention(mira).ok, true);
  assert.equal(writeSave(disk, state), true);
  assert.equal(loadSave(disk).blocked, false);
});

test('preflight rejects one invalid row, identity swaps, impossible physical state and forged proof atomically', () => {
  const cases = [
    ['reused action ID', s => { s.agents[0].physiology.stomach[1].actionId = s.agents[0].physiology.stomach[0].actionId; }],
    ['reused ingestion ID', s => { s.agents[0].physiology.stomach[1].id = s.agents[0].physiology.stomach[0].id; }],
    ['zero action ID', s => { s.agents[0].physiology.stomach[1].actionId = 0; }],
    ['leading-zero ingestion alias', s => { s.agents[0].physiology.stomach[1].id = 'ingestion:02'; }],
    ['leading-zero object alias', s => { s.agents[0].physiology.stomach[1].objectId = 'object:01'; }],
    ['action above high water', s => { s.agents[0].physiology.stomach[1].actionId = s.agents[0].memory.nextId; }],
    ['ingestion above high water', s => { s.agents[0].physiology.stomach[1].id = `ingestion:${s.agents[0].physiology.nextId}`; }],
    ['object above high water', s => { s.agents[0].physiology.stomach[1].objectId = `object:${s.environment.ecology.nextId}`; }],
    ['future action time', s => { s.agents[0].physiology.stomach[1].at = s.elapsed + 1; }],
    ['negative remaining mass', s => { s.agents[0].physiology.stomach[1].remainingMassGrams = -1; }],
    ['nonfinite remaining mass', s => { s.agents[0].physiology.stomach[1].remainingMassGrams = Infinity; }],
    ['remaining mass over original', s => { s.agents[0].physiology.stomach[1].remainingMassGrams = 2; }],
    ['remaining water plus absorbed overflow', s => { s.agents[0].physiology.stomach[1].absorbedWaterMl = 2; }],
    ['negative toxicity', s => { s.agents[0].physiology.stomach[1].toxicity = -.1; }],
    ['aggregate mass exceeds the existing stomach capacity', s => {
      const [first, second] = s.agents[0].physiology.stomach;
      first.originalMassGrams = first.remainingMassGrams = 700;
      second.originalMassGrams = second.remainingMassGrams = 701;
    }],
    ['nonfinite body total', s => { s.agents[0].physiology.totals.ingestedWaterMl = Infinity; }],
    ['invalid second row among valid rows', s => { s.agents[0].physiology.stomach[1].digestHours = 0; }],
    ['present conflicting receipt', s => {
      const actor = s.agents[0], row = actor.physiology.stomach[1];
      actor.memory.experience.push({ id: row.actionId, at: row.at, type: 'action',
        details: { action: { type: 'inspect_object', targetId: row.objectId },
          result: { ok: true, code: 'SWALLOWED', ingestionId: row.id } } });
    }],
    ['present conflicting experiment', s => {
      const actor = s.agents[0], row = actor.physiology.stomach[1];
      actor.discovery.experiments.push({ id: actor.discovery.nextId++, actionId: row.actionId,
        ingestionId: row.id, at: row.at, primitive: 'sample', targetId: row.objectId,
        ok: false, code: 'SWALLOWED' });
    }],
    ['retained effect claims unproven ingestion', s => {
      const actor = s.agents[0], row = actor.physiology.stomach[1];
      actor.discovery.effects.push({ id: 'feedback:987', at: row.at,
        objectId: row.objectId, actionId: row.actionId, ingestionId: row.id,
        effect: 'water relief', source: 'experienced', proofEventId: 987 });
    }],
    ['swapped feedback action', s => {
      const actor = s.agents[0], [first, second] = actor.physiology.stomach;
      addFeedback(actor, first, { actionId: second.actionId });
    }],
    ['duplicate feedback ID', s => {
      const actor = s.agents[0], [first, second] = actor.physiology.stomach;
      const one = addFeedback(actor, first);
      addFeedback(actor, second, { id: one.id });
    }],
    ['feedback above high water', s => {
      const actor = s.agents[0], row = actor.physiology.stomach[1];
      addFeedback(actor, row, { id: `feedback:${actor.physiology.nextId + 1}` });
    }],
    ['feedback before action', s => {
      const actor = s.agents[0], row = actor.physiology.stomach[1];
      addFeedback(actor, row, { at: row.at - 1 });
    }],
    ['feedback after actor time', s => {
      const actor = s.agents[0], row = actor.physiology.stomach[1];
      addFeedback(actor, row, { at: actor.elapsed + 1 });
    }],
    ['unanchored sampled feedback', s => {
      const actor = s.agents[0], actionId = actor.memory.nextId++;
      addFeedback(actor, actor.physiology.stomach[0],
        { ingestionId: `ingestion:${actor.physiology.nextId}`, actionId });
    }],
  ];
  for (const [name, change] of cases) {
    const { state } = synthetic(2);
    change(state);
    const text = savedText(state);
    assert.equal(prepareLegacyPendingMigration(text).ok, false, name);
    protectedBytes(text, state);
  }
});

test('forged persisted unknown-provenance rows or feature guards remain protected on disk', () => {
  const valid = JSON.parse(prepare(synthetic(1, { feedback: true }).state).candidate);
  const cases = [
    ['missing sticky feature', s => { delete s.features.legacyPendingPhysicalOnly; }],
    ['wrong feature value', s => { s.features.legacyPendingPhysicalOnly = 0; }],
    ['sampled relapse', s => { s.agents[0].physiology.stomach[0].provenance = 'sampled'; }],
    ['feedback sampled relapse', s => { s.agents[0].physiology.feedback[0].provenance = 'sampled'; }],
    ['zero action', s => { s.agents[0].physiology.stomach[0].actionId = 0; }],
    ['ingestion alias', s => { s.agents[0].physiology.stomach[0].id = 'ingestion:01'; }],
    ['object alias', s => { s.agents[0].physiology.stomach[0].objectId = 'object:01'; }],
    ['feedback ingestion alias', s => { s.agents[0].physiology.feedback[0].ingestionId = 'ingestion:01'; }],
    ['quantity overflow', s => { s.agents[0].physiology.stomach[0].remainingWaterMl = 2; }],
    ['feedback identity mismatch', s => { s.agents[0].physiology.feedback[0].actionId++; }],
    ['feedback future time', s => { s.agents[0].physiology.feedback[0].at = s.elapsed + 1; }],
    ['actor clock beyond world', s => { s.agents[0].elapsed = s.elapsed + 1; }],
    ['marked stomach beyond world time', s => {
      s.agents[0].elapsed = s.elapsed + 1;
      s.agents[0].physiology.stomach[0].at = s.elapsed + .5;
      s.agents[0].physiology.feedback[0].at = s.elapsed + .5;
    }],
    ['marked feedback beyond world time', s => {
      s.agents[0].elapsed = s.elapsed + 1;
      s.agents[0].physiology.feedback[0].at = s.elapsed + .5;
    }],
  ];
  for (const [name, change] of cases) {
    const state = structuredClone(valid);
    change(state);
    const text = savedText(state), disk = storage(text);
    assert.equal(loadSave(disk).blocked, true, name);
    assert.equal(writeSave(disk, state), false, name);
    assert.equal(disk.getItem(CONFIG.saveKey), text, `${name}: exact bytes preserved`);
  }
});

test('a retained learned effect cannot share a drained historical feedback identity', {
  skip: !existsSync(currentCopy),
}, () => {
  const raw = JSON.parse(readFileSync(currentCopy, 'utf8'));
  const valid = JSON.parse(prepare(raw).candidate);
  const mira = valid.agents.find(actor => actor.id === 'mira');
  const currentIds = new Set(mira.physiology.feedback.map(row => row.id));
  const oldEffect = mira.discovery.effects.find(effect => !currentIds.has(effect.id));
  assert.ok(oldEffect, 'a learned effect whose feedback rotated out exists');
  const marked = mira.physiology.feedback.find(row => row.provenance === marker);
  assert.ok(marked);
  marked.id = oldEffect.id;
  protectedBytes(savedText(valid), valid);
});
