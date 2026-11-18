// Synthetic records/files/process stubs only; no simulator imports or ticks.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {spawnSync} from 'node:child_process';
import {MOTOR_RECALL_ORDINARY_V1 as P} from '../scripts/motor-recall-ordinary-v1-protocol.mjs';
import {validateMotorArm,harnessHash,harnessManifest,childEnvironment,verifyMotorJournal} from '../scripts/motor-recall-ordinary-v1-evidence.mjs';
import {analyzeMotorPair,exposureMotifs,foodContext} from '../scripts/motor-recall-ordinary-v1-analyze.mjs';
import {analyzeMotorFiles} from '../scripts/motor-recall-ordinary-v1-analyze-files.mjs';
import {executeMotorArms,verifyCheckout} from '../scripts/motor-recall-ordinary-v1-run.mjs';
import {createEvidenceJournal} from '../scripts/choice-diagnostic-v2-evidence.mjs';
import {sourceFingerprint} from '../scripts/producer-retest-ci-source.mjs';
import {sha256,comparableHash,NORMALIZED_PATHS} from '../scripts/producer-retest-ci-namespace.mjs';
const temp=fn=>{const dir=realpathSync(mkdtempSync(join(tmpdir(),'motor-pilot-')));try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}};
const env=()=>({PATH:process.env.PATH,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:P.workflow,GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_TOKEN:'never-in-child',GH_TOKEN:'also-secret',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraheader',GIT_CONFIG_VALUE_0:'secret',ACTIONS_RUNTIME_TOKEN:'secret',NODE_OPTIONS:'--bad-preload'});
const uuid='00000000-0000-4000-8000-000000000001';
const narrative='Grasping did not acquire this source. My own earlier pull detached a piece here. I can try that operation once more; the result is uncertain.';
function fixture(mode,{food=false}={}){
 const physical={position:{x:0,y:0},lifecycle:'AWAKE',rng:1,stats:{},physiology:{availableEnergyKcal:1,storedEnergyKcal:1,waterDeficitMl:0,health:100,condition:100,stamina:100,fatigue:0,sleepPressure:0,totals:{ingestedKcal:0},outsideAssistance:{}}};
 const world={elapsed:0,environment:{ecology:{plants:[{id:'object:1'}],animals:[]}},worldLineage:{instanceId:uuid,agents:[{agentId:'a',serial:1}]},agents:[{id:'a',...physical,elapsed:0,discovery:{effects:[],experiments:[]}}],visualReference:{worldId:uuid},characterMessages:{worldId:uuid},playerLessons:{worldId:uuid}},raw=JSON.stringify(world),saved=structuredClone(world);saved.elapsed=1200;saved.agents[0].elapsed=1200;const saveRaw=JSON.stringify(saved);
 const action=(at,type,targetId,result)=>({actor:'a',at,type:'action',details:{action:{type,targetId},result:{durationSeconds:1,handling:{source:'experienced',activeActionSeconds:1},...result}}});
 const rows=[action(1,'pull','object:1',{ok:true,code:'piece_detached',materialId:'object:2'})];
 if(food)rows.push(action(2,'sample','object:2',{ok:true,code:'SWALLOWED',ingestionId:'ingestion:1'}));
 rows.push(action(3,'grasp','object:1',{ok:false,code:'object_still_attached'}));
 if(mode==='candidate')rows.push({actor:'a',at:4,type:'decision',details:{summary:narrative}},action(6,'pull','object:1',{ok:true,code:'piece_detached',materialId:'object:3',riskCost:0}));
 rows.forEach((r,i)=>r.id=i+1);
 const transition=(at,phase)=>({actor:'a',worldId:uuid,incarnation:1,at,tick:at*60,status:{admissions:1,methods:1,questions:[{sourceId:'object:1',priorAt:1,at:3,deadline:303,phase}]}});
 return {protocol:P.id,mode,seed:P.seed,seconds:P.seconds,completedSteps:P.steps,status:'completed',failure:null,source:P[mode+'Source'],sourceAfter:P[mode+'Source'],harnessSha256:harnessHash('.'),normalizationPaths:NORMALIZED_PATHS,initialRaw:raw,saveRaw,initialSha256:sha256(raw),initialComparableSha256:comparableHash(world),saveSha256:sha256(saveRaw),saveComparableSha256:comparableHash(saved),saveValid:true,coverage:{enabled:false,steps:P.steps,coverage:'complete',rows:[]},rows,snapshots:Array.from({length:1202},(_,i)=>({actor:'a',at:Math.min(i,1200),...structuredClone(physical),body:Object.fromEntries(['hunger','thirst','thermal','energy','stamina','fatigue','sleepiness','pain','wetness','overall','activity','digestion','sleep','relief'].map(k=>[k,'fixture'])),run:null,runSourceId:null,cycle:null,active:null})),agents:structuredClone(saved.agents),choices:[],inquiryTransitions:[],recallTransitions:mode==='candidate'?[transition(3,'ready'),transition(4,'pulling'),transition(6,'detached')]:[],activeOccupancySeconds:{a:{idle:1200}}};
}
test('new frozen pins and strict admission; local invocation rejected before source imports',()=>{
 assert.equal(P.seed,79223);assert.equal(P.steps,72000);assert.equal(P.baselineCommit,'0a4eb36b3eaa7fa469a6da9257df588689aa046b');assert.equal(P.baselineTree,'426bcdb7f9bd28eb93dc21fbb15da283224e574f');assert.equal(P.baselineSource,'a4f39099b935133fd959541f9896aa3f34cdd7840b9d876f6d3ea9f94dd86412');assert.equal(P.candidateSource,'4aa7bcc87ac84b14ac34b6d0ff5f0321f7ca6e0d5b28526bc61924809bb0706f');
 assert.equal(harnessHash('.'),sha256(JSON.stringify(harnessManifest('.'))));
 const args=['/baseline','/candidate','/out/baseline-79223','baseline',P.baselineSource,'b'.repeat(64)];assert.equal(validateMotorArm(args,env()).mode,'baseline');assert.throws(()=>validateMotorArm(args.map((x,i)=>i===4?'0'.repeat(64):x),env()));
 for(const k of ['GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_RUN_ATTEMPT','GITHUB_WORKFLOW','GITHUB_SHA','GITHUB_RUN_ID'])assert.throws(()=>validateMotorArm(args,{...env(),[k]:'wrong'}));
 assert.throws(()=>validateMotorArm([...args,'c'.repeat(64)],env()));assert.throws(()=>validateMotorArm(['/candidate','/candidate','/out/candidate-79223','candidate',P.candidateSource,'b'.repeat(64)],env()));
 const r=spawnSync(process.execPath,['scripts/motor-recall-ordinary-v1-arm.mjs',...args],{env:{GITHUB_ACTIONS:'false'},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/AssertionError/);
 const safe=childEnvironment(env());for(const k of ['GITHUB_TOKEN','GH_TOKEN','ACTIONS_RUNTIME_TOKEN','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','NODE_OPTIONS'])assert.equal(safe[k],undefined);
});
test('git checkout attestation rejects credentials, wrong heads/trees and dirty tracked bytes',()=>{
 const run=(_cmd,args)=>({code:args[0]==='config'?1:0,stdout:args[0]==='config'?'':args[0]==='status'?'':args[0]==='remote'?'https://github.com/kumori-i/aincrad.git\n':args[1]==='HEAD'?P.baselineCommit+'\n':P.baselineTree+'\n',stderr:''});
 assert.deepEqual(verifyCheckout('/unused',P.baselineCommit,P.baselineTree,run),{commit:P.baselineCommit,tree:P.baselineTree});
 for(const command of ['config','status','remote','rev-parse'])assert.throws(()=>verifyCheckout('/unused',P.baselineCommit,P.baselineTree,(cmd,args)=>args[0]===command?{code:0,stdout:'unexpected-secret-or-change',stderr:''}:run(cmd,args)));
});
test('dual-root coordinator strips secret environment, fixed order/CPU and no retry after failure',()=>temp(dir=>{
 const calls=[],run=(cmd,args,options)=>{calls.push({cmd,args,options});writeFileSync(args[6]+'.json',JSON.stringify({mode:args[7],status:'completed',initialComparableSha256:'c'.repeat(64)}),{flag:'wx'});return {code:0,stdout:'ok',stderr:''};};
 executeMotorArms({root:'/candidate',baseline:'/baseline',out:dir,cpu:3,harness:'b'.repeat(64),env:env(),run});assert.equal(calls.length,2);
 assert.deepEqual(calls.map(c=>c.args[4]),['/baseline','/candidate']);assert.deepEqual(calls.map(c=>c.args[7]),P.arms);
 for(const c of calls){assert.equal(c.cmd,'taskset');assert.deepEqual(c.args.slice(0,2),['-c','3']);assert.equal(c.options.timeout,24*60*1000);assert.deepEqual(c.options.env,childEnvironment(env()));assert.equal(c.args[5],'/candidate');}
 assert.equal(calls[1].args.at(-1),'c'.repeat(64));
}));
test('failed baseline preserves partial log and never starts candidate',()=>temp(dir=>{
 let calls=0;assert.throws(()=>executeMotorArms({root:'.',baseline:'/baseline',out:dir,cpu:1,harness:'b'.repeat(64),env:env(),run:()=>{calls++;return {code:null,error:'timeout',stdout:'partial',stderr:''};}}));assert.equal(calls,1);assert.equal(readFileSync(join(dir,'baseline-79223.log'),'utf8'),'partial');assert.equal(existsSync(join(dir,'candidate-79223.log')),false);
}));
test('exposure/admission/selection/paid candidates stay separate from confirmed recall',()=>{
 const b=fixture('baseline'),c=fixture('candidate'),before=JSON.stringify([b,c]),report=analyzeMotorPair(b,c);
 assert.equal(report.baselinePotentialExposure.length,1);assert.equal(report.candidateAdmissionCases.length,1);assert.equal(report.admissionCounts.a,1);
 const q=report.candidateAdmissionCases[0];assert.equal(q.paidPullCandidates.length,1);assert.match(q.attribution,/independent review/);assert.match(q.foodContext.classification,/no-prior/);assert.match(q.foodContextThroughFirstObservedPulling.classification,/no-prior/);assert.equal(JSON.stringify([b,c]),before);
 c.recallTransitions=c.recallTransitions.filter(r=>r.status.questions[0].phase!=='pulling');assert.equal(analyzeMotorPair(b,c).candidateAdmissionCases[0].foodContextThroughFirstObservedPulling.classification,'unknown-no-observed-canonical-pulling');
 const empty=fixture('candidate');empty.recallTransitions=[];assert.equal(analyzeMotorPair(b,empty).candidateAdmissionCases.length,0,'A matching paid pull is not admission');
});
test('outside-food labels use own source/material trace, not species or unrelated ingestion',()=>{
 const b=fixture('baseline'),c=fixture('candidate',{food:true});assert.equal(analyzeMotorPair(b,c).candidateAdmissionCases[0].foodContext.classification,'prior-ingestion-or-positive-chain-feedback');
 c.rows[1].details.action.targetId='object:999';assert.equal(analyzeMotorPair(b,c).candidateAdmissionCases[0].foodContext.classification,'unknown-material-ancestry');
 c.rows[1].details.action.targetId='object:1';assert.equal(analyzeMotorPair(b,c).candidateAdmissionCases[0].foodContext.classification,'prior-ingestion-or-positive-chain-feedback');
});
test('contradictory later pull and age prevent exposure motif, never create eligibility',()=>{
 const c=fixture('candidate'),rows=structuredClone(c.rows);rows.splice(1,0,{actor:'a',id:99,at:2,type:'action',details:{action:{type:'pull',targetId:'object:1'},result:{ok:false,code:'nothing_detached'}}});assert.deepEqual(exposureMotifs(rows),[]);
 rows.splice(1,1);rows[1].at=302;assert.deepEqual(exposureMotifs(rows),[]);
});
test('malformed equal envelopes, lineage changes, gaps and incomplete status fail closed',()=>{
 for(const mutate of [a=>a.rows=null,a=>a.snapshots=[],a=>a.agents=[],a=>a.activeOccupancySeconds=null,a=>a.coverage.coverage='partial',a=>a.sourceAfter='0'.repeat(64),a=>a.completedSteps--,a=>a.rows[0].id=2,a=>a.saveRaw+=' ']){const b=fixture('baseline'),c=fixture('candidate');mutate(c);assert.throws(()=>analyzeMotorPair(b,c));}
 const b=fixture('baseline'),c=fixture('candidate');c.recallTransitions[0].incarnation++;assert.throws(()=>analyzeMotorPair(b,c));
 const d=fixture('candidate');const world=JSON.parse(d.saveRaw);world.worldLineage.agents[0].serial++;d.saveRaw=JSON.stringify(world);d.saveSha256=sha256(d.saveRaw);d.saveComparableSha256=comparableHash(world);assert.throws(()=>analyzeMotorPair(b,d));
});
function writeArm(dir,arm){const tag=join(dir,arm.mode+'-79223'),journal=createEvidenceJournal(tag+'.events.jsonl');for(const[k,f]of Object.entries({receipt:'rows',snapshot:'snapshots',choice:'choices',inquiry:'inquiryTransitions',recall:'recallTransitions'}))for(const r of arm[f])journal.append(k,r);for(let i=1;i<=P.seconds;i++)journal.append('progress',{completedSteps:i*60});journal.append('terminal',{completedSteps:P.steps,status:'completed'});journal.close();arm.journalSha256=sha256(readFileSync(tag+'.events.jsonl'));writeFileSync(tag+'.initial.json',arm.initialRaw);writeFileSync(tag+'.save.json',arm.saveRaw);const result={...arm};delete result.initialRaw;delete result.saveRaw;writeFileSync(tag+'.json',JSON.stringify(result));return tag;}
test('file analyzer binds complete journals/raw bytes/source closure and exclusive report',()=>temp(dir=>{
 const b=fixture('baseline'),c=fixture('candidate'),bt=writeArm(dir,b),ct=writeArm(dir,c),mp=join(dir,'manifest.json'),out=join(dir,'report.json');
 writeFileSync(mp,JSON.stringify({protocol:P,baseline:{commit:P.baselineCommit,tree:P.baselineTree,source:P.baselineSource},candidate:{commit:'a'.repeat(40),tree:'b'.repeat(40),source:P.candidateSource},evaluationFiles:harnessManifest('.'),harnessSha256:harnessHash('.')}));
 assert.equal(analyzeMotorFiles(bt,ct,mp,out).status,'integrity-passed-awaiting-independent-interpretation');assert.throws(()=>analyzeMotorFiles(bt,ct,mp,out));
 const raw=readFileSync(ct+'.events.jsonl','utf8');verifyMotorJournal(c,raw);const bad=raw.replace('recall','choice');assert.throws(()=>verifyMotorJournal({...c,journalSha256:sha256(bad)},bad));
 writeFileSync(ct+'.save.json','tampered');assert.throws(()=>analyzeMotorFiles(bt,ct,mp,join(dir,'new.json')));
}));
test('workflow pins two credential-free roots, once-only readonly and no old activation',()=>{
 const w=readFileSync('.github/workflows/motor-recall-ordinary-v1-once.yml','utf8'),arm=readFileSync('scripts/motor-recall-ordinary-v1-arm.mjs','utf8'),run=readFileSync('scripts/motor-recall-ordinary-v1-run.mjs','utf8');
 assert.equal((w.match(/persist-credentials: false/g)||[]).length,2);assert.match(w,new RegExp(P.baselineCommit));for(const p of [/on: create/,/github.run_attempt == 1/,/cancel-in-progress: false/,/contents: read/,/actions: read/,/if: always\(\)/])assert.match(w,p);assert.doesNotMatch(w,/workflow_dispatch|contents: write|actions: write/);
 assert.doesNotMatch(arm,/loadOzarkSave|setProcedureDiagnostics|discoveryFoodLearning:false|handlingCuriosity:false/);assert.ok(run.indexOf('await verifyMotorRecallRunHistory()')<run.indexOf("phase='prepare'"));assert.match(run,/artifact-hashes.json/);
});

test('baseline/candidate behavior and final state may differ; only initial equality required',()=>{
 const b=fixture('baseline'),c=fixture('candidate');const w=JSON.parse(c.saveRaw);w.agents[0].changedByPolicy=true;c.saveRaw=JSON.stringify(w);c.saveSha256=sha256(c.saveRaw);c.saveComparableSha256=comparableHash(w);c.activeOccupancySeconds.a={pull:10,idle:1190};
 assert.doesNotThrow(()=>analyzeMotorPair(b,c));
 const initial=JSON.parse(c.initialRaw);delete initial.agents[0].discovery;for(const a of [b,c]){a.initialRaw=JSON.stringify(initial);a.initialSha256=sha256(a.initialRaw);a.initialComparableSha256=comparableHash(initial);}
 assert.equal(analyzeMotorPair(b,c).candidateAdmissionCases[0].foodContext.classification,'unknown-initial-food-history');
});

test('semantic completeness rejects malformed cadence, payload, occupancy, scope and ordering',()=>{
 for(const mutate of [a=>a.snapshots[0]={actor:'a'},a=>a.snapshots[60].at=61,a=>a.snapshots[0].actor='other',a=>a.snapshots[0].body=null,a=>a.snapshots.at(-1).physiology.health=99,a=>a.agents[0]={id:'a'},a=>a.agents[0].position.x=7,a=>a.activeOccupancySeconds.a={},a=>a.activeOccupancySeconds.a.idle=1199,a=>a.rows[1].at=.5,a=>a.recallTransitions[0].tick=1,a=>a.recallTransitions[0].at=1199,a=>a.choices.push({actor:'other',at:1}),a=>a.inquiryTransitions.push({actor:'a',at:1201,status:null})]){const b=fixture('baseline'),c=fixture('candidate');mutate(c);assert.throws(()=>analyzeMotorPair(b,c));}
});
test('global material ancestry catches handed-off food, keeps actor-local consumption and unknowns',()=>{
 const initial=JSON.parse(fixture('candidate').initialRaw);
 const pull=(actor,from,to,at)=>({actor,at,details:{action:{type:'pull',targetId:from},result:{ok:true,code:'piece_detached',materialId:to}}});
 const sample=(actor,target,at)=>({actor,at,details:{action:{type:'sample',targetId:target},result:{ingestionId:'i'}}});
 const rows=[pull('b','object:1','object:2',1),pull('b','object:2','object:3',2),sample('a','object:3',3)];
 assert.equal(foodContext(rows,'a','object:1',4,initial).classification,'prior-ingestion-or-positive-chain-feedback');
 rows[2].actor='b';assert.match(foodContext(rows,'a','object:1',4,initial).classification,/no-prior/);
 rows.push(sample('a','object:999',4));assert.equal(foodContext(rows,'a','object:1',4,initial).classification,'unknown-material-ancestry');
});

test('world and actor initial/final clocks are bound independently of hashes',()=>{
 for(const field of ['initial','save'])for(const where of ['world','actor'])for(const value of [undefined,1,field==='initial'?1200:0]){const b=fixture('baseline'),c=fixture('candidate'),w=JSON.parse(c[field+'Raw']);(where==='world'?w:w.agents[0]).elapsed=value;c[field+'Raw']=JSON.stringify(w);c[field+'Sha256']=sha256(c[field+'Raw']);c[field+'ComparableSha256']=comparableHash(w);assert.throws(()=>analyzeMotorPair(b,c));}
});
test('partial, cyclic, ambiguous and queried-material ancestry never creates negative food evidence',()=>{
 const initial=JSON.parse(fixture('candidate').initialRaw);
 const pull=(from,to)=>({actor:'b',at:1,details:{action:{type:'pull',targetId:from},result:{ok:true,code:'piece_detached',materialId:to}}});
 const sample=target=>({actor:'a',at:2,details:{action:{type:'sample',targetId:target},result:{ingestionId:'i'}}});
 assert.equal(foodContext([],'a','object:999',4,initial).classification,'unknown-material-ancestry');
 for(const rows of [[pull('object:2','object:3'),sample('object:3')],[pull('object:2','object:3'),pull('object:3','object:2')],[pull('object:2','object:3'),pull('object:4','object:3')],[pull('object:2','object:1')]])assert.equal(foodContext(rows,'a','object:1',4,initial).classification,'unknown-material-ancestry');
});

test('conflicting or cyclic inferred positives remain unknown rather than certified food evidence',()=>{
 const initial=JSON.parse(fixture('candidate').initialRaw);
 const pull=(from,to)=>({actor:'b',at:1,details:{action:{type:'pull',targetId:from},result:{ok:true,code:'piece_detached',materialId:to}}});
 const sample={actor:'a',at:2,details:{action:{type:'sample',targetId:'object:3'},result:{ingestionId:'i'}}};
 for(const rows of [[pull('object:2','object:3'),pull('object:1','object:3'),sample],[pull('object:1','object:3'),pull('object:3','object:1'),sample]])assert.equal(foodContext(rows,'a','object:1',4,initial).classification,'unknown-material-ancestry');
});
