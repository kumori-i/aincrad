import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SOCIAL_RULES } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { bindOzarkEcology } from '../src/ozark-ecology.js';
import { observeNpc } from '../src/npc.js';
import { SocialCoordinator } from '../src/social.js';
import { CategoryNameRuntime, CATEGORY_ACK_WINDOW_SECONDS } from '../src/category-name-runtime.js';
import { namingProposal, beginNamingProposal, acceptNamingProposal, categoryLabels, resolveCategoryName, validCategoryCorrespondence } from '../src/category-names.js';
import { visualSampleCurrent } from '../src/visual-group-memory.js';

const geometry = createOzarkWorldGeometry();
const clone = structuredClone;
const equalPoint = (a, b) => a.x === b.x && a.y === b.y;
const baseline = createOzarkState(geometry);

function fixture({fresh = false} = {}) {
  let visible = true, selected = [], actors = [];
  const seenBy = new Map();
  // Disclosed controlled LOS fixture: actual ecological objects, normal sensing
  // and real geometry. The local-model token below is explicitly a mock reply.
  const g = Object.freeze({...geometry, lineOfSight:(from, to) => {
    if (!visible) return false;
    if (actors.some(n => equalPoint(n.position, to))) return geometry.lineOfSight(from, to);
    const viewer = actors.find(n => equalPoint(n.position, from));
    return (seenBy.get(viewer?.id) || selected).some(p => equalPoint(p.position, to)) && geometry.lineOfSight(from, to);
  }});
  // Reuse immutable fresh-world bytes for independent sensory fixtures. The
  // save test creates its own registered state rather than bypassing save CAS.
  const state = fresh ? createOzarkState(geometry) : clone(baseline), [a, b] = state.agents, e = state.environment;
  bindOzarkEcology(e.ecology, g);
  actors = state.agents;
  const spawn = geometry.agentSpawns.aster;
  const trees = e.ecology.plants.filter(p => p.kind === 'apple_tree' && p.quantity > 2 &&
    Math.hypot(p.position.x - spawn.x, p.position.y - spawn.y) < 3000);
  for (const source of trees) {
    const p = {x:source.position.x + 45, y:source.position.y}, q = {x:p.x + 20, y:p.y};
    if (![p, q].every(v => geometry.canOccupy(v.x, v.y, CONFIG.playerRadius))) continue;
    const target = trees.find(t => t !== source && Math.hypot(t.position.x - source.position.x, t.position.y - source.position.y) > 25 &&
      [p, q].every(v => Math.hypot(v.x - t.position.x, v.y - t.position.y) < 340 && geometry.lineOfSight(v, t.position)));
    if (!target || ![p, q].every(v => geometry.lineOfSight(v, source.position)) || !geometry.lineOfSight(p, q)) continue;
    selected = [source, target]; a.position = p; b.position = q; break;
  }
  assert.equal(selected.length, 2);
  const time = at => { state.elapsed = e.elapsed = e.ecology.elapsed = at; for (const n of state.agents) n.elapsed = at; };
  time(60);
  for (const n of state.agents) bindOzarkWorldAgent(n, g, state);
  const social = new SocialCoordinator({getAgents:() => state.agents, getEnvironment:() => e, getCommunity:() => state.community});
  const runtime = new CategoryNameRuntime(social);
  const sample = (n = null) => { for (const actor of n ? [n] : state.agents) observeNpc(actor, e); };
  const name = () => {
    const request = namingProposal(a); assert.ok(request, 'ordinary repeated visual sample admits mock model request');
    assert.equal(beginNamingProposal(a, request), true);
    assert.equal(acceptNamingProposal(a, request, {token:'velora', model:'mock-category-test'}), true);
    return a.categoryNames.own[0];
  };
  return {state, a, b, e, g, pair:selected, social, runtime, time, sample, name, seenBy, visible:v => { visible = v; }};
}

function readyFixture(options) { const f = fixture(options); f.sample(); f.time(61); f.sample(); f.name(); return f; }
const physical = f => clone(f.state.agents.map(n => ({rng:n.rng, inventory:n.inventory, physiology:n.physiology,
  experiments:n.discovery.experiments, effects:n.discovery.effects, techniques:n.discovery.techniques, practice:n.discovery.practice})));
const storage = () => { const values = new Map(); return {getItem:k => values.get(k) ?? null, setItem:(k, v) => values.set(k, v)}; };

test('actual unique pointing grounds only the listener own repeated example, not speaker extension', () => {
  const f = fixture();
  f.seenBy.set('mira', [f.pair[0]]);
  f.sample(); f.time(61); f.sample(); const own = f.name();
  const before = physical(f), listenerSamples = clone(f.b.discovery.visualSamples);
  f.runtime.tick();
  assert.equal(f.b.categoryNames.heard.length, 1);
  const heard = f.b.categoryNames.heard[0];
  assert.equal(heard.token, 'velora'); assert.equal(heard.example.objectId, f.pair[0].id);
  assert.deepEqual(heard.example.times, listenerSamples.records[0].times);
  assert.equal(categoryLabels(f.a)[0].members.length, 2);
  assert.equal(categoryLabels(f.b)[0].members.length, 1);
  assert.deepEqual(f.b.discovery.visualSamples, listenerSamples, 'gesture refresh does not mint ordinary samples');
  assert.equal(own.announcedTo.length, 1); assert.equal(validCategoryCorrespondence(f.state.agents), true);
  assert.deepEqual(physical(f), before, 'naming cannot grant physical outcomes or food knowledge');
  assert.match(f.state.community.messages.at(-1).text, /tentative appearance name/);
});

test('listener applies grounded word to own later lookalike, and singular ambiguity asks for a point', () => {
  const f = fixture(); f.seenBy.set('mira', [f.pair[0]]);
  f.sample(); f.time(61); f.sample(); f.name(); f.runtime.tick();
  assert.equal(categoryLabels(f.b)[0].members.length, 1);
  f.seenBy.delete('mira'); f.time(62); f.sample();
  assert.equal(categoryLabels(f.b)[0].members.length, 1, 'one new sighting is not repeated support');
  f.time(63); f.sample();
  assert.equal(categoryLabels(f.b)[0].members.length, 2);
  assert.equal(resolveCategoryName(f.b, 'velora', 'aster', f.social.naming.visible(f.b)), null);
  f.runtime.tick();
  assert.match(f.state.community.messages.at(-1).text, /cannot pick a single velora/);
  assert.equal(f.runtime.pendingCount(), 0);
});

test('same prose alone, one sample, stale ordinary sample and ambiguous gesture cannot teach a category', () => {
  const textOnly = readyFixture();
  assert.equal(textOnly.social.say(textOnly.a, {targetId:'mira', text:'I call things that look like this velora.', offline:true}).ok, true);
  assert.equal(textOnly.b.categoryNames, undefined);
  for (const reason of ['one sample', 'stale sample', 'ambiguous point']) {
    const f = readyFixture();
    if (reason === 'one sample') f.b.discovery.visualSamples.records.forEach(row => { row.times = [61]; });
    if (reason === 'stale sample') f.time(62);
    if (reason === 'ambiguous point') {
      const original = f.social.naming.visible.bind(f.social.naming);
      f.social.naming.visible = n => {
        const objects = original(n);
        return n === f.b ? [...objects, ...objects.map(o => ({...o, id:`object:${900000 + Number(o.id.slice(7))}`}))] : objects;
      };
    }
    f.runtime.tick();
    assert.equal(f.b.categoryNames, undefined, reason);
    assert.equal(f.a.categoryNames.own[0].announcedTo.length, 0, reason);
  }
});

test('range, sleep, occlusion, urgent care and a vanished referent prevent local category transport', () => {
  for (const reason of ['range', 'sleep', 'occlusion', 'urgent care', 'vanished']) {
    const f = readyFixture();
    if (reason === 'range') f.b.position.x += SOCIAL_RULES.peerRange + 1;
    if (reason === 'sleep') f.b.lifecycle = 'COLLAPSED';
    if (reason === 'occlusion') f.visible(false);
    if (reason === 'urgent care') f.b.physiology.waterDeficitMl = 5000;
    if (reason === 'vanished') for (const source of f.pair) source.position = {x:source.position.x + 2000, y:source.position.y};
    f.runtime.tick(); assert.equal(f.b.categoryNames, undefined, reason);
  }
});

test('announcements do not repeat; acknowledgement obeys cooldown, expires and epoch/disposal guards', () => {
  const f = readyFixture(); f.b.social.lastSpokeAt = 61; f.runtime.tick();
  assert.equal(f.runtime.pendingCount(), 1); assert.equal(f.state.community.messages.length, 1);
  f.time(62); f.sample(); f.runtime.tick(); assert.equal(f.state.community.messages.length, 1, 'listener speech cooldown respected');
  f.time(61 + SOCIAL_RULES.speechCooldown); f.sample(); f.runtime.tick();
  assert.equal(f.state.community.messages.length, 2);
  f.time(100); f.sample(); f.runtime.tick(); assert.equal(f.state.community.messages.length, 2, 'one introduction per peer is retained');
  for (const reason of ['epoch', 'dispose', 'expiry', 'new environment', 'replaced actor']) {
    const g = readyFixture(); g.runtime.tick(); assert.equal(g.runtime.pendingCount(), 1);
    if (reason === 'epoch') g.b.epoch++;
    if (reason === 'dispose') g.runtime.dispose();
    if (reason === 'new environment') g.social.getEnvironment = () => ({...g.e});
    if (reason === 'replaced actor') g.state.agents[1] = clone(g.b);
    g.time(reason === 'expiry' ? 61 + CATEGORY_ACK_WINDOW_SECONDS : 62); g.sample(); g.runtime.tick();
    assert.equal(g.runtime.pendingCount(), 0, reason);
    assert.equal(g.state.community.messages.length, 1, reason);
  }
});

test('strict save roundtrip keeps own/heard examples but cannot replay pending acknowledgement or create sight', () => {
  const f = readyFixture({fresh:true}); f.runtime.tick(); assert.equal(f.runtime.pendingCount(), 1);
  const disk = storage(); assert.equal(writeOzarkSave(disk, f.state, f.g), true);
  const loaded = loadOzarkSave(disk, f.g); assert.equal(loaded.blocked, false, loaded.error);
  const state = loaded.state, [a, b] = state.agents;
  assert.deepEqual(a.categoryNames, f.a.categoryNames); assert.deepEqual(b.categoryNames, f.b.categoryNames);
  assert.equal(visualSampleCurrent(b, b.categoryNames.heard[0].example.objectId), false);
  const social = new SocialCoordinator({getAgents:() => state.agents, getEnvironment:() => state.environment, getCommunity:() => state.community});
  const runtime = new CategoryNameRuntime(social), before = state.community.messages.length;
  assert.equal(runtime.pendingCount(), 0); runtime.tick();
  assert.equal(state.community.messages.length, before);
});
