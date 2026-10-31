import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as V1} from '../scripts/character-ordinary-pilot-protocol.mjs';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P,CHARACTER_PILOT_COUNT_KEYS,
  projectCharacterPilot,validateCharacterPilotProjection}
  from '../scripts/character-ordinary-diagnostic-v2-protocol.mjs';
import {CHARACTER_PILOT_WORKFLOW_FILE,verifyCharacterPilotRunHistory}
  from '../scripts/character-diagnostic-v2-activation-gate.mjs';
import {fetchCharacterPilotReceiptRef}
  from '../scripts/character-diagnostic-v2-receipt-ref.mjs';
import {generatedCharacterPilotObserver,main,validateCharacterPilotActivation}
  from '../scripts/prepare-character-ordinary-diagnostic-v2.mjs';

const root=new URL('../',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const commit='a'.repeat(40),tree='b'.repeat(40),receiptCommit='c'.repeat(40);
const sourceHashes=Object.fromEntries(['sourceManifestSha256','protocolSha256',
  'runnerSha256','generatedRunnerSha256','runtimeFingerprint','rendererManifestSha256']
  .map((key,index)=>[key,(index+1).toString(16).repeat(64)]));
const actionEnv=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',
  GITHUB_WORKFLOW:P.workflow,GITHUB_EVENT_NAME:'create',
  GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',
  GITHUB_RUN_ID:'400',GITHUB_TOKEN:'synthetic-read-token',GITHUB_SHA:commit,
  DISPLAY:':91',AINCRAD_CHARACTER_PILOT_RECEIPT_REF:'refs/heads/'+P.receiptRef,
  AINCRAD_CHARACTER_PILOT_RECEIPT_COMMIT:receiptCommit});

test('v2 has distinct once-only identity and unchanged v1 physical and evidence contract',async()=>{
  const changed=['id','activationRef','receiptRef','workflow'];
  assert.deepEqual(Object.keys(P),Object.keys(V1));
  for(const key of Object.keys(V1)){
    if(changed.includes(key))assert.notEqual(P[key],V1[key],key);
    else assert.deepEqual(P[key],V1[key],key);
  }
  assert.equal(P.worldSeed,74193);assert.equal(P.communicationSeed,211);
  assert.equal(P.fixedStep,1/60);assert.equal(P.speed,1);
  assert.equal(P.targetSeconds,1200);assert.equal(P.wallLimitMs,30*60*1000);
  assert.equal(P.maxGateKeys,64);
  assert.equal(CHARACTER_PILOT_COUNT_KEYS.length,21);
  assert.equal(CHARACTER_PILOT_WORKFLOW_FILE,'character-ordinary-diagnostic-v2-once.yml');
  assert.equal(Object.isFrozen(P),true);
  for(const path of [
    'scripts/character-ordinary-pilot-protocol.mjs',
    'scripts/prepare-character-ordinary-pilot.mjs',
    'scripts/character-pilot-activation-gate.mjs',
    'scripts/character-pilot-receipt-ref.mjs',
    '.github/workflows/character-ordinary-pilot-once.yml',
  ]){
    const historical=execFileSync('git',['show','HEAD:'+path],{cwd:root});
    assert.deepEqual(await readFile(new URL('../'+path,import.meta.url)),historical,path);
  }
});

test('workflow is create-only, exact v2 ref and attempt one, with bounded evidence',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/'+
    CHARACTER_PILOT_WORKFLOW_FILE,import.meta.url),'utf8');
  assert.match(workflow,/^on: create$/m);
  assert.match(workflow,/github\.event_name == 'create'/);
  assert.match(workflow,/github\.event\.ref_type == 'branch'/);
  assert(workflow.includes(`github.event.ref == '${P.activationRef}'`));
  assert(workflow.includes(`github.ref == 'refs/heads/${P.activationRef}'`));
  assert.match(workflow,/github\.run_attempt == 1/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/timeout-minutes: 45/);
  assert.match(workflow,/if: always\(\)/);
  assert(workflow.includes('node scripts/character-diagnostic-v2-activation-gate.mjs'));
  assert(workflow.includes('node scripts/character-diagnostic-v2-receipt-ref.mjs'));
  assert(workflow.includes('node scripts/prepare-character-ordinary-diagnostic-v2.mjs --execute-approved'));
  assert(!workflow.includes(V1.activationRef));
  assert(!workflow.includes(V1.receiptRef));
});

test('activation validates only the distinct reviewed v2 receipt and create event',()=>{
  const env=actionEnv(),identity={commit,tree,worktreeStatus:''};
  const event={ref_type:'branch',ref:P.activationRef};
  const receipt={schema:1,approved:true,protocol:P.id,activationRef:P.activationRef,
    commit,tree,...sourceHashes,reviewedBy:'Independent reviewer',
    reviewedAt:'2026-10-31T00:00:00Z'};
  const actual={...sourceHashes,receiptSha256:'f'.repeat(64)};
  const host={platform:'linux',arch:'x64',uid:1000};
  assert.equal(validateCharacterPilotActivation(env,event,identity,receipt,actual,host).verified,true);
  for(const [e,ev,r] of [
    [{...env,GITHUB_WORKFLOW:V1.workflow},event,receipt],
    [{...env,GITHUB_REF:'refs/heads/'+V1.activationRef},event,receipt],
    [{...env,AINCRAD_CHARACTER_PILOT_RECEIPT_REF:'refs/heads/'+V1.receiptRef},event,receipt],
    [env,{...event,ref:V1.activationRef},receipt],
    [env,event,{...receipt,protocol:V1.id}],
    [env,event,{...receipt,activationRef:V1.activationRef}],
    [env,event,{...receipt,approved:false}],
    [{...env,GITHUB_RUN_ATTEMPT:'2'},event,receipt],
  ])assert.throws(()=>validateCharacterPilotActivation(e,ev,identity,r,actual,host));
});

function historyApi(pages){
  return async(input,options)=>{
    const url=new URL(input),scope=url.searchParams.has('branch')?'filtered':'all';
    assert.equal(url.pathname,'/repos/kumori-i/aincrad/actions/workflows/'+
      CHARACTER_PILOT_WORKFLOW_FILE+'/runs');
    assert.equal(url.searchParams.get('event'),'create');
    if(scope==='filtered')assert.equal(url.searchParams.get('branch'),P.activationRef);
    assert.equal(options.headers.Authorization,'Bearer synthetic-read-token');
    assert(options.signal instanceof AbortSignal);
    const next=pages.shift();assert(next);assert.equal(scope,next.scope);
    return {ok:true,json:async()=>({total_count:next.rows.length,workflow_runs:next.rows})};
  };
}
const run=(id,branch=P.activationRef)=>({id,event:'create',head_branch:branch,
  status:'completed',conclusion:'failure'});

test('history guard accepts only the indexed current run and rejects failed or deleted predecessors',async()=>{
  const current=run(400),old=run(399);
  const pages=rows=>[{scope:'filtered',rows:rows.filter(row=>row.head_branch===P.activationRef)},
    {scope:'all',rows}];
  assert.equal((await verifyCharacterPilotRunHistory({env:actionEnv(),
    fetchImpl:historyApi(pages([current]))})).verified,true);
  await assert.rejects(verifyCharacterPilotRunHistory({env:actionEnv(),
    fetchImpl:historyApi(pages([current,old])),maxIndexPolls:1}),
  /already has another create run/);
  await assert.rejects(verifyCharacterPilotRunHistory({env:actionEnv(),
    fetchImpl:historyApi([{scope:'filtered',rows:[current]},
      {scope:'all',rows:[current,old]}]),maxIndexPolls:1}),
  /already has another create run/);
  await assert.rejects(verifyCharacterPilotRunHistory({env:{...actionEnv(),
    GITHUB_REF:'refs/heads/'+V1.activationRef},fetchImpl:historyApi([])}));
  await assert.rejects(verifyCharacterPilotRunHistory({env:{...actionEnv(),
    GITHUB_WORKFLOW:V1.workflow},fetchImpl:historyApi([])}));
});

test('receipt helper fetches only the distinct single-file v2 data ref',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-diagnostic-v2-receipt-'));
  const blob='d'.repeat(40),bytes=Buffer.from('{"schema":1,"approved":true}');
  const calls=[];
  const git=args=>{
    calls.push(args);
    const command=args.join(' ');
    if(command==='rev-parse HEAD')return Buffer.from(commit+'\n');
    if(args[0]==='fetch')return Buffer.alloc(0);
    if(command==='rev-parse FETCH_HEAD^{commit}')return Buffer.from(receiptCommit+'\n');
    if(args[0]==='ls-tree')return Buffer.from(`100644 blob ${blob}\treceipt.json\0`);
    if(command==='cat-file -s '+blob)return Buffer.from(String(bytes.length)+'\n');
    if(command==='cat-file blob '+blob)return bytes;
    throw Error('unexpected Git command '+command);
  };
  try{
    const env={...actionEnv(),RUNNER_TEMP:scratch,GITHUB_ENV:join(scratch,'github-env')};
    await writeFile(env.GITHUB_ENV,'');
    const result=await fetchCharacterPilotReceiptRef({root:scratch,env,git});
    assert.equal(result.receiptRef,'refs/heads/'+P.receiptRef);
    assert.equal(result.receiptCommit,receiptCommit);
    assert.equal(result.receiptSha256,sha(bytes));
    assert.deepEqual(await readFile(join(scratch,'aincrad-character-diagnostic-v2-receipt.json')),bytes);
    assert.deepEqual(calls.filter(args=>args[0]==='fetch'),[[
      'fetch','--no-tags','--no-recurse-submodules','--depth=1','origin',
      'refs/heads/'+P.receiptRef]]);
    let called=false;
    await assert.rejects(fetchCharacterPilotReceiptRef({root:scratch,
      env:{...env,GITHUB_REF:'refs/heads/'+V1.activationRef},
      git:()=>{called=true;throw Error('must not fetch');}}));
    assert.equal(called,false);
  }finally{await rm(scratch,{recursive:true,force:true});}
});

test('source-only preparation makes an unapproved hashed candidate and parseable observer',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-diagnostic-v2-prepare-'));
  try{
    const result=await main([],{...process.env,AINCRAD_CHARACTER_PILOT_OUTPUT:scratch});
    assert.equal(result.prepared,true);assert.equal(result.executed,false);
    const candidate=JSON.parse(await readFile(join(result.output,'candidate.json'),'utf8'));
    const manifestBytes=await readFile(join(result.output,'source-manifest.json'));
    const generated=await readFile(join(result.output,'observer.cjs'),'utf8');
    assert.equal(candidate.protocol.id,P.id);
    assert.equal(candidate.nativeExecutionAttempted,false);
    assert.equal(candidate.nativeExecutionPerformed,false);
    assert.equal(candidate.activationBound,false);
    assert.equal(candidate.receiptTemplate.approved,false);
    assert.equal(candidate.receiptTemplate.activationRef,P.activationRef);
    assert.equal(candidate.hashes.sourceManifestSha256,sha(manifestBytes));
    assert.equal(candidate.hashes.generatedRunnerSha256,sha(generated));
    assert.equal(candidate.hashes.protocolSha256,sha(await readFile(new URL(
      '../scripts/character-ordinary-diagnostic-v2-protocol.mjs',import.meta.url))));
    assert.equal(generated,generatedCharacterPilotObserver());
    new vm.Script(generated,{filename:'observer.cjs'});
  }finally{await rm(scratch,{recursive:true,force:true});}
});

test('observer projection carries first-failed peer and reply gates with bounded omission',async()=>{
  const bodyKeys=['health','satietyHours','availableEnergyKcal','storedEnergyKcal',
    'waterDeficitMl','stamina','fatigue','sleepPressure','hoursSinceMeal','starvationHours'];
  const zeros=keys=>Object.fromEntries(keys.map(key=>[key,0]));
  const body=zeros(bodyKeys),totals=zeros(['ingestedKcal','absorbedKcal','metabolizedKcal']);
  const stats=zeros(['collapses','rescues','independentMeals','independentDrinks']);
  const survivalKeys=['begun','finished','incomplete','superseded','evictedRecords',
    'droppedNotes','rejectedNotes'];
  const agent=id=>({id,epoch:0,elapsed:0,scene:'forest',position:{x:0,y:0},
    lifecycle:'ordinary',active:null,physiology:{...body,totals},stats});
  const world={version:12,elapsed:0,geometryIdentity:P.geometryIdentity,
    environment:{seed:P.worldSeed,elapsed:0,ecology:{elapsed:0,pending:0}},
    agents:[agent('aster'),agent('mira')],player:{x:0,y:0},playerBody:body};
  const bank=(partnerId,partnerSerial)=>({partnerId,partnerSerial,retainedExamples:0,trained:false});
  const measurement={seed:P.communicationSeed,phase:P.phase,
    counts:zeros(CHARACTER_PILOT_COUNT_KEYS),reasons:[],reasonOverflow:0,
    eventsRetained:0,eventsEvicted:0,eventsRetired:0,saturated:false,
    admissionGates:{'no-peer:distance':3,'response-preflight:sender-target-out-of-view':2},
    admissionGateKeysOmitted:0,pending:0,identityPendingReconciliation:false,
    actors:[{id:'aster',identity:1,character:{senderUpdates:0,listenerUpdates:0,
      uniqueDemonstrations:0,replayUses:0,partnerBanks:[bank('mira',2)]}},
    {id:'mira',identity:2,character:{senderUpdates:0,listenerUpdates:0,
      uniqueDemonstrations:0,replayUses:0,partnerBanks:[bank('aster',1)]}}],
    survival:['aster','mira'].map(agentId=>({agentId,counters:zeros(survivalKeys),
      recordsRetained:0,decisionActive:false,gateCounts:{}})),events:[]};
  const before=JSON.stringify({world,measurement});
  const project=async()=>vm.runInNewContext('('+projectCharacterPilot.toString().replace(
    "await import('./src/config.js')","({CONFIG:{fixedStep:1/60}})")+')()',
  {window:{__ozarkWorld:{fullSnapshot:()=>world,
    communicationMeasurementSnapshot:()=>measurement}},Date,Number,Object});
  const first=await project();validateCharacterPilotProjection(first);
  assert.equal(first.admissionGates['no-peer:distance'],3);
  assert.equal(first.admissionGates['response-preflight:sender-target-out-of-view'],2);
  assert.equal(JSON.stringify({world,measurement}),before);
  measurement.admissionGates=Object.fromEntries(Array.from({length:65},(_,i)=>
    ['no-peer:synthetic-'+i,i]));
  measurement.admissionGateKeysOmitted=1;measurement.saturated=true;
  const bounded=await project();validateCharacterPilotProjection(bounded);
  assert.equal(Object.keys(bounded.admissionGates).length,P.maxGateKeys);
  assert.equal(bounded.admissionGateKeysOmitted,1);
  assert.equal(bounded.saturated,true);
  assert.equal(bounded.admissionGates['no-peer:synthetic-64'],undefined);
});
