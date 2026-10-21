import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, symlink, rm, readFile, realpath, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import {bootEntry,entryModuleFor} from '../src/entry.js';
const {resolveProfileRoute}=createRequire(import.meta.url)('../desktop/profile-route.cjs');
test('all launch URLs select one world module, never an old world or pilot',async()=>{
 for(const search of ['', '?test=1','?ozarkWorld=1','?test=1&ozarkPilot=1','?world=original']){
  assert.equal(entryModuleFor(search),'./ozark-world-main.js');
  assert.equal(await bootEntry(search,async p=>p),'./ozark-world-main.js');
 }
});
test('production routing is a single profile; retired routes fail closed',()=>{
 const input={isPackaged:false,defaultUserDataPath:join(tmpdir(),'ac-product-unread')};
 assert.deepEqual(resolveProfileRoute({...input,argv:[]}),{isTest:false,userDataPath:input.defaultUserDataPath});
 for(const argv of [['--test=1'],['--smoke-test=yes'],['--recovered-proof-v1'],['--test-ozark-pilot'],['--test-native-qa=x'],['--test'],['--test-profile=/tmp/x'],['--test','--test','--test-profile=/tmp/x']])assert.throws(()=>resolveProfileRoute({...input,argv}));
 assert.throws(()=>resolveProfileRoute({...input,isPackaged:true,argv:['--test','--test-profile=/tmp/x']}));
});
test('native QA profiles require temp containment, isolation and no symlink suffix',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ac-route-'));
 try{
  const product=join(root,'product'),profile=join(root,'qa');await mkdir(product);
  const base={isPackaged:false,defaultUserDataPath:product};
  assert.equal(resolveProfileRoute({...base,argv:['--test',`--test-profile=${profile}`]}).isTest,true);
  for(const target of [tmpdir(),product,join(product,'inside'),join(root,'..','..','outside')])assert.throws(()=>resolveProfileRoute({...base,argv:['--test',`--test-profile=${target}`]}));
  const link=join(root,'link');
  await symlink(product,link,'dir');assert.throws(()=>resolveProfileRoute({...base,argv:['--test',`--test-profile=${join(link,'child')}`]}),/symlink/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('desktop UI and sandbox expose no retired world selector or recovery-copy IPC',async()=>{
 const main=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
 const preload=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(main,/nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true/);
 for(const text of ['aincrad:world-open','aincrad:profile-create','createRecoveredProfileManager','runNativeProfileQa'])assert(!main.includes(text));
 assert(!preload.includes('aincradWorld'));assert(!preload.includes('aincradProfile'));
 assert(!html.includes('id="welcome"'));assert(!html.includes('id="pause-original"'));assert(html.includes('id="recovery-diagnosis"'));
 assert.match(main,/assetRoot=await realpath\(ROOT\)/);
});

test('product aliases and symlinked parents cannot make a real profile look disposable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ac-product-route-'));
 const outside=await mkdtemp(join(process.cwd(),'.profile-alias-test-'));
 try{
  const actual=join(root,'actual-product');await mkdir(actual);
  const direct=join(outside,'alias'),parent=join(outside,'parent');
  await symlink(actual,direct,'dir');await symlink(root,parent,'dir');
  for(const product of [direct,join(parent,'actual-product')])for(const target of [actual,join(actual,'child'),root])
   assert.throws(()=>resolveProfileRoute({argv:['--test',`--test-profile=${target}`],isPackaged:false,defaultUserDataPath:product}),/separate/);
 }finally{await rm(outside,{recursive:true,force:true});await rm(root,{recursive:true,force:true});}
});

// Run with an isolated TMPDIR so the host's own alias policy is exercised
// without mutating the parent process environment or using the real profile.
test('OS temporary root alias and canonical spelling are both confined',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ac-temp-alias-'));
 try{
  const actual=join(root,'actual'),alias=join(root,'alias');await mkdir(actual);await symlink(actual,alias,'dir');
  const modulePath=fileURLToPath(new URL('../desktop/profile-route.cjs',import.meta.url));
  const child=spawnSync(process.execPath,['-e',`
   const assert=require('node:assert/strict');
   const {resolveProfileRoute}=require(${JSON.stringify(modulePath)});
   const actual=${JSON.stringify(await realpath(actual))},alias=${JSON.stringify(alias)};
   const run=(value,product=actual+'/product')=>resolveProfileRoute({argv:['--test','--test-profile='+value],isPackaged:false,defaultUserDataPath:product});
   assert.equal(run(alias+'/qa').userDataPath,actual+'/qa');
   assert.equal(run(actual+'/qa').userDataPath,actual+'/qa');
   for(const value of [actual,alias,actual+'/product/child'])assert.throws(()=>run(value));
   require('node:fs').symlinkSync(actual,actual+'/suffix','dir');
   assert.throws(()=>run(actual+'/suffix/qa'),/symlink/);
   assert.throws(()=>run(alias+'/suffix/qa'),/symlink/);
  `],{env:{...process.env,TMPDIR:alias},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('product-profile overlap uses actual filesystem case, without lowercasing Unix paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ac-case-'));
 try{
  const product=join(root,'Product');await mkdir(product);
  const alternate=join(root,'product');
  const same=await stat(alternate).then(a=>stat(product).then(b=>a.ino===b.ino&&a.dev===b.dev)).catch(error=>{if(error.code==='ENOENT')return false;throw error;});
  const run=()=>resolveProfileRoute({argv:['--test','--test-profile='+join(alternate,'qa')],isPackaged:false,defaultUserDataPath:product});
  if(same)assert.throws(run,/separate/);
  else assert.equal(run().isTest,true,'Distinct case-sensitive Unix directories must remain distinct');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('case-preserving realpath cannot hide existing filesystem-identity overlap',async()=>{
 const source=await readFile(new URL('../desktop/profile-route.cjs',import.meta.url),'utf8');
 const nodes=new Map([['/',1],['/tmp',2],['/tmp/product',3],['/tmp/product/deeper',4],['/tmp/other',5]]);
 const stat=p=>{const ino=nodes.get(p.toLowerCase());if(!ino)throw Object.assign(new Error('absent'),{code:'ENOENT'});return {ino,dev:1,isSymbolicLink:()=>false};};
 const fs={existsSync:p=>nodes.has(p.toLowerCase()),lstatSync:stat,statSync:stat,realpathSync:p=>p};
 const module={exports:{}};
 runInNewContext(source,{module,require:name=>name==='node:fs'?fs:name==='node:os'?{tmpdir:()=>'/tmp'}:path});
 const run=(profile,product)=>module.exports.resolveProfileRoute({argv:['--test','--test-profile='+profile],isPackaged:false,defaultUserDataPath:product});
 for(const [profile,product] of [['/tmp/product/new','/tmp/Product'],['/tmp/PRODUCT','/tmp/product/deeper']])
  assert.throws(()=>run(profile,product),/separate/);
 assert.equal(run('/tmp/other/new','/tmp/Product').isTest,true);
});
