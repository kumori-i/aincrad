import {NpcController} from '../src/controller.js';
import {SocialCoordinator} from '../src/social.js';
// Authored paid fixtures only. No ordinary cohort, nutrition or utility claim.
import test from 'node:test';import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave,getOzarkSaveValidationFailure} from '../src/ozark-save.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction} from '../src/npc.js';
import {projectPhysiology} from '../src/biology.js';
import {changeMemoryStatus,validChangeMemory} from '../src/change-memory.js';
const geometry=createOzarkWorldGeometry();
function fixture(){const state=createOzarkState(geometry),n=state.agents[0],e=state.environment;state.agents.forEach(a=>bindOzarkWorldAgent(a,geometry,state));const source=e.ecology.plants.filter(p=>p.kind==='grass'&&geometry.canOccupy(p.position.x,p.position.y,10)).sort((a,b)=>Math.hypot(a.position.x-n.position.x,a.position.y-n.position.y)-Math.hypot(b.position.x-n.position.x,b.position.y-n.position.y))[0];n.position={...source.position};Object.assign(n.physiology,{availableEnergyKcal:1300,satietyHours:3,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10});projectPhysiology(n);observeNpc(n,e);
 const advance=()=>{state.elapsed+=.25;e.elapsed=e.ecology.elapsed=state.elapsed;for(const a of state.agents)tickNpc(a,.25,e);};
 const finish=(type='strike')=>{assert.equal(requestNpcAction(n,{type,targetId:source.id},e).ok,true);for(let i=0;i<200&&n.active;i++)advance();assert.equal(n.active,null);advance();observeNpc(n,e);return n.lastResult;};return {state,n,e,source,advance,finish};}
test('actual paid no-change experiences predict prospectively without another action or shared IDs',()=>{
 const f=fixture();f.finish();f.finish();const rows=f.n.discovery.changeMemory.rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.state==='comparable'&&r.changes.length===0));
 f.advance();const id=f.n.memory.nextId;assert.equal(requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e).ok,true);const p=changeMemoryStatus(f.n).pending;assert.deepEqual(p.prediction.support,rows.map(r=>r.serial));assert.equal(p.prediction.outcome.motion,'still');assert.equal(f.n.memory.nextId,id);assert.ok(rows.every(r=>r.after.at<p.startedAt));
 p.prediction.outcome.motion='fake';assert.equal(changeMemoryStatus(f.n).pending.prediction.outcome.motion,'still');
 for(let i=0;i<200&&f.n.active;i++)f.advance();f.advance();observeNpc(f.n,f.e);assert.equal(f.n.discovery.changeMemory.rows.length,3);assert.equal(f.n.physiology.totals.ingestedKcal,0);assert.ok(validChangeMemory(f.n.discovery.changeMemory,f.n));
});
test('edited historical rows and epoch replacement cannot borrow live prediction support',()=>{
 for(const mode of ['edit','epoch']){const f=fixture();f.finish();f.finish();if(mode==='edit')f.n.discovery.changeMemory.rows[0]=structuredClone(f.n.discovery.changeMemory.rows[0]);else f.n.epoch++;observeNpc(f.n,f.e);requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);assert.equal(changeMemoryStatus(f.n).pending.prediction,null);}
});
test('paid cancellation is retained as interrupted not confirmation',()=>{const f=fixture();requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);f.advance();cancelNpcAction(f.n);f.advance();observeNpc(f.n,f.e);assert.equal(f.n.discovery.changeMemory.rows.at(-1).state,'interrupted');});
test('completed history survives save but pending and live support do not',()=>{
 const f=fixture();f.finish();f.finish();let raw=null;const storage={getItem:()=>raw,setItem:(k,v)=>{raw=v;}};assert.equal(writeOzarkSave(storage,f.state,geometry),true,JSON.stringify(getOzarkSaveValidationFailure(f.state)));const loaded=loadOzarkSave(storage,geometry).state;assert.ok(loaded);assert.deepEqual(loaded.agents[0].discovery.changeMemory,f.n.discovery.changeMemory);assert.equal(changeMemoryStatus(loaded.agents[0]).pending,null);
});
test('malformed capsule schema, reference and time cannot silently survive save',()=>{
 const f=fixture();f.finish();const original=structuredClone(f.n.discovery.changeMemory);
 for(const mutate of [m=>m.nextSerial=1,m=>m.rows[0].actionId=999999,m=>m.rows[0].after.at=1e9,m=>m.rows[0].health=100,m=>m.ownerId='other']){f.n.discovery.changeMemory=structuredClone(original);mutate(f.n.discovery.changeMemory);assert.equal(validChangeMemory(f.n.discovery.changeMemory,f.n),false);let value=null;assert.equal(writeOzarkSave({getItem:()=>value,setItem:(k,v)=>{value=v;}},f.state,geometry),false);}
});
test('own pull successor needs actual subsequent sight and carries exact paid reference',()=>{const f=fixture();assert.equal(f.finish('pull').ok,true);const r=f.n.discovery.changeMemory.rows.at(-1),e=f.n.discovery.experiments.find(e=>e.id===r.experimentId);assert.equal(r.afterTargetId,e.materialId);assert.ok(r.after&&r.after.at>r.completedAt);assert.ok(r.changes.includes('appearance'));assert.equal(r.predictionResult,'unknown');});
test('observed replacement then restoration permanently removes old live support',()=>{const f=fixture();f.finish();f.finish();const index=f.e.ecology.plants.indexOf(f.source);f.e.ecology.plants[index]=structuredClone(f.source);f.e.ecology.plants=[...f.e.ecology.plants];observeNpc(f.n,f.e);f.e.ecology.plants[index]=f.source;f.e.ecology.plants=[...f.e.ecology.plants];f.advance();observeNpc(f.n,f.e);requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);assert.equal(changeMemoryStatus(f.n).pending.prediction,null);});
test('interposed non-discovery work yields unknown, not a confirming comparison',()=>{const f=fixture();requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);while(f.n.active)f.advance();requestNpcAction(f.n,{type:'wait',seconds:1},f.e);assert.equal(f.n.discovery.changeMemory.rows.at(-1).state,'interposed');assert.equal(f.n.discovery.changeMemory.rows.at(-1).predictionResult,'unknown');});

test('full-cap source-off parity preserves shared IDs, retained proofs, choice, ecology and RNG',async()=>{
 const {mkdtempSync,cpSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{pathToFileURL}=await import('node:url'),{spawnSync}=await import('node:child_process');
 const temp=mkdtempSync(join(tmpdir(),'change-parity-'));try{
  cpSync('src',join(temp,'src'),{recursive:true});writeFileSync(join(temp,'package.json'),'{"type":"module"}');
  writeFileSync(join(temp,'src/change-memory.js'),['bindChangeMemory','observeChangeMemory','finishChangeMemory','interruptChangeMemory','startChangeMemory','pruneChangeMemory','retireChangeCustody'].map(name=>`export function ${name}(){}`).join('\n')+'\nexport const validChangeMemory=()=>false;export const changeMemoryStatus=()=>({memory:null,pending:null});');
  const program=root=>`const root=${JSON.stringify(root)};const {createOzarkWorldGeometry}=await import(root+'ozark-world-geometry.js');const {createOzarkState,writeOzarkSave,loadOzarkSave}=await import(root+'ozark-save.js');const {bindOzarkWorldAgent}=await import(root+'ozark-agent-world.js');const {observeNpc,requestNpcAction,tickNpc}=await import(root+'npc.js');const {projectPhysiology}=await import(root+'biology.js');const {discoveryDecision}=await import(root+'discovery.js');const {changeMemoryStatus}=await import(root+'change-memory.js');const {createHash}=await import('node:crypto');const assert=(await import('node:assert/strict')).default;const geometry=createOzarkWorldGeometry();${fixture.toString()};const f=fixture();for(let i=0;i<18;i++){f.finish();for(let j=0;j<3;j++)changeMemoryStatus(f.n);}const choice=discoveryDecision(f.n),m=f.n.discovery.changeMemory??null;delete f.n.discovery.changeMemory;console.log(JSON.stringify({actor:f.n,choice,ecology:createHash('sha256').update(JSON.stringify(f.e)).digest('hex'),capsules:m?{length:m.rows.length,nextSerial:m.nextSerial}:null}));`;
  const results=[];for(const root of [pathToFileURL(join(process.cwd(),'src/')).href,pathToFileURL(join(temp,'src/')).href]){const result=spawnSync(process.execPath,['--input-type=module','-e',program(root)],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});assert.equal(result.status,0,result.stderr);results.push(JSON.parse(result.stdout));}
  assert.deepEqual(results[0].capsules,{length:16,nextSerial:19});results.forEach(r=>delete r.capsules);assert.deepEqual(results[0],results[1]);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('recent interrupted comparison blocks an older concordant prediction',()=>{const f=fixture();f.finish();f.finish();f.advance();requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);f.advance();cancelNpcAction(f.n);f.advance();observeNpc(f.n,f.e);f.advance();requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);assert.equal(changeMemoryStatus(f.n).pending.prediction,null);});
test('a prospective prediction can be contradicted without rewriting its expected outcome',()=>{const f=fixture();f.finish();f.finish();f.advance();requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);const predicted=changeMemoryStatus(f.n).pending.prediction;assert.ok(predicted);f.source.biomassGrams=Math.max(1,f.source.biomassGrams-90); // Authored external perturbation, not credited to the strike.
 while(f.n.active)f.advance();f.advance();observeNpc(f.n,f.e);const r=f.n.discovery.changeMemory.rows.at(-1);assert.deepEqual(r.prediction,predicted);assert.equal(r.predictionResult,'mismatched');});
test('self movement and absent later sight remain unknown comparisons',()=>{for(const mode of ['self','absent']){const f=fixture();requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);while(f.n.active)f.advance();if(mode==='self')f.n.position.x+=1;else f.n.position.x+=900;for(let i=0;i<(mode==='self'?1:10);i++)f.advance();observeNpc(f.n,f.e);const r=f.n.discovery.changeMemory.rows.at(-1);assert.equal(r.state,mode==='self'?'self-moved':'missing');assert.equal(r.predictionResult,'unknown');}});
test('lineage mismatches and duplicate proof capsules fail strict save validation',()=>{const f=fixture();f.finish();const original=structuredClone(f.n.discovery.changeMemory);for(const mutate of [m=>m.worldId='different-world',m=>m.incarnation++,m=>{const row=structuredClone(m.rows[0]);row.serial=m.nextSerial++;m.rows.push(row);}]){f.n.discovery.changeMemory=structuredClone(original);mutate(f.n.discovery.changeMemory);let value=null;assert.equal(writeOzarkSave({getItem:()=>value,setItem:(k,v)=>{value=v;}},f.state,geometry),false);}});

test('actual voluntary custody handoff and return do not revive old live prediction support',()=>{
 const f=fixture();f.finish('pull');const id=f.n.inventory.items.at(-1),peer=f.state.agents[1];peer.position={...f.n.position};observeNpc(peer,f.e);
 function inspect(){assert.equal(requestNpcAction(f.n,{type:'inspect_object',targetId:id},f.e).ok,true);while(f.n.active)f.advance();f.advance();observeNpc(f.n,f.e);}
 inspect();inspect();const count=f.n.discovery.changeMemory.rows.length;
 const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>f.state.agents,getCommunity:()=>f.state.community,getEnvironment:()=>f.e});try{
  for(const [donor,receiver]of [[f.n,peer],[peer,f.n]]){observeNpc(donor,f.e);observeNpc(receiver,f.e);const offer=social.action(donor,{type:'offer_food',targetId:receiver.id,objectId:id});assert.equal(offer.code,'FOOD_OFFERED');assert.equal(social.action(receiver,{type:'accept_food',offerId:offer.offerId}).code,'ACTION_STARTED');while(receiver.active)f.advance();}
  f.advance();observeNpc(f.n,f.e);assert.ok(f.n.discovery.changeMemory.rows.length>=count);requestNpcAction(f.n,{type:'inspect_object',targetId:id},f.e);assert.equal(changeMemoryStatus(f.n).pending.prediction,null);
 }finally{social.dispose();}
});

test('movement between sight and dispatch cannot vanish when actor returns before post-sight',()=>{const f=fixture();const original={...f.n.position};f.n.position.x+=1;requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);f.n.position={...original};while(f.n.active)f.advance();f.advance();observeNpc(f.n,f.e);const row=f.n.discovery.changeMemory.rows.at(-1);assert.equal(row.state,'self-moved');assert.notDeepEqual(row.dispatchPosition,row.before.actorPosition);assert.equal(row.predictionResult,'unknown');});
test('controller-mediated social request retires pending comparison even without social service',()=>{const f=fixture();requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);while(f.n.active)f.advance();const c=new NpcController(f.n,{environment:f.e});try{c.perform({type:'say',text:'authored interruption'});}finally{c.dispose();}assert.equal(f.n.discovery.changeMemory.rows.at(-1).state,'interposed');});

test('canonical direct social action also invalidates pending comparison',()=>{const f=fixture();requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);while(f.n.active)f.advance();const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>f.state.agents,getCommunity:()=>f.state.community,getEnvironment:()=>f.e});try{social.action(f.n,{type:'say',text:'an actual intervening utterance'});assert.equal(f.n.discovery.changeMemory.rows.at(-1).state,'interposed');assert.equal(changeMemoryStatus(f.n).pending,null);}finally{social.dispose();}});

test('in-flight interposition preserves unknown paid completion and blocks older concordance',()=>{
 for(const mode of ['busy-refusal','social']){
  const f=fixture();f.finish();f.finish();f.advance();assert.equal(requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e).ok,true);const active=f.n.active,prediction=changeMemoryStatus(f.n).pending.prediction;assert.ok(prediction);f.advance();const nextId=f.n.memory.nextId;
  if(mode==='busy-refusal'){assert.equal(requestNpcAction(f.n,{type:'wait',seconds:1},f.e).code,'ACTION_BUSY');assert.equal(f.n.memory.nextId,nextId,'a busy refusal has no fabricated paid receipt');}
  else{const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>f.state.agents,getCommunity:()=>f.state.community,getEnvironment:()=>f.e});try{social.action(f.n,{type:'say',text:'in-flight social interruption'});}finally{social.dispose();}}
  assert.equal(f.n.active,active);assert.equal(f.n.discovery.changeMemory.rows.length,2,'no capsule before the actual paid action completes');assert.deepEqual(changeMemoryStatus(f.n).pending.prediction,prediction);
  while(f.n.active)f.advance();f.advance();observeNpc(f.n,f.e);const row=f.n.discovery.changeMemory.rows.at(-1),receipt=f.n.memory.experience.find(r=>r.id===row.actionId);assert.equal(row.state,'interrupted');assert.equal(row.predictionResult,'unknown');assert.equal(receipt.details.action.type,'strike');assert.equal(receipt.details.result.ok,true);assert.ok(receipt.details.result.durationSeconds>0);assert.deepEqual(row.prediction,prediction);
  f.advance();requestNpcAction(f.n,{type:'strike',targetId:f.source.id},f.e);assert.equal(changeMemoryStatus(f.n).pending.prediction,null,'unknown paid work is not skipped for two older concordant capsules');
 }
});

test('paid pull preserves same-batch ordinary sight of surviving source separately from successor',()=>{
 const f=fixture();f.advance();const before=observeNpc(f.n,f.e).objects.find(o=>o.id===f.source.id);
 assert.equal(f.finish('pull').ok,true);
 const row=f.n.discovery.changeMemory.rows.at(-1),source=row.sourceObservation;
 assert.equal(source.targetId,f.source.id);assert.notEqual(row.afterTargetId,source.targetId);
 assert.equal(source.sample.at,row.after.at);assert.deepEqual(source.sample.actorPosition,row.after.actorPosition);
 assert.ok(source.sample.count<before.count);assert.ok(validChangeMemory(f.n.discovery.changeMemory,f.n));
 const snapshot=changeMemoryStatus(f.n);snapshot.memory.rows.at(-1).sourceObservation.sample.count=999;
 assert.notEqual(source.sample.count,999,'observer projection is detached');
});
test('source replacement, missing source, changed custody, and interposition keep archival source explicitly unknown',()=>{
 for(const mode of ['replacement','missing','custody','interposed']){
  const f=fixture();assert.equal(requestNpcAction(f.n,{type:'pull',targetId:f.source.id},f.e).ok,true);
  while(f.n.active)f.advance();
  if(mode==='replacement')f.e.ecology.plants=f.e.ecology.plants.map(o=>o===f.source?{...o}:o);
  if(mode==='missing')f.e.ecology.plants=f.e.ecology.plants.filter(o=>o!==f.source);
  if(mode==='custody')f.source.heldBy=f.state.agents[1].id; // authored foreign-custody negative
  if(mode==='interposed')requestNpcAction(f.n,{type:'wait',seconds:1},f.e);
  f.advance();observeNpc(f.n,f.e);
  const row=f.n.discovery.changeMemory.rows.at(-1);
  assert.equal(row.sourceObservation,null,mode);
  assert.ok(validChangeMemory(f.n.discovery.changeMemory,f.n),mode);
 }
});
test('optional source association remains version-1 compatible and rejects foreign or forged mixed-batch samples',()=>{
 const f=fixture();f.advance();observeNpc(f.n,f.e);assert.equal(f.finish('pull').ok,true);
 const original=structuredClone(f.n.discovery.changeMemory);assert.ok(original.rows.at(-1).sourceObservation);
 for(const mutate of [
  r=>r.sourceObservation.targetId=r.afterTargetId,
  r=>r.sourceObservation.sample.at-=.1,
  r=>r.sourceObservation.sample.actorPosition.x+=1,
  r=>r.sourceObservation.sample.environment.shade='bad',
  r=>r.sourceObservation.sample.health=100,
  r=>r.state='interrupted',
 ]){
  f.n.discovery.changeMemory=structuredClone(original);mutate(f.n.discovery.changeMemory.rows.at(-1));
  assert.equal(validChangeMemory(f.n.discovery.changeMemory,f.n),false);
  let raw=null;assert.equal(writeOzarkSave({getItem:()=>raw,setItem:(_k,v)=>{raw=v;}},f.state,geometry),false);
 }
 for(const old of [false,true]){
  const g=fixture();g.advance();observeNpc(g.n,g.e);assert.equal(g.finish('pull').ok,true);
  const expected=g.n.discovery.changeMemory;
  if(old)delete expected.rows.at(-1).sourceObservation;
  let raw=null;const storage={getItem:()=>raw,setItem:(_k,v)=>{raw=v;}};
  assert.equal(writeOzarkSave(storage,g.state,geometry),true,JSON.stringify(getOzarkSaveValidationFailure(g.state)));
  const loaded=loadOzarkSave(storage,geometry).state;
  assert.deepEqual(loaded.agents[0].discovery.changeMemory,expected);
  assert.equal(changeMemoryStatus(loaded.agents[0]).pending,null);
 }
});
test('supplemental source record at full cap preserves legacy memory, shared proof, policy, physics and RNG',async()=>{
 const {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{pathToFileURL}=await import('node:url'),{spawnSync}=await import('node:child_process');
 const tmp=mkdtempSync(join(tmpdir(),'supplemental-source-parity-'));
 try{
  cpSync('src',join(tmp,'src'),{recursive:true});writeFileSync(join(tmp,'package.json'),'{"type":"module"}');
  const path=join(tmp,'src/change-memory.js'),code=readFileSync(path,'utf8');
  const anchor=' if(row.afterTargetId!==e.targetId){';
  assert.equal(code.split(anchor).length,2);
  writeFileSync(path,code.replace(anchor,' if(false&&row.afterTargetId!==e.targetId){'));
  const program=root=>`const root=${JSON.stringify(root)};
  const {createOzarkWorldGeometry}=await import(root+'ozark-world-geometry.js'),{createOzarkState}=await import(root+'ozark-save.js'),{bindOzarkWorldAgent}=await import(root+'ozark-agent-world.js'),{observeNpc,requestNpcAction,tickNpc}=await import(root+'npc.js'),{projectPhysiology}=await import(root+'biology.js'),{discoveryDecision}=await import(root+'discovery.js'),{changeMemoryStatus}=await import(root+'change-memory.js'),{createHash}=await import('node:crypto');
  const assert=(await import('node:assert/strict')).default,geometry=createOzarkWorldGeometry();
  ${fixture.toString()};const f=fixture();
  for(let i=0;i<18;i++){
   // Bounded authored comparison, not autonomous behavior. Identical states in both arms.
   f.source.biomassGrams=220;Object.assign(f.n.physiology,{availableEnergyKcal:1300,satietyHours:3,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10});projectPhysiology(f.n);
   observeNpc(f.n,f.e);assert.equal(f.finish('pull').ok,true);
   const last=f.n.inventory.items.at(-1);assert.ok(last);
   requestNpcAction(f.n,{type:'release',targetId:last},f.e);while(f.n.active)f.advance();f.advance();observeNpc(f.n,f.e);
   changeMemoryStatus(f.n);
  }
  const m=f.n.discovery.changeMemory;assert.equal(m.rows.length,16);const withSupplement=m.rows.filter(r=>r.sourceObservation&&r.sourceObservation.targetId===f.source.id).length;
  const choice=discoveryDecision(f.n,{foodLearning:false});
  assert.equal(m.worldId,f.state.worldLineage.instanceId);m.worldId='compared-world';for(const r of m.rows)delete r.sourceObservation;
  console.log(JSON.stringify({actor:f.n,choice,ecology:createHash('sha256').update(JSON.stringify(f.e)).digest('hex'),withSupplement}));`;
  const results=[];for(const dir of [process.cwd(),tmp]){const r=spawnSync(process.execPath,['--input-type=module','-e',program(pathToFileURL(join(dir,'src/')).href)],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr);results.push(JSON.parse(r.stdout));}
  assert.ok(results[0].withSupplement>0);assert.equal(results[1].withSupplement,0);
  for(const r of results)delete r.withSupplement;assert.deepEqual(results[0],results[1]);
 }finally{rmSync(tmp,{recursive:true,force:true});}
});
