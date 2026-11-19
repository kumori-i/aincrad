import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,lstatSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {commonHooks,candidateHooks} from './patch.mjs';
export const sha256=b=>createHash('sha256').update(b).digest('hex');
const observerPath='src/revisit-research-observer.js';
const tools=['patch','observer','analyze','journal','coverage','arm-collector','source','arm-evidence','parity','parity-fixture','verify-archive','activation-gate','initial','arm','save','run','analyze-files'];
export function harnessHashes(){
 return Object.fromEntries([...tools.map(x=>[x,sha256(readFileSync(new URL('./'+x+'.mjs',import.meta.url)))]),['workflow',sha256(readFileSync(new URL('../../.github/workflows/voluntary-revisit-ordinary-v1-once.yml',import.meta.url)))],['contracts',sha256(readFileSync(new URL('../../tests/revisit-observer-design.test.mjs',import.meta.url)))]]);
}
function tree(repo,commit){
 assert.match(commit,/^[a-f0-9]{40}$/);
 const git=(...a)=>execFileSync('git',['-C',repo,...a],{maxBuffer:2**24});
 assert.equal(git('rev-parse',commit).toString().trim(),commit);
 const oid=git('rev-parse',commit+'^{tree}').toString().trim();
 return {commit,tree:oid,files:Object.fromEntries(git('ls-tree','-rz',oid).toString().split('\0').filter(Boolean).map(row=>{
  const sep=row.indexOf('\t'),[mode,kind,blob]=row.slice(0,sep).split(' '),path=row.slice(sep+1);
  assert(kind==='blob'&&/^100(?:644|755)$/.test(mode)&&path&&!path.split('/').includes('..'));
  return [path,{mode,sha256:sha256(git('cat-file','blob',blob))}];
 }))};
}
function attest(root,expected){
 for(const [file,v] of Object.entries(expected)){
  const path=resolve(root,file);const info=lstatSync(path);
  assert(info.isFile()&&Boolean(info.mode&0o111)===(v.mode==='100755'),'source mode differs: '+file);
  assert.equal(sha256(readFileSync(path)),v.sha256,'source bytes differ: '+file);
 }
 const actual=readdirSync(resolve(root,'src'),{recursive:true,withFileTypes:true}).filter(e=>!e.isDirectory()).map(e=>resolve(e.parentPath,e.name).slice(resolve(root).length+1)).sort();
 assert.deepEqual(actual,Object.keys(expected).filter(f=>f.startsWith('src/')).sort(),'unattested runtime tree entry');

}
export function instrumentCopy({repo,root,commit,candidate}){
 const pristine=tree(repo,commit);
 assert(!existsSync(resolve(root,observerPath)));
 attest(root,pristine.files);
 const read=file=>readFileSync(resolve(root,file),'utf8');
 const common=commonHooks({npc:read('src/npc.js'),actions:read('src/discovery-actions.js')});
 const patch={'src/npc.js':common.npc,'src/discovery-actions.js':common.actions};
 if(candidate){
  const extra=candidateHooks({npc:common.npc,revisit:read('src/voluntary-revisit.js')});
  patch['src/npc.js']=extra.npc;patch['src/voluntary-revisit.js']=extra.revisit;
 }
 patch[observerPath]=readFileSync(new URL('./observer.mjs',import.meta.url));
 const expected=structuredClone(pristine.files);
 for(const [file,bytes] of Object.entries(patch)){
  writeFileSync(resolve(root,file),bytes,{flag:file===observerPath?'wx':'w'});
  expected[file]={mode:pristine.files[file]?.mode??'100644',sha256:sha256(bytes)};
 }
 attest(root,expected);
 return {pristine,expected,overlay:Object.keys(patch).sort(),harness:harnessHashes()};
}
export function verifyInstrumentedCopy(root,manifest){
 attest(root,manifest.expected);
 assert.deepEqual(harnessHashes(),manifest.harness,'harness closure changed');
}
