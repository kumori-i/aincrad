import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, symlink, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
  try{await symlink(product,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>resolveProfileRoute({...base,argv:['--test',`--test-profile=${join(link,'child')}`]}),/symlink/);}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;}
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
  try{await symlink(actual,direct,process.platform==='win32'?'junction':'dir');await symlink(root,parent,process.platform==='win32'?'junction':'dir');}
  catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e;}
  for(const product of [direct,join(parent,'actual-product')])for(const target of [actual,join(actual,'child'),root])
   assert.throws(()=>resolveProfileRoute({argv:['--test',`--test-profile=${target}`],isPackaged:false,defaultUserDataPath:product}),/separate/);
 }finally{await rm(outside,{recursive:true,force:true});await rm(root,{recursive:true,force:true});}
});
