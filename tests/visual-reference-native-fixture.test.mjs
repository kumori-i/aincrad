import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkState,writeOzarkSave,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {PopulationRuntime} from '../src/population.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {senseReferenceObjects} from '../src/visual-reference-perception.js';
import {installVisualReferenceFixture,visualReferenceEvidence,probeVisualReferenceReopen} from '../scripts/visual-reference-native-fixture.mjs';
const serialized=fn=>Function('return ('+fn.toString()+')')();

test('serialized native fixture exercises real population/action/time lifecycle (synthetic sensor; not native or pixel evidence)',{timeout:180000},async()=>{
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry);
  for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  const sensor={capture(n){const s=senseReferenceObjects(n,state);return new Map(s.bindings.map((id,i)=>[id,{features:Array(48).fill(i%2?.8:.1),pixels:Array(768).fill(i%2?204:26),at:n.elapsed,epoch:n.epoch}]));},dispose(){}};
  const reference=attachVisualReferenceLearning({state,pixelSensor:sensor});
  const population=new PopulationRuntime(state,{cardinal:false,experimentalDiscovery:reference.hooks});
  const step=()=>{reference.beforeTick();state.elapsed+=1/60;population.tick(1/60);reference.afterTick();};
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};let saved=false;
  const checkpoint=()=>{if(saved)return false;saved=true;return writeOzarkSave(storage,state,geometry);};
  const fixture=await serialized(installVisualReferenceFixture)({state,populationState:population.state,reference,geometry,step,fixedStep:1/60,auditSensor:sensor,checkpoint},new URL('../',import.meta.url),serialized(visualReferenceEvidence));
  try{
    assert.equal(fixture.status().pose,null);
    fixture.beginChoice();const choice=fixture.completeChoice();assert.equal(choice.checks.choiceCompletedBeforeIndication,true);
    fixture.beginIndication();const during=fixture.visible();assert(during.pose);assert.equal(during.checks.visibleCrop.actualCanvas,false);
    const complete=fixture.completeIndication();assert.equal(complete.reference.observed,1);assert.equal(complete.reference.updates,0);assert.equal(complete.pose,null);
    assert(complete.checks.payment.expectedActionEffortKcal>0);assert(complete.audit.length>=100);
    fixture.pendingForSave();const checkpoint=fixture.checkpoint(storage);assert(checkpoint);assert.equal(fixture.checkpoint(storage),null);
    assert.equal(checkpoint.raw,storage.getItem(OZARK_SAVE_KEY));assert.equal(checkpoint.expectedRestored.agents[0].active,null);
    const interrupted=fixture.interrupt();assert.equal(interrupted.checks.interruption.poseCleared,true);
    const original=fixture.project();
    const {loadOzarkSave}=await import('../src/ozark-save.js');const reopened=loadOzarkSave(storage,geometry).state;
    const replay=await serialized(probeVisualReferenceReopen)(new URL('../',import.meta.url),reopened,checkpoint.serializedActive,checkpoint.serializedPermit);
    assert.equal(replay.noRevivedAuthority,true);assert.deepEqual(fixture.project(),original);
  }finally{fixture.dispose();reference.dispose();population.dispose();}
});
