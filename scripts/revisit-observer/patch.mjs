import assert from 'node:assert/strict';
export function insertExactly(source,anchor,changed){
 assert.notEqual(anchor,changed);
 assert.equal(source.split(anchor).length,2,'missing/duplicate exact hook anchor');
 assert.equal(source.includes(changed),false,'already instrumented');
 const output=source.replace(anchor,()=>changed);
 assert.equal(output.split(changed).length,2,'ambiguous instrumented hook');
 assert.equal(output.replace(changed,()=>anchor),source,'hook is not reversible');
 return output;
}
const head="import * as revisitResearch from './revisit-research-observer.js';\n";
export function commonHooks({npc,actions}){
 assert(!npc.includes(head)&&!actions.includes(head),'already instrumented');
 const sight='const identity=lookupEcologyObject(environment.ecology,object.id);retireObservedProcedureSource';
 npc=insertExactly(npc,sight,'const identity=lookupEcologyObject(environment.ecology,object.id);revisitResearch.observedObject(npc,object,identity);retireObservedProcedureSource');
 const receipt='  finishChangeMemory(npc,active,event.id,result);';
 npc=insertExactly(npc,receipt,'  revisitResearch.actionReceipt(npc,event,request,result);\n'+receipt);
 const dispatch='  if(indication)indications.set(npc.active,indication);';
 actions=insertExactly(actions,dispatch,'  revisitResearch.startedHandling(npc,paidWork.get(npc.active));\n'+dispatch);
 const completion='  if(sameOwner&&Number.isInteger(completion?.eventId))finishChangeMemory';
 actions=insertExactly(actions,completion,'  if(sameOwner)revisitResearch.completedHandling(npc,work,completion,result,successfulDiscoveryActionCompletion(npc,active));\n'+completion);
 return {npc:head+npc,actions:head+actions};
}
export function candidateHooks({npc,revisit}){
 assert(!revisit.includes(head),'already instrumented');
 const phase="offers.delete(action);o.p.phase='issued';requests.set(action,o);issued.add(action);";
 revisit=insertExactly(revisit,phase,phase+"revisitResearch.revisitPhase(n,'issued',o.p.id,o.p.position,o.target);");
 const consumed="budget.lastAt=n.elapsed;return o;";
 revisit=insertExactly(revisit,consumed,"budget.lastAt=n.elapsed;revisitResearch.revisitPhase(n,o.valid?'consumed':'consume-rejected',o.p.id,o.p.position,o.target);return o;");
 const bound="walks.set(active,o);active.expiresAt=";
 revisit=insertExactly(revisit,bound,"walks.set(active,o);revisitResearch.markBound(n,active,o.p.id,o.p.position,o.target);active.expiresAt=");
 const p='  const p=procedureMoves.get(active);procedureMoves.delete(active);';
 npc=insertExactly(npc,p,p+'\n  revisitResearch.paidMove(npc,active,p);');
 const c='  finishMotorEvidence(npc,active,event);';
 npc=insertExactly(npc,c,'  revisitResearch.moveCompletion(npc,active,event,result);\n'+c);
 return {npc,revisit:head+revisit};
}
