import test from 'node:test';import assert from 'node:assert/strict';
import {WATCHDOG,watchdogState,parseWatchdogOptions,guardChildSetup,armChildStop,HEADLESS_SCHEDULE,preservedCensus} from '../scripts/run-finite-headless.mjs';
test('headless watchdog keeps an unchanged arm deadline and uses monotonic time',()=>{
 let s=watchdogState(null,0,'first');s=watchdogState(s,100000,'first');assert.equal(s.deadlineAt,315000);assert.equal(s.expired,false);
 s=watchdogState(s,315000,'first');assert.equal(s.expired,true);assert.throws(()=>watchdogState(s,1,'first'),/backward/);
});
test('headless watchdog bounds startup, no-current-arm gaps and each new arm',()=>{
 let s=watchdogState(null,0);assert.equal(watchdogState(s,WATCHDOG.armOrStartupMs).expired,true);
 s=watchdogState(s,1000,'first');assert.equal(s.deadlineAt,316000);
 s=watchdogState(s,5000,null);assert.equal(s.deadlineAt,320000);assert.equal(watchdogState(s,320000,null).expired,true);
 s=watchdogState(s,7000,'second');assert.equal(s.deadlineAt,322000);
 for(const bad of [-1,NaN,Infinity])assert.throws(()=>watchdogState(null,bad));
});
test('headless supervisor accepts only fixed-evaluator preflight/output options',()=>{
 assert.ok(parseWatchdogOptions(['--preflight','gates.json','--output','new-dir']).preflight.endsWith('/gates.json'));
 for(const args of [[],['--script','arbitrary'],['--output','x'],['--preflight','a','--preflight','b','--output','x'],['--preflight','x','--output','--flag']])assert.throws(()=>parseWatchdogOptions(args));
});


test('failed post-spawn sidecar setup terminates its real owned child without an orphan',async()=>{
 const {spawn}=await import('node:child_process');
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 try{await assert.rejects(guardChildSetup(child,closed,async()=>{throw new Error('injected writer failure');}),/writer failure/);
  const result=await closed;assert.equal(result.signal,'SIGKILL');assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
 }finally{child.kill('SIGKILL');}
});


test('later status-write failure cannot disable owned-child hard-kill escalation',async()=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
 let finished=false,writesFailed=0;const closed=new Promise(resolve=>child.once('close',(code,signal)=>{finished=true;resolve({code,signal});}));
 await once(child.stdout,'data');
 const stop=armChildStop(child,()=>finished,async()=>{throw new Error('injected later write failure');},{graceMs:25,onWriteError:()=>writesFailed++});
 try{await stop.recorded;assert.equal(writesFailed,1);assert.equal((await closed).signal,'SIGKILL');assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});}
 finally{clearTimeout(stop.timer);child.kill('SIGKILL');}
});


test('hard-kill census preserves all scheduled arms and explicitly absent stop evidence',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'finite-watchdog-census-'));
 try{let result=await preservedCensus(dir);assert.equal(result.scheduled.length,3);assert.ok(result.scheduled.every(r=>r.classification==='blocked'&&!r.stopState.available));
  const id=HEADLESS_SCHEDULE[0].id;await writeFile(join(dir,'report.json'),JSON.stringify({trials:[{id,status:'running',startedAt:'2026-10-16T00:00:00Z'}]}));
  await writeFile(join(dir,`${id}.owner.jsonl`),'partial trace\n');
  result=await preservedCensus(dir);assert.equal(result.scheduled[0].classification,'censored');assert.equal(result.scheduled[0].trace.available,true);assert.equal(result.scheduled[0].stopState.available,false);assert.equal(result.scheduled[0].trace.sha256.length,64);assert.equal(result.metricsReconstructed,false);
  assert.ok(result.scheduled.slice(1).every(r=>r.classification==='blocked'));}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('supervisor census IDs exactly match the fixed evaluator schedule',async()=>{
 const {expectedTrials}=await import('../scripts/evaluate-finite-temporal.mjs');
 assert.deepEqual(HEADLESS_SCHEDULE.map(x=>x.id),expectedTrials('headless-diagnostic-v1').map(x=>x.id));
});
