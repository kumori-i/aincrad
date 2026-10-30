import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P,
  CHARACTER_PILOT_COUNT_KEYS,validateCharacterPilotProjection} from '../scripts/character-ordinary-pilot-protocol.mjs';
import {characterPilotSourceManifest,characterPilotTerminalCauses,
  generatedCharacterPilotObserver,main,
  readExternalCharacterPilotReceipt,sendCharacterPilotMessage,
  validateCharacterPilotActivation} from '../scripts/prepare-character-ordinary-pilot.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=new URL('../',import.meta.url);
const sourcePath=new URL('../scripts/prepare-character-ordinary-pilot.mjs',import.meta.url);
const hashes=Object.fromEntries(['sourceManifestSha256','protocolSha256','runnerSha256',
  'generatedRunnerSha256','runtimeFingerprint','rendererManifestSha256']
  .map((key,index)=>[key,(index+1).toString(16).repeat(64)]));
const env={GITHUB_ACTIONS:'true',GITHUB_WORKFLOW:P.workflow,GITHUB_EVENT_NAME:'create',
  GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'41000000000',
  GITHUB_SHA:'a'.repeat(40),DISPLAY:':91'};
const event={ref_type:'branch',ref:P.activationRef};
const identity={commit:'a'.repeat(40),tree:'b'.repeat(40),worktreeStatus:''};
const receipt={schema:1,approved:true,protocol:P.id,activationRef:P.activationRef,
  commit:identity.commit,tree:identity.tree,...hashes,reviewedBy:'Independent reviewer',
  reviewedAt:'2026-10-30T00:00:00Z'};
const host={platform:'linux',arch:'x64',uid:1000};

test('activation requires exact external receipt, one create event, clean source, approved hashes and host',()=>{
  assert.deepEqual(validateCharacterPilotActivation(env,event,identity,receipt,
    {...hashes,receiptSha256:'f'.repeat(64)},host),{
    verified:true,commit:identity.commit,tree:identity.tree,ref:env.GITHUB_REF,
    runId:env.GITHUB_RUN_ID,attempt:'1',receiptSha256:'f'.repeat(64)});
  const rejected=[
    [env,event,identity,{...receipt,approved:false},hashes,host],
    [env,event,identity,{...receipt,extra:true},hashes,host],
    [env,event,identity,{...receipt,commit:'c'.repeat(40)},hashes,host],
    [env,event,identity,receipt,{...hashes,runnerSha256:'0'.repeat(64)},host],
    [{...env,GITHUB_RUN_ATTEMPT:'2'},event,identity,receipt,hashes,host],
    [{...env,GITHUB_EVENT_NAME:'push'},event,identity,receipt,hashes,host],
    [{...env,GITHUB_REF:'refs/heads/main'},event,identity,receipt,hashes,host],
    [{...env,GITHUB_SHA:'c'.repeat(40)},event,identity,receipt,hashes,host],
    [{...env,DISPLAY:'',WAYLAND_DISPLAY:''},event,identity,receipt,hashes,host],
    [env,{...event,ref_type:'tag'},identity,receipt,hashes,host],
    [env,{...event,ref:'main'},identity,receipt,hashes,host],
    [env,event,{...identity,worktreeStatus:' M src/main.js'},receipt,hashes,host],
    [env,event,identity,receipt,hashes,{...host,uid:0}],
    [env,event,identity,receipt,hashes,{...host,arch:'arm64'}],
  ];
  for(const args of rejected)assert.throws(()=>validateCharacterPilotActivation(...args));
});

test('external receipt is an absolute bounded regular file',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-pilot-receipt-test-'));
  try{
    const file=join(scratch,'receipt.json'),bytes=Buffer.from(JSON.stringify(receipt));
    await writeFile(file,bytes);
    assert.deepEqual(await readExternalCharacterPilotReceipt(file),{receipt,sha256:sha(bytes)});
    await assert.rejects(readExternalCharacterPilotReceipt('receipt.json'),/absolute/);
    await assert.rejects(readExternalCharacterPilotReceipt(scratch),/bounded regular file/);
    await writeFile(file,'x'.repeat(16*1024+1));
    await assert.rejects(readExternalCharacterPilotReceipt(file),/bounded regular file/);
  }finally{await rm(scratch,{recursive:true,force:true});}
});

test('missing reviewed receipt blocks execute mode before output directory or native build',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-pilot-refusal-test-'));
  const output=join(scratch,'not-created');
  try{
    await assert.rejects(main(['--execute-approved'],{
      ...process.env,AINCRAD_CHARACTER_PILOT_OUTPUT:output,
      AINCRAD_CHARACTER_PILOT_RECEIPT_PATH:undefined,
    }),/External reviewed receipt is required before native preparation/);
    await assert.rejects(readdir(output),{code:'ENOENT'});
  }finally{await rm(scratch,{recursive:true,force:true});}
});

test('default preparation creates only review artifacts, hashes tracked source, and never executes native',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-pilot-prepare-test-'));
  try{
    const result=await main([],{...process.env,AINCRAD_CHARACTER_PILOT_OUTPUT:scratch});
    assert.equal(result.prepared,true);assert.equal(result.executed,false);
    assert.equal(result.output.startsWith(join(scratch,'prepared-')),true);
    assert.deepEqual((await readdir(result.output)).sort(),
      ['candidate.json','observer.cjs','source-manifest.json']);
    const candidate=JSON.parse(await readFile(join(result.output,'candidate.json'),'utf8'));
    const manifestBytes=await readFile(join(result.output,'source-manifest.json'));
    const manifest=JSON.parse(manifestBytes),generated=await readFile(join(result.output,'observer.cjs'),'utf8');
    assert.equal(candidate.nativeExecutionAttempted,false);
    assert.equal(candidate.nativeExecutionPerformed,false);
    assert.equal(candidate.activationBound,false);
    assert.equal(candidate.receiptTemplate.approved,false);
    assert.equal(candidate.hashes.sourceManifestSha256,sha(manifestBytes));
    assert.equal(candidate.hashes.generatedRunnerSha256,sha(generated));
    assert.equal(candidate.hashes.runnerSha256,sha(await readFile(sourcePath)));
    assert.equal(generated,generatedCharacterPilotObserver());
    assert.equal(manifest.commit,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
    assert.equal(manifest.tree,execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim());
    const tracked=execFileSync('git',['ls-tree','-r','-z','--name-only','HEAD'],
      {cwd:root,encoding:'buffer'}).toString('utf8').split('\0').filter(Boolean);
    assert.deepEqual(manifest.files.map(row=>row.path),tracked);
    const sourceEntry=manifest.files.find(row=>row.path==='src/ozark-save.js');
    assert(sourceEntry);assert.equal(sourceEntry.sha256,
      sha(await readFile(new URL('../src/ozark-save.js',import.meta.url))));
    assert.deepEqual(manifest,await characterPilotSourceManifest());
  }finally{await rm(scratch,{recursive:true,force:true});}
});

test('generated observer parses as CJS and contains ordinary read/start/pause only',()=>{
  const generated=generatedCharacterPilotObserver();
  new vm.Script(generated,{filename:'observer.cjs'});
  assert.match(generated,/AINCRAD_CHARACTER_PILOT_CONTEXT/);
  assert.match(generated,/communicationMeasurementSnapshot/);
  assert.match(generated,/window\.__ozarkWorld\.start\(\)/);
  assert.match(generated,/q\.pause\(\)/);
  assert.doesNotMatch(generated,/\.step\(|\.referenceFixture\(|\.auditAssociation\(|nextDecisionAt\s*=/);
});

test('bounded IPC helper reports closed, synchronous and callback failures without retry',()=>{
  const failures=[];let sends=0;const fail=reason=>failures.push(reason);
  assert.equal(sendCharacterPilotMessage({connected:false,send(){sends++;}},
    {type:'stop'},fail),false);
  assert.equal(sendCharacterPilotMessage({connected:true,send(){sends++;throw Error('closed');}},
    {type:'stop'},fail),false);
  assert.equal(sendCharacterPilotMessage({connected:true,send(_message,callback){
    sends++;callback(Error('race'));
  }},{type:'stop'},fail),true);
  assert.equal(sends,2);
  assert.deepEqual(failures,['ipc-closed','ipc-send-fault','ipc-send-fault']);
});

test('terminal cause preserves witnessed load and renderer failures ahead of generic faults',()=>{
  const source=reason=>({stopping:{reason,observedWallMs:Date.now()},
    ordinaryStarted:false,error:'failed'});
  assert.deepEqual(characterPilotTerminalCauses(source('load-failure')),['load-failure']);
  assert.deepEqual(characterPilotTerminalCauses(source('renderer-gone')),['renderer-gone']);
  assert.deepEqual(characterPilotTerminalCauses({stopping:null,ordinaryStarted:false,
    error:'guard rejected'}),['prelaunch-guard-failed']);
  assert.deepEqual(characterPilotTerminalCauses({stopping:{reason:'simulation-target'},
    ordinaryStarted:true,error:'terminal read failed'}),['simulation-target','observer-fault']);
});

function projection(elapsed){
  const body=()=>Object.fromEntries(['health','satietyHours','availableEnergyKcal',
    'storedEnergyKcal','waterDeficitMl','stamina','fatigue','sleepPressure',
    'hoursSinceMeal','starvationHours'].map(key=>[key,0]));
  const totals=()=>Object.fromEntries(['ingestedKcal','absorbedKcal','metabolizedKcal']
    .map(key=>[key,0]));
  const stats=()=>Object.fromEntries(['collapses','rescues','independentMeals',
    'independentDrinks'].map(key=>[key,0]));
  const survivalCounts=()=>Object.fromEntries(['begun','finished','incomplete',
    'superseded','evictedRecords','droppedNotes','rejectedNotes'].map(key=>[key,0]));
  const actor=(id,partner,identity)=>({id,identity,epoch:0,elapsed,scene:'forest',
    position:{x:0,y:0},lifecycle:'ordinary',activeAction:null,body:body(),totals:totals(),stats:stats(),
    character:{senderUpdates:0,listenerUpdates:0,uniqueDemonstrations:0,replayUses:0,
      partnerBanks:[{partnerId:partner,partnerSerial:3-identity,retainedExamples:0,trained:false}]},
    survival:{counters:survivalCounts(),recordsRetained:0,decisionActive:false,gateCounts:{}}});
  return {elapsed,wallMs:Date.now(),version:12,geometryIdentity:P.geometryIdentity,
    worldSeed:P.worldSeed,communicationSeed:P.communicationSeed,phase:P.phase,
    fixedStep:P.fixedStep,clocks:{environment:elapsed,ecology:elapsed,pending:0},
    counts:Object.fromEntries(CHARACTER_PILOT_COUNT_KEYS.map(key=>[key,0])),
    reasons:[],reasonOverflow:0,eventsRetained:0,eventsEvicted:0,eventsRetired:0,
    saturated:false,admissionGates:{},admissionGateKeysOmitted:0,pending:0,
    identityPendingReconciliation:false,actors:[actor('aster','mira',1),actor('mira','aster',2)],
    player:{position:{x:0,y:0},body:body()},events:[]};
}

async function mockedObserver({stopBeforeReady=false,rendererGone=false,
  loadFailureBeforeReady=false,rendererGoneBeforeReady=false,
  unexpectedPause=false,freshGuardFault=false,clockTimeline=null,projectionLag=[]}={}){
  const app=new EventEmitter(),proc=new EventEmitter(),contents=new EventEmitter(),win=new EventEmitter();
  const messages=[];let started=false,paused=false,elapsed=0,startCalls=0,pauseCalls=0,closed=false;
  let wallMs=0,clockIndex=0,projectionIndex=0;
  const prefs={nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true};
  contents.getLastWebPreferences=()=>prefs;
  contents.executeJavaScript=async source=>{
    if(source==='Boolean(window.__ozarkWorld)')return true;
    if(source.includes('currentRouteSnapshot'))return {ready:true};
    if(source.includes("import('./src/build-info.js')"))return 'f'.repeat(64);
    if(source.includes('guardFreshCharacterPilot')){
      if(freshGuardFault)throw Error('Fresh world guard rejected occupied slot');
      return {ready:true};
    }
    if(source.includes('readCharacterPilotClock')){
      if(!started)return {elapsed:0,observedWallMs:Date.now(),started:false,paused:false,
        blocked:false,speed:1,fixtureOwned:false,threshold:false,pausedElapsed:null};
      elapsed=unexpectedPause?20:clockTimeline?.[clockIndex++]??1200.25;
      const threshold=!unexpectedPause&&elapsed>=P.targetSeconds;
      if(unexpectedPause)paused=true;
      else if(threshold){paused=true;pauseCalls++;}
      return {elapsed,observedWallMs:Date.now(),started:true,paused,
        blocked:false,speed:1,fixtureOwned:false,threshold,
        pausedElapsed:threshold?elapsed:null};
    }
    if(source.includes('projectCharacterPilot')){
      if(started&&!paused)elapsed+=projectionLag[projectionIndex++]??0;
      return projection(elapsed);
    }
    if(source==='window.__ozarkWorld.start()'){started=true;paused=false;startCalls++;return true;}
    if(source.includes('const before=q.snapshot()')){if(started&&!paused){paused=true;pauseCalls++;}
      return {elapsed,paused,observedWallMs:Date.now()};}
    throw Error('Unexpected renderer evaluation: '+source.slice(0,100));
  };
  win.webContents=contents;win.isDestroyed=()=>closed;win.close=()=>{closed=true;};
  app.getPath=()=>'/isolated/profile';
  const done=new Promise(resolve=>{app.quit=()=>resolve();});
  proc.argv=[];proc.connected=true;proc.platform='linux';proc.arch='x64';
  proc.env={AINCRAD_CHARACTER_PILOT_CONTEXT:JSON.stringify({protocol:P,
    profile:'/isolated/profile',application:'/isolated/app',runtimeFingerprint:'f'.repeat(64)})};
  proc.send=(message,callback)=>{messages.push(message);queueMicrotask(()=>{
    if(message.type==='ready'&&stopBeforeReady)proc.emit('message',{type:'stop',reason:'wall-cap'});
    if(message.type==='ready'&&rendererGone)contents.emit('render-process-gone');
    if(!stopBeforeReady)proc.emit('message',{id:message.id});
    else if(message.type!=='ready')proc.emit('message',{id:message.id});
  });callback?.();};
  const require=name=>name==='electron'?{app}:name==='node:assert/strict'?assert:
    name==='node:fs/promises'?{realpath:async path=>path}:name==='node:path'?{join:(...parts)=>parts.join('/')}:
      (queueMicrotask(()=>{app.emit('browser-window-created',null,win);
        if(loadFailureBeforeReady)contents.emit('did-fail-load',null,-3,'load failed','',true);
        else if(rendererGoneBeforeReady)contents.emit('render-process-gone');
        else contents.emit('did-finish-load');}),{});
  vm.runInNewContext(generatedCharacterPilotObserver(),{require,process:proc,Date,Number,
    Boolean,Map,Promise,Buffer,performance:{now:()=>wallMs},setTimeout:(callback,delay)=>{
      wallMs+=delay;queueMicrotask(callback);return 1;},console});
  await done;
  return {messages,startCalls,pauseCalls,closed,exitCode:proc.exitCode};
}

test('serialized observer reaches target through clock polling and closes after one pause',async()=>{
  const observed=await mockedObserver();
  assert.equal(observed.startCalls,1,JSON.stringify(observed));assert.equal(observed.pauseCalls,1);
  assert.equal(observed.closed,true);assert.notEqual(observed.exitCode,1);
  assert.deepEqual(observed.messages.map(row=>row.type),['ready','clock','terminal']);
  assert.equal(observed.messages[0].payload.profileVerified,true);
  assert.equal(observed.messages[0].payload.preferences.sandbox,true);
  assert.deepEqual(Object.keys(observed.messages[1].payload).sort(),
    ['clock','missedWallSlots','observerReadMs','slot']);
  assert.equal(observed.messages[1].payload.clock.threshold,true);
  assert.equal(observed.messages.at(-1).payload.paused.elapsed,1200.25);
  assert.equal(observed.messages.at(-1).payload.stopping.reason,'simulation-target');
});

test('clock-to-projection frame advance cannot shorten detailed sample spacing',async()=>{
  const observed=await mockedObserver({clockTimeline:[10,20,21,1200.25],
    projectionLag:[0.1,0]});
  const clocks=observed.messages.filter(row=>row.type==='clock').map(row=>row.payload.clock.elapsed);
  const samples=observed.messages.filter(row=>row.type==='sample').map(row=>row.payload.projection.elapsed);
  assert.deepEqual(clocks,[10,20,21,1200.25]);
  assert.deepEqual(samples,[10.1,21]);
  assert(samples[1]-samples[0]>=P.detailSeconds);
  assert.equal(observed.pauseCalls,1);assert.notEqual(observed.exitCode,1);
});

test('first threshold in a detailed projection pauses before another clock read',async()=>{
  const observed=await mockedObserver({clockTimeline:[1199.9],projectionLag:[0.2]});
  assert.deepEqual(observed.messages.map(row=>row.type),['ready','clock','sample','terminal']);
  const clock=observed.messages[1].payload.clock;
  const sample=observed.messages[2].payload;
  const terminal=observed.messages[3].payload;
  assert.equal(clock.threshold,false);assert(clock.elapsed<P.targetSeconds);
  assert(sample.projection.elapsed>=P.targetSeconds);
  assert.equal(sample.threshold.source,'projection');
  assert.equal(sample.threshold.elapsed,sample.projection.elapsed);
  assert.equal(sample.threshold.observedWallMs,sample.projection.wallMs);
  assert.equal(sample.threshold.pausedElapsed,terminal.paused.elapsed);
  assert.equal(terminal.stopping.reason,'simulation-target');
  assert.equal(terminal.projection.elapsed,terminal.paused.elapsed);
  assert.equal(observed.pauseCalls,1);assert.notEqual(observed.exitCode,1);
});

test('wall stop before readiness never starts the world and still emits terminal evidence',async()=>{
  const observed=await mockedObserver({stopBeforeReady:true});
  assert.equal(observed.startCalls,0);assert.equal(observed.pauseCalls,0);
  assert.equal(observed.exitCode,1);assert.equal(observed.messages.at(-1).type,'terminal');
  assert.equal(observed.messages.at(-1).payload.stopping.reason,'wall-cap');
});

test('renderer failure and unexpected pause remain explicit noncompletion',async()=>{
  for(const options of [{rendererGone:true},{unexpectedPause:true}]){
    const observed=await mockedObserver(options);
    assert.equal(observed.closed,true);assert.equal(observed.exitCode,1);
    assert.equal(observed.pauseCalls,0,'Only a started world can be paused');
    assert.equal(observed.messages.at(-1).type,'terminal');
    assert.match(observed.messages.at(-1).payload.stopping.reason,
      /^(renderer-gone|unexpected-pause)$/);
  }
});

test('prelaunch fresh guard failure stays a no-world-start terminal blocker',async()=>{
  const observed=await mockedObserver({freshGuardFault:true});
  assert.equal(observed.startCalls,0);assert.equal(observed.pauseCalls,0);
  assert.equal(observed.exitCode,1);
  assert.deepEqual(observed.messages.map(row=>row.type),['terminal']);
  assert.equal(observed.messages[0].payload.ordinaryStarted,false);
  assert.equal(observed.messages[0].payload.stopping.reason,'prelaunch-guard-failed');
});

test('pre-ready load and renderer failures close with bounded terminal evidence',async()=>{
  for(const [options,reason]of [[{loadFailureBeforeReady:true},'load-failure'],
    [{rendererGoneBeforeReady:true},'renderer-gone']]){
    const observed=await mockedObserver(options);
    assert.equal(observed.startCalls,0);assert.equal(observed.pauseCalls,0);
    assert.equal(observed.closed,true);assert.equal(observed.exitCode,1);
    assert.deepEqual(observed.messages.map(row=>row.type),['terminal']);
    assert.equal(observed.messages[0].payload.stopping.reason,reason);
    assert.equal(observed.messages[0].payload.ordinaryStarted,false);
  }
});
