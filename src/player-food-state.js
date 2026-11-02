import { createPhysiology, validatePhysiology } from './biology.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { gameHours } from './biology-config.js';

// This is only the avatar's finite hand and gut. Action authority and queued
// commands belong to the live controller, never to this durable state.
export const PLAYER_FOOD_VERSION = 1;
const MATERIAL_ID = /^object:[1-9][0-9]{0,8}$/;
const exactKeys = (value, keys) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
function sameExact(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' ||
      Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Reflect.ownKeys(a);
  return keys.length === Reflect.ownKeys(b).length &&
    keys.every(key => Object.hasOwn(b, key) && sameExact(a[key], b[key]));
}

export function createPlayerFoodState(elapsed = 0, body = { health: 100, stamina: 100 }) {
  const physiology = createPhysiology('human', {
    health: body.health, stamina: body.stamina,
  });
  // A migrated world has no authored avatar eating history. Align its clock
  // without inventing meals, nutritional evidence, or an earlier action.
  physiology.clockHours = gameHours(elapsed);
  return { version: PLAYER_FOOD_VERSION, inventory: { items: [] }, physiology };
}

export function validatePlayerFoodState(raw, elapsed = 0, body = null) {
  if (!exactKeys(raw, ['version', 'inventory', 'physiology']) ||
      raw.version !== PLAYER_FOOD_VERSION ||
      !exactKeys(raw.inventory, ['items']) ||
      !Array.isArray(raw.inventory.items) ||
      raw.inventory.items.length > DISCOVERY_RULES.capacity ||
      !raw.inventory.items.every(id => typeof id === 'string' && MATERIAL_ID.test(id)) ||
      new Set(raw.inventory.items).size !== raw.inventory.items.length ||
      !Number.isFinite(elapsed) || elapsed < 0 ||
      raw.physiology?.profile !== 'human' ||
      (body && (raw.physiology.health !== body.health ||
        raw.physiology.stamina !== body.stamina)) ||
      !Array.isArray(raw.physiology.stomach) ||
      !Array.isArray(raw.physiology.feedback) ||
      raw.physiology.stomach.some(row => !Number.isFinite(row?.at) || row.at > elapsed) ||
      raw.physiology.feedback.some(row => !Number.isFinite(row?.at) || row.at > elapsed)) return null;
  const physiology = validatePhysiology(raw.physiology, { profile: 'human', elapsed });
  // validatePhysiology is intentionally tolerant for old NPC records. Player
  // food is new, so any repair, truncation, extra field or nonfinite value is
  // a malformed current extension and must block the occupied save.
  if (!sameExact(raw.physiology, physiology)) return null;
  return { version: PLAYER_FOOD_VERSION,
    inventory: { items: [...raw.inventory.items] }, physiology };
}
