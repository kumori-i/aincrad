// Synthetic files/process stubs only. Never imports or ticks a simulation.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {spawnSync} from 'node:child_process';
import {CHOICE_DIAGNOSTIC_V2 as P} from '../scripts/choice-diagnostic-v2-protocol.mjs';
import {createReceiptCollector,createEvidenceJournal,verifyEvidenceJournal,validateChoiceArm,harnessHash,harnessManifest} from '../scripts/choice-diagnostic-v2-evidence.mjs';
import {executeChoiceArms,runChild} from '../scripts/choice-diagnostic-v2-run.mjs';
import {sourceFingerprint} from '../scripts/producer-retest-ci-source.mjs';
import {sha256,comparableHash,NORMALIZED_PATHS} from '../scripts/producer-retest-ci-namespace.mjs';
import {analyzeChoiceFiles} from '../scripts/choice-diagnostic-v2-analyze-files.mjs';
const temp=fn=>{const dir=realpathSync(mkdtempSync(join(tmpdir(),'choice-v2-test-')));try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}};
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:P.workflow,GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_TOKEN:'never-in-child'});
test('exact source/hash preflight and arm context reject before any simulation import',()=>{
 assert.equal(P.runtimeSource,'a4f39099b935133fd959541f9896aa3f34cdd7840b9d876f6d3ea9f94dd86412');
 // Frozen arm refuses the changed runtime before its started marker or dynamic runtime imports.
 assert.notEqual(sourceFingerprint(resolve('.')),P.runtimeSource);
 temp(dir=>{const tag=join(dir,'off-78217'),r=spawnSync(process.execPath,['scripts/choice-diagnostic-v2-arm.mjs',resolve('.'),tag,'off',P.runtimeSource,harnessHash('.')],{env:{...process.env,...env()},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/AssertionError/);assert.match(r.stderr,/choice-diagnostic-v2-arm.mjs:12/);assert.equal(existsSync(tag+'.started.json'),false);});assert.equal(harnessHash('.'),sha256(JSON.stringify(harnessManifest('.'))));assert.equal(P.seed,78217);assert.equal(P.steps,72000);
 const args=['/source','/out/off-78217','off',P.runtimeSource,'b'.repeat(64)];assert.equal(validateChoiceArm(args,env()).mode,'off');
 assert.equal(validateChoiceArm(['/source','/out/on-78217','on',P.runtimeSource,'b'.repeat(64),'c'.repeat(64)],env()).mode,'on');
 for(const key of Object.keys(env()).filter(k=>k!=='GITHUB_TOKEN'))assert.throws(()=>validateChoiceArm(args,{...env(),[key]:'wrong'}));
 assert.throws(()=>validateChoiceArm([...args,'c'.repeat(64)],env()));
 const r=spawnSync(process.execPath,['scripts/choice-diagnostic-v2-arm.mjs',...args],{env:{GITHUB_ACTIONS:'false'},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/AssertionError/);
});
test('receipt collector detects lost prefix, within-tick loss, rollback and changed retained bytes',()=>{
 const actor={memory:{nextId:1,experience:[]}},capture=createReceiptCollector(actor);assert.deepEqual(capture(),[]);
 actor.memory.experience=[{id:1,type:'action'}];actor.memory.nextId=2;assert.deepEqual(capture(),[{id:1,type:'action'}]);
 actor.memory.experience.push({id:2,type:'condition'});actor.memory.nextId=3;assert.equal(capture().length,1);
 actor.memory.experience=[{id:2,type:'condition'}];assert.deepEqual(capture(),[],'old eviction is not a new gap');
 actor.memory.experience[0].type='other';assert.throws(capture,/mutated/);
 for(const memory of [{nextId:3,experience:[{id:2}]},{nextId:2,experience:[]},{nextId:3,experience:[{id:1},{id:1}]}])assert.throws(createReceiptCollector({memory}));
});
test('coordinator runs same source sequentially once with fixed CPU and stripped token',()=>temp(dir=>{
 const calls=[];const run=(command,args,options)=>{
  calls.push({command,args,options});const tag=args[5],mode=args[6];
  writeFileSync(tag+'.json',JSON.stringify({mode,status:'completed',initialComparableSha256:'c'.repeat(64)}),{flag:'wx'});
  return {code:0,stdout:'ok',stderr:''};
 };
 const childEnv=executeChoiceArms({root:resolve('.'),out:dir,cpu:3,harness:'b'.repeat(64),env:env(),run});
 assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.args[6]),['off','on']);
 for(const c of calls){assert.equal(c.command,'taskset');assert.deepEqual(c.args.slice(0,2),['-c','3']);assert.equal(c.options.env.GITHUB_TOKEN,undefined);assert.equal(c.options.timeout,24*60*1000);assert.equal(c.args[7],P.runtimeSource);}
 assert.equal(calls[1].args.at(-1),'c'.repeat(64));assert.equal(childEnv.GITHUB_TOKEN,undefined);
 assert.throws(()=>executeChoiceArms({root:'.',out:dir,cpu:3,harness:'b'.repeat(64),env:env(),run}),'exclusive files prevent repeating');
}));
test('failed first arm retains log and never launches on',()=>temp(dir=>{
 let calls=0;assert.throws(()=>executeChoiceArms({root:'.',out:dir,cpu:1,harness:'b'.repeat(64),env:env(),run:()=>{calls++;return {code:null,signal:'SIGTERM',error:'timeout',stdout:'partial',stderr:''};}}));
 assert.equal(calls,1);assert.equal(readFileSync(join(dir,'off-78217.log'),'utf8'),'partial');assert.equal(existsSync(join(dir,'on-78217.log')),false);
 const child=runChild(process.execPath,['-e','process.exit(7)'],{timeout:1000});assert.equal(child.code,7);
}));
const uuid='00000000-0000-4000-8000-000000000001';
function fixture(dir,mode){
 const world={worldLineage:{instanceId:uuid,agents:[{agentId:'a',serial:1}]},agents:[{id:'a'}],visualReference:{worldId:uuid},characterMessages:{worldId:uuid},playerLessons:{worldId:uuid}},raw=JSON.stringify(world),tag=join(dir,`${mode}-78217`);
 const arm={protocol:P.id,mode,seed:P.seed,seconds:P.seconds,completedSteps:P.steps,status:'completed',failure:null,source:P.runtimeSource,sourceAfter:P.runtimeSource,harnessSha256:harnessHash('.'),normalizationPaths:NORMALIZED_PATHS,initialSha256:sha256(raw),initialComparableSha256:comparableHash(world),saveSha256:sha256(raw),saveComparableSha256:comparableHash(world),saveValid:true,diagnostics:{enabled:mode==='on',steps:P.steps,coverage:'complete',rows:[]},rows:[],snapshots:[{actor:'a'}],agents:[{id:'a'}],choices:[],inquiryTransitions:[],activeOccupancySeconds:{a:{idle:1200}}};
 const journal=createEvidenceJournal(tag+'.events.jsonl');journal.append('snapshot',arm.snapshots[0]);for(let i=1;i<=P.seconds;i++)journal.append('progress',{completedSteps:i*60});journal.append('terminal',{completedSteps:P.steps,status:'completed'});journal.close();assert.throws(()=>journal.append('x',{}));
 arm.journalSha256=sha256(readFileSync(tag+'.events.jsonl'));writeFileSync(tag+'.json',JSON.stringify(arm));writeFileSync(tag+'.initial.json',raw);writeFileSync(tag+'.save.json',raw);return {tag,arm};
}
test('raw artifact analyzer binds JSONL, parity and exclusive output without simulation',()=>temp(dir=>{
 const off=fixture(dir,'off'),on=fixture(dir,'on'),manifest=join(dir,'manifest.json'),output=join(dir,'analysis.json');
 writeFileSync(manifest,JSON.stringify({protocol:P,source:P.runtimeSource,evaluationFiles:harnessManifest('.'),harnessSha256:harnessHash('.')}));
 assert.equal(analyzeChoiceFiles(off.tag,on.tag,manifest,output).status,'observer-parity-passed');assert.throws(()=>analyzeChoiceFiles(off.tag,on.tag,manifest,output));
 const raw=readFileSync(on.tag+'.events.jsonl','utf8');verifyEvidenceJournal(on.arm,raw);
 for(const bad of [raw.slice(0,-1),raw.replace('snapshot','choice'),raw.replace('72000','71999')])assert.throws(()=>verifyEvidenceJournal(on.arm,bad));
 const altered=raw.replace('snapshot','choice');assert.throws(()=>verifyEvidenceJournal({...on.arm,journalSha256:sha256(altered)},altered),'matching hash does not hide content mismatch');
 writeFileSync(on.tag+'.save.json','tampered');assert.throws(()=>analyzeChoiceFiles(off.tag,on.tag,manifest,join(dir,'new.json')));
}));
test('workflow remains dedicated one-shot/read-only and preserves original frozen files',()=>{
 const w=readFileSync('.github/workflows/choice-diagnostic-v2-once.yml','utf8'),arm=readFileSync('scripts/choice-diagnostic-v2-arm.mjs','utf8'),run=readFileSync('scripts/choice-diagnostic-v2-run.mjs','utf8');
 for(const pattern of [/on: create/,/github.run_attempt == 1/,/cancel-in-progress: false/,/contents: read/,/actions: read/,/if: always\(\)/,/choice-diagnostic-v2-once/])assert.match(w,pattern);
 assert.doesNotMatch(w,/workflow_dispatch|contents: write|actions: write/);assert.doesNotMatch(arm,/loadOzarkSave|74201|75211|77201/);
 assert.ok(run.indexOf('await verifyChoiceDiagnosticRunHistory()')<run.indexOf("phase='prepare'"));assert.match(run,/delete childEnv.GITHUB_TOKEN/);assert.match(run,/artifact-hashes.json/);
});
