/** Evaluator-only public-context policy. No world, actor, ecology or biology imports. */
import { temporalContext, temporalKey } from '../../src/temporal-returns.js';

export const FINITE_POLICY = Object.freeze({ version: 1, epsilon: .2, focusSeconds: 30, focusChoices: 8 });
const proposals = new WeakMap();
const id = value => typeof value === 'string' && /^object:\d{1,9}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const copy = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const work = r => r.outcome?.workedSeconds ?? r.outcome?.durationSeconds ?? 0;
const acquisition = r => r.outcome?.ok && ['pull', 'grasp'].includes(r.request.type);
function latestAcquisition(memory, targetId, beforeSeq = Infinity) {
  return memory.receipts.filter(r => r.seq < beforeSeq && acquisition(r) &&
    (r.outcome.materialId === targetId || r.request.type === 'grasp' && r.request.targetId === targetId)).at(-1) || null;
}
function outcomeClass(receipt) {
  if (!receipt.outcome) return 'unknown';
  if (receipt.outcome.ok) return 'success';
  if (['PRIORITY_CHANGED', 'CONTACT_ESCAPE', 'COLLAPSED', 'RESTART_INTERRUPTED', 'REST_INTERRUPTED'].includes(receipt.outcome.code)) return 'canceled';
  return work(receipt) > 0 ? 'physical failure' : 'refused';
}
const band = n => n < 2 ? String(n) : n < 4 ? '2..3' : n < 8 ? '4..7' : n < 16 ? '8..15' : '16+';
const ageBand = age => age < 45 ? '<45' : age < 180 ? '45..180' : age < 600 ? '180..600' : '>600';
function transferProof(memory, focus) {
  if (!focus?.proofSeq) return null;
  const proof = memory.receipts.find(r => r.seq === focus.proofSeq && acquisition(r) &&
    r.request.targetId === focus.parentId && r.outcome.materialId === focus.objectId && focus.parentId !== focus.objectId);
  if (!proof || latestAcquisition(memory, focus.objectId) !== proof || memory.receipts.some(r =>
    r.seq > proof.seq && r.outcome?.ok && r.request.type === 'release' && r.request.targetId === focus.objectId)) return null;
  return proof;
}
function observedNear(view, objectId) {
  const object = view.objects.find(o => o.id === objectId);
  return object && (view.held.includes(objectId) || object.scene === view.scene &&
    view.at - object.observedAt < 8 && distance(view.position, object.position) <= view.reach);
}
function currentFocus(view, memory, focus) {
  if (!focus || view.at - focus.startedAt >= FINITE_POLICY.focusSeconds || focus.used >= FINITE_POLICY.focusChoices ||
    !observedNear(view, focus.objectId) || focus.proofSeq && !transferProof(memory, focus)) return null;
  return copy(focus);
}
/** Relational prediction context; coordinates/opaque IDs never enter its key. */
export function finiteChoiceContext(view, memory, candidate, focus = null) {
  const targetId = candidate.action.targetId || candidate.bindingId || null;
  const object = targetId ? view.objects.find(o => o.id === targetId) : null;
  const acquired = targetId ? latestAcquisition(memory, targetId) : null;
  const producing = acquired && acquired.outcome.materialId === targetId && acquired.request.targetId !== targetId ? acquired : null;
  const relevant = targetId ? memory.receipts.filter(r => r.outcome &&
    (r.request.targetId === targetId || r === producing)) : [];
  const exposures = memory.ingestions.slice(-24).map(i => {
    const prior = latestAcquisition(memory, i.objectId, i.seq);
    const producedByTarget = prior?.request.targetId === targetId && prior.outcome.materialId === i.objectId && targetId !== i.objectId;
    return { scope: targetId && (i.objectId === targetId || producedByTarget) ? 'own' : 'other',
      age: ageBand(view.at - i.at), channels: i.channels, count: 1 };
  });
  const transferred = focus?.objectId === targetId && Boolean(transferProof(memory, focus));
  return temporalContext({
    body: view.body, warmth: view.senses.warmth, shelter: view.senses.shelter,
    appearance: object ? { ...object.appearance, ...(object.motion === undefined ? {} : { motion: object.motion }) } : {},
    relation: candidate.action.type === 'move' ? 'route' : targetId ? view.held.includes(targetId) ? 'held' : 'reach' : undefined,
    focus: Boolean(targetId && focus?.objectId === targetId), outputOfFocus: transferred,
    heldCount: view.held.length,
    countBand: Number.isFinite(object?.count) ? object.count <= 0 ? '0' : object.count === 1 ? '1' : '2+' : undefined,
    history: relevant.slice(-2).map(r => ({ operation: r.request.type, outcome: outcomeClass(r) })),
    workBand: band(relevant.filter(r => work(r) > 0).length), exposures,
    historyCensored: memory.historyCensored || memory.model.historyCensored || memory.ingestions.length > 24,
  });
}
export function createFiniteSelector(seed = 1729) {
  if (!integer(seed) || seed > 0xffffffff) throw new TypeError('Invalid selector seed');
  return { version: 1, rng: seed, choices: 0, focus: null };
}
export function validateFiniteSelector(raw, view, memory) {
  if (raw?.version !== 1 || !integer(raw.rng) || raw.rng > 0xffffffff || !integer(raw.choices) || raw.choices > 1e9 ||
    !Object.hasOwn(raw, 'focus')) throw new TypeError('Invalid finite selector state');
  let focus = null;
  if (raw.focus !== null) {
    const f = raw.focus;
    if (!id(f.objectId) || !Number.isFinite(f.startedAt) || f.startedAt < 0 || f.startedAt > view.at ||
      !integer(f.used) || f.used > FINITE_POLICY.focusChoices ||
      (f.parentId !== undefined || f.proofSeq !== undefined) && (!id(f.parentId) || !integer(f.proofSeq) || f.proofSeq < 1)) throw new TypeError('Invalid finite focus');
    focus = { objectId: f.objectId, startedAt: f.startedAt, used: f.used,
      ...(f.proofSeq ? { parentId: f.parentId, proofSeq: f.proofSeq } : {}) };
    if (focus.proofSeq && !transferProof(memory, focus)) throw new TypeError('Unproved finite focus');
  }
  return { version: 1, rng: raw.rng, choices: raw.choices, focus };
}
function utility(q, body) {
  const food = body.hunger === 'content' ? .5 : body.hunger === 'peckish' ? 1 : 2;
  const water = body.thirst === 'quenched' ? .5 : body.thirst === 'dry mouth' ? 1 : 2;
  return food * q[0] + water * q[1] - 4 * q[2] - .02 * q[3] - .02 * q[4];
}
const selectorSignature = state => JSON.stringify(state);
/** Pure preview of an immutable actual opportunity set. Four draws are committed later. */
export function proposeFiniteChoice(view, memory, selector, opportunity) {
  if (!Array.isArray(opportunity?.choices) || !opportunity.choices.length || opportunity.at !== view.at || selector.choices >= 1e9) throw new TypeError('Invalid finite opportunity');
  let rng = selector.rng; const draws = Array.from({ length: 4 }, () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; });
  let focus = currentFocus(view, memory, selector.focus);
  if (!focus) {
    const eligible = view.objects.filter(o => observedNear(view, o.id));
    if (eligible.length) focus = { objectId: eligible[Math.floor(draws[0] * eligible.length)].id, startedAt: view.at, used: 0 };
  }
  const index = new Map(memory.model.rows.map(row => [row.key, row]));
  const scored = opportunity.choices.map((candidate, i) => {
    const context = finiteChoiceContext(view, memory, candidate, focus), key = temporalKey(context, candidate.action.type), row = index.get(key);
    const q = row ? [...row.q] : [0, 0, 0, 0, 0];
    return { index: i, action: copy(candidate.action), context, key, q, known: Boolean(row?.visits > 0),
      visits: row?.visits || 0, utility: utility(q, view.body), focus: context.focus || context.outputOfFocus };
  });
  const known = scored.filter(row => row.known), exploring = draws[1] < FINITE_POLICY.epsilon || known.length === 0;
  let selected;
  if (exploring) {
    const groups = new Map(); for (const row of scored) { if (!groups.has(row.action.type)) groups.set(row.action.type, []); groups.get(row.action.type).push(row); }
    const group = [...groups.values()][Math.floor(draws[2] * groups.size)]; selected = group[Math.floor(draws[3] * group.length)];
  } else {
    const best = Math.max(...known.map(row => row.utility)); let ties = known.filter(row => row.utility === best);
    if (ties.some(row => row.focus)) ties = ties.filter(row => row.focus);
    selected = ties[Math.floor(draws[2] * ties.length)];
  }
  if (focus) focus.used++;
  const next = { version: 1, rng, choices: selector.choices + 1, focus };
  const proposal = freeze({ at: view.at, nextSeq: memory.nextSeq, selected, exploring,
    candidates: scored.map(({ action, key, utility, known, visits }) => ({ action, key, utility, known, visits })) });
  proposals.set(proposal, { selector, signature: selectorSignature(selector), next, used: false });
  return proposal;
}
/** Called only after a real accepted submission or authoritative immediate outcome. */
export function commitFiniteChoice(selector, proposal) {
  const held = proposals.get(proposal);
  if (!held || held.used || held.selector !== selector || held.signature !== selectorSignature(selector)) throw new Error('Stale or duplicate finite proposal');
  held.used = true; Object.assign(selector, copy(held.next));
}
export function interruptFiniteFocus(selector) { selector.focus = null; }
/** Completion changes working focus, never reward or an operation recipe. */
export function completeFiniteFocus(selector, receipt, view) {
  const focus = selector.focus; if (!focus || receipt.request.targetId !== focus.objectId) return;
  if (receipt.outcome?.ok && receipt.request.type === 'release') { selector.focus = null; return; }
  if (acquisition(receipt) && id(receipt.outcome.materialId) && receipt.outcome.materialId !== receipt.request.targetId &&
    view.objects.some(o => o.id === receipt.outcome.materialId)) {
    selector.focus = { ...focus, objectId: receipt.outcome.materialId, parentId: receipt.request.targetId, proofSeq: receipt.seq };
  } else if (receipt.outcome?.ok && receipt.request.type === 'grasp') {
    selector.focus = { objectId: focus.objectId, startedAt: focus.startedAt, used: focus.used };
  } else if (receipt.outcome?.ok && receipt.request.type === 'sample' && !view.held.includes(focus.objectId)) selector.focus = null;
}
