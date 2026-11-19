import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PROTOCOL as P,frozenArm,activationEnvironment,childEnvironment} from './protocol.mjs';
import {verifyRevisitRunHistory} from './activation-gate.mjs';
import {instrumentCopy,sha256} from './source.mjs';
const write=(p,data)=>writeFileSync(p,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
export function checkedGit(root,head,tree){
 const git=(...args)=>execFileSync('git',args,{cwd:root,timeout:10000,encoding:'utf8'}).trim();
 assert.equal(git('rev-parse','HEAD'),head);
 if(tree)assert.equal(git('rev-parse','HEAD^{tree}'),tree);
 assert.equal(git('status','--porcelain','--untracked-files=no'),'');
 const origin=git('remote','get-url','origin');
 assert(/^https:\/\/github\.com\/kumori-i\/aincrad(?:\.git)?$/.test(origin));
 const creds=spawnSync('git',['config','--get-regexp','(^credential\\.|^http\\..*extraheader$|^url\\..*insteadof$)'],{cwd:root,timeout:10000,encoding:'utf8'});
 assert.equal(creds.status,1);assert.equal(creds.stdout,'');
}
function inventory(root,prefix=''){
 return Object.fromEntries(readdirSync(resolve(root,prefix)).sort().flatMap(name=>{
  const p=prefix?prefix+'/'+name:name;if(p==='artifact-hashes.json')return [];
  const path=resolve(root,p),stat=lstatSync(path);if(stat.isDirectory())return Object.entries(inventory(root,p));
  assert(stat.isFile()&&stat.size<=256*2**20);return [[p,{bytes:stat.size,sha256:sha256(readFileSync(path))}]];
 }));
}
async function main(){
 const [, ,flag,pairText]=process.argv;assert.equal(process.argv.length,4);assert.equal(flag,'--execute-once');assert.match(pairText,/^[01]$/);
 const pair=Number(pairText);frozenArm(pair,'baseline');activationEnvironment(process.env);
 assert.equal(process.platform,'linux');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(root,'test-results',P.id,'pair-'+pair);
 mkdirSync(dirname(out),{recursive:true});mkdirSync(out);
 let phase='activation';
 try{
  const history=await verifyRevisitRunHistory();
  checkedGit(root,process.env.GITHUB_SHA);
  const cpu=readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(\d+)/m)?.[1];assert(cpu);
  write(resolve(out,'run.started.json'),{protocol:P.id,pair,history,activationHead:process.env.GITHUB_SHA,host:{cpu,node:process.version,arch:process.arch}});
  phase='continuous-arms';let initial=null;
  for(const arm of ['baseline','candidate']){
   const expected=frozenArm(pair,arm),pristine=resolve(root,'..',arm),overlay=resolve(root,'..','revisit-instrumented-'+arm),armOut=resolve(out,arm);
   checkedGit(pristine,expected.commit,expected.tree);
   mkdirSync(overlay);
   const bytes=execFileSync('git',['-C',pristine,'archive',expected.commit],{maxBuffer:2**26,timeout:30000});
   execFileSync('tar',['-x','-C',overlay],{input:bytes,timeout:30000});
   const source=instrumentCopy({repo:pristine,root:overlay,commit:expected.commit,candidate:arm==='candidate'});
   assert.equal(sha256(JSON.stringify(source)),expected.sourceSha256);
   assert.equal(sha256(JSON.stringify(source.harness)),expected.harnessSha256);
   const path=resolve(out,arm+'.source.json');write(path,source);
   const args=['-c',cpu,process.execPath,resolve(root,'scripts/revisit-observer/arm.mjs'),overlay,armOut,path,String(pair),arm,...(initial?[initial]:[])];
   const child=spawnSync('taskset',args,{env:childEnvironment(process.env),timeout:P.armTimeoutMs,killSignal:'SIGTERM',maxBuffer:2**21,encoding:'utf8'});
   writeFileSync(resolve(out,arm+'.log'),(child.stdout??'')+(child.stderr??''),{flag:'wx'});
   assert.equal(child.status,0,String(child.error??child.signal??'arm failed'));
   const result=JSON.parse(readFileSync(resolve(armOut,'arm.json')));
   assert.equal(result.complete,true);assert.equal(result.arm,arm);assert.equal(result.seed,expected.seed);assert.equal(result.steps,expected.steps);
   assert.match(result.initialComparableSha256,/^[0-9a-f]{64}$/);
   if(initial)assert.equal(result.initialComparableSha256,initial);else initial=result.initialComparableSha256;
   checkedGit(pristine,expected.commit,expected.tree);
  }
  phase='offline-integrity';
  const child=spawnSync(process.execPath,['--max-old-space-size=4096',resolve(root,'scripts/revisit-observer/analyze-files.mjs'),out,String(pair)],{env:childEnvironment(process.env),timeout:3*60*1000,maxBuffer:2**21,encoding:'utf8'});
  writeFileSync(resolve(out,'analysis.log'),(child.stdout??'')+(child.stderr??''),{flag:'wx'});
  assert.equal(child.status,0,String(child.error??child.signal??'analysis failed'));
  checkedGit(root,process.env.GITHUB_SHA);
  write(resolve(out,'run.completed.json'),{protocol:P.id,status:'integrity-passed-awaiting-independent-interpretation',pair});
 }catch(e){write(resolve(out,'run.failed.json'),{phase,message:String(e?.stack??e),retryAllowed:false});throw e;}
 finally{write(resolve(out,'artifact-hashes.json'),inventory(out));}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
