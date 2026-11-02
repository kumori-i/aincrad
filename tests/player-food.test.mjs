import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, getOzarkSaveFailure } from '../src/ozark-save.js';
import { createPlayerFoodController } from '../src/player-food.js';
import { consumeEcologyMaterial, lookupEcologyObject } from '../src/ecology.js';
import { PopulationRuntime } from '../src/population.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { subscribeConsumption } from '../src/consumption-events.js';
import { ingestMaterial } from '../src/biology.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { npcEffortCost } from '../src/npc-effort-funding.js';

const baseGeometry = createOzarkWorldGeometry();
function fixture({withPopulation = false} = {}) {
  let visible = true;
  const geometry = Object.freeze({...baseGeometry,
    lineOfSight: (from, to) => visible && baseGeometry.lineOfSight(from, to)});
  const state = createOzarkState(geometry, {communicationSeed: 211});
  const source = state.environment.ecology.plants.find(p =>
    p.kind === 'apple_tree' && p.stage === 'ripe' && p.quantity > 2 &&
    geometry.canOccupy(p.position.x + 45, p.position.y, CONFIG.playerRadius) &&
    baseGeometry.lineOfSight({x:p.position.x + 45,y:p.position.y},p.position));
  assert.ok(source, 'a real ripe apple tree is reachable in the fixed world');
  state.player = {x: source.position.x + 45, y: source.position.y};
  const controller = createPlayerFoodController(state, geometry);
  if(withPopulation) for(const agent of state.agents) bindOzarkWorldAgent(agent,geometry,state);
  const population = withPopulation ? new PopulationRuntime(state,{cardinal:false}) : null;
  const events = [];
  const unsubscribe = subscribeConsumption(state.environment.ecology, event => events.push(event));
  function advance(seconds = 10) {
    const steps = Math.ceil(seconds / CONFIG.fixedStep);
    for (let i = 0; i < steps; i++) {
      state.elapsed += CONFIG.fixedStep;
      population?.tick(CONFIG.fixedStep);
      const result = controller.tick(CONFIG.fixedStep);
      if (result) return result;
    }
    return null;
  }
  function perform(type, id) {
    const started = controller.start(type, id);
    assert.equal(started.ok, true, `${type}: ${started.code}`);
    const result = advance();
    assert.ok(result, `${type} must finish or expire`);
    return result;
  }
  return {geometry, state, source, controller, population, events, advance, perform,
    setVisible: value => {visible = value;}, close: () => {unsubscribe(); controller.dispose(); population?.dispose();}};
}

test('real paid pull, taste and release debit effort, finite stock and remaining hand matter', () => {
  const f = fixture();
  try {
    const {state, source, controller} = f;
    const initialQuantity = source.quantity;
    const initialEnergy = state.playerFood.physiology.availableEnergyKcal;
    const initialMetabolized = state.playerFood.physiology.totals.metabolizedKcal;
    const choices = controller.visibleOptions();
    const option = choices.find(row => row.targetId === source.id);
    assert.deepEqual(option.actions, ['pull']);
    assert.equal(option.held, false);
    const initialOptions = structuredClone(choices);
    option.appearance.color = 'changed';
    assert.deepEqual(controller.visibleOptions(), initialOptions, 'readout is defensive');
    const pulled = f.perform('pull', source.id);
    assert.equal(pulled.ok, true);
    assert.ok(Math.abs(pulled.durationSeconds - DISCOVERY_RULES.durations.pull) < 1e-8);
    assert.ok(Math.abs(pulled.paidKcal - npcEffortCost(5, 1.5)) < 1e-8);
    assert.equal(source.quantity, initialQuantity - 1);
    assert.equal(f.events.length, 0);
    const itemId = pulled.materialId;
    assert.equal(state.playerFood.inventory.items.includes(itemId), true);
    const material = lookupEcologyObject(state.environment.ecology, itemId);
    assert.equal(material.heldBy, 'player');
    assert.deepEqual(controller.visibleOptions().find(row => row.targetId === itemId).actions,
      ['sample','release']);
    const grams = material.massGrams;
    const tasted = f.perform('sample', itemId);
    assert.equal(tasted.ok, true);
    assert.ok(Math.abs(tasted.durationSeconds - DISCOVERY_RULES.durations.sample) < 1e-8);
    assert.equal(material.massGrams, grams - DISCOVERY_RULES.sampleGrams);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].actorId, 'player');
    assert.deepEqual(f.events[0].actorPosition, state.player);
    assert.equal(f.events[0].source.id, itemId);
    assert.deepEqual(f.events[0].source.position, state.player);
    assert.ok(state.playerFood.physiology.totals.ingestedKcal > 0);
    assert.ok(Math.abs(initialEnergy - state.playerFood.physiology.availableEnergyKcal -
      (state.playerFood.physiology.totals.metabolizedKcal - initialMetabolized)) < 1e-8);
    assert.equal(state.playerBody.stamina, state.playerFood.physiology.stamina);
    assert.equal(state.playerBody.health, state.playerFood.physiology.health);
    const released = f.perform('release', itemId);
    assert.equal(released.ok, true);
    assert.equal(material.heldBy, null);
    assert.deepEqual(material.position, state.player);
    assert.deepEqual(controller.snapshot().held, []);
    assert.equal(f.events.length, 1);
    const grasped = f.perform('grasp', itemId);
    assert.equal(grasped.ok, true);
    assert.equal(material.heldBy, 'player');
    assert.deepEqual(controller.snapshot().held, [itemId]);
  } finally { f.close(); }
});

test('partial work, duplicate admission and avatar movement cannot spend or transfer twice', () => {
  const f = fixture();
  try {
    const before = f.source.quantity;
    assert.equal(f.controller.start('pull', f.source.id).ok, true);
    assert.equal(f.controller.start('pull', f.source.id).code, 'ACTION_BUSY');
    for (let i = 0; i < 60; i++) {
      f.state.elapsed += CONFIG.fixedStep;
      assert.equal(f.controller.tick(CONFIG.fixedStep), null);
    }
    const partial = f.controller.snapshot().active;
    assert.ok(partial.worked > 0 && partial.worked < 5);
    const cancelled = f.controller.cancel();
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.durationSeconds, partial.worked);
    assert.ok(cancelled.paidKcal > 0);
    assert.equal(f.controller.cancel(), null);
    assert.equal(f.source.quantity, before);
    assert.deepEqual(f.controller.snapshot().held, []);
    assert.equal(f.events.length, 0);
    assert.equal(f.controller.start('pull', f.source.id).ok, true);
    f.state.player.x += 1;
    f.state.elapsed += CONFIG.fixedStep;
    assert.equal(f.controller.tick(CONFIG.fixedStep).code, 'ACTION_INTERRUPTED');
    assert.equal(f.source.quantity, before);
  } finally { f.close(); }
});

test('occlusion, reach, disappearance and changed physical owner block admission or completion', () => {
  const f = fixture();
  try {
    f.setVisible(false);
    assert.equal(f.controller.start('pull', f.source.id).code, 'OUT_OF_REACH_OR_SIGHT');
    assert.equal(f.controller.visibleOptions().some(row => row.targetId === f.source.id), false);
    f.setVisible(true);
    f.state.player.x += 100;
    assert.equal(f.controller.start('pull', f.source.id).code, 'OUT_OF_REACH_OR_SIGHT');
    f.state.player.x -= 100;
    assert.equal(f.controller.start('pull', f.source.id).ok, true);
    f.setVisible(false);
    f.state.elapsed += CONFIG.fixedStep;
    assert.equal(f.controller.tick(CONFIG.fixedStep).code, 'OUT_OF_REACH_OR_SIGHT');
    f.setVisible(true);
    assert.equal(f.controller.start('pull', f.source.id).ok, true);
    f.state.environment.ecology.plants.splice(
      f.state.environment.ecology.plants.indexOf(f.source),1);
    f.state.elapsed += CONFIG.fixedStep;
    assert.equal(f.controller.tick(CONFIG.fixedStep).code, 'OBJECT_GONE');
    assert.equal(f.events.length, 0);
  } finally { f.close(); }
});

test('failed swallowing preserves held stock and emits no teaching event', () => {
  const f = fixture();
  try {
    const itemId = f.perform('pull', f.source.id).materialId;
    const item = lookupEcologyObject(f.state.environment.ecology, itemId);
    const beforeMass = item.massGrams;
    assert.equal(f.controller.start('sample', itemId).ok, true);
    const actor = {species:'human', physiology:f.state.playerFood.physiology,
      lifecycle:'AWAKE', elapsed:f.state.elapsed};
    assert.equal(ingestMaterial(actor,{massGrams:1390,energyKcal:0,waterMl:0}).ok,true);
    const result = f.advance();
    assert.equal(result.ok,false);
    assert.equal(result.code,'TOO_FULL');
    assert.equal(item.massGrams,beforeMass);
    assert.equal(f.events.length,0);
    assert.deepEqual(f.controller.snapshot().held,[itemId]);
  } finally { f.close(); }
});

test('last ripe portion and finite hand capacity refuse further gathering', () => {
  const f = fixture();
  try {
    f.source.quantity = 4; // Explicit finite-stock engineering boundary.
    const ids = [];
    for (let i=0;i<4;i++) ids.push(f.perform('pull', f.source.id).materialId);
    assert.equal(f.source.quantity, 0);
    assert.deepEqual(f.controller.snapshot().held,ids);
    const available = f.state.environment.ecology.plants.filter(p =>
      p.kind === 'bramble' && p.stage === 'ripe' && p.quantity > 0);
    const bramble = available.find(p =>
      baseGeometry.canOccupy(p.position.x + 45,p.position.y,CONFIG.playerRadius) &&
      baseGeometry.lineOfSight({x:p.position.x+45,y:p.position.y},p.position));
    assert.ok(bramble);
    // Capacity is an admission gate; it cannot silently displace held matter.
    assert.equal(f.controller.start('pull',bramble.id).code,'OUT_OF_REACH_OR_SIGHT');
    f.state.player={x:bramble.position.x+45,y:bramble.position.y};
    assert.equal(f.controller.start('pull',bramble.id).code,'HANDS_FULL');
    assert.equal(ids.every(id=>lookupEcologyObject(f.state.environment.ecology,id)?.heldBy==='player'),true);
    assert.equal(f.perform('release',ids[0]).ok,true);
    f.state.player={x:f.source.position.x+45,y:f.source.position.y};
    assert.equal(f.controller.start('pull',f.source.id).code,'NO_RIPE_FRUIT');
  } finally { f.close(); }
});

test('held fruit follows its moving owner, but movement interrupts any funded action', () => {
  const f = fixture();
  try {
    const id = f.perform('pull', f.source.id).materialId;
    const item = lookupEcologyObject(f.state.environment.ecology,id);
    f.state.player = {...f.state.player,x:f.state.player.x+8};
    f.controller.tick(CONFIG.fixedStep);
    assert.deepEqual(item.position,f.state.player);
    assert.equal(f.controller.start('sample',id).ok,true);
    f.state.player.y += 2;
    f.state.elapsed += CONFIG.fixedStep;
    assert.equal(f.controller.tick(CONFIG.fixedStep).code,'ACTION_INTERRUPTED');
    assert.equal(f.events.length,0);
    assert.equal(f.controller.snapshot().active,null);
  } finally { f.close(); }
});

test('deadline, exhausted work funding and disposal never grant stock or replay', () => {
  const f = fixture();
  try {
    const before=f.source.quantity;
    assert.equal(f.controller.start('pull',f.source.id).ok,true);
    f.state.playerFood.physiology.availableEnergyKcal=0;
    f.state.elapsed+=10;
    const expired=f.controller.tick(10);
    assert.equal(expired.code,'ACTION_TIMEOUT');
    assert.equal(expired.durationSeconds,0);
    assert.equal(f.source.quantity,before);
    assert.equal(f.controller.tick(1),null);
    f.state.playerFood.physiology.availableEnergyKcal=100;
    assert.equal(f.controller.start('pull',f.source.id).ok,true);
    assert.equal(f.controller.dispose().code,'ACTION_INTERRUPTED');
    assert.equal(f.controller.start('pull',f.source.id).code,'OWNER_CHANGED');
    assert.equal(f.events.length,0);
  } finally { f.close(); }
});

test('a skipped deadline or replaced player-food epoch cannot resume an old action', () => {
  const f = fixture();
  try {
    const before = f.source.quantity;
    assert.equal(f.controller.start('pull',f.source.id).ok,true);
    f.state.elapsed += 10.1;
    const expired = f.controller.tick(10.1);
    assert.equal(expired.code,'ACTION_TIMEOUT');
    assert.equal(expired.durationSeconds,0);
    assert.equal(f.source.quantity,before);
    assert.equal(f.controller.start('pull',f.source.id).ok,true);
    const saved = structuredClone(f.state.playerFood);
    assert.deepEqual(Object.keys(saved).sort(),['inventory','physiology','version']);
    f.state.playerFood = structuredClone(saved); // Reopen/reset owner epoch.
    f.state.elapsed += CONFIG.fixedStep;
    assert.equal(f.controller.tick(CONFIG.fixedStep).code,'ACTION_INTERRUPTED');
    assert.equal(f.controller.start('pull',f.source.id).code,'OWNER_CHANGED');
    assert.equal(f.source.quantity,before);
  } finally { f.close(); }
});

test('real ecology expiry reconciles a held remnant before strict save and reopen', () => {
  const f = fixture({withPopulation:true});
  try {
    const id = f.perform('pull',f.source.id).materialId;
    const ecology = f.state.environment.ecology;
    const material = lookupEcologyObject(ecology,id);
    const tinyRemainder = .100001;
    const fraction = 1-tinyRemainder/material.massGrams;
    const actor = {species:'human', lifecycle:'AWAKE',
      physiology:f.state.playerFood.physiology, elapsed:f.state.elapsed};
    const eaten = consumeEcologyMaterial(ecology,id,fraction,{actorId:'player',
      accept:portion=>ingestMaterial(actor,portion,{objectId:id,at:f.state.elapsed})});
    assert.equal(eaten.ok,true);
    assert.ok(material.massGrams>.1);
    assert.equal(f.controller.start('sample',id).ok,true);
    // Author an already aged physical remnant, then let the real ecology
    // half-second material step remove its last measurable mass.
    material.ageHours = 12*24;
    material.spoiled = true;
    for (let i=0;i<2;i++) {
      f.state.elapsed += .25;
      f.population.tick(.25);
    }
    assert.equal(lookupEcologyObject(ecology,id),null);
    const interrupted = f.controller.reconcileHeld();
    assert.equal(interrupted.code,'OBJECT_GONE');
    assert.deepEqual(f.controller.snapshot().held,[]);
    assert.equal(f.events.length,0);
    const values=new Map();
    const disk={getItem:key=>values.get(key)??null,
      setItem:(key,value)=>values.set(key,value)};
    assert.deepEqual(f.state.agents.map(a=>a.elapsed),[f.state.elapsed,f.state.elapsed]);
    assert.equal(writeOzarkSave(disk,f.state,baseGeometry),true,getOzarkSaveFailure(f.state));
    const opened=loadOzarkSave(disk,baseGeometry);
    assert.equal(opened.blocked,false,opened.error);
    assert.deepEqual(opened.state.playerFood.inventory.items,[]);
  } finally { f.close(); }
});
