import { createNpc } from '../../../src/npc-state.js';

// Constructed contract evidence only. Nothing here is a native trajectory,
// executed ecology, learning claim, current availability or survival result.
export function contractActor() {
  const n = createNpc({ mode: 'discovery', seed: 74193 });
  n.elapsed = 100; n.nextDecisionAt = 100; n.discovery.lastDialogueAt = 100;
  const acquisition = { id: 1, at: 10, primitive: 'pull', targetId: 'object:1', ok: true,
    code: 'piece_detached', durationSeconds: 5, actionId: 1, materialId: 'object:2' };
  const sample = { id: 2, at: 15, primitive: 'sample', targetId: 'object:2', ok: true,
    code: 'SWALLOWED', durationSeconds: 3.5, actionId: 2, ingestionId: 'ingestion:1' };
  const effect = { id: 'feedback:1', at: 20, objectId: 'object:2', actionId: 2,
    ingestionId: 'ingestion:1', effect: 'sustained', hunger: 'easing', thirst: 'unchanged',
    energy: 'easing', pain: 'none', source: 'experienced', proofEventId: 3 };
  n.discovery.experiments = [acquisition, sample];
  n.discovery.effects = [effect];
  n.discovery.techniques = [{ id: 'technique:aster:1', sourceId: 'object:1',
    steps: [{ type: 'pull', targetId: '$source' }, { type: 'sample', targetId: '$material' }],
    evidence: [1, 2], effect: 'sustained', confidence: 'tentative', successes: 1, failures: 0, at: 25 }];
  n.discovery.nextId = 4;
  n.memory.experience = [actionReceipt(acquisition), actionReceipt(sample), recognition(effect, 3, 25),
    { id: 4, type: 'action', at: 40, details: { action: { type: 'rest', seconds: 2 }, result: { ok: true, code: 'RESTED', durationSeconds: 2 } } },
    { id: 5, type: 'action', at: 44, details: { action: { type: 'wait', seconds: 1 }, result: { ok: true, code: 'WAITED', durationSeconds: 1 } } }];
  n.memory.nextId = 6;
  n.inventory.items = ['object:2'];
  n.discovery.observations = Object.fromEntries([1, 2].map((v) => [`object:${v}`, {
    id: `object:${v}`, scene: 'valley', position: { x: n.position.x + 10, y: n.position.y },
    observedAt: v === 1 ? 7 : 16, count: 1, appearance: { shape: 'round', color: 'red' },
  }]));
  return n;
}
export function actionReceipt(e) {
  return { id: e.actionId, type: 'action', at: e.at, details: {
    action: { type: e.primitive, targetId: e.targetId },
    result: { ok: e.ok, code: e.code, durationSeconds: e.durationSeconds,
      ...(e.materialId ? { materialId: e.materialId } : {}), ...(e.ingestionId ? { ingestionId: e.ingestionId } : {}) },
  } };
}
export function recognition(effect, id, at = effect.at) {
  const feedback = { ...effect }; delete feedback.proofEventId;
  return { id, type: 'condition', at, details: { code: 'DISCOVERY_EFFECT', feedback } };
}
export function addSample(n, { effect = 'discomfort', ingestionId = 'ingestion:2', recognized = true } = {}) {
  const sample = { id: 3, at: 50, primitive: 'sample', targetId: 'object:2', ok: true,
    code: 'SWALLOWED', durationSeconds: 3, actionId: 6, ingestionId };
  n.discovery.experiments.push(sample); n.memory.experience.push(actionReceipt(sample));
  if (recognized) {
    const outcome = { id: 'feedback:2', at: 55, objectId: 'object:2', actionId: 6, ingestionId,
      effect, hunger: effect === 'sustained' ? 'easing' : 'unchanged', thirst: effect === 'water relief' ? 'easing' : 'unchanged',
      energy: effect === 'sustained' ? 'easing' : 'unchanged', pain: effect === 'discomfort' ? 'hurting' : 'none',
      source: 'experienced', proofEventId: 7 };
    n.discovery.effects.push(outcome); n.memory.experience.push(recognition(outcome, 7, 60));
  }
  n.memory.nextId = recognized ? 8 : 7; n.discovery.nextId = 5;
  return sample;
}
