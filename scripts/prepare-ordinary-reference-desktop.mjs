/** Prospective single-trajectory observer. Default invocation only prepares source.
 * Execution has an independent immutable create-event gate, never a local fallback. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildApplication} from './build.mjs';
import {nativeSourceIdentity,canonicalApplicationRoot,currentRouteSnapshot,assertCurrentRoute} from './carcass-native-contract.mjs';
import {ORDINARY_REFERENCE_PROTOCOL as P,readOrdinaryClock,projectOrdinaryReference,validateClock,validateProjection,createOrdinaryReferenceTracker,createOrdinaryOutputBudget,boundedOrdinaryTerminal} from './ordinary-reference-protocol.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const C_FILES=['scripts/ordinary-reference-protocol.mjs','scripts/prepare-ordinary-reference-desktop.mjs','tests/ordinary-reference-protocol.test.mjs','docs/visual-reference/ORDINARY-FEASIBILITY-PROTOCOL.md','.github/workflows/ordinary-reference-once.yml'];
export function sendObserverMessage(child,message,onFailure){
  if(!child?.connected){onFailure('ipc-closed');return false;}
  try{child.send(message,error=>{if(error)onFailure('ipc-send-fault');});return true;}catch{onFailure('ipc-send-fault');return false;}
}
export function validateRuntimeInventory(current,expected){assert.deepEqual(current,expected,'Runtime file inventory changed');}
export async function sourceManifest(root=ROOT){
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  assert.equal(git('rev-parse',P.sourceCommit+'^{tree}'),P.sourceTree,'Declared B tree differs from actual commit');
  const paths=git('ls-tree','-r','--name-only',P.sourceCommit).split('\n').filter(p=>p.startsWith('src/')||p.startsWith('desktop/')||['index.html','style.css','icon.svg','package.json','package-lock.json','scripts/build.mjs','scripts/carcass-native-contract.mjs'].includes(p));
  const current=git('ls-files').split('\n').filter(p=>p.startsWith('src/')||p.startsWith('desktop/'));
  validateRuntimeInventory(current,paths.filter(p=>p.startsWith('src/')||p.startsWith('desktop/')));
  const runtime=[];
  for(const path of paths){const expected=execFileSync('git',['show',P.sourceCommit+':'+path],{cwd:root});assert.equal(sha(await readFile(join(root,path))),sha(expected),'B runtime/dependency changed: '+path);runtime.push({path,sha256:sha(expected)});}
  const prospective=[];for(const path of C_FILES)prospective.push({path,sha256:sha(await readFile(join(root,path)))});
  return {schema:1,protocol:P.id,baseCommit:P.sourceCommit,baseTree:P.sourceTree,runtimeFingerprint:P.runtimeFingerprint,runtime,prospective,
    binding:'Manifest self-hash and complete approved commit/tree are frozen externally before sole reserved-ref creation. This file is not approval.'};
}
export function validateActivation(env,event,identity,host={platform:process.platform,arch:process.arch,uid:process.getuid?.()}){
  assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_WORKFLOW,P.workflow);
  assert.equal(env.GITHUB_EVENT_NAME,'create');assert.equal(event.ref_type,'branch');assert.equal(event.ref,P.activationRef);
  assert.equal(env.GITHUB_REF,'refs/heads/'+P.activationRef);assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
  assert.match(env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);assert.equal(identity.commit,env.GITHUB_SHA);assert.equal(identity.worktreeStatus,'');
  assert.equal(host.platform,P.platform);assert.equal(host.arch,P.architecture);assert.notEqual(host.uid,0);
}

/** Runs only inside isolated Electron main. No learner/action/clock-step APIs. */
export function installOrdinaryObserver(context,helpers){
  const {app}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
  const {readOrdinaryClock,projectOrdinaryReference,validateClock,validateProjection,currentRouteSnapshot,assertCurrentRoute}=helpers;
  const ORDINARY_REFERENCE_PROTOCOL=context.protocol;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let win=null,stop=null,paused=null,pausePromise=null,running=false,requestId=0,allowQuit=false;
  const waiting=new Map();
  function request(type,payload){if(process.connected===false)return Promise.reject(new Error('Observer IPC disconnected'));assert.equal(waiting.size,0,'Only one bounded observer message may be outstanding');return new Promise((resolve,reject)=>{const id=++requestId;waiting.set(id,{resolve,reject});try{process.send({id,type,payload},error=>{if(error){waiting.delete(id);reject(error);}});}catch(error){waiting.delete(id);reject(error);}});}
  const evaluate=source=>win.webContents.executeJavaScript(source);
  async function pauseOnce(reason){
    stop??={reason,at:Date.now()};
    if(pausePromise)return pausePromise;
    if(!win||win.isDestroyed())return null;
    pausePromise=(async()=>{try{paused=await evaluate(`(()=>{const q=window.__ozarkWorld;if(!q)return null;q.pause();const s=q.snapshot();return {elapsed:s.elapsed,paused:s.paused,at:Date.now()};})()`);return paused;}catch{return null;}})();
    return pausePromise;
  }
  process.on('message',message=>{
    if(message.type==='stop'){void pauseOnce(message.reason);return;}
    const entry=waiting.get(message.id);if(!entry)return;waiting.delete(message.id);
    if(message.stop)void pauseOnce(message.stop);entry.resolve(message);
  });
  process.on('disconnect',()=>{for(const entry of waiting.values())entry.reject(new Error('Observer IPC disconnected'));waiting.clear();void pauseOnce('observer-ipc-disconnected');});
  app.on('will-quit',event=>{if(!allowQuit)event.preventDefault();});
  app.on('browser-window-created',(_event,window)=>{
    assert.equal(win,null,'Only one native world window');win=window;
    win.webContents.on('render-process-gone',()=>{void pauseOnce('renderer-gone');});
    win.webContents.on('did-fail-load',()=>{void pauseOnce('load-failure');});
    win.webContents.once('did-finish-load',async()=>{
      if(running)return;running=true;
      try{
        const preferences=win.webContents.getLastWebPreferences();
        assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.sandbox,true);assert.equal(preferences.webSecurity,true);
        assert(!process.argv.includes('--no-sandbox')&&!process.argv.includes('--disable-setuid-sandbox'));
        assert.equal(await fs.realpath(app.getPath('userData')),await fs.realpath(context.profile));
        for(let i=0;i<1200&&!stop;i++){if(await evaluate('Boolean(window.__ozarkWorld)'))break;await delay(50);}
        if(stop)throw new Error('Stopped during boot: '+stop.reason);
        assertCurrentRoute(await evaluate('('+currentRouteSnapshot.toString()+')(window,document)'));
        assert.equal(await evaluate("localStorage.getItem('aincrad.world.v2')"),null);
        assert.equal(await evaluate("import('./src/build-info.js').then(m=>m.BUILD_SOURCE_FINGERPRINT)"),context.protocol.runtimeFingerprint);
        const initial=await evaluate('('+readOrdinaryClock.toString()+')()');validateClock(initial,{started:false});assert.equal(initial.elapsed,0);
        const first=await evaluate('('+projectOrdinaryReference.toString()+')()');validateProjection(first);assert.equal(first.elapsed,0);assert(Object.values(first.metrics).every(v=>v===0),'Fresh counters required');assert(first.agents.every(a=>Object.values(a.memory).every(v=>v===0)),'Fresh private memories required');
        const ack=await request('ready',{initial,projection:first,preferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true},profile:await fs.realpath(context.profile),pid:process.pid,platform:process.platform,arch:process.arch});
        if(ack.stop||stop)throw new Error('Stopped before ordinary start');
        assert.equal(await evaluate('window.__ozarkWorld.start()'),true);
        let nextSummary=10,lastElapsed=0;
        while(!stop){
          await delay(context.protocol.pollWallMs);if(stop)break;
          const began=Date.now(),sample=await evaluate('('+readOrdinaryClock.toString()+')('+context.protocol.targetSeconds+')');
          validateClock(sample);assert(sample.elapsed>=lastElapsed,'Ordinary clock rollback');lastElapsed=sample.elapsed;
          if(sample.paused&&!sample.threshold){await pauseOnce('unexpected-pause');break;}
          if(sample.threshold){stop={reason:'simulation-target',at:Date.now()};paused={elapsed:sample.pausedElapsed,paused:true,at:Date.now()};pausePromise=Promise.resolve(paused);}
          await request('clock',{...sample,observerReadMs:Date.now()-began});
          if(!stop&&sample.elapsed>=nextSummary){
            const started=Date.now(),projection=await evaluate('('+projectOrdinaryReference.toString()+')()');validateProjection(projection);
            await request('sample',{projection,observerReadMs:Date.now()-started});nextSummary=projection.elapsed+context.protocol.summarySeconds;
          }
        }
        await pauseOnce(stop.reason);
        const final=await evaluate('('+projectOrdinaryReference.toString()+')()');validateProjection(final);
        await request('terminal',{stop,paused,projection:final});
      }catch(error){
        await pauseOnce('observer-fault');
        try{await request('terminal',{stop,paused,error:String(error?.stack||error).slice(0,16384)});}catch{}
      }finally{allowQuit=true;if(win&&!win.isDestroyed())win.close();app.quit();}
    });
  });
  require(path.join(context.application,'desktop/main.cjs'));
}

export function generatedObserver(context){
  // validateProjection's lexical constant is explicitly supplied in outer scope.
  return 'const ORDINARY_REFERENCE_PROTOCOL='+JSON.stringify(P)+';\n('+installOrdinaryObserver.toString()+')('+JSON.stringify(context)+',{'+Object.entries({readOrdinaryClock,projectOrdinaryReference,validateClock,validateProjection,currentRouteSnapshot,assertCurrentRoute}).map(([k,f])=>k+':'+f.toString()).join(',')+'});\n';
}

export async function main(args=process.argv.slice(2)){
  assert(args.every(a=>['--prepare-only','--execute-approved','--write-manifest'].includes(a))&&new Set(args).size===args.length,'Unknown or duplicate argument');
  assert(!(args.includes('--execute-approved')&&(args.includes('--prepare-only')||args.includes('--write-manifest'))));
  const manifest=await sourceManifest(),manifestPath=join(ROOT,'docs/visual-reference/ordinary-feasibility-source.json');
  if(args.includes('--write-manifest')){await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');return;}
  const execute=args.includes('--execute-approved'),sourceIdentity=nativeSourceIdentity(ROOT);
  if(execute){
    validateActivation(process.env,JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8')),sourceIdentity);
    assert(process.env.DISPLAY||process.env.WAYLAND_DISPLAY,'Native display required');
    assert.deepEqual(JSON.parse(await readFile(manifestPath,'utf8')),manifest,'Source manifest must match frozen source');
  }
  const outputRoot=resolve(process.env.AINCRAD_ORDINARY_OUTPUT||join(ROOT,'test-results/ordinary-reference'));
  await mkdir(outputRoot,{recursive:true});const output=await mkdtemp(join(outputRoot,'run-')),temporary=await mkdtemp(join(tmpdir(),'aincrad-reference-ordinary-'));
  for(const name of ['profile','home','config','cache'])await mkdir(join(temporary,name));
  const application=await canonicalApplicationRoot(temporary),built=await buildApplication(application);
  assert.equal(built.sourceFingerprint,P.runtimeFingerprint);
  const context={protocol:P,application,profile:join(temporary,'profile')},harness=join(temporary,'observer.cjs'),source=generatedObserver(context);
  await writeFile(harness,source);
  const prepared={protocol:P,sourceIdentity,manifestSha256:sha(JSON.stringify(manifest,null,2)+'\n'),harnessSha256:sha(source),nativeExecutionPerformed:false,executionApproved:false,
    artifactScope:'Only bounded JSONL/media logs; runtime profile/application are disposable working files, never archived as evidence. No raw saves or profile archive retained.',output};
  if(!execute){await writeFile(join(output,'prepared.json'),JSON.stringify(prepared,null,2));await writeFile(join(output,'observer.cjs'),source);await rm(temporary,{recursive:true,force:true});console.log(JSON.stringify(prepared));return;}
  const budget=createOrdinaryOutputBudget(),tracker=createOrdinaryReferenceTracker(),launchAt=Date.now();
  let child,killTimer,closed=false,terminal=null,nativeReady=false,lastClock=null,threshold=null,pauseRequested=false,records=0;
  const observer={polls:0,pollReadMs:0,maxPollReadMs:0,detailedReads:0,detailedReadMs:0,maxDetailedReadMs:0};
  const elapsedWall=()=>Date.now()-launchAt;
  const send=message=>sendObserverMessage(child,message,stop);
  function stop(reason){budget.stop(reason,elapsedWall());if(!pauseRequested){pauseRequested=true;send({type:'stop',reason});killTimer=setTimeout(()=>{child?.kill('SIGTERM');setTimeout(()=>{if(!closed)child?.kill('SIGKILL');},1000).unref();},P.stopGraceMs);}}
  function structured(record,isTerminal=false){const bytes=Buffer.from(JSON.stringify(record)+'\n');if(!budget.reserve('structured',bytes.length,{terminal:isTerminal,wallMs:elapsedWall()})){stop('structured-cap');return false;}appendFileSync(join(output,'observations.jsonl'),bytes);records++;return true;}
  structured({type:'source',...prepared,nativeExecutionAttempted:true,nativeExecutionPerformed:false,trigger:{event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,attempt:process.env.GITHUB_RUN_ATTEMPT},launchAt});
  const electron=createRequire(import.meta.url)('electron'),env={...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary,HOME:join(temporary,'home'),XDG_CONFIG_HOME:join(temporary,'config'),XDG_CACHE_HOME:join(temporary,'cache')};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(electron,[harness,'--test','--test-profile='+context.profile,'--disable-gpu'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe','ipc']});
  const deadline=setTimeout(()=>stop('wall-cap'),Math.max(0,P.wallLimitMs-elapsedWall()));
  for(const [name,stream]of [['stdout',child.stdout],['stderr',child.stderr]])stream.on('data',bytes=>{if(budget.reserve('media',bytes.length,{wallMs:elapsedWall()}))appendFileSync(join(output,name+'.log'),bytes);else stop('media-cap');});
  child.on('message',message=>{
    try{
      assert(Buffer.byteLength(JSON.stringify(message))<=256*1024,'Observer IPC record exceeds bounded message size');
      assert(['ready','clock','sample','terminal'].includes(message.type));
      if(message.type==='clock'){
        validateClock(message.payload);assert(!lastClock||message.payload.elapsed>=lastClock.elapsed,'Clock rollback');lastClock=message.payload;observer.polls++;observer.pollReadMs+=lastClock.observerReadMs;observer.maxPollReadMs=Math.max(observer.maxPollReadMs,lastClock.observerReadMs);
        if(message.payload.threshold){threshold??={elapsed:lastClock.elapsed,wallMs:elapsedWall(),pausedElapsed:lastClock.pausedElapsed};stop('simulation-target');}
      }else if(message.type==='ready'||message.type==='sample'){
        if(message.type==='ready')nativeReady=true;const tracking=tracker.ingest(message.payload.projection);if(message.type==='sample'){observer.detailedReads++;observer.detailedReadMs+=message.payload.observerReadMs;observer.maxDetailedReadMs=Math.max(observer.maxDetailedReadMs,message.payload.observerReadMs);}structured({type:message.type,nativeExecutionPerformed:nativeReady,wallMs:elapsedWall(),...message.payload,tracking});
      }else{
        terminal=message.payload;if(terminal.stop?.reason)budget.stop(terminal.stop.reason,elapsedWall());
        if(terminal.projection)terminal.tracking=tracker.ingest(terminal.projection,{terminal:true});
      }
      send({id:message.id,stop:budget.snapshot().firstBound?.reason||null});
    }catch(error){stop('observer-contract-fault');structured({type:'fault',error:String(error.stack).slice(0,16384),wallMs:elapsedWall()});send({id:message.id,stop:'observer-contract-fault'});}
  });
  const outcome=await new Promise(resolve=>{let spawnError=null;child.on('error',e=>{spawnError=String(e);stop('native-process-error');});child.once('close',(code,signal)=>resolve({code,signal,spawnError}));});
  closed=true;clearTimeout(deadline);clearTimeout(killTimer);
  if(!budget.snapshot().firstBound)budget.stop('native-exit-before-stop',elapsedWall());
  const pausedConfirmed=terminal?.paused?.paused===true,overshoot=threshold&&terminal?.paused?terminal.paused.elapsed-P.targetSeconds:null;
  const complete=budget.snapshot().firstBound.reason==='simulation-target'&&pausedConfirmed&&!terminal.error&&budget.snapshot().causes.every(c=>c.reason==='simulation-target')&&outcome.code===0&&outcome.signal===null;
  const finalRecord=boundedOrdinaryTerminal({type:'result',complete,nativeExecutionAttempted:true,nativeExecutionPerformed:nativeReady,terminal,threshold,pausedConfirmed,overshootSeconds:overshoot,overshootDeviation:overshoot!==null&&overshoot>P.overshootSeconds,
    outcome,recordsIncludingFinal:records+1,observer,budgetSnapshotBeforeFinalWrite:true,wallMs:elapsedWall(),budget:budget.snapshot(),scope:'Single ordinary trajectory feasibility; no causal benefit or generalization inference.',profileArchived:false});
  assert(structured(finalRecord,true),'Reserved final evidence must be written');
  await rm(temporary,{recursive:true,force:true});
  console.log(JSON.stringify({output,complete:finalRecord.complete,firstStop:budget.snapshot().firstBound}));if(!finalRecord.complete)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
