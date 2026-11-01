import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P} from '../scripts/character-ordinary-motor-v4-protocol.mjs';
import {CHARACTER_MOTOR_V4_WORKFLOW_FILE,readCharacterMotorV4RunHistory,
  verifyCharacterMotorV4RunHistory} from '../scripts/character-motor-v4-activation-gate.mjs';

const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',
  GITHUB_WORKFLOW:P.workflow,GITHUB_EVENT_NAME:'create',
  GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',
  GITHUB_RUN_ID:'400',GITHUB_TOKEN:'synthetic-read-token'});
const run=(id,other={})=>({id,event:'create',head_branch:P.activationRef,
  status:'completed',conclusion:'failure',...other});
function api(responses,seen=[]){
  return async (input,options)=>{
    const url=new URL(input),page=Number(url.searchParams.get('page'));
    const scope=url.searchParams.has('branch')?'filtered':'all';
    assert.equal(url.pathname,'/repos/kumori-i/aincrad/actions/workflows/'+
      CHARACTER_MOTOR_V4_WORKFLOW_FILE+'/runs');
    assert.equal(url.searchParams.get('event'),'create');
    if(scope==='filtered')assert.equal(url.searchParams.get('branch'),P.activationRef);
    else assert.equal(url.searchParams.get('branch'),null);
    assert.equal(url.searchParams.get('per_page'),'100');
    assert.equal(options.headers.Authorization,'Bearer synthetic-read-token');
    assert(options.signal instanceof AbortSignal);
    seen.push(scope+':'+page);
    const response=responses.shift();
    if(response instanceof Error)throw response;
    assert(response,'Unexpected history request');
    if(response.scope)assert.equal(scope,response.scope);
    return {ok:response.ok!==false,json:async()=>response.body};
  };
}
const body=rows=>({total_count:rows.length,workflow_runs:rows});
const both=rows=>[
  {scope:'filtered',body:body(rows.filter(row=>row.head_branch===P.activationRef))},
  {scope:'all',body:body(rows)},
];

test('motor v4 create workflow and protocol use their own exact one-time refs',async()=>{
  assert.equal(P.workflow,'Ordinary character-motor lifecycle v4 — approved once');
  assert.equal(P.activationRef,'experiments/character-motor-lifecycle-v4-once');
  assert.equal(P.receiptRef,'experiments/character-motor-lifecycle-v4-receipt');
  assert.equal(CHARACTER_MOTOR_V4_WORKFLOW_FILE,'character-ordinary-motor-v4-once.yml');
  const workflow=await readFile(new URL('../.github/workflows/'+
    CHARACTER_MOTOR_V4_WORKFLOW_FILE,import.meta.url),'utf8');
  assert.match(workflow,/^on: create$/m);
  assert.doesNotMatch(workflow,/^\s*(?:push|pull_request|workflow_dispatch):/m);
  assert.match(workflow,/github\.event\.ref_type == 'branch'/);
  assert.match(workflow,/github\.event\.ref == 'experiments\/character-motor-lifecycle-v4-once'/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/experiments\/character-motor-lifecycle-v4-once'/);
  assert.match(workflow,/github\.run_attempt == 1/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/node scripts\/character-motor-v4-activation-gate\.mjs/);
  assert.match(workflow,/node scripts\/character-motor-v4-receipt-ref\.mjs/);
});

test('first indexed create run passes once with exact workflow and branch scope',async()=>{
  const pages=[];
  const result=await verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api(
    both([run(400,{status:'in_progress',conclusion:null})]),pages)});
  assert.deepEqual(result,{verified:true,runId:'400',matchingCreateRuns:1});
  assert.deepEqual(pages,['filtered:1','all:1']);
});

test('zero indexed runs permit bounded visibility polling and no other retry',async()=>{
  let sleeps=0;
  const result=await verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    ...both([]),...both([run(400)]),
  ]),sleep:async ms=>{assert.equal(ms,2000);sleeps++;},maxIndexPolls:2});
  assert.equal(result.verified,true);
  assert.equal(sleeps,1);
});

test('filtered history may index the sole current run before unfiltered history',async()=>{
  let sleeps=0;
  const result=await verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    {scope:'filtered',body:body([run(400)])},
    {scope:'all',body:body([])},
    ...both([run(400)]),
  ]),sleep:async()=>{sleeps++;},maxIndexPolls:2,indexPollMs:0});
  assert.equal(result.verified,true);
  assert.equal(sleeps,1);
});

test('unfiltered history may index the sole current run before filtered history',async()=>{
  let sleeps=0;
  const result=await verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    {scope:'filtered',body:body([])},
    {scope:'all',body:body([run(400)])},
    ...both([run(400)]),
  ]),sleep:async()=>{sleeps++;},maxIndexPolls:2,indexPollMs:0});
  assert.equal(result.verified,true);
  assert.equal(sleeps,1);
});

test('a prior failed or prelaunch run consumes the branch even after delete and recreate',async()=>{
  const seen=[];
  await assert.rejects(verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    ...both([run(400,{status:'queued',conclusion:null}),
      run(399,{status:'completed',conclusion:'failure'})]),
  ],seen),sleep:async()=>{throw new Error('Must not poll a prior run');}}),
  /already has another create run/);
  assert.deepEqual(seen,['filtered:1','all:1']);
  await assert.rejects(verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    ...both([run(399,{conclusion:'cancelled'})]),
  ])}),/already has another create run/);
});

test('unfiltered history catches a deleted-branch predecessor omitted by branch filter',async()=>{
  const seen=[];
  await assert.rejects(verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    {scope:'filtered',body:body([run(400)])},
    {scope:'all',body:body([run(400),run(399,{conclusion:'failure'})])},
  ],seen)}),/already has another create run/);
  assert.deepEqual(seen,['filtered:1','all:1']);
});

test('unfiltered second page cannot hide an older activation after other branch creates',async()=>{
  const seen=[];
  const first=[run(400),...Array.from({length:99},(_,index)=>
    run(500+index,{head_branch:'unrelated-'+index}))];
  await assert.rejects(verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    {scope:'filtered',body:body([run(400)])},
    {scope:'all',body:{total_count:101,workflow_runs:first}},
    {scope:'all',body:{total_count:101,workflow_runs:[run(399)]}},
  ],seen)}),/already has another create run/);
  assert.deepEqual(seen,['filtered:1','all:1','all:2']);
});

test('unfiltered history rejects null branch rows and accepts known unrelated branches',async()=>{
  await assert.rejects(verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    {scope:'filtered',body:body([run(400)])},
    {scope:'all',body:body([run(400),run(399,{head_branch:null})])},
  ])}),/unexpected row/);
  const result=await verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    {scope:'filtered',body:body([run(400)])},
    {scope:'all',body:body([run(400),run(399,{head_branch:'other-branch'})])},
  ])});
  assert.equal(result.verified,true);
});

test('pagination includes prior create runs beyond the first page',async()=>{
  const seen=[];
  const first=[run(400),...Array.from({length:99},(_,index)=>run(500+index))];
  const rows=await readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    fetchImpl:api([
      {body:{total_count:101,workflow_runs:first}},
      {body:{total_count:101,workflow_runs:[run(399)]}},
    ],seen)});
  assert.equal(rows.length,101);
  assert.equal(rows.at(-1),'399');
  assert.deepEqual(seen,['filtered:1','filtered:2']);
});

test('missing current run fails after bounded indexing attempts',async()=>{
  let sleeps=0;
  await assert.rejects(verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    ...both([]),...both([]),
  ]),sleep:async()=>{sleeps++;},maxIndexPolls:2,indexPollMs:0}),
  /not consistently indexed within the bound/);
  assert.equal(sleeps,1);
});

test('current-only indexing disagreement expires after its bounded recheck',async()=>{
  let sleeps=0;
  await assert.rejects(verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    {scope:'filtered',body:body([run(400)])},
    {scope:'all',body:body([])},
    {scope:'filtered',body:body([])},
    {scope:'all',body:body([run(400)])},
  ]),sleep:async()=>{sleeps++;},maxIndexPolls:2,indexPollMs:0}),
  /not consistently indexed within the bound/);
  assert.equal(sleeps,1);
});

test('API errors and incomplete pagination fail closed',async()=>{
  await assert.rejects(readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    fetchImpl:api([{ok:false,body:{}}])}),/API unavailable/);
  await assert.rejects(readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    fetchImpl:api([new Error('network down')])}),/network down/);
  await assert.rejects(readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    fetchImpl:api([{body:{total_count:2,workflow_runs:[run(400)]}}])}),/page is incomplete/);
  await assert.rejects(readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    fetchImpl:api([{body:{total_count:1001,workflow_runs:[]}}])}),/incomplete or over cap/);
  await assert.rejects(readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    fetchImpl:api([{body:{total_count:1,workflow_runs:[run(400,{head_branch:null})]}}])}),
  /unexpected row/);
  await assert.rejects(verifyCharacterMotorV4RunHistory({env:env(),fetchImpl:api([
    {scope:'filtered',body:body([run(400)])},
    {scope:'all',ok:false,body:{}},
  ])}),/API unavailable/);
});

test('hung Actions API request aborts within its short per-request deadline',async()=>{
  let aborted=false;
  await assert.rejects(readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    requestTimeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{
      // AbortSignal.timeout has an unreferenced timer. Keep this synthetic
      // request alive so an isolated test process can witness its abort.
      const fallback=setTimeout(()=>reject(Error('Mock request outlived its deadline')),1000);
      signal.addEventListener('abort',()=>{
        clearTimeout(fallback);aborted=true;reject(signal.reason);
      },{once:true});
    })}),/TimeoutError|timed out/i);
  assert.equal(aborted,true);
});

test('changing totals, duplicate IDs and missing later pages cannot hide prior runs',async()=>{
  const first=Array.from({length:100},(_,index)=>run(400+index));
  await assert.rejects(readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    fetchImpl:api([
      {body:{total_count:101,workflow_runs:first}},
      {body:{total_count:102,workflow_runs:[run(399)]}},
    ])}),/changed during pagination/);
  await assert.rejects(readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    fetchImpl:api([
      {body:{total_count:101,workflow_runs:first}},
      {body:{total_count:101,workflow_runs:[run(400)]}},
    ])}),/duplicate IDs/);
  await assert.rejects(readCharacterMotorV4RunHistory({token:'synthetic-read-token',
    fetchImpl:api([
      {body:{total_count:101,workflow_runs:first}},
      {body:{total_count:101,workflow_runs:[]}},
    ])}),/page is incomplete/);
});

test('wrong route, repository, attempt or missing token cannot reach the API',async()=>{
  for(const override of [
    {GITHUB_REPOSITORY:'other/repo'},
    {GITHUB_EVENT_NAME:'push'},
    {GITHUB_REF:'refs/heads/main'},
    {GITHUB_RUN_ATTEMPT:'2'},
    {GITHUB_TOKEN:''},
  ]){
    const candidate={...env(),...override};
    await assert.rejects(verifyCharacterMotorV4RunHistory({env:candidate,
      fetchImpl:async()=>{throw new Error('API must not be called');}}));
  }
});
