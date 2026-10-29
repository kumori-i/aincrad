import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { NpcController } from '../src/controller.js';
import { collectDiscoveryCandidateSnapshot as collect, captureDiscoveryCandidates, DISCOVERY_CANDIDATE_LIMITS } from '../src/discovery-candidates.js';
import { createNpc } from '../src/npc-state.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { createEnvironment } from '../src/environment.js';
import { bodySignals } from '../src/interoception.js';
import { beginSleep } from '../src/biology.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { contractActor, actionReceipt, recognition, addSample } from './fixtures/discovery-candidates/contract-actor.mjs';
import { restoreNativeActor, restorationFor } from './fixtures/discovery-candidates/portable-actor.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const source = readFileSync(new URL('../src/controller.js', import.meta.url), 'utf8');
// Paired instrumentation regression rebased onto the approved renewable/sharing
// controller (a841114). This compares current behavior with/without capture,
// not equivalence to historical f5f13c3e. Its previous normalized pin was
// 94247f8faebf22de63cc1b5f58437ba012b599e5f7700a044022cb356fad449c.
// The combined funding integration adds only forwardNpcRunTravel import/call
// (reviewed840a5d7), retained in both instrumentation arms. Prior normalized pin:
// 27fee85180e8edf0ab5c3eac28798ef7087d118104686c5a80b8d0014d3d38ea.
// The locally approved naming increment adds nonblocking, guarded model token
// proposals and inert journal-name context (independently reviewed380a59c/tree
// d2ec15996a13c70b28bf043657667410e1b7ecc2). Both instrumentation arms retain
// those changes. Prior normalized pin:
// 6177a5daff69fe65d614542ad4bb4d1a5780a338f53f6338102461af51bf7a1a.
// This is current grounded capture-on/off parity, not a rerun/relabel of
// historical trajectories. The reviewed English-channel deprecation adds
// runtime capability binding and naming/dialogue guards to BOTH arms.
// Previous normalized controller pin (before this intentional behavior change):
// 7946d27ceaaf13075f3ac29a5f059da1bf48af4e66bf774d7ced073e188d876b.
// Phase A adds optional paid-reference hooks. Strip their exact new spellings
// too; the normalized controller remains pinned to the SAME grounded bytes.
// Remove only the exact capture and optional communication seams below. Thus
// the baseline executes the current grounded controller without these seams,
// not two copies of a potentially defective instrumentation path. The null
// runtime property is excluded only from controller-container comparisons;
// actors, ecology, actions, events and RNG remain compared in full.
const baselineSource = source
  .replace(/^import \{ setDiscoveryCandidateCapture, takeDiscoveryCandidateSnapshot, disposeDiscoveryCandidateCapture, captureDiscoveryCandidates \} from '\.\/discovery-candidates\.js';\n/m, '')
  .replace(/^  setDiscoveryCandidateCapture\(enabled\)\{setDiscoveryCandidateCapture\(this,enabled\);\}\n/m, '')
  .replace(/^  takeDiscoveryCandidateSnapshot\(\)\{return takeDiscoveryCandidateSnapshot\(this\);\}\n/m, '')
  .replace('dispose(){disposeDiscoveryCandidateCapture(this);this.disposed=true;this.cancel();}', 'dispose(){this.disposed=true;this.cancel();}')
  .replace(/^    captureDiscoveryCandidates\(this,n\);\n/m, '')
  .replace(',experimentalDiscovery=null', '')
  .replace('this.experimentalDiscovery=experimentalDiscovery;', '')
  .replace(',chooseOptional:this.experimentalDiscovery?.choose?choices=>this.experimentalDiscovery.choose(n,choices):null,optionalAction:this.experimentalDiscovery?.optionalAction?()=>this.experimentalDiscovery.optionalAction(n):null', '')
  .replace('this.experimentalDiscovery?.decision?.(n,decision);const performed=this.experimentalDiscovery?.performOptional?.(n,decision.action)??this.perform(decision.action);this.experimentalDiscovery?.performed?.(n,decision.action,performed,n.active);', 'this.perform(decision.action);');
assert.equal(sha(baselineSource), '0007bae4d9e16a10999db52ff3df4213ced5d7ca6b497c5d98af0616120fde5b', 'baseline controller bytes');
const baselineImports = baselineSource.replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(`../src/${path.slice(2)}`, import.meta.url).href}'`);
const { NpcController: BaselineController } = await import(`data:text/javascript;base64,${Buffer.from(baselineImports).toString('base64')}`);
const food = report => report.candidates.find(candidate => candidate.id.startsWith('food:'));
const receipt = (n, id) => n.memory.experience.find(row => row.id === id);
function assertFrozenDetached(report, actor) {
  const objects = new Set(), visit = (value, fn, seen = new Set()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value); fn(value); for (const child of Object.values(value)) visit(child, fn, seen);
  };
  visit(actor, value => objects.add(value));
  visit(report, value => { assert.ok(Object.isFrozen(value)); assert.ok(!objects.has(value), 'no alias to actor'); });
}
function forbiddenPaths(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  const forbidden = new Set(['riskCost', 'hydration', 'nourishment', 'physiology', 'stomach', 'totals',
    'energyKcal', 'availableEnergyKcal', 'storedEnergyKcal', 'satietyHours', 'remainingKcal', 'waterMl', 'remainingWaterMl',
    'massGrams', 'nutrition', 'species', 'materialType', 'edible', 'learnedValue', 'score', 'rank', 'winner', 'selectedAction']);
  return Object.entries(value).flatMap(([key, child]) => [...(forbidden.has(key) ? [`${path}/${key}`] : []), ...forbiddenPaths(child, `${path}/${key}`)]);
}
function controller(n = createNpc({ mode: 'discovery', seed: 74193 }), Controller = NpcController, options = {}) {
  const c = new Controller(n, { deferInitialObservation: true, ...options });
  c.senseAt = n.elapsed; return c;
}
function plainController(c) { assert.equal(c.experimentalDiscovery ?? null, null, 'default communication hook remains inert'); return Object.fromEntries(Object.entries(c).filter(([key]) => !['npc', 'provider', 'fallback', 'environment', 'social', 'experimentalDiscovery'].includes(key))); }

// Pure projection contract. These inputs are deliberately constructed, not runs.
test('collector emits only copied, frozen qualitative observations and unranked retained descriptions', () => {
  const n = contractActor(), before = structuredClone(n), report = collect(n), c = food(report);
  assert.equal(report.status, 'captured'); assert.equal(report.version, 1);
  assert.equal(report.phase, 'before-discoveryDecision'); assert.equal(report.actorId, n.id); assert.equal(report.actorEpoch, n.epoch); assert.equal(report.observedAt, n.elapsed);
  assert.deepEqual(report.body, bodySignals(n)); assert.ok(Object.values(report.body).every(value => typeof value === 'string'));
  assert.deepEqual(report.candidates.map(value => value.id), ['food:technique:aster:1', 'rest', 'wait']);
  assert.deepEqual(c.procedure.steps, n.discovery.techniques[0].steps);
  assert.deepEqual(c.observedTiming.rows.map(row => row.activeActionSeconds), [5, 3.5]);
  assert.equal(c.observedEffects.rows[0].feedbackDelaySeconds, 10, 'from action completion to actual recognition');
  assert.equal(c.observedEffects.rows[0].effectAt, 20); assert.equal(c.observedEffects.rows[0].recognizedAt, 25);
  assert.equal(c.retainedSourceSupport.status, 'observed-direct-chain');
  assert.equal(c.availability, 'unknown'); assert.equal(c.route, 'unknown');
  for (const cost of ['future-relief', 'remaining-procedure-work', 'completion-latency', 'experienced-effort', 'future-harm', 'retired-evidence-coverage']) assert.ok(c.missingCosts.includes(cost));
  assert.deepEqual(forbiddenPaths(report), []); assertFrozenDetached(report, n); assert.deepEqual(n, before);
  assert.throws(() => { report.body.hunger = 'invented'; }, TypeError);
  assert.throws(() => { c.procedure.steps.push({ type: 'eat' }); }, TypeError);
  n.discovery.observations['object:2'].appearance.color = 'blue';
  assert.equal(report.heldObservations[0].appearance.color, 'red');
});

test('held source descriptors stay stale remembered identity, never current stock or route availability', () => {
  const n = contractActor(); n.discovery.observations['object:1'].observedAt = 0;
  n.discovery.observations['object:1'].scene = 'elsewhere'; n.discovery.observations['object:1'].count = 999;
  const c = food(collect(n)); assert.equal(c.identity.source.observedAt, 0); assert.equal(c.identity.source.scene, 'elsewhere');
  assert.equal(c.identity.source.count, undefined); assert.equal(c.identity.source.position, undefined);
  assert.equal(c.availability, 'unknown'); assert.equal(c.route, 'unknown');
  assert.equal(c.identity.heldMaterialIds[0], 'object:2');
});

test('continuation is a copied description and cannot advance or repair the active sequence', () => {
  const n = contractActor(); n.discovery.run = { techniqueId: n.discovery.techniques[0].id, cursor: 1, materialId: 'object:2', awaiting: false, startedAt: 90 };
  const before = structuredClone(n), c = food(collect(n));
  assert.deepEqual(c.continuation, { cursor: 1, materialId: 'object:2', awaiting: false });
  assert.deepEqual(c.nextOperation, { type: 'sample', targetId: 'object:2' }); assert.deepEqual(n, before);
});

test('canonical outcomes outside a technique selected evidence retain harm and contrary observations', () => {
  for (const kind of ['discomfort', 'water relief', 'no noticeable change']) {
    const n = contractActor(); addSample(n, { effect: kind });
    assert.deepEqual(n.discovery.techniques[0].evidence, [1, 2]);
    const c = food(collect(n)); assert.deepEqual(c.observedEffects.rows.map(row => row.effect).sort(), ['sustained', kind].sort());
    assert.equal(c.adverse, kind === 'discomfort'); const outcome = c.observedEffects.rows.find(row => row.effect === kind); assert.equal(outcome.hunger, 'unchanged');
    assert.equal(outcome.energy, 'unchanged');
    assert.ok(c.support.recognitionIds.includes(7));
  }
});

test('pending samples and map markers are censored observations, never causal benefit or zero-cost completion', () => {
  const n = contractActor(); n.discovery.effects = []; n.memory.experience = n.memory.experience.filter(row => row.id !== 3);
  n.discovery.samplesPending['object:2'] = 15;
  const c = food(collect(n)); assert.equal(c.pending, true); assert.equal(c.observedEffects.rows.length, 0);
  assert.equal(c.retainedSourceSupport.status, 'unknown'); assert.equal(c.retainedSourceSupport.ingestionCount, 0);
  assert.equal(c.pendingEvidence.rows[0].status, 'unresolved-retained-sample');
  assert.ok(c.missingCosts.includes('future-relief')); assert.ok(c.missingCosts.includes('completion-latency'));
  const distinct = contractActor(); addSample(distinct, { recognized: false }); distinct.discovery.samplesPending['object:2'] = 50;
  const newer = food(collect(distinct)); assert.equal(newer.pending, true); assert.equal(newer.retainedSourceSupport.ingestionCount, 1);
  assert.equal(newer.pendingEvidence.rows[0].ingestionId, 'ingestion:2');
});

test('missing, duplicate and forged original receipts, experiments, ingestion or recognition fail closed', () => {
  const cases = {
    'missing sample receipt': n => { n.memory.experience = n.memory.experience.filter(row => row.id !== 2); },
    'duplicate receipt': n => n.memory.experience.push(structuredClone(receipt(n, 2))),
    'duplicate experiment ID': n => n.discovery.experiments.push({ ...n.discovery.experiments[1] }),
    'duplicate experiment action': n => n.discovery.experiments.push({ ...n.discovery.experiments[1], id: 99 }),
    'forged receipt action': n => { receipt(n, 2).details.action.type = 'pull'; },
    'forged receipt target': n => { receipt(n, 2).details.action.targetId = 'object:99'; },
    'forged receipt result': n => { receipt(n, 2).details.result.ok = false; },
    'forged receipt code': n => { receipt(n, 2).details.result.code = 'OTHER'; },
    'forged receipt time': n => { receipt(n, 2).at++; },
    'forged ingestion receipt': n => { receipt(n, 2).details.result.ingestionId = 'ingestion:99'; },
    'forged effect ingestion': n => { n.discovery.effects[0].ingestionId = 'ingestion:99'; },
    'missing recognition': n => { n.memory.experience = n.memory.experience.filter(row => row.id !== 3); },
    'duplicate recognition': n => n.memory.experience.push(structuredClone(receipt(n, 3))),
    'forged recognition ingestion': n => { receipt(n, 3).details.feedback.ingestionId = 'ingestion:99'; },
    'forged recognition signal': n => { receipt(n, 3).details.feedback.hunger = 'unchanged'; },
    'future recognition': n => { receipt(n, 3).at = n.elapsed + 1; },
    'recognition before effect': n => { receipt(n, 3).at = 19; },
    'effect before sampling': n => { n.discovery.effects[0].at = 14; receipt(n, 3).details.feedback.at = 14; },
    'non-firsthand effect': n => { n.discovery.effects[0].source = 'reported'; receipt(n, 3).details.feedback.source = 'reported'; },
    'duplicate effect ID': n => n.discovery.effects.push(structuredClone(n.discovery.effects[0])),
    'duplicate ingestion': n => addSample(n, { ingestionId: 'ingestion:1', recognized: false }),
  };
  for (const [label, change] of Object.entries(cases)) {
    const n = contractActor(); change(n); const before = structuredClone(n), c = food(collect(n));
    assert.ok(c, label); assert.equal(c.observedEffects.rows.length, 0, label);
    assert.equal(c.retainedSourceSupport.status, 'unknown', label); assert.deepEqual(n, before, label);
  }
});

test('missing and nonpositive or nonfinite action duration remains unknown, not a zero-valued timing estimate', () => {
  for (const duration of [undefined, null, 0, -1, Infinity, NaN, '3.5']) {
    const n = contractActor(); receipt(n, 2).details.result.durationSeconds = duration;
    const c = food(collect(n)); assert.ok(!c.observedTiming.rows.some(row => row.actionId === 2), String(duration));
  }
  const n = contractActor(); n.discovery.experiments[1].durationSeconds = 0.001;
  const row = food(collect(n)).observedTiming.rows.find(value => value.actionId === 2);
  if (row) assert.equal(row.activeActionSeconds, 3.5, 'a forged redundant duration cannot replace the original receipt');
});

test('rest and wait timing uses observed action receipts, without body numeric gains or hypothetical delay', () => {
  const n = contractActor(); Object.assign(receipt(n, 4).details.result, { energyRecovered: 99, fatigueRelieved: 20, riskCost: 123 });
  const report = collect(n), rest = report.candidates.find(c => c.id === 'rest'), wait = report.candidates.find(c => c.id === 'wait');
  assert.deepEqual(rest.observedTiming.rows.map(row => row.activeActionSeconds), [2]);
  assert.deepEqual(wait.observedTiming.rows.map(row => row.activeActionSeconds), [1]);
  assert.deepEqual(rest.observedEffects.rows, []); assert.deepEqual(wait.observedEffects.rows, []);
  assert.deepEqual(forbiddenPaths(report), []);
});

test('absent retained continuity and release/regrasp/strike interruptions cannot transfer source benefit', () => {
  for (const type of [null, 'release', 'grasp', 'strike']) {
    const n = contractActor(), sample = n.discovery.experiments[1];
    sample.actionId = 3; receipt(n, 2).id = 3;
    const recognitionRow = n.memory.experience.find(row => row.type === 'condition'); recognitionRow.id = 4;
    n.discovery.effects[0].actionId = 3; n.discovery.effects[0].proofEventId = 4; recognitionRow.details.feedback.actionId = 3;
    n.memory.experience = n.memory.experience.filter(row => row.type === 'condition' || row.id <= 3);
    if (type) n.memory.experience.push({ id: 2, at: 12, type: 'action', details: { action: { type, targetId: 'object:2' }, result: { ok: true, code: 'INTERRUPTION', durationSeconds: 1 } } });
    const c = food(collect(n)); assert.equal(c.retainedSourceSupport.status, 'unknown', String(type));
    assert.equal(c.observedEffects.rows[0].sourceContinuity, 'unknown', String(type));
  }
});

test('bounds fail closed before traversing any oversized input array', () => {
  assert.deepEqual(Object.fromEntries(['receipts', 'experiments', 'effects', 'techniques', 'held'].map(key => [key, DISCOVERY_CANDIDATE_LIMITS[key]])),
    { receipts: 400, experiments: DISCOVERY_RULES.maxExperiments, effects: 64, techniques: 24, held: 4 });
  for (const [path, limit] of [[['memory', 'experience'], 400], [['discovery', 'experiments'], DISCOVERY_RULES.maxExperiments], [['discovery', 'effects'], 64],
    [['discovery', 'techniques'], 24], [['inventory', 'items'], 4], [['physiology', 'stomach'], 24]]) {
    const n = contractActor(), array = new Array(limit + 1); let reads = 0;
    Object.defineProperty(array, '0', { get() { reads++; throw new Error('must not walk oversized input'); } });
    n[path[0]][path[1]] = array; const report = collect(n);
    assert.equal(report.status, 'unavailable', path.join('.')); assert.equal(reads, 0, path.join('.')); assert.deepEqual(report.candidates, []);
  }
  for (const value of [null, {}, 'invalid']) { const n = contractActor(); n.discovery.experiments = value; assert.equal(collect(n).status, 'unavailable'); }
});

test('maximum retained candidates and row projections stay bounded and order does not encode a ranking', () => {
  const n = contractActor(), original = n.discovery.techniques[0];
  n.discovery.techniques = Array.from({ length: 24 }, (_, i) => ({ ...structuredClone(original), id: `technique:aster:${24 - i}` }));
  const report = collect(n); assert.equal(report.status, 'captured'); assert.equal(report.candidates.length, 26);
  assert.deepEqual(report.candidates.slice(0, 24).map(c => c.id), [...report.candidates.slice(0, 24).map(c => c.id)].sort((a, b) => a.localeCompare(b)));
  for (const c of report.candidates) for (const key of ['observedTiming', 'observedEffects', 'pendingEvidence']) assert.ok(c[key].rows.length <= 16);
  assert.deepEqual(forbiddenPaths(report), []);
});

test('observations and the legitimately unbounded pending map are direct lookups, never enumerated', () => {
  const n = contractActor(); let observationReads = 0, pendingReads = 0;
  const pending = { 'object:2': 90 }; for (let i = 100; i < 20100; i++) pending[`object:${i}`] = 90;
  n.discovery.observations = new Proxy(n.discovery.observations, { ownKeys() { throw new Error('no observation enumeration'); }, get(target, key) { observationReads++; return target[key]; } });
  n.discovery.samplesPending = new Proxy(pending, { ownKeys() { throw new Error('no pending enumeration'); }, get(target, key) { pendingReads++; return target[key]; } });
  const report = collect(n); assert.equal(report.status, 'captured'); assert.equal(food(report).pending, true);
  assert.ok(observationReads <= 4); assert.ok(pendingReads <= 4);
});

test('hidden engine values have no effect beyond the official qualitative body API', () => {
  const n = contractActor(), baseline = collect(n), changed = structuredClone(n);
  changed.riskCost = 1e9; changed.hydration = 0; changed.nourishment = 0; changed.health = 1;
  changed.energy -= 1; changed.physiology.availableEnergyKcal -= 1; changed.physiology.storedEnergyKcal = 1;
  changed.physiology.totals.ingestedKcal = 1e9; changed.discovery.techniques[0].successes = 9999;
  changed.discovery.techniques[0].failures = 999; changed.discovery.techniques[0].confidence = 'revised';
  for (const r of changed.memory.experience) if (r.details.result) Object.assign(r.details.result, { riskCost: 999, energyKcal: 1234, nutrition: 'hidden' });
  for (const key of ['totals', 'outsideAssistance', 'feedback']) Object.defineProperty(changed.physiology, key, { get() { throw new Error(`private ${key}`); } });
  assert.deepEqual(bodySignals(changed), baseline.body); assert.deepEqual(collect(changed), baseline);
});

// Actual controller seam, its lifecycle and behavior parity.
test('capture is strictly opt-in with no default traversal, actor fields or serialized controller slot', () => {
  const n = createNpc({ mode: 'discovery' }), c = controller(n), actorBefore = structuredClone(n), keys = Object.keys(c);
  assert.equal(c.takeDiscoveryCandidateSnapshot(), null);
  captureDiscoveryCandidates(c, new Proxy({}, { get() { throw new Error('disabled observer touched actor'); } }));
  for (const value of [undefined, false, 1, 'true', {}, () => { throw new Error('must not call callbacks'); }]) {
    c.setDiscoveryCandidateCapture(value); c.tick(0); assert.equal(c.takeDiscoveryCandidateSnapshot(), null);
    n.active = null; n.nextDecisionAt = n.elapsed;
  }
  c.setDiscoveryCandidateCapture(true); assert.equal(c.takeDiscoveryCandidateSnapshot(), null);
  assert.deepEqual(Object.keys(c), keys); c.setDiscoveryCandidateCapture(false);
  assert.ok(!Object.keys(n).some(key => /capture|candidate|observer/i.test(key)));
  const fresh = createNpc({ mode: 'discovery' }), untouched = controller(fresh); untouched.setDiscoveryCandidateCapture(true); untouched.setDiscoveryCandidateCapture(false);
  assert.deepEqual(fresh, actorBefore);
});

test('single-slot drain, overwrite, reset, disable, disposal and cross-controller isolation', () => {
  const a = controller(), b = controller(); a.setDiscoveryCandidateCapture(true); b.setDiscoveryCandidateCapture(true);
  a.tick(0); const firstExpectedAt = a.npc.elapsed; assert.equal(b.takeDiscoveryCandidateSnapshot(), null);
  a.npc.active = null; a.npc.elapsed = 2; a.npc.nextDecisionAt = 2; a.senseAt = 2; a.tick(0);
  const last = a.takeDiscoveryCandidateSnapshot(); assert.equal(last.observedAt, 2); assert.notEqual(last.observedAt, firstExpectedAt); assert.equal(a.takeDiscoveryCandidateSnapshot(), null);
  a.npc.active = null; a.npc.nextDecisionAt = 2; a.tick(0); a.setDiscoveryCandidateCapture(true); assert.equal(a.takeDiscoveryCandidateSnapshot(), null, 're-enable clears older slot');
  a.npc.active = null; a.npc.nextDecisionAt = 2; a.tick(0); a.setDiscoveryCandidateCapture(false); assert.equal(a.takeDiscoveryCandidateSnapshot(), null);
  b.tick(0); b.dispose(); assert.equal(b.takeDiscoveryCandidateSnapshot(), null); b.setDiscoveryCandidateCapture(true); b.tick(0); assert.equal(b.takeDiscoveryCandidateSnapshot(), null);
});

test('active, cooldown, asleep, nonawake, disposed, legacy and dialogue-return paths do not capture', () => {
  const cases = {
    active: c => { c.npc.active = { request: { type: 'wait', seconds: 1 }, startedAt: 0, expiresAt: 1 }; },
    cooldown: c => { c.npc.nextDecisionAt = c.npc.elapsed + 1; },
    asleep: c => { beginSleep(c.npc, { hours: 1 }); c.npc.physiology.sleep.state = 'sleeping'; },
    nonawake: c => { c.npc.lifecycle = 'COLLAPSED'; },
    disposed: c => c.dispose(),
    legacy: c => { c.npc.mode = 'legacy'; c.npc.nextDecisionAt = 1; },
    dialogue: c => { c.social = { maybeDialogue() { return { type: 'ask_human', text: 'A question' }; }, action() { return { ok: true, code: 'ASKED' }; } }; },
  };
  for (const [label, setup] of Object.entries(cases)) {
    const c = controller(undefined,NpcController,label==='dialogue'?{communicationMode:'legacy'}:{}); c.setDiscoveryCandidateCapture(true); setup(c); c.tick(0); assert.equal(c.takeDiscoveryCandidateSnapshot(), null, label);
  }
});

test('historical legacy idle seam captures after a non-returning dialogue check and immediately before physical choice', () => {
  const n = createNpc({ mode: 'discovery' }); let reached = false, boundary = null;
  const c = controller(n, NpcController, { communicationMode:'legacy', social: { maybeDialogue(actor) { reached = true; boundary = collect(actor); assert.equal(c.takeDiscoveryCandidateSnapshot(), null); return null; } } });
  c.setDiscoveryCandidateCapture(true); c.tick(0); const report = c.takeDiscoveryCandidateSnapshot();
  assert.equal(reached, true); assert.deepEqual(report, boundary); assert.equal(report.phase, 'before-discoveryDecision');
  assert.equal(report.body.activity, 'awake'); assert.ok(n.active || n.memory.experience.some(row => row.type === 'action'));
  assert.equal(report.observedAt, n.elapsed);
});

test('default and disabled controller actor traversal matches exact baseline at the real seam', () => {
  const readCounts = [];
  for (const [Controller, explicitlyDisabled] of [[BaselineController, false], [NpcController, false], [NpcController, true], [NpcController, 'enabled']]) {
    const n = createNpc({ mode: 'discovery' }), techniques = n.discovery.techniques; let reads = 0;
    Object.defineProperty(n.discovery, 'techniques', { configurable: true, enumerable: true, get() { reads++; return techniques; }, set(value) { techniques.splice(0, techniques.length, ...value); } });
    const c = controller(n, Controller); if (explicitlyDisabled) c.setDiscoveryCandidateCapture(explicitlyDisabled === 'enabled'); c.tick(0); readCounts.push(reads);
  }
  assert.equal(readCounts[1], readCounts[0]); assert.equal(readCounts[2], readCounts[0]); assert.ok(readCounts[3] > readCounts[0]);
});

test('enabled, disabled and exact baseline preserve action, RNG, full actor, run, evidence and environment across bounded real ticks', () => {
  const initial = createNpc({ mode: 'discovery', seed: 74193 }), environment = createEnvironment(74193, { mode: 'discovery' });
  const variants = [BaselineController, NpcController, NpcController].map(Controller => {
    const n = structuredClone(initial), e = structuredClone(environment), c = new Controller(n, { environment: e }); return { n, e, c };
  });
  variants[1].c.setDiscoveryCandidateCapture(false); variants[2].c.setDiscoveryCandidateCapture(true); let captures = 0;
  for (let i = 0; i < 12; i++) {
    for (const { c } of variants) c.tick(1 / 60);
    const report = variants[2].c.takeDiscoveryCandidateSnapshot(); if (report) { captures++; assert.equal(report.observedAt, variants[2].n.elapsed); assert.equal(report.phase, 'before-discoveryDecision'); }
    for (const { n, e, c } of variants.slice(1)) {
      assert.deepEqual(n.active, variants[0].n.active); assert.equal(n.rng, variants[0].n.rng);
      assert.deepEqual(n.discovery.run, variants[0].n.discovery.run); assert.deepEqual(n.memory.experience, variants[0].n.memory.experience);
      assert.deepEqual(n, variants[0].n); assert.deepEqual(e, variants[0].e); assert.deepEqual(plainController(c), plainController(variants[0].c));
    }
  }
  assert.ok(captures >= 1); assert.equal(variants[1].c.takeDiscoveryCandidateSnapshot(), null); for (const { c } of variants) c.dispose();
});

test('a collector-only fault is contained and cannot perturb action, RNG or full actor execution', () => {
  const initial = contractActor(), control = structuredClone(initial), observed = structuredClone(initial);
  let reads = 0; const technique = observed.discovery.techniques[0], techniqueId = technique.id;
  Object.defineProperty(technique, 'id', { enumerable: true, configurable: true, get() { if (++reads === 1) throw new Error('forced collector failure'); return techniqueId; } });
  const a = controller(control, BaselineController), b = controller(observed); b.setDiscoveryCandidateCapture(true);
  a.tick(0); assert.doesNotThrow(() => b.tick(0)); const report = b.takeDiscoveryCandidateSnapshot();
  assert.equal(report.status, 'unavailable'); assert.equal(report.reason, 'observer-error');
  Object.defineProperty(technique, 'id', { value: techniqueId, enumerable: true, configurable: true, writable: true });
  assert.deepEqual(observed.active, control.active); assert.equal(observed.rng, control.rng); assert.deepEqual(observed, control);
});

test('duplicate technique identity and same-portion effect claims fail closed independently of input order', () => {
  const techniqueActor = contractActor(); techniqueActor.discovery.techniques.push({ ...structuredClone(techniqueActor.discovery.techniques[0]), sourceId: 'object:3' });
  const techniqueForward = collect(techniqueActor); techniqueActor.discovery.techniques.reverse();
  assert.deepEqual(collect(techniqueActor), techniqueForward); assert.equal(techniqueForward.omittedTechniques, 2);
  assert.deepEqual(techniqueForward.candidates.map(c => c.id), ['rest', 'wait']);
  const n = contractActor(), duplicate = { ...n.discovery.effects[0], id: 'feedback:99', proofEventId: 6 };
  n.discovery.effects.push(duplicate); n.memory.experience.push(recognition(duplicate, 6, 30));
  const forward = collect(n); n.discovery.effects.reverse(); assert.deepEqual(collect(n), forward);
  assert.equal(food(forward).observedEffects.rows.length, 0); assert.equal(food(forward).retainedSourceSupport.status, 'unknown');
});

test('an intervening second source reclaim cannot lend the earlier source a direct material chain', () => {
  const n = contractActor(), original = n.discovery.experiments[0];
  const other = { ...original, id: 2, actionId: 2, at: 12, targetId: 'object:3' };
  const sampled = { ...n.discovery.experiments[1], id: 3, actionId: 3 };
  const effect = { ...n.discovery.effects[0], actionId: 3, proofEventId: 4 };
  n.discovery.experiments = [original, other, sampled]; n.discovery.effects = [effect];
  n.memory.experience = [actionReceipt(original), actionReceipt(other), actionReceipt(sampled), recognition(effect, 4, 25)];
  const c = food(collect(n)); assert.equal(c.observedEffects.rows[0].sourceContinuity, 'unknown');
  assert.equal(c.retainedSourceSupport.status, 'unknown');
});

test('impossible receipt-ID chronology and malformed qualitative recognition do not become learned benefit', () => {
  const n = contractActor();
  n.discovery.experiments[0].actionId = 2; n.discovery.experiments[1].actionId = 3;
  const effect = n.discovery.effects[0]; effect.actionId = 3; effect.proofEventId = 1;
  n.memory.experience = [actionReceipt(n.discovery.experiments[0]), actionReceipt(n.discovery.experiments[1]), recognition(effect, 1, 25)];
  assert.equal(food(collect(n)).observedEffects.rows.length, 0);
  for (const key of ['hunger', 'thirst', 'energy', 'pain']) for (const value of [undefined, 99, 'secret raw value']) {
    const malformed = contractActor(); malformed.discovery.effects[0][key] = value; receipt(malformed, 3).details.feedback[key] = value;
    const c = food(collect(malformed)); assert.equal(c.observedEffects.rows.length, 0); assert.equal(c.retainedSourceSupport.status, 'unknown');
  }
});

test('unassigned or unverified retained discomfort stays visible without invented source attribution', () => {
  for (const missing of ['acquisition', 'recognition']) {
    const n = contractActor(); addSample(n);
    if (missing === 'acquisition') n.discovery.experiments = n.discovery.experiments.filter(e => e.id !== 1);
    else n.memory.experience = n.memory.experience.filter(e => e.id !== 7);
    const report = collect(n), coverage = report.retainedEffectsCoverage;
    assert.equal(coverage.uncertainAdverseCount, 1, missing); assert.ok(coverage.rows.some(row => row.effect === 'discomfort'), missing);
    assert.equal(food(report).adverse, false, 'unverified or unassigned harm is not falsely attributed to the source');
    assert.equal(food(report).observedEffects.rows.some(row => row.effect === 'discomfort'), false);
  }
});

test('zero-time swallowing and rest refusals remain visible separately from unknown work duration', () => {
  const n = contractActor(), refusal = { id: 3, actionId: 6, at: 50, primitive: 'sample', targetId: 'object:2', ok: false, code: 'TOO_FULL', durationSeconds: 0 };
  n.discovery.experiments.push(refusal); n.memory.experience.push(actionReceipt(refusal));
  receipt(n, 4).details.result = { ok: false, code: 'REST_INTERRUPTED', durationSeconds: 0 };
  const report = collect(n), c = food(report), rest = report.candidates.find(c => c.id === 'rest');
  assert.equal(c.observedRefusals.rows[0].code, 'TOO_FULL'); assert.ok(!c.observedTiming.rows.some(row => row.actionId === 6));
  assert.ok(c.support.actionIds.includes(6)); assert.equal(rest.observedRefusals.rows[0].code, 'REST_INTERRUPTED');
  assert.equal(rest.adverse, true); assert.equal(rest.observedTiming.rows.length, 0);
});

test('maximum retained ledgers cap every output row list while retaining a late adverse summary and witness', () => {
  const n = contractActor(), acquire = n.discovery.experiments[0]; n.elapsed = 1000;
  n.discovery.experiments = [acquire]; n.discovery.effects = []; n.memory.experience = [actionReceipt(acquire)];
  for (let i = 0; i < 64; i++) {
    const sample = { id: i + 2, actionId: i + 2, at: 15 + i * 4, primitive: 'sample', targetId: 'object:2', ok: true,
      code: 'SWALLOWED', durationSeconds: 3, ingestionId: `ingestion:${i + 1}` };
    const effect = { id: `feedback:${i + 1}`, objectId: 'object:2', actionId: sample.actionId, ingestionId: sample.ingestionId,
      at: 280 + i, proofEventId: 66 + i, effect: i === 63 ? 'discomfort' : 'sustained', source: 'experienced',
      hunger: i === 63 ? 'unchanged' : 'easing', thirst: 'unchanged', energy: i === 63 ? 'unchanged' : 'easing', pain: i === 63 ? 'hurting' : 'none' };
    n.discovery.experiments.push(sample); n.discovery.effects.push(effect);
    n.memory.experience.push(actionReceipt(sample), recognition(effect, 66 + i, 400 + i));
  }
  for (let i = 65; i < DISCOVERY_RULES.maxExperiments; i++) {
    const experiment = { id: i + 1, actionId: i + 65, at: 600 + i, primitive: 'inspect_object', targetId: 'object:99', ok: true, code: 'INSPECTED', durationSeconds: 1 };
    n.discovery.experiments.push(experiment); n.memory.experience.push(actionReceipt(experiment));
  }
  for (let id = DISCOVERY_RULES.maxExperiments + 65; id <= 400; id++) n.memory.experience.push({ id, at: 900, type: 'action', details: { action: { type: id % 2 ? 'rest' : 'wait' }, result: { ok: true, code: 'WAITED', durationSeconds: 1 } } });
  n.memory.experience.sort((a, b) => a.id - b.id);
  const original = n.discovery.techniques[0]; n.discovery.techniques = Array.from({ length: 24 }, (_, i) => ({ ...structuredClone(original), id: `technique:aster:${i + 1}` }));
  n.inventory.items = ['object:2', 'object:3', 'object:4', 'object:5'];
  n.physiology.stomach = Array.from({ length: 24 }, () => ({ remainingMassGrams: 0 }));
  assert.equal(n.memory.experience.length, 400); assert.equal(n.discovery.experiments.length, DISCOVERY_RULES.maxExperiments); assert.equal(n.discovery.effects.length, 64);
  const before = structuredClone(n), report = collect(n); assert.equal(report.status, 'captured'); assert.equal(report.candidates.length, 26);
  for (const c of report.candidates) {
    for (const key of ['observedTiming', 'observedEffects', 'observedRefusals', 'pendingEvidence']) assert.ok(c[key].rows.length <= 16);
    if (c.procedure) { assert.equal(c.adverse, true); assert.equal(c.observedEffects.retainedCount, 64); assert.equal(c.observedEffects.truncated, true); assert.equal(c.observedEffects.rows[0].effect, 'discomfort'); }
  }
  assert.ok(report.retainedEffectsCoverage.rows.length <= 16); assert.deepEqual(n, before); assertFrozenDetached(report, n);
});

test('existing food-learning ablation is described and its enabled collector retains controller behavior parity', () => {
  const initial = contractActor(), control = structuredClone(initial), observed = structuredClone(initial);
  const a = controller(control, BaselineController, { discoveryFoodLearning: false }), b = controller(observed, NpcController, { discoveryFoodLearning: false });
  b.setDiscoveryCandidateCapture(true); a.tick(0); b.tick(0); const report = b.takeDiscoveryCandidateSnapshot();
  assert.equal(report.foodLearning, false); assert.ok(report.candidates.filter(c => c.procedure).every(c => c.policyEnabled === false));
  assert.deepEqual(observed, control);
});

// Narrow pre-existing learned-source cache-equivalence check for this input only.
// No private WeakMap is reconstructed or generalized to a world continuation.
function historicalSourceBlocked(actor, type, targetId, sightings) {
  const d = actor.discovery, object = d.observations[targetId], sight = sightings.get(targetId); let gone = -1, depleted = -1;
  const consider = (at, code, primitive, ok) => { if (ok === true || !Number.isFinite(at) || at > actor.elapsed) return; if (code === 'OBJECT_GONE') gone = Math.max(gone, at); if (code === 'nothing_detached' && primitive === 'pull') depleted = Math.max(depleted, at); };
  for (const [key, trial] of Object.entries(d.trials)) if (key.startsWith(`${targetId}|`)) consider(trial.lastAt, trial.lastCode, key.split('|')[1], trial.lastOk);
  for (const e of d.experiments) if (e.targetId === targetId) consider(e.at, e.code, e.primitive, e.ok);
  if (gone < 0 && (type !== 'pull' || depleted < 0)) return false;
  const direct = object && sight && sight.scene === actor.scene && object.scene === sight.scene && object.observedAt === sight.at && object.count === sight.count && object.position.x === sight.position.x && object.position.y === sight.position.y && Number.isFinite(sight.at) && sight.at <= actor.elapsed;
  return !direct || sight.at <= gone || type === 'pull' && depleted >= 0 && (sight.at <= depleted || !(sight.count > 0));
}

test('exact retained historical v2 actor: bounded zero-time current-main controller counterfactual preserves baseline behavior', () => {
  const bytes = readFileSync(new URL('./fixtures/discovery-candidates/portable-native-regrasp.json.gz', import.meta.url));
  assert.equal(sha(bytes), '6a5641fb2fad297beaf6f777965a6aa8b4c6bef2737abfe5ad666603dd5b7773');
  const fixture = JSON.parse(gunzipSync(bytes)), native = restoreNativeActor(fixture.actor, fixture.rawRestoration);
  assert.deepEqual(restorationFor(native), fixture.rawRestoration); assert.equal(native.elapsed, 838.1833333328997);
  assert.equal(fixture.provenance.sourceSha256, '1c966f924cfddc8fcb370e3331f79c5eee4f19801d780515d33a7c8fcbb4c412');
  assert.equal(fixture.provenance.rawActorSha256, '917ee33956d0ed8da232713a9a8fdfbc9380224f6f0feb46020ad55bb094d39d');
  const sightings = new Map(fixture.firsthandSightings);
  for (const technique of native.discovery.techniques) assert.equal(historicalSourceBlocked(native, technique.steps[0].type, technique.sourceId, sightings), historicalSourceBlocked(native, technique.steps[0].type, technique.sourceId, new Map()));
  const geometry = createOzarkWorldGeometry(), variants = [BaselineController, NpcController, NpcController].map(Controller => {
    const n = structuredClone(native); bindOzarkWorldAgent(n, geometry, { geometryIdentity: geometry.profile.identity, agents: [n] });
    assert.deepEqual(n, native, 'runtime geometry binding leaves exact captured data unchanged');
    return controller(n, Controller);
  });
  variants[1].setDiscoveryCandidateCapture(false); variants[2].setDiscoveryCandidateCapture(true);
  const expectedBoundary = collect(native); assert.equal(expectedBoundary.status, 'captured'); assert.deepEqual(expectedBoundary.body, bodySignals(native));
  for (const c of variants) c.tick(0);
  const report = variants[2].takeDiscoveryCandidateSnapshot(); assert.deepEqual(report, expectedBoundary, 'exact input observed before physical policy mutates run/RNG');
  assert.equal(report.phase, 'before-discoveryDecision'); assert.equal(report.actorEpoch, native.epoch); assert.equal(report.observedAt, native.elapsed); assert.equal(variants[1].takeDiscoveryCandidateSnapshot(), null);
  assert.deepEqual(variants[0].npc.active?.request, { type: 'move', target: { x: 560, y: 880 } }, 'diagnostic current-main action on historical input');
  assert.equal(variants[0].npc.discovery.run?.techniqueId, 'technique:aster:173');
  for (const c of variants.slice(1)) {
    assert.equal(c.npc.rng, variants[0].npc.rng); assert.deepEqual(c.npc.active, variants[0].npc.active);
    assert.deepEqual(c.npc.discovery.run, variants[0].npc.discovery.run); assert.deepEqual(c.npc.discovery.effects, variants[0].npc.discovery.effects);
    assert.deepEqual(c.npc.discovery.experiments, variants[0].npc.discovery.experiments); assert.deepEqual(c.npc.memory.experience, variants[0].npc.memory.experience);
    assert.deepEqual(c.npc, variants[0].npc); assert.equal(c.npc.elapsed, native.elapsed, 'no physical time advanced');
  }
  assert.deepEqual(native, restoreNativeActor(fixture.actor, fixture.rawRestoration)); assertFrozenDetached(report, native); assert.deepEqual(forbiddenPaths(report), []);
  for (const c of variants) c.dispose();
});

test('frozen native-shaped evidence is read-only and ordinary ledger order does not alter the report', () => {
  const n = contractActor(), expected = collect(n), reordered = structuredClone(n);
  reordered.memory.experience.reverse(); reordered.discovery.experiments.reverse(); reordered.discovery.effects.reverse();
  assert.deepEqual(collect(reordered), expected);
  const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
  assert.deepEqual(collect(freeze(n)), expected, 'pure collector must not attempt to write through actor evidence');
});

test('an unread historical slot survives an early-return tick and is cleared only by explicit reset or lifecycle disposal', () => {
  const c = controller(); c.setDiscoveryCandidateCapture(true); c.tick(0);
  const oldTime = c.npc.elapsed, oldEpoch = c.npc.epoch; c.npc.elapsed += 1; c.npc.epoch++; c.npc.nextDecisionAt = c.npc.elapsed + 1; c.senseAt = c.npc.elapsed;
  c.tick(0); const report = c.takeDiscoveryCandidateSnapshot(); assert.equal(report.observedAt, oldTime);
  assert.equal(report.actorEpoch, oldEpoch); assert.notEqual(report.actorEpoch, c.npc.epoch, 'unread report keeps the historical epoch across a reset');
  assert.equal(c.takeDiscoveryCandidateSnapshot(), null); c.dispose();
});

test('recognized mixed relief and pain stays adverse without inventing a safe future outcome', () => {
  for (const pain of ['aching', 'hurting']) {
    const n = contractActor(); n.discovery.effects[0].pain = pain; receipt(n, 3).details.feedback.pain = pain;
    const c = food(collect(n)); assert.equal(c.observedEffects.rows.length, 1); assert.equal(c.observedEffects.rows[0].effect, 'sustained');
    assert.equal(c.observedEffects.rows[0].pain, pain); assert.equal(c.adverse, true); assert.ok(c.missingCosts.includes('future-harm'));
  }
});
