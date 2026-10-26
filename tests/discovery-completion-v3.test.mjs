import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { tickEcology, lookupEcologyObject } from '../src/ecology.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { canStand } from '../src/world.js';
import { projectPhysiology, ingestMaterial } from '../src/biology.js';
import { processDiscoveryFeedback, discoveryDecision } from '../src/discovery.js';
import { recordEvent, validateNpc } from '../src/npc-memory.js';
import { retainedProofIntegrityError, planProofRetention } from '../src/proof-retention.js';
import { validFinishedMaterialRow, matchingFinishedMaterial,
  witnessedMaterialCompletion, registerMaterialCompletion } from '../src/discovery-completion.js';

const STEP=1/60;
function fixture(){
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'});
  const source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);assert.ok(source);
  n.position=[{x:source.position.x+45,y:source.position.y},{x:source.position.x-45,y:source.position.y}].find(p=>canStand(p.x,p.y,'valley'));assert.ok(n.position);
  // Explicit matched opportunity fixture; never supplied food or learned proof.
  n.physiology.availableEnergyKcal=700;n.physiology.hoursSinceMeal=2;n.physiology.satietyHours=4;
  projectPhysiology(n);observeNpc(n,e);return {n,e,source,id:null};
}
function tick(f,seconds=STEP){for(let i=0;i<Math.ceil(seconds/STEP);i++){
  tickEnvironment(f.e,STEP);tickEcology(f.e.ecology,STEP,f.e,[f.n]);tickNpc(f.n,STEP,f.e);
  processDiscoveryFeedback(f.n,{recordEffect:effect=>recordEvent(f.n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});
}}
function act(f,action){const start=requestNpcAction(f.n,action,f.e);assert.equal(start.code,'ACTION_STARTED');for(let i=0;i<1200&&f.n.active;i++)tick(f);assert.equal(f.n.active,null);assert.equal(f.n.lastResult.ok,true);return f.n.lastResult;}
function positives(f,id=f.id){return new Set(f.n.discovery.effects.filter(e=>e.objectId===id&&e.effect==='sustained').map(e=>e.ingestionId));}
function supported(){const f=fixture();act(f,{type:'pull',targetId:f.source.id});f.id=f.n.inventory.items[0];
  for(let count=1;count<=2;count++){const result=act(f,{type:'sample',targetId:f.id});assert.equal(Object.hasOwn(result,'finishedMaterial'),false);for(let i=0;i<24000&&positives(f).size<count;i++)tick(f);assert.equal(positives(f).size,count);}
  return f;
}
function finish(f){for(let i=0;i<4;i++){const result=act(f,{type:'sample',targetId:f.id});assert.equal(result.finishedMaterial,i===3?true:undefined);}assert.equal(lookupEcologyObject(f.e.ecology,f.id),null);return f.n.discovery.experiments.filter(e=>e.targetId===f.id&&e.primitive==='sample').at(-1);}
const receipt=(n,e)=>n.memory.experience.find(r=>r.id===e.actionId);
const carePull=(decision,id)=>decision.need==='food'&&decision.action.type==='pull'&&decision.action.targetId===id;

test('only an actual final paid mouthful earns matched finish metadata and a live completion witness',()=>{
  const f=supported(),before=f.e.ecology.ledger.humanRemovedKcal;
  assert.equal(lookupEcologyObject(f.e.ecology,f.id).massGrams,120);
  const completed=finish(f),event=receipt(f.n,completed);
  assert.equal(completed.finishedMaterial,true);assert.equal(event.details.result.finishedMaterial,true);
  assert.equal(matchingFinishedMaterial(completed,event),true);
  assert.equal(witnessedMaterialCompletion(f.n,completed),true);
  assert.equal(f.n.inventory.items.includes(f.id),false);
  assert.ok(Math.abs(f.e.ecology.ledger.humanRemovedKcal-before-95*2/3)<1e-8);
  assert.ok(Math.abs(f.n.physiology.totals.ingestedKcal-95)<1e-8);
  assert.equal(f.n.physiology.outsideAssistance.count,0);
  assert.equal(retainedProofIntegrityError(f.n),null);
  observeNpc(f.n,f.e);
  assert.equal(carePull(discoveryDecision(f.n),f.source.id),true,'earned source care need not wait for feedback from the already finished piece');
});

test('partial release is not finishing and cannot exempt its newest pending source acquisition',()=>{
  const f=supported();act(f,{type:'sample',targetId:f.id});const sample=f.n.discovery.experiments.at(-1);
  assert.equal(sample.finishedMaterial,undefined);assert.equal(witnessedMaterialCompletion(f.n,sample),false);
  act(f,{type:'release',targetId:f.id});assert.equal(f.n.inventory.items.includes(f.id),false);assert.ok(lookupEcologyObject(f.e.ecology,f.id));
  assert.equal(witnessedMaterialCompletion(f.n,sample),false);
  assert.equal(carePull(discoveryDecision(f.n),f.source.id),false,'inventory absence is not a consumed-piece witness');
});

test('a completely consumed but unlearned piece cannot fabricate the two personal benefit chains',()=>{
  const f=fixture();act(f,{type:'pull',targetId:f.source.id});f.id=f.n.inventory.items[0];
  for(let i=0;i<6;i++)act(f,{type:'sample',targetId:f.id});
  const last=f.n.discovery.experiments.at(-1);assert.equal(last.finishedMaterial,true);assert.equal(witnessedMaterialCompletion(f.n,last),true);
  assert.ok(positives(f).size<2);
  assert.equal(carePull(discoveryDecision(f.n),f.source.id),false);
});

test('saved or cloned finish history survives but cannot recreate transient completion authority',()=>{
  const f=supported(),last=finish(f),raw=JSON.parse(JSON.stringify(f.n)),restored=validateNpc(raw,{restoring:false});
  const savedLast=restored.discovery.experiments.find(e=>e.actionId===last.actionId);
  assert.ok(savedLast);assert.equal(savedLast.finishedMaterial,true);assert.equal(receipt(restored,savedLast).details.result.finishedMaterial,true);
  assert.equal(matchingFinishedMaterial(savedLast,receipt(restored,savedLast)),true);
  assert.equal(witnessedMaterialCompletion(restored,savedLast),false);assert.equal(witnessedMaterialCompletion(structuredClone(f.n),last),false);
  assert.deepEqual(restored.physiology,f.n.physiology);
  assert.equal(restored.discovery.samplesPending[f.id],f.n.discovery.samplesPending[f.id]);
  assert.equal(carePull(discoveryDecision(restored),f.source.id),false);
  assert.equal(witnessedMaterialCompletion(f.n,last),true,'reading saved history must not consume or duplicate live authority');
});

for(const guard of ['expiry','body','discovery','epoch'])test(`live completion independently rejects ${guard} replacement`,()=>{
  const f=supported(),last=finish(f);assert.equal(witnessedMaterialCompletion(f.n,last),true);
  if(guard==='expiry')tick(f,45);
  if(guard==='body')f.n.physiology=structuredClone(f.n.physiology);
  if(guard==='discovery')f.n.discovery=structuredClone(f.n.discovery);
  if(guard==='epoch')f.n.epoch++;
  assert.equal(witnessedMaterialCompletion(f.n,last),false);
});

test('finish metadata is literal true only on successful attributed samples, and both linked rows must agree',()=>{
  const good={ok:true,code:'SWALLOWED',ingestionId:'ingestion:1',finishedMaterial:true};
  assert.equal(validFinishedMaterialRow('sample','object:1',good),true);
  for(const invalid of [false,null,0,1,'true',{},[]])assert.equal(validFinishedMaterialRow('sample','object:1',{...good,finishedMaterial:invalid}),false);
  for(const primitive of ['pull','grasp','release','inspect_object'])assert.equal(validFinishedMaterialRow(primitive,'object:1',good),false);
  assert.equal(validFinishedMaterialRow('sample','object:1',{...good,ok:false}),false);
  assert.equal(validFinishedMaterialRow('sample','object:1',{...good,code:'TOO_FULL'}),false);
  assert.equal(validFinishedMaterialRow('sample','object:1',{...good,ingestionId:null}),false);
  const f=supported(),last=finish(f),event=receipt(f.n,last);
  for(const mutate of [r=>delete r.details.result.finishedMaterial,r=>{r.details.result.finishedMaterial=false;},r=>{r.details.action.type='release';},r=>{r.details.action.targetId='object:999999';},r=>{r.details.result.ingestionId='ingestion:999999';},r=>{r.at+=1;}]){const changed=structuredClone(event);mutate(changed);assert.equal(matchingFinishedMaterial(last,changed),false);}
});

test('strict proof boundary rejects malformed, unlinked and duplicated saved finished relations',()=>{
  const f=supported(),last=finish(f),original=structuredClone(f.n);
  for(const invalid of [false,null,0,'true']){const n=structuredClone(original),e=n.discovery.experiments.find(x=>x.actionId===last.actionId),r=receipt(n,e);e.finishedMaterial=invalid;r.details.result.finishedMaterial=invalid;assert.notEqual(retainedProofIntegrityError(n),null);}
  {const n=structuredClone(original),e=n.discovery.experiments.find(x=>x.actionId===last.actionId);delete receipt(n,e).details.result.finishedMaterial;assert.notEqual(retainedProofIntegrityError(n),null);}
  {const n=structuredClone(original);n.discovery.experiments=n.discovery.experiments.filter(e=>e.actionId!==last.actionId);assert.notEqual(retainedProofIntegrityError(n),null);}
  {const n=structuredClone(original),e=structuredClone(last),r=structuredClone(receipt(n,last));e.id=n.discovery.nextId++;e.actionId=n.memory.nextId++;r.id=e.actionId;n.discovery.experiments.push(e);n.memory.experience.push(r);assert.notEqual(retainedProofIntegrityError(n),null);}
});

test('the finished-piece exemption does not authorize immediate repetition on a newly pulled piece',()=>{
  const f=supported();finish(f);observeNpc(f.n,f.e);
  const next=discoveryDecision(f.n);assert.equal(carePull(next,f.source.id),true);act(f,next.action);
  const newId=f.n.inventory.items[0];assert.notEqual(newId,f.id);act(f,{type:'sample',targetId:newId});assert.equal(positives(f,newId).size,0);
  const decision=discoveryDecision(f.n);assert.notDeepEqual(decision.action,{type:'sample',targetId:newId});
  assert.equal(f.n.discovery.samplesPending[newId]!==undefined,true);
});


test('release and regrasp before finishing cannot reuse the earlier source-acquisition chain',()=>{
  const f=supported();act(f,{type:'release',targetId:f.id});act(f,{type:'grasp',targetId:f.id});const last=finish(f);
  assert.equal(witnessedMaterialCompletion(f.n,last),true,'the physical last mouthful is real, but its old source chain is interrupted');
  assert.equal(carePull(discoveryDecision(f.n),f.source.id),false);
});

test('proof-retention planner returns a failure object for malformed finish metadata',()=>{
  const f=supported(),last=finish(f),e=f.n.discovery.experiments.find(row=>row.actionId===last.actionId);
  receipt(f.n,e).details.result.finishedMaterial=false;
  const plan=planProofRetention(f.n);assert.equal(typeof plan,'object');assert.equal(plan.ok,false);
});

for(const evidence of ['zero','one','duplicate'])test(`finished-source shortcut rejects ${evidence} retained positive evidence`,()=>{
  const f=supported(),last=finish(f),positive=f.n.discovery.effects.find(e=>e.objectId===f.id&&e.effect==='sustained');
  const unrelated=f.n.discovery.effects.filter(e=>e.objectId!==f.id||e.effect!=='sustained');
  f.n.discovery.effects=[...unrelated,...(evidence==='zero'?[]:evidence==='one'?[positive]:[positive,structuredClone(positive)])];
  assert.equal(witnessedMaterialCompletion(f.n,last),true,'completion alone is insufficient');
  assert.equal(carePull(discoveryDecision(f.n),f.source.id),false);
});

test("finishing a second piece cannot borrow the first piece\'s positive outcomes",()=>{
  const f=supported();finish(f);act(f,{type:'pull',targetId:f.source.id});const prior=f.id;f.id=f.n.inventory.items[0];assert.notEqual(f.id,prior);
  for(let i=0;i<6;i++)act(f,{type:'sample',targetId:f.id});
  assert.ok(positives(f,prior).size>=2);assert.ok(positives(f).size<2);
  assert.equal(witnessedMaterialCompletion(f.n,f.n.discovery.experiments.at(-1)),true);
  assert.equal(carePull(discoveryDecision(f.n),f.source.id),false);
});

test('food-learning ablation cannot use otherwise valid finished-source authority',()=>{
  const f=supported(),last=finish(f);assert.equal(witnessedMaterialCompletion(f.n,last),true);
  assert.equal(carePull(discoveryDecision(f.n,{foodLearning:false}),f.source.id),false);
});

test('a real capacity refusal cannot produce completion authority or bypass fullness care',()=>{
  const f=supported();finish(f);act(f,{type:'pull',targetId:f.source.id});const next=f.n.inventory.items[0];
  // Explicit noncaloric gut-load fixture isolates a real paid capacity refusal.
  const occupied=f.n.physiology.stomach.reduce((s,v)=>s+v.remainingMassGrams,0);
  assert.equal(ingestMaterial(f.n,{massGrams:1395-occupied,energyKcal:0,waterMl:0,digestHours:24},{provenance:'capacity-fixture'}).ok,true);
  const requested=requestNpcAction(f.n,{type:'sample',targetId:next},f.e);assert.equal(requested.code,'ACTION_STARTED');
  for(let i=0;i<1200&&f.n.active;i++)tick(f);
  assert.equal(f.n.lastResult.ok,false);assert.equal(f.n.lastResult.code,'TOO_FULL');assert.equal(f.n.lastResult.finishedMaterial,undefined);
  assert.equal(witnessedMaterialCompletion(f.n,f.n.discovery.experiments.at(-1)),false);
  assert.equal(carePull(discoveryDecision(f.n),f.source.id),false);
});

test('actual delayed adverse evidence and source revision survive a later forced final mouthful',()=>{
  const f=supported(),material=lookupEcologyObject(f.e.ecology,f.id);material.ageHours=12*24;material.spoiled=true;
  act(f,{type:'sample',targetId:f.id});
  for(let i=0;i<24000&&!f.n.discovery.effects.some(e=>e.objectId===f.id&&e.effect==='discomfort');i++)tick(f);
  assert.ok(f.n.discovery.effects.some(e=>e.objectId===f.id&&e.effect==='discomfort'));
  assert.equal(f.n.discovery.techniques.find(t=>t.sourceId===f.source.id).confidence,'revised');
  // Counterfactual harness forcing is explicit: ordinary care would avoid this.
  for(let i=0;i<3;i++)act(f,{type:'sample',targetId:f.id});const last=f.n.discovery.experiments.at(-1);
  assert.equal(witnessedMaterialCompletion(f.n,last),true);
  assert.equal(carePull(discoveryDecision(f.n),f.source.id),false);
});


test('synthetic trusted-registration unit bounds live completion registry to sixteen entries',()=>{
  // UNIT-ONLY registry stress: these synthetic paired rows are NOT physical
  // consumption, learned food evidence, a save fixture or a policy experiment.
  const n=createNpc({mode:'discovery'});n.elapsed=10;const rows=[];
  for(let i=0;i<18;i++){
    const actionId=n.memory.nextId++,id=n.discovery.nextId++,targetId=`object:${900000+i}`,ingestionId=`ingestion:${900000+i}`;
    const result={ok:true,code:'SWALLOWED',ingestionId,finishedMaterial:true};
    const experiment={id,actionId,at:n.elapsed,primitive:'sample',targetId,...result,durationSeconds:.1};
    n.discovery.experiments.push(experiment);n.memory.experience.push({id:actionId,at:n.elapsed,type:'action',details:{action:{type:'sample',targetId},result}});
    assert.equal(registerMaterialCompletion(n,{targetId,actionId,ingestionId,at:n.elapsed}),true);rows.push(experiment);
    if(i===16){assert.equal(witnessedMaterialCompletion(n,rows[0]),false);assert.equal(rows.slice(1).filter(row=>witnessedMaterialCompletion(n,row)).length,16);}
  }
  assert.equal(witnessedMaterialCompletion(n,rows[0]),false);assert.equal(witnessedMaterialCompletion(n,rows[1]),false);
  assert.equal(rows.slice(2).filter(row=>witnessedMaterialCompletion(n,row)).length,16);
  const last=rows.at(-1);assert.equal(registerMaterialCompletion(n,{targetId:last.targetId,actionId:last.actionId,ingestionId:last.ingestionId,at:last.at}),false,'duplicate registration cannot expand the registry');
  assert.equal(registerMaterialCompletion(null,null),false);
});

test('real paid finish relation retires as a complete pair under bounded action pressure',()=>{
  const f=supported(),last=finish(f);tick(f,330);assert.equal(f.n.physiology.stomach.length,0);
  // Explicit optional-memory retirement fixture. Actual digestion and receipts
  // remain untouched; only optional learned owners are withdrawn before pressure.
  const physical=JSON.stringify(f.n.physiology);
  f.n.discovery.effects=[];f.n.discovery.techniques=[];f.n.discovery.reports=[];f.n.memory.skills=[];f.n.discovery.run=null;
  assert.equal(JSON.stringify(f.n.physiology),physical);assert.equal(retainedProofIntegrityError(f.n),null);
  for(let i=0;i<200;i++){act(f,{type:'inspect_object',targetId:f.source.id});if(i%40===39)assert.equal(retainedProofIntegrityError(f.n),null);}
  const retainedExperiment=f.n.discovery.experiments.some(e=>e.actionId===last.actionId),retainedReceipt=f.n.memory.experience.some(e=>e.id===last.actionId);
  assert.equal(retainedExperiment,retainedReceipt,'optional retirement must not leave an orphan finished flag');
  assert.equal(retainedExperiment,false,'two hundred actual later actions should retire the unowned old bundle');
  assert.equal(witnessedMaterialCompletion(f.n,last),false);
  assert.equal(retainedProofIntegrityError(f.n),null);const restored=validateNpc(JSON.parse(JSON.stringify(f.n)),{restoring:false});assert.equal(retainedProofIntegrityError(restored),null);
  assert.equal(restored.discovery.experiments.some(e=>e.actionId===last.actionId),false);assert.equal(restored.memory.experience.some(e=>e.id===last.actionId),false);
});
