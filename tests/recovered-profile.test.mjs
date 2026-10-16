import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import profile from '../desktop/recovered-profile.cjs';

const {COPY_FLAG,STAGE,RESERVATION,MANIFEST,assertCopyDirectory}=profile;
// Windows capability tests exercise refusal with platform:'win32'. The six
// filesystem copy cases below run only where that flow is supported.
const resolveProfileRoute=inputs=>profile.resolveProfileRoute({...inputs,platform:'linux'});
const createRecoveredProfileManager=inputs=>profile.createRecoveredProfileManager({...inputs,platform:'linux'});
const supportedCopyOnly={skip:process.platform==='win32'&&
  'Recovered-copy creation and opening are unavailable on Windows; this filesystem flow is tested on macOS/Linux.'};
const raw=JSON.stringify({version:8,features:{plantLifecycle:1},world:'archived 🫧'});
const hash=value=>createHash('sha256').update(Buffer.from(value,'utf8')).digest('hex');

async function roots(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aincrad-profile-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const appData=path.join(root,'appData'),original=path.join(appData,'Aincrad'),copy=path.join(appData,'Recovered');
  await fs.mkdir(original,{recursive:true});
  return {root,appData,original,copy,originalManager:createRecoveredProfileManager({kind:'original',originalPath:original,copyPath:copy})};
}

test('fixed production route keeps default unchanged and test flags never route to product profiles',async t=>{
  const f=await roots(t),defaultRoute=resolveProfileRoute({argv:['electron','app'],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original});
  assert.equal(defaultRoute.kind,'original');assert.equal(defaultRoute.userDataPath,f.original);
  assert.equal(defaultRoute.copyPath,path.join(f.appData,'Aincrad-Recovered-Proof-v1'));
  const testOriginal=path.join(f.root,'test-original');
  const isolated=resolveProfileRoute({argv:['electron','app','--test',`--test-profile=${testOriginal}`],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original});
  // Windows may spell the same temp parent using an 8.3 alias or its long name.
  // Check the parent's real identity and the exact sibling route relationship.
  assert.equal(await fs.realpath(path.dirname(isolated.originalPath)),await fs.realpath(f.root));
  assert.equal(path.basename(isolated.originalPath),'test-original');
  assert.equal(isolated.copyPath,path.join(path.dirname(isolated.originalPath),'test-original-recovered-proof-v1'));
  assert(!isolated.copyPath.startsWith(f.appData+path.sep));
  const testCopy=path.join(f.root,'test-recovered');
  const selected=resolveProfileRoute({argv:['electron','app','--test',`--test-profile=${testOriginal}`,
    `--test-recovered-root=${testCopy}`,COPY_FLAG],isPackaged:false,appDataPath:f.appData,defaultUserDataPath:f.original});
  assert.equal(selected.kind,'recovered');assert.equal(selected.originalPath,isolated.originalPath);
  assert.equal(selected.userDataPath,path.join(path.dirname(isolated.originalPath),'test-recovered'));
  assert.equal(selected.sessionDataPath,selected.userDataPath);
  assert.throws(()=>resolveProfileRoute({argv:['electron','app','--test',`--test-profile=${f.original}`],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original}),/separate from product/);
  assert.throws(()=>resolveProfileRoute({argv:['electron','app','--test',`--test-profile=${testOriginal}`,
    `--test-recovered-root=${f.copy}`],isPackaged:false,appDataPath:f.appData,defaultUserDataPath:f.original}),/share one disposable parent/);
  assert.throws(()=>resolveProfileRoute({argv:['electron','app','--test',`--test-profile=${path.join(f.appData,'test')}`,
    `--test-recovered-root=${path.join(f.appData,'Aincrad-Recovered-Proof-v1')}`],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original}),/separate from product/);
  assert.throws(()=>resolveProfileRoute({argv:['electron','app','--test','--test-profile=/Users/example/profile'],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original}),/temporary directory/);
  const alias=path.join(f.root,'alias');await fs.symlink(f.appData,alias,'dir');
  assert.throws(()=>resolveProfileRoute({argv:['electron','app','--test',`--test-profile=${path.join(alias,'child')}`],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original}),/symlink/);
  assert.throws(()=>resolveProfileRoute({argv:['electron','app','--test'],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original}),/needs an isolated/);
  assert.throws(()=>resolveProfileRoute({argv:['electron','app',`--test-profile=${testOriginal}`],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original}),/unavailable/);
  assert.throws(()=>resolveProfileRoute({argv:['electron','app','--test',`--test-profile=${testOriginal}`],isPackaged:true,
    appDataPath:f.appData,defaultUserDataPath:f.original}),/packaged/);
  assert.throws(()=>resolveProfileRoute({argv:['electron','app','--recovered-proof-other'],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original}),/Unknown/);
  assert.throws(()=>resolveProfileRoute({argv:['electron','app',COPY_FLAG,'--smoke-test'],isPackaged:false,
    appDataPath:f.appData,defaultUserDataPath:f.original}),/Smoke/);
});

test('verified source creates a pending copy once; same hash reopens and divergent backup cannot replace it',supportedCopyOnly,async t=>{
  const f=await roots(t),initial=await f.originalManager.status();
  assert.deepEqual({phase:initial.phase,available:initial.available},{phase:'none',available:false});
  const made=await f.originalManager.create(raw,hash(raw));
  assert.equal(made.phase,'pending');assert.equal(made.sourceSha256,hash(raw));
  assertCopyDirectory(f.copy);
  const copied=await fs.readFile(path.join(f.copy,STAGE));
  assert(copied.equals(Buffer.from(raw,'utf8')));
  const stage=(await createRecoveredProfileManager({kind:'recovered',originalPath:f.original,copyPath:f.copy}).stagedRaw());
  assert.equal(stage.raw,raw);assert.equal(stage.sha256,hash(raw));
  const repeated=await f.originalManager.create(raw,hash(raw));
  assert.equal(repeated.existing,true);
  await assert.rejects(f.originalManager.create(raw+' ',hash(raw+' ')),/different backup/);
  assert.equal(await fs.readFile(path.join(f.copy,STAGE),'utf8'),raw);
});

test('empty occupied slot is unknown; only a valid in-slot reservation permits same-source resume',supportedCopyOnly,async t=>{
  const f=await roots(t);
  await fs.mkdir(f.copy);
  await assert.rejects(f.originalManager.create(raw,hash(raw)),/incomplete or ambiguous/);
  assert.equal((await f.originalManager.status()).phase,'invalid');
  await fs.rmdir(f.copy);
  await f.originalManager.create(raw,hash(raw));
  await fs.unlink(path.join(f.copy,MANIFEST));await fs.unlink(path.join(f.copy,STAGE));
  const reserved=JSON.parse(await fs.readFile(path.join(f.copy,RESERVATION),'utf8'));
  assert.equal(reserved.sourceSha256,hash(raw));
  const resumed=await f.originalManager.create(raw,hash(raw));
  assert.equal(resumed.phase,'pending');
  assert.equal(await fs.readFile(path.join(f.copy,STAGE),'utf8'),raw);
});

test('interrupted publication refuses an unidentified slot and resumes only a verified in-slot source',supportedCopyOnly,async t=>{
  const f=await roots(t);
  const interruptedAtMkdir=createRecoveredProfileManager({kind:'original',originalPath:f.original,copyPath:f.copy,
    testPublicationFault:point=>{if(point==='after-slot-mkdir')throw new Error('test stop after slot mkdir');}});
  await assert.rejects(interruptedAtMkdir.create(raw,hash(raw)),/test stop after slot mkdir/);
  assert.deepEqual(await fs.readdir(f.copy),[]);
  await assert.rejects(f.originalManager.create(raw,hash(raw)),/incomplete or ambiguous/);

  const second=await roots(t);
  const interruptedBeforeManifest=createRecoveredProfileManager({kind:'original',originalPath:second.original,copyPath:second.copy,
    testPublicationFault:point=>{if(point==='before-manifest')throw new Error('test stop before manifest');}});
  await assert.rejects(interruptedBeforeManifest.create(raw,hash(raw)),/test stop before manifest/);
  assert.deepEqual((await fs.readdir(second.copy)).sort(),[RESERVATION,STAGE].sort());
  await assert.rejects(second.originalManager.create(raw+' ',hash(raw+' ')),/different backup/);
  const resumed=await second.originalManager.create(raw,hash(raw));
  assert.equal(resumed.phase,'pending');
  assertCopyDirectory(second.copy);
  assert.equal(await fs.readFile(path.join(second.copy,STAGE),'utf8'),raw);
});

test('temporary stage write failure never reserves the one recovered slot',supportedCopyOnly,async t=>{
  const f=await roots(t),fileSystem=Object.create(fs);
  fileSystem.open=(location,...args)=>{
    if(path.basename(location)===STAGE&&args[0]==='wx')throw new Error('test stage write failure');
    return fs.open(location,...args);
  };
  const failed=createRecoveredProfileManager({kind:'original',originalPath:f.original,copyPath:f.copy,fileSystem});
  await assert.rejects(failed.create(raw,hash(raw)),/test stage write failure/);
  assert.equal((await f.originalManager.status()).phase,'none');
  await assert.rejects(fs.lstat(f.copy),{code:'ENOENT'});
  assert.equal((await f.originalManager.create(raw,hash(raw))).phase,'pending');
});

test('corrupt stage, symlinked slot and symlinked stage fail closed without replacement',supportedCopyOnly,async t=>{
  const f=await roots(t);
  await f.originalManager.create(raw,hash(raw));
  await fs.writeFile(path.join(f.copy,STAGE),'forged');
  assert.equal((await f.originalManager.status()).phase,'invalid');
  await assert.rejects(f.originalManager.create(raw,hash(raw)),/incomplete or ambiguous/);
  assert.equal(await fs.readFile(path.join(f.copy,STAGE),'utf8'),'forged');
  await fs.rm(f.copy,{recursive:true,force:true});
  const alias=path.join(f.root,'outside');await fs.mkdir(alias);
  await fs.symlink(alias,f.copy,'dir');
  assert.equal((await f.originalManager.status()).phase,'invalid');
  await assert.rejects(f.originalManager.create(raw,hash(raw)),/unsafe|aliases/);
  await fs.unlink(f.copy);
  await f.originalManager.create(raw,hash(raw));
  await fs.unlink(path.join(f.copy,STAGE));await fs.symlink(path.join(f.root,'other'),path.join(f.copy,STAGE));
  assert.equal((await f.originalManager.status()).phase,'invalid');
});

test('ready transition persists and copy reopens independently of original directory',supportedCopyOnly,async t=>{
  const f=await roots(t);await f.originalManager.create(raw,hash(raw));
  const copyManager=createRecoveredProfileManager({kind:'recovered',originalPath:f.original,copyPath:f.copy});
  await assert.rejects(copyManager.markReady(),/closed-process save attestation/);
  const candidateSha256=hash('persisted candidate'),candidateByteLength=Buffer.byteLength('persisted candidate');
  const attestation={sourceSha256:hash(raw),candidateSha256,candidateByteLength,
    bootSaveSha256:candidateSha256,bootSaveByteLength:candidateByteLength};
  await assert.rejects(copyManager.markReady({...attestation,bootSaveSha256:hash('other')}),/closed-process save attestation/);
  assert.deepEqual(await copyManager.markReady(attestation),{ok:true});
  assert.equal((await copyManager.status()).phase,'ready');
  await assert.rejects(copyManager.stagedRaw(),/not pending/);
  await assert.rejects(copyManager.markReady(),/not pending/);
  await fs.rm(f.original,{recursive:true,force:true});
  assert.equal((await copyManager.status()).phase,'ready');
  assertCopyDirectory(f.copy);
});

test('preload exposes only finite profile operations and no renderer path or IPC transport',async()=>{
  const exposed={},calls=[];
  const preload=await fs.readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  runInNewContext(preload,{require:name=>{
    assert.equal(name,'electron');
    return {contextBridge:{exposeInMainWorld:(key,api)=>{exposed[key]=api;}},
      ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({ok:true});},on:()=>{}}};
  }});
  assert(Object.isFrozen(exposed.aincradProfile));
  assert.deepEqual(Object.keys(exposed.aincradProfile).sort(),
    ['createRecoveredCopy','markReady','openRecoveredCopy','restartRecoveredCopy','stagedRaw','status']);
  await exposed.aincradProfile.status();await exposed.aincradProfile.createRecoveredCopy(raw,hash(raw));
  await exposed.aincradProfile.openRecoveredCopy();await exposed.aincradProfile.stagedRaw();
  await exposed.aincradProfile.markReady();await exposed.aincradProfile.restartRecoveredCopy();
  assert.deepEqual(calls.map(row=>row[0]),['aincrad:profile-status','aincrad:profile-create','aincrad:profile-open',
    'aincrad:profile-staged','aincrad:profile-ready','aincrad:profile-restart']);
  assert.equal(exposed.aincradProfile.readFile,undefined);
  assert.equal(exposed.aincradProfile.send,undefined);
});
