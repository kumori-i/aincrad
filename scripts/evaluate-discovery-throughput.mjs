/** Developer-only paired throughput diagnostic. Never imported by the application. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=x=>createHash('sha256').update(x).digest('hex');
const clone=x=>structuredClone(x),sum=(xs,key)=>xs.reduce((n,x)=>n+(x[key]||0),0);
async function fingerprint(root){
  const files=(await readdir(resolve(root,'src'))).filter(x=>x.endsWith('.js')).sort().map(x=>'src/'+x);
  files.push('package.json','package-lock.json');const entries={};
  for(const name of files)entries[name]=hash(await readFile(resolve(root,name)));
  return {sha256:hash(JSON.stringify(entries)),files:entries};
}
function commit(root){try{return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{return null;}}

async function run(settings){
  const startFingerprint=await fingerprint(settings.root);assert.equal(startFingerprint.sha256,settings.expectedSource);
  const api=await Promise.all(['config','world','environment','population','npc-state','ecology','npc','biology','discovery','interoception','controller'].map(x=>import(pathToFileURL(resolve(settings.root,`src/${x}.js`)).href)));
  const [{CONFIG},{freshState,distance},{createEnvironment},{PopulationRuntime},{createNpc},{regionalHabitatAnchors,lookupEcologyObject},{tickNpc,observeNpc,requestNpcAction},{canIngestMaterial},{processDiscoveryFeedback},{bodySignals},{decisionObservation}]=api;
  assert.equal(CONFIG.fixedStep,1/60);assert.equal(CONFIG.dayRealSeconds,3600);
  const s=freshState({mode:'legacy'});s.simulationMode='discovery';s.environment=createEnvironment(settings.seed,{mode:'discovery'});s.cardinal=null;
  const anchor=regionalHabitatAnchors().find(a=>a.key===settings.anchor);assert.ok(anchor);
  const n=createNpc({id:'aster',seed:settings.seed,mode:'discovery'});n.position={x:anchor.x,y:anchor.y};s.agents=[n];s.npc=n;
  assert.equal(n.discovery.techniques.length,0);assert.equal(n.discovery.experiments.length,0);assert.equal(n.inventory.items.length,0);
  const initialStateSha256=hash(JSON.stringify(s));
  const r=new PopulationRuntime(s,{cardinal:false,discoveryFoodLearning:settings.arm!=='association-ablated'}),c=r.controller();
  if(settings.arm==='association-ablated')assert.equal(c.discoveryFoodLearning,false,'Runtime lacks the explicit isolated food-association control.');
  let senseAt=-1;
  if(settings.arm==='privileged-capacity'){
    // Upper comparator ONLY: knows hidden plant kind, quantity, energy and exact
    // swallowing eligibility. Every movement/manipulation still uses the public
    // authoritative action API and finite existing material. This is not an agent.
    c.tickDiscovery=dt=>{
      tickNpc(n,dt,s.environment);processDiscoveryFeedback(n);
      if(n.elapsed-senseAt>=1){observeNpc(n,s.environment);senseAt=n.elapsed;}
      if(n.active||n.elapsed<n.nextDecisionAt||n.lifecycle!=='AWAKE')return;
      const held=n.inventory.items.map(id=>lookupEcologyObject(s.environment.ecology,id)).filter(Boolean).find(x=>x.energyKcal>0);
      let action;
      if(held)action=canIngestMaterial(n,{massGrams:Math.min(30,held.massGrams)}).ok?{type:'sample',targetId:held.id}:{type:'wait',seconds:2};
      else{
        const source=s.environment.ecology.plants.filter(p=>['apple_tree','bramble'].includes(p.kind)&&p.quantity>=1&&n.discovery.observations[p.id]).sort((a,b)=>distance(a.position,n.position)-distance(b.position,n.position))[0];
        action=source?(distance(source.position,n.position)<=80?{type:'pull',targetId:source.id}:{type:'move',target:{...source.position}}):{type:'wait',seconds:2};
      }
      requestNpcAction(n,action,s.environment);
    };
  }
  const opening=clone(n.physiology),initialRemoved=s.environment.ecology.ledger.humanRemovedKcal,events=[],feedbackEvents=[],windows=[],outcomes={},activeSeconds={},forbidden=[];
  const bodyStock=f=>f.availableEnergyKcal+f.storedEnergyKcal;
  const checkpoint=()=>({at:n.elapsed,totals:clone(n.physiology.totals),reservesKcal:bodyStock(n.physiology),pendingKcal:sum(n.physiology.stomach,'remainingKcal'),gutEntries:n.physiology.stomach.length,gutMassGrams:sum(n.physiology.stomach,'remainingMassGrams'),health:n.physiology.health,waterDeficitMl:n.physiology.waterDeficitMl,body:bodySignals(n),techniques:n.discovery.techniques.length,position:{...n.position},scene:n.scene});
  let prior=checkpoint(),nextId=0,firstPositiveAt=null,decisionBefore='',peakRss=process.memoryUsage().rss,tooFull=0,streak=0,maxFailureStreak=0;
  const prefix=createHash('sha256'),actionHistory=createHash('sha256');let firstSixHourActionSha256=null;
  const privateKeys=new Set(['physiology','energyKcal','remainingKcal','availableEnergyKcal','storedEnergyKcal','species','materialType','nutrients','ledger','worldRules']);
  const privacy=(v,path='')=>{if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(privateKeys.has(k))forbidden.push(path+k);privacy(x,path+k+'.');}};
  const started=performance.now();
  for(let i=0;i<Math.round(settings.seconds*60);i++){
    if(settings.arm==='warm-association-ablated'&&i===900*60){c.discoveryFoodLearning=false;assert.equal(n.learning,true);}
    const active=n.active?.request?.type||'idle';activeSeconds[active]=(activeSeconds[active]||0)+1/60;
    decisionBefore=n.decision;s.elapsed+=1/60;r.tick(1/60);
    if(firstPositiveAt===null&&n.discovery.effects.some(e=>e.effect==='sustained'))firstPositiveAt=n.elapsed;
    if(n.memory.nextId!==nextId){
      for(const event of n.memory.experience){
        if(event.id<nextId)continue;
        if(event.type==='condition'&&event.details.code==='DISCOVERY_EFFECT')feedbackEvents.push(clone(event.details.feedback));
        if(event.type!=='action')continue;
        const result=event.details.result||{},action=event.details.action||{},code=result.code||'UNKNOWN';outcomes[code]=(outcomes[code]||0)+1;
        const row={at:event.at,action:clone(action),ok:result.ok,code,durationSeconds:result.durationSeconds||0,reason:decisionBefore,...(result.materialId?{materialId:result.materialId}:{}),...(result.ingestionId?{ingestionId:result.ingestionId}:{}),actionId:event.id};
        actionHistory.update(JSON.stringify(row));
        if(!firstPositiveAt)prefix.update(JSON.stringify({at:row.at,action:row.action,code}));
        if(code==='TOO_FULL'){tooFull++;streak++;maxFailureStreak=Math.max(maxFailureStreak,streak);row.body=bodySignals(n);row.gutEntries=n.physiology.stomach.length;row.gutMassGrams=sum(n.physiology.stomach,'remainingMassGrams');}else streak=0;
        events.push(row);
      }
      nextId=n.memory.nextId;
    }
    if(i+1===900*60)firstSixHourActionSha256=actionHistory.copy().digest('hex');
    if((i+1)%9000===0||i+1===Math.round(settings.seconds*60)){
      const now=checkpoint(),delta=Object.fromEntries(Object.entries(now.totals).map(([k,v])=>[k,v-prior.totals[k]]));
      windows.push({from:prior.at,to:now.at,delta,absorbedToSpent:delta.absorbedKcal/delta.metabolizedKcal,pendingKcal:now.pendingKcal,reserveChangeKcal:now.reservesKcal-prior.reservesKcal,closing:now});prior=now;
      privacy(decisionObservation(n,r.social));peakRss=Math.max(peakRss,process.memoryUsage().rss);
    }
  }
  r.dispose();const final=checkpoint(),t=final.totals,remainingEcology=s.environment.ecology.ledger.humanRemovedKcal-initialRemoved;
  const residual=bodyStock(opening)+sum(opening.stomach,'remainingKcal')+t.ingestedKcal-opening.totals.ingestedKcal-final.reservesKcal-final.pendingKcal-(t.metabolizedKcal-opening.totals.metabolizedKcal)-(t.discardedKcal-opening.totals.discardedKcal);
  const endFingerprint=await fingerprint(settings.root);assert.equal(endFingerprint.sha256,startFingerprint.sha256,'Runtime sources changed during evaluation.');
  const checks={humanEnergyBalance:Math.abs(residual)<=1e-6,finiteEcologyTransfer:Math.abs(remainingEcology-t.ingestedKcal)<=1e-6,noOutsideAssistance:n.physiology.outsideAssistance.energyKcal===0&&n.physiology.outsideAssistance.waterMl===0&&n.physiology.outsideAssistance.count===0&&s.environment.ecology.ledger.externalKcal===0&&n.stats.rescues===0,privacy:forbidden.length===0};
  const completed={checks,forbiddenObservationPaths:[...new Set(forbidden)],arm:settings.arm,seed:settings.seed,anchor:settings.anchor,seconds:settings.seconds,gameHours:settings.seconds/150,sourceSha256:startFingerprint.sha256,sourceCommit:commit(settings.root),initialStateSha256,firstSixHourActionSha256,opening,final,windows,outcomes,activeSeconds,firstPositiveAt,prePositiveActionSha256:prefix.digest('hex'),tooFull,maxConsecutiveTooFull:maxFailureStreak,energyResidualKcal:residual,ecologyRemovedKcal:remainingEcology,absorbedToSpent:t.absorbedKcal/t.metabolizedKcal,ingestedToSpent:t.ingestedKcal/t.metabolizedKcal,assistance:n.physiology.outsideAssistance,privacyPassed:checks.privacy,wallSeconds:(performance.now()-started)/1000,peakSampledRssBytes:peakRss,events,feedbackEvents,finalEvidence:{experiments:clone(n.discovery.experiments),effects:clone(n.discovery.effects),techniques:clone(n.discovery.techniques)}};
  parentPort?.postMessage({type:'progress',text:`${settings.arm}, seed ${settings.seed}, ${settings.anchor}: ${(completed.absorbedToSpent*100).toFixed(1)}% absorbed/spent; ${tooFull} full refusals; residual ${residual.toExponential(2)}.`});return completed;
}

if(!isMainThread){try{parentPort.postMessage({type:'result',result:await run(workerData)});}catch(e){parentPort.postMessage({type:'error',error:e.stack||String(e)});}}
else{
  const o={seeds:[74193],anchors:['pond:north','lake:west:2'],arms:['baseline','candidate','association-ablated','privileged-capacity'],seconds:1800,baselineRoot:null,output:null};
  for(let i=2;i<process.argv.length;i+=2){const flag=process.argv[i],v=process.argv[i+1];assert.ok(v,`Missing ${flag} value`);if(flag==='--seeds')o.seeds=v.split(',').map(Number);else if(flag==='--anchors')o.anchors=v.split(',');else if(flag==='--arms')o.arms=v.split(',');else if(flag==='--seconds')o.seconds=Number(v);else if(flag==='--baseline-root')o.baselineRoot=resolve(v);else if(flag==='--output')o.output=resolve(v);else throw Error(`Unknown ${flag}`);}
  assert.ok(o.output);assert.ok(o.seeds.length<=8&&o.seeds.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff));assert.ok(o.anchors.length<=4&&o.anchors.every(x=>['pond:north','pond:oldwood','pond:south','lake:west:2'].includes(x)));assert.ok(o.seconds>=900&&o.seconds<=3600);assert.ok(o.arms.every(x=>['baseline','candidate','association-ablated','warm-association-ablated','privileged-capacity'].includes(x)));if(o.arms.includes('baseline'))assert.ok(o.baselineRoot);
  const output=await open(o.output,'wx'),startedAt=new Date().toISOString(),evaluatorHash=hash(await readFile(fileURLToPath(import.meta.url)));
  await output.writeFile(JSON.stringify({status:'running',startedAt,options:o}));
  const candidateSource=await fingerprint(ROOT),baselineSource=o.baselineRoot?await fingerprint(o.baselineRoot):null,jobs=o.seeds.flatMap(seed=>o.anchors.flatMap(anchor=>o.arms.map(arm=>({seed,anchor,arm,seconds:o.seconds,root:arm==='baseline'?o.baselineRoot:ROOT,expectedSource:arm==='baseline'?baselineSource.sha256:candidateSource.sha256})))),trials=[],failures=[];
  const persist=async data=>{await output.truncate(0);await output.write(JSON.stringify(data,null,2)+'\n',0,'utf8');};
  for(const settings of jobs){
    try{
      const trial=await new Promise((res,rej)=>{const w=new Worker(new URL(import.meta.url),{workerData:settings});let received=false;w.on('message',m=>{if(m.type==='progress')console.log(m.text);else if(m.type==='result'){received=true;res(m.result);}else if(m.type==='error'){received=true;rej(Error(m.error));}});w.on('error',rej);w.on('exit',code=>{if(!received)rej(Error(`Worker exited ${code} without a result`));});});trials.push(trial);
    }catch(error){failures.push({arm:settings.arm,seed:settings.seed,anchor:settings.anchor,error:String(error.stack||error)});console.error(failures.at(-1));}
    await persist({schemaVersion:1,status:'running',startedAt,options:o,evaluatorHash,candidateSource,baselineSource,trials,failures});
  }
  assert.equal((await fingerprint(ROOT)).sha256,candidateSource.sha256);assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),evaluatorHash);
  const passed=!failures.length&&trials.length===jobs.length&&trials.every(t=>Object.values(t.checks).every(Boolean));
  const report={schemaVersion:1,status:passed?'completed':'failed',startedAt,completedAt:new Date().toISOString(),options:o,evaluatorHash,candidateSource,baselineSource,trials,failures,limitations:['Fixed valley terrain; seed changes are not independent generated terrain.','Warm windows are continuations after the first six game hours, not pre-taught or physiology-reset agents.','Positive food-association ablation preserves perception, navigation, practice, novelty/failure memory, bodily care and aversion; it is not all learning disabled.','Privileged capacity policy uses hidden plant/energy/eligibility information only inside this developer script; it is not an agent, achievable learned behavior, or indefinite food balance.','No resets, food additions, energy assistance, changed physiology or Cardinal interventions. Native fixed timestep; no renderer or laptop performance claim.']};
  await persist(report);await output.close();if(!passed)process.exitCode=1;console.log(`Saved ${trials.length} frozen trials (${report.status}) to ${o.output}`);
}
