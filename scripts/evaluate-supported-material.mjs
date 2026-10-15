/** Developer-only finite opportunity assay; not an inhabitant policy or survival test. */
import assert from 'node:assert/strict';
import { readFile,readdir,open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),hash=x=>createHash('sha256').update(x).digest('hex');
const options={baselineRoot:null,output:null};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];assert.ok(v);if(k==='--baseline-root')options.baselineRoot=resolve(v);else if(k==='--output')options.output=resolve(v);else throw Error(`Unknown ${k}`);}
assert.ok(options.baselineRoot&&options.output);
async function fingerprint(root){const files=(await readdir(resolve(root,'src'))).filter(x=>x.endsWith('.js')).sort().map(x=>'src/'+x);files.push('package.json','package-lock.json');const entries={};for(const name of files)entries[name]=hash(await readFile(resolve(root,name)));return {sha256:hash(JSON.stringify(entries)),files:entries};}
const output=await open(options.output,'wx'),report={schemaVersion:1,status:'running',evaluatorSha256:hash(await readFile(fileURLToPath(import.meta.url))),baselineSource:await fingerprint(options.baselineRoot),candidateSource:await fingerprint(ROOT),results:[],failures:[],limitations:['Controlled opportunity assay, not autonomous foraging or a sustainability estimate.','Initial hunger is an explicit matched body fixture. Each acquisition and each first taste is externally scheduled by this developer harness; no knowledge or food is injected.','When the learner proposes another operation, this assay allows idle time rather than executing it. This favors both arms and isolates sampling opportunity; full regional trials measure actual competing actions.','All swallowing, costs, digestion, finite material transfer and environment clocks remain authoritative. New pieces earn their own feedback.','The three-piece assay measures whole acquisition-to-swallow cycles from one reachable finite source, without travel, and is not indefinite carrying capacity.']};
const persist=async()=>{await output.truncate(0);await output.write(JSON.stringify(report,null,2)+'\n',0,'utf8');};await persist();
async function trial(root,arm,assay){
  const source=await fingerprint(root),api=await Promise.all(['npc-state','environment','ecology','npc','world','discovery','biology','npc-memory'].map(name=>import(pathToFileURL(resolve(root,`src/${name}.js`)))));
  const [{createNpc},{createEnvironment,tickEnvironment},{tickEcology,lookupEcologyObject},{requestNpcAction,tickNpc,observeNpc},{canStand},{processDiscoveryFeedback,discoveryDecision},{projectPhysiology},{recordEvent}]=api;
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'}),plant=e.ecology.plants.find(x=>x.kind==='apple_tree');n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y}].find(p=>canStand(p.x,p.y,'valley'));assert.ok(n.position);
  n.physiology.hoursSinceMeal=12;projectPhysiology(n);observeNpc(n,e);const initialStateSha256=hash(JSON.stringify({n,e})),opening=structuredClone(n.physiology),openingQuantity=plant.quantity,events=[],feedbackEvents=[];
  const tick=()=>{tickEnvironment(e,1/60);tickEcology(e.ecology,1/60,e,[n]);tickNpc(n,1/60,e);processDiscoveryFeedback(n,{recordEffect:effect=>{feedbackEvents.push(structuredClone(effect));return recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect});}});};
  const act=action=>{const started=requestNpcAction(n,action,e);assert.equal(started.code,'ACTION_STARTED');for(let i=0;i<1200&&n.active;i++)tick();assert.equal(n.active,null);assert.equal(n.lastResult.ok,true);const event=n.memory.experience.filter(x=>x.type==='action').at(-1);assert.ok(event);events.push({at:n.elapsed,action:{...action},actionId:event.id,ok:n.lastResult.ok,code:n.lastResult.code,durationSeconds:n.lastResult.durationSeconds||0,...(n.lastResult.materialId?{materialId:n.lastResult.materialId}:{}),...(n.lastResult.ingestionId?{ingestionId:n.lastResult.ingestionId}:{})});};
  const positive=id=>new Set(n.discovery.effects.filter(x=>x.effect==='sustained'&&x.objectId===id).map(x=>x.ingestionId)).size;
  const stock=f=>f.availableEnergyKcal+f.storedEnergyKcal,sum=(xs,k)=>xs.reduce((s,x)=>s+x[k],0),snapshot=()=>({at:n.elapsed,ingestedKcal:n.physiology.totals.ingestedKcal,absorbedKcal:n.physiology.totals.absorbedKcal,spentKcal:n.physiology.totals.metabolizedKcal,pendingKcal:sum(n.physiology.stomach,'remainingKcal'),reservesKcal:stock(n.physiology),health:n.physiology.health});
  let measuredStart=snapshot(),deferredChoices=0,nextDecisionAt=0;
  const consumeHeld=id=>{while(n.inventory.items.includes(id)&&n.elapsed<1800){if(n.elapsed>=nextDecisionAt){const decision=discoveryDecision(n);if(decision.action.type==='sample'&&decision.action.targetId===id)act(decision.action);else deferredChoices++;nextDecisionAt=n.elapsed+.65;}tick();}assert.ok(!n.inventory.items.includes(id),'The bounded opportunity assay failed to finish this piece.');assert.equal(lookupEcologyObject(e.ecology,id),null);};
  if(assay==='supported-held-remainder'){
    act({type:'pull',targetId:plant.id});const id=n.inventory.items[0];
    for(let k=1;k<=2;k++){act({type:'sample',targetId:id});while(positive(id)<k&&n.elapsed<500)tick();assert.equal(positive(id),k);}
    act({type:'sample',targetId:id});measuredStart=snapshot();assert.equal(lookupEcologyObject(e.ecology,id).massGrams,90);consumeHeld(id);
  }else{
    for(let piece=0;piece<3;piece++){act({type:'pull',targetId:plant.id});const id=n.inventory.items[0];assert.equal(positive(id),0);act({type:'sample',targetId:id});consumeHeld(id);}
  }
  const end=snapshot(),seconds=end.at-measuredStart.at,swallowed=end.ingestedKcal-measuredStart.ingestedKcal;
  const residual=stock(opening)+sum(opening.stomach,'remainingKcal')+n.physiology.totals.ingestedKcal-stock(n.physiology)-sum(n.physiology.stomach,'remainingKcal')-n.physiology.totals.metabolizedKcal-n.physiology.totals.discardedKcal;
  assert.ok(Math.abs(residual)<=1e-6);assert.ok(Math.abs(e.ecology.ledger.humanRemovedKcal-n.physiology.totals.ingestedKcal)<=1e-6);assert.equal(n.physiology.outsideAssistance.count,0);assert.equal((await fingerprint(root)).sha256,source.sha256);
  return {arm,assay,sourceSha256:source.sha256,initialStateSha256,measuredStart,end,seconds,swallowedKcal:swallowed,swallowedKcalPerGameHour:swallowed/(seconds/150),absorbedKcal:end.absorbedKcal-measuredStart.absorbedKcal,spentKcal:end.spentKcal-measuredStart.spentKcal,reserveChangeKcal:end.reservesKcal-measuredStart.reservesKcal,pendingAtEndKcal:end.pendingKcal,energyResidualKcal:residual,openingSourceQuantity:openingQuantity,closingSourceQuantity:plant.quantity,deferredChoices,events,feedbackEvents};
}
for(const assay of ['supported-held-remainder','three-whole-pieces'])for(const arm of ['baseline','candidate']){
  try{const result=await trial(arm==='baseline'?options.baselineRoot:ROOT,arm,assay);report.results.push(result);console.log(`${assay} ${arm}: ${result.seconds.toFixed(2)} s, ${result.swallowedKcal.toFixed(2)} kcal swallowed, ${result.absorbedKcal.toFixed(2)} absorbed, ${result.pendingAtEndKcal.toFixed(2)} pending.`);}catch(e){report.failures.push({arm,assay,error:e.stack||String(e)});}await persist();
}
assert.equal((await fingerprint(ROOT)).sha256,report.candidateSource.sha256);assert.equal((await fingerprint(options.baselineRoot)).sha256,report.baselineSource.sha256);assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),report.evaluatorSha256);
for(const assay of ['supported-held-remainder','three-whole-pieces']){const pair=report.results.filter(x=>x.assay===assay);if(pair.length===2)assert.equal(pair[0].initialStateSha256,pair[1].initialStateSha256,'Opportunity controls must start in exactly the same world/body state.');}
report.status=report.failures.length?'failed':'completed';await persist();await output.close();if(report.failures.length)process.exitCode=1;
