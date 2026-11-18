// Harness-only evidence contracts. No simulation import or scientific execution.
import assert from 'node:assert/strict';
import {readFileSync,openSync,writeSync,closeSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {CHOICE_DIAGNOSTIC_V2 as P} from './choice-diagnostic-v2-protocol.mjs';
import {sha256} from './producer-retest-ci-namespace.mjs';
export const HARNESS_FILES=Object.freeze([
 ...['protocol','collector','analyze','evidence','activation-gate','arm','run','analyze-files'].map(s=>`scripts/choice-diagnostic-v2-${s}.mjs`),
 'scripts/producer-retest-ci-namespace.mjs','scripts/producer-retest-ci-source.mjs','scripts/producer-retest-ci-protocol.mjs',
 'docs/verification/choice-diagnostic-v2.md','.github/workflows/choice-diagnostic-v2-once.yml','package.json',
]);
export function harnessManifest(root){return Object.fromEntries(HARNESS_FILES.map(f=>[f,sha256(readFileSync(resolve(root,f)))]));}
export const harnessHash=root=>sha256(JSON.stringify(harnessManifest(root)));
export function validateChoiceArm(args,env=process.env){
 for(const[k,v]of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:P.workflow}))assert.equal(env[k],v);
 assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
 assert.ok(args.length===5||args.length===6);const[root,tag,mode,source,harness,initial]=args;
 assert.ok(root&&tag&&P.arms.includes(mode));assert.equal(basename(tag),`${mode}-${P.seed}`);
 assert.equal(source,P.runtimeSource);assert.match(harness??'',/^[a-f0-9]{64}$/);
 if(mode==='on')assert.match(initial??'',/^[a-f0-9]{64}$/);else assert.equal(initial,undefined);
 return {root,tag,mode,source,harness,initial};
}
export function createEvidenceJournal(path){
 const fd=openSync(path,'wx');let closed=false;
 return {append(kind,payload){assert.ok(!closed);const bytes=Buffer.from(JSON.stringify({kind,payload})+'\n');let pos=0;while(pos<bytes.length){const written=writeSync(fd,bytes,pos,bytes.length-pos);assert.ok(written>0);pos+=written;}},close(){if(!closed){closed=true;closeSync(fd);}}};
}
export function createReceiptCollector(actor){
 const memory=actor.memory;let last=0;const retained=new Map();
 return ()=>{
  assert.equal(actor.memory,memory);assert.ok(Number.isSafeInteger(memory.nextId)&&memory.nextId>last);
  assert.ok(Array.isArray(memory.experience));let previous=0;const fresh=[];
  for(const r of memory.experience){
   assert.ok(Number.isSafeInteger(r.id)&&r.id>previous&&r.id<memory.nextId);previous=r.id;
   if(r.id<=last){assert.equal(JSON.stringify(r),retained.get(r.id),'Receipt mutated');continue;}
   assert.equal(r.id,last+1,'Receipt coverage gap');last=r.id;fresh.push(structuredClone(r));
  }
  assert.equal(last,memory.nextId-1,'Receipt not retained');
  retained.clear();for(const r of memory.experience)retained.set(r.id,JSON.stringify(r));return fresh;
 };
}
export function verifyEvidenceJournal(arm,raw){
 assert.equal(typeof raw,'string');assert.equal(sha256(raw),arm.journalSha256);assert.ok(raw.endsWith('\n'));
 const groups={receipt:[],snapshot:[],choice:[],inquiry:[],gate:[],progress:[],terminal:[]};
 for(const line of raw.trimEnd().split('\n')){const r=JSON.parse(line);assert.deepEqual(Object.keys(r).sort(),['kind','payload']);assert.ok(Object.hasOwn(groups,r.kind));groups[r.kind].push(r.payload);}
 for(const[k,f]of Object.entries({receipt:'rows',snapshot:'snapshots',choice:'choices',inquiry:'inquiryTransitions'}))assert.deepEqual(groups[k],arm[f]);
 assert.deepEqual(groups.gate,arm.diagnostics.rows);assert.deepEqual(groups.terminal,[{completedSteps:P.steps,status:'completed'}]);
 assert.equal(groups.progress.length,P.seconds);groups.progress.forEach((p,i)=>assert.deepEqual(p,{completedSteps:(i+1)*60}));
}
