// Harness-only continuity. Epoch changes are observed outcomes, not experiment failure.
import assert from 'node:assert/strict';
import {sha256} from './producer-retest-ci-namespace.mjs';
import {validateChoiceWorldScope} from './choice-diagnostic-v2-collector.mjs';
export function createSequenceScopeCollector(world,{steps,fixedStep,describe}){
 const scope=validateChoiceWorldScope(world),initial=world.agents.map(n=>({actor:n,memory:n.memory,discovery:n.discovery,physiology:n.physiology,epoch:n.epoch,lifecycle:n.lifecycle,body:structuredClone(describe(n))}));
 let tick=0,closed=false,invalid=false;const transitions=[];
 return {
  capture(current,step){try{
   assert.ok(!closed&&!invalid);assert.equal(step,tick+1);assert.ok(step<=steps);assert.deepEqual(validateChoiceWorldScope(current),scope,'identity/incarnation replacement; continuity unknown');
   assert.ok(Math.abs(current.elapsed-step*fixedStep)<1e-6);
   const fresh=[];
   current.agents.forEach((n,i)=>{const old=initial[i];for(const k of ['actor','memory','discovery','physiology'])assert.equal(k==='actor'?n:n[k],old[k],'authority container replacement; continuity unknown');
    assert.ok(Number.isSafeInteger(n.epoch)&&n.epoch>=old.epoch,'invalid or regressing epoch');assert.ok(Math.abs(n.elapsed-current.elapsed)<1e-6);
    const body=structuredClone(describe(n));if(n.epoch!==old.epoch){const row={actor:n.id,worldId:scope.worldId,incarnation:scope.actors.find(a=>a.actorId===n.id).incarnation,tick:step,at:n.elapsed,priorEpoch:old.epoch,epoch:n.epoch,priorLifecycle:old.lifecycle,lifecycle:n.lifecycle,priorBody:old.body,body,classification:'observed-epoch-transition-private-continuity-not-assumed'};fresh.push(row);transitions.push(row);}
    old.epoch=n.epoch;old.lifecycle=n.lifecycle;old.body=body;
   });tick=step;return fresh;
  }catch(e){invalid=true;throw e;}},
  finish(){assert.ok(!closed&&!invalid);closed=true;assert.equal(tick,steps);return {coverage:'complete',steps:tick,scope,epochTransitions:structuredClone(transitions)};},
 };
}

// Store exact detached status bytes once. Every retained frame still references
// its observed status; this removes repetition, never observations or episodes.
export function createSequenceStatusInterner(){
 const entries=new Map();
 return status=>{const json=JSON.stringify(status),hash=sha256(json),prior=entries.get(hash);if(prior){assert.equal(prior,json,'Status hash collision');return {hash,entry:null};}entries.set(hash,json);return {hash,entry:{hash,status:JSON.parse(json)}};};
}
