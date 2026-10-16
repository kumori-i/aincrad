const {createHash}=require('node:crypto');
const {constants,existsSync,lstatSync,realpathSync,readFileSync}=require('node:fs');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');

const PROFILE_ID='recovered-proof-v1';
const COPY_FLAG='--recovered-proof-v1';
const COPY_DIRECTORY='Aincrad-Recovered-Proof-v1';
const FORMAT='aincrad.recovered-proof-profile.v1';
const STAGE='source-save.utf8';
const RESERVATION='source-reservation.json';
const MANIFEST='import-manifest.json';
const MAX_RAW_BYTES=16*1024*1024;
const MAX_META_BYTES=4096;
const HASH=/^[a-f0-9]{64}$/;
const WINDOWS_RECOVERY_UNAVAILABLE='Recovered-copy creation and opening are unavailable on Windows in this build. The original world and exact raw backup remain available.';

function assertRecoveredCopySupported(platform=process.platform){
  if(platform==='win32')throw new Error(WINDOWS_RECOVERY_UNAVAILABLE);
}

function inside(root,candidate){
  const relative=path.relative(root,candidate);
  return relative===''||(relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative));
}
function canonicalLocation(location){
  const absolute=path.resolve(location);
  if(existsSync(absolute))return realpathSync(absolute);
  const parent=path.dirname(absolute);
  if(parent===absolute)throw new Error('Cannot resolve the profile location.');
  return path.join(canonicalLocation(parent),path.basename(absolute));
}
async function canonicalLocationAsync(location,fileSystem){
  const absolute=path.resolve(location);
  try{return await fileSystem.realpath(absolute);}
  catch(error){
    if(error.code!=='ENOENT'||path.dirname(absolute)===absolute)throw error;
    return path.join(await canonicalLocationAsync(path.dirname(absolute),fileSystem),path.basename(absolute));
  }
}
function comparableWithoutProductRead(location){
  const absolute=path.resolve(location),temporary=path.resolve(os.tmpdir());
  return inside(temporary,absolute)
    ?path.join(canonicalLocation(temporary),path.relative(temporary,absolute)):absolute;
}
function assertSeparate(originalPath,copyPath,defaultPath,productCopyPath,testRoute=false){
  const original=canonicalLocation(originalPath),copy=canonicalLocation(copyPath);
  if(inside(original,copy)||inside(copy,original))throw new Error('The recovered copy must use a separate profile directory.');
  if(testRoute){
    // Test routing never stats the product profile. Disposable paths have
    // already been confined to the OS temp tree without symlink escape.
    const productOriginal=comparableWithoutProductRead(defaultPath),productCopy=comparableWithoutProductRead(productCopyPath);
    if(inside(productOriginal,original)||inside(original,productOriginal)||inside(productCopy,original)||inside(original,productCopy)||
       inside(productOriginal,copy)||inside(copy,productOriginal)||inside(productCopy,copy)||inside(copy,productCopy))
      throw new Error('Test profiles must be separate from product profiles.');
  }
}
function optionValue(argv,name){
  const found=argv.filter(value=>value.startsWith(name+'='));
  if(found.length>1)throw new Error(`Duplicate ${name} option.`);
  if(argv.includes(name))throw new Error(`${name} needs a value.`);
  return found.length?found[0].slice(name.length+1):null;
}
function testDirectory(value,name){
  if(typeof value!=='string'||!path.isAbsolute(value)||value.length>1024)throw new Error(`${name} must be an absolute test directory.`);
  const candidate=path.resolve(value),temporary=path.resolve(os.tmpdir());
  if(candidate===temporary||!inside(temporary,candidate))throw new Error(`${name} must stay inside the disposable OS temporary directory.`);
  // Resolve the OS-owned temp root once (macOS /var commonly aliases
  // /private/var), then reject any caller-created symlink along the suffix.
  let cursor=canonicalLocation(temporary);
  for(const segment of path.relative(temporary,candidate).split(path.sep)){
    cursor=path.join(cursor,segment);
    if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())throw new Error(`${name} cannot use a symlink.`);
  }
  return cursor;
}
/** Route identity is fixed in native code. The renderer never supplies a path. */
function resolveProfileRoute({argv,isPackaged,appDataPath,defaultUserDataPath,platform=process.platform}){
  if(!Array.isArray(argv)||typeof appDataPath!=='string'||typeof defaultUserDataPath!=='string')throw new TypeError('Missing profile routing inputs.');
  const recovered=argv.filter(arg=>arg===COPY_FLAG).length;
  if(recovered>1||argv.some(arg=>arg.startsWith('--recovered-proof')&&arg!==COPY_FLAG))throw new Error('Unknown or duplicate recovered profile mode.');
  if(recovered)assertRecoveredCopySupported(platform);
  const testRequested=argv.includes('--test');
  const test=testRequested&&!isPackaged;
  const testOriginal=optionValue(argv,'--test-profile');
  const testCopy=optionValue(argv,'--test-recovered-root');
  if(testRequested&&!test)throw new Error('Test profile routing is unavailable in a packaged launch.');
  if(test&&!testOriginal)throw new Error('A test launch needs an isolated original test profile.');
  if((testOriginal||testCopy)&&!test)throw new Error('Test profile routing is unavailable in a normal launch.');
  if(testCopy&&!testOriginal)throw new Error('A recovered test copy needs an isolated original test profile.');
  if(recovered&&argv.includes('--smoke-test'))throw new Error('Smoke mode cannot open a recovered copy.');
  if(argv.some(arg=>arg.startsWith('--test-profile')&&arg!=='--test-profile'&&!arg.startsWith('--test-profile='))||
     argv.some(arg=>arg.startsWith('--test-recovered')&&arg!=='--test-recovered-root'&&!arg.startsWith('--test-recovered-root=')))
    throw new Error('Unknown profile option.');
  const productCopyPath=path.join(path.resolve(appDataPath),COPY_DIRECTORY);
  const originalPath=testOriginal?testDirectory(testOriginal,'--test-profile'):path.resolve(defaultUserDataPath);
  const copyPath=testCopy?testDirectory(testCopy,'--test-recovered-root'):
    testOriginal?path.join(path.dirname(originalPath),path.basename(originalPath)+'-recovered-proof-v1'):productCopyPath;
  if(testOriginal&&path.dirname(copyPath)!==path.dirname(originalPath))
    throw new Error('The test profiles must share one disposable parent.');
  // A disabled Windows copy slot must never prevent the ordinary original
  // world from opening. Disposable test routes still enforce separation.
  if(platform!=='win32'||testOriginal)
    assertSeparate(originalPath,copyPath,defaultUserDataPath,productCopyPath,Boolean(testOriginal));
  return Object.freeze({kind:recovered?'recovered':'original',originalPath,copyPath,isTest:test,usesTestPaths:Boolean(testOriginal),
    recoveredCopySupported:platform!=='win32',
    userDataPath:recovered?copyPath:originalPath,sessionDataPath:recovered?copyPath:originalPath});
}
function assertCopyDirectory(copyPath){
  if(!existsSync(copyPath))throw new Error('No recovered copy exists. Import a verified backup first.');
  const entry=lstatSync(copyPath);
  if(!entry.isDirectory()||entry.isSymbolicLink()||
     canonicalLocation(copyPath)!==path.join(canonicalLocation(path.dirname(copyPath)),path.basename(copyPath)))
    throw new Error('The recovered profile path is not an ordinary directory.');
  const manifestPath=path.join(copyPath,MANIFEST);
  if(!existsSync(manifestPath)||!lstatSync(manifestPath).isFile()||lstatSync(manifestPath).isSymbolicLink())
    throw new Error('The recovered copy is incomplete or ambiguous; it cannot be opened.');
  const bytes=readFileSync(manifestPath);
  if(bytes.length<1||bytes.length>MAX_META_BYTES)throw new Error('The recovered copy manifest is invalid.');
  try{validMetadata(JSON.parse(bytes.toString('utf8')),['pending','ready']);}
  catch{throw new Error('The recovered copy manifest is invalid.');}
}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function rawBytes(raw){
  if(typeof raw!=='string'||!raw||raw.length>MAX_RAW_BYTES)throw new Error('The staged save is missing or too large.');
  const bytes=Buffer.from(raw,'utf8');
  if(bytes.length>MAX_RAW_BYTES||bytes.toString('utf8')!==raw)throw new Error('The staged save cannot be represented exactly as UTF-8.');
  return bytes;
}
function validMetadata(value,phases){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).sort().join(',')!=='byteLength,createdAt,format,phase,profileId,sourceSha256'||
     value.format!==FORMAT||value.profileId!==PROFILE_ID||!phases.includes(value.phase)||
     !HASH.test(value.sourceSha256)||!Number.isInteger(value.byteLength)||value.byteLength<1||value.byteLength>MAX_RAW_BYTES||
     typeof value.createdAt!=='string'||new Date(value.createdAt).toISOString()!==value.createdAt)
    throw new Error('The recovered copy metadata are invalid.');
  return value;
}
function sameSource(a,b){return a.sourceSha256===b.sourceSha256&&a.byteLength===b.byteLength&&a.createdAt===b.createdAt;}
async function readRegular(location,limit,fileSystem){
  const entry=await fileSystem.lstat(location);
  if(!entry.isFile()||entry.isSymbolicLink())throw new Error('A recovered copy file is not a regular file.');
  const handle=await fileSystem.open(location,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
    const info=await handle.stat();
    if(!info.isFile()||info.size<1||info.size>limit)throw new Error('A recovered copy file is missing or oversized.');
    const buffer=Buffer.alloc(info.size+1);let offset=0;
    while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
    if(offset!==info.size)throw new Error('A recovered copy file changed while being read.');
    const canonicalParent=await fileSystem.realpath(path.dirname(location));
    if(await fileSystem.realpath(location)!==path.join(canonicalParent,path.basename(location)))
      throw new Error('A recovered copy file aliases another location.');
    return buffer.subarray(0,offset);
  }finally{await handle.close();}
}
async function writeExclusive(location,bytes,fileSystem){
  const handle=await fileSystem.open(location,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
async function syncDirectory(directory,fileSystem){
  const handle=await fileSystem.open(directory,'r');
  try{await handle.sync();}finally{await handle.close();}
}

function createRecoveredProfileManager({kind,originalPath,copyPath,fileSystem=fs,clock=()=>new Date(),testPublicationFault,
  platform=process.platform}){
  if(!['original','recovered'].includes(kind)||typeof originalPath!=='string'||typeof copyPath!=='string')throw new TypeError('Missing recovered profile locations.');
  if(testPublicationFault!==undefined&&typeof testPublicationFault!=='function')throw new TypeError('Invalid publication test hook.');
  let busy=false;
  async function exclusive(fn){if(busy)throw new Error('A recovered profile operation is already in progress.');busy=true;try{return await fn();}finally{busy=false;}}
  async function inspect(){
    let entry;
    try{entry=await fileSystem.lstat(copyPath);}catch(error){if(error.code==='ENOENT')return {phase:'none'};return {phase:'invalid',reason:'The recovered copy cannot be inspected.'};}
    if(!entry.isDirectory()||entry.isSymbolicLink())return {phase:'invalid',reason:'The recovered profile path is unsafe.'};
    try{
      const [original,copy]=await Promise.all([canonicalLocationAsync(originalPath,fileSystem),fileSystem.realpath(copyPath)]);
      const expected=path.join(await fileSystem.realpath(path.dirname(copyPath)),path.basename(copyPath));
      if(inside(original,copy)||inside(copy,original)||copy!==expected)throw new Error('The recovered copy aliases the original profile.');
      const manifest=validMetadata(JSON.parse((await readRegular(path.join(copyPath,MANIFEST),MAX_META_BYTES,fileSystem)).toString('utf8')),['pending','ready']);
      const reservation=validMetadata(JSON.parse((await readRegular(path.join(copyPath,RESERVATION),MAX_META_BYTES,fileSystem)).toString('utf8')),['reserved']);
      if(!sameSource(manifest,reservation))throw new Error('The recovered copy source identity changed.');
      const stage=await readRegular(path.join(copyPath,STAGE),MAX_RAW_BYTES,fileSystem);
      if(stage.length!==manifest.byteLength||sha256(stage)!==manifest.sourceSha256||!stage.equals(rawBytes(stage.toString('utf8'))))
        throw new Error('The recovered copy staged save failed verification.');
      return {phase:manifest.phase,sourceSha256:manifest.sourceSha256,createdAt:manifest.createdAt,byteLength:manifest.byteLength,raw:stage.toString('utf8')};
    }catch(error){return {phase:'invalid',reason:error.message||'The recovered copy cannot be verified.'};}
  }
  async function status(){
    const item=await inspect();
    return {kind,phase:item.phase,available:item.phase==='pending'||item.phase==='ready',
      recoveredCopySupported:platform!=='win32',
      sourceSha256:item.sourceSha256||null,createdAt:item.createdAt||null,
      ...(item.phase==='invalid'?{reason:item.reason}:{}),};
  }
  async function create(raw,expectedHash){return exclusive(async()=>{
    assertRecoveredCopySupported(platform);
    if(kind!=='original')throw new Error('Import can only be started from the original profile.');
    const bytes=rawBytes(raw);
    if(!HASH.test(expectedHash)||sha256(bytes)!==expectedHash)throw new Error('The verified backup does not match the import source.');
    const current=await inspect();
    if(current.phase==='pending'||current.phase==='ready'){
      if(current.sourceSha256!==expectedHash||current.byteLength!==bytes.length)throw new Error('The recovered copy belongs to a different backup; it will not be replaced or merged.');
      return {ok:true,phase:current.phase,sourceSha256:current.sourceSha256,createdAt:current.createdAt,existing:true};
    }
    const parent=path.dirname(copyPath),base=path.basename(copyPath);
    await fileSystem.mkdir(parent,{recursive:true,mode:0o700});
    const [canonicalOriginal,canonicalTarget]=await Promise.all([
      canonicalLocationAsync(originalPath,fileSystem),canonicalLocationAsync(copyPath,fileSystem)]);
    if(inside(canonicalOriginal,canonicalTarget)||inside(canonicalTarget,canonicalOriginal))
      throw new Error('The recovered copy aliases the original profile.');
    let reservation=null;
    if(current.phase!=='none'){
      const existingEntry=await fileSystem.lstat(copyPath);
      const expected=path.join(await fileSystem.realpath(path.dirname(copyPath)),path.basename(copyPath));
      if(!existingEntry.isDirectory()||existingEntry.isSymbolicLink()||await fileSystem.realpath(copyPath)!==expected)
        throw new Error('The occupied recovered profile path is unsafe.');
      const contents=await fileSystem.readdir(copyPath);
      if(contents.some(name=>![RESERVATION,STAGE].includes(name))||!contents.includes(RESERVATION))
        throw new Error('The occupied recovered copy is incomplete or ambiguous; it will not be replaced.');
      try{
        reservation=validMetadata(JSON.parse((await readRegular(path.join(copyPath,RESERVATION),MAX_META_BYTES,fileSystem)).toString('utf8')),['reserved']);
        if(reservation.sourceSha256!==expectedHash||reservation.byteLength!==bytes.length)
          throw new Error('The occupied recovered copy belongs to a different backup.');
        if(contents.includes(STAGE)){
          const existing=await readRegular(path.join(copyPath,STAGE),MAX_RAW_BYTES,fileSystem);
          if(!existing.equals(bytes))throw new Error('The occupied recovered copy has conflicting staged bytes.');
        }
      }catch(error){throw new Error(error.message||'The occupied recovered copy cannot be resumed.');}
    }
    const createdAt=reservation?.createdAt||clock().toISOString();
    const metadata={format:FORMAT,profileId:PROFILE_ID,phase:'reserved',sourceSha256:expectedHash,byteLength:bytes.length,createdAt};
    validMetadata(metadata,['reserved']);
    const pending={...metadata,phase:'pending'};
    const temp=await fileSystem.mkdtemp(path.join(parent,`.${base}-stage-`));
    try{
      await writeExclusive(path.join(temp,STAGE),bytes,fileSystem);
      await writeExclusive(path.join(temp,RESERVATION),Buffer.from(JSON.stringify(metadata)+'\n'),fileSystem);
      await writeExclusive(path.join(temp,MANIFEST),Buffer.from(JSON.stringify(pending)+'\n'),fileSystem);
      await syncDirectory(temp,fileSystem);
      const staged=await readRegular(path.join(temp,STAGE),MAX_RAW_BYTES,fileSystem);
      if(!staged.equals(bytes))throw new Error('Staged save readback failed.');
      if(current.phase==='none'){
        // The entire temporary source is synced and read back before the
        // exclusive no-clobber slot reservation. A crash after mkdir but
        // before the source marker still leaves an unknown, unusable slot.
        await fileSystem.mkdir(copyPath,{mode:0o700});
        await testPublicationFault?.('after-slot-mkdir');
      }
      if(!reservation)await fileSystem.link(path.join(temp,RESERVATION),path.join(copyPath,RESERVATION));
      await syncDirectory(copyPath,fileSystem);
      const slotStage=path.join(copyPath,STAGE);
      try{await fileSystem.lstat(slotStage);}catch(error){if(error.code==='ENOENT')await fileSystem.link(path.join(temp,STAGE),slotStage);else throw error;}
      const copied=await readRegular(slotStage,MAX_RAW_BYTES,fileSystem);
      if(!copied.equals(bytes))throw new Error('The staged save changed during publication.');
      await syncDirectory(copyPath,fileSystem);
      await testPublicationFault?.('before-manifest');
      // This exclusive hard link publishes a complete pending slot. Neither
      // an existing manifest nor an occupied directory is ever replaced.
      await fileSystem.link(path.join(temp,MANIFEST),path.join(copyPath,MANIFEST));
      await syncDirectory(copyPath,fileSystem);
      const published=await inspect();
      if(published.phase!=='pending'||published.sourceSha256!==expectedHash)throw new Error('The recovered copy did not verify after publication.');
      return {ok:true,phase:'pending',sourceSha256:expectedHash,createdAt};
    }finally{await fileSystem.rm(temp,{recursive:true,force:true}).catch(()=>{});}
  });}
  async function stagedRaw(){
    assertRecoveredCopySupported(platform);
    if(kind!=='recovered')throw new Error('Staged data are only available in the recovered copy.');
    const item=await inspect();
    if(item.phase!=='pending')throw new Error('The recovered copy is not pending a verified import.');
    return {raw:item.raw,sha256:item.sourceSha256,byteLength:item.byteLength,createdAt:item.createdAt};
  }
  async function markReady(attestation){return exclusive(async()=>{
    assertRecoveredCopySupported(platform);
    if(kind!=='recovered')throw new Error('Only a recovered copy can be marked ready.');
    const item=await inspect();
    if(item.phase!=='pending')throw new Error('The recovered copy is not pending a verified import.');
    if(!attestation||attestation.sourceSha256!==item.sourceSha256||
       !HASH.test(attestation.candidateSha256)||
       attestation.candidateSha256!==attestation.bootSaveSha256||
       !Number.isInteger(attestation.candidateByteLength)||attestation.candidateByteLength<1||
       attestation.candidateByteLength>MAX_RAW_BYTES||
       attestation.candidateByteLength!==attestation.bootSaveByteLength)
      throw new Error('The pending candidate lacks a verified closed-process save attestation.');
    const metadata={format:FORMAT,profileId:PROFILE_ID,phase:'ready',sourceSha256:item.sourceSha256,
      byteLength:item.byteLength,createdAt:item.createdAt};
    const temporary=path.join(copyPath,`.${MANIFEST}.ready-${process.pid}-${Date.now()}`);
    await writeExclusive(temporary,Buffer.from(JSON.stringify(metadata)+'\n'),fileSystem);
    try{
      await fileSystem.rename(temporary,path.join(copyPath,MANIFEST));
      await syncDirectory(copyPath,fileSystem);
    }finally{await fileSystem.unlink(temporary).catch(()=>{});}
    if((await inspect()).phase!=='ready')throw new Error('The recovered copy did not reopen as ready.');
    return {ok:true};
  });}
  return Object.freeze({status,create,stagedRaw,markReady});
}

module.exports={PROFILE_ID,COPY_FLAG,COPY_DIRECTORY,STAGE,RESERVATION,MANIFEST,MAX_RAW_BYTES,
  WINDOWS_RECOVERY_UNAVAILABLE,assertRecoveredCopySupported,resolveProfileRoute,assertCopyDirectory,createRecoveredProfileManager};
