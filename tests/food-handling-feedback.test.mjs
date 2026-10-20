import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import * as npcApi from '../src/npc.js';
import { requestDiscoveryAction, tickDiscoveryAction, takeDiscoveryActionFeedback } from '../src/discovery-actions.js';
import { exertPhysiology, ingestMaterial, projectPhysiology } from '../src/biology.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { collectDiscoveryCandidateSnapshot as collect, DISCOVERY_CANDIDATE_LIMITS } from '../src/discovery-candidates.js';
import { validateNpc, recordEvent } from '../src/npc-memory.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { canStand, freshState } from '../src/world.js';
import { lineOfSight } from '../src/perception.js';
import { writeSave, loadSave } from '../src/save.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { tickOzarkEcology } from '../src/ozark-ecology.js';
import { createJuvenileFixture } from './fixtures/juvenile-interactions.mjs';
import { contractActor, actionReceipt } from './fixtures/discovery-candidates/contract-actor.mjs';

const { requestNpcAction, tickNpc, observeNpc, cancelNpcAction, collapseNpc } = npcApi;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const clone = structuredClone;
const food = report => report.candidates.find(c => c.id.startsWith('food:'));
const receipt = (n, id) => n.memory.experience.find(e => e.id === id);
const latestReceipt = n => receipt(n, n.lastResult.eventId);
const felt = (seconds, effort = 'rising') => ({ source: 'experienced', activeActionSeconds: seconds, effort });

// Fresh seeded worlds and the existing finite-grown juvenile fixture only. No
// live save, captured private actor, or assigned edible-object answer is used.
function fixture() {
  const n = createNpc({ mode: 'discovery', seed: 74193 }), e = createEnvironment(74193, { mode: 'discovery' });
  const plant = e.ecology.plants.find(p => p.kind === 'apple_tree');
  n.position = [[45, 0], [-45, 0], [0, 45], [0, -45]].map(([x, y]) => ({ x: plant.position.x + x, y: plant.position.y + y }))
    .find(p => canStand(p.x, p.y, 'valley') && lineOfSight(p, plant.position));
  assert.ok(n.position); observeNpc(n, e); assert.ok(n.discovery.observations[plant.id]);
  return { n, e, plant };
}
function juvenileFixture() {
  const f = createJuvenileFixture({ grown: true }), n = createNpc({ mode: 'discovery', seed: 74193 });
  n.position = [{ ...f.juvenile.position }, ...[[20, 0], [-20, 0], [0, 20], [0, -20]].map(([x, y]) => ({ x: f.juvenile.position.x + x, y: f.juvenile.position.y + y }))]
    .find(p => canStand(p.x, p.y, 'valley') && lineOfSight(p, f.juvenile.position));
  assert.ok(n.position); observeNpc(n, f.env); assert.ok(n.discovery.observations[f.juvenile.id]);
  return { n, e: f.env, plant: f.juvenile };
}
function start(f, type = 'pull', targetId = f.plant.id, api = npcApi) {
  assert.equal(api.requestNpcAction(f.n, { type, targetId }, f.e).code, 'ACTION_STARTED'); return f.n.active;
}
function finish(f, type, targetId = f.plant.id, api = npcApi) {
  const active = start(f, type, targetId, api);
  for (let i = 0; f.n.active && i < 200; i++) api.tickNpc(f.n, .1, f.e);
  assert.equal(f.n.active, null); return { result: f.n.lastResult, active };
}
function assertHandling(n, active, result = n.lastResult) {
  assert.equal(result.handling?.source, 'experienced');
  near(result.handling.activeActionSeconds, active.seconds);
  assert.equal(result.handling.effort, 'rising');
  assert.deepEqual(Object.keys(result.handling).sort(), ['activeActionSeconds', 'effort', 'source']);
  assert.deepEqual(latestReceipt(n).details.result.handling, result.handling);
  assert.equal(n.discovery.experiments.at(-1).handling, undefined, 'no new experiment ownership/copy');
  assert.equal(takeDiscoveryActionFeedback(n, active), null, 'receipt consumed the runtime witness once');
}
function withContractHandling() {
  const n = contractActor();
  for (const id of [1, 2]) receipt(n, id).details.result.handling = felt(receipt(n, id).details.result.durationSeconds);
  return n;
}
function withoutHandling(n) {
  const out = clone(n); if (out.lastResult) { delete out.lastResult.handling; delete out.lastResult.ownHand; }
  for (const e of out.memory.experience) if (e.type === 'action' && e.details.result) { delete e.details.result.handling; delete e.details.result.ownHand; }
  return out;
}

// Reconstruct exact main 3ed43543530c149ec404212aab0d1ef3165648c8 bytes by
// removing only this patch's additions. Hashes make unrelated edits fail closed;
// no .git directory, new frozen archive or hand-written baseline is required.
// The NPC baseline imports the baseline discovery helper, not today's helper.
const hashes = {
  'discovery-actions.js': '0e210b3ac40f7d5fa0411d94e03aa272d74c229cd8a1d23bc7304205ea5415cc',
  'npc.js': '66f22afe48331bc902d89a1989a6fbfe9bb8eab4d5a4785b88f546e5481bcf73',
};
function baselineModule(name, replacements = {}) {
  let source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
  // Remove the later additive own-hand sensor before reconstructing the exact
  // historical handling baseline. Its original byte hashes remain unchanged.
  if (name === 'discovery-actions.js') source = source
    .replace(/^import .* from '\.\/own-hand-memory\.js';\n/m, '')
    .replace(/^\/\/ A separate sensor witness[\s\S]*?\n}\n(?=export function takeDiscoveryActionFeedback)/m, '')
    .replace(/^  if\(request\.type==='sample'&&handlingWitnesses\.has\(npc\.active\)\)[\s\S]*?physiology:npc\.physiology,seconds}\);\n/m, '')
    .replace('let terminal=false,handObservation=null;', 'let terminal=false;')
    .replace(/^    if\(ownHandWitnesses\.has\(active\)\)ownHandWitness\(npc,active\);\n/m, '')
    .replace('let result,handBefore=false,sampleActionId;', 'let result;')
    .replace(/^      const hand=ownHandWitness\(npc,active\);[\s\S]*?check\.physical\.heldBy===npc\.id\);\n/m, '')
    .replace(/^      sampleActionId=npc\.memory\?\.nextId\|\|0;\n/m, '')
    .replace('actionId:sampleActionId', 'actionId:npc.memory?.nextId||0')
    .replace(/^    if\(handBefore&&ownHandWitness[\s\S]*?\n    }\n/m, '')
    .replace(/^    retireNativeOwnHand\(handObservation\);\n/m, '')
    .replace(/^    if\(terminal\|\|npc\.active!==active\)ownHandWitnesses\.delete\(active\);\n/m, '');
  if (name === 'discovery-actions.js') source = source
    .replace(/\/\/ Runtime-only witnesses\.[\s\S]*?\n};\n(?=function allowed)/,
      'const done=(complete,npc,request,result,active)=>complete?complete(npc,request,result,undefined,active?.startPosition,active?.startScene):result;\n')
    .replace(/^  if\(Number\.isFinite\(npc\.physiology\?\.fatigue\)[\s\S]*?worked:0\}\);\n/m, '')
    .replace(/^    \/\/ A throwing or synchronously cancelling hook[\s\S]*?witness\.worked\+=worked;\n/m, '')
    .replace(/^    if\(terminal\|\|npc\.active!==active\)handlingWitnesses\.delete\(active\);\n/m, '');
  else source = source
    .replace('relievePhysiology, projectPhysiology', 'relievePhysiology')
    .replace('      // The immediate transfer changes fullness, not absorbed relief. Keep the\n      // derived body display and original receipt consistent before any save.\n      projectPhysiology(npc);\n', '')
    .replace('requestDiscoveryAction, tickDiscoveryAction, takeDiscoveryActionFeedback', 'requestDiscoveryAction, tickDiscoveryAction')
    .replace(/^  const handling=takeDiscoveryActionFeedback\(npc,active\);\n  if\(handling\)result\.handling=handling;\n/m, '');
  assert.equal(createHash('sha256').update(source).digest('hex'), hashes[name], `frozen ${name} bytes`);
  const imported = source.replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${replacements[path] || new URL(`../src/${path.slice(2)}`, import.meta.url).href}'`);
  return `data:text/javascript;base64,${Buffer.from(imported).toString('base64')}`;
}
const baselineDiscoveryUrl = baselineModule('discovery-actions.js');
const baselineDiscovery = await import(baselineDiscoveryUrl);
const baselineNpc = await import(baselineModule('npc.js', { './discovery-actions.js': baselineDiscoveryUrl }));

test('real pull, sample, release, grasp and inspect record only paid qualitative handling', () => {
  const f = fixture();
  let completed = finish(f, 'pull'); assert.equal(completed.result.ok, true); assertHandling(f.n, completed.active);
  const id = f.n.inventory.items[0];
  for (const type of ['inspect_object', 'sample', 'release', 'grasp']) {
    completed = finish(f, type, id); assert.equal(completed.result.ok, true, type); assertHandling(f.n, completed.active);
  }
  assert.ok(f.n.physiology.totals.metabolizedKcal > 0);
});

test('a real strike retains four paid seconds and exactly one finite physical loss', () => {
  const f = juvenileFixture(), mass = f.plant.structureMassGrams;
  const { result, active } = finish(f, 'strike'); assert.equal(result.code, 'object_damaged');
  assertHandling(f.n, active); near(f.plant.structureMassGrams, mass - 10);
  f.n.active = active; assert.equal(tickDiscoveryAction(f.n, 4, f.e), false);
  assert.equal(f.n.active, null); near(f.plant.structureMassGrams, mass - 10);
});

test('admission and ordinary immediate refusal have no effort estimate', () => {
  const f = fixture(), before = clone(f.n.physiology);
  const denied = requestNpcAction(f.n, { type: 'sample', targetId: f.plant.id }, f.e);
  assert.equal(denied.code, 'NOT_HELD'); assert.equal(denied.handling, undefined);
  assert.equal(f.n.lastResult.handling, undefined); assert.deepEqual(f.n.physiology, before);
  const active = start(f); assert.equal(f.n.active.handling, undefined);
  assert.equal(cancelNpcAction(f.n), true); assert.equal(f.n.lastResult.handling, undefined);
  assert.equal(takeDiscoveryActionFeedback(f.n, active), null);
});

test('actual cancellation and collapse report only completed partial work without physical completion', () => {
  for (const collapse of [false, true]) {
    const f = fixture(), before = clone(f.e), active = start(f);
    tickNpc(f.n, .25, f.e); tickNpc(f.n, .25, f.e);
    assert.equal(collapse ? collapseNpc(f.n, 'test interruption') : cancelNpcAction(f.n), true);
    assert.equal(f.n.lastResult.code, collapse ? 'COLLAPSED' : 'PRIORITY_CHANGED');
    assert.deepEqual(f.n.lastResult.handling, felt(.5)); assert.deepEqual(latestReceipt(f.n).details.result.handling, felt(.5));
    assert.deepEqual(f.e, before); assert.equal(f.n.active, null); assert.equal(takeDiscoveryActionFeedback(f.n, active), null);
  }
});

test('late revalidation and body-capacity failures preserve paid effort, never completed material effects', () => {
  const f = fixture(), world = clone(f.e), active = start(f);
  tickNpc(f.n, .25, f.e); f.n.position = { x: f.plant.position.x + 1000, y: f.plant.position.y };
  for (let i = 0; f.n.active && i < 100; i++) tickNpc(f.n, .25, f.e);
  assert.equal(f.n.lastResult.code, 'OUT_OF_REACH'); assertHandling(f.n, active); assert.deepEqual(f.e, world);
  const g = fixture(); finish(g, 'pull'); const id = g.n.inventory.items[0];
  while (g.n.physiology.stomach.length < 24) assert.equal(ingestMaterial(g.n, { massGrams: 1, energyKcal: 0, waterMl: 0, digestHours: 24 }, { provenance: 'bounded test fixture' }).ok, true);
  const material = clone(lookupEcologyObject(g.e.ecology, id)), result = finish(g, 'sample', id);
  assert.equal(result.result.code, 'TOO_FULL'); assertHandling(g.n, result.active);
  assert.deepEqual(lookupEcologyObject(g.e.ecology, id), material);
});

test('the net-fatigue/stamina convention can be steady despite real expenditure', () => {
  const f = fixture(); f.n.physiology.fatigue = 100; f.n.physiology.stamina = 0; projectPhysiology(f.n);
  assert.equal(requestDiscoveryAction(f.n, { type: 'pull', targetId: f.plant.id }, f.e).code, 'ACTION_STARTED');
  const active = f.n.active, spent = f.n.physiology.totals.metabolizedKcal; let result;
  tickDiscoveryAction(f.n, active.seconds, f.e, { complete(n, request, value) { result = value; } });
  assert.deepEqual(result.handling, felt(active.seconds, 'steady'));
  assert.ok(f.n.physiology.totals.metabolizedKcal > spent, 'steady never means free');
  assert.equal(result.durationSeconds, active.seconds);
});

test('the witness drains once and cannot be borrowed by another actor or a copied active command', () => {
  const f = fixture(), active = start(f); tickNpc(f.n, .25, f.e);
  const impostor = clone(f.n); impostor.active = active;
  assert.equal(takeDiscoveryActionFeedback(impostor, active), null);
  assert.equal(takeDiscoveryActionFeedback(f.n, clone(active)), null);
  assert.deepEqual(takeDiscoveryActionFeedback(f.n, active), felt(.25));
  assert.equal(takeDiscoveryActionFeedback(f.n, active), null);
  cancelNpcAction(f.n); assert.equal(f.n.lastResult.handling, undefined);
});

test('a replaced physiology, discovery, primitive or target cannot inherit a runtime witness', () => {
  const changes = {
    physiology: f => { f.n.physiology = clone(f.n.physiology); },
    discovery: f => { f.n.discovery = clone(f.n.discovery); },
    primitive: f => { f.n.active.request.type = 'inspect_object'; },
    target: f => { f.n.active.request.targetId = 'object:999999'; },
    copiedActive: f => { f.n.active = clone(f.n.active); },
  };
  for (const [label, change] of Object.entries(changes)) {
    const f = fixture(); start(f); tickNpc(f.n, .25, f.e); change(f);
    cancelNpcAction(f.n); assert.equal(f.n.lastResult.handling, undefined, label);
  }
});

test('synchronous exertion cancellation excludes its unreturned work slice and retains earlier acknowledged work', () => {
  for (const prior of [0, .25]) for (const collapse of [false, true]) {
    const f = fixture(), active = start(f), world = clone(f.e);
    if (prior) tickDiscoveryAction(f.n, prior, f.e);
    tickDiscoveryAction(f.n, .5, f.e, { exert(n, seconds, effort) {
      exertPhysiology(n, seconds, effort);
      if (collapse) collapseNpc(n, 'hook interruption'); else cancelNpcAction(n);
    } });
    assert.deepEqual(f.n.lastResult.handling, prior ? felt(prior) : undefined);
    assert.deepEqual(f.e, world); assert.equal(takeDiscoveryActionFeedback(f.n, active), null);
  }
});

test('throwing exertion retires uncertified work and cannot later synthesize a receipt', () => {
  const f = fixture(), active = start(f), world = clone(f.e);
  tickDiscoveryAction(f.n, .25, f.e);
  assert.throws(() => tickDiscoveryAction(f.n, .5, f.e, { exert(n, seconds, effort) {
    exertPhysiology(n, seconds, effort); throw new Error('deliberate exertion failure');
  } }), /deliberate exertion failure/);
  assert.equal(f.n.active, null); assert.equal(takeDiscoveryActionFeedback(f.n, active), null); assert.deepEqual(f.e, world);
  f.n.active = active; assert.equal(tickDiscoveryAction(f.n, 5, f.e), false); assert.deepEqual(f.e, world);
});

test('hook reentry measures one returned slice; completion reentry and callback throws cannot duplicate it', () => {
  for (const throwing of [false, true]) {
    const f = fixture(); start(f); const active = f.n.active; let calls = 0, result;
    const run = () => tickDiscoveryAction(f.n, active.seconds, f.e, {
      exert(n, seconds, effort) { calls++; assert.equal(tickDiscoveryAction(n, seconds, f.e), false); exertPhysiology(n, seconds, effort); },
      complete(n, request, value) { result = value; assert.equal(takeDiscoveryActionFeedback(n, active), null); assert.equal(tickDiscoveryAction(n, 5, f.e), false); if (throwing) throw new Error('deliberate callback failure'); },
    });
    if (throwing) assert.throws(run, /deliberate callback failure/); else run();
    assert.equal(calls, 1); assert.deepEqual(result.handling, felt(active.seconds)); assert.equal(f.n.active, null);
  }
});

test('hook replacement cannot certify the old slice or lend its work to a new action', () => {
  const f = fixture(), old = start(f); let replacement;
  tickDiscoveryAction(f.n, .25, f.e);
  tickDiscoveryAction(f.n, .5, f.e, { exert(n, seconds, effort) {
    exertPhysiology(n, seconds, effort); cancelNpcAction(n); assert.deepEqual(n.lastResult.handling, felt(.25));
    replacement = start(f, 'inspect_object');
  } });
  assert.equal(f.n.active, replacement); assert.equal(takeDiscoveryActionFeedback(f.n, old), null);
  cancelNpcAction(f.n); assert.equal(f.n.lastResult.handling, undefined);
});

test('a hook changing a bound body or request cannot acknowledge its slice', () => {
  for (const change of [n => { n.physiology = clone(n.physiology); }, n => { n.discovery = clone(n.discovery); }, n => { n.active.request.type = 'inspect_object'; }, n => { n.active.request.targetId = 'object:999999'; }]) {
    const f = fixture(); start(f); tickDiscoveryAction(f.n, .25, f.e, { exert(n, seconds, effort) { exertPhysiology(n, seconds, effort); change(n); } });
    cancelNpcAction(f.n); assert.equal(f.n.lastResult.handling, undefined);
  }
});

test('sample handling is immediate while nutrient and harmful effects require later absorbed evidence', () => {
  const f = fixture(); finish(f, 'pull'); const id = f.n.inventory.items[0];
  const before = f.n.physiology.totals.absorbedKcal, completed = finish(f, 'sample', id), handling = clone(completed.result.handling);
  assertHandling(f.n, completed.active); assert.equal(completed.result.delayed, true);
  assert.equal(f.n.physiology.totals.absorbedKcal, before); assert.deepEqual(f.n.discovery.effects, []); assert.deepEqual(f.n.discovery.techniques, []);
  for (let i = 0; i < 1200 && !f.n.discovery.effects.some(e => e.effect === 'sustained'); i++) { tickNpc(f.n, .1, f.e); processDiscoveryFeedback(f.n); }
  const effect = f.n.discovery.effects.find(e => e.effect === 'sustained'); assert.ok(effect); assert.ok(effect.at > completed.result.at);
  assert.equal(effect.actionId, completed.result.eventId); assert.deepEqual(receipt(f.n, effect.actionId).details.result.handling, handling);
  const learned = food(collect(f.n)); assert.ok(learned);
  assert.equal(learned.observedEffort.rows.find(row => row.actionId === completed.result.eventId).activeActionSeconds, handling.activeActionSeconds);
  assert.ok(learned.observedEffects.rows.find(row => row.actionId === completed.result.eventId).feedbackDelaySeconds > 0);
  start(f, 'sample', id); tickNpc(f.n, .25, f.e); cancelNpcAction(f.n);
  const interrupted = food(collect(f.n)).observedEffort.rows.find(row => row.actionId === f.n.lastResult.eventId);
  assert.ok(interrupted); assert.equal(interrupted.ok, false); assert.equal(interrupted.activeActionSeconds, .25);
  assert.equal(interrupted.code, 'PRIORITY_CHANGED');
  // Explicit adverse-material intervention on an actually pulled finite piece.
  // Only toxicity/digestion are controlled; no agent observation or recipe gains
  // privileged data, and swallowing still uses the authoritative sample action.
  const adverse = fixture(); finish(adverse, 'pull'); const adverseId = adverse.n.inventory.items[0];
  Object.assign(lookupEcologyObject(adverse.e.ecology, adverseId), { toxicity: 1, digestHours: .1 });
  const health = adverse.n.physiology.health, sampled = finish(adverse, 'sample', adverseId), sample = sampled.result;
  assertHandling(adverse.n, sampled.active); assert.equal(sample.delayed, true);
  assert.equal(adverse.n.physiology.health, health); assert.deepEqual(adverse.n.discovery.effects, []);
  const originalHandling = clone(sample.handling);
  assert.ok(adverse.n.physiology.stomach.some(entry => entry.id === sample.ingestionId && entry.actionId === sample.eventId));
  for (let i = 0; i < 250 && !adverse.n.discovery.effects.some(e => e.effect === 'discomfort'); i++) {
    tickNpc(adverse.n, .1, adverse.e); processDiscoveryFeedback(adverse.n);
  }
  const harm = adverse.n.discovery.effects.find(e => e.effect === 'discomfort'); assert.ok(harm);
  assert.equal(harm.actionId, sample.eventId); assert.equal(harm.ingestionId, sample.ingestionId); assert.equal(harm.objectId, adverseId);
  assert.ok(harm.at > sample.at); assert.ok(adverse.n.physiology.health < health);
  assert.equal(receipt(adverse.n, harm.proofEventId).details.feedback.ingestionId, sample.ingestionId);
  assert.deepEqual(receipt(adverse.n, sample.eventId).details.result.handling, originalHandling);
});

test('current and old JSON actor saves roundtrip without backfilling work from durations or practice', () => {
  const f = fixture(), completed = finish(f, 'pull'), raw = JSON.parse(JSON.stringify(f.n));
  for (const old of [false, true]) {
    let value = old ? withoutHandling(raw) : clone(raw);
    for (let i = 0; i < 3; i++) value = validateNpc(JSON.parse(JSON.stringify(value)));
    const saved = receipt(value, completed.result.eventId).details.result;
    assert.deepEqual(saved.handling, old ? undefined : completed.result.handling);
    assert.deepEqual(value.lastResult.handling, old ? undefined : completed.result.handling);
    assert.equal(saved.durationSeconds, completed.result.durationSeconds); assert.deepEqual(value.discovery.practice, f.n.discovery.practice);
  }
});

test('full save reload interrupts active work without reconstructing a runtime witness', () => {
  const f = fixture(), active = start(f); tickNpc(f.n, .25, f.e);
  let stored; const storage = { getItem: () => stored, setItem: (key, value) => { stored = value; } };
  const state = freshState({ connectedEcology: false }); state.environment = f.e; state.elapsed = f.n.elapsed; state.agents[0] = state.npc = f.n;
  assert.equal(writeSave(storage, state), true); const loaded = loadSave(storage); assert.equal(loaded.blocked, false);
  const restored = loaded.state.npc, restart = restored.memory.experience.find(e => e.details.result?.code === 'RESTART_INTERRUPTED');
  assert.ok(restart); assert.equal(restart.details.result.handling, undefined); assert.equal(restored.active, null);
  assert.equal(takeDiscoveryActionFeedback(restored, active), null);
  restored.active = clone(active); cancelNpcAction(restored); assert.equal(restored.lastResult.handling, undefined);
});

test('collector uses original matched handling, copies only the allowlist and leaves policy/body untouched', () => {
  const n = withContractHandling(), before = clone(n);
  Object.assign(receipt(n, 1).details.result.handling, { fatigue: 99, stamina: 0, energyKcal: 999, nutrition: 'secret', species: 'secret', riskCost: 10 });
  const report = collect(n), c = food(report);
  assert.equal(c.observedEffort.retainedCount, 2); assert.equal(c.observedEffort.truncated, false);
  assert.deepEqual(c.observedEffort.rows.map(r => [r.actionId, r.experimentId, r.activeActionSeconds, r.effort, r.source]), [[1, 1, 5, 'rising', 'experienced'], [2, 2, 3.5, 'rising', 'experienced']]);
  assert.ok(c.missingCosts.includes('experienced-effort'), 'past rows do not certify complete retained/history coverage'); assert.ok(c.missingCosts.includes('future-effort'));
  assert.ok(Object.isFrozen(c.observedEffort.rows)); assert.ok(Object.isFrozen(c.observedEffort.rows[0]));
  assert.deepEqual(Object.keys(c.observedEffort.rows[0]).sort(), ['actionId', 'activeActionSeconds', 'at', 'code', 'effort', 'experimentId', 'ok', 'source', 'targetId', 'type']);
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.deepEqual(discoveryDecision(clone(n)), discoveryDecision(before));
  const unchanged = clone(n); collect(n); assert.deepEqual(n, unchanged);
  receipt(n, 1).details.result.handling.effort = 'steady'; assert.equal(c.observedEffort.rows[0].effort, 'rising');
});

test('unknown, malformed and legacy handling stays missing; redundant experiment values cannot supply it', () => {
  const invalid = [undefined, null, {}, Object.assign([], felt(5)), { ...felt(5), source: 'reported' }, { ...felt(5), effort: 'free' }, felt(0), felt(-1), felt(NaN), felt(Infinity), felt('5'), felt(30.01)];
  for (const value of invalid) {
    const n = withContractHandling(); receipt(n, 1).details.result.handling = value;
    n.discovery.experiments[0].handling = felt(5); n.discovery.practice.pull = { successes: 999, seconds: 999 };
    const c = food(collect(n)); assert.ok(!c.observedEffort.rows.some(r => r.actionId === 1)); assert.ok(c.missingCosts.includes('experienced-effort'));
  }
  const n = contractActor(), c = food(collect(n)); assert.deepEqual(c.observedEffort.rows, []);
  assert.ok(c.missingCosts.includes('experienced-effort')); assert.deepEqual(c.observedTiming.rows.map(r => r.activeActionSeconds), [5, 3.5]);
});

test('missing, duplicate and mismatched original evidence cannot certify effort', () => {
  const cases = {
    missingReceipt: n => { n.memory.experience = n.memory.experience.filter(e => e.id !== 2); },
    duplicateReceipt: n => n.memory.experience.push(clone(receipt(n, 2))),
    missingExperiment: n => { n.discovery.experiments = n.discovery.experiments.filter(e => e.id !== 2); },
    duplicateExperiment: n => n.discovery.experiments.push(clone(n.discovery.experiments[1])),
    duplicateAction: n => n.discovery.experiments.push({ ...clone(n.discovery.experiments[1]), id: 99 }),
    wrongTarget: n => { receipt(n, 2).details.action.targetId = 'object:999999'; },
    wrongPrimitive: n => { receipt(n, 2).details.action.type = 'pull'; },
    wrongTime: n => { receipt(n, 2).at++; },
    wrongSuccess: n => { receipt(n, 2).details.result.ok = false; },
    wrongCode: n => { receipt(n, 2).details.result.code = 'OTHER'; },
    wrongIngestion: n => { receipt(n, 2).details.result.ingestionId = 'ingestion:999'; },
  };
  for (const [label, change] of Object.entries(cases)) {
    const n = withContractHandling(); change(n); const c = food(collect(n));
    assert.ok(!c.observedEffort.rows.some(r => r.actionId === 2), label);
    assert.ok(c.missingCosts.includes('experienced-effort'), label); assert.ok(c.missingCosts.includes('future-effort'), label);
  }
});

test('handling uses acknowledged seconds independently of old wall-clock duration and success', () => {
  const n = withContractHandling(), e = n.discovery.experiments[1], r = receipt(n, 2);
  e.ok = r.details.result.ok = false; e.code = r.details.result.code = 'PRIORITY_CHANGED';
  delete e.ingestionId; delete r.details.result.ingestionId;
  r.details.result.durationSeconds = 9; r.details.result.handling = felt(.25, 'steady');
  const c = food(collect(n)), row = c.observedEffort.rows.find(r => r.actionId === 2);
  assert.equal(row.activeActionSeconds, .25); assert.equal(row.effort, 'steady'); assert.equal(row.ok, false);
  assert.equal(c.observedTiming.rows.find(r => r.actionId === 2).activeActionSeconds, 9);
});

test('effort projection is bounded to sixteen witnessed rows and truncation keeps missing-cost status', () => {
  const n = withContractHandling();
  for (let i = 0; i < 25; i++) {
    const e = { id: i + 10, actionId: i + 10, at: 50 + i, primitive: 'pull', targetId: 'object:1', ok: false, code: 'nothing_detached', durationSeconds: 4 };
    n.discovery.experiments.push(e); const r = actionReceipt(e); r.details.result.handling = felt(4, 'steady'); n.memory.experience.push(r);
  }
  n.memory.nextId = 100; n.discovery.nextId = 100;
  const c = food(collect(n)); assert.equal(DISCOVERY_CANDIDATE_LIMITS.rowsPerCandidate, 16);
  assert.equal(c.observedEffort.rows.length, 16); assert.equal(c.observedEffort.retainedCount, 27); assert.equal(c.observedEffort.truncated, true);
  assert.ok(c.missingCosts.includes('experienced-effort')); assert.ok(c.missingCosts.includes('retired-evidence-coverage'));
  assert.deepEqual(c.observedEffort.rows.map(r => r.actionId), [1, 2, ...Array.from({ length: 14 }, (_, i) => i + 10)]);
});

test('actual bounded receipt/experiment retirement retains valid handling without changing practice', () => {
  const f = fixture();
  for (let i = 0; i < 170; i++) finish(f, 'inspect_object');
  assert.equal(f.n.discovery.experiments.length, 160); assert.equal(f.n.discovery.practice.inspect_object.successes, 170);
  for (let i = 0; i < 425; i++) recordEvent(f.n, 'decision', { summary: 'Unrelated bounded test observation.' });
  assert.ok(f.n.memory.experience.length <= 400);
  const restored = validateNpc(JSON.parse(JSON.stringify(f.n)));
  assert.equal(restored.discovery.practice.inspect_object.successes, 170); assert.equal(restored.discovery.experiments.length, 160);
  for (const e of restored.discovery.experiments) {
    const r = receipt(restored, e.actionId); assert.ok(r); assert.equal(r.details.result.handling.source, 'experienced');
    near(r.details.result.handling.activeActionSeconds, r.details.result.durationSeconds);
  }
});

test('short legal trajectories match the SHA-frozen prepatch engine except handling additions', () => {
  for (const seedFixture of [fixture, juvenileFixture]) {
    const f = seedFixture(), b = { n: clone(f.n), e: clone(f.e), plant: clone(f.plant) };
    const compare = () => {
      assert.deepEqual(withoutHandling(f.n), b.n); assert.deepEqual(f.e, b.e);
      assert.equal(f.n.rng, b.n.rng);
      const aDecision = clone(f.n), bDecision = clone(b.n);
      assert.deepEqual(discoveryDecision(aDecision), discoveryDecision(bDecision)); assert.equal(aDecision.rng, bDecision.rng);
    };
    const steps = seedFixture === juvenileFixture ? ['inspect_object', 'strike', 'strike'] : ['inspect_object', 'pull', 'sample', 'release', 'grasp', 'inspect_object'];
    let materialId;
    for (const type of steps) {
      const id = ['sample', 'release', 'grasp'].includes(type) ? materialId : f.plant.id;
      assert.deepEqual(requestNpcAction(f.n, { type, targetId: id }, f.e), baselineNpc.requestNpcAction(b.n, { type, targetId: id }, b.e)); compare();
      for (let i = 0; f.n.active && i < 200; i++) { tickNpc(f.n, .1, f.e); baselineNpc.tickNpc(b.n, .1, b.e); compare(); }
      assert.equal(f.n.active, null); if (type === 'pull') materialId = f.n.inventory.items[0];
    }
    start(f, 'inspect_object'); start(b, 'inspect_object', b.plant.id, baselineNpc);
    tickNpc(f.n, .25, f.e); baselineNpc.tickNpc(b.n, .25, b.e);
    cancelNpcAction(f.n); baselineNpc.cancelNpcAction(b.n); compare();
    for (const type of ['wait', 'rest']) {
      const action = { type, seconds: .25 };
      assert.deepEqual(requestNpcAction(f.n, action, f.e), baselineNpc.requestNpcAction(b.n, action, b.e));
      tickNpc(f.n, .25, f.e); baselineNpc.tickNpc(b.n, .25, b.e); compare();
    }
    const refusal = { type: 'sample', targetId: f.plant.id };
    assert.deepEqual(requestNpcAction(f.n, refusal, f.e), baselineNpc.requestNpcAction(b.n, refusal, b.e)); compare();
    start(f, 'inspect_object'); start(b, 'inspect_object', b.plant.id, baselineNpc);
    const originalPosition = clone(f.n.position);
    f.n.position = b.n.position = { x: f.plant.position.x + 1000, y: f.plant.position.y };
    for (let i = 0; f.n.active && i < 100; i++) { tickNpc(f.n, .1, f.e); baselineNpc.tickNpc(b.n, .1, b.e); compare(); }
    assert.equal(f.n.lastResult.code, 'OUT_OF_VIEW');
    f.n.position = clone(originalPosition); b.n.position = clone(originalPosition);
    start(f, 'inspect_object'); start(b, 'inspect_object', b.plant.id, baselineNpc);
    tickNpc(f.n, .25, f.e); baselineNpc.tickNpc(b.n, .25, b.e);
    collapseNpc(f.n, 'bounded parity fixture'); baselineNpc.collapseNpc(b.n, 'bounded parity fixture'); compare();
  }
});

test('low-level helper work, RNG, physiology and finite outcome match the frozen baseline', () => {
  const f = fixture(), b = { n: clone(f.n), e: clone(f.e) }, request = { type: 'pull', targetId: f.plant.id };
  assert.deepEqual(requestDiscoveryAction(f.n, request, f.e), baselineDiscovery.requestDiscoveryAction(b.n, request, b.e));
  let actual, expected;
  for (const dt of [.25, .5, 1, 3.25]) {
    tickDiscoveryAction(f.n, dt, f.e, { complete(n, action, result) { actual = result; } });
    baselineDiscovery.tickDiscoveryAction(b.n, dt, b.e, { complete(n, action, result) { expected = result; } });
    assert.deepEqual(f.n, b.n); assert.deepEqual(f.e, b.e);
  }
  assert.deepEqual(actual.handling, felt(5)); delete actual.handling; assert.deepEqual(actual, expected);
});

test('new and legacy handling survive the strict Ozark writer/loader; restart still remains unknown', () => {
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  for (const n of state.agents) { bindOzarkWorldAgent(n, geometry, state); observeNpc(n, state.environment); }
  const n = state.npc, targetId = Object.keys(n.discovery.observations).find(id => lookupEcologyObject(state.environment.ecology, id));
  assert.ok(targetId);
  const advance = () => {
    tickEnvironment(state.environment, .1); tickOzarkEcology(state.environment.ecology, .1, state.environment, state.agents);
    for (const actor of state.agents) tickNpc(actor, .1, state.environment);
    state.elapsed = state.environment.elapsed;
  };
  assert.equal(requestNpcAction(n, { type: 'inspect_object', targetId }, state.environment).code, 'ACTION_STARTED');
  for (let i = 0; n.active && i < 100; i++) advance();
  assert.equal(n.active, null); assert.equal(n.lastResult.ok, true);
  const original = clone(n.lastResult), bytes = new Map(), disk = { getItem: key => bytes.get(key) ?? null, setItem: (key, value) => bytes.set(key, value) };
  assert.equal(original.handling.source, 'experienced'); assert.equal(writeOzarkSave(disk, state, geometry), true);
  let opened;
  for (let i = 0; i < 3; i++) {
    opened = loadOzarkSave(disk, geometry); assert.equal(opened.blocked, false, opened.error);
    assert.deepEqual(receipt(opened.state.npc, original.eventId).details.result.handling, original.handling);
    assert.deepEqual(opened.state.npc.lastResult.handling, original.handling);
    assert.equal(writeOzarkSave(disk, opened.state, geometry), true);
  }
  // Deliberately remove only the additive field to reproduce an old receipt;
  // the strict writer must neither invent work nor alter its existing duration.
  const legacy = opened.state;
  delete receipt(legacy.npc, original.eventId).details.result.handling; delete legacy.npc.lastResult.handling;
  assert.equal(writeOzarkSave(disk, legacy, geometry), true);
  opened = loadOzarkSave(disk, geometry); assert.equal(opened.blocked, false, opened.error);
  assert.equal(receipt(opened.state.npc, original.eventId).details.result.handling, undefined);
  assert.equal(opened.state.npc.lastResult.durationSeconds, original.durationSeconds);
  const interrupted = opened.state, actor = interrupted.npc;
  for (const value of interrupted.agents) bindOzarkWorldAgent(value, geometry, interrupted);
  assert.equal(requestNpcAction(actor, { type: 'inspect_object', targetId }, interrupted.environment).code, 'ACTION_STARTED');
  const active = actor.active;
  tickEnvironment(interrupted.environment, .1); tickOzarkEcology(interrupted.environment.ecology, .1, interrupted.environment, interrupted.agents);
  for (const value of interrupted.agents) tickNpc(value, .1, interrupted.environment);
  interrupted.elapsed = interrupted.environment.elapsed;
  assert.equal(writeOzarkSave(disk, interrupted, geometry), true);
  const reopened = loadOzarkSave(disk, geometry); assert.equal(reopened.blocked, false, reopened.error);
  const restart = reopened.state.npc.memory.experience.find(e => e.details.result?.code === 'RESTART_INTERRUPTED');
  assert.ok(restart); assert.equal(restart.details.result.handling, undefined);
  assert.equal(takeDiscoveryActionFeedback(reopened.state.npc, active), null);
});

test('detached original work and ordinary rest/wait actions never inherit handling', () => {
  const f = fixture(), active = start(f); tickDiscoveryAction(f.n, .25, f.e); f.n.active = null;
  assert.equal(takeDiscoveryActionFeedback(f.n, active), null);
  f.n.active = active; cancelNpcAction(f.n); assert.equal(f.n.lastResult.handling, undefined);
  for (const type of ['rest', 'wait']) {
    assert.equal(requestNpcAction(f.n, { type, seconds: .25 }, f.e).code, 'STARTED');
    tickNpc(f.n, .25, f.e); assert.equal(f.n.active, null); assert.equal(f.n.lastResult.handling, undefined);
  }
});
