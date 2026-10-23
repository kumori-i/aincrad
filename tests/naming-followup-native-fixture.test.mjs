import test from 'node:test';
import assert from 'node:assert/strict';
import { createNamingFollowupScene, namingFollowupEvidence, checkNamingFollowupReload } from '../scripts/naming-followup-native-fixture.mjs';
const create=Function('return ('+createNamingFollowupScene.toString()+')')();
const project=Function('return ('+namingFollowupEvidence.toString()+')')();
const replay=Function('return ('+checkNamingFollowupReload.toString()+')')();
const base=new URL('../',import.meta.url);

test('serialized ordinary-population naming fixture confirms independently; interrupted protocol cannot resume (Node preparation only)',{timeout:300000},async()=>{
  for(const interrupt of [false,true]){
    const scene=await create(base,project);
    try{
      const initial=scene.ground();assert.equal(initial.status,'heard-grounded');assert.equal(initial.opportunityCount,1);
      const result=scene.advance({interrupt});assert.equal(result.status,interrupt?'heard-grounded':'confirmed');
      assert.equal(!!result.confirmation,!interrupt);assert.equal(result.pending,interrupt?1:0);
      const saved=scene.save(),stored=JSON.parse(saved.raw),restored=saved.expectedRestored;
      assert.deepEqual(restored.clocks,{environmentElapsed:stored.environment.elapsed,ecologyElapsed:stored.environment.ecology.elapsed,ecologyPending:stored.environment.ecology.pending});
      for(const actor of restored.agents){const original=stored.agents.find(n=>n.id===actor.id);assert.deepEqual(actor.lexicon,original.lexicon??null);assert.deepEqual(actor.physiology,original.physiology);assert.equal(actor.active,null);}
      const listener=restored.agents.find(n=>n.id===saved.summary.actorId);
      assert.equal(!!listener.lexicon.heard.find(r=>r.objectId===saved.summary.sourceObjectId).confirmation,!interrupt);
      if(interrupt){const check=await replay(base,saved.raw);assert.equal(check.noReplayAfterFreshSight,true);assert.equal(check.elapsedWindow,40);}
    }finally{scene.dispose();}
  }
});
