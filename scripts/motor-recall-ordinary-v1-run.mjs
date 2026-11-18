// New guarded pair: exact dual checkouts, sequential continuous processes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {MOTOR_RECALL_ORDINARY_V1 as P} from './motor-recall-ordinary-v1-protocol.mjs';
import {verifyMotorRecallRunHistory} from './motor-recall-ordinary-v1-activation-gate.mjs';
import {harnessManifest,harnessHash,childEnvironment} from './motor-recall-ordinary-v1-evidence.mjs';
import {sourceFingerprint} from './producer-retest-ci-source.mjs';
import {sha256} from './producer-retest-ci-namespace.mjs';
export function runChild(command,args,options){const r=spawnSync(command,args,{...options,encoding:'utf8',maxBuffer:8*1024*1024});return {code:r.status,signal:r.signal,error:r.error?String(r.error):null,stdout:r.stdout??'',stderr:r.stderr??''};}
export function verifyCheckout(root,commit,tree,run=runChild){
 const call=args=>run('git',args,{cwd:root,timeout:10000});
 const git=args=>{const r=call(args);assert.equal(r.code,0,'Git inspection failed');return r.stdout.trim();};
 assert.equal(git(['rev-parse','HEAD']),commit);const actualTree=git(['rev-parse','HEAD^{tree}']);assert.match(actualTree,/^[a-f0-9]{40}$/);if(tree)assert.equal(actualTree,tree);
 assert.equal(git(['status','--porcelain','--untracked-files=no']),'','Tracked checkout changed');
 const credentials=call(['config','--get-regexp','(^credential\\.|^http\\..*extraheader$|^url\\..*insteadof$)']);
 assert.ok(credentials.code===1&&credentials.stdout==='','Credential-bearing git configuration forbidden');
 const remote=git(['remote','get-url','origin']);assert.ok(remote==='https://github.com/kumori-i/aincrad'||remote==='https://github.com/kumori-i/aincrad.git','Unexpected or credential-bearing remote');
 return {commit,tree:actualTree};
}
export function executeMotorArms({root,baseline,out,cpu,harness,env,run=runChild}){
 const childEnv=childEnvironment(env);let initial;
 for(const mode of P.arms){
  const sourceRoot=mode==='baseline'?baseline:root,tag=resolve(out,`${mode}-${P.seed}`);
  const args=[process.execPath,resolve(root,'scripts/motor-recall-ordinary-v1-arm.mjs'),sourceRoot,root,tag,mode,P[mode+'Source'],harness,...(initial?[initial]:[])];
  const r=run('taskset',['-c',String(cpu),...args],{cwd:root,env:childEnv,timeout:24*60*1000,killSignal:'SIGTERM'});
  writeFileSync(tag+'.log',r.stdout+r.stderr,{flag:'wx'});assert.equal(r.code,0,`${mode} failed: ${r.error??r.signal??r.code}`);
  const result=JSON.parse(readFileSync(tag+'.json'));assert.equal(result.mode,mode);assert.equal(result.status,'completed');assert.match(result.initialComparableSha256??'',/^[a-f0-9]{64}$/);
  if(initial)assert.equal(result.initialComparableSha256,initial);initial=result.initialComparableSha256;
 }
 return childEnv;
}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--execute-once']);assert.equal(process.platform,'linux');assert.match(process.env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
 const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..')),baseline=realpathSync(resolve(root,'../baseline'));
 assert.notEqual(root,baseline);const out=resolve(root,'test-results/motor-recall-ordinary-v1');mkdirSync(out,{recursive:true});let phase='activation',expectedTree=null,expectedHarness=null;
 try{
  const activation=await verifyMotorRecallRunHistory();
  writeFileSync(resolve(out,'run.started.json'),JSON.stringify({protocol:P,activation,at:new Date().toISOString(),commit:process.env.GITHUB_SHA}),{flag:'wx'});
  phase='prepare';const candidateCheckout=verifyCheckout(root,process.env.GITHUB_SHA),baselineCheckout=verifyCheckout(baseline,P.baselineCommit,P.baselineTree);
  assert.equal(sourceFingerprint(root),P.candidateSource);assert.equal(sourceFingerprint(baseline),P.baselineSource);
  const evaluationFiles=harnessManifest(root),harnessSha256=harnessHash(root);expectedTree=candidateCheckout.tree;expectedHarness=harnessSha256;
  const cpu=readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(\d+)/m)?.[1];assert.ok(cpu);
  const manifest={protocol:P,activation,baseline:{...baselineCheckout,source:P.baselineSource},candidate:{...candidateCheckout,source:P.candidateSource},evaluationFiles,harnessSha256,host:{platform:process.platform,arch:process.arch,node:process.version,selectedCpu:Number(cpu),imageOS:process.env.ImageOS??null,imageVersion:process.env.ImageVersion??null}};
  writeFileSync(resolve(out,'source-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  phase='continuous-arms';const childEnv=executeMotorArms({root,baseline,out,cpu,harness:harnessSha256,env:process.env});
  phase='analysis';const r=runChild(process.execPath,[resolve(root,'scripts/motor-recall-ordinary-v1-analyze-files.mjs'),resolve(out,`baseline-${P.seed}`),resolve(out,`candidate-${P.seed}`),resolve(out,'source-manifest.json'),resolve(out,'analysis.json')],{cwd:root,env:childEnv,timeout:2*60*1000,killSignal:'SIGTERM'});
  writeFileSync(resolve(out,'analysis.log'),r.stdout+r.stderr,{flag:'wx'});assert.equal(r.code,0,'Integrity analysis failed');
  assert.equal(sourceFingerprint(root),P.candidateSource);assert.equal(sourceFingerprint(baseline),P.baselineSource);assert.equal(harnessHash(root),harnessSha256,'Harness changed');
  assert.deepEqual(verifyCheckout(root,candidateCheckout.commit,candidateCheckout.tree),candidateCheckout);assert.deepEqual(verifyCheckout(baseline,P.baselineCommit,P.baselineTree),baselineCheckout);
  writeFileSync(resolve(out,'run.completed.json'),JSON.stringify({protocol:P.id,status:'completed-pair-awaiting-independent-interpretation',at:new Date().toISOString()}),{flag:'wx'});
 }catch(error){writeFileSync(resolve(out,'run.failed.json'),JSON.stringify({phase,message:String(error?.stack||error),retryAllowed:false}),{flag:'wx'});throw error;}
 finally{
  let after;try{
   const candidate=verifyCheckout(root,process.env.GITHUB_SHA,expectedTree),prior=verifyCheckout(baseline,P.baselineCommit,P.baselineTree);
   const candidateSource=sourceFingerprint(root),baselineSource=sourceFingerprint(baseline),harness=harnessHash(root);
   assert.equal(candidateSource,P.candidateSource);assert.equal(baselineSource,P.baselineSource);if(expectedHarness)assert.equal(harness,expectedHarness);
   after={status:'verified',candidate:{...candidate,source:candidateSource},baseline:{...prior,source:baselineSource},harnessSha256:harness};
  }catch(error){after={status:'failed',message:String(error?.stack||error)};process.exitCode=1;}
  writeFileSync(resolve(out,'source-attestation.after.json'),JSON.stringify(after,null,2),{flag:'wx'});
  const files={};for(const name of readdirSync(out).sort())if(name!=='artifact-hashes.json')files[name]=sha256(readFileSync(resolve(out,name)));writeFileSync(resolve(out,'artifact-hashes.json'),JSON.stringify(files,null,2),{flag:'wx'});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
