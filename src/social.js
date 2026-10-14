import { CAVES, CONFIG, SOCIAL_RULES } from './config.js';
import { lineOfSight } from './perception.js';
import { recordClaim } from './cognition.js';
import { bodySignals } from './interoception.js';
import { isSleeping } from './biology.js';
import { recordTechniqueReport, recordDiscoveryClaim } from './discovery.js';

const AGENT_IDS = new Set(['aster', 'mira']);
const SENDERS = new Set([...AGENT_IDS, 'human']);
const RECIPIENTS = new Set([...AGENT_IDS, 'all']);
const SCENES = new Set(['valley', ...CAVES.map(cave => cave.id)]);
const MAX_TIME = 3600 * 100000;
const finite = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(MAX_TIME, value)) : fallback;
const textValue = (value, length = SOCIAL_RULES.maxText) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, length) : '';
const token = (value, length = 80) => {
  const key = textValue(value, length).replace(/[^a-zA-Z0-9:_\-.]/g, '');
  return ['__proto__', 'prototype', 'constructor'].includes(key) ? '' : key;
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fingerprint = value => textValue(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nowFor = (npc, environment) => finite(environment?.elapsed, finite(npc?.elapsed));
const bounded = (values, count) => values.slice(-count);
const activityType = npc => npc?.active?.request?.type ?? npc?.active?.type;
const validEffectClaim=claim=>claim&&/^object:\d{1,9}$/.test(claim.objectId)&&['sustained','water relief','discomfort','no noticeable change'].includes(claim.effect)?{objectId:claim.objectId,effect:claim.effect,experienceId:token(claim.experienceId)}:null;
const aliveAndAwake = npc => npc?.lifecycle === 'AWAKE' && !isSleeping(npc) && !['sleep', 'rest', 'nap'].includes(activityType(npc));
const pointValid = (point, scene) => point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
  (scene === 'valley' ? Math.abs(point.x) < CONFIG.halfSize && Math.abs(point.y) < CONFIG.halfSize : point.x > 0 && point.y > 0 && point.x < 2500 && point.y < 2000);

/** Conversation is saved data. A message or claim never executes a world action. */
export function createCommunity() {
  return { version: 1, nextId: 1, messages: [], questions: {}, notes: [] };
}

export function createSocialMemory() {
  return {
    version: 1, relationships: {}, heard: [], lastSpokeAt: null, lastAskedAt: null,
    askedTopics: {}, conversationKeys: [], sharedClaims: [], pendingQuestionId: null,
    fulfillment: 0, lastUpdateAt: null, lastContactAt: null, lastJournalAt: null, repliedTo: [], journalSeen: [],
  };
}

function validMessage(raw) {
  if (!raw || !SENDERS.has(raw.senderId) || !RECIPIENTS.has(raw.recipientId) || !['peer', 'journal', 'note'].includes(raw.channel)) return null;
  if (raw.channel === 'peer' && (!AGENT_IDS.has(raw.senderId) || !AGENT_IDS.has(raw.recipientId) || raw.senderId === raw.recipientId)) return null;
  if (raw.senderId === 'human' && raw.channel !== 'journal') return null;
  if (raw.channel === 'note' && (raw.senderId === 'human' || raw.recipientId !== 'all')) return null;
  if (raw.channel === 'journal' && raw.senderId !== 'human' && raw.recipientId !== 'all') return null;
  const text = textValue(raw.text), id = token(raw.id);
  if (!text || !id) return null;
  return {
    id, at: finite(raw.at), senderId: raw.senderId, recipientId: raw.recipientId,
    channel: raw.channel, text, kind: ['speech', 'question', 'answer', 'note'].includes(raw.kind) ? raw.kind : 'speech',
    ...(token(raw.replyTo) ? { replyTo: token(raw.replyTo) } : {}),
    ...(raw.offline === true ? { offline: true } : {}),
    ...(raw.model === true && raw.senderId!=='human' ? { model: true } : {}),
    ...(['pending', 'answered', 'superseded'].includes(raw.questionState) ? {questionState: raw.questionState} : {}),
  };
}

function validNote(raw) {
  if (!raw || !AGENT_IDS.has(raw.authorId) || !SCENES.has(raw.scene) || !pointValid(raw.position, raw.scene)) return null;
  const id = token(raw.id), title = textValue(raw.title, SOCIAL_RULES.maxTitle), text = textValue(raw.text);
  if (!id || !title || !text) return null;
  return {
    id, authorId: raw.authorId, at: finite(raw.at), scene: raw.scene,
    position: { x: raw.position.x, y: raw.position.y }, title, text,
    beliefIds: Array.isArray(raw.beliefIds) ? [...new Set(raw.beliefIds.map(id => token(id)).filter(Boolean))].slice(0, 4) : [],
    readers: Array.isArray(raw.readers) ? [...new Set(raw.readers.filter(id => AGENT_IDS.has(id)))].slice(0, 2) : [],
    ...(Array.isArray(raw.effectClaims)?{effectClaims:raw.effectClaims.slice(0,2).map(validEffectClaim).filter(Boolean)}:{}),
    claims: Array.isArray(raw.claims) ? raw.claims.slice(0, 2).filter(claim => claim && textValue(claim.text, 300) && token(claim.resourceId, 70)).map(claim => ({subject: textValue(claim.subject, 100), kind: 'resource', text: textValue(claim.text, 300), resourceId: token(claim.resourceId, 70), ...(typeof claim.available === 'boolean' ? {available: claim.available} : {}), ...(pointValid(claim.position, 'valley') ? {position: {x: claim.position.x, y: claim.position.y}} : {})})) : [],
  };
}

export function validateCommunity(raw) {
  const community = createCommunity();
  if (!raw || typeof raw !== 'object') return community;
  const messageIds = new Set();
  for (const rawMessage of bounded(Array.isArray(raw.messages) ? raw.messages : [], SOCIAL_RULES.maxMessages)) {
    const message = validMessage(rawMessage);
    if (!message || messageIds.has(message.id)) continue;
    messageIds.add(message.id); community.messages.push(message);
  }
  const noteIds = new Set();
  for (const rawNote of bounded(Array.isArray(raw.notes) ? raw.notes : [], SOCIAL_RULES.maxNotes)) {
    const note = validNote(rawNote);
    if (!note || noteIds.has(note.id)) continue;
    noteIds.add(note.id); community.notes.push(note);
  }
  for (const id of AGENT_IDS) {
    const question = raw.questions?.[id];
    if (!question || !token(question.messageId) || !textValue(question.text)) continue;
    community.questions[id] = {
      messageId: token(question.messageId), topic: token(question.topic) || 'world',
      text: textValue(question.text), askedAt: finite(question.askedAt),
      ...(Number.isFinite(question.knowledgeAt) ? {knowledgeAt: finite(question.knowledgeAt)} : {}),
      ...(Number.isFinite(question.knowledgeCount) ? {knowledgeCount: finite(question.knowledgeCount)} : {}),
      ...(token(question.knowledgeKey) ? {knowledgeKey: token(question.knowledgeKey)} : {}),
      status: ['answered', 'superseded'].includes(question.status) ? question.status : 'pending',
      ...(question.status === 'answered' ? { answeredAt: finite(question.answeredAt) } : {}),
    };
  }
  const largest = Math.max(0, ...community.messages.map(message => Number(message.id.replace(/^message:/, '')) || 0), ...community.notes.map(note => Number(note.id.replace(/^note:/, '')) || 0));
  community.nextId = Math.max(largest + 1, Math.min(Number.MAX_SAFE_INTEGER - 1, Math.max(1, Math.floor(finite(raw.nextId, 1)))));
  return community;
}

export function validateSocialMemory(raw, npc = {}) {
  const memory = createSocialMemory();
  if (!raw || typeof raw !== 'object') return memory;
  for (const [id, relationship] of Object.entries(raw.relationships ?? {}).slice(0, SOCIAL_RULES.maxRelationships)) {
    if (!SENDERS.has(id) || id === npc.id || !relationship || typeof relationship !== 'object') continue;
    memory.relationships[id] = {
      familiarity: Math.max(0, Math.min(1, Number.isFinite(relationship.familiarity) ? relationship.familiarity : 0)),
      trust: Math.max(0, Math.min(1, Number.isFinite(relationship.trust) ? relationship.trust : .2)),
      exchanges: Math.max(0, Math.min(10000, Math.floor(finite(relationship.exchanges)))),
      lastContactAt: finite(relationship.lastContactAt),
    };
  }
  memory.heard = bounded(Array.isArray(raw.heard) ? raw.heard.map(item => validMessage(item)).filter(Boolean) : [], SOCIAL_RULES.maxHeard);
  memory.lastSpokeAt = raw.lastSpokeAt === null ? null : finite(raw.lastSpokeAt, null);
  memory.lastAskedAt = raw.lastAskedAt === null ? null : finite(raw.lastAskedAt, null);
  for (const [topic, at] of Object.entries(raw.askedTopics ?? {}).slice(-SOCIAL_RULES.maxTopics)) {
    const key = token(topic); if (key && Number.isFinite(at)) memory.askedTopics[key] = finite(at);
  }
  memory.conversationKeys = bounded(Array.isArray(raw.conversationKeys) ? raw.conversationKeys.filter(item => item && textValue(item.key, 650) && Number.isFinite(item.at)).map(item => ({key: textValue(item.key, 650), at: finite(item.at)})) : [], 32);
  memory.sharedClaims = bounded(Array.isArray(raw.sharedClaims) ? raw.sharedClaims.filter(item => item && AGENT_IDS.has(item.to) && token(item.resourceId) && Number.isFinite(item.observedAt)).map(item => ({to: item.to, resourceId: token(item.resourceId), observedAt: finite(item.observedAt), signature: textValue(item.signature, 160)})) : [], 48);
  memory.pendingQuestionId = token(raw.pendingQuestionId) || null;
  memory.fulfillment = Math.max(0, Math.min(1, Number.isFinite(raw.fulfillment) ? raw.fulfillment : 0));
  memory.lastUpdateAt = raw.lastUpdateAt === null ? null : finite(raw.lastUpdateAt, null);
  memory.lastContactAt = raw.lastContactAt === null ? null : finite(raw.lastContactAt, null);
  memory.lastJournalAt = raw.lastJournalAt === null ? null : finite(raw.lastJournalAt, null);
  memory.repliedTo = bounded(Array.isArray(raw.repliedTo) ? [...new Set(raw.repliedTo.map(id => token(id)).filter(Boolean))] : [], 24);
  memory.journalSeen = bounded(Array.isArray(raw.journalSeen) ? [...new Set(raw.journalSeen.map(id => token(id)).filter(Boolean))] : [], SOCIAL_RULES.maxMessages);
  return memory;
}

export const validateSocial = validateSocialMemory;

function appearance(npc) {
  const activity = npc.lifecycle === 'COLLAPSED' ? 'unconscious' : npc.lifecycle !== 'AWAKE' ? 'recovering' : isSleeping(npc) || ['sleep','nap'].includes(activityType(npc)) ? 'sleeping' : activityType(npc) === 'rest' ? 'resting' : activityType(npc) === 'move' ? 'walking' : 'standing';
  return {
    activity,
    wetness: (npc.thermal?.wetness ?? 0) > 35 ? 'visibly wet' : 'dry',
    expression: activity === 'unconscious' ? 'unresponsive' : (npc.feelings?.discomfort ?? 0) > .65 ? 'looks uncomfortable' : 'calm',
  };
}

function observedResources(npc) {
  return [
    ...Object.values(npc.memory?.sources ?? {}).map(resource => ({...resource, kind: 'water'})),
    ...(npc.mode==='discovery'?[]:Object.values(npc.memory?.foods ?? {}).map(resource => ({...resource, kind: 'food'}))),
    ...Object.values(npc.memory?.shelters ?? {}).map(resource => ({...resource, kind: 'shelter'})),
  ].filter(resource => typeof resource.id === 'string' && Number.isFinite(resource.observedAt)).sort((a, b) => b.observedAt - a.observedAt).slice(0, 24);
}

const resourceSignature = resource => `${resource.kind}:${resource.name || resource.id}:${resource.available === false ? 'unavailable' : 'available'}:${Number.isFinite(resource.experiencedTemperature) ? 'visited' : 'unvisited'}`;
const knowledgeKey = npc => {
  let hash = 2166136261;
  const learned=npc.mode==='discovery'?(npc.discovery?.effects??[]).map(effect=>`${effect.objectId}:${effect.effect}:${effect.id}`):[];
  for (const letter of [...observedResources(npc).map(resource => `${resource.id}:${resourceSignature(resource)}`),...learned].sort().join('|')) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  return `knowledge:${hash >>> 0}`;
};
const novelSinceQuestion = (npc, question) => (npc.cognition?.lastKnowledgeAt ?? 0) > (question.knowledgeAt ?? question.askedAt) ||
  (npc.cognition?.knowledgeGained ?? 0) > (question.knowledgeCount ?? Infinity) || question.knowledgeKey && question.knowledgeKey !== knowledgeKey(npc);

function matchingClaims(npc, text) {
  const normalized = fingerprint(text);
  return observedResources(npc).filter(resource => resource.name && normalized.includes(fingerprint(resource.name)) || normalized.includes(fingerprint(resource.id))).slice(0, 2).map(resource => ({
    subject: resource.name || resource.id, kind: 'resource', resourceId: resource.id, text,
    ...(/\b(no apples|no water|empty|depleted|unavailable|ran out)\b/i.test(text) ? {available: false} : /\b(found water|found apples|accessible water|apples were visible|water was accessible)\b/i.test(text) ? {available: true} : {}),
    ...(pointValid(resource, resource.scene ?? 'valley') ? {position: {x: resource.x, y: resource.y}} : {}),
  }));
}

/** Local speech and an asynchronous journal are separate delivery channels. */
export class SocialCoordinator {
  constructor({getAgents, getCommunity, getEnvironment}) {
    this.getAgents = getAgents; this.getCommunity = getCommunity; this.getEnvironment = getEnvironment;
  }

  agents() {
    const agents = this.getAgents?.();
    return (Array.isArray(agents) ? agents : Object.values(agents ?? {})).filter(npc => AGENT_IDS.has(npc?.id));
  }

  community() {
    return this.getCommunity();
  }

  ensure(npc) {
    npc.social ??= createSocialMemory();
    return npc.social;
  }

  nearby(npc) {
    return this.agents().filter(peer => peer.id !== npc.id && peer.scene === npc.scene && distance(peer.position, npc.position) <= SOCIAL_RULES.peerRange && lineOfSight(npc.position, peer.position, npc.scene));
  }

  receive(npc, message) {
    const memory = this.ensure(npc);
    if (message.channel === 'journal') {
      if (memory.journalSeen.includes(message.id)) return false;
      memory.journalSeen = bounded([...memory.journalSeen, message.id], SOCIAL_RULES.maxMessages);
    }
    if (memory.heard.some(item => item.id === message.id)) return false;
    memory.heard.push({...message}); memory.heard = bounded(memory.heard, SOCIAL_RULES.maxHeard);
    return true;
  }

  contact(npc, sourceId, at, meaningful = true) {
    const memory = this.ensure(npc);
    const relationship = memory.relationships[sourceId] ??= {familiarity: 0, trust: .2, exchanges: 0, lastContactAt: at};
    relationship.lastContactAt = at;
    relationship.exchanges = Math.min(10000, relationship.exchanges + 1);
    relationship.familiarity = Math.min(.95, relationship.familiarity + (meaningful ? .035 : .01));
    // Familiarity is not a warrant for factual truth. Reported claims stay tentative.
    memory.fulfillment = Math.min(1, memory.fulfillment + (meaningful ? .3 : .12));
    // Drives use the character's lived time; messages and cooldowns use the shared world clock.
    memory.lastContactAt = finite(npc.elapsed);
  }

  append({senderId, recipientId, channel, text, kind = 'speech', replyTo, offline = false,model=false}, at) {
    const community = this.community();
    const message = {id: `message:${community.nextId++}`, at, senderId, recipientId, channel, text, kind, ...(replyTo ? {replyTo} : {}), ...(offline ? {offline: true} : {}),...(model&&senderId!=='human'?{model:true}:{})};
    community.messages.push(message); community.messages = bounded(community.messages, SOCIAL_RULES.maxMessages);
    return message;
  }

  tick(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const environment = this.getEnvironment?.();
    for (const npc of this.agents()) {
      const social = this.ensure(npc), now = nowFor(npc, environment);
      const elapsed = social.lastUpdateAt === null ? Math.min(dt, now) : Math.max(0, now - social.lastUpdateAt);
      social.fulfillment = Math.max(0, social.fulfillment - Math.min(elapsed, 60) / 240);
      social.lastUpdateAt = now;
    }
  }

  deliverHuman(npc, message) {
    if (!aliveAndAwake(npc) || !this.receive(npc, message)) return;
    this.contact(npc, 'human', message.at, true);
    if(npc.mode==='discovery')recordTechniqueReport(npc,message.text,{sourceId:'human',messageId:message.id,at:message.at});
    const pending = this.community().questions[npc.id];
    const matches = matchingClaims(npc, message.text);
    for (const claim of matches.length ? matches : [{subject: pending?.topic || 'journal', kind: 'general', text: message.text}]) {
      const reported = {...claim};
      // The human's text is evidence of a report, not evidence of current availability.
      delete reported.available;
      if (npc.mode!=='discovery'&&/\b(empty|depleted|no apples|no water|ran out)\b/i.test(message.text)) reported.available = false;
      else if (npc.mode!=='discovery'&&/\b(has apples|has water|plenty of apples|plenty of water)\b/i.test(message.text)) reported.available = true;
      recordClaim(npc, reported, {sourceId: 'human', at: message.at, channel: 'journal', messageId: message.id});
    }
    if (message.replyTo && npc.cognition) {
      const question = npc.cognition.questions.find(question => question.messageId === message.replyTo);
      const spoken = this.community().messages.find(item => item.id === message.replyTo && item.senderId === npc.id && item.kind === 'question');
      const current = this.community().questions[npc.id];
      if (question) question.status = 'answered';
      else if (spoken || current?.messageId === message.replyTo) {
        npc.cognition.questions.push({messageId: message.replyTo, topic: current?.messageId === message.replyTo ? current.topic : 'world', text: spoken?.text ?? current.text, at: spoken?.at ?? current.askedAt, status: 'answered'});
        npc.cognition.questions = bounded(npc.cognition.questions, 8);
      }
      const remembered = this.ensure(npc).heard.find(item => item.id === message.replyTo && item.senderId === npc.id && item.kind === 'question');
      if (remembered) remembered.questionState = 'answered';
    }
  }

  observe(npc) {
    const community = this.community(), memory = this.ensure(npc);
    const awake=aliveAndAwake(npc);
    const availableJournal = community.messages.filter(message => message.channel === 'journal' && (message.recipientId === 'all' || message.recipientId === npc.id || message.senderId === npc.id));
    for (const message of availableJournal) {
      if (message.senderId === 'human') this.deliverHuman(npc, message);
      else if (aliveAndAwake(npc)) this.receive(npc, message);
    }
    const journal=awake?availableJournal.slice(-12):[];
    const notes = awake?community.notes.filter(note => note.scene === npc.scene && distance(note.position, npc.position) <= SOCIAL_RULES.noteRange && lineOfSight(npc.position, note.position, npc.scene)).map(note => ({id: note.id, authorId: note.authorId, title: note.title, scene: note.scene, position: {...note.position}, read: note.readers.includes(npc.id)})):[];
    return {
      peers: awake?this.nearby(npc).map(peer => ({id: peer.id, name: peer.name, scene: peer.scene, position: {...peer.position}, appearance: appearance(peer), relationship: {familiarity: (memory.relationships[peer.id]?.familiarity ?? 0) > .5 ? 'familiar' : memory.relationships[peer.id] ? 'acquainted' : 'unfamiliar'}})):[],
      journal, nearbyMessages: memory.heard.filter(message => message.channel === 'peer').slice(-6), notes,
      pendingHumanTurn: journal.filter(message => message.senderId === 'human' && !memory.repliedTo.includes(message.id)).slice(-1)[0] ?? null,
      pendingQuestion: awake&&community.questions[npc.id]?.status === 'pending' ? {...community.questions[npc.id], instruction: 'A human reply is optional. Continue your own activities and care for your body.'} : null,
      journalAvailability: 'The human may read or reply later, or may not answer. Sending a question does not require waiting.',
    };
  }

  action(npc, action) {
    if (!AGENT_IDS.has(npc?.id) || !this.agents().includes(npc)) return {ok: false, code: 'UNKNOWN_SPEAKER'};
    if (!aliveAndAwake(npc)) return {ok: false, code: 'SPEAKER_UNAVAILABLE'};
    if (!action || typeof action !== 'object') return {ok: false, code: 'INVALID_SOCIAL_ACTION'};
    if (action.type === 'say') return this.say(npc, action);
    if (action.type === 'ask_human') return this.ask(npc, action);
    if (action.type === 'journal_reply') return this.journalReply(npc, action);
    if (action.type === 'write_note') return this.writeNote(npc, action);
    if (action.type === 'read_note') return this.readNote(npc, action);
    return {ok: false, code: 'UNKNOWN_SOCIAL_ACTION'};
  }

  say(npc, action) {
    const text = textValue(action.text), target = this.agents().find(peer => peer.id === action.targetId);
    if (!text || typeof action.text !== 'string' || action.text.length > SOCIAL_RULES.maxText) return {ok: false, code: 'INVALID_TEXT'};
    if (!target || target.id === npc.id) return {ok: false, code: 'UNKNOWN_PEER'};
    if (!this.nearby(npc).includes(target)) return {ok: false, code: 'PEER_OUT_OF_REACH'};
    if (!aliveAndAwake(target)) return {ok: false, code: 'PEER_UNAVAILABLE'};
    const memory = this.ensure(npc), at = nowFor(npc, this.getEnvironment?.());
    if (memory.lastSpokeAt !== null && at - memory.lastSpokeAt < SOCIAL_RULES.speechCooldown) return {ok: false, code: 'CONVERSATION_COOLDOWN'};
    const key = `${target.id}:${fingerprint(text)}`;
    if (memory.conversationKeys.some(item => item.key === key && at - item.at < SOCIAL_RULES.topicCooldown)) return {ok: false, code: 'REPEATED_CONVERSATION'};
    const message = this.append({senderId: npc.id, recipientId: target.id, channel: 'peer', text, offline: action.offline === true}, at);
    memory.lastSpokeAt = at; memory.conversationKeys = bounded([...memory.conversationKeys, {key, at}], 32);
    this.receive(npc, message); this.receive(target, message);
    const claims = matchingClaims(npc, text);
    for (const claim of claims) {
      recordClaim(target, claim, {sourceId: npc.id, at, channel: 'peer', messageId: message.id});
      const resource = observedResources(npc).find(item => item.id === claim.resourceId);
      memory.sharedClaims = bounded([...memory.sharedClaims, {to: target.id, resourceId: claim.resourceId, observedAt: resource.observedAt, signature: resourceSignature(resource)}], 48);
    }
    if (!claims.length) recordClaim(target, {subject: npc.name, kind: 'general', text}, {sourceId: npc.id, at, channel: 'peer', messageId: message.id});
    if(npc.mode==='discovery'&&target.mode==='discovery'&&action.offline===true){
      const effect=npc.discovery?.effects.find(effect=>effect.id===action.effectId);
      if(effect)recordDiscoveryClaim(target,{objectId:effect.objectId,effect:effect.effect},{sourceId:npc.id,channel:'peer',messageId:message.id,at});
    }
    this.contact(npc, target.id, at, claims.length > 0); this.contact(target, npc.id, at, claims.length > 0);
    npc.presentation ??= {}; npc.presentation.speakUntil = npc.elapsed + 4; npc.presentation.speakText = text;
    return {ok: true, code: 'SAID', message, deliveredTo: target.id, reportedClaims: claims.length, reward: claims.length ? .5 : .15};
  }

  ask(npc, action) {
    const text = textValue(action.text), topic = token(action.topic) || 'world';
    if (!text || typeof action.text !== 'string' || action.text.length > SOCIAL_RULES.maxText) return {ok: false, code: 'INVALID_TEXT'};
    const community = this.community(), memory = this.ensure(npc), at = nowFor(npc, this.getEnvironment?.());
    const pending = community.questions[npc.id];
    if (pending?.status === 'pending' && (pending.topic === topic || at - pending.askedAt < 300 || !novelSinceQuestion(npc, pending))) return {ok: false, code: 'QUESTION_PENDING', waitingRequired: false};
    if (memory.lastAskedAt !== null && at - memory.lastAskedAt < SOCIAL_RULES.questionCooldown) return {ok: false, code: 'QUESTION_COOLDOWN'};
    if (Number.isFinite(memory.askedTopics[topic]) && at - memory.askedTopics[topic] < SOCIAL_RULES.topicCooldown) return {ok: false, code: 'QUESTION_TOPIC_RECENT'};
    if (pending?.status === 'pending') {
      pending.status = 'superseded';
      const old = community.messages.find(message => message.id === pending.messageId); if (old) old.questionState = 'superseded';
    }
    const message = this.append({senderId: npc.id, recipientId: 'all', channel: 'journal', text, kind: 'question', offline: action.offline === true,model:action.model===true}, at);
    message.questionState = 'pending';
    community.questions[npc.id] = {messageId: message.id, topic, text, askedAt: at, status: 'pending', knowledgeAt: npc.cognition?.lastKnowledgeAt ?? 0, knowledgeCount: npc.cognition?.knowledgeGained ?? 0, knowledgeKey: knowledgeKey(npc)};
    memory.lastAskedAt = at; memory.askedTopics[topic] = at;
    memory.askedTopics = Object.fromEntries(Object.entries(memory.askedTopics).slice(-SOCIAL_RULES.maxTopics));
    memory.pendingQuestionId = message.id; this.receive(npc, message);
    npc.presentation ??= {}; npc.presentation.speakUntil = npc.elapsed + 4; npc.presentation.speakText = text;
    return {ok: true, code: 'ASKED_HUMAN', message, waitingRequired: false, reward: 0};
  }

  journalReply(npc, action) {
    const text = textValue(action.text), memory = this.ensure(npc), at = nowFor(npc, this.getEnvironment?.());
    if (!text || typeof action.text !== 'string' || action.text.length > SOCIAL_RULES.maxText) return {ok: false, code: 'INVALID_TEXT'};
    const turn = action.replyTo ? memory.heard.find(message => message.id === action.replyTo && message.senderId === 'human' && message.channel === 'journal') : memory.heard.filter(message => message.senderId === 'human' && message.channel === 'journal' && !memory.repliedTo.includes(message.id)).slice(-1)[0];
    if (!turn) return {ok: false, code: 'UNKNOWN_HUMAN_TURN'};
    if (memory.repliedTo.includes(turn.id)) return {ok: false, code: 'JOURNAL_TURN_ALREADY_REPLIED'};
    if (memory.lastJournalAt !== null && at - memory.lastJournalAt < SOCIAL_RULES.speechCooldown) return {ok: false, code: 'CONVERSATION_COOLDOWN'};
    const message = this.append({senderId: npc.id, recipientId: 'all', channel: 'journal', text, kind: 'answer', replyTo: turn.id, offline: action.offline === true,model:action.model===true}, at);
    memory.repliedTo = bounded([...memory.repliedTo, turn.id], 24); memory.lastJournalAt = at;
    this.receive(npc, message); this.contact(npc, 'human', at, false);
    return {ok: true, code: 'REPLIED_JOURNAL', message, waitingRequired: false, reward: .1};
  }

  postUserMessage(text, {to = 'all', replyTo = null} = {}) {
    return this.postHuman(text, to, replyTo);
  }

  postHuman(rawText, to = 'all', replyTo = null) {
    const text = textValue(rawText), community = this.community();
    if (!text || typeof rawText !== 'string' || rawText.length > SOCIAL_RULES.maxText) return {ok: false, code: 'INVALID_TEXT'};
    if (!RECIPIENTS.has(to)) return {ok: false, code: 'UNKNOWN_RECIPIENT'};
    // Targeting a character answers its current open question unless a different turn was selected.
    if (!replyTo && to !== 'all' && community.questions[to]?.status === 'pending') replyTo = community.questions[to].messageId;
    const oldQuestion = replyTo ? community.messages.find(message => message.id === replyTo && message.senderId !== 'human' && message.channel === 'journal') : null;
    const question = replyTo ? Object.entries(community.questions).find(([, question]) => question.messageId === replyTo) : null;
    const questionAuthor = question?.[0] ?? oldQuestion?.senderId;
    if (replyTo && !questionAuthor) return {ok: false, code: 'UNKNOWN_QUESTION'};
    if (questionAuthor && to !== 'all' && to !== questionAuthor) return {ok: false, code: 'WRONG_QUESTION_RECIPIENT'};
    const at = nowFor(this.agents()[0], this.getEnvironment?.());
    const message = this.append({senderId: 'human', recipientId: to, channel: 'journal', text, kind: replyTo ? 'answer' : 'speech', replyTo}, at);
    for (const npc of this.agents().filter(agent => to === 'all' || agent.id === to)) {
      const pending = community.questions[npc.id];
      // A targeted reply answers that character. A room-wide comment is not an automatic answer to every question.
      if (pending?.status === 'pending' && (replyTo === pending.messageId || !replyTo && to === npc.id)) {
        pending.status = 'answered'; pending.answeredAt = at; this.ensure(npc).pendingQuestionId = null;
        const old = community.messages.find(message => message.id === pending.messageId); if (old) old.questionState = 'answered';
      }
      this.deliverHuman(npc, message);
    }
    return {ok: true, code: 'POSTED_HUMAN', message};
  }

  writeNote(npc, action) {
    const title = textValue(action.title, SOCIAL_RULES.maxTitle), text = textValue(action.text);
    if (!title || !text || typeof action.title !== 'string' || typeof action.text !== 'string' || action.title.length > SOCIAL_RULES.maxTitle || action.text.length > SOCIAL_RULES.maxText) return {ok: false, code: 'INVALID_NOTE'};
    const beliefIds = Array.isArray(action.beliefIds) ? [...new Set(action.beliefIds)] : [];
    const beliefs = npc.cognition?.beliefs;
    const knownIds = new Set((Array.isArray(beliefs) ? beliefs : Object.values(beliefs ?? {})).map(belief => belief.id));
    if (beliefIds.length > 4 || beliefIds.some(id => typeof id !== 'string' || !knownIds.has(id))) return {ok: false, code: 'UNKNOWN_NOTE_BELIEF'};
    const community = this.community();
    if (community.notes.some(note => note.authorId === npc.id && fingerprint(note.title) === fingerprint(title) && fingerprint(note.text) === fingerprint(text))) return {ok: false, code: 'DUPLICATE_NOTE'};
    const at = nowFor(npc, this.getEnvironment?.());
    const note = {id: `note:${community.nextId++}`, authorId: npc.id, at, scene: npc.scene, position: {...npc.position}, title, text, beliefIds, readers: [npc.id], claims: matchingClaims(npc, text).map(claim => ({...claim, text: textValue(claim.text, 300)}))};
    if(npc.mode==='discovery'&&action.offline===true){
      const effect=npc.discovery?.effects.find(effect=>effect.id===action.effectId);
      if(effect)note.effectClaims=[{objectId:effect.objectId,effect:effect.effect,experienceId:effect.id}];
    }
    community.notes.push(note); community.notes = bounded(community.notes, SOCIAL_RULES.maxNotes);
    if (npc.cognition) npc.cognition.lastNoteAt = npc.elapsed;
    const message = this.append({senderId: npc.id, recipientId: 'all', channel: 'note', text: textValue(`${title}: ${text}`), kind: 'note'}, at);
    return {ok: true, code: 'WROTE_NOTE', note, message, reward: .2};
  }

  readNote(npc, action) {
    const note = this.community().notes.find(note => note.id === action.noteId);
    if (!note) return {ok: false, code: 'UNKNOWN_NOTE'};
    if (note.scene !== npc.scene || distance(note.position, npc.position) > SOCIAL_RULES.noteRange || !lineOfSight(npc.position, note.position, npc.scene)) return {ok: false, code: 'NOTE_OUT_OF_REACH'};
    if (note.readers.includes(npc.id)) return {ok: true, code: 'NOTE_ALREADY_READ', note, reward: 0};
    note.readers.push(npc.id);
    for (const claim of note.claims?.length ? note.claims : [{subject: note.title, kind: 'general', text: note.text}]) recordClaim(npc, claim, {sourceId: note.authorId, at: nowFor(npc, this.getEnvironment?.()), channel: 'note', messageId: note.id});
    if(npc.mode==='discovery')for(const claim of note.effectClaims??[])recordDiscoveryClaim(npc,claim,{sourceId:note.authorId,channel:'note',messageId:note.id,at:nowFor(npc,this.getEnvironment?.())});
    return {ok: true, code: 'READ_NOTE', note, reward: .35};
  }

  /** Discovery speech describes sensed appearances and executed consequences.
   * It cannot turn animal metadata, a model's prose, or a human report into an
   * independently verified technique. */
  discoveryDialogue(npc){
    if(!aliveAndAwake(npc))return null;
    const body=bodySignals(npc);
    if(['urgent','unconscious','recovering'].includes(body.overall))return null;
    const at=nowFor(npc,this.getEnvironment?.()),memory=this.ensure(npc),observation=this.observe(npc);
    const discovery=npc.discovery;
    const effects=Array.isArray(discovery?.effects)?discovery.effects:[];
    const objects=Object.values(discovery?.observations??{});
    const describeEffect=effect=>effect.effect==='sustained'?`After sampling ${effect.objectId}, I noticed relief in my body.`:effect.effect==='water relief'?`After sampling ${effect.objectId}, my thirst eased.`:effect.effect==='discomfort'?`After sampling ${effect.objectId}, I felt discomfort.`:`After sampling ${effect.objectId}, I did not notice a useful change.`;
    if(observation.pendingHumanTurn&&(memory.lastJournalAt===null||at-memory.lastJournalAt>=SOCIAL_RULES.speechCooldown)){
      const turn=observation.pendingHumanTurn,query=turn.text.toLowerCase();
      let response;
      if(/how.*(feel|doing)|are you (okay|ok|well)|hungry|thirsty|tired/.test(query))response=`I feel ${body.overall}. My body feels ${body.hunger}, ${body.thirst}, and ${body.fatigue}.`;
      else if(/what.*(find|found|discover|learn)|food|apple|hunt|forag|eat/.test(query))response=effects.length?`${describeEffect(effects.at(-1))} I am comparing repeated experiences; unfamiliar materials remain uncertain.`:'I have not established which unfamiliar materials sustain me. I can try small, physical interactions and compare what happens. Your suggestions would be reports for me to test.';
      else if(/where.*(going|go|headed)|what.*(plan|doing|next)|your goal/.test(query))response=npc.cognition?.plan?.status==='active'?`My intention is ${npc.cognition.plan.goal}. I will revise it if conditions or my body change.`:'I am investigating what I can reach and comparing the consequences. I have no confirmed food technique yet.';
      else response='I have read your message. I will treat any suggested method as something to test, and continue living whether you reply again or not.';
      return {type:'journal_reply',text:response,replyTo:turn.id,offline:true};
    }
    const note=observation.notes.find(note=>note.authorId!==npc.id&&!note.read);
    if(note)return {type:'read_note',noteId:note.id,offline:true};
    if(memory.lastSpokeAt===null||at-memory.lastSpokeAt>=SOCIAL_RULES.speechCooldown){
      for(const peer of observation.peers.filter(peer=>!['sleeping','resting','unconscious','recovering'].includes(peer.appearance.activity))){
        const effect=effects.at(-1);
        const text=effect?`${describeEffect(effect)} That is my experience, rather than a promise about every similar object.`:`Hello, ${peer.name}. I am still learning what the things around us do. We can compare what actually happens.`;
        const key=`${peer.id}:${fingerprint(text)}`;
        if(!memory.conversationKeys.some(item=>item.key===key&&at-item.at<SOCIAL_RULES.topicCooldown))return {type:'say',targetId:peer.id,text,...(effect?{effectId:effect.id}:{}),offline:true};
      }
    }
    if(at-(npc.cognition?.lastNoteAt??0)>=120&&effects.length){
      const effect=effects.at(-1),title=`${effect.objectId}: experience`,text=`${describeEffect(effect)} This is a record of my own experience; other materials and future conditions remain untested.`;
      if(!this.community().notes.some(note=>note.authorId===npc.id&&note.title===title&&note.text===text))return {type:'write_note',title,text,beliefIds:[],effectId:effect.id,offline:true};
    }
    if(at<90||memory.lastAskedAt!==null&&at-memory.lastAskedAt<SOCIAL_RULES.questionCooldown)return null;
    const topic=effects.some(effect=>effect.effect==='sustained')?'discovery-patterns':'unfamiliar-materials';
    const text=topic==='unfamiliar-materials'?'I do not know which things here can ease my hunger. Have you observed a method I could test? You may answer later; I will keep investigating.':`I have experienced a useful change after an interaction, but I am unsure how reliable it is. Have you noticed something I could compare with my own experience?`;
    if(observation.pendingQuestion&&(observation.pendingQuestion.topic===topic||at-observation.pendingQuestion.askedAt<300||!novelSinceQuestion(npc,observation.pendingQuestion)))return null;
    if(Number.isFinite(memory.askedTopics[topic])&&at-memory.askedTopics[topic]<SOCIAL_RULES.topicCooldown)return null;
    if(!objects.length&&!effects.length&&at<180)return null;
    return {type:'ask_human',topic,text,offline:true};
  }

  /** Evidence-derived offline language. The optional model can use the same validated actions. */
  maybeDialogue(npc) {
    if(npc.mode==='discovery')return this.discoveryDialogue(npc);
    if (!aliveAndAwake(npc) || npc.hydration < 45 || npc.nourishment < 45 || npc.health < 70 || Math.max(npc.thermal?.hot ?? 0, npc.thermal?.cold ?? 0) > 40) return null;
    const at = nowFor(npc, this.getEnvironment?.()), memory = this.ensure(npc), observation = this.observe(npc);
    if (observation.pendingHumanTurn && (memory.lastJournalAt === null || at - memory.lastJournalAt >= SOCIAL_RULES.speechCooldown)) {
      const turn = observation.pendingHumanTurn, query = turn.text.toLowerCase();
      let response = null;
      if (/how.*(feel|doing)|are you (okay|ok|well)|hungry|thirsty|tired/.test(query)) {
        const body = bodySignals(npc);
        response = `I feel ${body.overall}. ${body.hunger === 'content' ? 'I am satisfied with food for now.' : `My body feels ${body.hunger}.`} ${body.thirst === 'quenched' ? 'I am not thirsty right now.' : `I notice ${body.thirst}.`} ${body.fatigue === 'fresh' ? 'I feel rested.' : `I feel ${body.fatigue} and may need some rest.`}`;
      } else if (/where.*(going|go|headed)|what.*(plan|doing|next)|your goal/.test(query)) {
        response = npc.cognition?.plan?.status === 'active' ? `My current intention is: ${npc.cognition.plan.goal}. I will revise it if my body or the conditions ask me to.` : 'I do not have a longer plan underway at the moment. I am caring for my needs and considering what I can investigate safely.';
      } else if (/what.*(find|found|discover|learn)|seen.*(water|food|cave|orchard)/.test(query)) {
        const places = [...new Set(observedResources(npc).map(resource => resource.name || resource.id))].slice(0, 3);
        response = places.length ? `I have observed ${places.join(', ')}. Those are places I can recognize from my own visits; I am still learning how reliable they are.` : 'I have not established any resource locations from my own observations yet. I need to look around before claiming that I know this place.';
      } else if (/\?/.test(query)) {
        response = 'I do not yet know how to answer that from my experience. I have kept your message as a report and can compare it with what I discover.';
      }
      if (response) return {type: 'journal_reply', text: response, replyTo: turn.id, offline: true};
    }
    const note = observation.notes.find(note => note.authorId !== npc.id && !note.read);
    if (note) return {type: 'read_note', noteId: note.id, offline: true};
    if (memory.lastSpokeAt === null || at - memory.lastSpokeAt >= SOCIAL_RULES.speechCooldown) {
      for (const peer of observation.peers.filter(peer => !['sleeping', 'resting', 'unconscious', 'recovering'].includes(peer.appearance.activity))) {
        for (const resource of observedResources(npc).filter(resource => !memory.sharedClaims.some(shared => shared.to === peer.id && (shared.signature ? shared.signature === resourceSignature(resource) : shared.resourceId === resource.id)))) {
          const location = resource.name || resource.id;
          const report = resource.kind === 'food' ? resource.available === false ? `I found ${location}, but there were no apples when I visited.` : `I found apples at ${location}. I can check again if we need food.` : resource.kind === 'water' ? `I found water at ${location}. That is one place I know we can check.` : `I found the entrance to ${location}. ${Number.isFinite(resource.experiencedTemperature) ? 'I went inside and felt sheltered there.' : 'I have not established what conditions are like inside.'}`;
          const key = `${peer.id}:${fingerprint(report)}`;
          if (!memory.conversationKeys.some(item => item.key === key && at - item.at < SOCIAL_RULES.topicCooldown)) return {type: 'say', targetId: peer.id, text: report, offline: true};
        }
        const greeting = `Hello, ${peer.name}. I am learning my way around here. We can tell each other what we discover.`;
        const key = `${peer.id}:${fingerprint(greeting)}`;
        if (!memory.conversationKeys.some(item => item.key === key && at - item.at < SOCIAL_RULES.topicCooldown)) return {type: 'say', targetId: peer.id, text: greeting, offline: true};
      }
    }
    if (at - (npc.cognition?.lastNoteAt ?? 0) >= 120 && npc.inventory?.apples.length >= 1 && npc.flask?.water > 0) {
      for (const resource of observedResources(npc)) {
        const title = `${resource.name || resource.id}: field note`;
        const text = resource.kind === 'water' ? `I observed accessible water at ${resource.name || resource.id}. Its future availability still needs checking.` : resource.kind === 'food' ? `I observed ${resource.name || resource.id}. ${resource.available === false ? 'There were no apples when I visited.' : 'Apples were visible when I visited.'} I do not yet know precisely when they return.` : `I observed the entrance to ${resource.name || resource.id}. ${Number.isFinite(resource.experiencedTemperature) ? 'I have experienced shelter inside.' : 'Conditions inside remain untested.'}`;
        if (this.community().notes.some(note => note.authorId === npc.id && note.title === title && note.text === text)) continue;
        const belief = npc.cognition?.beliefs.find(belief => belief.source === 'observed' && belief.resourceId === resource.id);
        return {type: 'write_note', title, text, beliefIds: belief ? [belief.id] : [], offline: true};
      }
    }
    if (at < 90 || memory.lastAskedAt !== null && at - memory.lastAskedAt < SOCIAL_RULES.questionCooldown) return null;
    const foods = Object.values(npc.memory?.foods ?? {}), shelters = Object.values(npc.memory?.shelters ?? {});
    let topic, text;
    if (foods.some(food => food.available === false)) {topic = 'food-renewal'; text = 'Some apples were gone when I visited. Have you noticed whether they return, or where I could look for another orchard?';}
    else if (!shelters.length) {topic = 'shelter-discovery'; text = 'I have not found a shelter yet. Have you seen a place I could investigate when the weather becomes uncomfortable?';}
    else if (shelters.some(shelter => !Number.isFinite(shelter.experiencedTemperature))) {topic = 'shelter-conditions'; text = 'I found a cave entrance, but I do not know how it feels inside. Have you explored it? I can investigate when I am prepared.';}
    else {topic = 'world-patterns'; text = 'I am beginning to recognize places here. Is there something you have noticed that I could investigate for myself?';}
    if (observation.pendingQuestion && (observation.pendingQuestion.topic === topic || at - observation.pendingQuestion.askedAt < 300 || !novelSinceQuestion(npc, observation.pendingQuestion))) return null;
    if (Number.isFinite(memory.askedTopics[topic]) && at - memory.askedTopics[topic] < SOCIAL_RULES.topicCooldown) return null;
    return {type: 'ask_human', topic, text, offline: true};
  }
}
