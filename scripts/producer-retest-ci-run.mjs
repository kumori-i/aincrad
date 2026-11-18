// Two continuous isolated arms in one durable CI job. Never save/reload-resume.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PRODUCER_RETEST_CI_PROTOCOL as P} from './producer-retest-ci-protocol.mjs';
import {verifyProducerRetestRunHistory} from './producer-retest-ci-activation-gate.mjs';
import {extractBaseline,sourceFingerprint} from './producer-retest-ci-source.mjs';
import {sha256} from './producer-retest-ci-namespace.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function runChild(command,args,options){const r=spawnSync(command,args,{...options,encoding:'utf8',maxBuffer:8*1024*1024});return {code:r.status,signal:r.signal,error:r.error?String(r.error):null,stdout:r.stdout??'',stderr:r.stderr??''};}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--execute-once']);assert.equal(process.platform,'linux');assert.match(process.env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
 const out=resolve(root,'test-results/producer-retest-ci-v1');mkdirSync(out,{recursive:true});
 let phase='activation';
 try{
  const activation=await verifyProducerRetestRunHistory();
  writeFileSync(resolve(out,'run.started.json'),JSON.stringify({protocol:P,...activation,at:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,commit:process.env.GITHUB_SHA}),{flag:'wx'});
  phase='prepare';
  assert.equal(sourceFingerprint(root),P.candidateSource,'Candidate runtime changed');
  const baseline=extractBaseline(readFileSync(resolve(root,'tests/fixtures/producer-retest-baseline-v1.json.gz')),out);
  const evaluationFiles={};for(const f of ['producer-retest-ci-arm.mjs','producer-retest-ci-analyze.mjs','producer-retest-ci-source.mjs','producer-retest-ci-namespace.mjs','producer-retest-ci-protocol.mjs','producer-retest-ci-activation-gate.mjs','producer-retest-ci-run.mjs','producer-retest-ci-v1-protocol.md'])evaluationFiles[f]=sha256(readFileSync(resolve(root,'scripts',f)));
  const workflowSha256=sha256(readFileSync(resolve(root,'.github/workflows',P.workflowFile)));
  const cpu=readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(\d+)/m)?.[1];assert.ok(cpu,'Cannot select allowed single CPU');
  const manifest={host:{platform:process.platform,arch:process.arch,node:process.version,selectedCpu:Number(cpu),imageOS:process.env.ImageOS??null,imageVersion:process.env.ImageVersion??null},workflowSha256,baseline:{root:baseline,commit:P.baselineCommit,sha256:P.baselineSource},candidate:{root,commit:process.env.GITHUB_SHA,sha256:P.candidateSource},evaluationFiles,protocol:P,activation,node:process.version};
  writeFileSync(resolve(out,'source-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});

  const childEnv={...process.env};delete childEnv.GITHUB_TOKEN;
  let initial;
  for(const [arm,path,source]of[['baseline',baseline,P.baselineSource],['candidate',root,P.candidateSource]]){
   phase=arm;const tag=resolve(out,`${arm}-${P.seed}`),args=[process.execPath,resolve(root,'scripts/producer-retest-ci-arm.mjs'),path,tag,String(P.seed),source,...(initial?[initial]:[])];
   const r=runChild('taskset',['-c',cpu,...args],{cwd:root,env:childEnv,timeout:24*60*1000,killSignal:'SIGTERM'});writeFileSync(tag+'.log',r.stdout+r.stderr,{flag:'wx'});assert.equal(r.code,0,`${arm} failed: ${r.error??r.signal??r.code}`);
   const result=JSON.parse(readFileSync(tag+'.json'));assert.equal(result.status,'completed');initial=result.initialStateSha256;
  }
  phase='analysis';const r=runChild(process.execPath,[resolve(root,'scripts/producer-retest-ci-analyze.mjs'),resolve(out,`baseline-${P.seed}.json`),resolve(out,`candidate-${P.seed}.json`),resolve(out,'source-manifest.json'),resolve(out,'analysis.json')],{cwd:root,env:childEnv,timeout:2*60*1000,killSignal:'SIGTERM'});writeFileSync(resolve(out,'analysis.log'),r.stdout+r.stderr,{flag:'wx'});assert.equal(r.code,0,'Integrity analysis failed');
  assert.equal(sourceFingerprint(root),P.candidateSource);assert.equal(sourceFingerprint(baseline),P.baselineSource);
  for(const[f,h]of Object.entries(evaluationFiles))assert.equal(sha256(readFileSync(resolve(root,'scripts',f))),h,'Evaluation source changed');
  assert.equal(sha256(readFileSync(resolve(root,'.github/workflows',P.workflowFile))),workflowSha256);
  writeFileSync(resolve(out,'run.completed.json'),JSON.stringify({protocol:P.id,status:'completed-pair-awaiting-independent-interpretation',at:new Date().toISOString()}),{flag:'wx'});
 }catch(error){writeFileSync(resolve(out,'run.failed.json'),JSON.stringify({phase,message:String(error?.stack||error),retryAllowed:false}),{flag:'wx'});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
