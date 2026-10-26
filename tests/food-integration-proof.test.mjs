import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { canonicalAdverseWarning, cleanFoodWarning } from '../src/food-warning.js';
import { validateLedgers } from '../src/receipt-proof.js';
import { witnessedMaterialCompletion } from '../src/discovery-completion.js';
import { PROCEDURE_RECEIPT_LIMITS } from '../src/procedure-receipts.js';

// Synthetic proof-boundary fixture, not autonomous learning or physical evidence.
function fixture() {
  const sample={id:1,at:4,primitive:'sample',targetId:'object:1',ok:true,code:'SWALLOWED',durationSeconds:3.5,actionId:1,ingestionId:'ingestion:1',finishedMaterial:true};
  const effect={id:'effect:1',at:8,objectId:'object:1',actionId:1,ingestionId:'ingestion:1',effect:'discomfort',hunger:'unchanged',thirst:'unchanged',energy:'unchanged',pain:'aching',source:'experienced',proofEventId:2};
  const {proofEventId,...feedback}=effect;
  const receipt={id:1,type:'action',at:4,details:{action:{type:'sample',targetId:'object:1'},result:{ok:true,code:'SWALLOWED',durationSeconds:3.5,ingestionId:'ingestion:1',finishedMaterial:true}}};
  const recognition={id:2,type:'condition',at:8,details:{code:'DISCOVERY_EFFECT',feedback}};
  return {id:'aster',elapsed:10,discovery:{experiments:[sample],effects:[effect]},memory:{experience:[receipt,recognition]}};
}
const verify=n=>validateLedgers({now:n.elapsed,receiptsInput:n.memory.experience,experimentsInput:n.discovery.experiments,effectsInput:n.discovery.effects});

test('neutral proof validates paired completion without granting runtime witness or exporting it as warning authority',()=>{
  const n=fixture();assert.equal(verify(n).effects[0].valid,true);
  assert.equal(witnessedMaterialCompletion(n,n.discovery.experiments[0]),false);
  const w=canonicalAdverseWarning(n,'effect:1');assert.ok(w);assert.ok(cleanFoodWarning(w));
  assert.equal(Object.hasOwn(w.sample,'finishedMaterial'),false);
  assert.equal(Object.hasOwn(w.sampleReceipt.details.result,'finishedMaterial'),false);
  const contaminated=structuredClone(w);contaminated.sample.finishedMaterial=true;
  assert.equal(cleanFoodWarning(contaminated),null);
  for(const mutate of [n=>delete n.discovery.experiments[0].finishedMaterial,n=>delete n.memory.experience[0].details.result.finishedMaterial,n=>n.discovery.experiments[0].finishedMaterial=false,n=>n.memory.experience[0].details.result.finishedMaterial=false]){
    const bad=fixture();mutate(bad);assert.equal(verify(bad).effects[0].valid,false);assert.equal(canonicalAdverseWarning(bad,'effect:1'),null);
  }
});

test('warning admission and diagnostic limits honor all 168 retained experiments and reject 169 before truncation',()=>{
  assert.equal(DISCOVERY_RULES.maxExperiments,168);assert.equal(PROCEDURE_RECEIPT_LIMITS.experiments,168);
  const n=fixture();
  for(let i=2;i<=168;i++){
    n.discovery.experiments.push({id:i,actionId:i+1,at:9,primitive:'inspect_object',targetId:`object:${i}`,ok:true,code:'OBSERVED',durationSeconds:1});
    n.memory.experience.push({id:i+1,at:9,type:'action',details:{action:{type:'inspect_object',targetId:`object:${i}`},result:{ok:true,code:'OBSERVED',durationSeconds:1}}});
  }
  assert.ok(canonicalAdverseWarning(n,'effect:1'));
  n.discovery.experiments.push({});assert.equal(canonicalAdverseWarning(n,'effect:1'),null);
});
