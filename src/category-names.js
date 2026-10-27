import { CONFIG, NPC_RULES, SOCIAL_RULES } from './config.js';
import { validNameToken, lexicalLabels } from './naming-state.js';
import { cleanAppearanceCues, appearanceCuesMatch } from './peer-teaching.js';
import { validVisualSamples, visualSampleCurrent, visualSampleIdentity } from './visual-group-memory.js';

// Private tentative vocabulary. The exact three-cue rule is supplied, not a
// discovered species classifier. No action, effect or safety record is read or
// written here. Historical individual bindings remain a separate v1 lexicon.
export const CATEGORY_NAME_LIMIT = 24, CATEGORY_HEARD_LIMIT = 48, CATEGORY_ATTEMPT_LIMIT = 64;
export const CATEGORY_RETRY_SECONDS = 300;
const agents = ['aster', 'mira'];
const pendingProof = new WeakMap();
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const id = x => typeof x === 'string' && /^object:[1-9][0-9]{0,8}$/.test(x);
const time = (x, n) => Number.isFinite(x) && x >= 0 && x <= n.elapsed && x <= 1e10;
const point = p => exact(p, ['x', 'y']) && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < CONFIG.halfSize && Math.abs(p.y) < CONFIG.halfSize;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cueKey = cues => JSON.stringify(['shape', 'color', 'texture'].map(k => cues[k]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = x => structuredClone(x);
const safeModel = x => typeof x === 'string' && x.length >= 1 && x.length <= 120 && x.trim() === x && !/[\u0000-\u001f\u007f]/.test(x);
export const validCategoryToken = x => validNameToken(x) && !new Set(['safe', 'unsafe', 'edible', 'inedible', 'poison', 'poisonous', 'toxic', 'nontoxic', 'healthy', 'beneficial', 'nutritious']).has(x);
function exampleValid(x, npc, at) {
  return exact(x, ['objectId', 'times']) && id(x.objectId) && Array.isArray(x.times) && x.times.length === 2 &&
    x.times.every(t => time(t, npc) && t <= at) && x.times[0] < x.times[1];
}
function eventValid(e, npc, pointValid) {
  return exact(e, ['messageId', 'at', 'scene', 'speakerPosition', 'listenerPosition', 'objectPosition']) &&
    typeof e.messageId === 'string' && /^message:[1-9][0-9]{0,14}$/.test(e.messageId) && Number.isSafeInteger(Number(e.messageId.slice(8))) &&
    time(e.at, npc) && e.scene === 'valley' && ['speakerPosition', 'listenerPosition', 'objectPosition'].every(k => point(e[k]) && (!pointValid || pointValid(e[k], e.at))) &&
    distance(e.speakerPosition, e.listenerPosition) <= SOCIAL_RULES.peerRange &&
    distance(e.speakerPosition, e.objectPosition) <= NPC_RULES.visionRadius && distance(e.listenerPosition, e.objectPosition) <= NPC_RULES.visionRadius;
}
function retainedMessage(npc, event, speakerId, listenerId) {
  const rows = (npc.social?.heard || []).filter(m => m.id === event.messageId);
  return !rows.length || rows.length === 1 && rows[0].channel === 'peer' && rows[0].senderId === speakerId && rows[0].recipientId === listenerId && rows[0].at === event.at && rows[0].model !== true;
}
const empty = npc => ({version: 1, ownerId: npc.id, admissions: [], own: [], heard: []});
/** Strict optional schema-12 data: absent means absent; malformed means reject. */
export function validCategoryNames(raw, npc, {pointValid} = {}) {
  if (!exact(raw, ['version', 'ownerId', 'admissions', 'own', 'heard']) || raw.version !== 1 || !agents.includes(npc?.id) || raw.ownerId !== npc.id ||
      !Array.isArray(raw.admissions) || raw.admissions.length > CATEGORY_ATTEMPT_LIMIT || !Array.isArray(raw.own) || raw.own.length > CATEGORY_NAME_LIMIT || !Array.isArray(raw.heard) || raw.heard.length > CATEGORY_HEARD_LIMIT) return false;
  const attempted = new Set(), tokens = new Set(), cues = new Set(), events = new Set(), heardKeys = new Set();
  const retained = validVisualSamples(npc.discovery?.visualSamples, npc) ? npc.discovery.visualSamples.records : [];
  // Saved historical examples may outlive sensory compaction or cue revision,
  // but cannot contradict an explicitly retained sample of the same identity
  // at the very same time. This is consistency, not save authentication.
  const consistent = (example, cues) => !retained.some(row => row.objectId === example.objectId &&
    row.times.some(at => example.times.includes(at)) && !appearanceCuesMatch(row.cues, cues));
  for (const row of raw.admissions) {
    if (!exact(row, ['example', 'cues', 'at']) || !time(row.at, npc) || !exampleValid(row.example, npc, row.at) || row.example.times[1] !== row.at || !cleanAppearanceCues(row.cues) || !consistent(row.example, row.cues) || attempted.has(cueKey(row.cues))) return false;
    attempted.add(cueKey(row.cues));
  }
  for (const row of raw.own) {
    if (!exact(row, ['token', 'cues', 'example', 'requestAt', 'at', 'model', 'announcedTo']) || !validCategoryToken(row.token) || !cleanAppearanceCues(row.cues) || !time(row.requestAt, npc) || !time(row.at, npc) || row.at < row.requestAt || row.at - row.requestAt > 60 || !safeModel(row.model) ||
        !exampleValid(row.example, npc, row.requestAt) || !raw.admissions.some(a => a.at === row.requestAt && same(a.example, row.example) && appearanceCuesMatch(a.cues, row.cues)) || tokens.has(row.token) || cues.has(cueKey(row.cues)) ||
        !Array.isArray(row.announcedTo) || row.announcedTo.length > 1) return false;
    tokens.add(row.token); cues.add(cueKey(row.cues));
    for (const a of row.announcedTo) {
      if (!exact(a, ['peerId', 'objectId', 'event']) || !agents.includes(a.peerId) || a.peerId === npc.id || !id(a.objectId) || !eventValid(a.event, npc, pointValid) || a.event.at < row.at || events.has(a.event.messageId) || !retainedMessage(npc, a.event, npc.id, a.peerId)) return false;
      events.add(a.event.messageId);
    }
  }
  for (const row of raw.heard) {
    if (!exact(row, ['speakerId', 'token', 'cues', 'example', 'at', 'grounding']) || !agents.includes(row.speakerId) || row.speakerId === npc.id || !validCategoryToken(row.token) || !cleanAppearanceCues(row.cues) || !time(row.at, npc) || !exampleValid(row.example, npc, row.at) || !consistent(row.example, row.cues) ||
        !eventValid(row.grounding, npc, pointValid) || row.grounding.at !== row.at || row.example.times[1] !== row.at || !retainedMessage(npc, row.grounding, row.speakerId, npc.id) || events.has(row.grounding.messageId)) return false;
    const key = `${row.speakerId}|${row.token}|${cueKey(row.cues)}`;
    if (heardKeys.has(key)) return false;
    heardKeys.add(key); events.add(row.grounding.messageId);
  }
  return true;
}
const samples = npc => validVisualSamples(npc?.discovery?.visualSamples, npc) ? npc.discovery.visualSamples.records : [];
function rows(npc) {
  return validCategoryNames(npc?.categoryNames, npc) ? [
    ...npc.categoryNames.own.map(row => ({...row, source: 'own', speakerId: npc.id})),
    ...npc.categoryNames.heard.map(row => ({...row, source: 'heard', model: null})),
  ] : [];
}
/** Projection changes with observed cues; absence is not disproof. A changed or
 * incomplete ordinary sample removes membership, never old lexical evidence. */
export function categoryLabels(npc) {
  const memory = samples(npc);
  return rows(npc).map(row => ({token: row.token, cues: {...row.cues}, speakerId: row.speakerId, source: row.source, model: row.model, at: row.at, status: 'tentative-appearance', examples: [clone(row.example)],
    members: memory.filter(s => s.times.length === 2 && appearanceCuesMatch(s.cues, row.cues)).map(s => ({objectId: s.objectId, times: [...s.times]}))}));
}
export function objectName(npc, objectId) {
  const labels = categoryLabels(npc).filter(r => r.members.some(m => m.objectId === objectId));
  const own = labels.filter(r => r.source === 'own');
  const usable = own.length ? own : labels;
  if (usable.length && new Set(usable.map(r => r.token)).size === 1) {
    const row = usable[0]; return {token: row.token, speakerId: row.speakerId, source: row.source === 'own' ? 'model-category' : 'heard-category', at: row.at};
  }
  const old = lexicalLabels(npc).filter(r => r.objectId === objectId), chosen = old.filter(r => r.speakerId === npc.id);
  const legacy = chosen.length ? chosen : old;
  if (legacy.length && new Set(legacy.map(r => r.token)).size === 1) return {token: legacy[0].token, speakerId: legacy[0].speakerId, source: 'individual', at: legacy[0].at};
  return null;
}
export function namedObject(npc, objectId) { const label = objectName(npc, objectId); return label ? `“${label.token}” (${objectId})` : objectId; }
export function resolveCategoryName(npc, token, speakerId, visibleObjects = []) {
  const labels = categoryLabels(npc).filter(r => r.token === token && (speakerId == null || r.speakerId === speakerId));
  // Distinct meanings are a conflict even when one currently lies out of sight.
  if (!labels.length || new Set(labels.map(r => cueKey(r.cues))).size !== 1) return null;
  const ids = new Set(visibleObjects.filter(o => visualSampleCurrent(npc, o.id) && appearanceCuesMatch(o.appearance, labels[0].cues) && labels.some(r => r.members.some(m => m.objectId === o.id))).map(o => o.id));
  return ids.size === 1 ? [...ids][0] : null;
}
/** Read-only model context: no world, material, species, effects, instructions,
 * inventory or private peer extension. Familiar words are not verified facts. */
export function namingProposal(npc) {
  if (npc?.mode !== 'discovery' || !npc.learning || npc.lifecycle !== 'AWAKE' || npc.scene !== 'valley') return null;
  const lex = npc.categoryNames ?? empty(npc);
  if (!validCategoryNames(lex, npc) || lex.own.length >= CATEGORY_NAME_LIMIT) return null;
  const known = rows(npc), candidate = samples(npc).filter(s => s.times.length === 2 && visualSampleCurrent(npc, s.objectId) && !lex.admissions.some(a => appearanceCuesMatch(a.cues, s.cues) && npc.elapsed - a.at < CATEGORY_RETRY_SECONDS) && (lex.admissions.length < CATEGORY_ATTEMPT_LIMIT || lex.admissions.some(a => appearanceCuesMatch(a.cues, s.cues))) && !known.some(r => appearanceCuesMatch(r.cues, s.cues))).sort((a, b) => {
    const previous = sample => lex.admissions.find(row => appearanceCuesMatch(row.cues, sample.cues));
    const x = previous(a), y = previous(b);
    // Retry cooldown alone is not fairness: low-ID retries could otherwise
    // starve a sixth cue forever under the controller's one-minute spacing.
    return Number(!!x) - Number(!!y) || (x?.at ?? 0) - (y?.at ?? 0) || a.objectId.localeCompare(b.objectId);
  })[0];
  if (!candidate) return null;
  return {version: 1, agentId: npc.id, observedAt: npc.elapsed, example: {objectId: candidate.objectId, cues: {...candidate.cues}, times: [...candidate.times]},
    lexicon: known.slice(0, CATEGORY_NAME_LIMIT + CATEGORY_HEARD_LIMIT).map(r => ({token: r.token, cues: {...r.cues}, source: r.source, speakerId: r.speakerId})),
    individualNames: lexicalLabels(npc).filter(r => npc.discovery?.observations?.[r.objectId] || samples(npc).some(s => s.objectId === r.objectId)).map(r => ({token: r.token, objectId: r.objectId, speakerId: r.speakerId}))};
}
function requestValid(request, npc) {
  return exact(request, ['version', 'agentId', 'observedAt', 'example', 'lexicon', 'individualNames']) && request.version === 1 && request.agentId === npc.id && time(request.observedAt, npc) &&
    exact(request.example, ['objectId', 'cues', 'times']) && cleanAppearanceCues(request.example.cues) && exampleValid({objectId: request.example.objectId, times: request.example.times}, npc, request.observedAt) &&
    Array.isArray(request.lexicon) && request.lexicon.length <= CATEGORY_NAME_LIMIT + CATEGORY_HEARD_LIMIT && request.lexicon.every(r => exact(r, ['token', 'cues', 'source', 'speakerId']) && validCategoryToken(r.token) && cleanAppearanceCues(r.cues) && ['own', 'heard'].includes(r.source) && agents.includes(r.speakerId) && (r.source === 'own') === (r.speakerId === npc.id)) && Array.isArray(request.individualNames) && request.individualNames.length <= 72 && request.individualNames.every(r => exact(r, ['token', 'objectId', 'speakerId']) && validNameToken(r.token) && id(r.objectId) && agents.includes(r.speakerId));
}
/** Records a bounded per-cue admission before IPC. Unadopted proposals can
 * retry after five simulated minutes; reload preserves the cooldown. Accepted
 * categories never request a synonym. Service/actor budgets still apply. */
export function beginNamingProposal(npc, request) {
  const expected = namingProposal(npc);
  if (!expected || !same(expected, request)) return false;
  const lex = npc.categoryNames ?? empty(npc);
  const admission = {example: {objectId: request.example.objectId, times: [...request.example.times]}, cues: {...request.example.cues}, at: request.observedAt};
  const prior = lex.admissions.findIndex(a => appearanceCuesMatch(a.cues, request.example.cues));
  if (prior < 0) lex.admissions.push(admission); else lex.admissions[prior] = admission;
  npc.categoryNames = lex;
  pendingProof.set(request, {npc, identity: visualSampleIdentity(npc, request.example.objectId)});
  return true;
}
export function acceptNamingProposal(npc, request, response) {
  const lex = npc.categoryNames, proof = request && pendingProof.get(request);
  if (!proof || proof.npc !== npc || !proof.identity || proof.identity !== visualSampleIdentity(npc, request.example.objectId)) return false;
  pendingProof.delete(request);
  if (!validCategoryNames(lex, npc) || !requestValid(request, npc) || !exact(response, ['token', 'model']) || !validCategoryToken(response.token) || !safeModel(response.model) || npc.elapsed - request.observedAt > 60 || lex.own.length >= CATEGORY_NAME_LIMIT ||
      !lex.admissions.some(a => a.at === request.observedAt && a.example.objectId === request.example.objectId && same(a.example.times, request.example.times) && appearanceCuesMatch(a.cues, request.example.cues))) return false;
  const current = samples(npc).find(s => s.objectId === request.example.objectId);
  if (!current || current.times.length !== 2 || !visualSampleCurrent(npc, current.objectId) || !appearanceCuesMatch(current.cues, request.example.cues) || current.times[0] < request.example.times[0] || rows(npc).some(r => r.token === response.token || appearanceCuesMatch(r.cues, request.example.cues)) || lexicalLabels(npc).some(r => r.token === response.token)) return false;
  const row = {token: response.token, cues: {...request.example.cues}, example: {objectId: request.example.objectId, times: [...request.example.times]}, requestAt: request.observedAt, at: npc.elapsed, model: response.model, announcedTo: []};
  lex.own.push(row); if (!validCategoryNames(lex, npc)) { lex.own.pop(); return false; } return true;
}
/** Atomic local grounded delivery; only the receiver's ordinary personal sample
 * supplies its example and cues. No transmitted ID is itself an observation. */
export function recordCategoryGrounding(speaker, listener, own, objectId, event) {
  const a = speaker.categoryNames, b = listener.categoryNames ?? empty(listener);
  if (!validCategoryNames(a, speaker) || !validCategoryNames(b, listener) || speaker.id === listener.id || !a.own.includes(own) || own.announcedTo.length || b.heard.length >= CATEGORY_HEARD_LIMIT || !eventValid(event, speaker) || !eventValid(event, listener) || event.at !== speaker.elapsed || event.at !== listener.elapsed || !same(event.speakerPosition, speaker.position) || !same(event.listenerPosition, listener.position)) return false;
  const heard = samples(listener).find(s => s.objectId === objectId), said = samples(speaker).find(s => s.objectId === objectId);
  if (!heard || !said || heard.times.length !== 2 || said.times.length !== 2 || !visualSampleCurrent(speaker, objectId) || !visualSampleCurrent(listener, objectId) || !appearanceCuesMatch(heard.cues, own.cues) || !appearanceCuesMatch(said.cues, own.cues) || b.heard.some(r => r.speakerId === speaker.id && r.token === own.token && appearanceCuesMatch(r.cues, heard.cues))) return false;
  const announcement = {peerId: listener.id, objectId, event: clone(event)};
  const row = {speakerId: speaker.id, token: own.token, cues: {...heard.cues}, example: {objectId, times: [...heard.times]}, at: event.at, grounding: clone(event)};
  own.announcedTo.push(announcement); b.heard.push(row);
  if (!validCategoryNames(a, speaker) || !validCategoryNames(b, listener)) { own.announcedTo.pop(); b.heard.pop(); return false; }
  listener.categoryNames = b; return true;
}
export function validCategoryCorrespondence(actors) {
  for (const listener of actors) for (const heard of listener.categoryNames?.heard || []) {
    const speaker = actors.find(n => n.id === heard.speakerId), own = speaker?.categoryNames?.own.find(r => r.token === heard.token && appearanceCuesMatch(r.cues, heard.cues));
    if (!own?.announcedTo.some(a => a.peerId === listener.id && a.objectId === heard.example.objectId && same(a.event, heard.grounding))) return false;
  }
  for (const speaker of actors) for (const own of speaker.categoryNames?.own || []) for (const a of own.announcedTo) {
    const listener = actors.find(n => n.id === a.peerId);
    if (!listener?.categoryNames?.heard.some(h => h.speakerId === speaker.id && h.token === own.token && h.example.objectId === a.objectId && appearanceCuesMatch(h.cues, own.cues) && same(h.grounding, a.event))) return false;
  }
  return true;
}
