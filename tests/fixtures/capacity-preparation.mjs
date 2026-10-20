// Deterministic copied physical fixture, not a fresh-world autonomy claim.
// Every food/handling proof and swallowed portion is earned through native actions.
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../../src/ozark-world-geometry.js';
import { createOzarkState } from '../../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../../src/ozark-agent-world.js';
import { tickEnvironment } from '../../src/environment.js';
import { tickOzarkEcology, bindOzarkEcology } from '../../src/ozark-ecology.js';
import { observeNpc, requestNpcAction, tickNpc } from '../../src/npc.js';
import { projectPhysiology } from '../../src/biology.js';
import { processDiscoveryFeedback } from '../../src/discovery.js';
import { retainedProofIntegrityError } from '../../src/proof-retention.js';

const geometry = createOzarkWorldGeometry();
const clone = structuredClone;
function bind(state) { bindOzarkEcology(state.environment.ecology,geometry); for (const n of state.agents) bindOzarkWorldAgent(n, geometry, state); return { state, n:state.agents[0], e:state.environment, source:state.environment.ecology.plants.find(p=>p.id==='object:683') }; }
function tick(f, seconds=.1) {
  const steps=Math.ceil(seconds/.1), dt=seconds/steps;
  for(let i=0;i<steps;i++) {
    f.state.elapsed+=dt; tickEnvironment(f.e,dt); tickOzarkEcology(f.e.ecology,dt,f.e,f.state.agents,{},geometry);
    for(const n of f.state.agents) { tickNpc(n,dt,f.e); processDiscoveryFeedback(n); }
  }
}
function act(f,action) {
  const result=requestNpcAction(f.n,action,f.e);
  if(['STARTED','ACTION_STARTED'].includes(result.code))for(let i=0;i<1200&&f.n.active;i++)tick(f);
  assert.equal(f.n.active,null,`bounded ${action.type}`); return f.n.lastResult||result;
}
function comfortableHungry(n) {
  // Explicit bodily isolation fixture, not a fresh-world survival trajectory.
  Object.assign(n.physiology,{hoursSinceMeal:12,waterDeficitMl:250,stamina:95,fatigue:5,sleepPressure:10});
  n.thermal.hot=n.thermal.cold=0;projectPhysiology(n);
}
function place(f,point) { assert.equal(geometry.canOccupy(point.x,point.y),true);f.n.position={...point};observeNpc(f.n,f.e); }
let cached;
function fixture() {
  if(!cached) {
    const f=bind(createOzarkState(geometry)),{n,source}=f;
    // Source identity is selected only by this deterministic test fixture.
    // The actor earns every technique, handling witness, and pending ingestion.
    place(f,{x:source.position.x+20,y:source.position.y});comfortableHungry(n);
    assert.equal(act(f,{type:'pull',targetId:source.id}).ok,true);const food=n.inventory.items[0];
    assert.equal(act(f,{type:'sample',targetId:food}).ok,true);
    for(let i=0;i<1200&&!n.discovery.techniques.length;i++)tick(f);
    assert.ok(n.discovery.techniques.some(t=>t.sourceId===source.id));
    assert.equal(act(f,{type:'sample',targetId:food}).ok,true);assert.equal(n.inventory.items.length,0);
    const grass=f.e.ecology.plants.find(p=>p.id==='object:670');place(f,{x:grass.position.x+20,y:grass.position.y});
    for(let i=0;i<4;i++) {
      assert.equal(act(f,{type:'pull',targetId:grass.id}).ok,true);const id=n.inventory.items.at(-1);
      assert.equal(act(f,{type:'release',targetId:id}).ok,true);assert.equal(act(f,{type:'grasp',targetId:id}).ok,true);
    }
    for(const id of [...n.inventory.items])assert.equal(act(f,{type:'sample',targetId:id}).ok,true);
    place(f,{x:source.position.x+20,y:source.position.y});comfortableHungry(n);
    assert.equal(n.inventory.items.length,4);assert.ok(n.inventory.items.every(id=>n.discovery.samplesPending[id]!==undefined));
    assert.ok(n.inventory.items.every(id=>!n.discovery.effects.some(e=>e.objectId===id&&e.effect==='sustained')));
    assert.equal(retainedProofIntegrityError(n),null);cached=clone(f.state);
  }
  const f=bind(clone(cached));observeNpc(f.n,f.e);return f;
}
function pendingIdentity(n) { return n.physiology.stomach.map(p=>({id:p.id,objectId:p.objectId,actionId:p.actionId,at:p.at,provenance:p.provenance,originalMassGrams:p.originalMassGrams,digestHours:p.digestHours})); }


export { geometry, fixture, tick, act, place, comfortableHungry, pendingIdentity };
