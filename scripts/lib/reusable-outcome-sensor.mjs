/** Experimental public-observation adapter. No world, physiology or reward writes.
 * Feed native callbacks in chronological order; apply returned model updates once.
 * Reward ownership remains entirely with the existing temporal ledger.
 */
import { types as nodeTypes } from 'node:util';
import { temporalContext, TEMPORAL_OPERATIONS } from '../../src/temporal-returns.js';

export const REUSABLE_SENSOR_LIMITS = Object.freeze({ exposures: 64, receipts: 384, events: 128, materials: 64 });
const CHANNELS = ['F', 'W', 'H'];
const FIELDS = ['shape', 'color', 'texture', 'motion', 'size', 'smell'];
const MAX = 1e9;
const copy = x => structuredClone(x);
const finite = x => Number.isFinite(x) && x >= 0 && x <= 1e12;
const integer = x => Number.isSafeInteger(x) && x >= 0 && x <= MAX;
const positive = x => integer(x) && x > 0;
const objectId = x => typeof x === 'string' && /^object:\d{1,9}$/.test(x);
const ingestionId = x => typeof x === 'string' && /^ingestion:[1-9]\d{0,9}$/.test(x) && Number(x.slice(10)) <= MAX;
const sourceSeq = e => typeof e?.id === 'string' && /^feedback:[1-9]\d{0,9}$/.test(e.id) && Number(e.id.slice(9)) <= MAX ? Number(e.id.slice(9)) : null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const empty = () => ({ exposureUpdates: [], receiptUpdates: [], intervalUpdates: [] });
// Runtime-only provenance for this exact emitted update object. IDs never enter
// the numerical payload/model; durable admission lives in the experiment sidecar.
const exposureUpdateBindings = new WeakMap();
export function reusableExposureUpdateBinding(update) { return exposureUpdateBindings.get(update) || null; }
const band = n => n < 2 ? String(n) : n < 4 ? '2..3' : n < 8 ? '4..7' : n < 16 ? '8..15' : '16+';
const countBand = n => Number.isFinite(n) && n >= 0 ? n === 0 ? '0' : n === 1 ? '1' : '2+' : 'unknown';
const work = r => r.outcome?.workedSeconds ?? r.outcome?.durationSeconds ?? 0;
const interrupted = new Set(['PRIORITY_CHANGED', 'CONTACT_ESCAPE', 'COLLAPSED', 'RESTART_INTERRUPTED', 'REST_INTERRUPTED']);
function fail(message) { throw new TypeError(`Reusable sensor: ${message}`); }
function clock(sensor, at) { if (!finite(at) || at < sensor.clockAt) fail('clock cannot reverse'); }
function next(sensor) { if (sensor.updateSequence >= MAX) fail('update sequence exhausted'); return ++sensor.updateSequence; }
function appearance(object) { return temporalContext({ appearance: { ...object?.appearance, ...(object?.motion === undefined ? {} : { motion: object.motion }) } }).appearance; }
const body = view => temporalContext({ body: view?.body }).body;
const eventBits = e => (e?.effect === 'sustained' ? 1 : 0) | (e?.thirst === 'easing' ? 2 : 0) | (e?.effect === 'discomfort' ? 4 : 0);
const eventBin = age => age <= 45 ? 0 : age <= 180 ? 1 : age <= 600 ? 2 : 3;
function splitRisk(from, to) {
  const result = [];
  for (const [bin, lo, hi] of [[0, 0, 45], [1, 45, 180], [2, 180, 600], [3, 600, Infinity]]) {
    const seconds = Math.min(to, hi) - Math.max(from, lo);
    if (seconds > 0) result.push({ bin, riskSeconds: seconds });
  }
  return result;
}
function canonicalSwallow(memory, ing) {
  if (!ing || !ingestionId(ing.id) || !objectId(ing.objectId) || !positive(ing.seq) || !positive(ing.actionId) || !finite(ing.at)) return null;
  return memory.receipts.find(r => r.seq === ing.seq && r.request.type === 'sample' && r.request.targetId === ing.objectId &&
    r.completedAt === ing.at && r.outcome?.ok === true && r.outcome.code === 'SWALLOWED' &&
    r.outcome.actionId === ing.actionId && r.outcome.ingestionId === ing.id) || null;
}
function matchedIngestion(memory, exposure) {
  return memory.ingestions.find(i => i.id === exposure.id && i.seq === exposure.seq && i.objectId === exposure.objectId &&
    i.actionId === exposure.actionId && i.at === exposure.at) || null;
}
function admissible(memory, exposure) {
  const ing = matchedIngestion(memory, exposure);
  return memory.creditBlocked === false && ing?.creditBlocked === false && canonicalSwallow(memory, ing) ? ing : null;
}
function addBatch(sensor, result, exposure, at, increments, ingestions = 0) {
  if (!increments.length && !ingestions) return;
  const cells = new Map();
  for (const i of increments) {
    const key = `${i.channel}:${i.bin}`, cell = cells.get(key);
    if (cell) { cell.riskSeconds += i.riskSeconds; cell.events += i.events; cell.censored += i.censored; }
    else cells.set(key, { ...i });
  }
  const update = { sequence: next(sensor), at, appearance: copy(exposure.appearance), digestion: exposure.body.digestion, ingestions, increments: [...cells.values()] };
  exposureUpdateBindings.set(update, exposure.id);
  result.exposureUpdates.push(update);
}
function flushExposure(exposure, at) {
  const increments = [];
  for (let c = 0; c < 3; c++) if (!((exposure.admitted | exposure.censored) & (1 << c))) {
    if (at < exposure.riskThroughAt[c]) fail('event predates risk watermark');
    for (const segment of splitRisk(exposure.riskThroughAt[c] - exposure.at, at - exposure.at)) increments.push({ channel: CHANNELS[c], ...segment, events: 0, censored: 0 });
    exposure.riskThroughAt[c] = at;
  }
  return increments;
}
function censor(sensor, result, exposure, at, mask = 7) {
  const increments = [];
  for (let c = 0; c < 3; c++) if (mask & (1 << c) && !((exposure.admitted | exposure.censored) & (1 << c))) {
    exposure.censored |= 1 << c; sensor.censoredChannels++;
    increments.push({ channel: CHANNELS[c], bin: eventBin(exposure.riskThroughAt[c] - exposure.at), riskSeconds: 0, events: 0, censored: 1 });
  }
  addBatch(sensor, result, exposure, at, increments);
}
function refreshMaterial(material, object, at) {
  const current = appearance(object);
  if (!same(current, material.appearance)) {
    if (material.generation >= MAX) fail('transformation sequence exhausted');
    material.generation++; material.appearance = current;
  }
  material.lastSeenAt = at; material.known = true;
}
function materialFor(sensor, object, view) {
  let material = sensor.materials.find(m => m.objectId === object?.id);
  if (material) return material;
  if (!objectId(object?.id)) return null;
  if (sensor.materials.length >= REUSABLE_SENSOR_LIMITS.materials) {
    const index = sensor.materials.findIndex(m => !sensor.exposures.some(e => e.objectId === m.objectId));
    if (index < 0) fail('material evidence capacity exhausted');
    sensor.materials.splice(index, 1);
  }
  material = { objectId: object.id, appearance: appearance(object), generation: 0,
    lastSeenAt: finite(object.observedAt) ? object.observedAt : view.at,
    known: object.observedAt === sensor.observationAt };
  sensor.materials.push(material); return material;
}
function featuresFor(view, memory, receipt) {
  const request = receipt.request, object = view.objects?.find(o => o.id === request.targetId);
  const inReach = Boolean(object && object.scene === view.scene && finite(object.observedAt) && object.observedAt <= view.at && view.at - object.observedAt < 8 &&
    Number.isFinite(view.reach) && view.reach >= 0 && Number.isFinite(view.position?.x) && Number.isFinite(view.position?.y) &&
    Number.isFinite(object.position?.x) && Number.isFinite(object.position?.y) &&
    Math.hypot(view.position.x - object.position.x, view.position.y - object.position.y) <= view.reach);
  return { operation: request.type, appearance: appearance(object),
    relation: request.type === 'move' ? 'route' : objectId(request.targetId) ? view.held.includes(request.targetId) ? 'held' : inReach ? 'reach' : 'unknown' : 'unknown',
    workBand: objectId(request.targetId) && (memory.historyCensored || memory.model.historyCensored || memory.receipts[0]?.seq > 1) ? 'unknown' :
      band(memory.receipts.filter(r => r.seq < receipt.seq && r.request.type === request.type && r.request.targetId === request.targetId && r.outcome?.workedSeconds > 0).length),
    freeSlotBand: Number.isFinite(view.capacity) ? countBand(Math.max(0, view.capacity - view.held.length)) : 'unknown',
    countBand: object ? countBand(object.count) : 'unknown' };
}
/** Shared, pure pre-action feature construction for training and query probes. */
export function reusableCandidateFeatures(sensor, { memory, view, action }) {
  if (!action || !TEMPORAL_OPERATIONS.includes(action.type)) fail('invalid candidate operation');
  return featuresFor(view, memory, { seq: memory.nextSeq, request: action, key: null });
}
function proofCopy(ing) {
  if (!ing) return null;
  return { id: ing.id, objectId: ing.objectId, actionId: ing.actionId, seq: ing.seq, at: ing.at,
    channels: ing.channels, creditBlocked: ing.creditBlocked, channelProof: copy(ing.channelProof) };
}
export function createReusableOutcomeSensor({ at = 0 } = {}) {
  if (!finite(at)) fail('invalid initial clock');
  return { version: 1, clockAt: at, lastRiskAt: at, observationAt: null, lastSubmissionSeq: 0, lastReceiptSeq: 0, lastIntervalSeq: 0,
    feedbackCursor: 0, updateSequence: 0, receipts: [], exposures: [], materials: [], events: [],
    totals: [0, 0, 0], censoredChannels: 0, integrityFailure: null };
}
/** Genuine scheduled perception batch only. Cached object maps are not visibility.
 * Missing visibility makes applicability unknown. A fresh exact-identity matching
 * signature can establish current applicability; it asserts no unseen history.
 */
export function observeReusableMaterials(sensor, { view, observationAt, observedIds, continuous = true }) {
  if (!finite(observationAt) || observationAt > view.at || sensor.observationAt !== null && observationAt < sensor.observationAt ||
      !Array.isArray(observedIds) || observedIds.length > 1024 || observedIds.some(id => !objectId(id))) fail('invalid public observation batch');
  const ids = new Set(observedIds);
  for (const id of ids) if (!view.objects?.some(o => o.id === id && o.observedAt === observationAt)) fail('unproved public observation');
  sensor.observationAt = observationAt;
  for (const material of sensor.materials) {
    const object = continuous && ids.has(material.objectId) ? view.objects.find(o => o.id === material.objectId) : null;
    if (!object) { material.known = false; continue; }
    refreshMaterial(material, object, observationAt);
  }
}
/** Call after actual submission; view is the immutable PRE-submission view.
 * An unknown or evicted closed ledger interval never becomes a zero-cost sample.
 */
export function observeReusableSubmission(sensor, { memory, seq, view }) {
  const result = empty(), receipt = memory.receipts.find(r => r.seq === seq);
  if (!receipt || !positive(seq) || receipt.at !== view.at || seq <= sensor.lastSubmissionSeq) return result;
  clock(sensor, view.at);
  const closed = memory.model.transitions.find(t => t.seq === seq - 1 && t.nextSeq === seq && t.endAt === view.at);
  const previous = sensor.receipts.find(r => r.seq === seq - 1);
  if (closed && previous && closed.seq > sensor.lastIntervalSeq) {
    result.intervalUpdates.push({ sequence: closed.seq, at: closed.endAt, features: copy(previous.features), T: closed.reward[3], E: closed.reward[4] });
    sensor.lastIntervalSeq = closed.seq; previous.interval = true;
  }
  // Store only public, bounded causal features and relation observations.
  sensor.receipts.push({ seq, at: receipt.at, features: featuresFor(view, memory, receipt),
    heldBefore: objectId(receipt.request.targetId) ? view.held.includes(receipt.request.targetId) : null,
    completed: false, interval: false });
  while (sensor.receipts.length > REUSABLE_SENSOR_LIMITS.receipts) sensor.receipts.shift();
  sensor.lastSubmissionSeq = seq; sensor.clockAt = view.at;
  return result;
}
/** Call after the existing ledger has admitted the authoritative completion. */
export function observeReusableCompletion(sensor, { memory, seq, view }) {
  const result = empty(), receipt = memory.receipts.find(r => r.seq === seq), saved = sensor.receipts.find(r => r.seq === seq);
  if (!receipt?.outcome || !saved || saved.completed || seq <= sensor.lastReceiptSeq) return result;
  if (receipt.completedAt !== view.at || receipt.completedAt < receipt.at) fail('completion clock mismatch');
  clock(sensor, view.at);
  // Action-local refreshes are public facts but do not assert a scheduled
  // continuity batch. A changed/staler binding is unknown until that batch.
  for (const material of sensor.materials) {
    const object = view.objects.find(x => x.id === material.objectId);
    if (!object || object.observedAt !== material.lastSeenAt || !same(appearance(object), material.appearance)) material.known = false;
  }
  const o = receipt.outcome, target = receipt.request.targetId, held = objectId(target) ? view.held.includes(target) : null;
  const ing = memory.ingestions.find(i => i.seq === seq && canonicalSwallow(memory, i));
  const completion = o.ok ? 'success' : interrupted.has(o.code) ? 'interrupted' : work(receipt) > 0 ? 'failure' : 'refused';
  const output = objectId(o.materialId) && o.materialId !== target && view.objects.some(x => x.id === o.materialId);
  const effects = { unchanged: null, held: output && view.held.includes(o.materialId) ? true : held === null ? null : saved.heldBefore === false && held,
    released: receipt.request.type === 'release' ? held === null ? null : o.ok && saved.heldBefore === true && !held : false,
    output: output ? true : o.materialId === undefined ? false : null,
    exposure: ing ? true : o.ingestionId === undefined ? false : null,
    route: receipt.request.type === 'move' ? o.ok && o.code === 'ARRIVED' ? true : o.ok ? null : false : false };
  // Only public relation deltas above have denominators; unchanged is not inferred
  // from absence of a label or from a failure/result name.
  result.receiptUpdates.push({ sequence: seq, at: receipt.completedAt, features: copy(saved.features), completion,
    effects, durationSeconds: receipt.completedAt - receipt.at });
  saved.completed = true; sensor.lastReceiptSeq = seq; sensor.clockAt = view.at;
  if (ing && !sensor.exposures.some(e => e.id === ing.id)) {
    if (sensor.exposures.length >= REUSABLE_SENSOR_LIMITS.exposures) {
      const lost = sensor.exposures[0];
      if (admissible(memory, lost)) addBatch(sensor, result, lost, view.at, flushExposure(lost, view.at));
      censor(sensor, result, lost, view.at); sensor.exposures.shift();
      sensor.events = sensor.events.filter(e => e.ingestionId !== lost.id);
    }
    const object = view.objects.find(x => x.id === ing.objectId);
    const material = materialFor(sensor, object, view);
    const exposure = { id: ing.id, objectId: ing.objectId, actionId: ing.actionId, seq: ing.seq, at: ing.at,
      appearance: object ? appearance(object) : copy(saved.features.appearance), body: body(view),
      generation: material?.generation ?? null, stateProved: Boolean(material?.known && object?.observedAt === material.lastSeenAt && same(appearance(object), material.appearance)),
      admitted: 0, censored: 0, channelProof: {}, riskThroughAt: [ing.at, ing.at, ing.at] };
    sensor.exposures.push(exposure);
    addBatch(sensor, result, exposure, view.at, [], 1);
    if (!admissible(memory, exposure)) censor(sensor, result, exposure, view.at);
  }
  return result;
}
/** Snapshot immediately before the ONE existing recordTemporalFeedback call. */
export function snapshotReusableFeedback(memory, event) {
  const ingestion = memory.ingestions.find(i => i.id === event?.ingestionId && i.objectId === event?.objectId && i.actionId === event?.actionId);
  return { feedbackCursor: memory.feedbackCursor, clockAt: memory.clockAt, creditBlocked: memory.creditBlocked,
    ingestion: proofCopy(ingestion), swallowProved: Boolean(canonicalSwallow(memory, ingestion)) };
}
/** Consume a canonical proof delta; the ledger boolean is intentionally absent. */
export function recordReusableFeedback(sensor, { before, memory, event, now = memory.clockAt }) {
  const result = empty(), sequence = sourceSeq(event);
  if (sequence === null || sequence <= sensor.feedbackCursor) return result;
  sensor.feedbackCursor = sequence;
  const exposure = sensor.exposures.find(e => e.id === event?.ingestionId && e.objectId === event?.objectId && e.actionId === event?.actionId);
  const ing = exposure && matchedIngestion(memory, exposure), prior = before?.ingestion;
  const valid = finite(now) && now >= sensor.clockAt && event.at === now && event.at === memory.clockAt && event.provenance === 'sampled' &&
    before?.feedbackCursor < sequence && memory.feedbackCursor === sequence && before.creditBlocked === false && memory.creditBlocked === false &&
    integer(before.feedbackCursor) && integer(prior?.channels) && prior.channels <= 7 && before.swallowProved === true && prior?.creditBlocked === false && ing?.creditBlocked === false &&
    prior.id === ing.id && prior.seq === ing.seq && prior.at === ing.at && prior.objectId === ing.objectId && prior.actionId === ing.actionId &&
    canonicalSwallow(memory, ing) && exposure && event.at >= exposure.at;
  if (!valid) { if (exposure) censor(sensor, result, exposure, finite(now) && now >= sensor.clockAt ? now : sensor.clockAt); return result; }
  const delta = (ing.channels & ~prior.channels & eventBits(event)) & ~exposure.admitted;
  let admitted = 0;
  for (let c = 0; c < 3; c++) if (delta & (1 << c)) {
    const p = ing.channelProof[c];
    if (p?.sourceSeq === sequence && p.at === event.at && !(exposure.censored & (1 << c))) admitted |= 1 << c;
  }
  // Benign duplicate with a new source sequence has no new label. Continuous
  // channel time is still handled by the ordinary native boundary below.
  if (!admitted) { if (ing.channels & ~exposure.admitted) censor(sensor, result, exposure, now, ing.channels & ~exposure.admitted); return result; }
  if (event.at === exposure.at) {
    sensor.integrityFailure = 'zero-age-event'; censor(sensor, result, exposure, now); return result;
  }
  // Flush all independently open processes to the true emission timestamp before
  // admitting any event. F/W closure never terminates H or a competing ingestion.
  for (const other of sensor.exposures) {
    if (!admissible(memory, other)) { censor(sensor, result, other, now); continue; }
    const increments = flushExposure(other, event.at);
    if (other === exposure) for (let c = 0; c < 3; c++) if (admitted & (1 << c)) {
      increments.push({ channel: CHANNELS[c], bin: eventBin(event.at - exposure.at), riskSeconds: 0, events: 1, censored: 0 });
      exposure.admitted |= 1 << c; exposure.channelProof[c] = { sourceSeq: sequence, at: event.at }; sensor.totals[c]++;
    }
    addBatch(sensor, result, other, now, increments);
  }
  sensor.events.push({ sourceSeq: sequence, at: event.at, ingestionId: exposure.id, objectId: exposure.objectId,
    actionId: exposure.actionId, channels: admitted, rewardOwned: memory.events.some(e => e.sourceSeq === sequence && e.ingestionId === exposure.id) });
  if (sensor.events.length > REUSABLE_SENSOR_LIMITS.events) sensor.events.shift();
  sensor.lastRiskAt = now; sensor.clockAt = now; return result;
}
/** O(1) acknowledgement after native callbacks; no statistical update or tick.
 * Risk can be batched at real boundaries while save/restore retains the exact
 * continuously captured shared clock. Call only after feedback for this frame.
 */
export function noteReusableNativeClock(sensor, { at }) {
  clock(sensor, at); sensor.clockAt = at;
}
/** Native callback coverage, independently of whether vision/actor is awake.
 * Call after all biological callbacks for this timestamp, never before them.
 */
export function advanceReusableSensor(sensor, { memory, at, continuous = true }) {
  clock(sensor, at); const result = empty();
  for (const exposure of sensor.exposures) {
    const ing = admissible(memory, exposure);
    if (!continuous || !ing) { censor(sensor, result, exposure, at); continue; }
    // A proof appeared without this adapter seeing its admission callback. Do not
    // turn missed positive feedback into a fabricated negative or retrain it.
    const missed = ing.channels & ~exposure.admitted;
    if (missed) censor(sensor, result, exposure, at, missed);
    addBatch(sensor, result, exposure, at, flushExposure(exposure, at));
  }
  sensor.lastRiskAt = at; sensor.clockAt = at; return result;
}
/** Must run while canonical proof still exists and coverage is continuous. */
export function beforeReusableProofEviction(sensor, { memory, at, receiptSeqs = [], ingestionIds = [] }) {
  clock(sensor, at); const result = empty();
  for (const exposure of sensor.exposures) if (receiptSeqs.includes(exposure.seq) || ingestionIds.includes(exposure.id)) {
    if (admissible(memory, exposure)) addBatch(sensor, result, exposure, at, flushExposure(exposure, at));
    censor(sensor, result, exposure, at);
  }
  sensor.clockAt = at; return result;
}
/** Pure support projection. Identity is evidence only, never a numerical key. */
export function reusableMaterialSupport(sensor, { memory, view, objectId: id }) {
  const material = sensor.materials.find(m => m.objectId === id), object = view.objects.find(o => o.id === id);
  const applicable = Boolean(material?.known && object && object.observedAt === material.lastSeenAt &&
    same(appearance(object), material.appearance));
  const supported = [false, false, false], counts = [0, 0, 0];
  for (const exposure of sensor.exposures) if (exposure.objectId === id && exposure.stateProved &&
    exposure.generation === material?.generation && same(exposure.appearance, material?.appearance)) {
    const ing = admissible(memory, exposure); if (!ing) continue;
    for (let c = 0; c < 3; c++) if (exposure.admitted & (1 << c) && same(exposure.channelProof[c], ing.channelProof[c])) { counts[c]++; supported[c] ||= applicable; }
  }
  return { F: supported[0], W: supported[1], H: supported[2], applicable, unknown: !applicable,
    firsthand: { F: counts[0], W: counts[1], H: counts[2] }, generation: material?.generation ?? null };
}

// Strict additive restore: unknown fields are rejected, not silently copied.
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const denseArray = x => Array.isArray(x) && Object.keys(x).length === x.length && Array.from({ length: x.length }, (_, i) => Object.hasOwn(x, i)).every(Boolean);
function keys(raw, expected, name) { if (!record(raw) || Object.keys(raw).some(k => !expected.includes(k)) || expected.some(k => !Object.hasOwn(raw, k))) fail(`invalid ${name} fields`); }
function validAppearance(a) { return record(a) && Object.keys(a).length === 6 && FIELDS.every(k => typeof a[k] === 'string' && a[k].length <= 100 && !/[\u0000-\u001f]/.test(a[k])); }
function validBody(b) { return record(b) && same(b, temporalContext({ body: b }).body); }
function validFeatures(f) {
  if (!record(f)) return false;
  const expected = ['operation', 'appearance', 'relation', 'workBand', 'freeSlotBand', 'countBand'];
  if (Object.keys(f).length !== expected.length || expected.some(k => !Object.hasOwn(f, k)) || !validAppearance(f.appearance)) return false;
  try { const c = temporalContext({ relation: f.relation, workBand: f.workBand }); return ['held', 'reach', 'route', 'unknown'].includes(f.relation) && c.workBand === f.workBand &&
    ['0', '1', '2+', 'unknown'].includes(f.freeSlotBand) && ['0', '1', '2+', 'unknown'].includes(f.countBand) &&
    TEMPORAL_OPERATIONS.includes(f.operation); } catch { return false; }
}
/** Reject accessors/proxies before reading a single payload property. Saves are
 * JSON data, not objects whose inspection is allowed to execute caller code. */
function assertDataGraph(raw) {
  const pending = [raw], seen = new Set(); let visited = 0;
  while (pending.length) {
    const value = pending.pop(); if (++visited > 100000) fail('oversized data graph');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('nonfinite data'); continue; }
    if (typeof value !== 'object' || nodeTypes.isProxy(value)) fail('nondata input');
    if (seen.has(value)) fail('cyclic or aliased input'); seen.add(value);
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('nondata prototype');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') fail('symbol data field');
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value')) fail('accessor input');
      if (array && key === 'length') { if (!integer(descriptor.value) || descriptor.value > 1024) fail('oversized array'); continue; }
      if (!descriptor.enumerable) fail('nonenumerable data field');
      pending.push(descriptor.value);
    }
  }
}
export function validateReusableOutcomeSensor(raw, { memory, view, at = view?.at, continuous = false } = {}) {
  assertDataGraph(raw);
  keys(raw, ['version', 'clockAt', 'lastRiskAt', 'observationAt', 'lastSubmissionSeq', 'lastReceiptSeq', 'lastIntervalSeq', 'feedbackCursor', 'updateSequence',
    'receipts', 'exposures', 'materials', 'events', 'totals', 'censoredChannels', 'integrityFailure'], 'state');
  if (raw.version !== 1 || !finite(at) || !finite(raw.clockAt) || raw.clockAt > at || !finite(raw.lastRiskAt) || raw.lastRiskAt > raw.clockAt ||
      raw.observationAt !== null && (!finite(raw.observationAt) || raw.observationAt > raw.clockAt) ||
      ['lastSubmissionSeq', 'lastReceiptSeq', 'lastIntervalSeq', 'feedbackCursor', 'updateSequence', 'censoredChannels'].some(k => !integer(raw[k])) ||
      raw.lastReceiptSeq > raw.lastSubmissionSeq || raw.lastIntervalSeq > raw.lastSubmissionSeq || raw.lastSubmissionSeq >= memory.nextSeq ||
      raw.feedbackCursor > memory.feedbackCursor || !denseArray(raw.totals) || raw.totals.length !== 3 || raw.totals.some(v => !integer(v)) ||
      ![null, 'zero-age-event'].includes(raw.integrityFailure)) fail('invalid state counters');
  for (const [field, limit] of [['receipts', 384], ['exposures', 64], ['materials', 64], ['events', 128]]) {
    if (!denseArray(raw[field]) || raw[field].length > limit) fail(`oversized ${field}`);
  }
  const sensor = createReusableOutcomeSensor({ at });
  Object.assign(sensor, copy(raw));
  const ids = new Set(), seqs = new Set(); let previousReceiptSeq = 0, previousReceiptAt = 0;
  for (const r of sensor.receipts) {
    keys(r, ['seq', 'at', 'features', 'heldBefore', 'completed', 'interval'], 'receipt');
    if (!positive(r.seq) || r.seq <= previousReceiptSeq || r.seq > raw.lastSubmissionSeq || seqs.has(r.seq) || !finite(r.at) || r.at < previousReceiptAt || r.at > raw.clockAt || !validFeatures(r.features) ||
      ![true, false, null].includes(r.heldBefore) || typeof r.completed !== 'boolean' || typeof r.interval !== 'boolean') fail('invalid receipt');
    if (r.completed && r.seq > raw.lastReceiptSeq || r.interval && r.seq > raw.lastIntervalSeq) fail('receipt exceeds admission cursor');
    seqs.add(r.seq); previousReceiptSeq = r.seq; previousReceiptAt = r.at;
    const canonical = memory.receipts.find(p => p.seq === r.seq);
    if (canonical && (canonical.at !== r.at || canonical.request.type !== r.features.operation || r.completed && !canonical.outcome)) fail('receipt no longer matches');
  }
  for (const m of sensor.materials) {
    keys(m, ['objectId', 'appearance', 'generation', 'lastSeenAt', 'known'], 'material');
    if (!objectId(m.objectId) || ids.has(m.objectId) || !validAppearance(m.appearance) || !integer(m.generation) || !finite(m.lastSeenAt) || m.lastSeenAt > raw.clockAt || typeof m.known !== 'boolean') fail('invalid material');
    ids.add(m.objectId);
    if (!continuous || at !== raw.clockAt || !view?.objects?.some(o => o.id === m.objectId && o.observedAt === m.lastSeenAt && same(appearance(o), m.appearance))) m.known = false;
  }
  ids.clear();
  for (const e of sensor.exposures) {
    keys(e, ['id', 'objectId', 'actionId', 'seq', 'at', 'appearance', 'body', 'generation', 'stateProved', 'admitted', 'censored', 'channelProof', 'riskThroughAt'], 'exposure');
    if (!ingestionId(e.id) || ids.has(e.id) || !objectId(e.objectId) || !positive(e.actionId) || !positive(e.seq) || e.seq > raw.lastReceiptSeq ||
      !finite(e.at) || e.at > raw.clockAt || !validAppearance(e.appearance) || !validBody(e.body) ||
      e.generation !== null && !integer(e.generation) || typeof e.stateProved !== 'boolean' ||
      !integer(e.admitted) || e.admitted > 7 || !integer(e.censored) || e.censored > 7 || (e.admitted & e.censored) || !record(e.channelProof) ||
      Object.keys(e.channelProof).some(c => !['0', '1', '2'].includes(c)) || !denseArray(e.riskThroughAt) || e.riskThroughAt.length !== 3 ||
      e.riskThroughAt.some(t => !finite(t) || t < e.at || t > raw.clockAt)) fail('invalid exposure');
    ids.add(e.id);
    let mask = 0;
    for (let c = 0; c < 3; c++) if (e.channelProof[c]) {
      const p = e.channelProof[c]; keys(p, ['sourceSeq', 'at'], 'channel proof');
      if (!positive(p.sourceSeq) || p.sourceSeq > raw.feedbackCursor || !finite(p.at) || p.at <= e.at || p.at !== e.riskThroughAt[c]) fail('invalid channel proof');
      mask |= 1 << c;
    }
    if (mask !== e.admitted) fail('inconsistent admitted channels');
    for (let c = 0; c < 3; c++) {
      if (!(e.admitted & (1 << c)) && !(e.censored & (1 << c)) && e.riskThroughAt[c] !== Math.max(e.at, raw.lastRiskAt)) fail('rewound or inconsistent open risk watermark');
      if (e.channelProof[c] && e.channelProof[c].at > raw.lastRiskAt) fail('risk batch predates admitted report');
    }
    const ing = admissible(memory, e);
    if (ing && [0, 1, 2].some(c => e.admitted & (1 << c) && !same(e.channelProof[c], ing.channelProof[c]))) fail('unproved restored admission');
    if (!ing || !continuous || at !== raw.clockAt) e.censored |= 7 & ~e.admitted;
    else e.censored |= ing.channels & ~e.admitted;
  }
  let previousSource = 0, previousEventAt = 0;
  for (const e of sensor.events) {
    keys(e, ['sourceSeq', 'at', 'ingestionId', 'objectId', 'actionId', 'channels', 'rewardOwned'], 'event');
    if (!positive(e.sourceSeq) || e.sourceSeq <= previousSource || e.sourceSeq > raw.feedbackCursor || !finite(e.at) || e.at < previousEventAt || e.at > raw.clockAt ||
      !ingestionId(e.ingestionId) || !objectId(e.objectId) || !positive(e.actionId) || !positive(e.channels) || e.channels > 7 || typeof e.rewardOwned !== 'boolean') fail('invalid event');
    const exposure = sensor.exposures.find(x => x.id === e.ingestionId && x.objectId === e.objectId && x.actionId === e.actionId);
    if (!exposure || e.at <= exposure.at || (exposure.admitted & e.channels) !== e.channels || [0, 1, 2].some(c => e.channels & (1 << c) &&
      (exposure.channelProof[c]?.sourceSeq !== e.sourceSeq || exposure.channelProof[c]?.at !== e.at))) fail('event lacks its retained channel proof');
    previousSource = e.sourceSeq; previousEventAt = e.at;
  }
  for (let c = 0; c < 3; c++) {
    const retained = sensor.exposures.filter(e => e.admitted & (1 << c)).length;
    if (raw.totals[c] < retained || raw.totals[c] > raw.feedbackCursor) fail('totals contradict retained supervision');
  }
  sensor.clockAt = at;
  // Restore never emits a model update, consumes another observation, or rebuilds
  // an evicted proof. Durable cursors continue to reject old callback deliveries.
  return sensor;
}
