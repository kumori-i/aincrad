// A separately identified, fresh Ozark world. This module never reads or writes
// the historical `aincrad.save.v1` key or the recovered-profile import record.
import { CONFIG, NPC_RULES } from './config.js';
import { BIOLOGY_RULES, simulationSeconds } from './biology-config.js';
import { OZARK_WORLD_PROFILE } from './ozark-world-geometry.js';
import { createNpc } from './npc-state.js';
import { validateNpc } from './npc-memory.js';
import { createEnvironment, validateEnvironment } from './environment.js';
import { createOzarkEcology, validateOzarkEcology } from './ozark-ecology.js';
import { createCommunity, validateCommunity } from './social.js';
import { retainedProofIntegrityError } from './proof-retention.js';
import { ozarkWaterSource } from './ozark-water-sources.js';

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

function observationReachable(point, observedAt, agentId, position, elapsed,
  geometry, held = false) {
  const spawn = geometry.agentSpawns[agentId];
  const maximumSpeed = CONFIG.walkSpeed * CONFIG.sprintMultiplier +
    OZARK_WORLD_PROFILE.currentMaxSpeed;
  // Ozark recovery can make at most one swept relocation of 500px per
  // completed rescue delay. This generous cone does not certify a route; it
  // only rules out observations physically unreachable from the fixed spawn.
  const rescueDelay = simulationSeconds(BIOLOGY_RULES.rescueDelayGameHours);
  const possibleRescues = Math.floor(observedAt / rescueDelay);
  const reach = NPC_RULES.visionRadius + observedAt * maximumSpeed +
    possibleRescues * 500 + 1e-6;
  return finite(point?.x, geometry.bounds.minX, geometry.bounds.maxX) &&
    finite(point?.y, geometry.bounds.minY, geometry.bounds.maxY) &&
    Math.hypot(point.x - spawn.x, point.y - spawn.y) <= reach &&
    (observedAt !== 0 || geometry.lineOfSight(spawn, point)) &&
    (observedAt !== elapsed || held ||
      Math.hypot(point.x - position.x, point.y - position.y) <=
        NPC_RULES.visionRadius && geometry.lineOfSight(position, point));
}

function ozarkCellValid(key, cell, elapsed, geometry, agentId, position) {
  if (!plain(cell) || !/^-?\d{1,3},-?\d{1,3}$/.test(key)) return false;
  const [col, row] = key.split(',').map(Number);
  const x = col * NPC_RULES.tileSize, y = row * NPC_RULES.tileSize;
  if (cell.key !== key || cell.x !== x || cell.y !== y ||
      cell.scene !== undefined && cell.scene !== 'valley' ||
      !finite(cell.observedAt, 0, elapsed) ||
      !Number.isInteger(cell.visits) || cell.visits < 0 ||
      !finite(x, geometry.bounds.minX, geometry.bounds.maxX) ||
      !finite(y, geometry.bounds.minY, geometry.bounds.maxY)) return false;
  if (cell.observedAt === 0) {
    if (!observationReachable({ x, y }, 0, agentId, position, elapsed,
      geometry))
      return false;
  }
  if (cell.observedAt > 0 && !observationReachable({ x, y },
    cell.observedAt, agentId, position, elapsed, geometry)) return false;
  let visible;
  try { visible = geometry.sample(x, y); } catch { return false; }
  const terrain = visible.paint === 'surface-water' ? 'surface-water' :
    visible.paint === 'internal-pond' ? 'internal-pond' :
    visible.paint === 'divide' ? 'visible-divide' : 'dry-ground';
  return cell.terrain === terrain && cell.walkable ===
    (terrain !== 'internal-pond');
}

function ozarkEdgeValid(key, edge, elapsed, geometry) {
  if (!plain(edge) || !/^-?\d{1,3},-?\d{1,3}>-?\d{1,3},-?\d{1,3}$/.test(key) ||
      !finite(edge.observedAt, 0, elapsed) ||
      !finite(edge.retryAfter, 0, elapsed + 60)) return false;
  const [from, to] = key.split('>');
  // Movement records a failed snap to the current tile center as a self-edge;
  // navigation consumes that evidence. Preserve the producer's sorted order.
  if (from > to) return false;
  return [from, to].every(part => {
    const [col, row] = part.split(',').map(Number);
    return finite(col * NPC_RULES.tileSize, geometry.bounds.minX,
      geometry.bounds.maxX) &&
      finite(row * NPC_RULES.tileSize, geometry.bounds.minY,
        geometry.bounds.maxY);
  });
}

function ozarkDiscoveryTimeValid(discovery, elapsed, geometry, agentId,
  position, heldItems) {
  return plain(discovery) && plain(discovery.observations) &&
    Object.values(discovery.observations).every(object =>
      finite(object?.observedAt, 0, elapsed) &&
      object.scene === 'valley' &&
      finite(object.position?.x, geometry.bounds.minX, geometry.bounds.maxX) &&
      finite(object.position?.y, geometry.bounds.minY, geometry.bounds.maxY) &&
      observationReachable(object.position, object.observedAt,
        agentId, position, elapsed, geometry,
        heldItems?.includes(object.id))) &&
    Array.isArray(discovery.reports) && discovery.reports.every(report =>
      finite(report?.at, 0, elapsed)) &&
    Array.isArray(discovery.techniques) && discovery.techniques.every(technique =>
      finite(technique?.at, 0, elapsed)) &&
    plain(discovery.trials) && Object.values(discovery.trials).every(trial =>
      finite(trial?.lastAt, 0, elapsed)) &&
    plain(discovery.samplesPending) &&
    Object.values(discovery.samplesPending).every(at => finite(at, 0, elapsed)) &&
    finite(discovery.lastAttemptAt, 0, elapsed) &&
    finite(discovery.lastDialogueAt, -60, elapsed) &&
    finite(discovery.search?.startedAt, 0, elapsed) &&
    (discovery.run === null || finite(discovery.run?.startedAt, 0, elapsed));
}

function checkActor(raw, id, worldElapsed, geometry, restoring) {
  const timedRows = [raw?.memory?.experience, raw?.discovery?.experiments,
    raw?.discovery?.effects, raw?.physiology?.stomach,
    raw?.physiology?.feedback];
  const sources = raw?.memory?.sources;
  const memory = raw?.memory;
  if (!plain(raw) || raw.id !== id || raw.version !== 4 ||
      raw.mode !== 'discovery' || raw.scene !== 'valley' ||
      raw.elapsed !== worldElapsed ||
      !occupiable(geometry, raw.position) ||
      timedRows.some(rows => !Array.isArray(rows) ||
        rows.some(row => !finite(row?.at, 0, raw.elapsed))) ||
      !ozarkDiscoveryTimeValid(raw.discovery, raw.elapsed, geometry, id,
        raw.position, raw.inventory?.items) ||
      raw.proofRetentionError || retainedProofIntegrityError(raw)) {
    fail(`${id} has invalid identity, position, time, or evidence`);
  }
  if (!plain(sources) || Object.keys(sources).length > NPC_RULES.maxSources ||
      Object.entries(sources).some(([key, source]) =>
        !plain(source) || source.id !== key || source.kind !== 'water' ||
        source.scene !== 'valley' || source.confidence !== 'observed' ||
        !finite(source.x, geometry.bounds.minX, geometry.bounds.maxX) ||
        !finite(source.y, geometry.bounds.minY, geometry.bounds.maxY) ||
        !finite(source.observedAt, 0, raw.elapsed) ||
        !finite(source.retryAfter, 0, raw.elapsed + 60) ||
        !observationReachable(source, source.observedAt, id,
          raw.position, raw.elapsed, geometry))) {
    fail(`${id} has invalid Ozark water-source memory`);
  }
  if (!plain(memory?.cells) ||
      Object.keys(memory.cells).length > NPC_RULES.maxCells ||
      Object.entries(memory.cells).some(([key, cell]) =>
        !ozarkCellValid(key, cell, raw.elapsed, geometry, id, raw.position)) ||
      !plain(memory.blockedEdges) ||
      Object.keys(memory.blockedEdges).length > 512 ||
      Object.entries(memory.blockedEdges).some(([key, edge]) =>
        !ozarkEdgeValid(key, edge, raw.elapsed, geometry)) ||
      ['foods', 'shelters', 'caveCells', 'caveEdges', 'caveExits'].some(field =>
        !plain(memory[field]) || Reflect.ownKeys(memory[field]).length !== 0)) {
    fail(`${id} has invalid Ozark terrain or legacy-site memory`);
  }
  const canStandAt = (x, y, scene) => scene === 'valley' &&
    occupiable(geometry, { x, y });
  // Inspect the canonical disk form before restart can append its one explicit
  // interrupted-action receipt. No original sample, action or effect may be
  // silently sliced, repaired, or replaced by feedback from a separate queue.
  const waterSourceAt = id => ozarkWaterSource(id, geometry);
  const canonical = validateNpc(raw, { restoring: false, canStandAt,
    waterSourceAt });
  if (canonical.scene !== 'valley' || !sameExact(canonical.position, raw.position) ||
      !sameExact(canonical.memory.sources, raw.memory.sources) ||
      !sameExact(canonical.memory.blockedEdges, raw.memory.blockedEdges) ||
      !actorEvidenceExact(raw, canonical) || retainedProofIntegrityError(canonical)) {
    fail(`${id} would lose physical or learned evidence during validation`);
  }
  if (!restoring) return canonical;
  const resumed = validateNpc(raw, { restoring: true, canStandAt,
    waterSourceAt });
  if (resumed.scene !== 'valley' || !sameExact(resumed.position, raw.position) ||
      !sameExact(resumed.memory.sources, raw.memory.sources) ||
      !sameExact(resumed.memory.blockedEdges, raw.memory.blockedEdges) ||
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
