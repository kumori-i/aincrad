/** User-run publication to the existing kumori-i/aincrad repository.
 * Uses a separate temporary checkout; never force-pushes, resets, or deletes a branch.
 * Stops if main has changed since the verified empty repository, preventing stale overwrite.
 */
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdir, copyFile, mkdtemp, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const REPO='kumori-i/aincrad';
const BASE='384adb2a4bc02bbdb5a4cb645817d965657885d9';
const TOP=['.gitattributes','.gitignore','.github','AGENTS.md','README.md','desktop','docs','icon.svg','index.html','package.json','package-lock.json','play.html','scripts','src','style.css','tests'];
let worktree;
function run(cmd,args,{cwd=ROOT,capture=false,allowFail=false}={}){
 const r=spawnSync(cmd,args,{cwd,encoding:'utf8',stdio:capture?'pipe':'inherit',windowsHide:true});
 if(r.error)throw new Error(`Could not run ${cmd}. Install it and ensure it is on PATH.`);
 if(r.status!==0&&!allowFail)throw new Error(`${cmd} failed (exit ${r.status}). No force push or automatic retry will occur.`);
 return r;
}
async function filesUnder(dir,prefix=''){
 const files=[];
 for(const name of await readdir(dir)){
  if(['__pycache__','node_modules','.git'].includes(name)||name.endsWith('.pyc'))continue;
  const rel=prefix?`${prefix}/${name}`:name,st=await lstat(join(dir,name));
  if(st.isSymbolicLink())throw new Error(`Refusing symbolic link: ${rel}`);
  if(st.isDirectory())files.push(...await filesUnder(join(dir,name),rel));
  else if(st.isFile())files.push(rel);
 }
 return files;
}
async function main(){
 const files=[];
 for(const item of TOP){
  const st=await lstat(join(ROOT,item));
  if(st.isSymbolicLink())throw new Error(`Refusing symbolic link: ${item}`);
  if(st.isDirectory())files.push(...await filesUnder(join(ROOT,item),item));
  else files.push(item);
 }
 console.log(`Aincrad: ${files.length} project files. Target: ${REPO}, branch main.`);
 run(process.execPath,['scripts/bundle.mjs']);
 run(process.execPath,['scripts/check.mjs']);
 if(process.argv.includes('--check-only')){console.log('Local checks passed. No GitHub action was attempted.');return;}
 const connectorIndex=process.argv.indexOf('--prepare-connector');
 if(connectorIndex>=0){
  const destination=process.argv[connectorIndex+1];
  if(!destination||destination.startsWith('--'))throw new Error('Use --prepare-connector followed by a local manifest path.');
  const head=run('git',['rev-parse','HEAD'],{capture:true,allowFail:true});
  const expected=head.status===0?head.stdout.trim():BASE;
  if(!/^[a-f0-9]{40}$/.test(expected))throw new Error('Could not resolve the source checkout baseline.');
  const prepared=[];
  for(const rel of files){
   const data=await readFile(join(ROOT,rel));
   const encoding=/\.(png|jpe?g|zip)$/i.test(rel)?'base64':'utf-8';
   const sha=createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
   prepared.push({path:rel,mode:'100644',sha,size_bytes:data.length,encoding,content:data.toString(encoding==='base64'?'base64':'utf8')});
  }
  await writeFile(resolve(destination),JSON.stringify({repository_full_name:REPO,branch_name:'main',expected_sha:expected,files:prepared}));
  console.log(`Prepared validated publication manifest: ${resolve(destination)}. No remote changes made.`);
  console.log('Verify push permission and the expected main SHA, then publish the complete tree and commit without force.');
  return;
 }
 run('git',['--version']);run('gh',['auth','status']);
 const login=run('gh',['api','user','--jq','.login'],{capture:true}).stdout.trim();
 if(login!=='kumori-i')throw new Error('Sign into the kumori-i GitHub account before publishing.');
 const repo=JSON.parse(run('gh',['api',`repos/${REPO}`],{capture:true}).stdout);
 if(repo.full_name!==REPO||repo.archived||repo.default_branch!=='main'||!repo.permissions?.push)
  throw new Error('The target repository is archived, not writable, or no longer uses main. Nothing was changed.');
 worktree=join(await mkdtemp(join(tmpdir(),'aincrad-publish-')),'checkout');
 console.log(`Temporary checkout (retained for recovery): ${worktree}`);
 run('gh',['repo','clone',REPO,worktree,'--','--single-branch','--branch','main']);
 const head=run('git',['rev-parse','HEAD'],{cwd:worktree,capture:true}).stdout.trim();
 if(head!==BASE){
  let identical=true;
  for(const rel of files){
   try{if(!(await readFile(join(ROOT,rel))).equals(await readFile(join(worktree,rel)))){identical=false;break;}}
   catch{identical=false;break;}
  }
  if(identical){console.log('These project files are already published. No changes made.');return;}
  throw new Error('main has newer changes than the initial README commit. Stopped before copying files; merge them manually in the retained checkout.');
 }
 for(const key of ['user.name','user.email']){
  const r=run('git',['config','--get',key],{cwd:worktree,capture:true,allowFail:true});
  if(r.status!==0||!r.stdout.trim())throw new Error(`Configure Git ${key} using your own identity, then rerun. No remote changes were made.`);
 }
 for(const rel of files){await mkdir(dirname(join(worktree,rel)),{recursive:true});await copyFile(join(ROOT,rel),join(worktree,rel));}
 run(process.execPath,['scripts/check.mjs'],{cwd:worktree});
 run('git',['add','--',...TOP],{cwd:worktree});
 run('git',['diff','--cached','--stat'],{cwd:worktree});
 run('git',['commit','-m','Publish Aincrad exploration prototype'],{cwd:worktree});
 // Explicit helper uses the existing gh session without changing global Git configuration.
 run('git',['-c','credential.helper=','-c','credential.helper=!gh auth git-credential','push','origin','HEAD:main'],{cwd:worktree});
 const commit=run('git',['rev-parse','HEAD'],{cwd:worktree,capture:true}).stdout.trim();
 const remote=run('gh',['api',`repos/${REPO}/git/ref/heads/main`,'--jq','.object.sha'],{capture:true}).stdout.trim();
 if(remote!==commit)throw new Error(`Push returned successfully, but main no longer equals ${commit}. Inspect the repository before retrying.`);
 console.log(`Published and verified: https://github.com/${REPO}/commit/${commit}`);
}
main().catch(e=>{console.error(`\n${e.message}`);if(worktree)console.error(`Recovery checkout retained at: ${worktree}`);process.exitCode=1;});
