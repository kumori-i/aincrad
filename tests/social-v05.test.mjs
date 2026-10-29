import { legacyFixture } from './fixtures/legacy-communication.mjs';
// These tests preserve the explicit historical English/naming channel.
const createNpc=(...args)=>legacyFixture(rawcreateNpc(...args));
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOCIAL_RULES } from '../src/config.js';
import { createNpc as rawcreateNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { observeNpc } from '../src/npc.js';
import { updateCognition } from '../src/cognition.js';
import { createCommunity, createSocialMemory, validateCommunity, validateSocialMemory, SocialCoordinator } from '../src/social.js';

function fixture() {
  const aster = createNpc({id: 'aster'}), mira = createNpc({id: 'mira'});
  mira.position = {x: aster.position.x, y: aster.position.y + 35};
  const environment = createEnvironment(), community = createCommunity();
  const social = new SocialCoordinator({communicationMode:'legacy',getAgents: () => [aster, mira], getCommunity: () => community, getEnvironment: () => environment});
  const advance = seconds => {environment.elapsed += seconds; aster.elapsed += seconds; mira.elapsed += seconds; social.tick(seconds);};
  return {aster, mira, environment, community, social, advance};
}

test('peer speech is delivered locally, with only reported knowledge and independent memories', () => {
  const {aster, mira, environment, community, social, advance} = fixture();
  observeNpc(aster, environment);
  const source = Object.values(aster.memory.sources)[0];
  assert.ok(source);
  const result = social.action(aster, {type: 'say', targetId: 'mira', text: `I found water at ${source.name}.`});
  assert.equal(result.code, 'SAID'); assert.equal(community.messages.length, 1);
  assert.equal(mira.social.heard[0].id, result.message.id);
  assert.ok(mira.social.relationships.aster.familiarity > 0);
  assert.equal(Object.keys(mira.memory.sources).length, 0, 'conversation cannot discover a navigation target');
  const report = mira.cognition.beliefs.find(belief => belief.resourceId === source.id);
  assert.equal(report.source, 'reported'); assert.equal(report.status, 'unverified'); assert.equal(report.confidence, 'tentative');
  assert.equal(report.evidence[0].sourceId, 'aster');
  advance(1); observeNpc(mira, environment); updateCognition(mira);
  assert.equal(report.status, 'corroborated', 'actual local observation can corroborate a report');
  assert.notEqual(aster.social, mira.social); assert.notEqual(aster.cognition, mira.cognition);
});

test('peer appearance is qualitative and speech respects scene, range, sleep and cooldown', () => {
  const {aster, mira, social, advance} = fixture();
  mira.hydration = 2; mira.nourishment = 3; mira.energy = 4;
  const observation = social.observe(aster), peer = observation.peers[0];
  assert.ok(peer); assert.deepEqual(Object.keys(peer.appearance).sort(), ['activity', 'expression', 'wetness']);
  for (const key of ['hydration', 'nourishment', 'health', 'energy', 'inventory', 'beliefs', 'memory']) assert.equal(key in peer, false);
  const say = {type: 'say', targetId: 'mira', text: 'Hello, Mira.'};
  assert.equal(social.action(aster, say).code, 'SAID');
  assert.equal(social.action(aster, {...say, text: 'Something else.'}).code, 'CONVERSATION_COOLDOWN');
  advance(SOCIAL_RULES.speechCooldown + 1);
  assert.equal(social.action(aster, say).code, 'REPEATED_CONVERSATION');
  mira.active = {request: {type: 'sleep'}};
  assert.equal(social.action(aster, {...say, text: 'Are you awake?'}).code, 'PEER_UNAVAILABLE');
  assert.equal(social.observe(aster).peers[0].appearance.activity, 'sleeping');
  mira.active = null; mira.scene = 'refuge';
  assert.equal(social.action(aster, say).code, 'PEER_OUT_OF_REACH');
  mira.scene = 'valley'; mira.position = {x: aster.position.x - 450, y: aster.position.y};
  assert.equal(social.action(aster, say).code, 'PEER_OUT_OF_REACH');
});

test('unanswered human questions never wait or penalize the body, and distinct new uncertainty can supersede them', () => {
  const {aster, mira, environment, community, social, advance} = fixture();
  const body = JSON.stringify([aster.hydration, aster.nourishment, aster.health, aster.riskCost]);
  const first = social.action(aster, {type: 'ask_human', topic: 'shelter', text: 'Have you seen a cave?'});
  assert.equal(first.code, 'ASKED_HUMAN'); assert.equal(first.waitingRequired, false); assert.equal(aster.active, null);
  assert.equal(social.action(aster, {type: 'ask_human', topic: 'food', text: 'Have you seen apples?'}).code, 'QUESTION_PENDING');
  advance(400); aster.cognition.lastKnowledgeAt = 350;
  const second = social.action(aster, {type: 'ask_human', topic: 'food', text: 'Have you noticed when apples return?'});
  assert.equal(second.code, 'ASKED_HUMAN'); assert.equal(first.message.questionState, 'superseded');
  assert.equal(community.questions.aster.messageId, second.message.id);
  assert.equal(social.postUserMessage('I saw a cave earlier.', {to: 'aster', replyTo: first.message.id}).ok, true);
  assert.equal(community.questions.aster.status, 'pending', 'answering an older question cannot answer a newer one');
  assert.equal(JSON.stringify([aster.hydration, aster.nourishment, aster.health, aster.riskCost]), body);
  assert.equal(mira.social.heard.some(message => message.senderId === 'human'), false);
  assert.equal(environment.elapsed, 400);
});

test('journal messages are always available at any distance, optional and tentative', () => {
  const {aster, mira, social, community} = fixture();
  mira.scene = 'refuge'; mira.position = {x: 800, y: 700};
  const question = social.action(mira, {type: 'ask_human', topic: 'weather', text: 'Does the weather change here?'});
  assert.equal(question.ok, true);
  assert.equal(social.postUserMessage('Hello, both of you.').code, 'POSTED_HUMAN');
  assert.equal(community.questions.mira.status, 'pending', 'a room-wide greeting is not an answer');
  assert.equal(social.postUserMessage('The cave might stay comfortable.', {to: 'mira', replyTo: question.message.id}).code, 'POSTED_HUMAN');
  assert.equal(community.questions.mira.status, 'answered');
  assert.equal(mira.social.pendingQuestionId, null);
  assert.ok(mira.cognition.beliefs.some(belief => belief.source === 'reported' && belief.status === 'unverified' && belief.evidence[0].sourceId === 'human'));
  assert.ok(social.observe(aster).journal.some(message => message.text === 'Hello, both of you.'));
  assert.equal(social.postUserMessage('wrong', {to: 'aster', replyTo: question.message.id}).code, 'WRONG_QUESTION_RECIPIENT');
});

test('human turns queue during sleep and grounded offline answers use sensations rather than reserve numbers', () => {
  const {aster, social, advance} = fixture();
  aster.active = {request: {type: 'sleep'}};
  const message = social.postUserMessage('How are you feeling?', {to: 'aster'}).message;
  assert.equal(aster.social.heard.some(turn => turn.id === message.id), false);
  assert.equal(aster.cognition.beliefs.some(belief => belief.text.includes('How are you feeling')), false);
  aster.active = null; aster.nourishment = 60; aster.hydration = 60;
  const reply = social.maybeDialogue(aster);
  assert.equal(reply.type, 'journal_reply'); assert.equal(reply.replyTo, message.id); assert.equal(reply.offline, true);
  assert.match(reply.text, /peckish|dry mouth/); assert.doesNotMatch(reply.text, /\d|%/);
  assert.equal(social.action(aster, reply).code, 'REPLIED_JOURNAL');
  assert.equal(social.action(aster, reply).code, 'JOURNAL_TURN_ALREADY_REPLIED');
  advance(40); const destination = social.postUserMessage('Where are you going?', {to: 'aster'}).message;
  aster.cognition.plan = {status: 'active', goal: 'Investigate the orchard and return to familiar water'};
  const next = social.maybeDialogue(aster); assert.equal(next.replyTo, destination.id); assert.match(next.text, /Investigate the orchard/);
  aster.nourishment = 10; assert.equal(social.maybeDialogue(aster), null, 'conversation yields to urgent survival');
});

test('field notes remain physical, locally readable, bounded and inert', () => {
  const {aster, mira, environment, social, community} = fixture();
  observeNpc(aster, environment); updateCognition(aster);
  const resource = Object.values(aster.memory.sources)[0], belief = aster.cognition.beliefs.find(belief => belief.resourceId === resource.id);
  const before = JSON.stringify(environment), result = social.action(aster, {type: 'write_note', title: 'Water route', text: `I found water at ${resource.name}.`, beliefIds: [belief.id]});
  assert.equal(result.code, 'WROTE_NOTE'); assert.deepEqual(result.note.position, aster.position); assert.equal(result.note.scene, 'valley');
  assert.equal(JSON.stringify(environment), before);
  assert.equal(social.observe(mira).notes[0].read, false);
  const read = social.action(mira, {type: 'read_note', noteId: result.note.id}); assert.equal(read.code, 'READ_NOTE');
  assert.ok(mira.cognition.beliefs.some(belief => belief.source === 'reported' && belief.resourceId === resource.id && belief.evidence[0].channel === 'note'));
  assert.equal(Object.keys(mira.memory.sources).length, 0);
  assert.equal(social.action(mira, {type: 'read_note', noteId: result.note.id}).reward, 0);
  mira.scene = 'refuge'; assert.equal(social.action(mira, {type: 'read_note', noteId: result.note.id}).code, 'NOTE_OUT_OF_REACH');
  assert.equal(social.action(aster, {type: 'write_note', title: 'fake', text: 'anything', beliefIds: ['belief:other:123']}).code, 'UNKNOWN_NOTE_BELIEF');
  assert.equal(community.notes.length, 1);
});

test('offline sharing does not repeat the same resource on every fresh observation, and notes are produced autonomously', () => {
  const {aster, mira, environment, social, advance} = fixture();
  observeNpc(aster, environment); updateCognition(aster);
  const first = social.maybeDialogue(aster); assert.equal(first.type, 'say'); assert.equal(social.action(aster, first).ok, true);
  advance(40); observeNpc(aster, environment);
  const next = social.maybeDialogue(aster);
  assert.ok(next === null || next.type !== 'say' || next.text !== first.text);
  mira.position = {x: aster.position.x - 500, y: aster.position.y};
  advance(100); aster.flask.water = 1; aster.inventory.apples = [{foodId: 'apple:trail-orchard'}];
  const note = social.maybeDialogue(aster); assert.equal(note.type, 'write_note');
  assert.equal(social.action(aster, note).code, 'WROTE_NOTE'); assert.equal(aster.cognition.lastNoteAt, aster.elapsed);
});

test('validators preserve bounded dialogue, unanswered questions and artifact provenance, stripping forged fields', () => {
  const {aster, mira, environment, community, social} = fixture();
  observeNpc(aster, environment); social.action(aster, {type: 'ask_human', text: 'What lies beyond this trail?', topic: 'trail'});
  social.postUserMessage('Explore carefully.', {to: 'aster'});
  community.messages[0].execute = 'shell'; community.notes.push({id: 'note:999', authorId: 'outsider', title: 'x', text: 'x', scene: 'valley', position: {x: 1, y: 1}});
  const restored = validateCommunity(JSON.parse(JSON.stringify(community)));
  assert.equal(restored.messages[0].execute, undefined); assert.equal(restored.notes.length, 0);
  assert.ok(restored.nextId > Number(restored.messages.at(-1).id.split(':')[1]));
  const memory = validateSocialMemory({...aster.social, execute: 'shell', relationships: {...aster.social.relationships, dragon: {familiarity: 1}, mira: {familiarity: Infinity, trust: 9, exchanges: -100}}, heard: [...aster.social.heard, {senderId: 'dragon', text: 'x'}]}, aster);
  assert.equal(memory.execute, undefined); assert.equal(memory.relationships.dragon, undefined); assert.equal(memory.relationships.mira.trust, 1); assert.equal(memory.relationships.mira.exchanges, 0);
  assert.notEqual(memory, mira.social);
  const malformed = validateCommunity({messages: [{id: 'message:1', at: 0, senderId: 'human', recipientId: 'all', channel: 'peer', text: 'impossible'}]});
  assert.equal(malformed.messages.length, 0);
});

test('social ticking never advances the shared clock or physiology, and repeated ticks at the same clock are inert', () => {
  const {aster, mira, environment, social} = fixture();
  aster.social = createSocialMemory(); aster.social.fulfillment = .8;
  const before = JSON.stringify([environment, aster.hydration, mira.hydration, aster.elapsed, mira.elapsed]);
  social.tick(1); assert.equal(JSON.stringify([environment, aster.hydration, mira.hydration, aster.elapsed, mira.elapsed]), before);
  environment.elapsed = 10; social.tick(1); const fulfillment = aster.social.fulfillment;
  assert.ok(fulfillment < .8); social.tick(1); assert.equal(aster.social.fulfillment, fulfillment);
  social.tick(0); social.tick(NaN); assert.equal(aster.social.fulfillment, fulfillment);
});

test('journal replay after recent-memory eviction cannot farm relationships or repeat delivered beliefs', () => {
  const {aster, social} = fixture();
  social.postUserMessage('The weather could change.', {to: 'aster'});
  const exchanges = aster.social.relationships.human.exchanges, beliefs = aster.cognition.beliefs.length;
  aster.social.heard = [];
  social.observe(aster); social.observe(aster);
  assert.equal(aster.social.relationships.human.exchanges, exchanges);
  assert.equal(aster.cognition.beliefs.length, beliefs);
  aster.social = validateSocialMemory(JSON.parse(JSON.stringify(aster.social)), aster);
  social.observe(aster); assert.equal(aster.social.relationships.human.exchanges, exchanges);
});

test('question novelty remains valid when a migrated world clock is older than the character clock', () => {
  const {aster, environment, social, advance} = fixture();
  environment.elapsed = 7200;
  social.action(aster, {type: 'ask_human', text: 'Have you seen shelter?', topic: 'shelter'});
  advance(400); aster.cognition.lastKnowledgeAt = 380;
  assert.equal(social.action(aster, {type: 'ask_human', text: 'When do apples return?', topic: 'apples'}).code, 'ASKED_HUMAN');
});

test('belonging uses the character clock when the existing world and character ages differ', () => {
  const {aster, environment, social, advance} = fixture();
  environment.elapsed = 1200;
  const message = social.postUserMessage('Hello, Aster.', {to: 'aster'}).message;
  assert.equal(message.at, 1200);
  assert.equal(aster.social.lastContactAt, 0);
  assert.equal(aster.social.relationships.human.lastContactAt, 1200);
  updateCognition(aster); assert.equal(aster.cognition.drives.belonging.tension, 'quiet');
  advance(200); updateCognition(aster);
  assert.equal(aster.cognition.drives.belonging.tension, 'present');
  aster.social = validateSocialMemory(JSON.parse(JSON.stringify(aster.social)), aster);
  assert.equal(aster.social.lastContactAt, 0);
});

test('targeted human answers synchronize cognitive questions whether or not cognition has materialized them', () => {
  for (const materialized of [false, true]) {
    const {aster, mira, social, community, advance} = fixture();
    const first = social.action(aster, {type: 'ask_human', topic: 'apples', text: 'Do apples return?'});
    const other = social.action(mira, {type: 'ask_human', topic: 'caves', text: 'Have you visited a cave?'});
    if (materialized) {updateCognition(aster); updateCognition(mira);}
    const reply = social.postUserMessage('I have seen apples return after some time.', {to: 'aster'});
    assert.equal(reply.message.replyTo, first.message.id);
    assert.equal(reply.message.kind, 'answer');
    assert.equal(community.questions.aster.status, 'answered');
    assert.equal(aster.cognition.questions.find(question => question.messageId === first.message.id).status, 'answered');
    advance(1); updateCognition(aster); updateCognition(mira);
    assert.equal(aster.cognition.questions.find(question => question.messageId === first.message.id).status, 'answered');
    assert.equal(community.questions.mira.status, 'pending');
    assert.equal(mira.cognition.questions.find(question => question.messageId === other.message.id).status, 'unanswered');
  }
});

test('answering an old question updates that cognitive entry without answering the latest question', () => {
  const {aster, social, community, advance} = fixture();
  const first = social.action(aster, {type: 'ask_human', topic: 'apples', text: 'Do apples return?'});
  updateCognition(aster);
  advance(400); aster.cognition.lastKnowledgeAt = 350;
  const latest = social.action(aster, {type: 'ask_human', topic: 'caves', text: 'Have you visited a cave?'});
  social.postUserMessage('I have seen apples return.', {to: 'aster', replyTo: first.message.id});
  advance(1); updateCognition(aster);
  assert.equal(aster.cognition.questions.find(question => question.messageId === first.message.id).status, 'answered');
  assert.equal(aster.cognition.questions.find(question => question.messageId === latest.message.id).status, 'unanswered');
  assert.equal(community.questions.aster.messageId, latest.message.id);
  assert.equal(community.questions.aster.status, 'pending');
});

test('a targeted answer sent during sleep reaches cognition when the character reads the journal awake', () => {
  const {aster, social, community, advance} = fixture();
  const question = social.action(aster, {type: 'ask_human', topic: 'shelter', text: 'Have you seen a cave?'});
  updateCognition(aster); aster.active = {request: {type: 'sleep'}};
  const reply = social.postUserMessage('There may be a cave along the trail.', {to: 'aster'});
  assert.equal(reply.message.replyTo, question.message.id);
  assert.equal(community.questions.aster.status, 'answered');
  assert.equal(aster.cognition.questions[0].status, 'unanswered', 'sleeping does not read the reply');
  aster.active = null; advance(1); social.observe(aster); updateCognition(aster);
  assert.equal(aster.cognition.questions[0].status, 'answered');
  assert.equal(social.observe(aster).pendingQuestion, null);
});
