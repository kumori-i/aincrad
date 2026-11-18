import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createPlayerJournalProgress,waitForPlayerJournalFrames} from '../scripts/player-journal-readiness-progress.mjs';
import {captureWithReadiness} from '../scripts/native-capture-readiness.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('renderer progress preserves pending settle then exactly two frame opportunities',async()=>{
 let settle,done=false;const frames=[],messages=[];const context={window:{__aquaticQa:{settleDraw:()=>new Promise(r=>settle=r)}},document:{visibilityState:'visible',readyState:'complete',hasFocus:()=>true},performance:{now:()=>4},console:{debug:m=>messages.push(JSON.parse(m.slice('PLAYER_JOURNAL_READINESS '.length)))},requestAnimationFrame:f=>frames.push(f)};
 const result=vm.runInNewContext('('+waitForPlayerJournalFrames.toString()+')("token",1)',context).then(r=>{done=true;return r;});
 assert.deepEqual(messages.map(m=>m.stage),['renderer-entry','settle-start']);assert.equal(frames.length,0);settle();await tick();assert.equal(frames.length,1);frames.shift()();assert.equal(frames.length,1);assert.equal(done,false);frames.shift()();assert.equal((await result).readyState,'complete');assert.deepEqual(messages.map(m=>m.stage),['renderer-entry','settle-start','settle-complete','raf-1','raf-2','renderer-complete']);
});
test('recorder accepts only scoped valid progress in modern and legacy console forms',()=>{
 const p=createPlayerJournalProgress('x',()=>9);p.next();const message='PLAYER_JOURNAL_READINESS '+JSON.stringify({token:'x',attempt:1,stage:'raf-1',rendererAt:2,visibilityState:'hidden',focused:false});
 assert.equal(p.console({message}),true);assert.equal(p.console({},0,message,1,'source'),true);assert.equal(p.console({message:message.replace('"x"','"other"')}),false);assert.equal(p.console({message:'ordinary error'}),false);assert.equal(p.console({message:'PLAYER_JOURNAL_READINESS null'}),false);
 const s=p.snapshot(true);s.events[0].stage='mutated';p.mark('late');p.next();assert.equal(p.console({message}),true);assert.equal(p.snapshot().events.length,3);assert.equal(p.snapshot().events[0].stage,'evaluate-start');
});
test('timeout remains terminal with no capture retry and sealed evidence survives late readiness',async()=>{
 const p=createPlayerJournalProgress('x');let ready,captures=0,retained;const op=captureWithReadiness({timeoutMs:20,prepare:async()=>{p.next();await new Promise(r=>ready=r);p.mark('evaluate-complete');},capture:()=>{captures++;},retain:async(_,m)=>{retained=JSON.stringify({m,progress:p.snapshot(true)});await tick();}});
 await assert.rejects(op,/timed out/);const before=retained;ready();await tick();assert.equal(captures,0);assert.equal(retained,before);assert.deepEqual(p.snapshot().events.map(e=>e.stage),['evaluate-start']);
});
test('small image retry bounds and total timeout remain supplied by unchanged helper',async()=>{
 const p=createPlayerJournalProgress('x');let attempts=0;const records=[];await assert.rejects(captureWithReadiness({prepare:()=>{p.next();},capture:()=>{attempts++;return{toPNG:()=>Buffer.alloc(3),getSize:()=>({width:1,height:1}),isEmpty:()=>false};},retain:async(_,m)=>records.push(p.snapshot(m.attempt===m.maxAttempts))}),/small or empty/);assert.equal(attempts,4);assert.equal(records.at(-1).sealed,true);assert.equal(records.at(-1).events.length,4);
});
test('actual journal wiring keeps guards and freezes metadata before writes without changing shared helpers',()=>{
 const s=readFileSync(new URL('../scripts/verify-player-lesson-desktop.mjs',import.meta.url),'utf8');const journal=s.slice(s.indexOf('async function captureJournal'),s.indexOf('async function openLessonJournal'));
 assert.match(journal,/waitForPlayerJournalFrames.toString/);assert.match(journal,/await delay\(100\)/);assert.equal((journal.match(/captureWithReadiness\(/g)||[]).length,1);assert.ok(journal.indexOf('const record=JSON.stringify')<journal.indexOf("await fs.writeFile(prefix+'.png'"));assert.match(journal,/attempt.status==='error'\|\|attempt.status==='ready'/);assert.doesNotMatch(journal,/timeoutMs:|maxAttempts:/);assert.match(journal,/Player word rows missing/);assert.match(journal,/png.length>10000/);
});
test('capture timeout seals before async retention and late pixels cannot become success',async()=>{
 const p=createPlayerJournalProgress('x');let captureDone,writeDone,record,captures=0;
 const op=captureWithReadiness({timeoutMs:20,prepare:()=>p.next(),capture:async()=>{captures++;p.mark('capture-start');await new Promise(r=>captureDone=r);p.mark('capture-complete');return{toPNG:()=>Buffer.alloc(11000),getSize:()=>({width:20,height:20}),isEmpty:()=>false};},retain:async(_,m)=>{record=JSON.stringify({m,progress:p.snapshot(true)});await new Promise(r=>writeDone=r);}});
 while(!writeDone)await new Promise(r=>setTimeout(r,2));const frozen=record;captureDone();await tick();assert.equal(record,frozen);assert.deepEqual(p.snapshot().events.map(e=>e.stage),['evaluate-start','capture-start']);writeDone();await assert.rejects(op,/timed out/);assert.equal(captures,1);
});

test('delayed renderer messages preserve original attempt across small-image retries',()=>{
 const p=createPlayerJournalProgress('x',()=>10);assert.equal(p.next(),1);assert.equal(p.next(),2);
 const message=attempt=>'PLAYER_JOURNAL_READINESS '+JSON.stringify({token:'x',attempt,stage:'raf-2',rendererAt:3,visibilityState:'visible',focused:true});
 assert.equal(p.console({message:message(1)}),true);assert.equal(p.console({message:message(2)}),true);assert.equal(p.console({message:message(3)}),false);assert.equal(p.console({message:message(0)}),false);assert.equal(p.console({message:message(null)}),false);
 assert.deepEqual(p.snapshot().events.map(e=>e.attempt),[1,2,1,2]);const before=p.snapshot(true);p.console({message:message(1)});assert.deepEqual(p.snapshot(),before);
});
