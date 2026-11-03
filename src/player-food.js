import { exertPhysiology, ingestMaterial, isSleeping } from './biology.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { ECOLOGY_RULES } from './ecology-config.js';
import { publishConsumption } from './consumption-events.js';
import { consumeEcologyMaterial, describeEcologyObject, interactEcologyObject,
  lookupEcologyObject, senseEcology } from './ecology.js';
import { npcEffortCost } from './npc-effort-funding.js';

const TYPES = new Set(['pull', 'grasp', 'sample', 'release']);
const FRUITS = new Set(['apple', 'berry']);
const PLANTS = new Set(['apple_tree', 'bramble']);
const OBJECT_ID = /^object:[1-9][0-9]{0,8}$/;
const DEADLINE_SECONDS = 10;
const EPSILON = 1e-8;
const point = value => value && Number.isFinite(value.x) && Number.isFinite(value.y);
const samePoint = (a, b) => point(a) && point(b) &&
  Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** One avatar's physical hand and gut. The closure alone owns action authority. */
export function createPlayerFoodController(state, geometry) {
  if (!state?.playerFood || state.playerFood.version !== 1 ||
      !Array.isArray(state.playerFood.inventory?.items) ||
      state.playerFood.physiology?.profile !== 'human' ||
      typeof geometry?.lineOfSight !== 'function')
    throw new TypeError('Player food state and world geometry are required');

  const food = state.playerFood;
  const inventory = food.inventory;
  const physiology = food.physiology;
  const body = state.playerBody;
  const ecology = state.environment?.ecology;
  if (!ecology) throw new TypeError('Player ecology is required');
  let active = null;
  let disposed = false;

  const ownerValid = () => !disposed && state.playerFood === food &&
    state.environment?.ecology === ecology && state.playerBody === body &&
    food.inventory === inventory &&
    food.physiology === physiology && Array.isArray(inventory.items) &&
    inventory.items.length <= DISCOVERY_RULES.capacity &&
    new Set(inventory.items).size === inventory.items.length &&
    inventory.items.every(id => OBJECT_ID.test(id));
  const actor = () => ({id: 'player', species: 'human', lifecycle: 'AWAKE',
    scene: 'valley', position: { ...state.player }, elapsed: state.elapsed,
    physiology});
  const syncBody = () => {
    if (state.playerBody) {
      state.playerBody.stamina = physiology.stamina;
      state.playerBody.health = physiology.health;
    }
  };
  const conscious = () => state.scene === 'valley' && point(state.player) &&
    state.playerBody?.health > 0 && physiology.health > 0 &&
    !isSleeping({physiology});
  const seen = object => point(object?.position) &&
    distance(state.player, object.position) <= DISCOVERY_RULES.reach + EPSILON &&
    geometry.lineOfSight(state.player, object.position) === true;

  function check(type, targetId, original = null) {
    if (!ownerValid()) return {ok: false, code: 'OWNER_CHANGED'};
    if (!TYPES.has(type) || typeof targetId !== 'string' || !OBJECT_ID.test(targetId))
      return {ok: false, code: 'INVALID_ACTION'};
    if (!conscious()) return {ok: false, code: 'UNAVAILABLE'};
    const object = lookupEcologyObject(ecology, targetId);
    if (!object || original && object !== original)
      return {ok: false, code: 'OBJECT_GONE'};
    if (object.scene !== 'valley') return {ok: false, code: 'OTHER_SCENE'};
    const held = inventory.items.includes(targetId);
    if (type === 'sample' || type === 'release') {
      if (!held || object.heldBy !== 'player' || object.kind !== 'material' ||
          !FRUITS.has(object.materialType)) return {ok: false, code: 'NOT_HELD'};
    } else {
      if (object.heldBy) return {ok: false, code: 'HELD_BY_ANOTHER'};
      if (!seen(object)) return {ok: false, code: 'OUT_OF_REACH_OR_SIGHT'};
      if (inventory.items.length >= DISCOVERY_RULES.capacity)
        return {ok: false, code: 'HANDS_FULL'};
      if (type === 'pull') {
        if (!PLANTS.has(object.kind) || object.lifecycleStage === 'juvenile' ||
            object.stage !== 'ripe' || !(object.quantity > 0))
          return {ok: false, code: 'NO_RIPE_FRUIT'};
        // The engine's finite material allocation can fail after a plant is
        // decremented. Preflight that capacity here so refusal costs no fruit.
        if (ecology.materials.length >= ECOLOGY_RULES.maxMaterials ||
            !Number.isSafeInteger(ecology.nextId) || ecology.nextId >= 1e9)
          return {ok: false, code: 'MATERIAL_LIMIT'};
      } else if (type === 'grasp' && (object.kind !== 'material' ||
          !FRUITS.has(object.materialType)))
        return {ok: false, code: 'NOT_LOOSE_FRUIT'};
    }
    return {ok: true, code: 'READY', object};
  }

  function visibleOptions() {
    if (!ownerValid() || !conscious()) return [];
    const options = [];
    for (const view of senseEcology(ecology, state.player, 'valley', DISCOVERY_RULES.reach)) {
      const object = lookupEcologyObject(ecology, view.id);
      const type = PLANTS.has(object?.kind) ? 'pull' : 'grasp';
      if (!check(type, view.id).ok) continue;
      options.push({targetId: view.id, appearance: {...view.appearance}, held: false,
        distance: distance(state.player, view.position), actions: [type]});
    }
    for (const id of inventory.items) {
      const object = lookupEcologyObject(ecology, id);
      if (!object || !check('sample', id).ok) continue;
      const view = describeEcologyObject(ecology, id, {actorId: 'player'});
      if (view) options.push({targetId: id, appearance: {...view.appearance}, held: true,
        distance: 0, actions: ['sample', 'release']});
    }
    return options.sort((a, b) => a.distance - b.distance ||
      a.targetId.localeCompare(b.targetId));
  }

  function start(type, targetId) {
    if (active) return {ok: false, code: 'ACTION_BUSY'};
    const eligibility = check(type, targetId);
    if (!eligibility.ok) return {ok: false, code: eligibility.code};
    if (!Number.isFinite(state.elapsed) || state.elapsed < 0)
      return {ok: false, code: 'INVALID_TIME'};
    const seconds = DISCOVERY_RULES.durations[type];
    active = {type, targetId, object: eligibility.object, position: {...state.player},
      targetPosition:{...eligibility.object.position},
      startedAt: state.elapsed, lastAt: state.elapsed,
      expiresAt: state.elapsed + DEADLINE_SECONDS, seconds,
      effort: DISCOVERY_RULES.effort[type], worked: 0, paidKcal: 0};
    return {ok: true, code: 'ACTION_STARTED', type, targetId, seconds};
  }

  function terminal(ok, code, extra = {}) {
    const work = active;
    if (!work) return null;
    active = null; // No callback, exception or repeated tick can replay authority.
    return {ok, code, type: work.type, targetId: work.targetId,
      durationSeconds: work.worked, paidKcal: work.paidKcal, ...extra};
  }

  function moveHeld() {
    if (!ownerValid() || !point(state.player)) return;
    for (const id of inventory.items) {
      const object = lookupEcologyObject(ecology, id);
      if (object?.heldBy === 'player') object.position = {...state.player};
    }
  }

  // Call after ecology advances: decay/removal must not leave a phantom item
  // in the player's finite hand. This checks existing physical state only.
  function reconcileHeld() {
    if (!ownerValid()) return active ? terminal(false, 'ACTION_INTERRUPTED') : null;
    inventory.items = inventory.items.filter(id =>
      lookupEcologyObject(ecology, id)?.heldBy === 'player');
    if (active) {
      const object = lookupEcologyObject(ecology, active.targetId);
      if (!object || object !== active.object) return terminal(false, 'OBJECT_GONE');
      if (['sample', 'release'].includes(active.type) &&
          !inventory.items.includes(active.targetId))
        return terminal(false, 'NOT_HELD');
    }
    return null;
  }

  function complete() {
    const work = active;
    const eligibility = check(work.type, work.targetId, work.object);
    if (!eligibility.ok) return terminal(false, eligibility.code);
    // Completion retires before any transfer or synchronous observer callback.
    active = null;
    let result;
    if (work.type === 'sample') {
      const source = describeEcologyObject(ecology, work.targetId, {actorId: 'player'});
      if (source) source.position = {...state.player};
      const fraction = Math.min(1, DISCOVERY_RULES.sampleGrams /
        Math.max(.001, eligibility.object.massGrams || 0));
      result = consumeEcologyMaterial(ecology, work.targetId, fraction, {
        actorId: 'player', accept: portion => ingestMaterial(actor(), portion,
          {objectId: work.targetId, provenance: 'sampled', at: state.elapsed}),
      });
      syncBody();
      if (result.ok && result.ingestion?.ok === true)
        publishConsumption(ecology, actor(), source);
    } else {
      result = interactEcologyObject(ecology, work.targetId, work.type, {
        actorId: 'player', position: {...state.player}, scene: 'valley',
        inventory: inventory.items,
      });
      if (result.ok && ['pull', 'grasp'].includes(work.type)) {
        const id = result.materialId || work.targetId;
        if (!inventory.items.includes(id)) inventory.items.push(id);
      }
      if (result.ok && work.type === 'release')
        inventory.items = inventory.items.filter(id => id !== work.targetId);
    }
    inventory.items = inventory.items.filter(id =>
      lookupEcologyObject(ecology, id)?.heldBy === 'player');
    return {ok: result?.ok === true, code: result?.code || 'ACTION_FAILED',
      type: work.type, targetId: work.targetId,
      durationSeconds: work.worked, paidKcal: work.paidKcal,
      ...(result?.materialId ? {materialId: result.materialId} : {}),
      ...(result?.ingestion?.ingestionId ? {ingestionId: result.ingestion.ingestionId} : {})};
  }

  function tick(dt) {
    moveHeld();
    if (!active) return null;
    if (!ownerValid() || !conscious() || !samePoint(state.player, active.position))
      return terminal(false, 'ACTION_INTERRUPTED');
    const eligibility = check(active.type, active.targetId, active.object);
    if (!eligibility.ok) return terminal(false, eligibility.code);
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(state.elapsed) ||
        state.elapsed < active.lastAt - EPSILON)
      return terminal(false, 'INVALID_TIME');
    if (state.elapsed > active.expiresAt + EPSILON)
      return terminal(false, 'ACTION_TIMEOUT');
    const interval = Math.min(dt, Math.max(0, state.elapsed - active.lastAt));
    // A delayed callback cannot pay for time that elapsed after the deadline.
    const sliceStart = Math.max(active.lastAt, state.elapsed - interval);
    active.lastAt = state.elapsed;
    const available = Math.max(0, Math.min(interval,
      active.expiresAt - sliceStart, active.seconds - active.worked));
    if (available > 0) {
      const cost = npcEffortCost(available, active.effort);
      const before = physiology.availableEnergyKcal;
      const total = physiology.totals.metabolizedKcal;
      if (cost > 0 && Number.isFinite(before) && before > 0) {
        const funded = available * Math.min(1, before / cost);
        const expected = npcEffortCost(funded, active.effort);
        exertPhysiology(actor(), funded, active.effort);
        syncBody();
        const debit = before - physiology.availableEnergyKcal;
        const ledger = physiology.totals.metabolizedKcal - total;
        if (Number.isFinite(debit) && Number.isFinite(ledger) && debit > 0 &&
            Math.abs(debit - expected) <= Math.min(1e-8, expected * 1e-7) &&
            Math.abs(ledger - expected) <= Math.min(1e-8, expected * 1e-7)) {
          active.worked += funded;
          active.paidKcal += debit;
        } else return terminal(false, 'WORK_NOT_CERTIFIED');
      }
    }
    if (active.worked + EPSILON >= active.seconds) return complete();
    if (state.elapsed + EPSILON >= active.expiresAt)
      return terminal(false, 'ACTION_TIMEOUT');
    return null;
  }

  function cancel(reason = 'ACTION_INTERRUPTED') {
    return terminal(false, reason === 'ACTION_TIMEOUT' ? reason : 'ACTION_INTERRUPTED');
  }
  function dispose() {
    const result = cancel();
    disposed = true;
    return result;
  }
  function snapshot() {
    return {active: active ? {type: active.type, targetId: active.targetId,
      worked: active.worked, seconds: active.seconds, startedAt: active.startedAt,
      expiresAt: active.expiresAt} : null,
    held: ownerValid() ? [...inventory.items] : []};
  }
  // Read-only public motor geometry. The paid source binding stays private to
  // this actuator; neither renderer nor observer receives its target ID.
  function publicPose() {
    if (!active || active.type !== 'pull' || !(active.worked > 0) ||
        !(active.paidKcal > 0) || active.lastAt !== state.elapsed ||
        state.elapsed > active.expiresAt + EPSILON || !ownerValid() ||
        !conscious() || !samePoint(state.player, active.position) ||
        !samePoint(active.object.position, active.targetPosition) ||
        !check('pull', active.targetId, active.object).ok) return null;
    return {scene:'valley', origin:{...active.position},
      tip:{...active.targetPosition}, progress:Math.min(1, active.worked / active.seconds)};
  }
  return {visibleOptions, start, tick, reconcileHeld, cancel, dispose, snapshot, publicPose};
}
