// A separately identified, fresh Ozark world. This module never reads or writes
// the historical `aincrad.save.v1` key or the recovered-profile import record.
import { CONFIG } from './config.js';
import { OZARK_WORLD_PROFILE } from './ozark-world-geometry.js';
import { createNpc } from './npc-state.js';
import { validateNpc } from './npc-memory.js';
import { createEnvironment, validateEnvironment } from './environment.js';
import { createOzarkEcology, validateOzarkEcology } from './ozark-ecology.js';
import { createCommunity, validateCommunity } from './social.js';
import { retainedProofIntegrityError } from './proof-retention.js';

export const OZARK_SAVE_KEY = 'aincrad.ozark.v1';
export const OZARK_SAVE_VERSION = 9;
const MAX_ELAPSED = 3600 * 100000;
const MAX_DISTANCE = 1e12;
const AGENT_IDS = Object.freeze(['aster', 'mira']);
const ENVELOPE_KEYS = Object.freeze([
  'version', 'geometryIdentity', 'features', 'simulationMode', 'scene',
  'player', 'playerBody', 'elapsed', 'distance', 'agents', 'environment',
  'community', 'selectedAgentId', 'waypoint',
]);
const BODY_KEYS = Object.freeze(['wetness', 'effort', 'stamina', 'health']);
const PROOF_FIELDS = Object.freeze([
  ['discovery', 'observations'], ['discovery', 'experiments'],
  ['discovery', 'effects'], ['discovery', 'seenFeedback'],
  ['memory', 'experience'], ['physiology', 'stomach'],
  ['physiology', 'feedback'], ['inventory', 'items'],
]);

// A state can replace only the exact Ozark bytes from which it was loaded (or
// an empty Ozark slot when fresh). A changed or unknown slot is never replaced.
const expectedRawByState = new WeakMap();
const fail = reason => { throw new Error(`Ozark save protected: ${reason}`); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const exactKeys = (value, keys) => plain(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

function sameExact(a, b) {
  if (Object.is(a, b)) return true;
  if (!plain(a) && !Array.isArray(a) || !plain(b) && !Array.isArray(b) ||
      Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Reflect.ownKeys(a), right = Reflect.ownKeys(b);
  return left.length === right.length &&
    left.every(key => Object.hasOwn(b, key) && sameExact(a[key], b[key]));
}

function assertGeometry(geometry) {
  if (!geometry || !Object.isFrozen(geometry) ||
      geometry.profile !== OZARK_WORLD_PROFILE ||
      geometry.profile.identity !== OZARK_WORLD_PROFILE.identity ||
      !Object.isFrozen(geometry.spawn) || !Object.isFrozen(geometry.agentSpawns) ||
      typeof geometry.canOccupy !== 'function' ||
      typeof geometry.classify !== 'function' ||
      typeof geometry.sample !== 'function') {
    fail('the approved playable geometry is unavailable');
  }
  for (const point of [geometry.spawn, ...AGENT_IDS.map(id => geometry.agentSpawns[id])]) {
    if (!point || !finite(point.x, -CONFIG.halfSize, CONFIG.halfSize) ||
        !finite(point.y, -CONFIG.halfSize, CONFIG.halfSize) ||
        geometry.classify(point.x, point.y, CONFIG.playerRadius).reason !== 'dry-ground') {
      fail('a fresh spawn is not dry and passable');
    }
  }
  return geometry;
}

function occupiable(geometry, point) {
  try {
    return plain(point) && finite(point.x, -CONFIG.halfSize, CONFIG.halfSize) &&
      finite(point.y, -CONFIG.halfSize, CONFIG.halfSize) &&
      geometry.canOccupy(point.x, point.y, CONFIG.playerRadius) === true;
  } catch { return false; }
}

function actorEvidenceExact(before, after) {
  return PROOF_FIELDS.every(([section, field]) =>
    sameExact(before?.[section]?.[field], after?.[section]?.[field]));
}

function checkActor(raw, id, worldElapsed, geometry, restoring) {
  const timedRows = [raw?.memory?.experience, raw?.discovery?.experiments,
    raw?.discovery?.effects, raw?.physiology?.stomach,
    raw?.physiology?.feedback];
  if (!plain(raw) || raw.id !== id || raw.version !== 4 ||
      raw.mode !== 'discovery' || raw.scene !== 'valley' ||
      !finite(raw.elapsed, 0, worldElapsed) ||
      !occupiable(geometry, raw.position) ||
      timedRows.some(rows => !Array.isArray(rows) ||
        rows.some(row => !finite(row?.at, 0, raw.elapsed))) ||
      raw.proofRetentionError || retainedProofIntegrityError(raw)) {
    fail(`${id} has invalid identity, position, time, or evidence`);
  }
  const canStandAt = (x, y, scene) => scene === 'valley' &&
    occupiable(geometry, { x, y });
  // Inspect the canonical disk form before restart can append its one explicit
  // interrupted-action receipt. No original sample, action or effect may be
  // silently sliced, repaired, or replaced by feedback from a separate queue.
  const canonical = validateNpc(raw, { restoring: false, canStandAt });
  if (canonical.scene !== 'valley' || !sameExact(canonical.position, raw.position) ||
      !actorEvidenceExact(raw, canonical) || retainedProofIntegrityError(canonical)) {
    fail(`${id} would lose physical or learned evidence during validation`);
  }
  if (!restoring) return canonical;
  const resumed = validateNpc(raw, { restoring: true, canStandAt });
  if (resumed.scene !== 'valley' || !sameExact(resumed.position, raw.position) ||
      retainedProofIntegrityError(resumed)) {
    fail(`${id} could not be restored without losing evidence`);
  }
  return resumed;
}

function validateBody(body) {
  if (!exactKeys(body, BODY_KEYS) ||
      !finite(body.wetness, 0, 100) || !finite(body.effort, 0, 1) ||
      !finite(body.stamina, 0, 100) || !finite(body.health, 0, 100)) {
    fail('the player body is invalid');
  }
  return { wetness: body.wetness, effort: body.effort,
    stamina: body.stamina, health: body.health };
}

function validateWaypoint(point, geometry) {
  if (point === null) return null;
  if (!plain(point) || !finite(point.x, geometry.bounds.minX, geometry.bounds.maxX) ||
      !finite(point.y, geometry.bounds.minY, geometry.bounds.maxY)) {
    fail('the waypoint is outside this world');
  }
  return { x: point.x, y: point.y };
}

function validateOzarkState(raw, geometry, { restoring = true } = {}) {
  assertGeometry(geometry);
  const keys = Object.hasOwn(raw || {}, 'npc') ? [...ENVELOPE_KEYS, 'npc'] : ENVELOPE_KEYS;
  if (!exactKeys(raw, keys) || raw.version !== OZARK_SAVE_VERSION ||
      raw.geometryIdentity !== OZARK_WORLD_PROFILE.identity ||
      !exactKeys(raw.features, ['plantLifecycle']) ||
      raw.features.plantLifecycle !== 1 ||
      raw.simulationMode !== 'discovery' || raw.scene !== 'valley' ||
      !finite(raw.elapsed, 0, MAX_ELAPSED) ||
      !finite(raw.distance, 0, MAX_DISTANCE) ||
      !occupiable(geometry, raw.player) ||
      !Array.isArray(raw.agents) || raw.agents.length !== AGENT_IDS.length ||
      !AGENT_IDS.includes(raw.selectedAgentId) ||
      !plain(raw.environment) || raw.environment.mode !== 'discovery' ||
      raw.environment.seed !== OZARK_WORLD_PROFILE.seed ||
      raw.environment.elapsed !== raw.elapsed ||
      !plain(raw.environment.ecology)) {
    fail('world identity or physical envelope does not match Ozark version 9');
  }
  if (Object.hasOwn(raw, 'npc') && raw.npc !== raw.agents[0]) {
    fail('the live historical Aster alias is inconsistent');
  }
  const playerBody = validateBody(raw.playerBody);
  const waypoint = validateWaypoint(raw.waypoint, geometry);
  const records = new Map(raw.agents.map(actor => [actor?.id, actor]));
  if (records.size !== AGENT_IDS.length ||
      AGENT_IDS.some(id => !records.has(id))) fail('both original agents are required');
  const agents = AGENT_IDS.map(id =>
    checkActor(records.get(id), id, raw.elapsed, geometry, restoring));
  const environment = validateEnvironment(raw.environment, {
    elapsed: raw.elapsed, mode: 'discovery', connectedEcology: false,
    ecologyValidator: (rawEcology, context = {}) =>
      validateOzarkEcology(rawEcology, geometry, {
        seed: context.seed ?? OZARK_WORLD_PROFILE.seed,
        elapsed: context.elapsed ?? raw.elapsed,
      }),
  });
  if (!environment.ecology ||
      environment.ecology.geometryIdentity !== OZARK_WORLD_PROFILE.identity) {
    fail('ecology identity does not match the playable world');
  }
  const community = validateCommunity(raw.community);
  return {
    version: OZARK_SAVE_VERSION,
    geometryIdentity: OZARK_WORLD_PROFILE.identity,
    features: { plantLifecycle: 1 }, simulationMode: 'discovery',
    scene: 'valley', player: { x: raw.player.x, y: raw.player.y },
    playerBody, elapsed: raw.elapsed, distance: raw.distance,
    agents, npc: agents[0], environment, community,
    selectedAgentId: raw.selectedAgentId, waypoint,
  };
}

/** Start a new Ozark world without touching either historical save slot. */
export function createOzarkState(geometry) {
  assertGeometry(geometry);
  const seed = OZARK_WORLD_PROFILE.seed;
  const agents = AGENT_IDS.map(id => {
    const actor = createNpc({ id, mode: 'discovery', seed });
    actor.position = { ...geometry.agentSpawns[id] };
    return actor;
  });
  const environment = createEnvironment(seed, { mode: 'discovery', populate: false });
  environment.ecology = createOzarkEcology(geometry, seed, 0);
  const state = {
    version: OZARK_SAVE_VERSION,
    geometryIdentity: OZARK_WORLD_PROFILE.identity,
    features: { plantLifecycle: 1 }, simulationMode: 'discovery',
    scene: 'valley', player: { ...geometry.spawn },
    playerBody: { wetness: 0, effort: 0, stamina: 100, health: 100 },
    elapsed: 0, distance: 0, agents, npc: agents[0], environment,
    community: createCommunity(), selectedAgentId: 'aster', waypoint: null,
  };
  expectedRawByState.set(state, null);
  return state;
}

/** An invalid occupied Ozark slot pauses play; its exact bytes remain intact. */
export function loadOzarkSave(storage, geometry) {
  try {
    assertGeometry(geometry);
    const raw = storage.getItem(OZARK_SAVE_KEY);
    if (raw === null) return {
      state: createOzarkState(geometry), exists: false, blocked: false, error: null,
    };
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 16 * 1024 * 1024) {
      fail('the saved bytes are missing or exceed the supported size');
    }
    const state = validateOzarkState(JSON.parse(raw), geometry, { restoring: true });
    expectedRawByState.set(state, raw);
    return { state, exists: true, blocked: false, error: null };
  } catch (error) {
    const reason = error?.message || 'the saved world could not be read';
    return { state: null, exists: true, blocked: true,
      error: reason.startsWith('Ozark save protected:') ? reason :
        `Ozark save protected: ${reason}` };
  }
}

/** A same-slot, exact-byte compare prevents a stale process replacing a save. */
export function writeOzarkSave(storage, state, geometry) {
  try {
    if (!expectedRawByState.has(state)) return false;
    const expected = expectedRawByState.get(state);
    if (storage.getItem(OZARK_SAVE_KEY) !== expected) return false;
    const canonical = validateOzarkState(state, geometry, { restoring: false });
    const { npc: _alias, ...disk } = canonical;
    const raw = JSON.stringify(disk);
    if (raw.length > 16 * 1024 * 1024) return false;
    storage.setItem(OZARK_SAVE_KEY, raw);
    if (storage.getItem(OZARK_SAVE_KEY) !== raw) return false;
    expectedRawByState.set(state, raw);
    return true;
  } catch { return false; }
}
