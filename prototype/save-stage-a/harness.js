import {Renderer} from '../../src/renderer.js';
import {writeSave,validateSave} from '../../src/save.js';
import {CONFIG} from '../../src/config.js';
import {createSaveCoordinator} from './coordinator.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(x,message)=>{if(!x)throw Error(message);};
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const frame=()=>new Promise(r=>requestAnimationFrame(r));
let current=null,renderer=null,lastFrame=performance.now(),lastLoop=performance.now(),windowRows=null;
function paint(at){const row={start:lastFrame,end:at,gapMs:at-lastFrame};lastFrame=at;if(windowRows)windowRows.frames.push(row);if(renderer)renderer.render(current,{time:0,moving:false,facing:{x:0,y:1}},1/60,true);requestAnimationFrame(paint);}
requestAnimationFrame(paint);
setInterval(()=>{const at=performance.now(),row={start:lastLoop,end:at,gapMs:at-lastLoop};lastLoop=at;if(windowRows)windowRows.loops.push(row);},5);
async function security(){
 const probe=new Worker(new URL('./security-probe.js',import.meta.url),{type:'module'});
 try{return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Security probe timeout')),5000);probe.onmessage=({data})=>{clearTimeout(timeout);resolve(data);};probe.onerror=e=>{e.preventDefault();clearTimeout(timeout);reject(Error('Security probe worker failed'));};});}finally{probe.terminate();}
}
window.__stageA={ready:true,progress:null,result:null};
window.__stageA.run=async function run(config){
 const result={version:1,fixture:config.fixture,arm:config.arm,session:config.session,scope:'Actual Electron fixed-snapshot rendering; no simulation advancement.',timingScope:'request and outer response spans include coordinator work; end-to-end ends after request/handler returns; commit-completion is separate. Post-window heap and 250ms process samples are not universal transient peaks.',startedAt:new Date().toISOString(),samples:[],error:null,completed:false};
 window.__stageA.result=result;
 let coordinator=null,phase={stage:'setup'},priorText=null,storageFailure=null,activeAttempt=null;
 try{
  assert(config.arm==='baseline'||config.arm==='worker','Invalid fixed arm');
  assert(typeof require==='undefined'&&typeof process==='undefined','Renderer Node leak');
  const data={};for(const which of ['A','B']){const item=config.pairs[which],text=await(await fetch('/'+item.path)).text();assert(await hash(text)===item.sha256,'Frozen input hash mismatch');data[which]={text,state:JSON.parse(text),sha256:item.sha256,bytes:item.bytes};}
  const {selectedAgentId:sa,...a}=data.A.state,{selectedAgentId:sb,...b}=data.B.state;assert(sa==='aster'&&sb==='mira'&&JSON.stringify(a)===JSON.stringify(b),'Pair changed non-selection state');
  current=structuredClone(data.A.state);renderer=new Renderer(document.getElementById('world'),current);renderer.snap(current.player);
  result.security=await security();assert(['nodeAbsent','fetchBlocked','evalBlocked','nestedWorkerBlocked','policyConfirmed'].every(key=>result.security[key]===true),'Worker CSP enforcement failed or unproven');
  // A single opposite-value preseed per arm. Never preseed between samples.
  phase={stage:'preconditioning',which:'B'};priorText=localStorage.getItem(CONFIG.saveKey);result.preconditioning={priorHash:priorText===null?null:await hash(priorText),priorCharacters:priorText?.length??0,requestedHash:data.B.sha256,requestedBytes:data.B.bytes};try{localStorage.setItem(CONFIG.saveKey,data.B.text);}catch(error){storageFailure={name:error.name,message:String(error.message).slice(0,1000)};throw error;}result.preseed={sha256:await hash(localStorage.getItem(CONFIG.saveKey)),which:'B',settleMs:500};assert(result.preseed.sha256===data.B.sha256,'Preseed failed');
  const timings=[],statuses=[];let commitMs=0,commitCalls=0,storageCompletedAt=null,settleSave=null;
  const storage={setItem(key,text){const at=performance.now();try{localStorage.setItem(key,text);}catch(error){storageFailure={name:error.name,message:String(error.message).slice(0,1000)};throw error;}finally{storageCompletedAt=performance.now();commitMs+=storageCompletedAt-at;}commitCalls++;}};
  function measuredWorker(){
   const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'}),listeners=new Map();
   return{postMessage:message=>worker.postMessage(message),terminate:()=>worker.terminate(),addEventListener(type,handler){const wrapped=event=>{const at=performance.now();try{return handler(event);}finally{timings.push({stage:'outer-'+type+'-handler',start:at,end:performance.now(),durationMs:performance.now()-at});}};listeners.set(handler,wrapped);worker.addEventListener(type,wrapped);},removeEventListener(type,handler){worker.removeEventListener(type,listeners.get(handler));listeners.delete(handler);}};
  }
  if(config.arm==='worker')coordinator=createSaveCoordinator({getState:()=>current,storage,createWorker:measuredWorker,isBlocked:()=>false,onStatus:row=>{statuses.push({...row});if(row.phase==='saved')settleSave?.resolve();else if(['failed','protected'].includes(row.phase))settleSave?.reject(Error('Worker attempt failed: '+row.kind));},onTiming:row=>timings.push({...row}),instanceId:'stage-a-'+config.session+'-'+config.fixture});
  await sleep(500);await frame();await frame();
  for(let index=0;index<25;index++){
   const which=index%2===0?'A':'B',input=data[which];current.selectedAgentId=input.state.selectedAgentId;
   priorText=localStorage.getItem(CONFIG.saveKey);const priorHash=await hash(priorText);assert(priorHash!==input.sha256,'Same-value localStorage write is forbidden');assert(priorHash===data[which==='A'?'B':'A'].sha256,'Opposite frozen value missing before commit');
   await frame();await frame(); // Hash/readback work has ended outside this window.
   timings.length=0;statuses.length=0;commitMs=0;commitCalls=0;storageCompletedAt=null;
   const completion=config.arm==='worker'?new Promise((resolve,reject)=>{settleSave={resolve,reject};}):null;
   phase={stage:'timed-save',index,which};const rows={frames:[],loops:[]},start=performance.now();let requestMs=null;activeAttempt=()=>({index,which,phase:index===0?'cold':index<=4?'warmup':'measured',completed:false,priorHash,requestedHash:input.sha256,bytes:input.bytes,startMs:start,endMs:performance.now(),requestMs,storageCommitMs:commitMs,commitCalls,timings:timings.map(r=>({...r})),statuses:statuses.map(r=>({...r})),frames:rows.frames.map(r=>({...r})),loops:rows.loops.map(r=>({...r})),coordinator:coordinator?.inspect()??null});windowRows=rows;
   const dispatchAt=performance.now();let accepted;
   try{if(config.arm==='baseline')accepted=writeSave(storage,current);else accepted=coordinator.requestRoutine('stage-a-measure');}finally{requestMs=performance.now()-dispatchAt;}
   if(config.arm==='baseline')assert(accepted===true,'Synchronous save failed');
   else{assert(accepted===true,'Worker request rejected');await completion;assert(coordinator.inspect().workerEnabled,'Worker fallback prohibited');}
   const commitCompletedAt=storageCompletedAt,completedAt=performance.now();settleSave=null;await sleep(100);const end=performance.now();await frame();await sleep(5);windowRows=null;
   phase={stage:'readback',index,which};const text=localStorage.getItem(CONFIG.saveKey),actualHash=await hash(text);assert(text===input.text&&actualHash===input.sha256,'Committed bytes differ from frozen canonical snapshot');assert(commitCalls===1,'Expected one actual storage write');
   const sample={index,phase:index===0?'cold':index<=4?'warmup':'measured',which,priorHash,requestedHash:input.sha256,committedHash:actualHash,bytes:input.bytes,startMs:start,commitCompletedAtMs:commitCompletedAt,completedAtMs:completedAt,endMs:end,commitCompletionMs:commitCompletedAt-start,requestMs,storageCommitMs:commitMs,endToEndMs:completedAt-start,timings:timings.map(r=>({...r})),statuses:statuses.map(r=>({...r})),frames:rows.frames.filter(r=>r.end>=start&&r.start<=end),loops:rows.loops.filter(r=>r.end>=start&&r.start<=end),coordinator:coordinator?.inspect()??null,postWindowHeap:performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit}:null};
   sample.maxFrameGapMs=Math.max(0,...sample.frames.map(r=>r.gapMs));sample.maxEventLoopGapMs=Math.max(0,...sample.loops.map(r=>r.gapMs));
   result.samples.push(sample);activeAttempt=null;console.info('STAGE_A_SAMPLE '+JSON.stringify(sample));window.__stageA.progress={index,phase:sample.phase,fixture:config.fixture,arm:config.arm};
   document.getElementById('status').textContent=`${config.fixture}: ${config.arm}, ${index+1}/25. Physics paused.`;
  }
  // Full restart equality is outside performance windows; valid same source path.
  result.restoredEqual=JSON.stringify(validateSave(JSON.parse(localStorage.getItem(CONFIG.saveKey))))===JSON.stringify(validateSave(data.A.state));assert(result.restoredEqual,'Canonical restart mismatch');
  result.finalCoordinator=coordinator?.inspect()??null;result.completed=true;
 }catch(error){windowRows=null;if(activeAttempt)result.failedAttempt=activeAttempt();result.error={name:error.name,message:String(error.message).slice(0,1500),stack:String(error.stack).slice(0,5000),phase,storageFailure};if(storageFailure){try{const after=localStorage.getItem(CONFIG.saveKey);result.storageFailureEvidence={phase,beforeHash:priorText===null?null:await hash(priorText),afterHash:after===null?null:await hash(after),beforeCharacters:priorText?.length??0,afterCharacters:after?.length??0,previousBytesPreserved:after===priorText,quota:storageFailure.name==='QuotaExceededError'};}catch(readError){result.storageFailureEvidence={phase,unavailable:String(readError.message),previousBytesPreserved:null};}}}finally{windowRows=null;coordinator?.dispose();result.finishedAt=new Date().toISOString();}
 return result;
};
