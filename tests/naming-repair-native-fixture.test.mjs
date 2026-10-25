import test from 'node:test';
import assert from 'node:assert/strict';
import { createNamingRepairScene, namingRepairEvidence, checkNamingRepairReload } from '../scripts/naming-repair-native-fixture.mjs';
const create=Function('return ('+createNamingRepairScene.toString()+')')();
const project=Function('return ('+namingRepairEvidence.toString()+')')();
const replay=Function('return ('+checkNamingRepairReload.toString()+')')();
const base=new URL('../',import.meta.url);

test('serialized controlled repair fixture clarifies, re-points and retries independently; interruption cannot resume (Node preparation only)',{timeout:300000},async()=>{
  for(const interrupt of [false,true]){
    const scene=await create(base,project);
    try{
      const initial=scene.clarify();assert.equal(initial.status,'clarified');assert.equal(initial.opportunityCount,0);
      assert.equal(initial.receipt.repoint,null);assert.equal(initial.receipt.retry,null);
      assert.deepEqual(Object.keys(initial.receipt.clarification),['messageId','at','scene']);
      const result=scene.advance({interrupt});assert.equal(result.status,interrupt?'heard-grounded':'confirmed');
      assert.equal(!!result.confirmation,!interrupt);assert.equal(result.pending,interrupt?1:0);
      assert.ok(result.receipt.repoint&&result.receipt.retry);
      const saved=scene.save(),stored=JSON.parse(saved.raw),restored=saved.expectedRestored;
      assert.deepEqual(restored.clocks,{environmentElapsed:stored.environment.elapsed,ecologyElapsed:stored.environment.ecology.elapsed,ecologyPending:stored.environment.ecology.pending});
      for(const actor of restored.agents){const original=stored.agents.find(n=>n.id===actor.id);assert.deepEqual(actor.lexicon,original.lexicon??null);assert.deepEqual(actor.physiology,original.physiology);assert.equal(actor.active,null);}
      assert.deepEqual(restored.agents[0].lexicon.repairReceipts,restored.agents[1].lexicon.repairReceipts);
      assert.equal(restored.agents[0].lexicon.own[0].announcedTo.length,1);
      assert.equal(restored.agents[0].lexicon.own[0].checkedWith.length,1);
      assert.ok(saved.summary.externalRelocation);
      const listener=restored.agents.find(n=>n.id===saved.summary.actorId);
      assert.equal(!!listener.lexicon.heard.find(r=>r.objectId===saved.summary.sourceObjectId).confirmation,!interrupt);
      if(interrupt){const check=await replay(base,saved.raw);assert.equal(check.noReplayAfterFreshSight,true);assert.equal(check.elapsedWindow,40);}
    }finally{scene.dispose();}
  }
});
