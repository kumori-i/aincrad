import { cleanAppearanceCues, appearanceCuesMatch } from './peer-teaching.js';
import { isSleeping } from './biology.js';
import { NPC_RULES } from './config.js';
import { actorLineOfSight } from './perception.js';

// Supplied exact three-cue comparison, not a discovered category or action rule.
// Two time-separated samples do NOT establish two independent encounters.
export const VISUAL_SAMPLE_LIMIT = 32;
const actors = ['aster', 'mira'];
const currentSamples = new WeakMap();
// Transient evidence identities change whenever a cue record is retired/revised.
// They are never restored from disk or supplied to a language model.
const sampleIdentities = new WeakMap();
const awake = npc => npc?.mode === 'discovery' && actors.includes(npc.id) &&
  npc.lifecycle === 'AWAKE' && !isSleeping(npc) && npc.scene === 'valley';
const visible = (npc, object) => object?.scene === npc.scene &&
  [npc.position?.x, npc.position?.y, object.position?.x, object.position?.y].every(Number.isFinite) &&
  Math.hypot(npc.position.x - object.position.x, npc.position.y - object.position.y) <= NPC_RULES.visionRadius &&
  actorLineOfSight(npc, npc.position, object.position);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const objectId = value => typeof value === 'string' && /^object:[1-9][0-9]{0,8}$/.test(value);
const time = (value, now) => Number.isFinite(value) && value >= 0 && value <= now && value <= 1e10;
const compareIds = (a, b) => a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0;
const cuesOf = appearance => cleanAppearanceCues(Object.fromEntries(
  ['shape', 'color', 'texture'].map(key => [key, appearance?.[key]])));

/** Optional schema-12 data. No normalization or silent truncation of bad evidence. */
export function validVisualSamples(raw, npc) {
  if (!exact(raw, ['version', 'ownerId', 'records']) || raw.version !== 1 ||
      !actors.includes(raw.ownerId) || raw.ownerId !== npc?.id ||
      !time(npc?.elapsed, 1e10) || !Array.isArray(raw.records) ||
      raw.records.length > VISUAL_SAMPLE_LIMIT) return false;
  const ids = new Set();
  for (const row of raw.records) {
    if (!exact(row, ['objectId', 'scene', 'cues', 'times']) || !objectId(row.objectId) ||
        ids.has(row.objectId) || row.scene !== 'valley' || !cleanAppearanceCues(row.cues) ||
        !Array.isArray(row.times) || row.times.length < 1 || row.times.length > 2 ||
        !row.times.every(at => time(at, npc.elapsed)) ||
        row.times.length === 2 && row.times[0] >= row.times[1]) return false;
    ids.add(row.objectId);
  }
  return true;
}

/** Called ONLY for ordinary personal perception, never testimony, naming refresh,
 * restored observations, or action-result descriptions. Objects have already
 * passed the perception adapter's scene/sight gates; this module reads no world.
 * Empty visibility is absence, not disproof. Missing/changed observed cues retire
 * old support. Held and visible duplicates at one time contribute only once. */
export function ingestVisualSamples(npc, objects) {
  if (npc && typeof npc === 'object') currentSamples.delete(npc);
  if (!awake(npc) ||
      !time(npc.elapsed, 1e10) || !npc.discovery || !Array.isArray(objects)) return;
  const prior = npc.discovery.visualSamples;
  if (prior !== undefined && !validVisualSamples(prior, npc)) return;
  const records = new Map((prior?.records || []).map(row => [row.objectId, row]));
  const identities = sampleIdentities.get(npc) || new Map();
  sampleIdentities.set(npc, identities);
  const batch = new Map(), positions = new Map();
  for (const object of objects) {
    if (!objectId(object?.id) || !visible(npc, object)) continue;
    positions.set(object.id, {...object.position});
    const cues = cuesOf(object.appearance);
    // Conflicting duplicate sensory descriptions are not corroboration.
    if (batch.has(object.id)) {
      const first = batch.get(object.id);
      if (!first || !cues || !appearanceCuesMatch(first, cues)) batch.set(object.id, null);
    } else batch.set(object.id, cues);
  }
  for (const [id, cues] of batch) {
    if (!cues) { records.delete(id); identities.delete(id); continue; }
    const old = records.get(id);
    const same = old && old.scene === npc.scene && appearanceCuesMatch(old.cues, cues);
    if (!same || !identities.has(id)) identities.set(id, {});
    const times = same ? [...old.times] : [];
    if (times.at(-1) !== npc.elapsed) times.push(npc.elapsed);
    records.set(id, { objectId:id, scene:npc.scene, cues, times:times.slice(-2) });
  }
  if (!prior && !records.size) return;
  // Retire least recently sampled first, with deterministic ID tie-breaking.
  const retained = [...records.values()].sort((a, b) =>
    b.times.at(-1) - a.times.at(-1) || compareIds(a, b)).slice(0, VISUAL_SAMPLE_LIMIT);
  npc.discovery.visualSamples = { version:1, ownerId:npc.id, records:retained.sort(compareIds) };
  for (const id of identities.keys()) if (!retained.some(row => row.objectId === id)) identities.delete(id);
  currentSamples.set(npc, { at:npc.elapsed, scene:npc.scene, objects:new Map(retained
    .filter(row => batch.get(row.objectId)).map(row => [row.objectId, {cues:{...row.cues},
      scene:npc.scene, position:positions.get(row.objectId)}])) });
}

/** Derived private tentative groups; never redundant saved memberships, names,
 * claims about unseen properties, live target authority, or peer memory. */
export function visualGroups(npc) {
  const memory = npc?.discovery?.visualSamples;
  if (!validVisualSamples(memory, npc)) return [];
  const groups = [];
  for (const row of [...memory.records].sort(compareIds)) {
    if (row.times.length !== 2) continue;
    let group = groups.find(candidate => appearanceCuesMatch(candidate.cues, row.cues));
    if (!group) { group = { cues:{...row.cues}, members:[] }; groups.push(group); }
    group.members.push({ objectId:row.objectId, scene:row.scene, times:[...row.times] });
  }
  return groups.filter(group => group.members.length >= 2);
}

/** A live ordinary sample only. Reload and read-only projection cannot create it. */
export function visualSampleCurrent(npc, id) {
  const batch = currentSamples.get(npc), object = batch?.objects.get(id);
  return !!object && awake(npc) && batch.at === npc.elapsed && batch.scene === npc.scene &&
    visible(npc, object);
}

/** Runtime identity of uninterrupted personally sampled cues, not save authority. */
export function visualSampleIdentity(npc, id) {
  return visualSampleCurrent(npc, id) ? sampleIdentities.get(npc)?.get(id) ?? null : null;
}
