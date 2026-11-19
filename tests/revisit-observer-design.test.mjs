import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as ob from '../scripts/revisit-observer/observer.mjs';
import {commonHooks,insertExactly} from '../scripts/revisit-observer/patch.mjs';
import {classifyReturns,observedCleanEpisodes,assertPoseCoverage} from '../scripts/revisit-observer/analyze.mjs';
test('common patch exact anchors, refuses duplicate and mutated input',()=>{
 const npc=readFileSync(new URL('../src/npc.js',import.meta.url),'utf8'),actions=readFileSync(new URL('../src/discovery-actions.js',import.meta.url),'utf8');
 const out=commonHooks({npc,actions});
 assert.notEqual(out.npc,npc);assert.notEqual(out.actions,actions);
 assert.throws(()=>commonHooks(out),/already instrumented/);
 assert.throws(()=>insertExactly('aa','a','b'),/duplicate/);
 assert.throws(()=>commonHooks({npc:'',actions}),/anchor/);
});
function actor(){return {id:'aster',epoch:0,scene:'valley',elapsed:0,position:{x:0,y:0},lifecycle:'AWAKE',rng:19,hydration:88,health:76,riskCost:2,stats:{injuries:.75,warningSeconds:4,criticalSeconds:1,collapses:0},physiology:{availableEnergyKcal:400,storedEnergyKcal:120,waterDeficitMl:140,fatigue:21,sleepPressure:14,totals:{absorbedKcal:30,metabolizedKcal:45}}};}
function handle(n,o,source,receipt,result={}){
 const work={request:{type:'pull',targetId:source},sourceIdentity:o,startedAt:n.elapsed,worked:1};
 ob.startedHandling(n,work);n.elapsed+=1;ob.completedHandling(n,work,{eventId:receipt},{ok:true,code:'piece_detached',...result},{eventId:receipt,type:'pull',targetId:source,worked:1});
}
function sample(n,object,source='object:1'){ob.observedObject(n,{id:source,position:{x:0,y:0}},object);}
test('sampled return requires real later sight and paid action, immutable primitive evidence',()=>{
 const n=actor(),o={};ob.attach(n);sample(n,o);handle(n,o,'object:1',1);
 n.elapsed=5;n.position.x=100;ob.samplePose(n,0);
 n.elapsed=30;n.position.x=0;ob.samplePose(n,1);
 sample(n,o);handle(n,o,'object:1',2);
 const raw=ob.drain(n);
 assert.deepEqual(classifyReturns(raw.rows).places[0].followup,{receipt:2,ok:true,paid:1});
 assert.equal(n.rng,19);assert(Object.is(raw.rows[0].sight.position.x,0));
});
test('replacement, terminal successor and evidence overflow do not manufacture followup',()=>{
 const n=actor(),o={};ob.attach(n,{maxRows:4});
 sample(n,o);handle(n,o,'object:1',1,{resultObjectId:'object:2'});
 n.elapsed=10;const other={};sample(n,other,'object:3');handle(n,other,'object:3',2);
 n.elapsed=35;n.position.x=100;ob.samplePose(n,0);
 n.position.x=0;ob.samplePose(n,1);sample(n,{});
 const raw=ob.drain(n),out=classifyReturns(raw.rows,{gap:raw.gap});
 assert.equal(out.transformed[0].successor,'object:2');assert.equal(out.complete,false);
 assert.equal(out.places[0].closed,'coverage-gap');assert.equal(out.places[0].followup,null);
});
test('same-ID replacement and epoch changes censor rather than count a repeat',()=>{
 for(const mode of ['replacement','epoch','late','departure']){
  const n=actor(),o={};ob.attach(n);sample(n,o);handle(n,o,'object:1',1);
  n.elapsed=5;n.position.x=100;ob.samplePose(n,0);
  n.elapsed=30;n.position.x=0;ob.samplePose(n,1);
  const current=mode==='replacement'?{}:o;
  if(mode==='epoch')n.epoch++;
  if(mode==='late')n.elapsed+=31;
  if(mode==='departure'){n.position.x=100;ob.samplePose(n,2);}
  sample(n,current);handle(n,current,'object:1',2);
  const {rows,gap}=ob.drain(n),out=classifyReturns(rows,{gap});
  assert.equal(out.places[0].followup,null,mode);assert.equal(out.complete,true);
 }
});
test('no sight and an unbound waypoint completion cannot establish followup or goal entry',()=>{
 const n=actor(),o={};ob.attach(n);sample(n,o);handle(n,o,'object:1',1);
 n.elapsed=6;n.position.x=180;ob.samplePose(n,0);
 n.elapsed=30;n.position.x=100;const move={};ob.markBound(n,move,'object:1',{x:0,y:0},{x:100,y:0});ob.paidMove(n,move,{seconds:4,propelled:80});ob.moveCompletion(n,move,{id:8},{ok:true,code:'ARRIVED'});ob.samplePose(n,1);
 n.elapsed=31;n.position.x=0;ob.samplePose(n,2);
 handle(n,o,'object:1',9);
 const out=classifyReturns(ob.drain(n).rows);
 assert.equal(out.moves[0].receipt,8);assert.equal(out.places[0].entry.move,null);assert.equal(out.places[0].sight,null);
 assert.equal(out.places[0].followup,null);
});
test('whole arm cap seals prefix with independent overflow marker and digest',async()=>{
 const {researchJournal}=await import('../scripts/revisit-observer/journal.mjs');
 const {createHash}=await import('node:crypto');const out=[];const j=researchJournal(s=>out.push(s),{maxRows:2,maxBytes:100});
 j.append({rows:[{a:1},{a:2},{a:3}],gap:null});
 const result=j.close();assert.deepEqual(result.gap,{reason:'arm-journal-overflow',after:2});assert.equal(result.complete,false);
 assert.equal(result.sha256,createHash('sha256').update(out.join('')).digest('hex'));
});
test('observed clean episode requires both unique indexed canonical receipts and no interposition',()=>{
 const a={kind:'receipt',epoch:0,scene:'valley',serial:1,at:42,receipt:10,target:'object:1',type:'pull',code:'piece_detached',output:'object:2',ok:true,duration:4};
 const b={...a,serial:2,at:46,receipt:11,target:'object:2',type:'release',code:'object_released',output:null};
 const e={sourceId:a.target,outputId:b.target,firstAt:a.at,nextAt:b.at,firstType:a.type,type:b.type,firstCode:a.code,code:b.code,uncertain:false,interposed:false,context:'dry'};
 const row={kind:'sequence',epoch:0,scene:'valley',serial:3,status:{episodes:[e]}};
 assert.equal(observedCleanEpisodes([a,b,row],new Set([10])).length,1);
 assert.equal(observedCleanEpisodes([a,b,row],new Set()).length,0);
 assert.equal(observedCleanEpisodes([a,b,{...b,receipt:12},row],new Set([10])).length,0);
 assert.equal(observedCleanEpisodes([a,b,{...row,status:{episodes:[{...e,interposed:true}]}}],new Set([10])).length,0);
});
test('missing end-of-tick pose coverage does not pass complete-trip gate',()=>{
 const n=actor();ob.attach(n);ob.samplePose(n,0);ob.samplePose(n,1);
 const {rows}=ob.drain(n);
 assert.equal(assertPoseCoverage(rows,n.id,2),2);
 assert.throws(()=>assertPoseCoverage(rows,n.id,3),/incomplete/);
 assert.throws(()=>assertPoseCoverage([rows[1]],n.id,1),/mismatch/);
});
test('two-actor arm collector detects container replacement and keeps exact 60-tick body cadence',async()=>{
 const {armCollector}=await import('../scripts/revisit-observer/arm-collector.mjs');
 const {validateArmStream}=await import('../scripts/revisit-observer/coverage.mjs');
 const make=()=>{const agents=[actor(),{...actor(),id:'mira'}];return {agents,environment:{ecology:{}},worldLineage:{instanceId:'fixture-namespace',agents:agents.map((n,i)=>({agentId:n.id,serial:i+1}))}};};
 const state=make(),rows=[],c=armCollector({state,observer:ob,sequenceStatus:()=>null,write:line=>rows.push(JSON.parse(line)),steps:61});
 for(let t=0;t<61;t++)assert.equal(c.capture(),true);
 const evidence=c.seal();assert.equal(evidence.complete,true);assert.equal(evidence.occupancy.aster.idle,61);
 assert.equal(rows.filter(r=>r.kind==='body').length,4);
 for(const n of state.agents)assert.equal(validateArmStream(rows.filter(r=>r.actor===n.id),n.id,61).ticks,61);
 const broken=make(),d=armCollector({state:broken,observer:ob,sequenceStatus:()=>null,write:()=>{},steps:2});
 assert.equal(d.capture(),true);broken.agents[0].discovery={};
 assert.equal(d.capture(),false);assert.equal(d.seal().gap.reason,'scope-replacement');
});
test('canonical success witness, not result.ok alone, earns a research place',()=>{
 const n=actor(),o={};ob.attach(n);sample(n,o);
 const work={request:{type:'pull',targetId:'object:1'},sourceIdentity:o,startedAt:0,worked:1};
 ob.startedHandling(n,work);n.elapsed=1;ob.completedHandling(n,work,{eventId:1},{ok:true,code:'piece_detached'},null);
 assert.deepEqual(classifyReturns(ob.drain(n).rows).places,[]);
});
test('arm stream refuses forged bind, duplicate receipt, or backwards time',async()=>{
 const {validateArmStream}=await import('../scripts/revisit-observer/coverage.mjs');
 const scope={actor:'aster',epoch:0,scene:'valley',at:8};
 const pose={...scope,serial:1,kind:'pose',tick:0,position:{x:0,y:0},lifecycle:'AWAKE',active:null};
 const body={...scope,serial:2,kind:'body',tick:0,lifecycle:'AWAKE'};
 for(const k of ob.BODY_NUMERIC_FIELDS)body[k]=1;
 assert.equal(validateArmStream([pose,body],'aster',1).ticks,1);
 assert.throws(()=>validateArmStream([pose,{...body,at:7}],'aster',1),/scope mismatch/);
 assert.throws(()=>validateArmStream([pose,body,{...scope,serial:3,kind:'bound',id:3,source:'object:1'}],'aster',1,{candidate:true}),/bind/);
 const receipt={...scope,serial:3,kind:'receipt',receipt:5,ok:true,type:'move',code:'ARRIVED',duration:1};
 assert.throws(()=>validateArmStream([pose,body,receipt,{...receipt,serial:4}],'aster',1),/duplicate/);
});
test('guardrails use actual model injury/stats and censor a missing required field',()=>{
 const n=actor();n.physiology.injury=998;ob.attach(n);ob.samplePose(n,0);ob.sampleBody(n,0);
 const rows=ob.drain(n).rows,body=rows.find(r=>r.kind==='body');
 assert.equal(body.injury,.75);assert.equal(body.storedFuel,120);assert.equal(body.warningSeconds,4);assert.equal(body.criticalSeconds,1);
 delete n.stats.injuries;n.elapsed=1;ob.sampleBody(n,60);
 assert.deepEqual(ob.drain(n).gap.fields,['injury']);
});
test('offline archive verifies exact lineage/terminal body and rejects a forged pose clock',async()=>{
 const {armCollector}=await import('../scripts/revisit-observer/arm-collector.mjs');
 const {verifyArchive}=await import('../scripts/revisit-observer/verify-archive.mjs');
 const {sha256}=await import('../scripts/revisit-observer/source.mjs');
 const agents=[actor(),{...actor(),id:'mira',rng:20}],state={elapsed:0,agents,environment:{ecology:{}},worldLineage:{instanceId:'archive-fixture',agents:agents.map((n,i)=>({agentId:n.id,serial:i+1}))}};
 const snapshot=()=>Buffer.from(JSON.stringify(state)),initial=snapshot(),lines=[];
 const c=armCollector({state,observer:ob,sequenceStatus:()=>null,write:line=>lines.push(line),steps:2});
 for(let i=1;i<=2;i++){for(const n of agents)n.elapsed=i/60;state.elapsed=i/60;c.capture();}
 const final=snapshot(),journal=Buffer.from(lines.join('')),collection=c.seal();
 const commit='a'.repeat(40),tree='b'.repeat(40),source={pristine:{commit,tree},expected:{},overlay:[],harness:{}};
 const expected={commit,tree,sourceSha256:sha256(JSON.stringify(source)),harnessSha256:sha256(JSON.stringify(source.harness)),startAt:0,steps:2,fixedStep:1/60,arm:'baseline',seed:19};
 const input={manifest:{complete:true,attested:true,arm:'baseline',seed:19,fixedStep:1/60,source,initialSha256:sha256(initial),finalSha256:sha256(final),collection},journal,initial,final,expected};
 assert.equal(verifyArchive(input).complete,true);
 const modified=Buffer.from(lines.map(line=>{const r=JSON.parse(line);if(r.kind==='pose'&&r.tick===1)r.at=1/60;return JSON.stringify(r)+'\n';}).join(''));
 const forged=structuredClone(input.manifest);forged.collection.evidence.sha256=sha256(modified);forged.collection.evidence.bytes=modified.length;
 assert.throws(()=>verifyArchive({...input,manifest:forged,journal:modified}),/pose clock/);
 const wrongBody=structuredClone(input.manifest);wrongBody.collection.terminalBody.aster.injury=0;
 assert.throws(()=>verifyArchive({...input,manifest:wrongBody}),/terminalBody: injury/);
 const changed=JSON.parse(final);changed.agents[0].elapsed=1000;changed.agents[0].position={x:900,y:900};
 const swapped=Buffer.from(JSON.stringify(changed)),updated=structuredClone(input.manifest);
 updated.finalSha256=sha256(swapped);updated.collection.terminalBody.aster.at=1000;updated.collection.terminalBody.aster.position={x:900,y:900};
 assert.throws(()=>verifyArchive({...input,final:swapped,manifest:updated}),/actor horizon/);
 changed.agents[0].elapsed=state.elapsed;const displaced=Buffer.from(JSON.stringify(changed));
 updated.finalSha256=sha256(displaced);updated.collection.terminalBody.aster.at=state.elapsed;
 assert.throws(()=>verifyArchive({...input,final:displaced,manifest:updated}),/terminal pose position/);
 assert.throws(()=>verifyArchive({...input,manifest:{...input.manifest,source:undefined}}));
 assert.throws(()=>verifyArchive({...input,expected:undefined}),/trusted run expectation/);
 assert.throws(()=>verifyArchive({...input,expected:{...expected,sourceSha256:'f'.repeat(64)}}),/untrusted overlay/);
 assert.throws(()=>verifyArchive({...input,expected:{...expected,seed:20}}));

});
test('unfrozen study refuses execution and child environments contain no credentials',async()=>{
 const {PROTOCOL,frozenArm,activationEnvironment,childEnvironment}=await import('../scripts/revisit-observer/protocol.mjs');
 const inert={...PROTOCOL,seeds:null,freeze:null};
 assert.throws(()=>frozenArm(0,'baseline',inert),/inert/);
 assert.throws(()=>frozenArm(1,'candidate',inert),/inert/);
 assert.throws(()=>activationEnvironment({}));
 assert.deepEqual(childEnvironment({PATH:'/usr/bin',GITHUB_TOKEN:'token',SECRET:'value'}),{PATH:'/usr/bin'});
});
test('history requires current run in both complete views and rejects prior branch activation',async()=>{
 const {verifyRevisitRunHistory}=await import('../scripts/revisit-observer/activation-gate.mjs');
 const {PROTOCOL:p}=await import('../scripts/revisit-observer/protocol.mjs');
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+p.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:p.workflow,GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'20',GITHUB_TOKEN:'synthetic-token'};
 const record=id=>({id,event:'create',head_branch:p.activationRef});
 const fetchRows=rows=>async()=>({ok:true,json:async()=>({total_count:rows.length,workflow_runs:rows})});
 assert.equal((await verifyRevisitRunHistory({env,fetchImpl:fetchRows([record(20)])})).verified,true);
 await assert.rejects(verifyRevisitRunHistory({env,fetchImpl:fetchRows([record(10),record(20)])}),/another create run/);
 await assert.rejects(verifyRevisitRunHistory({env,maxIndexPolls:1,fetchImpl:async()=>({ok:true,json:async()=>({total_count:1,workflow_runs:[]})})}),/incomplete/);
});
test('real zero-tick canonical save uses storage readback and preserves disk boundary fields',async()=>{
 const {canonicalTerminalSave}=await import('../scripts/revisit-observer/save.mjs');
 const {createOzarkWorldGeometry}=await import('../src/ozark-world-geometry.js');
 const {createOzarkState,writeOzarkSave,OZARK_SAVE_KEY}=await import('../src/ozark-save.js');
 const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry,{communicationSeed:97531});
 const result=canonicalTerminalSave({writeOzarkSave,OZARK_SAVE_KEY,state,geometry});
 assert.equal(result.ok,true);assert.ok(result.bytes);
 const disk=JSON.parse(result.bytes);
 assert.equal(disk.elapsed,state.elapsed);assert.deepEqual(disk.worldLineage,state.worldLineage);assert.equal('npc' in disk,false);
 for(const [i,n] of state.agents.entries()){
  const m=disk.agents[i];for(const k of ['elapsed','epoch','id','scene','lifecycle','rng'])assert.equal(m[k],n[k],k);
  assert.deepEqual(m.position,n.position);
  for(const k of ob.BODY_NUMERIC_FIELDS)assert.equal(ob.bodyProjection(m)[k],ob.bodyProjection(n)[k],k);
 }
});
