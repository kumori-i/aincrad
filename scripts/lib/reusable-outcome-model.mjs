/** Increment-A research-only physical/exposure predictor. No world, actor, reward,
 * identity ledger, physiology, action execution, or autonomous policy imports.
 * A sensor admits factual labels; this module stores only public sufficient statistics.
 */
import { types as nodeTypes } from 'node:util';
import { TEMPORAL_OPERATIONS } from '../../src/temporal-returns.js';

export const REUSABLE_MODEL = Object.freeze({ version: 1, rows: 256, physicalRows: 192,
  exposureRows: 64, dictionaryEntries: 512, dictionaryBytes: 256 * 1024,
  physicalPooling: 4, exposurePoolingSeconds: 30, horizonSeconds: 600,
  halfLifeSeconds: 300, epsilon: .2 });
export const EXPOSURE_CHANNELS = Object.freeze(['F', 'W', 'H']);
export const PHYSICAL_EFFECTS = Object.freeze(['unchanged', 'held', 'released', 'output', 'exposure', 'route']);
export const PHYSICAL_COMPLETIONS = Object.freeze(['success', 'failure', 'refused', 'interrupted', 'unknown']);
const APPEARANCE = ['shape', 'color', 'texture', 'motion', 'size', 'smell'];
const RELATIONS = ['held', 'reach', 'route', 'unknown'];
const BANDS = ['0', '1', '2+', 'unknown'];
const WORK = ['0', '1', '2..3', '4..7', '8..15', '16+', 'unknown'];
const DIGESTION = ['unknown', 'empty', 'settled', 'full', 'overfull'];
const EDGES = [0, 45, 180, 600, Infinity];
const BETA = Math.log(2) / REUSABLE_MODEL.halfLifeSeconds;
const MAX = Number.MAX_SAFE_INTEGER;
const encoder = new TextEncoder();
// Only deeply immutable, validated snapshots enter this private cache. Mutable
// caller models are never trusted by identity. Transactions are private objects.
const snapshotMetadata = new WeakMap(), trustedTransactions = new WeakMap();
const own = (o, k) => Object.hasOwn(o, k);
const record = x => !nodeTypes.isProxy(x) && x !== null && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const number = x => Number.isFinite(x) && x >= 0 && x <= MAX;
const integer = x => Number.isSafeInteger(x) && x >= 0;
const copy = x => structuredClone(x);
const freeze = x => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
function fail(message, code = 'REUSABLE_INTEGRITY') { const e = new Error(message); e.code = code; throw e; }
function keysOnly(o, keys, label) {
  if (!record(o) || Object.keys(o).length !== keys.length || keys.some(k => !own(o, k)) ||
      Reflect.ownKeys(o).some(k => typeof k !== 'string' || !keys.includes(k)) ||
      Object.values(Object.getOwnPropertyDescriptors(o)).some(d => !own(d, 'value'))) fail(`Invalid ${label} fields`);
}
function optionalKeys(o, keys, label) {
  if (!record(o) || Reflect.ownKeys(o).some(k => typeof k !== 'string' || !keys.includes(k)) ||
      Object.values(Object.getOwnPropertyDescriptors(o)).some(d => !own(d, 'value'))) fail(`Invalid ${label} fields`);
}
function checkedArray(value, label) {
  if (nodeTypes.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1 ||
      Reflect.ownKeys(value).some(k => k !== 'length' && (typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= value.length)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !own(d, 'value'))) fail(`Invalid ${label} array`);
  return value;
}
function finite(value, label) { if (!number(value)) fail(`Invalid ${label}`); return value; }
function count(value, label) { if (!integer(value)) fail(`Invalid ${label}`); return value; }
function member(value, values, label) { if (!values.includes(value)) fail(`Invalid ${label}`); return value; }
function dataRecord(value, label) {
  if (!record(value) || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !own(d, 'value'))) fail(`Invalid ${label} data record`);
}
function publicText(value) {
  if (typeof value !== 'string') return 'unknown';
  if (typeof value !== 'string' || !value.length || value.length > 100 || /[\u0000-\u001f]/.test(value)) fail('Invalid public appearance');
  return value;
}
/** Only these six observed fields define appearance. Count depletion is not transformation. */
export function reusableAppearance(raw = {}) {
  dataRecord(raw, 'appearance');
  return Object.fromEntries(APPEARANCE.map(k => [k, publicText(raw[k])]));
}
export function reusablePhysicalFeatures(raw) {
  dataRecord(raw, 'physical features');
  return { operation: member(raw.operation, TEMPORAL_OPERATIONS, 'operation'), appearance: reusableAppearance(raw.appearance),
    relation: member(raw.relation ?? 'unknown', RELATIONS, 'relation'),
    workBand: member(raw.workBand ?? 'unknown', WORK, 'work band'),
    freeSlotBand: member(raw.freeSlotBand ?? 'unknown', BANDS, 'free-slot band'),
    countBand: member(raw.countBand ?? 'unknown', BANDS, 'count band') };
}
const appearanceTuple = a => APPEARANCE.map(k => a[k]);
const key = parts => JSON.stringify(parts);
function physicalKeys(raw) {
  const f = reusablePhysicalFeatures(raw), a = appearanceTuple(f.appearance);
  return { features: f, hierarchy: [key(['p', f.operation, f.relation]), key(['m', f.operation, f.relation, a]), key(['w', f.operation, f.relation, a, f.workBand])],
    conditional: [key(['capacity', f.operation, f.relation, f.freeSlotBand]), key(['count', f.operation, f.countBand])] };
}
function exposureKeys(appearance, digestion) {
  const a = appearanceTuple(reusableAppearance(appearance));
  member(digestion, DIGESTION, 'digestion');
  return [key(['e']), key(['em', a]), key(['ed', a, digestion])];
}
function validateKey(k) {
  if (typeof k !== 'string' || k.length > 2048) fail('Invalid dictionary key');
  let t; try { t = JSON.parse(k); } catch { fail('Invalid dictionary key'); }
  if (!Array.isArray(t)) fail('Invalid dictionary tuple');
  const appearance = a => { if (!Array.isArray(a) || a.length !== 6) fail('Invalid appearance tuple'); a.forEach(v => { if (typeof v !== 'string' || publicText(v) !== v) fail('Invalid encoded appearance'); }); };
  switch (t[0]) {
    case 'p': if (t.length !== 3) fail('Invalid parent key'); member(t[1], TEMPORAL_OPERATIONS, 'operation'); member(t[2], RELATIONS, 'relation'); break;
    case 'm': case 'w': if (t.length !== (t[0] === 'm' ? 4 : 5)) fail('Invalid physical child key'); member(t[1], TEMPORAL_OPERATIONS, 'operation'); member(t[2], RELATIONS, 'relation'); appearance(t[3]); if (t[0] === 'w') member(t[4], WORK, 'work band'); break;
    case 'capacity': if (t.length !== 4) fail('Invalid capacity key'); member(t[1], TEMPORAL_OPERATIONS, 'operation'); member(t[2], RELATIONS, 'relation'); member(t[3], BANDS, 'free-slot band'); break;
    case 'count': if (t.length !== 3) fail('Invalid count key'); member(t[1], TEMPORAL_OPERATIONS, 'operation'); member(t[2], BANDS, 'count band'); break;
    case 'e': if (t.length !== 1) fail('Invalid exposure parent'); break;
    case 'em': case 'ed': if (t.length !== (t[0] === 'em' ? 2 : 3)) fail('Invalid exposure child'); appearance(t[1]); if (t[0] === 'ed') member(t[2], DIGESTION, 'digestion'); break;
    default: fail('Unknown dictionary type');
  }
  if (key(t) !== k) fail('Noncanonical dictionary key');
  return t;
}
const moment = () => ({ n: 0, sum: 0, sumSq: 0 });
function physicalRow(index) { return { key: index, type: 'physical', receipts: 0, intervals: 0,
  completion: Object.fromEntries(PHYSICAL_COMPLETIONS.map(c => [c, 0])),
  effects: Object.fromEntries(PHYSICAL_EFFECTS.map(e => [e, { n: 0, yes: 0 }])),
  duration: moment(), T: moment(), E: moment(), lastReceiptSeq: 0, lastIntervalSeq: 0 }; }
function exposureRow(index) { return { key: index, type: 'exposure', ingestions: 0,
  cells: EXPOSURE_CHANNELS.map(() => Array.from({ length: 4 }, () => ({ events: 0, riskSeconds: 0 }))), censored: [0, 0, 0], lastSequence: 0 }; }
export function createReusableOutcomeModel() {
  return { version: 1, keys: [], rows: [], cursors: { receipt: { sequence: 0, at: 0 }, interval: { sequence: 0, at: 0 }, exposure: { sequence: 0, at: 0 } } };
}
function checkMoment(m, label) {
  keysOnly(m, ['n', 'sum', 'sumSq'], label); count(m.n, label); finite(m.sum, label); finite(m.sumSq, label);
  if (!m.n && (m.sum || m.sumSq) || m.n && m.sumSq + 1e-10 * Math.max(1, m.sumSq) < m.sum * (m.sum / m.n)) fail(`Inconsistent ${label} moments`);
}
function shape(model) {
  if (snapshotMetadata.has(model) || trustedTransactions.has(model)) return;
  keysOnly(model, ['version', 'keys', 'rows', 'cursors'], 'model');
  if (model.version !== 1 || nodeTypes.isProxy(model.keys) || nodeTypes.isProxy(model.rows) || !Array.isArray(model.keys) || !Array.isArray(model.rows)) fail('Invalid model version or arrays');
  if (model.keys.length > REUSABLE_MODEL.dictionaryEntries || model.rows.length > REUSABLE_MODEL.rows) fail('Model row/dictionary capacity exceeded', 'REUSABLE_CAPACITY');
  checkedArray(model.keys, 'dictionary'); checkedArray(model.rows, 'rows');
  if (model.keys.some(k => typeof k !== 'string' || k.length > 2048)) fail('Invalid primitive dictionary key');
  if (encoder.encode(JSON.stringify(model.keys)).byteLength > REUSABLE_MODEL.dictionaryBytes) fail('Model dictionary byte capacity exceeded', 'REUSABLE_CAPACITY');
}
function validateModelRow(r, t, cursors) {
  if (r.type === 'physical') {
    if (!['p', 'm', 'w', 'capacity', 'count'].includes(t[0])) fail('Contradictory physical row type');
    keysOnly(r, ['key', 'type', 'receipts', 'intervals', 'completion', 'effects', 'duration', 'T', 'E', 'lastReceiptSeq', 'lastIntervalSeq'], 'physical row');
    count(r.receipts, 'receipt count'); count(r.intervals, 'interval count'); count(r.lastReceiptSeq, 'receipt sequence'); count(r.lastIntervalSeq, 'interval sequence');
    if (r.receipts > r.lastReceiptSeq || r.intervals > r.lastIntervalSeq || r.lastReceiptSeq > cursors.receipt.sequence || r.lastIntervalSeq > cursors.interval.sequence || Boolean(r.receipts) !== Boolean(r.lastReceiptSeq) || Boolean(r.intervals) !== Boolean(r.lastIntervalSeq)) fail('Inconsistent physical admission cursor');
    keysOnly(r.completion, PHYSICAL_COMPLETIONS, 'completion counts');
    if (Object.values(r.completion).reduce((sum, n) => sum + count(n, 'completion count'), 0) !== r.receipts) fail('Inconsistent completion denominator');
    keysOnly(r.effects, PHYSICAL_EFFECTS, 'effect labels');
    for (const s of Object.values(r.effects)) { keysOnly(s, ['n', 'yes'], 'effect statistic'); count(s.n, 'effect denominator'); count(s.yes, 'effect count'); if (s.yes > s.n || s.n > r.receipts) fail('Inconsistent effect denominator'); }
    for (const name of ['duration', 'T', 'E']) checkMoment(r[name], name);
    if (r.duration.n > r.receipts || r.T.n !== r.intervals || r.E.n !== r.intervals || r.E.sum > r.T.sum + 1e-9 || r.E.sumSq > r.T.sumSq + 1e-9) fail('Inconsistent physical cost/duration count');
    if (['capacity', 'count'].includes(t[0]) && (r.duration.n || r.intervals)) fail('Conditional diagnostic row contains primary costs');
  } else if (r.type === 'exposure') {
    if (!['e', 'em', 'ed'].includes(t[0])) fail('Contradictory exposure row type');
    keysOnly(r, ['key', 'type', 'ingestions', 'cells', 'censored', 'lastSequence'], 'exposure row');
    count(r.ingestions, 'ingestion count'); count(r.lastSequence, 'exposure sequence');
    checkedArray(r.cells, 'channel cells'); checkedArray(r.censored, 'censored channels');
    if (!r.ingestions || r.ingestions > r.lastSequence || !r.lastSequence || r.lastSequence > cursors.exposure.sequence || r.cells.length !== 3 || r.censored.length !== 3) fail('Invalid exposure row');
    for (let c = 0; c < 3; c++) {
      checkedArray(r.cells[c], 'age cells');
      if (!Array.isArray(r.cells[c]) || r.cells[c].length !== 4) fail('Invalid exposure cells');
      let events = 0; count(r.censored[c], 'censored count');
      for (const cell of r.cells[c]) { keysOnly(cell, ['events', 'riskSeconds'], 'rate cell'); count(cell.events, 'event count'); finite(cell.riskSeconds, 'risk seconds'); if (cell.events && cell.riskSeconds <= 0) fail('Positive event count without positive risk'); if (cell.events && !Number.isFinite(cell.events / cell.riskSeconds)) fail('Nonfinite empirical rate'); events += cell.events; }
      if (events + r.censored[c] > r.ingestions) fail('Channel has more terminal observations than independent ingestions');
    }
  } else fail('Unknown model row type');
}
function validateChildContainment(r, p) {
    if (r.type === 'physical') {
      if (r.receipts > p.receipts || r.intervals > p.intervals || r.lastReceiptSeq > p.lastReceiptSeq || r.lastIntervalSeq > p.lastIntervalSeq) fail('Child exceeds parent experience');
      for (const c of PHYSICAL_COMPLETIONS) if (r.completion[c] > p.completion[c]) fail('Child exceeds parent completion support');
      for (const name of ['duration', 'T', 'E']) if (r[name].n > p[name].n || r[name].sum > p[name].sum + 1e-9 || r[name].sumSq > p[name].sumSq + 1e-9) fail('Child exceeds parent cost/duration support');
      for (const e of PHYSICAL_EFFECTS) if (r.effects[e].n > p.effects[e].n || r.effects[e].yes > p.effects[e].yes) fail('Child exceeds parent effect support');
    } else {
      if (r.ingestions > p.ingestions || r.lastSequence > p.lastSequence || r.censored.some((n, c) => n > p.censored[c])) fail('Child exceeds parent ingestions');
      for (let c = 0; c < 3; c++) for (let b = 0; b < 4; b++) if (r.cells[c][b].events > p.cells[c][b].events || r.cells[c][b].riskSeconds > p.cells[c][b].riskSeconds + 1e-9) fail('Child exceeds parent exposure support');
    }
}
/** Strict, lossless validation. Corrupt/oversized state is rejected, never normalized or trimmed. */
export function validateReusableOutcomeModel(raw, elapsed = Infinity) {
  shape(raw); if (!(elapsed === Infinity || number(elapsed))) fail('Invalid restore clock');
  checkedArray(raw.keys, 'dictionary'); checkedArray(raw.rows, 'rows');
  const tuples = raw.keys.map(validateKey), seen = new Set(), index = new Map();
  if (new Set(raw.keys).size !== raw.keys.length) fail('Duplicate model dictionary key');
  keysOnly(raw.cursors, ['receipt', 'interval', 'exposure'], 'cursors');
  for (const c of Object.values(raw.cursors)) { keysOnly(c, ['sequence', 'at'], 'cursor'); count(c.sequence, 'sequence'); finite(c.at, 'cursor time'); if (c.at > elapsed || !c.sequence && c.at) fail('Invalid cursor clock'); }
  let physical = 0, exposure = 0;
  for (const r of raw.rows) {
    dataRecord(r, 'model row');
    if (!record(r) || !integer(r.key) || r.key >= raw.keys.length || seen.has(r.key)) fail('Invalid or duplicate row reference');
    seen.add(r.key); index.set(raw.keys[r.key], r); const t = tuples[r.key];
    validateModelRow(r, t, raw.cursors);
    if (r.type === 'physical') physical++; else exposure++;
  }
  if (physical > REUSABLE_MODEL.physicalRows || exposure > REUSABLE_MODEL.exposureRows) fail('Typed model row capacity exceeded', 'REUSABLE_CAPACITY');
  if (seen.size !== raw.keys.length) fail('Unreferenced model dictionary key');
  const children = new Map();
  // All child statistics have a retained parent. Parent support contains the child;
  // it must not be presented as another independent batch of experience.
  for (const r of raw.rows) {
    const t = tuples[r.key]; let parentKey;
    if (t[0] === 'm') parentKey = key(['p', t[1], t[2]]);
    if (t[0] === 'w') parentKey = key(['m', t[1], t[2], t[3]]);
    if (t[0] === 'em') parentKey = key(['e']);
    if (t[0] === 'ed') parentKey = key(['em', t[1]]);
    if (parentKey) {
      if (!children.has(parentKey)) children.set(parentKey, []);
      children.get(parentKey).push(r);
      const p = index.get(parentKey); if (!p || p.type !== r.type) fail('Missing hierarchy parent');
      validateChildContainment(r, p);
    }
  }
  // Updates touch every hierarchy level and there is no row eviction. Exact
  // integer conservation therefore detects missing/duplicated history without
  // inventing labels or applying floating-point repair to sufficient statistics.
  for (const r of raw.rows) {
    const type = tuples[r.key][0]; if (!['p', 'm', 'e', 'em'].includes(type)) continue;
    const descendants = children.get(raw.keys[r.key]) ?? [];
    const conserved = (value, select, label) => {
      if (descendants.reduce((sum, child) => sum + select(child), 0) !== value) fail(`Nonconserved hierarchy ${label}`);
    };
    if (r.type === 'physical') {
      conserved(r.receipts, child => child.receipts, 'receipts');
      conserved(r.intervals, child => child.intervals, 'intervals');
      for (const c of PHYSICAL_COMPLETIONS) conserved(r.completion[c], child => child.completion[c], 'completion counts');
      for (const name of ['duration', 'T', 'E']) conserved(r[name].n, child => child[name].n, 'moment counts');
      for (const effect of PHYSICAL_EFFECTS) for (const field of ['n', 'yes']) conserved(r.effects[effect][field], child => child.effects[effect][field], 'effect counts');
    } else {
      conserved(r.ingestions, child => child.ingestions, 'ingestions');
      for (let c = 0; c < 3; c++) {
        conserved(r.censored[c], child => child.censored[c], 'censor counts');
        for (let b = 0; b < 4; b++) conserved(r.cells[c][b].events, child => child.cells[c][b].events, 'event counts');
      }
    }
  }
  return copy(raw);
}
export function encodeReusableOutcomeModel(model) { return validateReusableOutcomeModel(model); }
export function restoreReusableOutcomeModel(raw, elapsed = Infinity) { return validateReusableOutcomeModel(raw, elapsed); }
export function reusableModelDiagnostics(model) {
  if (!snapshotMetadata.has(model)) model = validateReusableOutcomeModel(model);
  shape(model); return { rows: model.rows.length, physicalRows: model.rows.filter(r => r.type === 'physical').length,
    exposureRows: model.rows.filter(r => r.type === 'exposure').length, dictionaryEntries: model.keys.length,
    dictionaryBytes: encoder.encode(JSON.stringify(model.keys)).byteLength, encodedBytes: encoder.encode(JSON.stringify(model)).byteLength };
}
function admission(model, raw, stream) {
  if (!trustedTransactions.has(model)) validateReusableOutcomeModel(model);
  shape(model); count(raw.sequence, 'admission sequence'); finite(raw.at, 'admission time');
  if (!raw.sequence || raw.now !== undefined && (!number(raw.now) || raw.at > raw.now)) fail('Invalid admission clock');
  const cursor = model.cursors[stream];
  if (raw.sequence <= cursor.sequence) return false;
  if (raw.at < cursor.at) fail('Admission clock reversed');
  return true;
}
function draftRows(model, requested, type) {
  const trusted = trustedTransactions.get(model);
  const draft = { ...model, keys: [...model.keys], rows: [...model.rows], cursors: copy(model.cursors) };
  const indices = trusted ? new Map(trusted.keyIndices) : new Map(model.keys.map((k, i) => [k, i]));
  const rowIndices = trusted ? new Map(trusted.rowIndices) : new Map(model.rows.map((r, i) => [r.key, i]));
  let dictionaryBytes = trusted?.dictionaryBytes ?? encoder.encode(JSON.stringify(model.keys)).byteLength;
  let physicalRows = trusted?.physicalRows ?? model.rows.filter(r => r.type === 'physical').length;
  let exposureRows = trusted?.exposureRows ?? model.rows.filter(r => r.type === 'exposure').length;
  const rows = requested.map(k => {
    let ki = indices.get(k), ri;
    if (ki === undefined) {
      ki = draft.keys.length; dictionaryBytes += encoder.encode(JSON.stringify(k)).byteLength + (ki ? 1 : 0);
      draft.keys.push(k); indices.set(k, ki); ri = draft.rows.length; rowIndices.set(ki, ri);
      draft.rows.push(type === 'physical' ? physicalRow(ki) : exposureRow(ki));
      if (type === 'physical') physicalRows++; else exposureRows++;
    } else {
      ri = rowIndices.get(ki); if (ri === undefined || draft.rows[ri].type !== type) fail('Invalid existing row');
      draft.rows[ri] = copy(draft.rows[ri]);
    }
    return draft.rows[ri];
  });
  if (draft.rows.length > REUSABLE_MODEL.rows || physicalRows > REUSABLE_MODEL.physicalRows || exposureRows > REUSABLE_MODEL.exposureRows || draft.keys.length > REUSABLE_MODEL.dictionaryEntries || dictionaryBytes > REUSABLE_MODEL.dictionaryBytes) fail('No model capacity for complete atomic update', 'REUSABLE_CAPACITY');
  if (trusted) {
    const index = new Map(trusted.index); requested.forEach((k, i) => index.set(k, rows[i]));
    trustedTransactions.set(draft, { keyIndices: indices, rowIndices, index, dictionaryBytes, physicalRows, exposureRows, touched: rows });
  }
  return { draft, rows };
}
function addMoment(s, value) { s.n++; s.sum += value; s.sumSq += value * value; }
function commit(model, draft, raw, stream) {
  draft.cursors[stream] = { sequence: raw.sequence, at: raw.at };
  const trusted = trustedTransactions.get(draft);
  if (trusted) {
    for (const row of trusted.touched) {
      const t = JSON.parse(draft.keys[row.key]); validateModelRow(row, t, draft.cursors);
      const parentKey = t[0] === 'm' ? key(['p', t[1], t[2]]) : t[0] === 'w' ? key(['m', t[1], t[2], t[3]]) : t[0] === 'em' ? key(['e']) : t[0] === 'ed' ? key(['em', t[1]]) : null;
      if (parentKey) {
        const parent = trusted.index.get(parentKey); if (!parent || parent.type !== row.type) fail('Missing hierarchy parent');
        validateChildContainment(row, parent);
      }
    }
    // The same admitted delta is applied to all three hierarchy levels above.
    // Starting from a validated immutable snapshot, integer conservation and
    // parent containment are preserved algebraically; no rows are removed.
    trustedTransactions.set(model, { ...trusted, touched: undefined });
  } else validateReusableOutcomeModel(draft);
  Object.assign(model, draft); return { admitted: true };
}
/** Receipts update labels/duration once. They never contain biological rewards or T/E. */
export function updatePhysicalReceipt(model, raw) {
  optionalKeys(raw, ['sequence', 'at', 'now', 'features', 'completion', 'effects', 'durationSeconds'], 'receipt update');
  if (!admission(model, raw, 'receipt')) return { admitted: false, reason: 'duplicate-or-old' };
  const { hierarchy, conditional } = physicalKeys(raw.features);
  member(raw.completion, PHYSICAL_COMPLETIONS, 'completion'); optionalKeys(raw.effects, PHYSICAL_EFFECTS, 'effect observations');
  for (const v of Object.values(raw.effects)) if (v !== null && typeof v !== 'boolean') fail('Effect label must be observed Boolean or null');
  if (raw.durationSeconds !== null) finite(raw.durationSeconds, 'completion duration');
  const { draft, rows } = draftRows(model, [...hierarchy, ...conditional], 'physical');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; r.receipts++; r.completion[raw.completion]++; r.lastReceiptSeq = raw.sequence;
    const allowed = i < 3 ? PHYSICAL_EFFECTS : i === 3 ? ['held', 'released', 'output', 'exposure'] : ['unchanged', 'output', 'exposure'];
    for (const name of allowed) if (typeof raw.effects[name] === 'boolean') { r.effects[name].n++; r.effects[name].yes += Number(raw.effects[name]); }
    if (i < 3 && raw.durationSeconds !== null) addMoment(r.duration, raw.durationSeconds);
  }
  return commit(model, draft, raw, 'receipt');
}
/** Costs are the ledger's closed discounted per-minute integrals, with no bootstrap. */
export function updatePhysicalInterval(model, raw) {
  optionalKeys(raw, ['sequence', 'at', 'now', 'features', 'T', 'E'], 'interval update');
  if (!admission(model, raw, 'interval')) return { admitted: false, reason: 'duplicate-or-old' };
  finite(raw.T, 'closed T'); finite(raw.E, 'closed E');
  if (raw.E > raw.T + 1e-10 || raw.T > 1 / (60 * BETA) + 1e-10) fail('Costs are not discounted ordinal per-minute integrals');
  const { draft, rows } = draftRows(model, physicalKeys(raw.features).hierarchy, 'physical');
  for (const r of rows) { r.intervals++; r.lastIntervalSeq = raw.sequence; addMoment(r.T, raw.T); addMoment(r.E, raw.E); }
  return commit(model, draft, raw, 'interval');
}
/** A channel event exactly on an edge belongs to the interval ENDING there. */
export function exposureAgeBin(ageSeconds) {
  finite(ageSeconds, 'exposure event age'); if (ageSeconds === 0) fail('Zero-age feedback is unsupported', 'REUSABLE_UNSUPPORTED');
  return ageSeconds <= 45 ? 0 : ageSeconds <= 180 ? 1 : ageSeconds <= 600 ? 2 : 3;
}
export function splitExposureRisk(ageFrom, ageTo) {
  finite(ageFrom, 'risk start'); finite(ageTo, 'risk end'); if (ageTo < ageFrom) fail('Risk time reversed');
  return EDGES.slice(0, 4).map((edge, bin) => ({ bin, riskSeconds: Math.max(0, Math.min(ageTo, EDGES[bin + 1]) - Math.max(ageFrom, edge)) })).filter(x => x.riskSeconds > 0);
}
/** Atomic risk/event/ingestion batch. Exact IDs, channel proof bits and continuous-
 * monitoring watermarks belong to the sensor, not these shareable parameters. */
export function updateExposure(model, raw) {
  optionalKeys(raw, ['sequence', 'at', 'now', 'appearance', 'digestion', 'ingestions', 'increments'], 'exposure update');
  if (!admission(model, raw, 'exposure')) return { admitted: false, reason: 'duplicate-or-old' };
  checkedArray(raw.increments, 'exposure increments');
  if (![0, 1].includes(raw.ingestions) || raw.increments.length > 12) fail('Invalid exposure batch');
  const cells = new Set();
  for (const inc of raw.increments) {
    keysOnly(inc, ['channel', 'bin', 'riskSeconds', 'events', 'censored'], 'exposure increment');
    member(inc.channel, EXPOSURE_CHANNELS, 'channel'); if (!integer(inc.bin) || inc.bin > 3) fail('Invalid risk bin');
    finite(inc.riskSeconds, 'risk increment'); if (![0, 1].includes(inc.events) || ![0, 1].includes(inc.censored) || inc.events && inc.censored) fail('Invalid event/censor increment');
    const k = `${inc.channel}:${inc.bin}`; if (cells.has(k)) fail('Duplicate batch cell'); cells.add(k);
  }
  const { draft, rows } = draftRows(model, exposureKeys(raw.appearance, raw.digestion), 'exposure');
  for (const r of rows) {
    r.ingestions += raw.ingestions; r.lastSequence = raw.sequence;
    for (const inc of raw.increments) { const c = EXPOSURE_CHANNELS.indexOf(inc.channel), cell = r.cells[c][inc.bin]; cell.events += inc.events; cell.riskSeconds += inc.riskSeconds; r.censored[c] += inc.censored; }
  }
  return commit(model, draft, raw, 'exposure');
}
function lookup(model) { const trusted = snapshotMetadata.get(model); if (trusted) return trusted.index; shape(model); return new Map(model.rows.map(r => [model.keys[r.key], r])); }
function indicator(rows, name, status = false) {
  let mean = null; const support = [];
  for (const r of rows) {
    const n = r ? status ? r.receipts : r.effects[name].n : 0, yes = r ? status ? r.completion[name] : r.effects[name].yes : 0;
    const parentMean = mean;
    if (n > 0) mean = mean === null ? yes / n : (yes + REUSABLE_MODEL.physicalPooling * mean) / (n + REUSABLE_MODEL.physicalPooling);
    support.push({ rowId: r?.key ?? null, observations: n, positive: yes, parentMean, parentWeight: n > 0 && parentMean !== null ? 4 / (n + 4) : parentMean !== null ? 1 : 0 });
  }
  return { mean, known: mean !== null, support, range: [0, 1] };
}
function expected(rows, name) {
  let mean = null; const support = [];
  for (const r of rows) { const s = r?.[name] ?? moment(), parentMean = mean;
    if (s.n) mean = mean === null ? s.sum / s.n : (s.sum + 4 * mean) / (s.n + 4);
    support.push({ rowId: r?.key ?? null, observations: s.n, sum: s.sum, sumSq: s.sumSq, parentMean, parentWeight: s.n && parentMean !== null ? 4 / (s.n + 4) : parentMean !== null ? 1 : 0 });
  }
  return { mean, known: mean !== null, support };
}
export function predictPhysical(model, features) {
  const p = physicalKeys(features), index = lookup(model), rows = p.hierarchy.map(k => index.get(k));
  const diagnostic = k => { const row = index.get(k); return { rowId: row?.key ?? null,
    effects: Object.fromEntries(PHYSICAL_EFFECTS.map(e => [e, indicator([row], e)])), completion: Object.fromEntries(PHYSICAL_COMPLETIONS.map(c => [c, indicator([row], c, true)])) }; };
  return { features: p.features, rowIds: rows.map(r => r?.key ?? null),
    effects: Object.fromEntries(PHYSICAL_EFFECTS.map(e => [e, indicator(rows, e)])),
    completion: Object.fromEntries(PHYSICAL_COMPLETIONS.map(c => [c, indicator(rows, c, true)])),
    duration: expected(rows, 'duration'), T: expected(rows, 'T'), E: expected(rows, 'E'),
    parentReceipts: rows[0]?.receipts ?? 0, parentObservedEffects: rows[0] ? Math.max(...Object.values(rows[0].effects).map(s => s.n)) : 0,
    parentClosedIntervals: rows[0]?.intervals ?? 0, conditional: { capacity: diagnostic(p.conditional[0]), count: diagnostic(p.conditional[1]) },
    marginalsOnly: true, independentParentAndChild: false };
}
function ratesFor(rows, channel) {
  const c = EXPOSURE_CHANNELS.indexOf(channel);
  return Array.from({ length: 4 }, (_, bin) => {
    let rate = 0, known = false; const support = [];
    for (const r of rows) {
      const cell = r?.cells[c][bin] ?? { events: 0, riskSeconds: 0 }, parentRate = rate;
      if (cell.events > 0 && cell.riskSeconds <= 0) fail('Positive event count without risk');
      if (cell.riskSeconds > 0) { rate = known ? cell.events / (cell.riskSeconds + 30) + rate * (30 / (cell.riskSeconds + 30)) : cell.events / cell.riskSeconds; known = true; }
      support.push({ rowId: r?.key ?? null, events: cell.events, riskSeconds: cell.riskSeconds, ingestions: r?.ingestions ?? 0,
        censored: r?.censored[c] ?? 0, parentRate, parentWeight: cell.riskSeconds > 0 && support.length > 0 ? 30 / (cell.riskSeconds + 30) : support.length > 0 ? 1 : 0 });
    }
    return { bin, rate, known, support };
  });
}
/** Integrates a separate conditional survival process from current age forward.
 * Discount is relative to now, not swallow time; final tail is never called safe. */
function integrate(rates, age, horizon) {
  let survival = 1, discounted = 0, probability = 0; const unknownBins = [];
  for (const { bin, riskSeconds: dt } of splitExposureRisk(age, age + horizon)) {
    const start = Math.max(age, EDGES[bin]), offset = start - age, r = rates[bin];
    if (!r.known) unknownBins.push(bin);
    if (r.rate > 0) {
      const mass = survival * -Math.expm1(-r.rate * dt);
      probability += mass;
      discounted += survival * Math.exp(-BETA * offset) * r.rate / (r.rate + BETA) * -Math.expm1(-(r.rate + BETA) * dt);
      survival *= Math.exp(-r.rate * dt);
    }
  }
  return { discounted, probability, survival, unknownBins };
}
function channelFlags(raw, label) {
  if (raw === undefined) return { F: false, W: false, H: false };
  optionalKeys(raw, EXPOSURE_CHANNELS, label);
  if (Object.values(raw).some(v => typeof v !== 'boolean')) fail(`Invalid ${label}`);
  return Object.fromEntries(EXPOSURE_CHANNELS.map(c => [c, raw[c] === true]));
}
export function forecastExposure(model, raw) {
  const age = finite(raw.ageSeconds ?? 0, 'forecast age'), horizon = finite(raw.horizonSeconds ?? 600, 'forecast horizon');
  if (horizon > 600) fail('Forecast exceeds frozen 600-second horizon');
  const digestion = raw.digestion ?? 'unknown', index = lookup(model), rows = exposureKeys(raw.appearance, digestion).map(k => index.get(k));
  const reported = channelFlags(raw.reported, 'reported channels'), censored = channelFlags(raw.censored, 'censored channels'), exact = channelFlags(raw.exactSupport, 'exact support');
  const channels = Object.fromEntries(EXPOSURE_CHANNELS.map(c => {
    const rates = ratesFor(rows, c), active = !reported[c] && !censored[c];
    let point = active ? integrate(rates, age, horizon) : { discounted: 0, probability: 0, survival: 1, unknownBins: [] };
    let parentFloorApplied = false;
    if (c === 'H' && active && !exact.H) {
      // Transfer cannot shrink a no-firsthand-harm material below either applicable
      // parent forecast. Compare forecast integrals, without inventing joint hazards.
      for (const ancestors of [rows.slice(0, 1), rows.slice(0, 2)]) {
        const parent = integrate(ratesFor(ancestors, c), age, horizon);
        if (parent.discounted > point.discounted || parent.probability > point.probability) parentFloorApplied = true;
        point = { ...point, discounted: Math.max(point.discounted, parent.discounted), probability: Math.max(point.probability, parent.probability), survival: 1 - Math.max(point.probability, parent.probability) };
      }
    }
    const deepest = [...rows].reverse().find(Boolean), ci = EXPOSURE_CHANNELS.indexOf(c);
    return [c, { ...point, rates, active, reported: reported[c], censored: censored[c], firsthand: exact[c],
      epistemicRange: [0, 1], ingestions: deepest?.ingestions ?? 0, eventCount: deepest?.cells[ci].reduce((s, x) => s + x.events, 0) ?? 0,
      monitoredSeconds: deepest?.cells[ci].reduce((s, x) => s + x.riskSeconds, 0) ?? 0,
      unsupported: censored[c] || point.unknownBins.length > 0, tailUncertain: true, parentFloorApplied }];
  }));
  return { ageSeconds: age, horizonSeconds: horizon, rowIds: rows.map(r => r?.key ?? null), channels, independentParentAndChild: false };
}
export function forecastPending(model, exposures, { horizonSeconds = 600 } = {}) {
  if (!Array.isArray(exposures) || exposures.length > 64) fail('Invalid bounded pending exposures');
  const forecasts = exposures.map(e => forecastExposure(model, { ...e, horizonSeconds }));
  return { B: Object.fromEntries(EXPOSURE_CHANNELS.map(c => [c, forecasts.reduce((sum, f) => sum + f.channels[c].discounted, 0)])), forecasts, horizonSeconds };
}
export function currentNeedWeights(body = {}) {
  return { F: body.hunger === 'content' ? .5 : body.hunger === 'peckish' ? 1 : 2,
    W: body.thirst === 'quenched' ? .5 : body.thirst === 'dry mouth' ? 1 : 2, H: -4, T: -.02, E: -.02 };
}
/** Factual channel support is supplied separately, never restored from parameters. */
export function forecastCandidate(model, raw) {
  if (typeof raw.eligibility !== 'boolean' || typeof raw.bindingsValid !== 'boolean') fail('Actual eligibility and valid binding facts are required');
  const physical = predictPhysical(model, raw.features), exactSupport = channelFlags(raw.exactSupport, 'exact support'), weights = currentNeedWeights(raw.currentSensations);
  const pNew = physical.effects.exposure.mean, duration = physical.duration.mean;
  const exposure = forecastExposure(model, { appearance: physical.features.appearance, digestion: raw.currentSensations?.digestion ?? 'unknown',
    ageSeconds: 0, horizonSeconds: duration === null ? 600 : Math.max(0, 600 - Math.min(600, duration)), exactSupport });
  const known = pNew !== null && (pNew === 0 || duration !== null), admitted = raw.eligibility && raw.bindingsValid;
  const D = Object.fromEntries(EXPOSURE_CHANNELS.map(c => [c, known ? pNew === 0 ? 0 : pNew * Math.exp(-BETA * duration) * exposure.channels[c].discounted : null]));
  const usedD = { F: admitted && exactSupport.F ? D.F ?? 0 : 0, W: admitted && exactSupport.W ? D.W ?? 0 : 0, H: D.H ?? 0 };
  const scorable = admitted && physical.parentObservedEffects > 0 && physical.parentClosedIntervals > 0 && physical.T.known && physical.E.known;
  const utility = scorable ? weights.F * usedD.F + weights.W * usedD.W - 4 * usedD.H - .02 * physical.T.mean - .02 * physical.E.mean : null;
  return { physical, exposure, pNew, durationSeconds: duration, D, usedD, weights, exactSupport,
    eligibility: raw.eligibility, bindingsValid: raw.bindingsValid, scorable, utility,
    biologicalConsequenceUnknown: !known, swallowDigestionApproximation: true,
    safe: false, modelVersion: 1 };
}
/** Immutable matched choice only. The caller supplies and commits all FOUR draws
 * through its unchanged selector. Draw 0 remains reserved for its focus scaffold. */
export function chooseMatched(candidates, forecasts, { draws } = {}) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length !== forecasts?.length || !Array.isArray(draws) || draws.length !== 4 || draws.some(d => !Number.isFinite(d) || d < 0 || d >= 1)) fail('Invalid matched choice inputs');
  if (forecasts.some(f => f.eligibility !== true)) fail('Matched choices must be the unchanged eligible root set');
  const rows = candidates.map((candidate, index) => {
    if (!TEMPORAL_OPERATIONS.includes(candidate.action?.type)) fail('Invalid candidate primitive');
    return { index, candidate, forecast: forecasts[index], focus: candidate.focus === true };
  });
  const scorable = rows.filter(r => r.forecast.scorable && Number.isFinite(r.forecast.utility));
  const exploring = draws[1] < .2 || !scorable.length; let selected;
  if (exploring) {
    const groups = new Map(); for (const row of rows) { const group = row.candidate.action.type; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(row); }
    const group = [...groups.values()][Math.floor(draws[2] * groups.size)]; selected = group[Math.floor(draws[3] * group.length)];
  } else {
    const best = Math.max(...scorable.map(r => r.forecast.utility)); let ties = scorable.filter(r => r.forecast.utility === best);
    if (ties.some(r => r.focus)) ties = ties.filter(r => r.focus);
    selected = ties[Math.floor(draws[2] * ties.length)];
  }
  return freeze(copy({ selectedIndex: selected.index, selected: selected.candidate, exploring, draws, committedDrawCount: 4 }));
}

/** One sensor capture can supply several independent factual streams. Apply the
 * complete capture transactionally; a capacity/integrity failure leaves the prior
 * parameter checkpoint untouched. Frozen controls skip this function only. */
export function applyReusableLabels(model, labels) {
  keysOnly(labels, ['exposureUpdates', 'receiptUpdates', 'intervalUpdates'], 'sensor labels');
  for (const list of Object.values(labels)) checkedArray(list, 'sensor label');
  const draft = validateReusableOutcomeModel(model), result = { receipts: 0, intervals: 0, exposures: 0 };
  for (const raw of labels.receiptUpdates) result.receipts += Number(updatePhysicalReceipt(draft, raw).admitted);
  for (const raw of labels.intervalUpdates) result.intervals += Number(updatePhysicalInterval(draft, raw).admitted);
  for (const raw of labels.exposureUpdates) result.exposures += Number(updateExposure(draft, raw).admitted);
  Object.assign(model, draft); return result;
}


function ownedSnapshot(model, existing = null) {
  const metadata = existing ?? { keyIndices: new Map(model.keys.map((k, i) => [k, i])),
    rowIndices: new Map(model.rows.map((r, i) => [r.key, i])), index: new Map(model.rows.map(r => [model.keys[r.key], r])),
    dictionaryBytes: encoder.encode(JSON.stringify(model.keys)).byteLength,
    physicalRows: model.rows.filter(r => r.type === 'physical').length,
    exposureRows: model.rows.filter(r => r.type === 'exposure').length };
  freeze(model); snapshotMetadata.set(model, metadata); return model;
}
/** Explicit immutable query boundary. Validation precedes ownership/freezing.
 * Reusing the result never allocates rows or trusts a mutable caller object. */
export function createReusableQuerySnapshot(model, elapsed = Infinity) {
  if (snapshotMetadata.has(model)) {
    if (!(elapsed === Infinity || number(elapsed)) || Object.values(model.cursors).some(c => c.at > elapsed)) fail('Invalid snapshot clock');
    return model;
  }
  return ownedSnapshot(validateReusableOutcomeModel(model, elapsed));
}
/** Cheap own-dictionary facts for a trusted snapshot. The caller must still check
 * the separately mutable legacy dictionary and any reserved submission key. */
export function reusableDictionaryDiagnostics(model) {
  const metadata = snapshotMetadata.get(model);
  if (metadata) return { dictionaryEntries: model.keys.length, dictionaryBytes: metadata.dictionaryBytes };
  shape(model); return { dictionaryEntries: model.keys.length, dictionaryBytes: encoder.encode(JSON.stringify(model.keys)).byteLength };
}
/** Runtime-only owner of persistent immutable parameter snapshots. Public raw
 * update APIs remain strict. This session is never serialized into actor memory. */
export function createReusableModelSession(model, elapsed = Infinity) {
  let current = createReusableQuerySnapshot(model, elapsed), applying = false;
  return Object.freeze({ snapshot: () => current,
    apply(kind, raw, { admit } = {}) {
      if (applying) fail('Reentrant snapshot update');
      member(kind, ['receipt', 'interval', 'exposure'], 'snapshot update kind');
      applying = true;
      try {
        const update = { receipt: updatePhysicalReceipt, interval: updatePhysicalInterval, exposure: updateExposure }[kind];
        if (!update || admit !== undefined && typeof admit !== 'function') fail('Invalid trusted update request');
        const transaction = { ...current };
        trustedTransactions.set(transaction, snapshotMetadata.get(current));
        const result = update(transaction, raw);
        if (!result.admitted) return result;
        const candidate = ownedSnapshot(transaction, trustedTransactions.get(transaction));
        if (admit) {
          const accepted = admit(candidate);
          if (accepted === false || accepted && typeof accepted.then === 'function') fail('Snapshot admission must complete synchronously', 'REUSABLE_ADMISSION');
        }
        current = candidate;
        return result;
      } finally { applying = false; }
    },
  });
}
