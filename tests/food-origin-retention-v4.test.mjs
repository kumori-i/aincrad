import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { requestNpcAction,tickNpc,observeNpc } from '../src/npc.js';
import { canStand } from '../src/world.js';
import { recordEvent } from '../src/npc-memory.js';
import { ownExtractionOrigins } from '../src/food-source-caution.js';
import { planProofRetention,applyProofRetention,retainedProofIntegrityError,PROOF_RETENTION_BOUNDS } from '../src/proof-retention.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { PROCEDURE_RECEIPT_LIMITS } from '../src/procedure-receipts.js';
import { DISCOVERY_CANDIDATE_LIMITS } from '../src/discovery-candidates.js';

function physical(){const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'}),source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>=5);assert.ok(source);n.position=[{x:source.position.x+45,y:source.position.y},{x:source.position.x-45,y:source.position.y}].find(p=>canStand(p.x,p.y,'valley'));assert.ok(n.position);observeNpc(n,e);return{n,e,source};}
function act(f,action){assert.equal(requestNpcAction(f.n,action,f.e).code,'ACTION_STARTED');for(let i=0;i<1200&&f.n.active;i++)tickNpc(f.n,1/60,f.e);assert.equal(f.n.active,null);assert.equal(f.n.lastResult.ok,true);return f.n.lastResult;}
function extract(f,release=true){const result=act(f,{type:'pull',targetId:f.source.id}),id=result.materialId;assert.ok(id);if(release)act(f,{type:'release',targetId:id});return id;}
function pressure(f){for(let i=0;i<190;i++)act(f,{type:'inspect_object',targetId:f.source.id});for(let i=0;i<450;i++)recordEvent(f.n,'debug',{message:'Explicit unrelated history-pressure unit fixture'});assert.equal(retainedProofIntegrityError(f.n),null);}

test('last four real own extraction origins survive unrelated pressure while dropped; fifth extraction can evict oldest',()=>{
  const f=physical(),first=extract(f);for(let i=0;i<3;i++)extract(f);pressure(f);
  assert.ok(ownExtractionOrigins(f.n).some(e=>e.materialId===first));
  // Static ecology fixture: bodies and actual paid actions advance, but no
  // unrelated animal feeding/decay is simulated in this retention unit.
  act(f,{type:'grasp',targetId:first});act(f,{type:'release',targetId:first});
  assert.ok(ownExtractionOrigins(f.n).some(e=>e.materialId===first),'regrasp does not erase remembered extraction');
  extract(f);pressure(f);assert.ok(!ownExtractionOrigins(f.n).some(e=>e.materialId===first));
  act(f,{type:'grasp',targetId:first});assert.ok(!ownExtractionOrigins(f.n).some(e=>e.materialId===first),'reacquisition cannot invent retired extraction origin');
});

test('a held origin survives displacement from the finite recent-four origin set',()=>{
  const f=physical(),held=extract(f,false);for(let i=0;i<4;i++)extract(f);pressure(f);
  assert.ok(f.n.inventory.items.includes(held));assert.ok(ownExtractionOrigins(f.n).some(e=>e.materialId===held));
});

test('maximal synthetic proof closure fits 165 hard experiments with separate held and recent origins',()=>{
  // Deliberately synthetic structural bound assay, NOT ingestion or learning
  // evidence: fill every declared pending/effect slot with independently paired
  // rows, then add four held origins, four recent unheld origins and four grasps.
  const n=createNpc({mode:'discovery'});n.elapsed=1000;n.memory.experience=[];n.memory.nextId=1;n.memory.skills=[];
  n.discovery.experiments=[];n.discovery.effects=[];n.discovery.techniques=[];n.discovery.reports=[];n.discovery.observations={};n.discovery.nextId=1;
  n.physiology.stomach=[];n.physiology.feedback=[];n.physiology.nextId=10000;n.inventory.items=[];
  let at=1,ingestion=1;
  function paired(type,target,extra={}){const event={id:n.memory.nextId++,at:at++,type:'action',details:{action:{type,targetId:target},result:{ok:true,code:type==='sample'?'SWALLOWED':type==='pull'?'piece_detached':type==='grasp'?'object_held':'OBJECT_OBSERVED',durationSeconds:1,...extra}}};n.memory.experience.push(event);const exp={id:n.discovery.nextId++,at:event.at,primitive:type,targetId:target,ok:true,code:event.details.result.code,durationSeconds:1,actionId:event.id,...extra};n.discovery.experiments.push(exp);return exp;}
  function sample(){const id=`ingestion:${ingestion++}`,objectId=`object:${1000+ingestion}`,exp=paired('sample',objectId,{ingestionId:id});return{id,objectId,actionId:exp.actionId,at:exp.at,provenance:'sampled'};}
  for(let i=0;i<24;i++){const p=sample();n.physiology.stomach.push({...p,remainingMassGrams:1,remainingKcal:1,remainingWaterMl:0,originalMassGrams:1,originalKcal:1,originalWaterMl:0,absorbedKcal:0,absorbedWaterMl:0,harm:0,toxicity:0,digestHours:2,elapsedHours:0,feedbackSent:false,waterFeedbackSent:false,sustenanceFeedbackSent:false});}
  for(let i=0;i<64;i++){const p=sample();n.physiology.feedback.push({...p,id:`feedback:${100+i}`,ingestionId:p.id,effect:'sustained',hunger:'easing',thirst:'unchanged',energy:'easing',pain:'none'});}
  for(let i=0;i<64;i++){const p=sample(),effect={id:`feedback:${300+i}`,ingestionId:p.id,objectId:p.objectId,actionId:p.actionId,at:p.at,effect:'sustained',hunger:'easing',thirst:'unchanged',energy:'easing',pain:'none',source:'experienced'},receipt={id:n.memory.nextId++,at:at++,type:'condition',details:{code:'DISCOVERY_EFFECT',feedback:{...effect}}};effect.proofEventId=receipt.id;n.memory.experience.push(receipt);n.discovery.effects.push(effect);}
  const origins=[];for(let i=0;i<8;i++)origins.push(paired('pull',`object:${5000+i}`,{materialId:`object:${6000+i}`}));
  for(let i=0;i<4;i++){const id=`object:${6000+i}`;n.inventory.items.push(id);paired('grasp',id);n.discovery.observations[id]={id,scene:'valley',position:{x:100,y:100},appearance:{},observedAt:0};}
  const staged=paired('inspect_object','object:7000');
  assert.equal(n.discovery.experiments.length,165);const plan=planProofRetention(n,{stagingEventIds:[staged.actionId]});assert.equal(plan.ok,true,plan.reason);
  assert.equal(plan.diagnostics.pending,88);assert.equal(plan.diagnostics.hardExperiments,165);assert.equal(applyProofRetention(n,plan),true);
  for(const origin of origins)assert.ok(n.discovery.experiments.some(e=>e.id===origin.id));
  assert.equal(PROOF_RETENTION_BOUNDS.stagedExperiments,166);assert.equal(DISCOVERY_RULES.maxExperiments,168);assert.equal(PROOF_RETENTION_BOUNDS.scannedExperiments,169);
  assert.equal(PROOF_RETENTION_BOUNDS.experience,328);assert.equal(PROOF_RETENTION_BOUNDS.stagedExperience,329);
  assert.equal(PROCEDURE_RECEIPT_LIMITS.experiments,168);assert.equal(DISCOVERY_CANDIDATE_LIMITS.experiments,168);
  const next=paired('inspect_object','object:7000');assert.equal(n.discovery.experiments.length,166);assert.equal(planProofRetention(n,{stagingEventIds:[next.actionId]}).ok,true);
});
