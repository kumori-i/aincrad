// One avatar-owned, physically paid utterance and point. The player's selected
// object stays inside actuator bookkeeping; each recipient must resolve the
// same public segment from its own complete view before receiving pixel input.
import { exertPhysiology, isSleeping } from './biology.js';
import { CONFIG } from './config.js';
import { lookupEcologyObject, senseEcology } from './ecology.js';
import { npcEffortCost } from './npc-effort-funding.js';
import { referenceGeometry } from './discovery-actions.js';
import { perceiveReferenceGeometry } from './visual-reference-perception.js';

export const PLAYER_LESSON_ACTION = Object.freeze({
  seconds: 1.8, effort: .25, deadline: 6, range: 400,
  visibleLimit: 12, observationSeconds: .5,
});
const WORD = /^[a-z]{1,6}$/;
const OBJECT_ID = /^object:[1-9][0-9]{0,8}$/;
const EPSILON = 1e-8;
const owners = new WeakSet();
const point = value => value && Number.isFinite(value.x) && Number.isFinite(value.y);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const samePoint = (a, b) => point(a) && point(b) && distance(a, b) <= EPSILON;

export function createPlayerLessonController({state, geometry, pixelSensor, getLineage, onLessons}) {
  if (!state?.playerFood?.physiology || !state.playerBody ||
      !state.environment?.ecology || typeof geometry?.lineOfSight !== 'function' ||
      typeof pixelSensor?.captureVisible !== 'function' ||
      typeof getLineage !== 'function' || typeof onLessons !== 'function' ||
      owners.has(state)) throw new TypeError('One bound player lesson controller is required');
  owners.add(state);
  const ecology = state.environment.ecology, food = state.playerFood;
  const physiology = food.physiology, body = state.playerBody;
  let active = null, disposed = false;

  const ownerValid = () => !disposed && state.environment?.ecology === ecology &&
    state.playerFood === food && food.physiology === physiology &&
    state.playerBody === body && physiology.profile === 'human';
  const conscious = () => state.scene === 'valley' && point(state.player) &&
    body.health > 0 && physiology.health > 0 && !isSleeping({physiology});
  const playerActor = () => ({id: 'player', species: 'human', lifecycle: 'AWAKE',
    scene: 'valley', position: {...state.player}, elapsed: state.elapsed, physiology});
  function targetCheck(targetId, original = null, position = null) {
    if (!ownerValid()) return {ok:false, code:'OWNER_CHANGED'};
    if (!conscious()) return {ok:false, code:'UNAVAILABLE'};
    if (typeof targetId !== 'string' || !OBJECT_ID.test(targetId))
      return {ok:false, code:'INVALID_TARGET'};
    const object = lookupEcologyObject(ecology, targetId);
    if (!object || original && object !== original || !point(object.position) ||
        position && !samePoint(object.position, position))
      return {ok:false, code:'TARGET_CHANGED'};
    if (object.heldBy || object.scene !== 'valley' ||
        distance(state.player, object.position) > PLAYER_LESSON_ACTION.range + EPSILON ||
        geometry.lineOfSight(state.player, object.position) !== true)
      return {ok:false, code:'TARGET_NOT_VISIBLE'};
    return {ok:true, code:'READY', object};
  }
  function lineage() {
    let raw;
    try { raw = getLineage(); } catch { return null; }
    if (typeof raw?.instanceId !== 'string' || !raw.instanceId ||
        !Array.isArray(raw.agents) || raw.agents.length !== 2 ||
        !Array.isArray(state.agents) || state.agents.length !== 2) return null;
    const rows = [];
    for (const actor of state.agents) {
      const row = raw.agents.find(value => value?.agentId === actor?.id);
      if (!['aster','mira'].includes(actor?.id) ||
          !Number.isInteger(row?.serial) || row.serial < 1 || row.serial > 0xffffffff ||
          rows.some(value => value.agentId === actor.id || value.serial === row.serial))
        return null;
      rows.push({agentId:actor.id, serial:row.serial});
    }
    return {instanceId:raw.instanceId, agents:rows};
  }
  const recipientCurrent = row => state.agents?.includes(row.actor) &&
    row.actor.id === row.agentId && row.actor.epoch === row.epoch &&
    row.actor.discovery === row.discovery && row.actor.physiology === row.physiology;
  function terminal(ok, code, records = []) {
    const work = active;
    if (!work) return null;
    active = null; // Retirement precedes any caller callback or reentry.
    let recipients = 0;
    if (ok && records.length) {
      const safe = Object.freeze(records.map(row => Object.freeze({
        agentId:row.agentId, serial:row.serial, word:work.word,
        features:Object.freeze(row.features.slice()),
      })));
      try { onLessons(safe); recipients = safe.length; }
      catch { code = 'POINT_COMPLETED_LESSON_REJECTED'; }
    }
    return {ok, code, word:work.word, durationSeconds:work.worked,
      paidKcal:work.paidKcal, recipients,
      censored:work.recipients.length - recipients};
  }
  function visibleOptions() {
    if (!ownerValid() || !conscious()) return [];
    return senseEcology(ecology, state.player, 'valley', PLAYER_LESSON_ACTION.range)
      .filter(row => targetCheck(row.id).ok)
      .map(row => ({targetId:row.id, appearance:{...row.appearance},
        distance:distance(state.player,row.position)}))
      .sort((a,b) => a.distance-b.distance || a.targetId.localeCompare(b.targetId))
      .slice(0, PLAYER_LESSON_ACTION.visibleLimit);
  }
  function start(word, targetId) {
    if (active) return {ok:false,code:'ACTION_BUSY'};
    if (typeof word !== 'string' || !WORD.test(word))
      return {ok:false,code:'INVALID_WORD'};
    const checked = targetCheck(targetId);
    if (!checked.ok) return {ok:false,code:checked.code};
    if (!visibleOptions().some(row => row.targetId === targetId))
      return {ok:false,code:'TARGET_NOT_IN_VIEW'};
    if (!Number.isFinite(state.elapsed) || state.elapsed < 0)
      return {ok:false,code:'INVALID_TIME'};
    const binding = lineage();
    if (!binding) return {ok:false,code:'LINEAGE_UNAVAILABLE'};
    const recipients = state.agents.map(actor => ({
      actor, agentId:actor.id, serial:binding.agents.find(row => row.agentId === actor.id).serial,
      epoch:actor.epoch, discovery:actor.discovery, physiology:actor.physiology,
      censored:false, observedSeconds:0, lastAt:null,
    }));
    active = {word, targetId, object:checked.object,
      targetPosition:{...checked.object.position}, position:{...state.player},
      playerRef:state.player,
      startedAt:state.elapsed, lastAt:state.elapsed,
      expiresAt:state.elapsed + PLAYER_LESSON_ACTION.deadline,
      worked:0, paidKcal:0, poseAt:null, pending:null,
      worldId:binding.instanceId, recipients};
    return {ok:true,code:'ACTION_STARTED',seconds:PLAYER_LESSON_ACTION.seconds};
  }
  function publicPose() {
    const work = active;
    if (!work || !(work.worked > 0) || work.poseAt !== state.elapsed ||
        state.player !== work.playerRef ||
        !samePoint(state.player, work.position) ||
        !targetCheck(work.targetId, work.object, work.targetPosition).ok) return null;
    return referenceGeometry(work.position, work.targetPosition, 'valley',
      Math.min(1, work.worked / PLAYER_LESSON_ACTION.seconds));
  }
  function tickPaid(dt) {
    const work = active;
    if (!work) return null;
    if (work.pending) return terminal(false, 'OBSERVATION_MISSING');
    if (!ownerValid() || !conscious() || state.player !== work.playerRef ||
        !samePoint(state.player, work.position))
      return terminal(false, 'ACTION_INTERRUPTED');
    const checked = targetCheck(work.targetId, work.object, work.targetPosition);
    if (!checked.ok) return terminal(false, checked.code);
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(state.elapsed) ||
        state.elapsed < work.lastAt - EPSILON)
      return terminal(false, 'INVALID_TIME');
    if (state.elapsed > work.expiresAt + EPSILON)
      return terminal(false, 'ACTION_TIMEOUT');
    const interval = Math.min(dt, Math.max(0, state.elapsed - work.lastAt));
    const sliceStart = Math.max(work.lastAt, state.elapsed - interval);
    work.lastAt = state.elapsed;
    const available = Math.max(0, Math.min(interval,
      work.expiresAt - sliceStart, PLAYER_LESSON_ACTION.seconds - work.worked));
    let funded = 0;
    if (available > 0) {
      const cost = npcEffortCost(available, PLAYER_LESSON_ACTION.effort);
      const before = physiology.availableEnergyKcal;
      const total = physiology.totals.metabolizedKcal;
      if (cost > 0 && Number.isFinite(before) && before > 0) {
        funded = available * Math.min(1, before / cost);
        const expected = npcEffortCost(funded, PLAYER_LESSON_ACTION.effort);
        try { exertPhysiology(playerActor(), funded, PLAYER_LESSON_ACTION.effort); }
        catch { return terminal(false, 'WORK_NOT_CERTIFIED'); }
        body.health = physiology.health; body.stamina = physiology.stamina;
        const debit = before - physiology.availableEnergyKcal;
        const ledger = physiology.totals.metabolizedKcal - total;
        if (!(Number.isFinite(debit) && Number.isFinite(ledger) && debit > 0 &&
            Math.abs(debit-expected) <= Math.min(1e-8,expected*1e-7) &&
            Math.abs(ledger-expected) <= Math.min(1e-8,expected*1e-7)))
          return terminal(false, 'WORK_NOT_CERTIFIED');
        work.worked += funded; work.paidKcal += debit;
      }
    }
    work.poseAt = funded > 0 ? state.elapsed : null;
    work.pending = {at:state.elapsed, paidSeconds:funded, stepSeconds:dt};
    return null;
  }
  function observePaidStep() {
    const work = active, step = work?.pending;
    if (!step) return null;
    work.pending = null; // A second read cannot create a second observation.
    if (state.elapsed !== step.at || !ownerValid() || !conscious() ||
        state.player !== work.playerRef ||
        !samePoint(state.player, work.position) ||
        !targetCheck(work.targetId, work.object, work.targetPosition).ok)
      return terminal(false, 'ACTION_INTERRUPTED');
    const full = step.stepSeconds > 0 &&
      step.stepSeconds <= CONFIG.fixedStep + EPSILON &&
      Math.abs(step.stepSeconds - step.paidSeconds) <= EPSILON;
    const pose = full ? publicPose() : null;
    const sender = playerActor();
    for (const row of work.recipients) {
      if (row.censored) continue;
      if (!pose || !recipientCurrent(row) ||
          Math.abs(row.actor.elapsed-state.elapsed) > EPSILON ||
          row.lastAt === null &&
            Math.abs(state.elapsed-work.startedAt-step.stepSeconds) > EPSILON ||
          row.lastAt !== null && (state.elapsed <= row.lastAt ||
            Math.abs(state.elapsed-row.lastAt-step.stepSeconds) > EPSILON)) {
        row.censored = true; continue;
      }
      const seen = perceiveReferenceGeometry(row.actor, sender, pose, state);
      if (seen.reason !== 'resolved' || seen.objectId !== work.targetId ||
          seen.epoch !== row.epoch || Math.abs(seen.at-state.elapsed) > EPSILON) {
        row.censored = true; continue;
      }
      row.observedSeconds += step.paidSeconds;
      row.lastAt = state.elapsed;
    }
    if (work.worked + EPSILON < PLAYER_LESSON_ACTION.seconds) {
      if (state.elapsed + EPSILON >= work.expiresAt)
        return terminal(false, 'ACTION_TIMEOUT');
      return null;
    }
    const current = lineage();
    if (!current || current.instanceId !== work.worldId ||
        work.recipients.some(row => current.agents.find(value =>
          value.agentId === row.agentId)?.serial !== row.serial))
      return terminal(false, 'LINEAGE_CHANGED');
    const records = [];
    for (const row of work.recipients) {
      if (row.censored || !recipientCurrent(row) ||
          row.observedSeconds + EPSILON < PLAYER_LESSON_ACTION.observationSeconds) continue;
      let crop;
      try { crop = pixelSensor.captureVisible(row.actor, state, work.targetId); }
      catch { crop = null; }
      if (!crop || crop.epoch !== row.epoch || crop.at !== row.actor.elapsed ||
          !Array.isArray(crop.features) || crop.features.length !== 48 ||
          crop.features.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
          !Array.isArray(crop.pixels) || crop.pixels.length !== 768) continue;
      records.push({agentId:row.agentId, serial:row.serial,
        features:crop.features.slice()});
    }
    return terminal(true, records.length ? 'POINT_COMPLETED' : 'POINT_COMPLETED_UNSEEN', records);
  }
  function cancel() { return terminal(false, 'ACTION_INTERRUPTED'); }
  function dispose() {
    if (disposed) return;
    cancel(); disposed = true; owners.delete(state);
  }
  function snapshot() {
    const work = active;
    return {active:work ? {word:work.word, worked:work.worked,
      seconds:PLAYER_LESSON_ACTION.seconds, startedAt:work.startedAt,
      expiresAt:work.expiresAt} : null};
  }
  return {visibleOptions,start,tickPaid,observePaidStep,publicPose,cancel,dispose,snapshot};
}
