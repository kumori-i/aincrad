import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import{readFileSync}from'node:fs';import{EventEmitter}from'node:events';
import{createCaptureProgress,waitForCaptureProgress}from'../scripts/communication-capture-progress.mjs';
import{captureWithReadiness}from'../scripts/native-capture-readiness.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const image=size=>({toPNG:()=>Buffer.alloc(size),getSize:()=>({width:1280,height:800}),isEmpty:()=>false});
function renderer(settle){const frames=[],messages=[];let time=0;const run=vm.runInNewContext('('+waitForCaptureProgress.toString()+')',{window:{__aquaticQa:{settleDraw:settle}},document:{readyState:'complete',visibilityState:'hidden',hasFocus:()=>false},performance:{now:()=>++time},console:{info:s=>messages.push(JSON.parse(s.slice('AINCRAD_CAPTURE_PROGRESS '.length)))},requestAnimationFrame:fn=>frames.push(fn)});return{frames,messages,run};}
test('renderer progress separates pending settleDraw and both unchanged RAF opportunities',async()=>{
 let release;const f=renderer(()=>new Promise(r=>release=r)),pending=f.run('capture:1');await tick();assert.deepEqual(f.messages.map(r=>r.stage),['entry','settle-start']);assert.equal(f.frames.length,0);
 release();await tick();assert.equal(f.messages.at(-1).stage,'settle-complete');assert.equal(f.frames.length,1);f.frames.shift()();assert.equal(f.messages.at(-1).stage,'raf-1');assert.equal(f.frames.length,1);f.frames.shift()();const result=await pending;
 assert.equal(result.readyState,'complete');assert.equal(f.messages.at(-1).stage,'raf-2');assert.ok(f.messages.every(r=>r.focused===false&&r.visibilityState==='hidden'));assert.deepEqual(f.messages.map(r=>r.rendererAtMs),[1,2,3,4,5]);
});
test('absent settleDraw still requires two RAFs and failed telemetry does not bypass them',async()=>{
 const f=renderer(undefined),p=f.run('capture:1');await tick();assert.equal(f.frames.length,1);f.frames.shift()();assert.equal(f.frames.length,1);f.frames.shift()();await p;assert.equal(f.messages.length,5);
});
test('recorder is scoped, detached, bounded and ignores all updates after sealing',()=>{
 let time=0;const p=createCaptureProgress({token:'case',now:()=>++time}),token=p.next(),emit=(id,stage)=>p.receive('AINCRAD_CAPTURE_PROGRESS '+JSON.stringify({token:id,stage,rendererAtMs:3,focused:true,visibilityState:'visible'}));
 emit('other','entry');emit(token,'not-a-stage');emit(token,'entry');const first=p.snapshot();assert.equal(first.events.length,2);p.next();emit(token,'raf-1');assert.equal(first.events.length,2);
 const sealed=p.snapshot(true),bytes=JSON.stringify(sealed);p.mark('late');assert.equal(p.next(),null);emit('case:2','raf-2');assert.equal(JSON.stringify(p.snapshot()),bytes);assert.ok(Object.isFrozen(sealed.events[0]));assert.throws(()=>sealed.events.push({}));
 const q=createCaptureProgress({token:'bounded'});for(let i=0;i<100;i++)q.mark('event');assert.equal(q.snapshot().events.length,96);assert.equal(q.snapshot().dropped,4);
});
test('pending readiness or capture preserves deadline failure and rejects late telemetry without retry',async()=>{
 for(const stage of ['readiness','capture']){let release,captures=0,retained;const p=createCaptureProgress({token:stage});
 await assert.rejects(captureWithReadiness({timeoutMs:20,prepare:async()=>{p.next();p.mark('readiness-start');if(stage==='readiness')await new Promise(r=>release=r);p.mark('readiness-complete');return{};},capture:async()=>{captures++;p.mark('capture-start');if(stage==='capture')await new Promise(r=>release=r);p.mark('capture-complete');return image(20000);},retain:async(_png,m)=>{m.progress=p.snapshot(true);retained=JSON.stringify(m);}}),/timed out/);
 const frozen=retained;release();await tick();p.receive('AINCRAD_CAPTURE_PROGRESS '+JSON.stringify({token:stage+':1',stage:'raf-2'}));assert.equal(retained,frozen);assert.equal(captures,stage==='capture'?1:0);assert.equal(JSON.parse(retained).stage,stage);assert.ok(!p.snapshot().events.some(e=>e.stage===stage+'-complete'));
 }
});
test('four small-image attempts remain four with independent immutable attempt snapshots',async()=>{
 const p=createCaptureProgress({token:'small'}),saved=[];let captures=0;
 await assert.rejects(captureWithReadiness({prepare:async()=>{p.next();return{};},capture:async()=>{captures++;return image(10000);},retain:async(_b,m)=>saved.push({...m,progress:p.snapshot()})}),/after 4 attempts/);
 assert.equal(captures,4);assert.deepEqual(saved.map(x=>x.attempt),[1,2,3,4]);assert.deepEqual(saved.map(x=>x.progress.events.length),[1,2,3,4]);assert.ok(saved.every(x=>x.timeoutMs===5000&&x.maxAttempts===4));
});
test('actual communication capture wiring snapshots renderer progress before async failure retention',async()=>{
 const source=readFileSync(new URL('../scripts/verify-communication-desktop.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('  let captureSequence=0;'),source.indexOf('  const raw = win =>'));
 for(const modern of [false,true]){const wc=new EventEmitter(),writes=[],screenshots=[];let resolveReady,captures=0;
 wc.capturePage=()=>{captures++;return image(20000);};const win={webContents:wc,isFocused:()=>false,isVisible:()=>true};
 const evaluate=()=>new Promise(r=>{resolveReady=r;const message='AINCRAD_CAPTURE_PROGRESS '+JSON.stringify({token:'exercise:1:1',stage:'settle-start',rendererAtMs:11,visibilityState:'visible',focused:false});if(modern)wc.emit('console-message',{message});else wc.emit('console-message',{},1,message);});
 const capture=vm.runInNewContext(body+';capture',{phase:'exercise',createCaptureProgress,waitForCaptureProgress,conversationViewportEvidence:()=>{},captureWithReadiness:options=>{assert.equal(options.timeoutMs,undefined);assert.equal(options.maxAttempts,undefined);return captureWithReadiness({...options,timeoutMs:20});},evaluate,delay:async()=>{},context:{output:'/evidence'},path:{join:(...parts)=>parts.join('/')},fs:{writeFile:async(path,bytes)=>{writes.push({path,bytes});resolveReady({});await tick();}},assert,screenshots});
 await assert.rejects(capture(win,'test.png'),/timed out/);assert.equal(captures,0);assert.equal(wc.listenerCount('console-message'),0);assert.equal(writes.length,1);const m=JSON.parse(writes[0].bytes);assert.equal(m.stage,'readiness');assert.equal(m.progress.events.at(-1).stage,'retain:error');assert.ok(m.progress.events.some(e=>e.stage==='renderer:settle-start'));assert.ok(!m.progress.events.some(e=>e.stage==='readiness-execute-complete'));assert.equal(screenshots.length,0);
 }
});
