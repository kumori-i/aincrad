// Pure harness contracts. No policy state or simulation imports.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {MOTOR_RECALL_ORDINARY_V1 as P} from './motor-recall-ordinary-v1-protocol.mjs';
import {sha256} from './producer-retest-ci-namespace.mjs';
export const HARNESS_FILES=Object.freeze([
 ...['protocol','activation-gate','evidence','arm','analyze','analyze-files','run'].map(s=>`scripts/motor-recall-ordinary-v1-${s}.mjs`),
 'scripts/choice-diagnostic-v2-evidence.mjs','scripts/choice-diagnostic-v2-collector.mjs','scripts/choice-diagnostic-v2-protocol.mjs',
 'scripts/producer-retest-ci-namespace.mjs','scripts/producer-retest-ci-source.mjs','scripts/producer-retest-ci-protocol.mjs',
 'docs/verification/motor-recall-ordinary-v1.md','.github/workflows/motor-recall-ordinary-v1-once.yml','package.json',
]);
export const harnessManifest=root=>Object.fromEntries(HARNESS_FILES.map(f=>[f,sha256(readFileSync(resolve(root,f)))]));
export const harnessHash=root=>sha256(JSON.stringify(harnessManifest(root)));
export function childEnvironment(env){
 const allowed=['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_RUN_ATTEMPT','GITHUB_WORKFLOW','GITHUB_SHA','GITHUB_RUN_ID'];
 return Object.fromEntries(allowed.filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
}
export function validateMotorArm(args,env=process.env){
 for(const[k,v]of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:P.workflow}))assert.equal(env[k],v);
 assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
 assert.ok(args.length===6||args.length===7);const[root,harnessRoot,tag,mode,source,harness,initial]=args;
 assert.ok(root&&harnessRoot&&tag&&P.arms.includes(mode));assert.equal(basename(tag),`${mode}-${P.seed}`);
 assert.equal(source,P[mode+'Source']);assert.match(harness??'',/^[a-f0-9]{64}$/);
 if(mode==='candidate')assert.match(initial??'',/^[a-f0-9]{64}$/);else assert.equal(initial,undefined);
 return {root,harnessRoot,tag,mode,source,harness,initial};
}
export function verifyMotorJournal(arm,raw){
 assert.equal(typeof raw,'string');assert.equal(sha256(raw),arm.journalSha256);assert.ok(raw.endsWith('\n'));
 const groups={receipt:[],snapshot:[],choice:[],inquiry:[],recall:[],progress:[],terminal:[]};
 for(const line of raw.trimEnd().split('\n')){const r=JSON.parse(line);assert.deepEqual(Object.keys(r).sort(),['kind','payload']);assert.ok(Object.hasOwn(groups,r.kind));groups[r.kind].push(r.payload);}
 for(const[k,f]of Object.entries({receipt:'rows',snapshot:'snapshots',choice:'choices',inquiry:'inquiryTransitions',recall:'recallTransitions'}))assert.deepEqual(groups[k],arm[f]);
 assert.deepEqual(groups.terminal,[{completedSteps:P.steps,status:'completed'}]);assert.equal(groups.progress.length,P.seconds);
 groups.progress.forEach((p,i)=>assert.deepEqual(p,{completedSteps:(i+1)*60}));
}
