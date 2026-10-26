import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoodWarningScene, foodWarningEvidence } from '../scripts/food-warning-native-fixture.mjs';
import { PopulationRuntime } from '../src/population.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { bindOzarkEcology } from '../src/ozark-ecology.js';
import { cancelNpcAction } from '../src/npc.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave } from '../src/ozark-save.js';
import { receivedMaterialCaution, validFoodWarningReport } from '../src/food-warning.js';

// Controlled real-physics fixture supplies only the prior adverse encounter.
// Delivery below is selected/executed by ordinary alternating controllers.
test('ordinary population speech uses shared event time in both controller orders and remains saveable', {timeout:300000}, async()=>{
  const fixture=await createFoodWarningScene(new URL('../',import.meta.url),foodWarningEvidence);
  const input=structuredClone(fixture.state);
  for(const turn of [0,1]){
    const state=createOzarkState(fixture.geometry);Object.assign(state,structuredClone(input));
    const [speaker,listener]=state.agents;
    bindOzarkEcology(state.environment.ecology,fixture.geometry);
    for(const npc of state.agents){
      bindOzarkWorldAgent(npc,fixture.geometry,state);
      if(npc.active)cancelNpcAction(npc,'TEST_PREPARE_NEW_DELIVERY');
      npc.social.heard=npc.social.heard.filter(m=>!m.warning);
      npc.discovery.reports=npc.discovery.reports.filter(r=>!r.warning);
    }
    state.community.messages=state.community.messages.filter(m=>!m.warning);
    speaker.social.lastSpokeAt=null;speaker.social.conversationKeys=[];
    speaker.discovery.lastDialogueAt=-60;speaker.nextDecisionAt=speaker.elapsed;
    // Listener remains awake and physically present, but cannot start another
    // action during this single controlled delivery opportunity.
    listener.nextDecisionAt=listener.elapsed+10;
    const runtime=new PopulationRuntime(state,{cardinal:false});runtime.turn=turn;
    const originalSay=runtime.social.say.bind(runtime.social);let duringDelivery=null;
    runtime.social.say=(npc,action)=>{
      const result=originalSay(npc,action);
      if(result.message?.warning){
        const report=listener.discovery.reports.find(r=>r.warning);
        duringDelivery={listenerAt:listener.elapsed,at:result.message.at,receivedAt:report?.warning.receivedAt};
        assert.ok(report,'Partial population step must retain the delivered report');
      }
      return result;
    };
    try{
      const before=state.environment.elapsed;runtime.tick(.1);state.elapsed=state.environment.elapsed;
      assert.ok(duringDelivery,`ordinary controller emitted warning, turn ${turn}`);
      assert.equal(duringDelivery.at,before+.1);
      assert.equal(duringDelivery.receivedAt,duringDelivery.at);
      assert.equal(duringDelivery.listenerAt,turn===0?before:before+.1);
      for(const npc of state.agents)assert.equal(npc.elapsed,state.elapsed);
      const report=listener.discovery.reports.find(r=>r.warning);
      assert.equal(validFoodWarningReport(report,listener),true,JSON.stringify({turn,elapsed:listener.elapsed,report,heard:listener.social.heard.filter(m=>m.warning)}));
      assert.ok(receivedMaterialCaution(listener,fixture.materialId));
      const rows=new Map(),disk={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
      assert.equal(writeOzarkSave(disk,state,fixture.geometry),true,state.saveError);
      const restored=loadOzarkSave(disk,fixture.geometry);assert.equal(restored.blocked,false,restored.error);
      assert.deepEqual(restored.state.agents[1].discovery.reports.find(r=>r.warning),report);
      assert.ok(receivedMaterialCaution(restored.state.agents[1],fixture.materialId));
    }finally{runtime.dispose();}
  }
});
