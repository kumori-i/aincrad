import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {reportTechniqueProvenance as report} from '../scripts/technique-provenance-report.mjs';
function fixture(){
 const n={id:'mira',epoch:1,mode:'discovery',elapsed:1000,memory:{experience:[]},discovery:{techniques:[{id:'technique:mira:67',evidence:[65,66],successes:999}],experiments:[],effects:[]}};
 for(const [id,actionId,primitive,targetId,at,extra] of [[65,210,'pull','object:678',10,{materialId:'object:732'}],[66,212,'sample','object:732',15,{ingestionId:'ingestion:13'}]]){
  const e={id,actionId,primitive,targetId,at,ok:true,code:'OK',...extra};n.discovery.experiments.push(e);
  n.memory.experience.push({id:actionId,at,type:'action',details:{action:{type:primitive,targetId},result:{ok:true,code:'OK',...extra}}});
 }
 // A retained intervening receipt preserves the existing continuity gate.
 n.memory.experience.splice(1,0,{id:211,at:12,type:'condition',details:{code:'OTHER'}});
 const e={id:'feedback:13',actionId:212,objectId:'object:732',ingestionId:'ingestion:13',at:60,effect:'sustained',source:'experienced',hunger:'easing',thirst:'unchanged',energy:'easing',pain:'none'};
 n.discovery.effects.push({...e,proofEventId:245});n.memory.experience.push({id:245,at:65,type:'condition',details:{code:'DISCOVERY_EFFECT',feedback:e}});
 return {world:{worldLineage:{instanceId:'world-a',agents:[{agentId:'mira',serial:2}]},agents:[n]},history:[]};
}
const actor=x=>x.world.agents[0],links=x=>report(x).actors[0].techniques[0].links;
test('explicit namespaces join experiment65→action210, material and sample212→feedback245',()=>{
 const x=fixture(),l=links(x);assert.equal(l[0].action.id,210);assert.equal(l[0].experiment.id,65);
 assert.equal(l[0].materials[0].material.id,'object:732');
 assert.equal(l[0].materials[0].samples[0].ingestion.namespace,'ingestion');
 assert.equal(l[1].materials[0].samples[0].feedback[0].recognition.id,245);
 assert.equal(l[0].action.actorId,'mira');assert.equal(l[0].action.serial,2);
 assert.equal(report(x).netBenefit,'unproven');
});
test('same numbers in actors and namespaces never provide missing evidence',()=>{
 const x=fixture(),other=structuredClone(actor(x));other.id='aster';x.world.agents.push(other);x.world.worldLineage.agents.push({agentId:'aster',serial:1});
 actor(x).memory.experience=actor(x).memory.experience.filter(r=>r.id!==210);
 actor(x).memory.experience.push({...other.memory.experience[0],id:65});
 assert.equal(links(x)[0].reason,'missing-action-receipt');
 assert.equal(report(x).actors[1].techniques[0].links[0].status,'retained-linked');
 actor(x).discovery.experiments=[];assert.equal(links(x)[0].reason,'missing-experiment');
});
test('evicted feedback remains missing retained proof; exact scoped history is trace-only',()=>{
 const x=fixture(),n=actor(x),r=n.memory.experience.pop();n.discovery.effects=[];
 x.history=[{worldId:'world-a',actorId:'mira',serial:2,receipt:r}];
 const s=links(x)[1].materials[0].samples[0];assert.equal(s.feedbackStatus,'missing-or-unverified');assert.equal(s.feedback.length,0);
 assert.equal(s.historicalFeedback[0].recognition.id,245);assert.equal(s.historicalFeedback[0].authority,'none');
 for(const key of ['actorId','worldId','serial']){const y=structuredClone(x);y.history[0][key]='wrong';assert.equal(links(y)[1].materials[0].samples[0].historicalFeedback.length,0);}
});
test('historical action never becomes retained; conflicting or duplicate IDs fail closed',()=>{
 const x=fixture(),n=actor(x),r=n.memory.experience.shift();x.history=[{worldId:'world-a',actorId:'mira',serial:2,receipt:r}];
 assert.equal(links(x)[0].status,'historical-trace-only');assert.equal(links(x)[0].retained,false);
 const malformed=structuredClone(x);delete actor(malformed).discovery.experiments[0].materialId;malformed.history[0].receipt.details.result.materialId=null;assert.equal(links(malformed)[0].status,'unresolved');
 x.history.push(structuredClone(x.history[0]));assert.equal(links(x)[0].reason,'ambiguous-action-receipt');
 const y=fixture();y.history=[{...x.history[0],receipt:{...r,at:99}}];assert.equal(links(y)[0].reason,'contradictory-historical-receipt');
});
test('malformed, contradictory experiment/receipt and duplicate experiment references are unresolved',()=>{
 for(const mutate of [n=>n.discovery.experiments[0].actionId='210',n=>{delete n.discovery.experiments[0].materialId;n.memory.experience[0].details.result.materialId=null;},n=>{n.discovery.experiments[0].materialId=null;n.memory.experience[0].details.result.materialId=null;},n=>n.discovery.experiments[0].materialId='object:999',n=>n.memory.experience[0].details.result.ok=false,n=>n.discovery.experiments.push(structuredClone(n.discovery.experiments[0]))]){
  const x=fixture();mutate(actor(x));assert.equal(links(x)[0].status,'unresolved');
 }
 const x=fixture();actor(x).discovery.techniques[0].evidence=[65,65];assert.equal(report(x).actors[0].techniques[0].status,'invalid-technique-evidence');
});
test('continuity gaps and malformed feedback cannot establish complete chain',()=>{
 const x=fixture();actor(x).memory.experience=actor(x).memory.experience.filter(r=>r.id!==211);
 assert.equal(links(x)[0].materials[0].samples.length,0);
 actor(x).discovery.effects[0].ingestionId='ingestion:999';assert.equal(links(x)[1].materials[0].samples[0].feedback.length,0);
});
test('pure detached immutable output and counters do not repair evicted details',()=>{
 const x=fixture(),before=structuredClone(x),r=report(x);assert.deepEqual(x,before);assert.ok(Object.isFrozen(r.actors[0].techniques[0].links[0].action));
 assert.throws(()=>{r.actors[0].scope.actorId='changed';},TypeError);assert.equal(actor(x).id,'mira');
 actor(x).discovery.experiments=[];actor(x).discovery.techniques[0].successes=1e9;assert.equal(links(x)[0].reason,'missing-experiment');
});
test('ambiguous scope and invalid arrays fail closed',()=>{
 for(const modify of [x=>x.world.agents.push(actor(x)),x=>x.world.worldLineage.agents.push(x.world.worldLineage.agents[0]),x=>actor(x).discovery.effects=null]){
  const x=fixture();modify(x);assert.equal(report(x).status,'unavailable');
 }
 assert.equal(report().status,'unavailable');
});
test('standalone CLI preserves input and refuses overwrite',()=>{
 const dir=mkdtempSync(join(tmpdir(),'provenance-'));try{const input=join(dir,'in.json'),out=join(dir,'out.json'),raw=JSON.stringify(fixture());writeFileSync(input,raw);
 const run=()=>spawnSync(process.execPath,['scripts/report-technique-provenance.mjs',input,out],{encoding:'utf8'});
 assert.equal(run().status,0);assert.equal(readFileSync(input,'utf8'),raw);const saved=readFileSync(out,'utf8');assert.notEqual(run().status,0);assert.equal(readFileSync(out,'utf8'),saved);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('malformed object and array technique IDs never alias or freeze caller input',()=>{
 for(const id of [{bad:true},['bad']]){const x=fixture();actor(x).discovery.techniques[0].id=id;const before=structuredClone(x);
  const r=report(x);assert.equal(r.actors[0].techniques[0].status,'invalid-technique-evidence');assert.equal(r.actors[0].techniques[0].technique.id,null);
  assert.deepEqual(x,before);assert.equal(Object.isFrozen(id),false);id.extra='still mutable';
 }
});

test('optional identity matrix fails closed symmetrically in retained and historical joins',()=>{
 const absent=Symbol('absent');
 for(const field of ['materialId','ingestionId'])for(const historical of [false,true]){
  const valid=field==='materialId'?'object:732':'ingestion:13';
  const values=[absent,null,undefined,false,0,'',{},'wrong',valid];
  for(const experimentValue of values)for(const receiptValue of values){
   const x=fixture(),n=actor(x),index=field==='materialId'?0:1,e=n.discovery.experiments[index];
   const r=n.memory.experience.find(r=>r.id===e.actionId);
   for(const [o,v] of [[e,experimentValue],[r.details.result,receiptValue]]){
    if(v===absent)delete o[field];else o[field]=v;
   }
   if(historical){n.memory.experience=n.memory.experience.filter(row=>row!==r);x.history=[{worldId:'world-a',actorId:'mira',serial:2,receipt:r}];}
   const missing=v=>v===absent||v===undefined;
   const validPair=experimentValue===valid&&receiptValue===valid||field==='materialId'&&missing(experimentValue)&&missing(receiptValue);
   const l=links(x)[index];
   assert.equal(l.status,validPair?(historical?'historical-trace-only':'retained-linked'):'unresolved',
    `${field} historical=${historical} experiment=${String(experimentValue)} receipt=${String(receiptValue)}`);
  }
 }
});
