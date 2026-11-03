// One public projection for the player's visible hand. The renderer and each
// actor's local sight read these same physical items; neither reads a pull
// result, parent source, nutrition, or the player's private action target.
import { DISCOVERY_RULES } from './discovery-config.js';
import { NPC_RULES } from './config.js';
import { describeEcologyObject, lookupEcologyObject } from './ecology.js';
import { isSleeping } from './biology.js';
import { actorLineOfSight } from './perception.js';

const EPSILON = 1e-8;
// This pose is a current sample, not proof of continuous sight across a pull.
// Bound terrain checks during the five-second paid action on laptop CPUs.
const SIGHT_STEP = 4;
const currentViews = new WeakMap();
const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const handPosition = (player, index) => ({x:player.x + 18 + index * 7,
  y:player.y - 29 + index * 7});
const relative = (observer, p) => ({dx:p.x - observer.position.x,
  dy:p.y - observer.position.y});
const visualAppearance = appearance => Object.fromEntries(
  ['shape','color','texture','details'].filter(key =>
    typeof appearance?.[key] === 'string').map(key => [key,appearance[key]]));
const sight = (observer, p) => distance(observer.position, p) <= NPC_RULES.visionRadius &&
  actorLineOfSight(observer, observer.position, p);
const copy = value => structuredClone(value);

/** Public sprite positions come only from an actual player-held fruit in the
 * finite inventory. An inconsistent hand is incomplete, never visible empty. */
export function playerHeldFoodProjection(state) {
  const player = state?.player, food = state?.playerFood,
    ecology = state?.environment?.ecology, items = food?.inventory?.items;
  if (state?.scene !== 'valley' || !point(player) || !ecology ||
      !Array.isArray(items) || items.length > DISCOVERY_RULES.capacity ||
      new Set(items).size !== items.length) return {complete:false, items:[]};
  const projected = [];
  for (const [index, id] of items.entries()) {
    const physical = lookupEcologyObject(ecology, id);
    const view = describeEcologyObject(ecology, id, {actorId:'player'});
    if (!physical || physical.heldBy !== 'player' || physical.kind !== 'material' ||
        !['apple', 'berry'].includes(physical.materialType) || !view)
      return {complete:false, items:[]};
    const position = handPosition(player, index);
    projected.push({id, position, appearance:visualAppearance(view.appearance),
      sprite:{id, kind:'material', materialType:physical.materialType,
        shape:view.appearance.shape, color:view.appearance.color,
        x:position.x, y:position.y, stage:physical.spoiled?'spoiled':'fresh', quantity:1}});
  }
  return {complete:true, items:projected};
}

/** Actor-local current sight, not a food lesson or target authority. A pose is
 * only numeric public geometry; held bindings originate in the same sprites
 * drawn for the player. Unknown sight cannot certify an empty hand or silence. */
export function sensePublicPlayerFood(observer, state, reach = null) {
  const at = state?.elapsed ?? null;
  const unknown = {at, visibility:'unknown', player:null,
    reach:{status:'unknown',geometry:null}, hand:{status:'unknown',items:[]}};
  const player = state?.player;
  if (!observer || observer.lifecycle !== 'AWAKE' || isSleeping(observer) ||
      observer.scene !== 'valley' || state?.scene !== 'valley' ||
      !point(observer.position) || !point(player) ||
      !Number.isFinite(at) || !sight(observer, player)) return unknown;
  const held = playerHeldFoodProjection(state);
  const handVisible = held.complete &&
    Array.from({length:DISCOVERY_RULES.capacity}, (_, i) => handPosition(player, i))
      .every(p => sight(observer, p));
  const hand = handVisible ? {status:'visible', items:held.items.map(item => ({
    id:item.id, position:relative(observer, item.position),
    appearance:{...item.appearance}}))} : {status:'unknown', items:[]};
  let pose = {status:'absent',geometry:null};
  if (reach !== null) {
    const length = point(reach?.origin) && point(reach?.tip) ?
      distance(reach.origin, reach.tip) : Infinity;
    if (reach?.scene !== 'valley' || !Number.isFinite(reach?.progress) ||
        reach.progress <= 0 || reach.progress > 1 ||
        length <= 0 || length > DISCOVERY_RULES.reach + EPSILON ||
        distance(reach.origin, player) > EPSILON) pose = {status:'unknown',geometry:null};
    else {
      const steps = Math.ceil(length / SIGHT_STEP);
      let visible = true;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (!sight(observer, {x:reach.origin.x + (reach.tip.x - reach.origin.x) * t,
          y:reach.origin.y + (reach.tip.y - reach.origin.y) * t})) {
          visible = false; break;
        }
      }
      pose = visible ? {status:'pose',geometry:{origin:relative(observer, reach.origin),
        tip:relative(observer, reach.tip),progress:reach.progress}} :
        {status:'unknown',geometry:null};
    }
  }
  return {at,visibility:'visible',player:relative(observer,player),reach:pose,hand};
}

/** One current sampled row per real individual. It is session-only and cannot
 * be replayed as an action permit or persisted with the world. */
export function recordPublicPlayerFood(observer, state, reach = null) {
  const sample = sensePublicPlayerFood(observer, state, reach);
  if (!observer || typeof observer !== 'object') return copy(sample);
  currentViews.set(observer, {state, epoch:observer.epoch,
    discovery:observer.discovery, sample});
  return copy(sample);
}
export function readPublicPlayerFood(observer) {
  const row = currentViews.get(observer);
  if (!row || !row.state?.agents?.includes(observer) ||
      observer.epoch !== row.epoch || observer.discovery !== row.discovery ||
      !Number.isFinite(observer.elapsed) ||
      Math.abs(observer.elapsed - row.sample.at) > EPSILON) return null;
  return copy(row.sample);
}
export function clearPublicPlayerFood(observer) { currentViews.delete(observer); }
