import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {ORDINARY_REFERENCE_PROTOCOL as P,createOrdinaryOutputBudget,boundedOrdinaryTerminal,createOrdinaryReferenceTracker,validateClock,validateProjection,readOrdinaryClock,projectOrdinaryReference} from '../scripts/ordinary-reference-protocol.mjs';
import {validateActivation,sendObserverMessage,validateRuntimeInventory,generatedObserver} from '../scripts/prepare-ordinary-reference-desktop.mjs';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
const snapshot=(elapsed=0,events=[])=>({geometryIdentity:P.geometryIdentity,elapsed,referenceElapsed:elapsed,worldSeed:74193,communicationSeed:211,phase:'private-visual-association',fixedStep:1/60,version:12,agents:[{elapsed,memory:{}},{elapsed,memory:{}}],events,metrics:{exchanges:0},gates:{},clocks:{environment:elapsed,ecology:elapsed,pending:0}});
test('actual fresh state projection is read-only, compact and validates without advancing simulation',async()=>{
  const state=createOzarkState(createOzarkWorldGeometry(),{communicationSeed:P.communicationSeed}),before=structuredClone(state);
  const reference=attachVisualReferenceLearning({state,pixelSensor:{capture(){throw new Error('No sensor/behavior invocation allowed');}}});
  const context={window:{__ozarkWorld:{fullSnapshot:()=>structuredClone(state),communicationSnapshot:()=>reference.snapshot()}},Date,Number,Object};
  const source='('+projectOrdinaryReference.toString().replace("await import('./src/config.js')","({CONFIG:{fixedStep:1/60}})")+')()';
  const projection=await vm.runInNewContext(source,context);validateProjection(projection);
  assert.deepEqual(state,before);assert.equal(projection.worldSeed,74193);assert.equal(projection.events.length,0);
  assert(!JSON.stringify(projection).includes('features'));reference.dispose();
});
test('clock reader only invokes ordinary pause on first reached threshold',()=>{
  let pauses=0;const state={elapsed:1199,started:true,paused:false,blocked:false};
  const context={window:{__ozarkWorld:{snapshot:()=>({...state}),referenceFixtureState:()=>null,pause(){pauses++;state.paused=true;}}},document:{getElementById:()=>({value:'1'})},Date,Number};
  const read=()=>vm.runInNewContext('('+readOrdinaryClock.toString()+')(1200)',context);
  validateClock(read());assert.equal(pauses,0);state.elapsed=1200.5;assert.equal(read().threshold,true);assert.equal(pauses,1);assert.equal(read().threshold,false);assert.equal(pauses,1);
  assert.throws(()=>validateClock({...read(),speed:4}));assert.throws(()=>validateClock({...read(),fixtureOwned:true}));
});
test('ledger counts terminal events once, keeps modes separate and reports missing IDs/outcomes',()=>{
  const t=createOrdinaryReferenceTracker();
  t.ingest(snapshot(0,[{id:1,status:'choice',choiceMode:'uniform-exploration'}]));
  let r=t.ingest(snapshot(10,[{id:1,status:'observed',choiceMode:'uniform-exploration',referenceCorrect:false},{id:2,status:'choice'}]));
  assert.equal(r.outcomes.exploratory.incorrect,1);
  r=t.ingest(snapshot(20,[{id:3,status:'observed',choiceMode:'association-match',referenceCorrect:true}]));
  assert.equal(r.coverage.missingTerminal,1);assert.equal(r.outcomes.matched.correct,1);
  r=t.ingest(snapshot(30,[{id:3,status:'observed',choiceMode:'association-match',referenceCorrect:true},{id:6,status:'censored'}]));
  assert.equal(r.outcomes.matched.correct,1);assert.equal(r.coverage.missingIds,2);assert.equal(r.outcomes.unknownMode.censored,1);
  assert.throws(()=>t.ingest(snapshot(31,[{id:1,status:'observed'}])),/Retired/);
  assert.throws(()=>t.ingest(snapshot(29,[])),/regressed/);
});
test('ledger cadence and bounded retained capacity; disappearance never invents outcomes',()=>{
  const t=createOrdinaryReferenceTracker();assert(t.ingest(snapshot()).due);assert(!t.ingest(snapshot(9.9)).due);assert(t.ingest(snapshot(10)).due);
  t.ingest(snapshot(20,Array.from({length:256},(_,i)=>({id:i+1,status:'choice'}))));
  const r=t.ingest(snapshot(30,Array.from({length:256},(_,i)=>({id:i+257,status:'choice'}))));assert.equal(r.pendingObserved,256);assert.equal(r.coverage.missingTerminal,256);
  assert.throws(()=>t.ingest(snapshot(31,[])),/disappeared/);
});
test('UTF8 whole-write budget reserves terminal bytes, immutable first bound and bounded causes',()=>{
  const b=createOrdinaryOutputBudget({structuredBytes:100,mediaBytes:10,terminalReserveBytes:20});
  const bytes=Buffer.byteLength(JSON.stringify({symbol:'☃'})+'\n');assert(b.reserve('structured',bytes));
  assert(!b.reserve('structured',81-bytes));assert.equal(b.snapshot().firstBound.reason,'structured-cap');
  assert(b.reserve('structured',100-bytes,{terminal:true}));assert(!b.reserve('structured',1,{terminal:true}));
  assert(!b.reserve('media',11));b.stop('wall-cap',5);assert.equal(b.snapshot().firstBound.reason,'structured-cap');assert.equal(b.snapshot().causes.length,3);
  for(let i=0;i<30;i++)b.stop('cause'+i,i);assert.equal(b.snapshot().causes.length,16);
});
test('activation rejects reruns, wrong event/ref/platform/source and dirty tree',()=>{
  const env={GITHUB_ACTIONS:'true',GITHUB_WORKFLOW:P.workflow,GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40)},event={ref_type:'branch',ref:P.activationRef},identity={commit:'a'.repeat(40),worktreeStatus:''},host={platform:'linux',arch:'x64',uid:1000};
  validateActivation(env,event,identity,host);
  for(const delta of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/heads/main'},{GITHUB_SHA:'b'.repeat(40)}])assert.throws(()=>validateActivation({...env,...delta},event,identity,host));
  assert.throws(()=>validateActivation(env,{...event,ref_type:'tag'},identity,host));assert.throws(()=>validateActivation(env,event,{...identity,worktreeStatus:' M src/x.js'},host));assert.throws(()=>validateActivation(env,event,identity,{...host,uid:0}));
});
async function mockedObserver({stopBeforeReady=false,unexpectedPause=false,disconnect=false,ipcThrow=false}={}){
  const app=new EventEmitter(),proc=new EventEmitter(),contents=new EventEmitter(),win=new EventEmitter();
  let started=false,paused=true,elapsed=0,startCalls=0,pauseCalls=0,closed=false;const messages=[];
  const prefs={nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true};
  const q={snapshot:()=>({elapsed,started,paused,blocked:false,version:12,features:{plantLifecycle:1,finiteAquatic:2,worldStructures:1,characterMessages:2}}),referenceFixtureState:()=>null,start(){startCalls++;started=true;paused=false;return true;},pause(){pauseCalls++;paused=true;}};
  const renderer={window:{__ozarkWorld:q,location:{href:'aincrad://app/index.html?test=1'}},document:{getElementById:id=>id==='simulation-speed'?{value:'1'}:null},Date,Number,Boolean};
  contents.getLastWebPreferences=()=>prefs;contents.executeJavaScript=async source=>{
    if(source.includes('projectOrdinaryReference'))return snapshot(elapsed);
    if(source.includes("localStorage.getItem"))return null;
    if(source.includes("import('./src/build-info.js')"))return P.runtimeFingerprint;
    if(source.includes('readOrdinaryClock')&&started){elapsed=unexpectedPause?20:1200.25;if(unexpectedPause)paused=true;} // MOCK observation, never a real world tick.
    return vm.runInNewContext(source,renderer);
  };
  win.webContents=contents;win.isDestroyed=()=>closed;win.close=()=>{closed=true;};
  app.getPath=()=>'/isolated/profile';const done=new Promise(resolve=>{app.quit=()=>resolve();});
  proc.argv=[];proc.pid=99;proc.platform='linux';proc.arch='x64';proc.send=(m,cb)=>{messages.push(m);if(ipcThrow&&m.type==='ready')throw new Error('Synchronous IPC send failed');queueMicrotask(()=>{if(m.type==='ready'&&disconnect){proc.connected=false;proc.emit('disconnect');return;}if(m.type==='ready'&&stopBeforeReady)proc.emit('message',{type:'stop',reason:'wall-cap'});proc.emit('message',{id:m.id});});cb?.();};
  const require=name=>name==='electron'?{app}:name==='node:assert/strict'?assert:name==='node:fs/promises'?{realpath:async p=>p}:name==='node:path'?{join:(...s)=>s.join('/')}:(queueMicrotask(()=>{app.emit('browser-window-created',null,win);contents.emit('did-finish-load');}),{});
  vm.runInNewContext(generatedObserver({protocol:P,profile:'/isolated/profile',application:'/isolated/app'}),{require,process:proc,Date,Number,Boolean,Map,Promise,setTimeout:fn=>{queueMicrotask(fn);return 1;},console});
  await done;return {startCalls,pauseCalls,closed,messages};
}
test('serialized observer uses ordinary start/pause once with mocked clock/IPC, no simulation',async()=>{
  const {startCalls,pauseCalls,closed,messages}=await mockedObserver();assert.equal(startCalls,1);assert.equal(pauseCalls,1);assert.equal(closed,true);assert.deepEqual(messages.map(m=>m.type),['ready','clock','terminal']);assert.equal(messages.at(-1).payload.paused.elapsed,1200.25);
});
test('prospective source contains no behavior fixture/step/audit calls and no active alternate trigger',async()=>{
  const runner=await readFile(new URL('../scripts/prepare-ordinary-reference-desktop.mjs',import.meta.url),'utf8');
  assert(!/\.referenceFixture\(|\.step\(|\.auditAssociation\(|nextDecisionAt\s*=/.test(runner));
  const yaml=await readFile(new URL('../.github/workflows/ordinary-reference-once.yml',import.meta.url),'utf8');
  assert(yaml.includes('on: create'));assert(!/^\s+(push|pull_request|workflow_dispatch):/m.test(yaml));
});

test('large terminal projection cannot spend beyond reserved block or silently retain complete status',()=>{
  const raw={type:'result',complete:true,pausedConfirmed:true,budget:{firstBound:{reason:'media-cap'}},terminal:{projection:{elapsed:22,events:['x'.repeat(300000)]},tracking:{},stop:{reason:'media-cap'}}};
  const out=boundedOrdinaryTerminal(raw);assert.equal(out.complete,false);assert.equal(out.terminalTruncated,true);assert.equal(out.terminal.elapsed,22);assert.equal(out.budget.firstBound.reason,'media-cap');assert(Buffer.byteLength(JSON.stringify(out))<192*1024);
});

test('runtime inventory rejects added and missing source/desktop files',()=>{
  const expected=['desktop/main.cjs','src/main.js'];validateRuntimeInventory([...expected],expected);
  assert.throws(()=>validateRuntimeInventory([...expected,'src/extra.js'],expected));
  assert.throws(()=>validateRuntimeInventory(['src/main.js'],expected));
  assert.throws(()=>validateProjection({...snapshot(),geometryIdentity:'other-world'}));
});

test('closed and racing IPC stops without unhandled send exceptions or repeated sending',()=>{
  const failures=[];let calls=0;const fail=r=>failures.push(r);
  assert.equal(sendObserverMessage({connected:false,send(){calls++;}},{},fail),false);assert.equal(calls,0);
  assert.equal(sendObserverMessage({connected:true,send(){calls++;throw new Error('closed');}},{},fail),false);
  assert.equal(sendObserverMessage({connected:true,send(m,cb){calls++;cb(new Error('race'));}},{},fail),true);
  assert.deepEqual(failures,['ipc-closed','ipc-send-fault','ipc-send-fault']);assert.equal(calls,2);
});

test('serialized wall stop during readiness never starts, resumes or retries the world',async()=>{
  const r=await mockedObserver({stopBeforeReady:true});assert.equal(r.startCalls,0);assert.equal(r.pauseCalls,1);assert.equal(r.closed,true);assert.equal(r.messages.at(-1).payload.stop.reason,'wall-cap');
});
test('serialized unexpected pause stops explicitly without auto-resume',async()=>{
  const r=await mockedObserver({unexpectedPause:true});assert.equal(r.startCalls,1);assert.equal(r.pauseCalls,1);assert.equal(r.messages.at(-1).payload.stop.reason,'unexpected-pause');
});
test('serialized IPC disconnect during readiness closes rather than starting or hanging',async()=>{
  const r=await mockedObserver({disconnect:true});assert.equal(r.startCalls,0);assert.equal(r.pauseCalls,1);assert.equal(r.closed,true);assert.equal(r.messages.length,1);
});

test('synchronous child IPC send failure clears outstanding request and preserves original failure',async()=>{
  const r=await mockedObserver({ipcThrow:true});assert.equal(r.startCalls,0);assert.equal(r.closed,true);assert.equal(r.messages.at(-1).type,'terminal');assert.match(r.messages.at(-1).payload.error,/Synchronous IPC send failed/);assert(!r.messages.at(-1).payload.error.includes('outstanding'));
});
