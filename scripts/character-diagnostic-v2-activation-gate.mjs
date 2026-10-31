/** Read-only, fail-closed history guard for the separate v2 diagnostic.
 * A branch delete/recreate has a new run ID; attempt 1 alone is insufficient. */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P} from './character-ordinary-diagnostic-v2-protocol.mjs';

export const CHARACTER_PILOT_WORKFLOW_FILE='character-ordinary-diagnostic-v2-once.yml';
const REPOSITORY='kumori-i/aincrad';
const PAGE_SIZE=100;
const MAX_RESULTS=1000;
const delay=ms=>new Promise(done=>setTimeout(done,ms));

function requiredEnvironment(env){
  assert.equal(env.GITHUB_ACTIONS,'true');
  assert.equal(env.GITHUB_REPOSITORY,REPOSITORY);
  assert.equal(env.GITHUB_WORKFLOW,P.workflow);
  assert.equal(env.GITHUB_EVENT_NAME,'create');
  assert.equal(env.GITHUB_REF,'refs/heads/'+P.activationRef);
  assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
  assert.match(env.GITHUB_RUN_ID||'',/^[1-9][0-9]*$/);
  assert(typeof env.GITHUB_TOKEN==='string'&&env.GITHUB_TOKEN.length>0,
    'Read-only Actions API token required');
  return env.GITHUB_RUN_ID;
}

async function fetchHistoryPage({token,page,branch,fetchImpl,requestTimeoutMs}){
  const url=new URL('https://api.github.com/repos/'+REPOSITORY+
    '/actions/workflows/'+CHARACTER_PILOT_WORKFLOW_FILE+'/runs');
  url.searchParams.set('event','create');
  if(branch!==null)url.searchParams.set('branch',branch);
  url.searchParams.set('per_page',String(PAGE_SIZE));
  url.searchParams.set('page',String(page));
  const response=await fetchImpl(url.toString(),{headers:{
    Accept:'application/vnd.github+json',
    Authorization:'Bearer '+token,
    'X-GitHub-Api-Version':'2022-11-28',
  },signal:AbortSignal.timeout(requestTimeoutMs)});
  assert.equal(response?.ok,true,'Pilot run history API unavailable');
  const body=await response.json();
  assert(body&&typeof body==='object'&&!Array.isArray(body),
    'Pilot run history response is malformed');
  assert(Number.isSafeInteger(body.total_count)&&body.total_count>=0&&
    body.total_count<=MAX_RESULTS,'Pilot run history is incomplete or over cap');
  assert(Array.isArray(body.workflow_runs),'Pilot run history rows are missing');
  return body;
}

/** Fetch every reported page. An incomplete response, changing total,
 * duplicate ID or unknown branch is a hard failure. */
async function readHistory({token,fetchImpl,branch,requestTimeoutMs}){
  assert(typeof token==='string'&&token.length>0,'Actions API token required');
  assert.equal(typeof fetchImpl,'function');
  assert(Number.isSafeInteger(requestTimeoutMs)&&requestTimeoutMs>=1&&requestTimeoutMs<=10000);
  let total=null;
  const rows=[];
  for(let page=1;;page++){
    const body=await fetchHistoryPage({token,page,branch,fetchImpl,requestTimeoutMs});
    if(total===null)total=body.total_count;
    assert.equal(body.total_count,total,'Pilot run history changed during pagination');
    const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
    assert(page<=pages,'Pilot run history pagination overflow');
    const expected=Math.min(PAGE_SIZE,Math.max(0,total-(page-1)*PAGE_SIZE));
    assert.equal(body.workflow_runs.length,expected,'Pilot run history page is incomplete');
    for(const run of body.workflow_runs){
      assert(run&&Number.isSafeInteger(run.id)&&run.id>0&&
        run.event==='create'&&typeof run.head_branch==='string'&&
        run.head_branch.length>0&&
        (branch===null||run.head_branch===branch),
      'Pilot run history contains an unexpected row');
      rows.push({id:String(run.id),branch:run.head_branch});
    }
    if(page===pages)break;
  }
  assert.equal(rows.length,total,'Pilot run history is incomplete');
  assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,
    'Pilot run history contains duplicate IDs');
  return rows;
}

export async function readCharacterPilotRunHistory({token,fetchImpl=fetch,requestTimeoutMs=10000}={}){
  return (await readHistory({token,fetchImpl,branch:P.activationRef,requestTimeoutMs}))
    .map(row=>row.id);
}

/** Compare the branch-filtered view with the entire dedicated workflow's
 * create history. This catches a deleted branch omitted by the branch filter.
 * Poll only while both complete views contain no ID other than the current
 * run; sequential queries may briefly index that first run at different times. */
export async function verifyCharacterPilotRunHistory({env=process.env,fetchImpl=fetch,
  sleep=delay,maxIndexPolls=10,indexPollMs=2000,requestTimeoutMs=10000}={}){
  const current=requiredEnvironment(env);
  assert(Number.isSafeInteger(maxIndexPolls)&&maxIndexPolls>=1&&maxIndexPolls<=10);
  assert(Number.isSafeInteger(indexPollMs)&&indexPollMs>=0&&indexPollMs<=2000);
  for(let attempt=0;attempt<maxIndexPolls;attempt++){
    const filtered=await readCharacterPilotRunHistory({token:env.GITHUB_TOKEN,fetchImpl,
      requestTimeoutMs});
    const all=await readHistory({token:env.GITHUB_TOKEN,fetchImpl,branch:null,
      requestTimeoutMs});
    const unfiltered=all.filter(row=>row.branch===P.activationRef).map(row=>row.id);
    const union=new Set([...filtered,...unfiltered]);
    if(union.size>1||union.size===1&&!union.has(current))
      throw new Error('Pilot activation already has another create run');
    if(filtered.length===1&&filtered[0]===current&&
        unfiltered.length===1&&unfiltered[0]===current)
      return {verified:true,runId:current,matchingCreateRuns:1};
    if(attempt+1<maxIndexPolls)await sleep(indexPollMs);
  }
  throw new Error('Current pilot create run was not consistently indexed within the bound');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await verifyCharacterPilotRunHistory();
  process.stdout.write(JSON.stringify(result)+'\n');
}
