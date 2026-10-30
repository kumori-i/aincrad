import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarcassDiskFixture } from './fixtures/carcass-encounter.mjs';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { loadOzarkSave, writeOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc,requestNpcAction,tickNpc } from '../src/npc.js';
import { PopulationRuntime } from '../src/population.js';
import { lookupEcologyObject, ecologyEnergy } from '../src/ecology.js';
import { ECOLOGY_RULES as R } from '../src/ecology-config.js';
const geometry=createOzarkWorldGeometry(),clone=structuredClone;
const storage=bytes=>({bytes,getItem(){return this.bytes;},setItem(k,v){assert.equal(k,OZARK_SAVE_KEY);this.bytes=v;}});
function fixture(stage='relation',binding=geometry){const input=createCarcassDiskFixture(stage),disk=storage(input.raw),opened=loadOzarkSave(disk,geometry);assert.equal(opened.blocked,false,opened.error);const state=opened.state,n=state.agents[0],e=state.environment.ecology;for(const a of state.agents)bindOzarkWorldAgent(a,binding,state);return{input,disk,state,n,e,source:lookupEcologyObject(e,input.carcassId)};}
test('optional relation, finite piece ownership and restart interruption roundtrip without new observations',()=>{
 for(const stage of ['relation','pulled','processing']){const f=fixture(stage),old=JSON.parse(f.input.raw),now=f.state;assert.equal(now.version,12);assert.deepEqual(now.features,{plantLifecycle:1,finiteAquatic:2,worldStructures:1,characterMessages:2});assert.deepEqual(now.environment.ecology,old.environment.ecology);assert.deepEqual(now.agents[0].discovery.observations,old.agents[0].discovery.observations);assert.deepEqual(now.agents[0].discovery.experiments,old.agents[0].discovery.experiments);assert.equal(f.n.active,null);
  if(stage==='processing'){assert.deepEqual(f.n.lastResult,old.agents[0].lastResult);assert.ok(f.n.memory.experience.some(r=>r.details.result?.code==='RESTART_INTERRUPTED'));assert.deepEqual(f.n.inventory.items,[]);}
  if(stage==='pulled'){assert.deepEqual(f.n.inventory.items,[f.input.materialId]);assert.equal(lookupEcologyObject(f.e,f.input.materialId).heldBy,'aster');}
  const before=clone(f.e);tickNpc(f.n,0,f.state.environment);assert.deepEqual(f.e,before);assert.equal(writeOzarkSave(f.disk,now,geometry),true);
 }
});
test('malformed, orphan, one-sided, padded and forged occupied optional evidence protects original bytes',()=>{
 const base=JSON.parse(createCarcassDiskFixture('relation').raw);
 const mutations=[(a,e,r)=>e.resultObjectId=null,(a,e,r)=>r.details.result.resultObjectId='',(a,e,r)=>e.resultObjectId='object:0',(a,e,r)=>r.details.result.resultObjectId=e.targetId,
  (a,e,r)=>delete e.resultObjectId,(a,e,r)=>delete r.details.result.resultObjectId,(a,e,r)=>a.discovery.experiments=[],(a,e,r)=>{e.primitive=r.details.action.type='pull';},
  (a,e,r)=>{e.materialId=r.details.result.materialId=null;},(a,e,r)=>{r.details.result={ok:true,code:e.code,resultObjectId:e.resultObjectId};for(let i=0;i<21;i++)r.details.result[`pad${i}`]=0;r.details.result.materialId=null;}];
 for(const mutate of mutations){const raw=clone(base),a=raw.agents[0],e=a.discovery.experiments[0],r=a.memory.experience.find(x=>x.id===e.actionId);mutate(a,e,r);const bytes=JSON.stringify(raw),disk=storage(bytes),opened=loadOzarkSave(disk,geometry);assert.equal(opened.blocked,true);assert.equal(disk.bytes,bytes);assert.equal(writeOzarkSave(disk,opened.state,geometry),false);assert.equal(disk.bytes,bytes);}
 for(const value of [null,'object:0','object:1','object:2']){const raw=clone(base),a=raw.agents[0];a.discovery.experiments=[];a.memory.experience=[{id:1,at:0,type:'action',details:{action:{type:'pull',targetId:'object:1'},result:{ok:true,code:'object_stopped_moving',resultObjectId:value}}}];a.memory.nextId=2;const bytes=JSON.stringify(raw),disk=storage(bytes);assert.equal(loadOzarkSave(disk,geometry).blocked,true);assert.equal(disk.bytes,bytes);}
});
test('late global material cap and native LOS loss fail after paid work without physical changes',()=>{
 for(const change of ['cap','los']){let clear=true;const wrapped=Object.freeze({...geometry,lineOfSight:(...args)=>clear&&geometry.lineOfSight(...args)});const f=fixture('relation',wrapped);assert.equal(requestNpcAction(f.n,{type:'pull',targetId:f.source.id},f.state.environment).code,'ACTION_STARTED');tickNpc(f.n,.25,f.state.environment);
  if(change==='cap')while(f.e.materials.length<R.maxMaterials)f.e.materials.push({...clone(f.source),id:`object:${f.e.nextId++}`,kind:'material'});else clear=false;
  const before=clone(f.e);while(f.n.active)tickNpc(f.n,.1,f.state.environment);assert.equal(f.n.lastResult.code,change==='cap'?'object_limit':'INTERACTION_BLOCKED');assert.ok(f.n.lastResult.handling.activeActionSeconds>0);assert.deepEqual(f.e,before);
 }
});
test('two actors share one finite carcass under native rotating scheduler, including vanished losing completion',()=>{
 for(const mass of [100.5,250]){const f=fixture(),mira=f.state.agents[1];mira.position={...f.n.position};Object.assign(f.source,{massGrams:mass,energyKcal:mass*1.7,waterMl:mass*.7});f.e.ledger.initialKcal=ecologyEnergy(f.e);const runtime=new PopulationRuntime(f.state,{cardinal:false});
  for(const n of f.state.agents){runtime.controller(n.id).tick=dt=>tickNpc(n,dt,f.state.environment);observeNpc(n,f.state.environment);assert.equal(requestNpcAction(n,{type:'pull',targetId:f.source.id},f.state.environment).code,'ACTION_STARTED');}
  for(let i=0;f.state.agents.some(n=>n.active)&&i<200;i++){runtime.tick(.1);f.state.elapsed+=.1;}
  const successes=f.state.agents.filter(n=>n.lastResult?.ok),pieces=f.e.materials.filter(m=>m.kind==='material');assert.equal(successes.length,mass===100.5?1:2);assert.equal(pieces.length,successes.length);assert.equal(new Set(pieces.map(m=>m.id)).size,pieces.length);for(const n of successes)assert.equal(lookupEcologyObject(f.e,n.inventory.items[0]).heldBy,n.id);
  assert.ok(f.e.materials.every(m=>m.massGrams>=0&&m.energyKcal>=0&&m.waterMl>=0));assert.ok(Math.abs(f.e.ledger.initialKcal+f.e.ledger.photosynthesisKcal+f.e.ledger.externalKcal-ecologyEnergy(f.e)-f.e.ledger.humanRemovedKcal-f.e.ledger.metabolizedKcal-f.e.ledger.decomposedKcal-f.e.ledger.discardedKcal)<1e-6);
  if(mass===100.5)assert.ok(f.state.agents.some(n=>n.lastResult.code==='OBJECT_GONE'));runtime.dispose();
 }
});
