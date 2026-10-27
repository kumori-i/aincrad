import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import backup from '../desktop/raw-save-backup.cjs';
const {createRawSaveBackupBridge,decodeCurrentWorldBackup,MAX_CURRENT_RAW_BYTES}=backup;

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aincrad-current-backup-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const profile=path.join(root,'profile'),outside=path.join(root,'outside');
  await fs.mkdir(profile);await fs.mkdir(outside);
  let selected=path.join(outside,'backup.json'),canceled=false,calls=0;
  const dialog={showSaveDialog:async(_win,options)=>{calls++;assert.match(options.title,/current stored/);return {canceled,filePath:selected};}};
  return {root,profile,outside,dialog,get selected(){return selected;},get calls(){return calls;},
    select(value){selected=value;},cancel(){canceled=true;},
    bridge:(fileSystem=fs)=>createRawSaveBackupBridge({dialog,getWindow:()=>null,userDataPath:profile,documentsPath:outside,fileSystem})};
}

test('current backup preserves exact stored code units and labels key, encoding and scope truthfully',async t=>{
  const f=await fixture(t),api=f.bridge();
  for(const [i,raw] of ['', '{broken', '\ud800\u0000\udfff', 'lake 🫧', '{"version":12,"test":true}'].entries()){
    f.select(path.join(f.outside,`backup-${i}.json`));
    const result=await api.exportCurrentWorld(raw);
    assert.equal(result.ok,true);assert.equal(result.byteLength,raw.length*2);
    assert.equal(result.path,undefined,'filesystem path need not cross renderer boundary');
    const record=JSON.parse(await fs.readFile(f.selected,'utf8'));
    assert.equal(record.saveKey,'aincrad.world.v2');assert.equal(record.encoding,'utf16le');
    assert.equal(record.contents,'exact-stored-value-not-unsaved-state');
    assert.equal(decodeCurrentWorldBackup(record).raw,raw);
    assert.equal((await fs.stat(f.selected)).mode&0o777,0o600);
  }
});

test('native cancellation, missing value, and oversized value never report a successful backup',async t=>{
  const f=await fixture(t),api=f.bridge();
  await assert.rejects(api.exportCurrentWorld(null),/missing or too large/);
  await assert.rejects(api.exportCurrentWorld('x'.repeat(MAX_CURRENT_RAW_BYTES/2+1)),/too large/);
  assert.equal(f.calls,0);
  f.cancel();assert.deepEqual(await api.exportCurrentWorld('{broken'),{ok:false,canceled:true});
  await assert.rejects(fs.stat(f.selected),{code:'ENOENT'});
});

test('current backup refuses profile paths, symlink aliases, and overwriting any existing file',async t=>{
  const f=await fixture(t),api=f.bridge();
  f.select(path.join(f.profile,'data.json'));
  await assert.rejects(api.exportCurrentWorld('raw'),/outside the application profiles/);
  const alias=path.join(f.outside,'profile-link');await fs.symlink(f.profile,alias);
  f.select(path.join(alias,'data.json'));
  await assert.rejects(api.exportCurrentWorld('raw'),/outside the application profiles/);
  f.select(path.join(f.outside,'existing.json'));await fs.writeFile(f.selected,'keep me');
  await assert.rejects(api.exportCurrentWorld('raw'),{code:'EEXIST'});
  assert.equal(await fs.readFile(f.selected,'utf8'),'keep me');
  f.select(path.join(f.outside,'destination-link.json'));await fs.symlink(path.join(f.outside,'existing.json'),f.selected);
  await assert.rejects(api.exportCurrentWorld('raw'),{code:'EEXIST'});
  assert.equal(await fs.readFile(path.join(f.outside,'existing.json'),'utf8'),'keep me');
});

test('write, sync and readback failures reject instead of authorizing reset',async t=>{
  for(const stage of ['write','sync','readback']){
    const f=await fixture(t);
    const fileSystem={...fs,open:async(...args)=>{
      if(args[1]!=='wx'&&stage==='readback')throw new Error('readback failed');
      const h=await fs.open(...args);
      if(args[1]!=='wx')return h;
      return {stat:()=>h.stat(),writeFile:async bytes=>{if(stage==='write'){await h.writeFile(bytes.subarray(0,12));throw new Error('write failed');}await h.writeFile(bytes);},
        sync:()=>stage==='sync'?Promise.reject(new Error('sync failed')):h.sync(),close:()=>h.close()};
    }};
    await assert.rejects(f.bridge(fileSystem).exportCurrentWorld('raw'),new RegExp(stage+' failed'));
    await assert.rejects(fs.stat(f.selected),{code:'ENOENT'});
  }
});

test('duplicate requests cannot open two dialogs or race a legacy export',async t=>{
  const f=await fixture(t);let resolve;
  f.dialog.showSaveDialog=()=>new Promise(r=>{resolve=r;});
  const api=f.bridge(),pending=api.exportCurrentWorld('raw');
  await assert.rejects(api.exportCurrentWorld('raw'),/already open/);
  await assert.rejects(api.exportRaw('raw','0'.repeat(64)),/already open/);
  resolve({canceled:true});assert.equal((await pending).canceled,true);
});

test('decoder rejects altered and foreign manifests; restoration never implies valid world state',async t=>{
  const f=await fixture(t);await f.bridge().exportCurrentWorld('{broken');
  const record=JSON.parse(await fs.readFile(f.selected,'utf8'));
  assert.equal(decodeCurrentWorldBackup(record).raw,'{broken');
  for(const patch of [{saveKey:'aincrad.save.v1'},{encoding:'utf8'},{codeUnits:1},{sha256:'0'.repeat(64)},{rawBase64:'!!!!'},{byteLength:3},{contents:'live-world'}])
    assert.throws(()=>decodeCurrentWorldBackup({...record,...patch}),/manifest|bytes/);
});

test('current preload exposes only a fixed one-argument export, no generic IPC, path, reset or restore',async()=>{
  const exposed={},calls=[];
  runInNewContext(await fs.readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{
    require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,api)=>{exposed[name]=api;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve();},on:()=>{}}};},
  });
  assert(Object.isFrozen(exposed.aincradWorldSave));
  assert.deepEqual(Object.keys(exposed.aincradWorldSave),['exportCurrentWorld']);
  await exposed.aincradWorldSave.exportCurrentWorld('raw','/ignored/path');
  assert.deepEqual(calls,[['aincrad:current-world-export','raw']]);
});

test('trusted IPC sender must be the live application window main frame at the exact application origin',async()=>{
  const source=await fs.readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  const body=source.match(/  function trusted\(event\)\{([\s\S]*?)\n  \}/)[0];
  const frame={url:'aincrad://app/index.html'},sender={mainFrame:frame};
  let destroyed=false;
  const trusted=runInNewContext(`(${body.trim()})`,{URL,win:{webContents:sender,isDestroyed:()=>destroyed}});
  assert.equal(trusted({sender,senderFrame:frame}),true);
  assert.equal(trusted({sender:{mainFrame:frame},senderFrame:frame}),false);
  assert.equal(trusted({sender,senderFrame:{url:frame.url}}),false);
  for(const url of ['https://app/index.html','aincrad://other/index.html','aincrad://app/other.html','aincrad://user:password@app/index.html']){
    frame.url=url;assert.equal(trusted({sender,senderFrame:frame}),false,url);
  }
  frame.url='aincrad://app/index.html';destroyed=true;assert.equal(trusted({sender,senderFrame:frame}),false);
});

test('failed readback never deletes an unrelated replacement at the selected destination',async t=>{
  const f=await fixture(t);let replaced=false;
  const fileSystem={...fs,open:async(...args)=>{
    if(args[1]!=='wx'&&!replaced){
      replaced=true;
      await fs.rename(f.selected,path.join(f.outside,'failed-export.json'));
      await fs.writeFile(f.selected,'unrelated replacement');
      throw new Error('injected replacement');
    }
    return fs.open(...args);
  }};
  await assert.rejects(f.bridge(fileSystem).exportCurrentWorld('raw'),/injected replacement/);
  assert.equal(await fs.readFile(f.selected,'utf8'),'unrelated replacement');
});
