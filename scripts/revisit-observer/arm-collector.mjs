import assert from 'node:assert/strict';
import {researchJournal} from './journal.mjs';

export const PROPOSED_STEPS=216_000;
export const BODY_EVERY=60;
// Receives the already-created immutable-runtime references. Never advances a
// clock, calls perception or chooses an action. No executable run entrypoint.
export function armCollector({state,observer,sequenceStatus,write,steps=PROPOSED_STEPS}){
 const {attach,drain,samplePose,sampleBody,sampleSequence,bodyProjection,BODY_NUMERIC_FIELDS}=observer;
 assert(Number.isSafeInteger(steps)&&steps>0&&steps<=PROPOSED_STEPS);
 const array=state.agents,actors=[...array],world=state.worldLineage;
 assert.equal(actors.length,2); assert.equal(new Set(actors.map(n=>n.id)).size,2);
 const lineage=actors.map(n=>({actor:n.id,incarnation:world.agents.find(a=>a.agentId===n.id)?.serial}));
 assert(lineage.every(x=>Number.isSafeInteger(x.incarnation)&&x.incarnation>0));
 assert(typeof world.instanceId==='string'&&world.instanceId.length>0);
 const body=()=>Object.fromEntries(actors.map(n=>[n.id,{at:n.elapsed,epoch:n.epoch,position:{...n.position},scene:n.scene,...bodyProjection(n)}]));
 const initialBody=body();assert(Object.values(initialBody).every(b=>BODY_NUMERIC_FIELDS.every(k=>Number.isFinite(b[k]))));
 const startAt=Object.fromEntries(actors.map(n=>[n.id,n.elapsed]));assert(Object.values(startAt).every(Number.isFinite));
 const namespace=world.instanceId,environment=state.environment,ecology=environment.ecology;
 const j=researchJournal(write),occupancy=Object.fromEntries(actors.map(n=>[n.id,{}]));
 for(const n of actors)attach(n,{world:state});
 let tick=0,gap=null,sealed=false;const lastPose={};
 return {
  capture(){
   assert(!sealed&&tick<steps);
   if(gap)return false;
   if(state.agents!==array||state.worldLineage!==world||world.instanceId!==namespace||state.environment!==environment||environment.ecology!==ecology||
      actors.some((n,i)=>array[i]!==n||n.id!==lineage[i].actor||world.agents.find(x=>x.agentId===n.id)?.serial!==lineage[i].incarnation)){
    gap={reason:'population-scope-replaced',tick};return false;
   }
   for(const n of actors){
    samplePose(n,tick);
    if(tick%BODY_EVERY===0)sampleBody(n,tick);
    sampleSequence(n,tick,sequenceStatus(n));
    const sample=n.physiology?.sleep?.state==='sleeping'?'sleeping':n.active?.request?.type??'idle';
    occupancy[n.id][sample]=(occupancy[n.id][sample]??0)+1;
    const batch=drain(n);j.append(batch);
    const pose=batch.rows.findLast(r=>r.kind==='pose');if(pose)lastPose[n.id]=pose;
    if(batch.gap){gap=batch.gap;return false;}
   }
   tick++;return true;
  },
  seal(){
   assert(!sealed);sealed=true;
   const terminalBody=body();
   if(!Object.values(terminalBody).every(b=>BODY_NUMERIC_FIELDS.every(k=>Number.isFinite(b[k]))))gap??={reason:'missing-terminal-body',tick};
   const evidence=j.close();
   return {world:namespace,lineage,startAt,initialBody,terminalBody,lastPose,ticks:tick,expected:steps,bodyEvery:BODY_EVERY,occupancy,evidence,
    gap:gap??evidence.gap??(tick!==steps?{reason:'incomplete-tick-horizon',tick}:null),
    complete:gap===null&&evidence.complete&&tick===steps};
  }
 };
}
