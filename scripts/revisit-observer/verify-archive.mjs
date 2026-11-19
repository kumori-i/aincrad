import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bodyProjection,BODY_NUMERIC_FIELDS} from './observer.mjs';
import {validateArmStream} from './coverage.mjs';
import {classifyReturns,observedCleanEpisodes} from './analyze.mjs';
// The trusted expectations are supplied by the independently frozen protocol,
// never reconstituted from the artifact under inspection.
export const CLOCK_TOLERANCE=1e-5;
export const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const oid=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
export function validateExpected(e){
 assert(e&&['baseline','candidate'].includes(e.arm)&&Number.isSafeInteger(e.seed)&&e.seed>0&&e.seed<2**32-1,'missing/invalid trusted run expectation');
 assert(e.fixedStep===1/60&&Number.isSafeInteger(e.steps)&&e.steps>0&&e.steps<=216000&&e.startAt===0,'invalid trusted horizon');
 assert(oid(e.commit)&&oid(e.tree)&&hash(e.sourceSha256)&&hash(e.harnessSha256),'missing trusted source pins');
}
const close=(a,b,label)=>assert(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=CLOCK_TOLERANCE,label);
export function verifyBoundaries(collection,initial,final,expected){
 const start=JSON.parse(initial),end=JSON.parse(final),{lineage}=collection,stop=expected.startAt+expected.steps*expected.fixedStep;
 assert.equal(lineage.length,2);assert.equal(new Set(lineage.map(x=>x.actor)).size,2);
 for(const [file,time,field] of [[start,expected.startAt,'initialBody'],[end,stop,'terminalBody']]){
  close(file.elapsed,time,'world horizon mismatch');
  assert.equal(file.worldLineage.instanceId,collection.world);
  assert.equal(file.agents.length,2);
  for(const [i,x] of lineage.entries()){
   assert.equal(file.worldLineage.agents.find(a=>a.agentId===x.actor)?.serial,x.incarnation);
   const n=file.agents[i],s=collection[field]?.[x.actor];
   assert(n?.id===x.actor&&s,'snapshot actor mismatch');close(n.elapsed,time,'actor horizon mismatch');
   if(field==='initialBody'){
    close(collection.startAt?.[x.actor],n.elapsed,'initial actor clock mismatch');
    assert.equal(n.rng,expected.seed+i,'initial actor RNG differs from frozen seed');
   }
   const data=bodyProjection(n);
   for(const k of BODY_NUMERIC_FIELDS){assert(Number.isFinite(data[k]),field+' missing: '+k);assert.equal(data[k],s[k],field+': '+k);}
   assert.equal(data.lifecycle,s.lifecycle);
   assert.equal(n.elapsed,s.at);assert.equal(n.epoch,s.epoch);
   assert.deepEqual(n.position,s.position,field+' position mismatch');assert.equal(n.scene,s.scene);
  }
 }
 for(const n of end.agents)verifyLastPose(collection.lastPose?.[n.id],n,expected);
 return end;
}
function verifyLastPose(last,saved,expected){
 assert(last?.kind==='pose'&&last.actor===saved.id&&last.tick===expected.steps-1,'terminal pose missing or wrong tick');
 close(last.at,saved.elapsed,'terminal pose clock mismatch');
 assert.deepEqual(last.position,saved.position,'terminal pose position mismatch');
 assert.equal(last.epoch,saved.epoch,'terminal pose epoch mismatch');assert.equal(last.lifecycle,saved.lifecycle,'terminal pose lifecycle mismatch');assert.equal(last.scene,saved.scene,'terminal pose scene mismatch');
}
export function verifyArchive({manifest,journal,initial,final,expected}){
 validateExpected(expected);
 assert.equal(manifest.arm,expected.arm);assert.equal(manifest.seed,expected.seed);
 assert.equal(manifest.fixedStep,expected.fixedStep);
 assert.equal(manifest.source?.pristine?.commit,expected.commit);
 assert.equal(manifest.source?.pristine?.tree,expected.tree);
 assert.equal(sha(JSON.stringify(manifest.source)),expected.sourceSha256,'untrusted overlay/source manifest');
 assert.equal(sha(JSON.stringify(manifest.source.harness)),expected.harnessSha256,'untrusted harness closure');
 assert.equal(sha(journal),manifest.collection.evidence.sha256);
 assert.equal(journal.byteLength,manifest.collection.evidence.bytes);
 assert.equal(sha(initial),manifest.initialSha256);assert.equal(sha(final),manifest.finalSha256);
 if(manifest.complete!==true||manifest.attested!==true||!manifest.collection.complete)return {complete:false,gap:manifest.collection.gap??manifest.failure};
 const {lineage,ticks,expected:advertised}=manifest.collection;
 assert.equal(advertised,expected.steps);assert.equal(ticks,expected.steps);
 const terminal=verifyBoundaries(manifest.collection,initial,final,expected);
 const text=journal.toString('utf8');assert(text.endsWith('\n'));
 const parsed=text.slice(0,-1).split('\n').map(JSON.parse);
 assert.equal(parsed.length,manifest.collection.evidence.rows);
 const grouped=Object.fromEntries(lineage.map(x=>[x.actor,[]]));
 for(const row of parsed){assert(Object.hasOwn(grouped,row.actor));grouped[row.actor].push(row);}
 return {complete:true,actors:lineage.map(x=>{
  const rows=grouped[x.actor],coverage=validateArmStream(rows,x.actor,expected.steps,{candidate:expected.arm==='candidate',startAt:expected.startAt,dt:expected.fixedStep});
  const last=rows.findLast(r=>r.kind==='pose'),saved=terminal.agents.find(n=>n.id===x.actor);
  verifyLastPose(last,saved,expected);
  assert.deepEqual(last,manifest.collection.lastPose[x.actor],'final journal pose differs from sealed pose');
  const outcomes=classifyReturns(rows);
  const episodes=observedCleanEpisodes(rows,new Set(outcomes.places.flatMap(p=>p.followup?[p.followup.receipt]:[])));
  return {...x,coverage,outcomes,episodes};
 })};
}
