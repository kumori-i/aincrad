// Dedicated single-activation coordinator; continuous arms, never reload/resume.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {CHOICE_DIAGNOSTIC_V2 as P} from './choice-diagnostic-v2-protocol.mjs';
import {verifyChoiceDiagnosticRunHistory} from './choice-diagnostic-v2-activation-gate.mjs';
import {harnessManifest,harnessHash} from './choice-diagnostic-v2-evidence.mjs';
import {sourceFingerprint} from './producer-retest-ci-source.mjs';
import {sha256} from './producer-retest-ci-namespace.mjs';
export function runChild(command,args,options){const r=spawnSync(command,args,{...options,encoding:'utf8',maxBuffer:8*1024*1024});return {code:r.status,signal:r.signal,error:r.error?String(r.error):null,stdout:r.stdout??'',stderr:r.stderr??''};}
export function executeChoiceArms({root,out,cpu,harness,env,run=runChild}){
 const childEnv={...env};delete childEnv.GITHUB_TOKEN;let initial;
 for(const mode of P.arms){
  const tag=resolve(out,`${mode}-${P.seed}`),args=[process.execPath,resolve(root,'scripts/choice-diagnostic-v2-arm.mjs'),root,tag,mode,P.runtimeSource,harness,...(initial?[initial]:[])];
  const r=run('taskset',['-c',String(cpu),...args],{cwd:root,env:childEnv,timeout:24*60*1000,killSignal:'SIGTERM'});
  writeFileSync(tag+'.log',r.stdout+r.stderr,{flag:'wx'});assert.equal(r.code,0,`${mode} failed: ${r.error??r.signal??r.code}`);
  const result=JSON.parse(readFileSync(tag+'.json'));assert.equal(result.mode,mode);assert.equal(result.status,'completed');assert.match(result.initialComparableSha256??'',/^[a-f0-9]{64}$/);
  if(initial)assert.equal(result.initialComparableSha256,initial);initial=result.initialComparableSha256;
 }
 return childEnv;
}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--execute-once']);assert.equal(process.platform,'linux');assert.match(process.env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(root,'test-results/choice-diagnostic-v2');mkdirSync(out,{recursive:true});
 let phase='activation';
 try{
  const activation=await verifyChoiceDiagnosticRunHistory();
  writeFileSync(resolve(out,'run.started.json'),JSON.stringify({protocol:P,activation,at:new Date().toISOString(),commit:process.env.GITHUB_SHA}),{flag:'wx'});
  phase='prepare';
  const git=args=>{const r=runChild('git',args,{cwd:root,timeout:10000});assert.equal(r.code,0);return r.stdout.trim();};
  assert.equal(git(['rev-parse','HEAD']),process.env.GITHUB_SHA);assert.equal(git(['status','--porcelain','--untracked-files=no']),'');
  assert.equal(sourceFingerprint(root),P.runtimeSource);const evaluationFiles=harnessManifest(root),harnessSha256=harnessHash(root);
  const cpu=readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(\d+)/m)?.[1];assert.ok(cpu);
  const manifest={protocol:P,activation,commit:process.env.GITHUB_SHA,tree:git(['rev-parse','HEAD^{tree}']),source:P.runtimeSource,evaluationFiles,harnessSha256,host:{platform:process.platform,arch:process.arch,node:process.version,selectedCpu:Number(cpu),imageOS:process.env.ImageOS??null,imageVersion:process.env.ImageVersion??null}};
  writeFileSync(resolve(out,'source-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  phase='continuous-arms';const childEnv=executeChoiceArms({root,out,cpu,harness:harnessSha256,env:process.env});
  phase='analysis';const r=runChild(process.execPath,[resolve(root,'scripts/choice-diagnostic-v2-analyze-files.mjs'),resolve(out,`off-${P.seed}`),resolve(out,`on-${P.seed}`),resolve(out,'source-manifest.json'),resolve(out,'analysis.json')],{cwd:root,env:childEnv,timeout:2*60*1000,killSignal:'SIGTERM'});
  writeFileSync(resolve(out,'analysis.log'),r.stdout+r.stderr,{flag:'wx'});assert.equal(r.code,0,'Parity or integrity analysis failed');
  assert.equal(sourceFingerprint(root),P.runtimeSource);assert.equal(harnessHash(root),harnessSha256,'Harness changed');
  assert.equal(git(['rev-parse','HEAD']),manifest.commit);assert.equal(git(['status','--porcelain','--untracked-files=no']),'');
  writeFileSync(resolve(out,'run.completed.json'),JSON.stringify({protocol:P.id,status:'completed-parity-awaiting-independent-interpretation',at:new Date().toISOString()}),{flag:'wx'});
 }catch(error){writeFileSync(resolve(out,'run.failed.json'),JSON.stringify({phase,message:String(error?.stack||error),retryAllowed:false}),{flag:'wx'});throw error;}
 finally{
  // Also hash partial evidence after a child timeout. No claim of completeness.
  const files={};for(const name of readdirSync(out).sort())if(!name.includes('/')&&name!=='artifact-hashes.json')files[name]=sha256(readFileSync(resolve(out,name)));
  writeFileSync(resolve(out,'artifact-hashes.json'),JSON.stringify(files,null,2),{flag:'wx'});
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
