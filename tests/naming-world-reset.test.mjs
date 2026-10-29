const historicalClone=value=>legacyFixture(globalThis.structuredClone(value));
import { legacyFixture } from './fixtures/legacy-communication.mjs';
// These tests preserve the explicit historical English/naming channel.
const createOzarkState=(...args)=>legacyFixture(rawcreateOzarkState(...args));
const loadOzarkSave=(...args)=>legacyFixture(rawloadOzarkSave(...args));
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState as rawcreateOzarkState, writeOzarkSave, loadOzarkSave as rawloadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc } from '../src/npc.js';
import { PopulationRuntime } from '../src/population.js';
import { installWorldReset } from '../src/world-reset-ui.js';

// This exercises the real reset transaction and population lifecycle with inert
// DOM controls and explicitly mocked token inference. It is not native/model QA.
const geometry=createOzarkWorldGeometry();
const settled=()=>new Promise(resolve=>setImmediate(resolve));
const reply={token:'velari',model:'scripted-world-reset-naming-mock'};
class Element {
  constructor(id){this.id=id;this.handlers={};this.disabled=false;this.checked=false;this.hidden=false;this.textContent='';}
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  async fire(type,options={}){const event={currentTarget:this,preventDefault(){},stopPropagation(){},...options};for(const fn of this.handlers[type]||[])await fn(event);}
  focus(){this.focused=true;}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
function fixture(){
  const state=createOzarkState(geometry),actor=state.agents[0],calls=[],cancels=[],events=[],writes=[];
  const values=new Map([['agent-model-preferences','keep-configured-model'],['aincrad.world.v1','keep-retired-slot']]);
  let failWrite=false,held=false,retired=false,freshState=null,freshRuntime=null;
  const storage={getItem:key=>values.get(key)??null,setItem(key,value){events.push('write');writes.push([key,value]);if(failWrite)throw new DOMException('Scripted quota failure','QuotaExceededError');values.set(key,value);}};
  const providerFactory=n=>({kind:'local-model',label:'Explicit naming/reset test mock',proposeName(request){let resolve;const promise=new Promise(done=>resolve=done);calls.push({agentId:n.id,request,resolve});return promise;},cancel(){cancels.push(n.id);}});
  const runtime=new PopulationRuntime(state,{communicationMode:'legacy',cardinal:false,providerFactory});
  actor.position={x:450,y:1000};for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  // Controlled sample chronology, with the actual world's ordinary sensory
  // adapter. No fabricated cues or hidden species enter the naming request.
  const sample=at=>{state.elapsed=state.environment.elapsed=state.environment.ecology.elapsed=at;for(const n of state.agents)n.elapsed=at;observeNpc(actor,state.environment);};
  sample(60);sample(61);
  const controller=runtime.controller(actor.id);
  const start=()=>{const before=calls.length;controller.maybeName();assert.equal(calls.length,before+1);assert.ok(controller.namingPending);return calls.at(-1);};
  const save=()=>!held&&!retired&&writeOzarkSave(storage,state,geometry);
  const nodes=new Map(),document=new Element('document');
  const $=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);};document.getElementById=$;
  const ui=installWorldReset({document,storage,geometry,previous:()=>state,
    freeze(){events.push('freeze');held=true;},release(){events.push('release');held=false;},
    retire(){events.push('retire');retired=true;runtime.dispose();},
    reload(){events.push('reload');const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false,loaded.error);freshState=loaded.state;freshRuntime=new PopulationRuntime(freshState,{communicationMode:'legacy',cardinal:false,providerFactory});return {ok:true};},
  });
  const checkpoint=()=>{assert.equal(save(),true,state.saveError);events.length=0;writes.length=0;return storage.getItem(OZARK_SAVE_KEY);};
  const open=()=>$('reset-world').fire('click');
  const confirm=async()=>{$('reset-acknowledge').checked=true;await $('reset-acknowledge').fire('change');await $('reset-confirm').fire('click');};
  const cleanup=()=>{runtime.dispose();freshRuntime?.dispose();};
  return {state,actor,runtime,controller,storage,values,calls,cancels,events,writes,ui,$,sample,start,save,checkpoint,open,confirm,cleanup,
    failWrites:()=>failWrite=true,freshState:()=>freshState,freshRuntime:()=>freshRuntime,retired:()=>retired};
}

for(const phase of ['pending inference','reply queued before next ordinary perception'])test(`confirmed world reset excludes ${phase} from both old and fresh worlds`,async()=>{
  const f=fixture();try{
    const call=f.start();
    if(phase.startsWith('reply')){call.resolve(reply);await settled();assert.equal(f.controller.namingPending.received,true);assert.equal(f.actor.categoryNames.own.length,0);}
    const oldRaw=f.checkpoint();assert.equal(JSON.parse(oldRaw).agents[0].categoryNames.admissions.length,1);
    await f.open();assert.equal(f.save(),false,'open reset holds ordinary saves');assert.equal(f.runtime.disposed,false,'opening alone is not destructive');
    await f.confirm();
    assert.deepEqual(f.events,['freeze','retire','write','reload']);assert.equal(f.writes.length,1);assert.deepEqual(f.cancels,['aster','mira']);
    assert.equal(f.runtime.disposed,true);assert.equal(f.controller.namingPending,null);assert.equal(f.controller.namingStatus.state,'cancelled');
    const fresh=f.freshState();assert.ok(fresh);assert.equal(fresh.elapsed,0);
    for(const n of fresh.agents){assert.equal(n.categoryNames,undefined);assert.equal(n.lexicon,undefined);assert.equal(f.freshRuntime().controller(n.id).namingPending,null);}
    const oldSnapshot=JSON.stringify(f.state),newSnapshot=JSON.stringify(fresh),stored=f.storage.getItem(OZARK_SAVE_KEY);
    call.resolve({...reply,token:'lateword'});await settled();f.controller.finishNaming();f.runtime.tick(.25);
    assert.equal(JSON.stringify(f.state),oldSnapshot,'obsolete callback cannot mutate the retired world');
    assert.equal(JSON.stringify(fresh),newSnapshot,'obsolete callback cannot reach the new population');
    assert.equal(f.storage.getItem(OZARK_SAVE_KEY),stored);assert.notEqual(stored,oldRaw);assert.equal(f.save(),false);
    assert.equal(f.values.get('agent-model-preferences'),'keep-configured-model');assert.equal(f.values.get('aincrad.world.v1'),'keep-retired-slot');
    assert.equal(f.writes.length,1,'late completion cannot create another save');
  }finally{f.cleanup();}
});

async function retainedNameWithAnotherPendingRequest(){
  const f=fixture(),first=f.start();first.resolve(reply);await settled();f.sample(62);f.controller.finishNaming();
  assert.equal(f.actor.categoryNames.own[0].token,'velari');
  f.sample(121);f.sample(122);const pending=f.start(),raw=f.checkpoint();
  assert.equal(loadOzarkSave(f.storage,geometry).blocked,false);return {...f,pending,raw};
}

test('canceling reset preserves saved vocabulary and keeps the live population without applying a queued name while frozen',async()=>{
  const f=await retainedNameWithAnotherPendingRequest();try{
    const retained=historicalClone(f.actor.categoryNames);await f.open();f.pending.resolve({...reply,token:'seluni'});await settled();
    assert.equal(f.controller.namingPending.received,true);assert.deepEqual(f.actor.categoryNames,retained);assert.equal(f.storage.getItem(OZARK_SAVE_KEY),f.raw);
    await f.$('reset-cancel').fire('click');assert.deepEqual(f.events,['freeze','release']);assert.equal(f.runtime.disposed,false);assert.equal(f.retired(),false);assert.equal(f.ui.active(),false);assert.equal(f.cancels.length,0);
    const restored=loadOzarkSave(f.storage,geometry);assert.equal(restored.blocked,false,restored.error);assert.deepEqual(restored.state.agents[0].categoryNames,retained);assert.equal(f.writes.length,0);
    // Canceling is not a reset: ordinary life may continue later. A queued
    // response has still not become a name without the next ordinary sense.
    assert.equal(f.actor.categoryNames.own.length,1);assert.equal(f.freshState(),null);
  }finally{f.cleanup();}
});

test('verified reset write failure retires pending inference but preserves previously saved names and bytes',async()=>{
  const f=await retainedNameWithAnotherPendingRequest();try{
    const retained=historicalClone(f.actor.categoryNames);await f.open();f.failWrites();await f.confirm();
    assert.deepEqual(f.events,['freeze','retire','write']);assert.equal(f.runtime.disposed,true);assert.equal(f.controller.namingPending,null);assert.deepEqual(f.cancels,['aster','mira']);
    assert.match(f.$('reset-status').textContent,/Readback confirms the original stored world/);assert.equal(f.$('reset-cancel').disabled,true);assert.equal(f.freshState(),null);
    const snapshot=JSON.stringify(f.state);f.pending.resolve({...reply,token:'seluni'});await settled();f.controller.finishNaming();f.runtime.tick(.25);
    assert.equal(JSON.stringify(f.state),snapshot);assert.equal(f.storage.getItem(OZARK_SAVE_KEY),f.raw);assert.equal(f.save(),false);
    const restored=loadOzarkSave(f.storage,geometry);assert.equal(restored.blocked,false,restored.error);assert.deepEqual(restored.state.agents[0].categoryNames,retained);assert.equal(restored.state.agents[0].categoryNames.own.length,1);
    assert.equal(f.values.get('agent-model-preferences'),'keep-configured-model');assert.equal(f.writes.length,1);
  }finally{f.cleanup();}
});
