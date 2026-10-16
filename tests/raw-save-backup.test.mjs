import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import backup from '../desktop/raw-save-backup.cjs';

const {createRawSaveBackupBridge,MAX_RAW_BYTES,MAX_BACKUP_BYTES}=backup;
const raw=JSON.stringify({version:8,features:{plantLifecycle:1},simulationMode:'discovery',agents:[{id:'aster',note:'lake 🫧'}]});
const digest=value=>createHash('sha256').update(Buffer.from(value,'utf8')).digest('hex');

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aincrad-backup-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const profile=path.join(root,'profile'),otherProfile=path.join(root,'other-profile'),outside=path.join(root,'outside');
  await fs.mkdir(profile);await fs.mkdir(otherProfile);await fs.mkdir(outside);
  const selected=path.join(outside,'save.aincrad-backup.json');
  let exportPath=selected,restorePath=selected,exportCancel=false,restoreCancel=false;
  const dialog={
    showSaveDialog:async()=>({canceled:exportCancel,filePath:exportPath}),
    showOpenDialog:async()=>({canceled:restoreCancel,filePaths:[restorePath]}),
  };
  const bridge=(fileSystem=fs,options={})=>createRawSaveBackupBridge({dialog,getWindow:()=>null,userDataPath:profile,
    forbiddenProfilePaths:[otherProfile],documentsPath:outside,fileSystem,...options});
  return {root,profile,otherProfile,outside,selected,dialog,bridge,setExportPath:value=>{exportPath=value;},setRestorePath:value=>{restorePath=value;},cancelExport:()=>{exportCancel=true;},cancelRestore:()=>{restoreCancel=true;},resumeRestore:()=>{restoreCancel=false;}};
}

test('raw backup exports exact UTF-8 bytes and verifies them before restore',async t=>{
  const f=await fixture(t),api=f.bridge();
  const result=await api.exportRaw(raw,digest(raw));
  assert.deepEqual({ok:result.ok,sha256:result.sha256,byteLength:result.byteLength},{ok:true,sha256:digest(raw),byteLength:Buffer.byteLength(raw)});
  const container=JSON.parse(await fs.readFile(f.selected,'utf8'));
  assert.equal(container.saveKey,'aincrad.save.v1');
  assert.equal(container.format,'aincrad.raw-save-backup.v1');
  assert.equal(container.sha256,digest(raw));
  assert(Buffer.from(container.rawUtf8Base64,'base64').equals(Buffer.from(raw,'utf8')));
  await t.test('backup file has owner-only Unix permission bits',{
    skip:process.platform==='win32'?'Windows does not expose Unix 0600 permission bits for this backup.':false,
  },async()=>assert.equal((await fs.stat(f.selected)).mode&0o777,0o600));
  const restored=await api.restoreRaw();
  assert.equal(restored.ok,true);assert.equal(restored.raw,raw);assert.equal(restored.sha256,digest(raw));
});

test('native cancel and an unexpected raw hash never create an export',async t=>{
  const f=await fixture(t),api=f.bridge();
  await assert.rejects(api.exportRaw(raw,'0'.repeat(64)),/changed before export/);
  f.cancelExport();assert.deepEqual(await api.exportRaw(raw,digest(raw)),{ok:false,canceled:true});
  f.cancelRestore();assert.deepEqual(await api.restoreRaw(),{ok:false,canceled:true});
  await assert.rejects(fs.stat(f.selected),{code:'ENOENT'});
});

test('backup refuses profile destinations, overwrite, empty values, and oversized content',async t=>{
  const f=await fixture(t),api=f.bridge();
  f.setExportPath(path.join(f.profile,'save.aincrad-backup.json'));
  await assert.rejects(api.exportRaw(raw,digest(raw)),/outside the application profile/);
  f.setExportPath(f.selected);await fs.writeFile(f.selected,'previous bytes');
  await assert.rejects(api.exportRaw(raw,digest(raw)),{code:'EEXIST'});
  assert.equal(await fs.readFile(f.selected,'utf8'),'previous bytes');
  await assert.rejects(api.exportRaw('',digest('')),/missing or too large/);
  const huge='x'.repeat(MAX_RAW_BYTES+1);
  await assert.rejects(api.exportRaw(huge,digest(huge)),/too large/);
});

test('backup preserves malformed or unsupported save bytes without interpreting them',async t=>{
  const f=await fixture(t),api=f.bridge();
  for(const [index,value] of ['{broken',JSON.stringify({version:999,unknown:'state'})].entries()){
    const selected=path.join(f.outside,`raw-${index}.aincrad-backup.json`);
    f.setExportPath(selected);f.setRestorePath(selected);
    const exported=await api.exportRaw(value,digest(value));
    assert.equal(exported.sha256,digest(value));
    const restored=await api.restoreRaw();
    assert.equal(restored.raw,value);
  }
});

test('partial write or failed readback removes only the incomplete new export',async t=>{
  const f=await fixture(t);
  const partialFs={...fs,open:async(...args)=>{
    const handle=await fs.open(...args);
    return {writeFile:async bytes=>{await handle.writeFile(bytes.subarray(0,10));throw new Error('injected partial write');},sync:()=>handle.sync(),close:()=>handle.close()};
  }};
  await assert.rejects(f.bridge(partialFs).exportRaw(raw,digest(raw)),/injected partial write/);
  await assert.rejects(fs.stat(f.selected),{code:'ENOENT'});
  const noReadbackFs={...fs,open:async(...args)=>{
    if(args[1]!=='wx')throw new Error('injected readback failure');
    return fs.open(...args);
  }};
  await assert.rejects(f.bridge(noReadbackFs).exportRaw(raw,digest(raw)),/injected readback failure/);
  await assert.rejects(fs.stat(f.selected),{code:'ENOENT'});
});

test('restore rejects altered bytes, malformed containers, and profile files',async t=>{
  const f=await fixture(t),api=f.bridge();await api.exportRaw(raw,digest(raw));
  const container=JSON.parse(await fs.readFile(f.selected,'utf8'));
  container.rawUtf8Base64=Buffer.from(raw.replace('lake','fake'),'utf8').toString('base64');
  await fs.writeFile(f.selected,JSON.stringify(container));
  await assert.rejects(api.restoreRaw(),/do not match the manifest/);
  await fs.writeFile(f.selected,'{}');
  await assert.rejects(api.restoreRaw(),/manifest is invalid/);
  const forged={format:'aincrad.raw-save-backup.v1',saveKey:'aincrad.save.v1',byteLength:raw.length,sha256:digest(raw),rawUtf8Base64:'!!!!'};
  await fs.writeFile(f.selected,JSON.stringify(forged));
  await assert.rejects(api.restoreRaw(),/do not match the manifest/);
  forged.rawUtf8Base64=Buffer.from(raw,'utf8').toString('base64');forged.saveKey='another.key';
  await fs.writeFile(f.selected,JSON.stringify(forged));
  await assert.rejects(api.restoreRaw(),/manifest is invalid/);
  const inside=path.join(f.profile,'save.aincrad-backup.json');await fs.writeFile(inside,'{}');f.setRestorePath(inside);
  await assert.rejects(api.restoreRaw(),/inside the application profile/);
  const alias=path.join(f.outside,'profile-link');await fs.symlink(f.profile,alias,'dir');
  f.setRestorePath(path.join(alias,'save.aincrad-backup.json'));
  await assert.rejects(api.restoreRaw(),/inside the application profile/);
});

test('a destination through a symlink into the profile is rejected',async t=>{
  const f=await fixture(t),alias=path.join(f.outside,'profile-link');await fs.symlink(f.profile,alias,'dir');
  f.setExportPath(path.join(alias,'save.aincrad-backup.json'));
  await assert.rejects(f.bridge().exportRaw(raw,digest(raw)),/outside the application profile/);
});

test('both the original and copied profile are excluded, including path aliases',async t=>{
  const f=await fixture(t),api=f.bridge();
  f.setExportPath(path.join(f.otherProfile,'inside.aincrad-backup.json'));
  await assert.rejects(api.exportRaw(raw,digest(raw)),/outside the application profile/);
  const alias=path.join(f.outside,'other-link');await fs.symlink(f.otherProfile,alias,'dir');
  f.setExportPath(path.join(alias,'inside.aincrad-backup.json'));
  await assert.rejects(api.exportRaw(raw,digest(raw)),/outside the application profile/);
  f.setExportPath(f.selected);await api.exportRaw(raw,digest(raw));
  const inside=path.join(f.otherProfile,'inside.aincrad-backup.json');
  await fs.copyFile(f.selected,inside);f.setRestorePath(inside);
  await assert.rejects(api.restoreRaw(),/inside the application profile/);
  f.setRestorePath(path.join(alias,'inside.aincrad-backup.json'));
  await assert.rejects(api.restoreRaw(),/inside the application profile/);
});

test('the main-only ticket reopens exact selected bytes and is consumed on verification',async t=>{
  const f=await fixture(t),api=f.bridge();
  assert.equal(api.selectTestBackup,undefined,'production bridge has no path-selection helper');
  await assert.rejects(api.reverifyTicket(raw,digest(raw)),/Select and verify a backup again/);
  await api.exportRaw(raw,digest(raw));
  assert.deepEqual(await api.reverifyTicket(raw,digest(raw)),
    {raw,sha256:digest(raw),byteLength:Buffer.byteLength(raw)});
  await assert.rejects(api.reverifyTicket(raw,digest(raw)),/Select and verify a backup again/);
  await api.restoreRaw();
  await assert.rejects(api.reverifyTicket(raw,digest('other')),/does not match the import request/);
  await assert.rejects(api.reverifyTicket(raw,digest(raw)),/Select and verify a backup again/);
});

test('cancel, ticket expiry, and changed backup bytes fail closed',async t=>{
  const f=await fixture(t);let now=100;
  const api=f.bridge(fs,{clock:()=>now});
  await api.exportRaw(raw,digest(raw));
  f.cancelRestore();assert.deepEqual(await api.restoreRaw(),{ok:false,canceled:true});
  await assert.rejects(api.reverifyTicket(raw,digest(raw)),/Select and verify a backup again/);
  f.resumeRestore();
  const selected=f.bridge(fs,{clock:()=>now});await selected.restoreRaw();
  now+=15*60*1000+1;
  await assert.rejects(selected.reverifyTicket(raw,digest(raw)),/Select and verify a backup again/);
  const changing=f.bridge();await changing.restoreRaw();
  const forged=JSON.parse(await fs.readFile(f.selected,'utf8'));
  const altered=raw.replace('lake','fake');
  forged.rawUtf8Base64=Buffer.from(altered,'utf8').toString('base64');
  forged.sha256=digest(altered);forged.byteLength=Buffer.byteLength(altered);
  await fs.writeFile(f.selected,JSON.stringify(forged));
  await assert.rejects(changing.reverifyTicket(raw,digest(raw)),/selected backup changed before import/);
  await assert.rejects(changing.reverifyTicket(raw,digest(raw)),/Select and verify a backup again/);
});

test('a backup redirected into either profile after selection cannot satisfy a ticket',async t=>{
  const f=await fixture(t),api=f.bridge();
  await api.exportRaw(raw,digest(raw));
  const inside=path.join(f.otherProfile,'moved.aincrad-backup.json');
  await fs.copyFile(f.selected,inside);
  await fs.unlink(f.selected);await fs.symlink(inside,f.selected);
  await assert.rejects(api.reverifyTicket(raw,digest(raw)),/inside the application profile/);
});

test('test-only main helper selects a verified file but never exists in production',async t=>{
  const f=await fixture(t),ordinary=f.bridge();
  await ordinary.exportRaw(raw,digest(raw));
  const api=f.bridge(fs,{testMode:true});
  assert.equal(typeof api.selectTestBackup,'function');
  const chosen=await api.selectTestBackup(f.selected);
  assert.equal(chosen.raw,raw);assert.equal(chosen.sha256,digest(raw));
  assert.deepEqual(await api.reverifyTicket(raw,digest(raw)),
    {raw,sha256:digest(raw),byteLength:Buffer.byteLength(raw)});
  await assert.rejects(api.selectTestBackup(path.join(f.otherProfile,'missing.json')));
  assert.equal(f.bridge().selectTestBackup,undefined);
});

test('restore rejects an oversized container before reading its contents',async t=>{
  const f=await fixture(t),handle=await fs.open(f.selected,'wx');
  try{await handle.truncate(MAX_BACKUP_BYTES+1);}finally{await handle.close();}
  await assert.rejects(f.bridge().restoreRaw(),/too large/);
});

test('preload exposes only fixed save operations, never a path or IPC transport',async()=>{
  const exposed={},calls=[];
  runInNewContext(await fs.readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{
    require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,api)=>{exposed[name]=api;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve(args);},on:()=>{}}};},
  });
  assert(Object.isFrozen(exposed.aincradSave));
  assert.deepEqual(Object.keys(exposed.aincradSave).sort(),['exportRaw','restoreRaw']);
  await exposed.aincradSave.exportRaw(raw,digest(raw));await exposed.aincradSave.restoreRaw();
  assert.equal(calls[0][0],'aincrad:save-export-raw');assert.equal(calls[1][0],'aincrad:save-restore-raw');
  assert.equal(exposed.aincradSave.send,undefined);assert.equal(exposed.aincradSave.readFile,undefined);
});
