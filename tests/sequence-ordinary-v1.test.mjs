// Synthetic protocol/collector/process controls. No ordinary runtime execution.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {SEQUENCE_ORDINARY_V1 as P} from '../scripts/sequence-ordinary-v1-protocol.mjs';
import {frozenSeed,validateSequenceArm,childEnvironment,harnessHash,HARNESS_FILES,verifySequenceJournal} from '../scripts/sequence-ordinary-v1-evidence.mjs';
import {createSequenceScopeCollector,createSequenceStatusInterner} from '../scripts/sequence-ordinary-v1-collector.mjs';
import {executeSequenceArms} from '../scripts/sequence-ordinary-v1-run.mjs';
import {verifySequenceRunHistory} from '../scripts/sequence-ordinary-v1-activation-gate.mjs';
import {analyzeSequencePair} from '../scripts/sequence-ordinary-v1-analyze.mjs';
import {sha256,comparableHash,NORMALIZED_PATHS} from '../scripts/producer-retest-ci-namespace.mjs';
const synthetic={...P,seeds:[900000001,900000002],seedFreeze:{approved:true,inventorySha256:'a'.repeat(64)},seconds:2,steps:120};
const env=()=>({PATH:process.env.PATH,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:P.workflow,GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_TOKEN:'secret',NODE_OPTIONS:'secret',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraheader',GIT_CONFIG_VALUE_0:'secret'});
const temp=fn=>{const dir=mkdtempSync(join(tmpdir(),'sequence-contract-'));try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}};
const uuid='00000000-0000-4000-8000-000000000001';
const body=()=>Object.fromEntries(['hunger','thirst','thermal','energy','stamina','fatigue','sleepiness','pain','wetness','overall','activity','digestion','sleep','relief'].map(k=>[k,'fixture']));
function world(){return {elapsed:0,worldLineage:{instanceId:uuid,agents:[{agentId:'a',serial:1}]},agents:[{id:'a',epoch:0,elapsed:0,lifecycle:'AWAKE',memory:{},discovery:{},physiology:{}}]};}
test('prospective two-pair freeze stays literal and invalid preflight refuses before start',()=>{
 assert.deepEqual(P.seeds,[2585496148,540480811]);assert.equal(P.seedFreeze.approved,true);assert.equal(P.seconds,3600);assert.equal(P.steps,216000);assert.equal(P.armTimeoutMs,3600000);assert.equal(P.pairTimeoutMinutes,135);
 assert.equal(P.baselineCommit,'83b03dbb527c93b39e07263a46b37ad29141cf5b');assert.equal(P.candidateSource,'ccad62ce1debd637911b2130423d8132d096417080d7a2a4c33c85deb8876ac4');assert.throws(()=>frozenSeed(0,{...P,seedFreeze:null}));
 temp(dir=>{const tag=join(dir,`baseline-${P.seeds[0]}`),r=spawnSync(process.execPath,['scripts/sequence-ordinary-v1-arm.mjs','.', '.',tag,'baseline','0','f'.repeat(64),harnessHash('.')],{env:childEnvironment(env()),encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/AssertionError/);assert.equal(existsSync(tag+'.started.json'),false);});
});
test('synthetic seed/config inputs require canonical range and exact pair/argument scope',()=>{
 assert.equal(frozenSeed(1,synthetic),900000002);for(const seeds of [[1,1],[0,1],[1,4294967295],[1,-2],[1,2.5]])assert.throws(()=>frozenSeed(0,{...synthetic,seeds}));
 const args=['/b','/c','/o/baseline-900000001','baseline','0',P.baselineSource,'b'.repeat(64)];assert.equal(validateSequenceArm(args,env(),synthetic).seed,900000001);
 for(const k of ['GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_RUN_ATTEMPT','GITHUB_WORKFLOW','GITHUB_SHA','GITHUB_RUN_ID'])assert.throws(()=>validateSequenceArm(args,{...env(),[k]:'wrong'},synthetic));
 for(const k of ['GITHUB_TOKEN','NODE_OPTIONS','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0'])assert.equal(childEnvironment(env())[k],undefined);
});
test('scope collector records collapse/recovery epochs without treating them as continuity',()=>{
 const w=world(),c=createSequenceScopeCollector(w,{steps:3,fixedStep:1,describe:body});
 w.elapsed=w.agents[0].elapsed=1;assert.deepEqual(c.capture(w,1),[]);
 w.elapsed=w.agents[0].elapsed=2;w.agents[0].epoch=1;w.agents[0].lifecycle='COLLAPSED';const [r]=c.capture(w,2);assert.equal(r.priorEpoch,0);assert.equal(r.priorLifecycle,'AWAKE');assert.equal(r.lifecycle,'COLLAPSED');
 w.elapsed=w.agents[0].elapsed=3;w.agents[0].epoch=2;w.agents[0].lifecycle='AWAKE';c.capture(w,3);assert.equal(c.finish().epochTransitions.length,2);assert.throws(()=>c.capture(w,4));
});
test('scope collector rejects repeat ticks, invalid epochs and identity replacement without restart',()=>{
 for(const mutate of [w=>w.agents[0].epoch=-1,w=>w.agents[0].epoch=.5,w=>w.agents[0]={...w.agents[0]},w=>w.agents[0].memory={},w=>w.worldLineage.agents[0].serial=2]){const w=world(),c=createSequenceScopeCollector(w,{steps:2,fixedStep:1,describe:body});w.elapsed=w.agents[0].elapsed=1;mutate(w);assert.throws(()=>c.capture(w,1));assert.throws(()=>c.finish());}
 const w=world(),c=createSequenceScopeCollector(w,{steps:2,fixedStep:1,describe:body});w.elapsed=w.agents[0].elapsed=1;c.capture(w,1);assert.throws(()=>c.capture(w,1));
});
test('coordinator keeps fixed CPU/order/token stripping and never starts candidate after failed baseline',()=>temp(dir=>{
 const calls=[],run=(cmd,args,options)=>{calls.push({cmd,args,options});writeFileSync(args[6]+'.json',JSON.stringify({mode:args[7],status:'completed',initialComparableSha256:'c'.repeat(64)}),{flag:'wx'});return {code:0,stdout:'ok',stderr:''};};
 executeSequenceArms({root:'/candidate',baseline:'/baseline',out:dir,cpu:2,harness:'b'.repeat(64),env:env(),pair:0,protocol:synthetic,run});assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.args[7]),['baseline','candidate']);for(const c of calls){assert.deepEqual(c.args.slice(0,2),['-c','2']);assert.equal(c.options.timeout,3600000);assert.equal(c.options.env.GITHUB_TOKEN,undefined);}
}));
test('failed baseline preserves log and cannot be retried by coordinator',()=>temp(dir=>{let calls=0;const run=()=>{calls++;return {code:null,error:'timeout',stdout:'partial',stderr:''};};assert.throws(()=>executeSequenceArms({root:'/c',baseline:'/b',out:dir,cpu:1,harness:'a'.repeat(64),env:env(),pair:1,protocol:synthetic,run}));assert.equal(calls,1);assert.equal(readFileSync(join(dir,'baseline-900000002.log'),'utf8'),'partial');}));
test('history guard accepts only current whole-workflow run and rejects deleted-branch prior run',async()=>{
 const fetchImpl=async()=>({ok:true,json:async()=>({total_count:1,workflow_runs:[{id:123,event:'create',head_branch:P.activationRef}]})});await verifySequenceRunHistory({env:env(),fetchImpl,sleep:async()=>{}});
 await assert.rejects(verifySequenceRunHistory({env:env(),fetchImpl:async()=>({ok:true,json:async()=>({total_count:2,workflow_runs:[{id:122,event:'create',head_branch:P.activationRef},{id:123,event:'create',head_branch:P.activationRef}]})}),sleep:async()=>{}}));
});
function arm(mode){
 const physical={position:{x:0,y:0},lifecycle:'AWAKE',epoch:0,rng:1,stats:{},physiology:{availableEnergyKcal:1,storedEnergyKcal:1,waterDeficitMl:0,health:100,condition:100,stamina:100,fatigue:0,sleepPressure:0,totals:{ingestedKcal:0},outsideAssistance:{}}};
 const initial={elapsed:0,worldLineage:{instanceId:uuid,agents:[{agentId:'a',serial:1}]},agents:[{id:'a',elapsed:0,memory:{nextId:1,experience:[]},...structuredClone(physical)}],visualReference:{worldId:uuid},characterMessages:{worldId:uuid},playerLessons:{worldId:uuid}},saved=structuredClone(initial);saved.elapsed=2;saved.agents[0].elapsed=2;
 const initialRaw=JSON.stringify(initial),saveRaw=JSON.stringify(saved),scope={worldId:uuid,actors:[{actorId:'a',incarnation:1}]};
 return {protocol:P.id,mode,pair:0,seed:synthetic.seeds[0],seconds:2,completedSteps:120,status:'completed',failure:null,source:P[mode+'Source'],sourceAfter:P[mode+'Source'],harnessSha256:'b'.repeat(64),normalizationPaths:NORMALIZED_PATHS,initialRaw,saveRaw,initialSha256:sha256(initialRaw),saveSha256:sha256(saveRaw),initialComparableSha256:comparableHash(initial),saveComparableSha256:comparableHash(saved),saveValid:true,coverage:{coverage:'complete',steps:120,scope,epochTransitions:[]},rows:[],snapshots:[0,1,2,2].map(at=>({actor:'a',at,...structuredClone(physical),body:body(),run:null,runSourceId:null,cycle:null,active:null})),agents:saved.agents,choices:[],inquiryTransitions:[],epochTransitions:[],sequenceStatuses:mode==='candidate'?[{hash:sha256('null'),status:null}]:[],sequenceReadCounts:{a:mode==='candidate'?122:0},sequenceTransitions:mode==='candidate'?[0,120].map(tick=>({actor:'a',worldId:uuid,incarnation:1,epoch:0,tick,at:tick/60,receiptSerial:0,statusHash:sha256('null'),body:body(),activeRequest:null,activeStartedAt:null,activePaidSeconds:null})):[],activeOccupancySeconds:{a:{idle:2}}};
}
test('complete zero-learning pair is valid; malformed equal envelopes and omitted observations are not',()=>{
 assert.equal(analyzeSequencePair(arm('baseline'),arm('candidate'),synthetic).observedQuestions.length,0);
 for(const mutate of [a=>a.rows=null,a=>a.snapshots[1].epoch=1,a=>a.rows.push({actor:'a',id:1,at:1,type:'action',details:{action:null,result:{ok:true}}}),a=>a.rows.push({actor:'a',id:1,at:1,type:'action',details:{action:{type:'pull',targetId:'invalid'},result:{ok:true}}}),a=>a.snapshots[0]={actor:'a'},a=>a.sequenceTransitions=[],a=>a.sequenceReadCounts.a--,a=>a.sequenceTransitions[0].tick=1,a=>a.activeOccupancySeconds.a={},a=>a.agents[0]={id:'a'},a=>a.epochTransitions.push({actor:'a',epoch:1})]){const b=arm('baseline'),c=arm('candidate');mutate(c);assert.throws(()=>analyzeSequencePair(b,c,synthetic));}
});
test('workflow is two credential-free read-only roots, two independent once-only jobs and no reload',()=>{
 const w=readFileSync('.github/workflows/sequence-ordinary-v1-once.yml','utf8');assert.equal((w.match(/persist-credentials: false/g)||[]).length,2);for(const pattern of [/pair: \[0, 1\]/,/fail-fast: false/,/github.run_attempt == 1/,/timeout-minutes: 135/,/if: always\(\)/,/contents: read/,/actions: read/])assert.match(w,pattern);assert.doesNotMatch(w,/workflow_dispatch|contents: write/);assert.doesNotMatch(readFileSync('scripts/sequence-ordinary-v1-arm.mjs','utf8'),/loadOzarkSave|discoveryFoodLearning:false|handlingCuriosity:false/);assert.equal(new Set(HARNESS_FILES).size,HARNESS_FILES.length);
});

test('status interning preserves exact bytes without repeated episode payloads',()=>{
 const intern=createSequenceStatusInterner(),input={episodes:[{sourceId:'object:1',uncertain:true}],question:null};const first=intern(input);assert.deepEqual(first.entry.status,input);assert.equal(first.hash,sha256(JSON.stringify(input)));assert.equal(intern(structuredClone(input)).entry,null);input.episodes[0].uncertain=false;assert.equal(first.entry.status.episodes[0].uncertain,true);assert.notEqual(intern(input).hash,first.hash);
});

test('raw journal binds interned statuses, frames and complete ordered progress',()=>{
 const a=arm('candidate'),lines=[];for(const[k,f]of Object.entries({receipt:'rows',snapshot:'snapshots',choice:'choices',inquiry:'inquiryTransitions',sequence:'sequenceTransitions','sequence-status':'sequenceStatuses',epoch:'epochTransitions'}))for(const row of a[f])lines.push({kind:k,payload:row});for(let i=1;i<=2;i++)lines.push({kind:'progress',payload:{completedSteps:i*60}});lines.push({kind:'terminal',payload:{completedSteps:120,status:'completed'}});
 const raw=lines.map(x=>JSON.stringify(x)).join('\n')+'\n';a.journalSha256=sha256(raw);assert.doesNotThrow(()=>verifySequenceJournal(a,raw,synthetic));assert.throws(()=>verifySequenceJournal({...a,sequenceStatuses:[]},raw,synthetic));const broken=raw.replace('sequence-status','unknown');assert.throws(()=>verifySequenceJournal({...a,journalSha256:sha256(broken)},broken,synthetic));
});
test('missing, malformed, unused or hash-mismatched status blobs cannot masquerade as zero observations',()=>{
 for(const mutate of [a=>a.sequenceStatuses=[],a=>a.sequenceStatuses.push({hash:sha256('{}'),status:{}}),a=>a.sequenceStatuses[0].status={},a=>a.sequenceTransitions[0].statusHash='b'.repeat(64),a=>a.sequenceTransitions.splice(1,0,structuredClone(a.sequenceTransitions[0]))]){const b=arm('baseline'),c=arm('candidate');mutate(c);assert.throws(()=>analyzeSequencePair(b,c,synthetic));}
});

test('cached status revisits cannot bypass admission monotonicity or active-work envelope',()=>{
 const b=arm('baseline'),c=arm('candidate'),statuses=[1,2].map(admissions=>({admissions,methods:0,episodes:[],question:null}));
 c.sequenceStatuses=statuses.map(status=>({hash:sha256(JSON.stringify(status)),status}));
 const original=c.sequenceTransitions[0];c.sequenceTransitions=[0,60,120].map((tick,i)=>({...original,tick,at:tick/60,statusHash:c.sequenceStatuses[i===1?1:0].hash}));
 assert.throws(()=>analyzeSequencePair(b,c,synthetic));
 for(const mutate of [r=>r.activeStartedAt=0,r=>r.activePaidSeconds=0,r=>{r.activeRequest={type:'pull'};r.activeStartedAt=3;},r=>{r.activeRequest={type:'pull'};r.activeStartedAt=0;r.activePaidSeconds=-1;},r=>{r.activeRequest={type:'pull'};r.activeStartedAt=0;r.activePaidSeconds=3;}]){const invalid=arm('candidate');mutate(invalid.sequenceTransitions.at(-1));assert.throws(()=>analyzeSequencePair(b,invalid,synthetic));}
});

test('terminal save epoch, stats and retained receipt serial bind independently to full rows',()=>{
 const b=arm('baseline'),c=arm('candidate'),receipt={id:1,at:1,type:'decision',details:{summary:'fixture'}};
 c.rows=[{actor:'a',...receipt}];c.agents[0].memory={nextId:2,experience:[structuredClone(receipt)]};c.sequenceTransitions.at(-1).receiptSerial=1;
 const saved=JSON.parse(c.saveRaw);saved.agents[0].memory=structuredClone(c.agents[0].memory);
 function save(a,obj){a.saveRaw=JSON.stringify(obj);a.saveSha256=sha256(a.saveRaw);a.saveComparableSha256=comparableHash(obj);}
 save(c,saved);assert.doesNotThrow(()=>analyzeSequencePair(b,c,synthetic));
 for(const mutate of [a=>{const raw=JSON.parse(a.saveRaw);raw.agents[0].epoch=1;save(a,raw);},a=>{const raw=JSON.parse(a.saveRaw);raw.agents[0].stats={new:1};save(a,raw);},a=>{a.rows=[];a.sequenceTransitions.at(-1).receiptSerial=0;},a=>{a.agents[0].memory.experience[0].details.summary='changed';},a=>{const raw=JSON.parse(a.saveRaw);raw.agents[0].memory.nextId=1;save(a,raw);},a=>{delete a.agents[0].memory;}]){const invalid=structuredClone(c);mutate(invalid);assert.throws(()=>analyzeSequencePair(b,invalid,synthetic));}
});
