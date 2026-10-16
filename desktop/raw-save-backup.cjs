const { createHash }=require('node:crypto');
const { constants }=require('node:fs');
const fs=require('node:fs/promises');
const path=require('node:path');

const SAVE_KEY='aincrad.save.v1';
const FORMAT='aincrad.raw-save-backup.v1';
const MAX_RAW_BYTES=16*1024*1024;
const MAX_BACKUP_BYTES=24*1024*1024;
const TICKET_TTL_MS=15*60*1000;
const HEX_SHA256=/^[a-f0-9]{64}$/;

function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}

function rawBytes(raw){
  if(typeof raw!=='string'||raw.length===0||raw.length>MAX_RAW_BYTES)throw new Error('The raw save is missing or too large to export.');
  const bytes=Buffer.from(raw,'utf8');
  if(bytes.length>MAX_RAW_BYTES||bytes.toString('utf8')!==raw)throw new Error('The raw save cannot be represented exactly as UTF-8.');
  return bytes;
}

function inside(directory,candidate){
  const relative=path.relative(directory,candidate);
  return relative===''||(relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative));
}

function createRawSaveBackupBridge({dialog,getWindow,userDataPath,documentsPath,forbiddenProfilePaths=[],fileSystem=fs,clock=()=>performance.now(),testMode=false}){
  if(!dialog||typeof getWindow!=='function'||typeof userDataPath!=='string'||typeof documentsPath!=='string'||
      !Array.isArray(forbiddenProfilePaths)||forbiddenProfilePaths.some(root=>typeof root!=='string'||!root)||
      typeof clock!=='function')throw new TypeError('The raw save backup bridge needs its native window and directories.');
  let busy=false,ticket=null;
  async function canonicalLocation(target){
    const absolute=path.resolve(target);
    try{return await fileSystem.realpath(absolute);}
    catch(error){
      if(error.code!=='ENOENT'||path.dirname(absolute)===absolute)throw error;
      return path.join(await canonicalLocation(path.dirname(absolute)),path.basename(absolute));
    }
  }
  async function insideProfile(candidate){
    for(const root of [userDataPath,...forbiddenProfilePaths])if(inside(await canonicalLocation(root),candidate))return true;
    return false;
  }
  async function exportDestination(selected){
    if(typeof selected!=='string'||!selected.endsWith('.json'))throw new Error('Choose a JSON backup file.');
    const parent=await fileSystem.realpath(path.dirname(path.resolve(selected)));
    const destination=path.join(parent,path.basename(selected));
    if(await insideProfile(destination))throw new Error('Choose a backup location outside the application profiles.');
    return destination;
  }
  async function readVerifiedBackup(selected){
    const absolute=await fileSystem.realpath(selected);
    if(await insideProfile(absolute))throw new Error('A backup inside the application profiles cannot be restored.');
    const handle=await fileSystem.open(absolute,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    let contents;
    try{
      const metadata=await handle.stat();
      if(!metadata.isFile()||metadata.size<1||metadata.size>MAX_BACKUP_BYTES)throw new Error('The backup file is too large or is not a regular file.');
      const bounded=Buffer.alloc(metadata.size+1);
      let used=0;
      while(used<bounded.length){
        const {bytesRead}=await handle.read(bounded,used,bounded.length-used,used);
        if(bytesRead===0)break;
        used+=bytesRead;
      }
      if(used!==metadata.size)throw new Error('The backup changed while being read.');
      contents=bounded.subarray(0,used);
    }finally{await handle.close();}
    if(await fileSystem.realpath(selected)!==absolute)throw new Error('The backup path changed while being read.');
    let record;
    try{record=JSON.parse(contents.toString('utf8'));}catch{throw new Error('The backup manifest cannot be read.');}
    if(!record||record.format!==FORMAT||record.saveKey!==SAVE_KEY||!Number.isInteger(record.byteLength)||record.byteLength<1||record.byteLength>MAX_RAW_BYTES||!HEX_SHA256.test(record.sha256)||typeof record.rawUtf8Base64!=='string'||record.rawUtf8Base64.length>Math.ceil(MAX_RAW_BYTES/3)*4)throw new Error('The backup manifest is invalid.');
    const bytes=Buffer.from(record.rawUtf8Base64,'base64');
    if(bytes.toString('base64')!==record.rawUtf8Base64||bytes.length!==record.byteLength||sha256(bytes)!==record.sha256)throw new Error('The backup bytes do not match the manifest.');
    const raw=bytes.toString('utf8');
    if(!bytes.equals(rawBytes(raw)))throw new Error('The backup raw save changed during decoding.');
    return {raw,sha256:record.sha256,hash:record.sha256,byteLength:bytes.length,path:absolute};
  }
  async function soleOperation(operation,{clearTicket=false}={}){
    if(busy)throw new Error('A raw save backup dialog is already open.');
    busy=true;
    if(clearTicket)ticket=null;
    try{return await operation();}catch(error){ticket=null;throw error;}finally{busy=false;}
  }
  function remember(verified){
    ticket={path:verified.path,raw:verified.raw,sha256:verified.sha256,
      byteLength:verified.byteLength,expiresAt:clock()+TICKET_TTL_MS};
  }
  return Object.freeze({
    exportRaw:(raw,expectedSha256)=>soleOperation(async()=>{
      const bytes=rawBytes(raw),digest=sha256(bytes);
      if(!HEX_SHA256.test(expectedSha256)||digest!==expectedSha256)throw new Error('The raw save changed before export.');
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      const result=await dialog.showSaveDialog(getWindow(),{
        title:'Export original Aincrad save',
        defaultPath:path.join(documentsPath,`Aincrad-raw-save-${stamp}-${digest.slice(0,12)}.aincrad-backup.json`),
        filters:[{name:'Aincrad raw save backup',extensions:['json']}],
      });
      if(result.canceled||!result.filePath)return {ok:false,canceled:true};
      const destination=await exportDestination(result.filePath);
      const record={format:FORMAT,saveKey:SAVE_KEY,byteLength:bytes.length,sha256:digest,rawUtf8Base64:bytes.toString('base64')};
      const encoded=Buffer.from(JSON.stringify(record)+'\n','utf8');
      if(encoded.length>MAX_BACKUP_BYTES)throw new Error('The backup container is too large.');
      let handle,created=false;
      try{
        handle=await fileSystem.open(destination,'wx',0o600);created=true;
        await handle.writeFile(encoded);await handle.sync();await handle.close();handle=null;
        const verified=await readVerifiedBackup(destination);
        if(verified.raw!==raw||verified.sha256!==digest)throw new Error('Backup readback did not match the raw save.');
        remember(verified);
        return {ok:true,path:destination,sha256:digest,hash:digest,byteLength:bytes.length};
      }catch(error){
        if(handle)await handle.close().catch(()=>{});
        if(created)await fileSystem.unlink(destination).catch(()=>{});
        throw error;
      }
    },{clearTicket:true}),
    restoreRaw:()=>soleOperation(async()=>{
      const result=await dialog.showOpenDialog(getWindow(),{
        title:'Choose an Aincrad raw save backup',
        defaultPath:documentsPath,
        properties:['openFile'],
        filters:[{name:'Aincrad raw save backup',extensions:['json']}],
      });
      if(result.canceled||!Array.isArray(result.filePaths)||result.filePaths.length!==1)return {ok:false,canceled:true};
      const verified=await readVerifiedBackup(result.filePaths[0]);
      remember(verified);
      return {ok:true,...verified};
    },{clearTicket:true}),
    ...(testMode?{selectTestBackup:selected=>soleOperation(async()=>{
      const verified=await readVerifiedBackup(selected);
      remember(verified);
      return {ok:true,...verified};
    },{clearTicket:true})}:{}),
    reverifyTicket:(raw,expectedSha256)=>soleOperation(async()=>{
      const selected=ticket;ticket=null;
      if(!selected||clock()>selected.expiresAt)throw new Error('Select and verify a backup again before importing.');
      const bytes=rawBytes(raw),digest=sha256(bytes);
      if(!HEX_SHA256.test(expectedSha256)||digest!==expectedSha256||digest!==selected.sha256||
          bytes.length!==selected.byteLength||raw!==selected.raw)
        throw new Error('The selected backup does not match the import request.');
      const verified=await readVerifiedBackup(selected.path);
      if(clock()>selected.expiresAt||verified.path!==selected.path||verified.raw!==raw||
          verified.sha256!==digest||verified.byteLength!==bytes.length)
        throw new Error('The selected backup changed before import.');
      return {raw,sha256:digest,byteLength:bytes.length};
    }),
  });
}

module.exports={createRawSaveBackupBridge,MAX_RAW_BYTES,MAX_BACKUP_BYTES};
