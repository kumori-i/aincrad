import test from 'node:test';
import assert from 'node:assert/strict';
import { repeatedProducerProofView } from '../src/repeated-producer-proof.js';
import { contractActor, actionReceipt, recognition } from './fixtures/discovery-candidates/contract-actor.mjs';

// Constructed receipt contracts, not native earning or outcome evidence.
export function repeatedActor() {
  const n=contractActor();
  addReturn(n,3,'object:3',6,7,8,30);
  n.discovery.techniques[0].evidence=[1,2,3,4];
  return n;
}
function addReturn(n,id,material,acquisitionAction,sampleAction,proofId,at,effect='sustained') {
  const acquisition={id,at,primitive:'pull',targetId:'object:1',ok:true,code:'piece_detached',durationSeconds:5,actionId:acquisitionAction,materialId:material};
  const sample={id:id+1,at:at+5,primitive:'sample',targetId:material,ok:true,code:'SWALLOWED',durationSeconds:3.5,actionId:sampleAction,ingestionId:`ingestion:${id}`};
  const sensation={id:`feedback:${id}`,at:at+10,objectId:material,actionId:sampleAction,ingestionId:sample.ingestionId,effect,hunger:effect==='sustained'?'easing':'unchanged',thirst:'unchanged',energy:effect==='sustained'?'easing':'unchanged',pain:effect==='discomfort'?'hurting':'none',source:'experienced',proofEventId:proofId};
  n.discovery.experiments.push(acquisition,sample);n.discovery.effects.push(sensation);
  n.memory.experience.push(actionReceipt(acquisition),actionReceipt(sample),recognition(sensation,proofId));
  return {acquisition,sample,sensation};
}
const proof=n=>repeatedProducerProofView(n).proofFor(n.discovery.techniques[0]);
test('two distinct retained source returns qualify without physiology.feedback or full interval continuity',()=>{
  const n=repeatedActor(),before=structuredClone(n);n.physiology.feedback=[];before.physiology.feedback=[];
  const p=proof(n);assert.equal(p.sourceId,'object:1');assert.equal(p.chains.length,2);
  assert.deepEqual(new Set(p.chains.map(c=>c.materialId)),new Set(['object:2','object:3']));
  assert.deepEqual(n,before);assert.notEqual(p,proof(n));
  n.discovery.techniques[0].evidence=[3,4];assert.ok(proof(n),'currently retained chains need not fit the truncated technique evidence array');
});
test('one return, success counts and two portions of one material cannot substitute for distinct returns',()=>{
  const n=contractActor();n.discovery.techniques[0].successes=900;assert.equal(proof(n),null);
  addReturn(n,3,'object:2',6,7,8,30);assert.equal(proof(n),null);
});
test('only the complete exact unrevised pull/sample recipe qualifies',()=>{
  for(const change of [t=>t.steps[0].type='grasp',t=>t.steps.push({type:'sample',targetId:'$material'}),t=>t.steps[1].targetId='$source',t=>t.confidence='revised',t=>t.sourceId='object:9']){const n=repeatedActor();change(n.discovery.techniques[0]);assert.equal(proof(n),null);}
});
test('required positive identity, chronology, original sensations and uniqueness fail closed',()=>{
  const changes={
    missingAcquisition:n=>n.discovery.experiments.shift(),
    missingAction:n=>n.memory.experience=n.memory.experience.filter(e=>e.id!==6),
    missingRecognition:n=>n.memory.experience=n.memory.experience.filter(e=>e.id!==8),
    missingEffect:n=>n.discovery.effects.pop(),
    duplicateExperiment:n=>n.discovery.experiments.push({...n.discovery.experiments[2]}),
    duplicateReceipt:n=>n.memory.experience.push(structuredClone(n.memory.experience.find(e=>e.id===8))),
    duplicateFeedback:n=>n.discovery.effects.push({...n.discovery.effects[1]}),
    duplicateOriginalFeedback:n=>n.memory.experience.push({...structuredClone(n.memory.experience.find(e=>e.id===8)),id:80}),
    duplicateIngestion:n=>{const e={...n.discovery.experiments[3],id:90,actionId:90};n.discovery.experiments.push(e);n.memory.experience.push(actionReceipt(e));},
    duplicateMaterial:n=>{const e={...n.discovery.experiments[2],id:90,actionId:90};n.discovery.experiments.push(e);n.memory.experience.push(actionReceipt(e));},
    duplicateRecognition:n=>n.discovery.effects.push({...n.discovery.effects[1],id:'feedback:90'}),
    foreignActorReceipt:n=>n.memory.experience.find(e=>e.id===7).details.action.targetId='object:9',
    changedMaterial:n=>n.memory.experience.find(e=>e.id===6).details.result.materialId='object:9',
    sampleReturnsMaterial:n=>{n.discovery.experiments[3].materialId='object:8';n.memory.experience.find(e=>e.id===7).details.result.materialId='object:8';},
    pullClaimsIngestion:n=>{n.discovery.experiments[2].ingestionId='ingestion:88';n.memory.experience.find(e=>e.id===6).details.result.ingestionId='ingestion:88';},
    falseNativePullCode:n=>{n.discovery.experiments[2].code='SWALLOWED';n.memory.experience.find(e=>e.id===6).details.result.code='SWALLOWED';},
    nullIngestion:n=>n.memory.experience.find(e=>e.id===7).details.result.ingestionId=null,
    matchedFalseRelief:n=>{for(const key of ['hunger','energy']){n.discovery.effects[1][key]='unchanged';n.memory.experience.find(e=>e.id===8).details.feedback[key]='unchanged';}},
    changedSensation:n=>n.memory.experience.find(e=>e.id===8).details.feedback.hunger='unchanged',
    missingSensation:n=>delete n.memory.experience.find(e=>e.id===8).details.feedback.pain,
    futureRecognition:n=>n.memory.experience.find(e=>e.id===8).at=101,
    futureEffect:n=>{n.discovery.effects[1].at=101;n.memory.experience.find(e=>e.id===8).details.feedback.at=101;},
    preSampleRecognition:n=>n.memory.experience.find(e=>e.id===8).at=34,
    preAcquisitionSample:n=>{n.discovery.experiments[3].at=29;n.memory.experience.find(e=>e.id===7).at=29;},
    unpaid:n=>{n.discovery.experiments[2].durationSeconds=0;n.memory.experience.find(e=>e.id===6).details.result.durationSeconds=0;},
    reported:n=>{n.discovery.effects[1].source='reported';n.memory.experience.find(e=>e.id===8).details.feedback.source='reported';},
  };
  for(const [name,change] of Object.entries(changes)){const n=repeatedActor();change(n);assert.equal(proof(n),null,name);}
});
test('a third source return discomfort blocks even outside the favorable pair and technique evidence',()=>{
  const n=repeatedActor();addReturn(n,5,'object:4',9,10,11,50,'discomfort');assert.equal(proof(n),null);
});
test('malformed plausibly relevant adverse identity or receipt is uncertainty, not permission',()=>{
  for(const change of [n=>n.memory.experience=n.memory.experience.filter(e=>e.id!==11),n=>n.discovery.effects.pop(),n=>n.discovery.effects.at(-1).ingestionId='ingestion:999',n=>n.discovery.effects.at(-1).objectId='object:999',n=>n.discovery.effects.at(-1).source=undefined,n=>{n.discovery.effects.at(-1).source='reported';n.memory.experience.find(e=>e.id===11).details.feedback.source='reported';},n=>n.discovery.experiments.at(-2).ok=false,n=>n.memory.experience.find(e=>e.id===11).details.feedback.pain='none']){
    const n=repeatedActor();addReturn(n,5,'object:4',9,10,11,50,'discomfort');change(n);assert.equal(proof(n),null);
  }
});
test('unrelated and social discomfort do not generalize; unresolved and genuine neutral returns are not adverse',()=>{
  for(const mode of ['unrelated','reported','neutral','unresolved']){
    const n=repeatedActor();const added=addReturn(n,5,'object:4',9,10,11,50,mode==='neutral'?'no noticeable change':'discomfort');
    if(mode==='unrelated'){added.acquisition.targetId='object:99';n.memory.experience.find(e=>e.id===9).details.action.targetId='object:99';}
    if(mode==='reported'){n.discovery.effects.pop();n.memory.experience=n.memory.experience.filter(e=>e.id!==11);n.discovery.reports.push({sourceId:'human',status:'unverified',text:'This source caused discomfort.',objectId:'object:1',effect:'discomfort'});}
    if(mode==='unresolved'){n.discovery.effects.pop();n.memory.experience=n.memory.experience.filter(e=>e.id!==11);}
    assert.ok(proof(n),mode);
  }
});
test('view is bounded, selection-local and cannot resurrect retired evidence',()=>{
  const n=repeatedActor();assert.ok(proof(n));n.memory.experience=n.memory.experience.filter(e=>e.id!==8);assert.equal(proof(n),null);
  for(const [owner,key,cap] of [['discovery','experiments',160],['discovery','effects',64],['memory','experience',400]]){
    const x=repeatedActor();while(x[owner][key].length<=cap)x[owner][key].push({...x[owner][key][0]});assert.equal(proof(x),null);
  }
});
