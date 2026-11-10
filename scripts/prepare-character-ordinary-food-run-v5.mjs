/** Separate once-only ordinary food-run lifecycle observation. Preparation is
 * inert. Native execution requires its own reviewed receipt and branch-create
 * event. This same-seed follow-up is descriptive, not an independent replica. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApplication} from './build.mjs';
import {nativeSourceIdentity,canonicalApplicationRoot,currentRouteSnapshot,assertCurrentRoute} from './carcass-native-contract.mjs';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P,readCharacterPilotClock,guardFreshCharacterFoodRunPilot,
  projectCharacterPilot,validateCharacterPilotClock,validateCharacterPilotProjection,
  createCharacterPilotSchedule,createCharacterPilotTracker,createCharacterPilotBudget,
  boundedCharacterPilotTerminal} from './character-ordinary-food-run-v5-protocol.mjs';
import {validateCharacterPilotProjection as validateV1Projection}
  from './character-ordinary-pilot-protocol.mjs';
import {validateCharacterPilotProjection as validateV4Projection}
  from './character-ordinary-motor-v4-protocol.mjs';
import {characterPilotSourceManifest,sendCharacterPilotMessage,
  characterPilotTerminalCauses,readExternalCharacterPilotReceipt,
  installCharacterPilotObserver}
  from './prepare-character-ordinary-motor-v4.mjs';
export {characterPilotSourceManifest,sendCharacterPilotMessage,
  characterPilotTerminalCauses,readExternalCharacterPilotReceipt};

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex40=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const hex64=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const boundedNumber=(value,max=1e9)=>Number.isFinite(value)&&value>=0&&value<=max;
const boundedCount=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const epochMillis=value=>boundedNumber(value,8.64e15);
const stopCode=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value);
const receiptKeys=['activationRef','approved','commit','generatedRunnerSha256','protocol','protocolSha256',
  'rendererManifestSha256','reviewedAt','reviewedBy','runnerSha256','runtimeFingerprint',
  'schema','sourceManifestSha256','tree'];

/** No receipt can be inferred from this source or a mutable main branch. The
 * parent supplies one reviewed external receipt only after final source review. */
export function validateCharacterPilotActivation(env,event,identity,receipt,hashes,
  host={platform:process.platform,arch:process.arch,uid:process.getuid?.()}){
  assert(receipt&&typeof receipt==='object'&&!Array.isArray(receipt));
  assert.deepEqual(Object.keys(receipt).sort(),receiptKeys.slice().sort(),'Exact external receipt fields required');
  assert.equal(receipt.schema,1);assert.equal(receipt.approved,true);
  assert.equal(receipt.protocol,P.id);assert.equal(receipt.activationRef,P.activationRef);
  assert(hex40(receipt.commit)&&hex40(receipt.tree));
  for(const key of ['generatedRunnerSha256','protocolSha256','rendererManifestSha256','runnerSha256',
    'runtimeFingerprint','sourceManifestSha256'])assert(hex64(receipt[key]),'Invalid receipt '+key);
  assert(typeof receipt.reviewedBy==='string'&&receipt.reviewedBy.trim().length>0&&receipt.reviewedBy.length<=120);
  assert(typeof receipt.reviewedAt==='string'&&Number.isFinite(Date.parse(receipt.reviewedAt)));
  assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_WORKFLOW,P.workflow);
  assert.equal(env.GITHUB_EVENT_NAME,'create');assert.equal(event?.ref_type,'branch');
  assert.equal(event.ref,P.activationRef);assert.equal(env.GITHUB_REF,'refs/heads/'+P.activationRef);
  assert.equal(env.GITHUB_RUN_ATTEMPT,'1');assert.match(env.GITHUB_RUN_ID||'',/^[1-9][0-9]*$/);
  assert(hex40(env.GITHUB_SHA));assert.equal(identity.commit,env.GITHUB_SHA);
  assert.equal(env.AINCRAD_CHARACTER_FOOD_RUN_V5_RECEIPT_REF,'refs/heads/'+P.receiptRef);
  assert(hex40(env.AINCRAD_CHARACTER_FOOD_RUN_V5_RECEIPT_COMMIT),
    'Exact resolved receipt-data commit required');
  assert.equal(identity.commit,receipt.commit);assert.equal(identity.tree,receipt.tree);
  assert.equal(identity.worktreeStatus,'','Native pilot source must be clean');
  assert.equal(host.platform,'linux');assert.equal(host.arch,'x64');assert.notEqual(host.uid,0);
  assert(env.DISPLAY||env.WAYLAND_DISPLAY,'Authorized Linux display required');
  for(const key of ['sourceManifestSha256','protocolSha256','runnerSha256','generatedRunnerSha256',
    'runtimeFingerprint','rendererManifestSha256'])assert.equal(hashes[key],receipt[key],key+' differs from reviewed receipt');
  return {verified:true,commit:identity.commit,tree:identity.tree,ref:env.GITHUB_REF,
    runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,
    receiptRef:env.AINCRAD_CHARACTER_FOOD_RUN_V5_RECEIPT_REF,
    receiptCommit:env.AINCRAD_CHARACTER_FOOD_RUN_V5_RECEIPT_COMMIT,
    receiptSha256:hashes.receiptSha256};
}

/** Generated source is path-independent so its hash can be frozen externally.
 * Scratch paths enter only through a bounded process environment value. */
export function generatedCharacterPilotObserver(){
  const helpers={readCharacterPilotClock,
    guardFreshCharacterMotorPilot:guardFreshCharacterFoodRunPilot,projectCharacterPilot,
    validateCharacterPilotClock,validateCharacterPilotProjection,createCharacterPilotSchedule,
    currentRouteSnapshot,assertCurrentRoute};
  return 'const CHARACTER_ORDINARY_PILOT_PROTOCOL='+JSON.stringify(P)+';\n'+
    'const validateV1Projection='+validateV1Projection.toString()+';\n'+
    'const validateV4Projection='+validateV4Projection.toString()+';\n'+
    '('+installCharacterPilotObserver.toString()+')'+
    '(JSON.parse(process.env.AINCRAD_CHARACTER_FOOD_RUN_V5_CONTEXT),{'+
    Object.entries(helpers).map(([name,fn])=>name+':'+fn.toString()).join(',')+'});\n';
}

export async function main(args=process.argv.slice(2),env=process.env){
  assert(args.length===0||args.length===1&&['--prepare-only','--execute-approved'].includes(args[0]),
    'Only inert preparation or externally approved execution is supported');
  const execute=args[0]==='--execute-approved',identity=nativeSourceIdentity(ROOT);
  const manifest=await characterPilotSourceManifest(),manifestText=JSON.stringify(manifest)+'\n';
  const generated=generatedCharacterPilotObserver();
  const sourceHashes={sourceManifestSha256:sha(manifestText),
    protocolSha256:sha(await readFile(join(ROOT,'scripts/character-ordinary-food-run-v5-protocol.mjs'))),
    runnerSha256:sha(await readFile(fileURLToPath(import.meta.url))),
    generatedRunnerSha256:sha(generated)};
  let receipt=null,event=null,receiptSha256=null;
  if(execute){
    assert(typeof env.AINCRAD_CHARACTER_FOOD_RUN_V5_RECEIPT_PATH==='string',
      'External reviewed receipt is required before native preparation');
    assert.equal(env.AINCRAD_CHARACTER_FOOD_RUN_V5_RECEIPT_REF,'refs/heads/'+P.receiptRef,
      'Expected separate receipt-data ref required');
    assert(hex40(env.AINCRAD_CHARACTER_FOOD_RUN_V5_RECEIPT_COMMIT),
      'Exact resolved receipt-data commit required');
    const receiptPath=resolve(env.AINCRAD_CHARACTER_FOOD_RUN_V5_RECEIPT_PATH);
    assert(!receiptPath.startsWith(ROOT+'/'),'Reviewed receipt must be outside the source tree');
    ({receipt,sha256:receiptSha256}=await readExternalCharacterPilotReceipt(receiptPath));
    assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_EVENT_NAME,'create');
    assert.equal(env.GITHUB_WORKFLOW,P.workflow);
    assert.equal(env.GITHUB_REF,'refs/heads/'+P.activationRef);
    assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
    assert.equal(identity.worktreeStatus,'');
    assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
    assert.notEqual(process.getuid?.(),0);assert(env.DISPLAY||env.WAYLAND_DISPLAY);
    assert(typeof env.GITHUB_EVENT_PATH==='string');
    const eventBytes=await readFile(env.GITHUB_EVENT_PATH);
    assert(eventBytes.length<=64*1024,'Create-event payload exceeds bound');
    event=JSON.parse(eventBytes.toString('utf8'));
    assert.equal(event.ref_type,'branch');assert.equal(event.ref,P.activationRef);
    assert.equal(receipt?.approved,true,'Reviewed receipt is not approved');
    assert.equal(receipt.commit,identity.commit);assert.equal(receipt.tree,identity.tree);
    for(const [key,value]of Object.entries(sourceHashes))assert.equal(receipt[key],value,key+' differs from reviewed receipt');
  }
  const outputRoot=resolve(env.AINCRAD_CHARACTER_FOOD_RUN_V5_OUTPUT||join(ROOT,'test-results/character-ordinary-food-run-v5'));
  await mkdir(outputRoot,{recursive:true});
  const output=await mkdtemp(join(outputRoot,execute?'run-':'prepared-'));
  const temporary=await mkdtemp(join(tmpdir(),'aincrad-character-ordinary-food-run-v5-'));
  try{
    for(const name of ['profile','home','config','cache'])await mkdir(join(temporary,name));
    const application=await canonicalApplicationRoot(temporary),built=await buildApplication(application);
    const rendererManifestSha256=sha(await readFile(join(application,'renderer/asset-manifest.json')));
    const hashes={...sourceHashes,runtimeFingerprint:built.sourceFingerprint,rendererManifestSha256,receiptSha256};
    const context={protocol:P,application,profile:join(temporary,'profile'),runtimeFingerprint:built.sourceFingerprint};
    const harness=join(temporary,'observer.cjs');await writeFile(harness,generated);
    const prepared={protocol:P,sourceIdentity:identity,hashes,
      nativeExecutionAttempted:false,nativeExecutionPerformed:false,
      activationBound:false,sourceDirty:identity.worktreeStatus!=='',
      evidenceScope:'Compact JSONL and bounded process logs only; profile and application are disposable and never archived.'};
    if(!execute){
      await writeFile(join(output,'source-manifest.json'),manifestText);
      await writeFile(join(output,'observer.cjs'),generated);
      await writeFile(join(output,'candidate.json'),JSON.stringify({...prepared,
        receiptTemplate:{schema:1,approved:false,protocol:P.id,commit:identity.commit,tree:identity.tree,
          activationRef:P.activationRef,...hashes,receiptSha256:undefined,reviewedBy:'',reviewedAt:''}},null,2)+'\n');
      console.log(JSON.stringify({status:'prepared-only',output,hashes,
        nativeExecutionPerformed:false,activationBound:false,sourceDirty:prepared.sourceDirty}));
      return {output,prepared:true,executed:false};
    }
    const activation=validateCharacterPilotActivation(env,event,identity,receipt,hashes);
    const budget=createCharacterPilotBudget(),tracker=createCharacterPilotTracker();
    const launchAt=performance.now(),wallMs=()=>performance.now()-launchAt;
    let child=null,closed=false,terminal=null,ready=false,threshold=null,previousClock=null,
      expectedId=1,previousSlot=0,lastDetailedElapsed=0,graceTimer=null,killTimer=null,
      pauseSent=false,recordCount=0;
    const observer={clockReads:0,clockReadMs:0,maxClockReadMs:0,detailedReads:0,
      detailedReadMs:0,maxDetailedReadMs:0,missedWallSlots:0,missedSimulationWindows:0};
    function markStop(reason,{notifyChild=true}={}){
      budget.stop(reason,wallMs());
      if(notifyChild&&!pauseSent){
        pauseSent=true;sendCharacterPilotMessage(child,{type:'stop',reason},failure=>budget.stop(failure,wallMs()));
      }
      if(!graceTimer){
        graceTimer=setTimeout(()=>{if(!closed){child?.kill('SIGTERM');
          killTimer=setTimeout(()=>{if(!closed)child?.kill('SIGKILL');},1000);killTimer.unref?.();}},P.stopGraceMs);
        graceTimer.unref?.();
      }
    }
    function record(row,{terminalRecord=false}={}){
      const kept=budget.record(row,{terminal:terminalRecord,wallMs:wallMs()});
      if(!kept.ok){markStop('structured-cap');return false;}
      appendFileSync(join(output,'observations.jsonl'),kept.line);recordCount++;return true;
    }
    record({type:'source',activation,hashes,launchWallMs:Date.now(),
      nativeExecutionAttempted:true,nativeExecutionPerformed:false});
    const electron=createRequire(import.meta.url)('electron');
    const childEnv={...env,TMPDIR:temporary,TMP:temporary,TEMP:temporary,
      HOME:join(temporary,'home'),XDG_CONFIG_HOME:join(temporary,'config'),
      XDG_CACHE_HOME:join(temporary,'cache'),AINCRAD_CHARACTER_FOOD_RUN_V5_CONTEXT:JSON.stringify(context)};
    delete childEnv.ELECTRON_RUN_AS_NODE;
    child=spawn(electron,[harness,'--test','--test-profile='+context.profile,'--disable-gpu'],
      {cwd:ROOT,env:childEnv,stdio:['ignore','pipe','pipe','ipc']});
    const deadline=setTimeout(()=>markStop('wall-cap'),P.wallLimitMs);deadline.unref?.();
    for(const [name,stream]of [['stdout',child.stdout],['stderr',child.stderr]])
      stream.on('data',bytes=>{
        if(budget.reserve('media',bytes.length,{wallMs:wallMs()}))appendFileSync(join(output,name+'.log'),bytes);
        else markStop('media-cap');
      });
    child.on('message',message=>{
      let id=null;
      try{
        const bytes=Buffer.byteLength(JSON.stringify(message));
        assert(bytes<=P.maxIpcBytes,'Pilot IPC record exceeds bound');
        assert(exactKeys(message,['id','type','payload']),'Unexpected pilot IPC envelope fields');
        assert.equal(message.id,expectedId++,'Pilot IPC identity out of order');id=message.id;
        assert(['ready','clock','sample','terminal'].includes(message.type));
        const payload=message.payload;
        assert(payload&&typeof payload==='object'&&!Array.isArray(payload));
        if(message.type==='ready'){
          assert(exactKeys(payload,['fresh','clock','projection','preferences','profileVerified','platform','arch']));
          assert(exactKeys(payload.fresh,['ready','elapsed','worldSeed','communicationSeed','individuals']));
          assert.equal(payload.fresh.elapsed,0);
          assert.equal(payload.fresh.worldSeed,P.worldSeed);
          assert.equal(payload.fresh.communicationSeed,P.communicationSeed);
          assert.deepEqual(payload.fresh.individuals,[{id:'aster',serial:1,trained:false},
            {id:'mira',serial:2,trained:false}]);
          assert.deepEqual(payload.preferences,{sandbox:true,contextIsolation:true,
            nodeIntegration:false,webSecurity:true});
          assert.equal(payload.profileVerified,true);
          assert.equal(payload.platform,'linux');assert.equal(payload.arch,'x64');
          assert(!ready&&payload.fresh?.ready===true,'Fresh renderer guard required');
          validateCharacterPilotClock(payload.clock,{started:false});
          validateCharacterPilotProjection(payload.projection);
          assert.equal(payload.clock.elapsed,0);assert.equal(payload.clock.paused,false);
          assert.equal(payload.projection.elapsed,0);
          ready=true;const tracking=tracker.ingest(payload.projection);
          record({type:'ready',wallMs:wallMs(),fresh:payload.fresh,clock:payload.clock,
            projection:payload.projection,tracking});
        }else if(message.type==='clock'){
          assert(exactKeys(payload,['clock','slot','missedWallSlots','observerReadMs']));
          assert(ready&&!terminal,'Clock before readiness or after terminal');
          validateCharacterPilotClock(payload.clock);
          assert(boundedCount(payload.slot)&&payload.slot>previousSlot);
          assert.equal(payload.missedWallSlots,payload.slot-previousSlot-1);
          assert(boundedNumber(payload.observerReadMs));previousSlot=payload.slot;
          assert(!previousClock||payload.clock.elapsed>=previousClock.elapsed,'Clock rollback');
          previousClock=payload.clock;observer.clockReads++;
          observer.clockReadMs+=payload.observerReadMs;
          observer.maxClockReadMs=Math.max(observer.maxClockReadMs,payload.observerReadMs);
          observer.missedWallSlots+=payload.missedWallSlots;
          record({type:'clock',wallMs:wallMs(),...payload});
          if(payload.clock.threshold){
            assert(!threshold,'Threshold cannot be observed twice');
            threshold={source:'clock',elapsed:payload.clock.elapsed,
              pausedElapsed:payload.clock.pausedElapsed,
              wallMs:wallMs(),observedWallMs:payload.clock.observedWallMs};
            markStop('simulation-target',{notifyChild:false});
          }else if(payload.clock.paused)markStop('unexpected-pause');
        }else if(message.type==='sample'){
          const normal=exactKeys(payload,['projection','missedSimulationWindows','observerReadMs']);
          const crossing=exactKeys(payload,['projection','missedSimulationWindows','observerReadMs','threshold']);
          assert(normal||crossing,'Invalid detailed sample IPC fields');
          assert(ready&&!terminal&&!threshold,'Detailed sample outside running interval');
          validateCharacterPilotProjection(payload.projection);
          assert.equal(crossing,payload.projection.elapsed>=P.targetSeconds,
            'The first threshold projection must pause immediately');
          if(crossing){
            assert(exactKeys(payload.threshold,['source','elapsed','pausedElapsed','observedWallMs']));
            assert.equal(payload.threshold.source,'projection');
            assert.equal(payload.threshold.elapsed,payload.projection.elapsed);
            assert(boundedNumber(payload.threshold.pausedElapsed,1e12)&&
              payload.threshold.pausedElapsed>=payload.threshold.elapsed);
            assert.equal(payload.threshold.observedWallMs,payload.projection.wallMs);
          }
          assert(payload.projection.elapsed-lastDetailedElapsed>=P.detailSeconds-1e-8,
            'Detailed samples must be at least ten simulation seconds apart');
          assert(boundedCount(payload.missedSimulationWindows));
          assert(boundedNumber(payload.observerReadMs));
          lastDetailedElapsed=payload.projection.elapsed;
          const tracking=tracker.ingest(payload.projection);
          observer.detailedReads++;observer.detailedReadMs+=payload.observerReadMs;
          observer.maxDetailedReadMs=Math.max(observer.maxDetailedReadMs,payload.observerReadMs);
          observer.missedSimulationWindows+=payload.missedSimulationWindows;
          if(crossing){
            threshold={...payload.threshold,wallMs:wallMs()};
            markStop('simulation-target',{notifyChild:false});
          }
          record({type:'sample',wallMs:wallMs(),projection:payload.projection,tracking,
            missedSimulationWindows:payload.missedSimulationWindows,observerReadMs:payload.observerReadMs,
            ...(crossing?{threshold:payload.threshold}:{})});
        }else{
          assert(!terminal,'Duplicate terminal');
          const success=exactKeys(payload,['stopping','paused','ordinaryStarted','projection',
            'missedSimulationWindows','observerReadMs']);
          const failure=exactKeys(payload,['stopping','paused','ordinaryStarted','error']);
          assert(success||failure,'Invalid terminal IPC fields');
          assert.equal(typeof payload.ordinaryStarted,'boolean');
          if(success){
            assert(ready&&payload.ordinaryStarted,'Successful terminal requires ordinary start');
            assert(boundedCount(payload.missedSimulationWindows));
            assert(boundedNumber(payload.observerReadMs));
          }else{
            assert(typeof payload.error==='string'&&payload.error.length<=16384);
          }
          assert(payload.stopping===null||exactKeys(payload.stopping,['reason','observedWallMs']));
          assert(payload.paused===null||exactKeys(payload.paused,['elapsed','paused','observedWallMs']));
          if(payload.stopping)assert(stopCode(payload.stopping.reason)&&
            epochMillis(payload.stopping.observedWallMs),'Invalid terminal stop witness');
          if(payload.paused)assert(boundedNumber(payload.paused.elapsed,1e12)&&
            typeof payload.paused.paused==='boolean'&&epochMillis(payload.paused.observedWallMs),
          'Invalid terminal pause witness');
          const terminalCauses=characterPilotTerminalCauses(payload);
          if(failure)markStop(terminalCauses[0]);
          for(const reason of terminalCauses.slice(failure?1:0))budget.stop(reason,wallMs());
          terminal=payload;
          if(payload.projection){
            validateCharacterPilotProjection(payload.projection);
            assert(!previousClock||payload.projection.elapsed>=previousClock.elapsed,
              'Terminal projection clock rollback');
            terminal.tracking=tracker.ingest(payload.projection,{terminal:true});
          }
          observer.missedSimulationWindows+=payload.missedSimulationWindows||0;
        }
      }catch(error){markStop('observer-contract-fault');
        record({type:'fault',wallMs:wallMs(),error:String(error?.stack||error).slice(0,16384)});}
      if(id!==null)sendCharacterPilotMessage(child,{id,stop:budget.snapshot().firstCause?.reason||null},
        failure=>markStop(failure));
    });
    const outcome=await new Promise(resolve=>{
      let spawnError=null;
      child.on('error',error=>{spawnError=String(error);markStop('native-process-error');});
      child.once('close',(code,signal)=>resolve({code,signal,spawnError}));
    });
    closed=true;clearTimeout(deadline);clearTimeout(graceTimer);clearTimeout(killTimer);
    if(!budget.snapshot().firstCause)budget.stop('native-exit-before-stop',wallMs());
    const pausedConfirmed=terminal?.paused?.paused===true;
    const overshoot=threshold?threshold.elapsed-P.targetSeconds:null;
    const causes=budget.snapshot().causes;
    const complete=budget.snapshot().firstCause?.reason==='simulation-target'&&
      causes.every(row=>row.reason==='simulation-target')&&ready&&threshold&&pausedConfirmed&&
      terminal?.stopping?.reason==='simulation-target'&&!terminal?.error&&terminal?.projection&&
      terminal.ordinaryStarted===true&&terminal.paused.elapsed===threshold.pausedElapsed&&
      terminal.projection.elapsed===terminal.paused.elapsed&&
      outcome.code===0&&outcome.signal===null;
    const final=boundedCharacterPilotTerminal({type:'result',complete:Boolean(complete),
      nativeExecutionAttempted:true,nativeExecutionPerformed:Boolean(child.pid),
      ordinaryWorldStarted:terminal?.ordinaryStarted??null,ready,activation,
      terminal,threshold,pausedConfirmed,overshootSeconds:overshoot,
      overshootDeviation:overshoot!==null&&overshoot>P.overshootSeconds,
      outcome,recordsIncludingFinal:recordCount+1,observer,budget:budget.snapshot(),wallMs:wallMs(),
      interpretation:'One ordinary seed-211 food-run lifecycle observation under distinct reviewed source. This same-seed follow-up is descriptive, not independent replication or a causal comparison. Food-run decisions, physical admissions, paid action receipts, run endings, and energy flows have distinct denominators; none identifies the cause of a particular missed meal or establishes a survival benefit.',
      profileArchived:false});
    assert(record(final,{terminalRecord:true}),'Reserved final evidence must fit');
    console.log(JSON.stringify({output,complete:final.complete,firstStop:budget.snapshot().firstCause}));
    if(!final.complete)process.exitCode=1;
    return {output,prepared:false,executed:true,complete:final.complete};
  }finally{await rm(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  await main();
