import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {SEQUENCE_ORDINARY_V1 as P} from './sequence-ordinary-v1-protocol.mjs';
import {sha256} from './producer-retest-ci-namespace.mjs';
export const HARNESS_FILES=Object.freeze([
 ...['protocol','activation-gate','collector','evidence','arm','analyze','analyze-files','run'].map(s=>`scripts/sequence-ordinary-v1-${s}.mjs`),
 'scripts/choice-diagnostic-v2-evidence.mjs','scripts/choice-diagnostic-v2-collector.mjs','scripts/choice-diagnostic-v2-protocol.mjs',
 'scripts/producer-retest-ci-source.mjs','scripts/producer-retest-ci-namespace.mjs','scripts/producer-retest-ci-protocol.mjs',
 'docs/verification/sequence-ordinary-v1.md','.github/workflows/sequence-ordinary-v1-once.yml','package.json',
]);
export const harnessManifest=root=>Object.fromEntries(HARNESS_FILES.map(f=>[f,sha256(readFileSync(resolve(root,f)))]));
export const harnessHash=root=>sha256(JSON.stringify(harnessManifest(root)));
export function frozenSeed(pair,protocol=P){
 assert.ok(protocol.seedFreeze&&typeof protocol.seedFreeze==='object','Seeds not frozen; execution forbidden');
 assert.match(protocol.seedFreeze.inventorySha256??'',/^[a-f0-9]{64}$/);assert.equal(protocol.seedFreeze.approved,true);
 assert.ok([0,1].includes(pair)&&Array.isArray(protocol.seeds)&&protocol.seeds.length===2&&new Set(protocol.seeds).size===2);
 for(const n of protocol.seeds)assert.ok(Number.isSafeInteger(n)&&n>0&&n<2**32-1);return protocol.seeds[pair];
}
export function childEnvironment(env){return Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_RUN_ATTEMPT','GITHUB_WORKFLOW','GITHUB_SHA','GITHUB_RUN_ID'].filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));}
export function validateSequenceArm(args,env=process.env,protocol=P){
 for(const[k,v]of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+protocol.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:protocol.workflow}))assert.equal(env[k],v);
 assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
 assert.ok(args.length===7||args.length===8);const[root,harnessRoot,tag,mode,pairText,source,harness,initial]=args;
 assert.match(pairText,/^[01]$/);const pair=Number(pairText),seed=frozenSeed(pair,protocol);
 assert.ok(root&&harnessRoot&&protocol.arms.includes(mode));assert.equal(basename(tag),`${mode}-${seed}`);assert.equal(source,protocol[mode+'Source']);assert.match(harness??'',/^[a-f0-9]{64}$/);
 if(mode==='candidate')assert.match(initial??'',/^[a-f0-9]{64}$/);else assert.equal(initial,undefined);
 return {root,harnessRoot,tag,mode,pair,seed,source,harness,initial};
}
export function verifySequenceJournal(arm,raw,protocol=P){
 assert.equal(typeof raw,'string');assert.equal(sha256(raw),arm.journalSha256);assert.ok(raw.endsWith('\n'));
 const groups=Object.fromEntries(['receipt','snapshot','choice','inquiry','sequence','sequence-status','epoch','progress','terminal'].map(k=>[k,[]]));
 for(const line of raw.trimEnd().split('\n')){const r=JSON.parse(line);assert.deepEqual(Object.keys(r).sort(),['kind','payload']);assert.ok(Object.hasOwn(groups,r.kind));groups[r.kind].push(r.payload);}
 for(const[k,f]of Object.entries({receipt:'rows',snapshot:'snapshots',choice:'choices',inquiry:'inquiryTransitions',sequence:'sequenceTransitions','sequence-status':'sequenceStatuses',epoch:'epochTransitions'}))assert.deepEqual(groups[k],arm[f]);
 assert.deepEqual(groups.terminal,[{completedSteps:protocol.steps,status:'completed'}]);assert.equal(groups.progress.length,protocol.seconds);groups.progress.forEach((r,i)=>assert.deepEqual(r,{completedSteps:(i+1)*60}));
}
