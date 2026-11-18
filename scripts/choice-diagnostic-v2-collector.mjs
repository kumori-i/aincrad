// Offline harness bookkeeping only: caller reads existing runtime diagnostics.
import assert from 'node:assert/strict';
const reasons=new Set(['no-state','less-than-two','full-capacity','insufficient-known-prefix','ordered-known-prefix']);
const gateReasons=new Set(['outcome-missing','outcome-not-repeated','outcome-unreliable','body-not-relevant','motor-context-missing','motor-not-repeated','motor-unreliable','route-unavailable','movement-context-missing','movement-unreliable','quoted','failure-barrier','effort-barrier']);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const count=x=>Number.isSafeInteger(x)&&x>=0;
export function validateChoiceDiagnostic(d){
 assert.ok(plain(d)&&Number.isSafeInteger(d.serial)&&d.serial>0);
 assert.ok(Number.isFinite(d.at)&&d.at>=0);
 assert.ok(count(d.candidateCount)&&count(d.prefixLength)&&d.prefixLength<=d.candidateCount);
 assert.ok(reasons.has(d.reason)&&Array.isArray(d.gates));
 const early=['no-state','less-than-two','full-capacity'].includes(d.reason);
 if(early){
  assert.equal(d.gates.length,0);assert.equal(d.prefixLength,0);
  if(d.reason==='less-than-two')assert.ok(d.candidateCount<2);
  if(d.reason==='full-capacity')assert.ok(d.candidateCount>=2);
  return d;
 }
 assert.ok(d.candidateCount>=2&&d.gates.length>0&&d.gates.length<=d.candidateCount+1);
 let quotes=0,blocked=false;
 for(const g of d.gates){
  assert.ok(plain(g)&&gateReasons.has(g.reason));
  assert.ok(count(g.index)&&g.index<d.candidateCount);
  assert.equal(blocked,false,'Gate after barrier');
  assert.equal(g.index,quotes-(g.reason==='effort-barrier'?1:0));
  if(g.reason==='effort-barrier')assert.ok(quotes>=2,'Effort barrier needs two quotes');
  if(g.reason==='failure-barrier')assert.ok(quotes>=1,'First candidate cannot fail against itself');
  if(!['failure-barrier','effort-barrier'].includes(g.reason)){
   assert.ok((typeof g.sourceId==='string'&&g.sourceId.length>0)||(Number.isSafeInteger(g.sourceId)&&g.sourceId>0));
   assert.ok(typeof g.primitive==='string'&&g.primitive.length>0);
  }
  if(g.reason==='outcome-not-repeated')assert.ok(count(g.episodes)&&g.episodes<2);
  if(g.reason==='outcome-unreliable'){
   assert.ok(count(g.episodes)&&g.episodes>=2&&plain(g.firstUnreliable));
   assert.equal(typeof g.firstUnreliable.uncertain,'boolean');
   for(const key of ['effect','energy','pain'])assert.equal(typeof g.firstUnreliable[key],'string');
  }
  if(['motor-not-repeated','motor-unreliable'].includes(g.reason)){
   assert.ok(count(g.acquire)&&count(g.sample));
   if(g.reason==='motor-not-repeated')assert.ok(g.acquire<2||g.sample<2);
   else assert.ok(g.acquire>=2&&g.sample>=2);
  }
  if(g.reason==='movement-unreliable')assert.ok(count(g.movement)&&g.movement>0);
  if(g.reason==='quoted')quotes++;else blocked=true;
 }
 const effort=d.gates.at(-1).reason==='effort-barrier';
 assert.equal(d.prefixLength,quotes-(effort?1:0));
 if(!blocked)assert.equal(quotes,d.candidateCount,'Unexplained unexamined suffix');
 assert.equal(d.reason,d.prefixLength>=2?'ordered-known-prefix':'insufficient-known-prefix');
 return d;
}
export function validateChoiceWorldScope(world){
 assert.ok(plain(world)&&plain(world.worldLineage));
 assert.ok(typeof world.worldLineage.instanceId==='string'&&world.worldLineage.instanceId);
 assert.ok(Array.isArray(world.agents)&&world.agents.length>0&&Array.isArray(world.worldLineage.agents));
 assert.equal(world.agents.length,world.worldLineage.agents.length);
 const ids=new Set(),serials=new Set();
 for(const a of world.worldLineage.agents){
  assert.ok(plain(a)&&typeof a.agentId==='string'&&a.agentId&&!ids.has(a.agentId));
  assert.ok(Number.isSafeInteger(a.serial)&&a.serial>0&&!serials.has(a.serial));ids.add(a.agentId);serials.add(a.serial);
 }
 const actors=new Set();for(const a of world.agents){assert.ok(plain(a)&&ids.has(a.id)&&!actors.has(a.id));actors.add(a.id);}
 return {worldId:world.worldLineage.instanceId,actors:world.worldLineage.agents.map(a=>({actorId:a.agentId,incarnation:a.serial})).sort((a,b)=>a.actorId.localeCompare(b.actorId))};
}

function scopes(world){
 validateChoiceWorldScope(world);
 assert.ok(typeof world?.worldLineage?.instanceId==='string'&&world.worldLineage.instanceId);
 assert.ok(Array.isArray(world.agents)&&Array.isArray(world.worldLineage.agents));
 const ids=new Set();return world.agents.map(actor=>{
  assert.ok(Number.isFinite(actor.elapsed)&&actor.elapsed>=0);
  assert.ok(typeof actor.id==='string'&&!ids.has(actor.id));ids.add(actor.id);
  const lineage=world.worldLineage.agents.filter(x=>x.agentId===actor.id);
  assert.equal(lineage.length,1);assert.ok(Number.isSafeInteger(lineage[0].serial)&&lineage[0].serial>0);
  return {actor,discovery:actor.discovery,physiology:actor.physiology,memory:actor.memory,epoch:actor.epoch,
   scope:{worldId:world.worldLineage.instanceId,actorId:actor.id,incarnation:lineage[0].serial}};
 });
}
export function createChoiceDiagnosticCollector(world,{enabled,steps}){
 assert.equal(typeof enabled,'boolean');assert.ok(Number.isSafeInteger(steps)&&steps>0);
 const initial=scopes(world),seen=new Map(),rows=[];
 const elapsed=new Map(initial.map(n=>[n.actor,n.actor.elapsed]));let tick=0,closed=false,invalid=false;
 return {
  capture(current,step,snapshots){
   try{
    assert.ok(!closed&&!invalid);assert.equal(step,tick+1,'Missing or repeated tick');assert.ok(step<=steps);
    const now=scopes(current);assert.equal(now.length,initial.length);assert.ok(Array.isArray(snapshots)&&snapshots.length===now.length);
    now.forEach((n,i)=>{
     const old=initial[i];assert.deepEqual(n.scope,old.scope,'World/actor/incarnation changed');
     for(const field of ['actor','discovery','physiology','memory','epoch'])assert.equal(n[field],old[field],'Actor authority scope changed');
     assert.ok(n.actor.elapsed>=elapsed.get(n.actor),'Actor time rollback');elapsed.set(n.actor,n.actor.elapsed);
     const d=snapshots[i],previous=seen.get(n.actor);
     if(!enabled){assert.equal(d,null);return;}
     if(d===null){assert.equal(previous,undefined,'Diagnostic disappeared');return;}
     validateChoiceDiagnostic(d);assert.ok(d.at<=n.actor.elapsed,'Future diagnostic');
     if(previous&&d.serial===previous.serial){assert.deepEqual(d,previous,'Changed same-serial diagnostic');return;}
     assert.equal(d.serial,(previous?.serial??0)+1,'Diagnostic serial gap or rollback');
     if(previous)assert.ok(d.at>=previous.at,'Diagnostic time rollback');
     const copy=structuredClone(d);seen.set(n.actor,copy);rows.push({...copy,...n.scope,tick:step});
    });tick=step;
   }catch(error){invalid=true;throw error;}
  },
  finish(){assert.ok(!closed&&!invalid);assert.equal(tick,steps,'Incomplete coverage');closed=true;
   return {enabled,steps:tick,coverage:'complete',rows:structuredClone(rows)};},
 };
}
