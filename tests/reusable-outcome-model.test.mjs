import test from 'node:test';
import assert from 'node:assert/strict';
import { temporalIntegral } from '../src/temporal-returns.js';
import { REUSABLE_MODEL, createReusableOutcomeModel, reusableAppearance, reusablePhysicalFeatures,
  updatePhysicalReceipt, updatePhysicalInterval, updateExposure, predictPhysical,
  exposureAgeBin, splitExposureRisk, forecastExposure, forecastPending, forecastCandidate,
  currentNeedWeights, chooseMatched, validateReusableOutcomeModel, encodeReusableOutcomeModel,
  restoreReusableOutcomeModel, reusableModelDiagnostics, applyReusableLabels, createReusableModelSession, createReusableQuerySnapshot, reusableDictionaryDiagnostics } from '../scripts/lib/reusable-outcome-model.mjs';
const clone = structuredClone;
const appearance = { shape: 'round', color: 'green', texture: 'smooth', motion: 'still', size: 'small', smell: 'faint' };
const features = (extra = {}) => ({ operation: 'sample', appearance, relation: 'held', workBand: '0', freeSlotBand: '1', countBand: '2+', ...extra });
const close = (a, b, epsilon = 1e-12) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const effect = (model, seq = 1, f = features(), effects = { exposure: true }, durationSeconds = 10) => updatePhysicalReceipt(model, { sequence: seq, at: seq * 20, features: f, completion: 'success', effects, durationSeconds });
const cost = (model, seq = 1, f = features(), seconds = 20, exertion = 1 / 3) => updatePhysicalInterval(model, { sequence: seq, at: seq * 20, features: f, T: temporalIntegral(0, seconds), E: temporalIntegral(0, seconds, exertion) });
const ingest = (model, seq = 1, a = appearance, at = seq * 1000) => updateExposure(model, { sequence: seq, at, appearance: a, digestion: 'empty', ingestions: 1, increments: [] });
function riskEvent(model, { sequence = 2, at = sequence * 1000, a = appearance, from = 0, to = 30, channels = ['F', 'W', 'H'], event = 'F', censored = [] } = {}) {
  const increments = channels.flatMap(channel => splitExposureRisk(from, to).map(({ bin, riskSeconds }) => ({ channel, bin, riskSeconds,
    events: Number(channel === event && bin === exposureAgeBin(to)), censored: Number(censored.includes(channel) && bin === exposureAgeBin(to)) })));
  return updateExposure(model, { sequence, at, appearance: a, digestion: 'empty', ingestions: 0, increments });
}
const candidate = (model, f = features(), extra = {}) => forecastCandidate(model, { features: f, eligibility: true, bindingsValid: true,
  currentSensations: { hunger: 'peckish', thirst: 'dry mouth', digestion: 'empty' }, exactSupport: { F: true, W: false, H: false }, ...extra });
function trained() { const m = createReusableOutcomeModel(); effect(m); cost(m); ingest(m); riskEvent(m); return m; }

test('empty predictor remains explicitly unknown, and all reads are pure', () => {
  const model = createReusableOutcomeModel(), before = clone(model);
  const p = predictPhysical(model, features()), f = candidate(model);
  assert.equal(p.effects.exposure.mean, null); assert.equal(p.T.mean, null); assert.equal(f.scorable, false); assert.equal(f.utility, null);
  assert.deepEqual(f.D, { F: null, W: null, H: null });
  for (const c of ['F', 'W', 'H']) { assert.equal(f.exposure.channels[c].discounted, 0); assert.deepEqual(f.exposure.channels[c].epistemicRange, [0, 1]); assert.equal(f.exposure.channels[c].unsupported, true); }
  encodeReusableOutcomeModel(model); reusableModelDiagnostics(model); assert.deepEqual(model, before);
});

test('receipt multi-effects count one physical experience; open intervals are not zero costs', () => {
  const model = createReusableOutcomeModel();
  effect(model, 1, features({ operation: 'pull' }), { held: true, output: true, exposure: false }, 12);
  let p = predictPhysical(model, features({ operation: 'pull' }));
  assert.equal(p.parentReceipts, 1); assert.equal(p.effects.held.mean, 1); assert.equal(p.effects.output.mean, 1); assert.equal(p.effects.exposure.mean, 0);
  assert.equal(p.effects.released.mean, null); assert.equal(p.T.mean, null); assert.equal(p.duration.mean, 12);
  cost(model, 1, features({ operation: 'pull' })); p = predictPhysical(model, features({ operation: 'pull' }));
  assert.equal(p.parentReceipts, 1); assert.equal(p.parentClosedIntervals, 1);
  const before = clone(model); assert.equal(effect(model, 1, features({ operation: 'pull' })).admitted, false); assert.equal(cost(model, 1, features({ operation: 'pull' })).admitted, false); assert.deepEqual(model, before);
});

test('physical effects, duration and closed costs pool with separate observed denominators', () => {
  const model = createReusableOutcomeModel(), other = features({ appearance: { ...appearance, color: 'red' } });
  effect(model, 1, features(), { exposure: true }, 10); effect(model, 2, other, { exposure: false }, 30);
  cost(model, 1, features(), 20); cost(model, 2, other, 40);
  const p = predictPhysical(model, features());
  close(p.effects.exposure.mean, (1 + 4 * ((1 + 4 * .5) / 5)) / 5);
  close(p.duration.mean, (10 + 4 * ((10 + 4 * 20) / 5)) / 5);
  assert.deepEqual(p.effects.exposure.support.map(s => s.observations), [2, 1, 1]);
  assert.equal(p.independentParentAndChild, false); assert.equal(p.marginalsOnly, true);
  effect(model, 3, features(), { exposure: null }, null);
  const q = predictPhysical(model, features()); assert.deepEqual(q.effects.exposure.support.map(s => s.observations), [2, 1, 1]); assert.deepEqual(q.duration.support.map(s => s.observations), [2, 1, 1]);
});

test('operation-specific work bands remain causal while capacity/count stay separate diagnostics', () => {
  const model = createReusableOutcomeModel();
  effect(model, 1, features({ operation: 'pull', workBand: '0', freeSlotBand: '0', countBand: '1' }), { output: false }, 30);
  effect(model, 2, features({ operation: 'pull', workBand: '1', freeSlotBand: '1', countBand: '2+' }), { output: true }, 10);
  const early = predictPhysical(model, features({ operation: 'pull', workBand: '0', freeSlotBand: '0', countBand: '1' }));
  const later = predictPhysical(model, features({ operation: 'pull', workBand: '1', freeSlotBand: '1', countBand: '2+' }));
  assert.ok(later.effects.output.mean > early.effects.output.mean); assert.ok(later.duration.mean < early.duration.mean);
  assert.equal(early.conditional.capacity.effects.output.mean, 0); assert.equal(later.conditional.capacity.effects.output.mean, 1);
  const changed = predictPhysical(model, features({ operation: 'pull', workBand: '0', freeSlotBand: '1', countBand: '2+' }));
  assert.deepEqual(changed.effects, early.effects); assert.notDeepEqual(changed.conditional, early.conditional);
  assert.equal(predictPhysical(model, features({ operation: 'strike' })).effects.output.mean, null);
});

test('costs use actual discounted per-minute targets once, independent of completion seconds', () => {
  const model = createReusableOutcomeModel(), f = features({ operation: 'wait' });
  effect(model, 1, f, { exposure: false }, 5); cost(model, 1, f, 60, 0);
  const p = candidate(model, f); close(p.utility, -.02 * temporalIntegral(0, 60)); close(p.physical.T.mean, temporalIntegral(0, 60)); assert.equal(p.physical.E.mean, 0);
  assert.throws(() => updatePhysicalInterval(model, { sequence: 2, at: 50, features: f, T: 60, E: 0 }), /per-minute/);
  assert.throws(() => updatePhysicalInterval(model, { sequence: 2, at: 50, features: f, T: 1, E: 2 }), /per-minute/);
});

test('event endpoint convention and zero-age rejection preserve real risk units', () => {
  assert.deepEqual([.1, 45, 45.1, 180, 180.1, 600, 600.1].map(exposureAgeBin), [0, 0, 1, 1, 2, 2, 3]);
  assert.deepEqual(splitExposureRisk(0, 600), [{ bin: 0, riskSeconds: 45 }, { bin: 1, riskSeconds: 135 }, { bin: 2, riskSeconds: 420 }]);
  assert.deepEqual(splitExposureRisk(45, 180), [{ bin: 1, riskSeconds: 135 }]); assert.deepEqual(splitExposureRisk(45, 45), []);
  assert.throws(() => exposureAgeBin(0), /Zero-age/); assert.throws(() => splitExposureRisk(10, 9), /reversed/);
  for (const age of [45, 180, 600]) { const m = createReusableOutcomeModel(); ingest(m); riskEvent(m, { to: age }); const forecast = forecastExposure(m, { appearance, digestion: 'empty' }); assert.ok(Number.isFinite(forecast.channels.F.rates[exposureAgeBin(age)].rate)); assert.equal(forecast.channels.F.eventCount, 1); }
});

test('exposure batches atomically reject events without risk and never add epsilon time', () => {
  const model = createReusableOutcomeModel(); ingest(model); const before = clone(model);
  assert.throws(() => updateExposure(model, { sequence: 2, at: 1001, appearance, digestion: 'empty', ingestions: 0,
    increments: [{ channel: 'F', bin: 0, riskSeconds: 0, events: 1, censored: 0 }] }), /without positive risk/);
  assert.deepEqual(model, before);
});

test('one earned F event yields the exact discounted piecewise integral, not a second reward', () => {
  const model = trained(), b = Math.log(2) / 300, rate = 1 / 30;
  const f = forecastExposure(model, { appearance, digestion: 'empty' });
  close(f.channels.F.probability, 1 - Math.exp(-rate * 45));
  close(f.channels.F.discounted, rate / (rate + b) * (1 - Math.exp(-(rate + b) * 45)));
  assert.ok(candidate(model).D.F > .39); assert.equal(f.channels.F.ingestions, 1); assert.equal(f.channels.F.eventCount, 1);
  assert.deepEqual(f.channels.F.rates[0].support.map(s => s.ingestions), [1, 1, 1]);
  assert.equal(f.channels.F.tailUncertain, true); assert.deepEqual(f.channels.F.unknownBins, [1, 2]);
  assert.equal(Object.hasOwn(model, 'reward'), false); assert.equal(Object.hasOwn(model, 'totals'), false);
});

test('F never closes W or H survival; delayed H stays a separate channel process', () => {
  const model = createReusableOutcomeModel(); ingest(model); riskEvent(model);
  riskEvent(model, { sequence: 3, from: 30, to: 180, channels: ['W', 'H'], event: 'H' });
  const f = forecastExposure(model, { appearance, digestion: 'empty', reported: { F: true } });
  assert.equal(f.channels.F.discounted, 0); assert.equal(f.channels.F.active, false); assert.equal(f.channels.H.active, true); assert.ok(f.channels.H.discounted > 0);
  assert.equal(f.channels.F.monitoredSeconds, 30); assert.equal(f.channels.H.monitoredSeconds, 180); assert.equal(f.channels.W.monitoredSeconds, 180);
  assert.equal(f.channels.F.eventCount, 1); assert.equal(f.channels.H.eventCount, 1); assert.equal(f.channels.H.ingestions, 1);
});

test('conditioning on known age integrates only remaining conditional survival', () => {
  const model = trained(), b = Math.log(2) / 300, rate = 1 / 30;
  const f = forecastExposure(model, { appearance, digestion: 'empty', ageSeconds: 30, horizonSeconds: 15 });
  close(f.channels.F.probability, 1 - Math.exp(-rate * 15)); close(f.channels.F.discounted, rate / (rate + b) * (1 - Math.exp(-(rate + b) * 15)));
  assert.throws(() => forecastExposure(model, { appearance, digestion: 'empty', horizonSeconds: 601 }), /600/);
});

test('risk flushes, duplicate batches and reopen never increase independent ingestions', () => {
  const model = createReusableOutcomeModel(); ingest(model);
  riskEvent(model, { sequence: 2, to: 20, event: null }); riskEvent(model, { sequence: 3, from: 20, to: 40, event: null });
  const before = clone(model); assert.equal(riskEvent(model, { sequence: 3, from: 20, to: 40, event: null }).admitted, false); assert.deepEqual(model, before);
  const saved = encodeReusableOutcomeModel(model), restored = restoreReusableOutcomeModel(saved, 4000); assert.deepEqual(restored, model);
  assert.equal(forecastExposure(restored, { appearance, digestion: 'empty' }).channels.F.ingestions, 1);
  assert.equal(forecastExposure(restored, { appearance, digestion: 'empty' }).channels.F.monitoredSeconds, 40);
  assert.deepEqual(model, before);
});

test('censoring adds only genuine monitored seconds and retains outcome uncertainty', () => {
  const model = createReusableOutcomeModel(); ingest(model);
  riskEvent(model, { to: 25, event: null, censored: ['F', 'W', 'H'] });
  const f = forecastExposure(model, { appearance, digestion: 'empty', censored: { F: true, W: true, H: true } });
  assert.equal(f.channels.H.active, false); assert.equal(f.channels.H.unsupported, true); assert.equal(f.channels.H.eventCount, 0);
  assert.equal(f.channels.H.monitoredSeconds, 25); assert.deepEqual(f.channels.H.epistemicRange, [0, 1]);
  assert.equal(model.rows.find(r => r.type === 'exposure').censored[2], 1);
});

test('rate children use exactly thirty seconds of parent shrinkage and conservative H floor', () => {
  const model = createReusableOutcomeModel(), other = { ...appearance, color: 'red' };
  ingest(model, 1); riskEvent(model, { sequence: 2, to: 30, event: 'H' });
  ingest(model, 3, other); riskEvent(model, { sequence: 4, a: other, to: 30, event: null });
  const f = forecastExposure(model, { appearance: other, digestion: 'empty' });
  const parent = 1 / 60, material = (30 * parent) / 60, leaf = (30 * material) / 60;
  close(f.channels.H.rates[0].rate, leaf); assert.equal(f.channels.H.parentFloorApplied, true);
  close(f.channels.H.probability, 1 - Math.exp(-parent * 45)); close(f.channels.H.survival, 1 - f.channels.H.probability);
});

test('positive biological use is channel-specific and separate from frozen parameters', () => {
  const model = trained(), before = clone(model);
  const none = candidate(model, features(), { exactSupport: { F: false, W: false, H: false } });
  const food = candidate(model); const waterOnly = candidate(model, features(), { exactSupport: { F: false, W: true, H: false } });
  assert.equal(none.D.F, food.D.F); assert.equal(none.usedD.F, 0); assert.ok(food.usedD.F > 0); assert.equal(waterOnly.usedD.F, 0);
  assert.equal(none.scorable, true); assert.equal(none.safe, false); assert.deepEqual(none.exposure.channels.F.epistemicRange, [0, 1]);
  assert.deepEqual(model, before);
});

test('eight new identities retain equal pooled points and zero firsthand positive use', () => {
  const model = trained(), expected = candidate(model).D;
  for (let i = 1; i <= 8; i++) { const f = candidate(model, features({ objectId: `object:${i}`, ingestionId: `ingestion:${i}` }), { exactSupport: {} });
    assert.deepEqual(f.D, expected); assert.equal(f.usedD.F, 0); assert.equal(f.exposure.channels.F.firsthand, false); assert.deepEqual(f.exposure.channels.H.epistemicRange, [0, 1]); }
  assert.ok(model.keys.every(k => !k.includes('object:') && !k.includes('ingestion:')));
});

test('immutable nuisance queries agree and quantity depletion never changes appearance', () => {
  const model = trained(), before = clone(model), base = candidate(model);
  for (let i = 0; i < 16; i++) { const q = candidate(model, features({ focus: Boolean(i % 2), history: ['strike', i], unrelatedExposures: i, objectId: `object:${i}` })); assert.deepEqual(q, base); }
  const reduced = candidate(model, features({ countBand: '1' })); assert.deepEqual(reduced.physical.features.appearance, base.physical.features.appearance); assert.deepEqual(reduced.D, base.D);
  assert.deepEqual(model, before);
});

test('old-meal baseline cannot give unrelated operations new-exposure benefit', () => {
  const model = trained();
  const B = forecastPending(model, [{ appearance, digestion: 'empty', ageSeconds: 5 }]); assert.ok(B.B.F > 0);
  for (const [i, operation] of ['inspect_object', 'wait', 'strike', 'release'].entries()) {
    const f = features({ operation }); effect(model, i + 2, f, { exposure: false }, i + 1); cost(model, i + 2, f, 10 + i);
    const p = candidate(model, f); assert.deepEqual(p.D, { F: 0, W: 0, H: 0 }); close(p.utility, -.02 * p.physical.T.mean - .02 * p.physical.E.mean);
  }
  assert.equal(model.rows.find(r => r.type === 'exposure').ingestions, 1);
});

test('need weights change valuation exactly without changing stable model parameters', () => {
  const model = trained(), before = clone(model), low = candidate(model, features(), { currentSensations: { hunger: 'content', thirst: 'quenched', digestion: 'empty' } });
  const high = candidate(model, features(), { currentSensations: { hunger: 'ravenous', thirst: 'parched', digestion: 'empty' } });
  close(high.utility - low.utility, 1.5 * high.usedD.F + 1.5 * high.usedD.W); assert.deepEqual(high.D, low.D); assert.deepEqual(model, before);
  assert.deepEqual(currentNeedWeights({ hunger: 'peckish', thirst: 'dry mouth' }), { F: 1, W: 1, H: -4, T: -.02, E: -.02 });
});

test('actual eligibility and factual binding validity outrank any learned value', () => {
  const model = trained();
  assert.equal(candidate(model, features(), { eligibility: false }).scorable, false);
  assert.equal(candidate(model, features(), { bindingsValid: false }).scorable, false);
  assert.throws(() => forecastCandidate(model, { features: features() }), /eligibility/);
});

test('matched selector preserves primitive-group exploration and all four declared draws', () => {
  const candidates = [{ action: { type: 'sample', targetId: 'object:1' } }, { action: { type: 'sample', targetId: 'object:2' } }, { action: { type: 'wait', seconds: 5 } }];
  const forecasts = candidates.map(() => ({ eligibility: true, scorable: false, utility: null }));
  const before = clone({ candidates, forecasts }), draws = [.123, .8, .9, .4];
  const a = chooseMatched(candidates, forecasts, { draws }), b = chooseMatched(candidates, forecasts, { draws });
  assert.equal(a.selectedIndex, 2); assert.equal(a.exploring, true); assert.equal(a.committedDrawCount, 4); assert.deepEqual(a.draws, draws); assert.deepEqual(a, b); assert.equal(Object.isFrozen(a.selected.action), true);
  assert.deepEqual({ candidates, forecasts }, before);
  const ranked = [{ eligibility: true, scorable: true, utility: -1 }, { eligibility: true, scorable: true, utility: -1 }, { eligibility: true, scorable: true, utility: -2 }];
  candidates[1].focus = true; assert.equal(chooseMatched(candidates, ranked, { draws }).selectedIndex, 1);
  assert.equal(chooseMatched(candidates, ranked, { draws: [.1, .1, .9, .4] }).selectedIndex, 2);
});

test('opaque identity bijection preserves predictions and corresponding matched selection', () => {
  const model = trained(), q = candidate(model), candidates = [{ action: { type: 'sample', targetId: 'object:1' } }, { action: { type: 'sample', targetId: 'object:2' } }];
  const a = chooseMatched(candidates, [q, q], { draws: [.1, .8, .7, .5] });
  const renamed = JSON.parse(JSON.stringify(candidates).replaceAll('object:1', 'object:800').replaceAll('object:2', 'object:99'));
  const b = chooseMatched(renamed, [q, q], { draws: [.1, .8, .7, .5] }); assert.equal(a.selectedIndex, b.selectedIndex); assert.equal(b.selected.action.targetId, 'object:99');
});

test('strict restore rejects corruption rather than dropping evidence or repairing numbers', () => {
  const model = trained();
  for (const corrupt of [
    m => { m.extra = 'unapproved'; }, m => { m.rows[0].receipts = NaN; }, m => { m.rows[0].effects.exposure.yes = 3; },
    m => { m.rows[0].T.sumSq = -1; }, m => { m.keys[0] = '["p","sample","held","object:1"]'; },
    m => { m.rows.push(clone(m.rows[0])); }, m => { m.rows[0].run = () => 1; }, m => { m.cursors.receipt.at = 99999; },
    m => { m.rows.find(r => r.type === 'exposure').cells[0][0].riskSeconds = 0; }, m => { m.keys.push('["e"]'); },
  ]) { const bad = clone(model); corrupt(bad); assert.throws(() => restoreReusableOutcomeModel(bad, 5000)); }
  assert.deepEqual(restoreReusableOutcomeModel(encodeReusableOutcomeModel(model), 5000), model);
  const weird = clone(model); Object.defineProperty(weird, 'version', { get() { throw new Error('must not execute accessor'); }, enumerable: true }); assert.throws(() => restoreReusableOutcomeModel(weird), /fields/);
});

test('physical row capacity fails atomically, retaining all earlier evidence', () => {
  const model = createReusableOutcomeModel(); let seq = 1, failed = false;
  for (let i = 0; i < 200; i++) {
    const f = features({ appearance: { ...appearance, color: `public-color-${i}` } }), before = clone(model);
    try { effect(model, seq++, f); } catch (error) { assert.equal(error.code, 'REUSABLE_CAPACITY'); assert.deepEqual(model, before); failed = true; break; }
  }
  assert.equal(failed, true); assert.ok(reusableModelDiagnostics(model).physicalRows <= 192); assert.ok(model.rows.length <= 256);
});

test('exposure row cap includes parent rows and has no optimistic row eviction', () => {
  const model = createReusableOutcomeModel();
  for (let i = 0; i < 31; i++) ingest(model, i + 1, { ...appearance, color: `color-${i}` });
  assert.equal(reusableModelDiagnostics(model).exposureRows, 63); const before = clone(model);
  assert.throws(() => ingest(model, 32, { ...appearance, color: 'another' }), e => e.code === 'REUSABLE_CAPACITY'); assert.deepEqual(model, before);
  assert.throws(() => restoreReusableOutcomeModel({ ...model, rows: Array.from({ length: 257 }, () => clone(model.rows[0])) }), e => e.code === 'REUSABLE_CAPACITY');
});

test('public projection preserves unknowns and excludes unapproved feature dimensions', () => {
  assert.deepEqual(reusableAppearance({ shape: 'round', size: 7, count: 3, objectId: 'object:1' }), { shape: 'round', color: 'unknown', texture: 'unknown', motion: 'unknown', size: 'unknown', smell: 'unknown' });
  assert.equal(Object.hasOwn(reusablePhysicalFeatures(features({ body: { hunger: 'hungry' }, position: { x: 4, y: 5 } })), 'body'), false);
  assert.throws(() => reusableAppearance({ shape: 'x'.repeat(101) }), /appearance/);
  assert.equal(REUSABLE_MODEL.physicalPooling, 4); assert.equal(REUSABLE_MODEL.exposurePoolingSeconds, 30);
});


test('sensor-label dispatcher is atomic and replay does not train again', () => {
  const model = createReusableOutcomeModel();
  const labels = { receiptUpdates: [{ sequence: 1, at: 10, features: features(), completion: 'success', effects: { exposure: true }, durationSeconds: 10 }],
    intervalUpdates: [{ sequence: 1, at: 20, features: features(), T: temporalIntegral(0, 20), E: temporalIntegral(0, 10, 1 / 3) }],
    exposureUpdates: [{ sequence: 1, at: 10, appearance, digestion: 'empty', ingestions: 1, increments: [] }] };
  assert.deepEqual(applyReusableLabels(model, labels), { receipts: 1, intervals: 1, exposures: 1 });
  const before = clone(model); assert.deepEqual(applyReusableLabels(model, labels), { receipts: 0, intervals: 0, exposures: 0 }); assert.deepEqual(model, before);
  const bad = clone(labels); bad.receiptUpdates[0].sequence = 2; bad.receiptUpdates[0].at = 30; bad.intervalUpdates[0].sequence = 2; bad.intervalUpdates[0].at = 40; bad.intervalUpdates[0].T = 60;
  assert.throws(() => applyReusableLabels(model, bad), /per-minute/); assert.deepEqual(model, before);
});

test('unobserved completed effects never qualify as a supported exploitation row', () => {
  const model = createReusableOutcomeModel(); effect(model, 1, features(), {}, 5); cost(model);
  const p = candidate(model); assert.equal(p.scorable, false); assert.equal(p.physical.parentReceipts, 1); assert.equal(p.physical.parentObservedEffects, 0); assert.equal(p.D.F, null);
});

test('strict encoding rejects extra array fields and nonfinite empirical rates', () => {
  const model = trained(), extra = clone(model); extra.rows.extra = 'must not be silently dropped'; assert.throws(() => encodeReusableOutcomeModel(extra), /array/);
  const rates = clone(model); for (const row of rates.rows.filter(r => r.type === 'exposure')) row.cells[0][0].riskSeconds = Number.MIN_VALUE;
  assert.throws(() => restoreReusableOutcomeModel(rates), /Nonfinite empirical rate/);
});

test('restore rejects receipt, interval and ingestion counts larger than admission sequences', () => {
  const physical = createReusableOutcomeModel(); effect(physical); cost(physical);
  const receipts = clone(physical);
  for (const row of receipts.rows) { row.receipts = 100; row.completion.success = 100; }
  assert.throws(() => restoreReusableOutcomeModel(receipts), /physical admission cursor/);
  const intervals = clone(physical);
  for (const row of intervals.rows.filter(r => r.intervals)) { row.intervals = 100; row.T.n = 100; row.E.n = 100; }
  assert.throws(() => restoreReusableOutcomeModel(intervals), /physical admission cursor/);
  const exposure = createReusableOutcomeModel(); ingest(exposure);
  for (const row of exposure.rows) row.ingestions = 100;
  assert.throws(() => restoreReusableOutcomeModel(exposure), /Invalid exposure row/);
});

test('no-eviction hierarchy conserves integer experience and event counts exactly', () => {
  const physical = createReusableOutcomeModel(); effect(physical); effect(physical, 2, features({ appearance: { ...appearance, color: 'red' } }), { exposure: false });
  const receipts = clone(physical), parent = receipts.rows.find(r => JSON.parse(receipts.keys[r.key])[0] === 'p');
  receipts.cursors.receipt.sequence = 3; parent.lastReceiptSeq = 3; parent.receipts = 3; parent.completion.success = 3;
  assert.throws(() => restoreReusableOutcomeModel(receipts), /Nonconserved hierarchy receipts/);
  const effects = clone(physical), p = effects.rows.find(r => JSON.parse(effects.keys[r.key])[0] === 'p'); p.effects.exposure.yes = 2;
  assert.throws(() => restoreReusableOutcomeModel(effects), /Nonconserved hierarchy effect/);
  const exposure = createReusableOutcomeModel(); ingest(exposure, 1); ingest(exposure, 2, { ...appearance, color: 'red' });
  const root = exposure.rows.find(r => JSON.parse(exposure.keys[r.key])[0] === 'e');
  exposure.cursors.exposure.sequence = 3; root.lastSequence = 3; root.ingestions = 3;
  assert.throws(() => restoreReusableOutcomeModel(exposure), /Nonconserved hierarchy ingestions/);
});

test('trusted immutable session is bit-identical to strict updates and forecasts through a mixed trace', () => {
  const strict = createReusableOutcomeModel(), session = createReusableModelSession(strict);
  const updates = [];
  for (let i = 1; i <= 24; i++) {
    const f = features({ appearance: { ...appearance, color: `public-${i % 4}-界` }, workBand: i % 2 ? '0' : '1' });
    updates.push(['receipt', { sequence: i, at: i * 1000, features: f, completion: i % 4 ? 'success' : 'refused', effects: { exposure: i % 3 !== 0, held: i % 2 === 0, output: null }, durationSeconds: i % 2 ? i : null }]);
    updates.push(['interval', { sequence: i, at: i * 1000, features: f, T: temporalIntegral(0, i * 3), E: temporalIntegral(0, i * 2, 1 / 3) }]);
    updates.push(['exposure', { sequence: 2 * i - 1, at: i * 1000, appearance: f.appearance, digestion: i % 2 ? 'empty' : 'full', ingestions: 1, increments: [] }]);
    const to = [30, 45, 180, 600, 900][i % 5];
    updates.push(['exposure', { sequence: 2 * i, at: i * 1000 + to, appearance: f.appearance, digestion: i % 2 ? 'empty' : 'full', ingestions: 0,
      increments: ['F', 'W', 'H'].flatMap(channel => splitExposureRisk(0, to).map(({ bin, riskSeconds }) => ({ channel, bin, riskSeconds,
        events: Number(channel === ['F', 'W', 'H'][i % 3] && bin === exposureAgeBin(to)), censored: 0 }))) }]);
  }
  const oldSnapshots = [];
  for (const [kind, raw] of updates) {
    const update = { receipt: updatePhysicalReceipt, interval: updatePhysicalInterval, exposure: updateExposure }[kind];
    const before = session.snapshot(); oldSnapshots.push([before, JSON.stringify(before)]);
    assert.deepEqual(session.apply(kind, raw), update(strict, raw));
    assert.deepEqual(session.snapshot(), strict); assert.deepEqual(encodeReusableOutcomeModel(session.snapshot()), strict);
    assert.deepEqual(candidate(session.snapshot()), candidate(strict));
    assert.equal(reusableDictionaryDiagnostics(session.snapshot()).dictionaryBytes, new TextEncoder().encode(JSON.stringify(strict.keys)).byteLength);
  }
  for (const [snapshot, bytes] of oldSnapshots) assert.equal(JSON.stringify(snapshot), bytes, 'frozen checkpoints changed through aliasing');
});

test('trusted snapshot rejects mutation and never caches mutable caller identity', () => {
  const input = trained(), original = clone(input), session = createReusableModelSession(input), snapshot = session.snapshot();
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.keys) && Object.isFrozen(snapshot.rows[0].effects.exposure));
  assert.throws(() => { snapshot.rows[0].effects.exposure.yes = 100; }, TypeError);
  assert.throws(() => { snapshot.keys.push('malicious'); }, TypeError);
  input.rows[0].effects.exposure.yes = 99; assert.deepEqual(snapshot, original);
  assert.throws(() => createReusableModelSession(input));
  assert.equal(createReusableQuerySnapshot(snapshot), snapshot);
  assert.throws(() => createReusableQuerySnapshot(snapshot, 0), /clock/);
  const bad = clone(original); Object.defineProperty(bad, 'version', { get() { assert.fail('accessor executed'); }, enumerable: true });
  assert.throws(() => createReusableQuerySnapshot(bad), /fields/); assert.equal(Object.isFrozen(bad), false);
});

test('trusted duplicate, reordering, budget refusal and arithmetic failures leave the old snapshot intact', () => {
  const session = createReusableModelSession(createReusableOutcomeModel());
  const receipt = { sequence: 2, at: 20, features: features(), completion: 'success', effects: { exposure: true }, durationSeconds: 5 };
  session.apply('receipt', receipt); const before = session.snapshot(), bytes = JSON.stringify(before), forecast = candidate(before);
  for (const sequence of [2, 1]) assert.equal(session.apply('receipt', { ...receipt, sequence }, { admit() { assert.fail('duplicate reached admission'); } }).admitted, false);
  assert.equal(session.snapshot(), before);
  assert.throws(() => session.apply('receipt', { ...receipt, sequence: 3, at: 30 }, { admit(candidate) { assert.ok(Object.isFrozen(candidate)); const error = new Error('combined cap'); error.code = 'REUSABLE_COMBINED_CAPACITY'; throw error; } }), /combined cap/);
  assert.equal(session.snapshot(), before); assert.equal(JSON.stringify(session.snapshot()), bytes); assert.deepEqual(candidate(session.snapshot()), forecast);
  assert.throws(() => session.apply('receipt', { ...receipt, sequence: 3, at: 30, durationSeconds: Number.MAX_SAFE_INTEGER }), /duration/);
  assert.equal(session.snapshot(), before);
  assert.throws(() => session.apply('__proto__', receipt), /kind/);
  assert.throws(() => session.apply('receipt', { ...receipt, sequence: 3, at: 30 }, { admit() { session.apply('receipt', { ...receipt, sequence: 4, at: 40 }); } }), /Reentrant/);
  assert.equal(session.snapshot(), before);
  assert.equal(session.apply('receipt', { ...receipt, sequence: 3, at: 30 }).admitted, true);
});

test('trusted capacity refusal has the same result as strict atomic admission', () => {
  const strict = createReusableOutcomeModel(), session = createReusableModelSession(strict); let denied = false;
  for (let i = 1; i < 40; i++) {
    const row = { sequence: i, at: i, appearance: { ...appearance, color: `material-${i}` }, digestion: 'empty', ingestions: 1, increments: [] }, before = session.snapshot();
    let strictError; try { updateExposure(strict, row); } catch (error) { strictError = error; }
    if (strictError) { assert.throws(() => session.apply('exposure', row), e => e.code === strictError.code); assert.equal(session.snapshot(), before); assert.deepEqual(session.snapshot(), strict); denied = true; break; }
    session.apply('exposure', row); assert.deepEqual(session.snapshot(), strict);
  }
  assert.equal(denied, true);
});

test('snapshot ownership rejects nested accessors and proxies before executing them', () => {
  const accessor = trained(); let accessed = 0;
  Object.defineProperty(accessor.rows[0], 'key', { get() { accessed++; return 0; }, enumerable: true });
  assert.throws(() => createReusableModelSession(accessor), /data record/); assert.equal(accessed, 0);
  const proxy = new Proxy(trained(), { get() { assert.fail('proxy trap executed'); }, ownKeys() { assert.fail('proxy trap executed'); }, getPrototypeOf() { assert.fail('proxy trap executed'); } });
  assert.throws(() => createReusableModelSession(proxy), /fields/);
  const nested = trained(); nested.rows[0] = new Proxy(nested.rows[0], { get() { assert.fail('nested proxy trap executed'); } });
  assert.throws(() => createReusableQuerySnapshot(nested), /data record/);
  const array = trained(); array.rows = new Proxy(array.rows, { ownKeys() { assert.fail('array proxy trap executed'); } });
  assert.throws(() => createReusableQuerySnapshot(array), /array/);
  const keysProxy = trained(); keysProxy.keys = new Proxy(keysProxy.keys, { get() { assert.fail('dictionary proxy trap executed'); } });
  assert.throws(() => createReusableQuerySnapshot(keysProxy), /arrays/);
  const cellsProxy = trained(), er = cellsProxy.rows.find(r => r.type === 'exposure'); er.cells = new Proxy(er.cells, { get() { assert.fail('channel proxy trap executed'); } });
  assert.throws(() => createReusableQuerySnapshot(cellsProxy), /array/);
  const session = createReusableModelSession(createReusableOutcomeModel()), badAppearance = { ...appearance };
  Object.defineProperty(badAppearance, 'shape', { get() { assert.fail('appearance accessor executed'); } });
  assert.throws(() => session.apply('exposure', { sequence: 1, at: 1, appearance: badAppearance, digestion: 'empty', ingestions: 1, increments: [] }), /data record/);
  assert.deepEqual(session.snapshot(), createReusableOutcomeModel());
});

test('raw dictionary validation rejects hooks and nonprimitive entries before serialization', () => {
  let calls = 0;
  const hooked = () => { calls++; return '["e"]'; };
  const getter = createReusableOutcomeModel(); Object.defineProperty(getter.keys, '0', { enumerable: true, get: hooked });
  const toJSON = createReusableOutcomeModel(); toJSON.keys.toJSON = hooked;
  const object = createReusableOutcomeModel(); object.keys.push({ toJSON: hooked });
  const proxy = createReusableOutcomeModel(); proxy.keys.push(new Proxy({}, { get: hooked, ownKeys: hooked, getPrototypeOf: hooked }));
  for (const malformed of [getter, toJSON, object, proxy]) {
    assert.throws(() => validateReusableOutcomeModel(malformed));
    assert.throws(() => createReusableModelSession(malformed));
    assert.throws(() => reusableModelDiagnostics(malformed));
    assert.equal(calls, 0);
  }
  const nested = trained(); nested.rows[0].toJSON = hooked;
  assert.throws(() => reusableModelDiagnostics(nested), /fields/); assert.equal(calls, 0);
});

test('exposure label arrays reject proxies before reading length', () => {
  let calls = 0;
  const increments = new Proxy([], { get() { calls++; throw new Error('must not execute'); } });
  const raw = { sequence: 1, at: 1, appearance, digestion: 'empty', ingestions: 1, increments };
  const strict = createReusableOutcomeModel(), session = createReusableModelSession(strict);
  assert.throws(() => updateExposure(strict, raw), /array/);
  assert.throws(() => session.apply('exposure', raw), /array/);
  assert.equal(calls, 0); assert.deepEqual(strict, createReusableOutcomeModel()); assert.deepEqual(session.snapshot(), strict);
});
