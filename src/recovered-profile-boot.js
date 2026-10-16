// This module decides whether a profile can construct a running world. It has
// no write operations: the renderer handles explicit import and relaunch only
// after these read-only checks complete.
const SHA256=/^[a-f0-9]{64}$/;
const blocked=reason=>({gate:'blocked',reason});

export function validateProfileStatus(status){
  if(!status||typeof status!=='object'||!['original','recovered'].includes(status.kind)||
      !['none','pending','ready','invalid'].includes(status.phase)||
      typeof status.available!=='boolean'||typeof status.recoveredCopySupported!=='boolean')
    return 'The active profile could not be identified.';
  if(status.kind==='recovered'&&!status.recoveredCopySupported)
    return 'Recovered-copy opening is unavailable on this platform.';
  // A damaged copy slot must not prevent the original profile from opening or
  // exporting its own protected raw save. It only disables opening the copy.
  if(status.phase==='invalid'&&status.kind==='recovered')
    return status.reason||'The recovered copy is incomplete or invalid.';
  if(status.kind==='recovered'&&status.phase==='none')return 'The recovered copy has no verified import record.';
  if(status.available!==(status.phase==='pending'||status.phase==='ready'))
    return 'The recovered copy availability disagrees with its import record.';
  if(status.phase==='invalid'){
    if(status.kind!=='original'||status.available)return 'The recovered copy status is inconsistent.';
  }else if(status.phase==='none'){
    if(status.kind!=='original'||status.sourceSha256!==null||status.createdAt!==null)
      return 'The original profile returned an inconsistent import record.';
  }else if(!SHA256.test(status.sourceSha256)||typeof status.createdAt!=='string'||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(status.createdAt)||
      !Number.isFinite(Date.parse(status.createdAt)))
    return 'The recovered copy has an invalid source identity.';
  return null;
}

export async function inspectProfileBoot({profileApi,getStorage,loadSave,prepareMigration,hashRaw,saveKey}){
  let status;
  try{
    if(typeof profileApi?.status!=='function')return blocked('The profile bridge is unavailable. The world is paused to protect saved data.');
    status=await profileApi.status();
  }catch{return blocked('The profile status could not be read. The world is paused to protect saved data.');}
  const statusError=validateProfileStatus(status);
  if(statusError)return {...blocked(statusError),status};

  let storage;
  try{
    storage=getStorage();
    if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw new Error();
  }catch{return {...blocked('Local storage is unavailable. The world is paused to protect saved data.'),status};}

  if(status.kind==='original'){
    const loaded=loadSave(storage);
    if(!loaded?.error)return {gate:'play',status,storage,loaded};
    let originalRaw=null,plan=null;
    try{
      originalRaw=storage.getItem(saveKey);
      if(originalRaw)plan=prepareMigration(originalRaw);
    }catch{}
    return {gate:'original-protected',status,storage,loaded,originalRaw,plan,reason:loaded.error};
  }

  if(status.phase==='ready'){
    try{
      if(!storage.getItem(saveKey))return {...blocked('The recovered copy has no saved world. It will not start a fresh one.'),status,storage};
      const loaded=loadSave(storage);
      if(loaded?.error||!loaded?.exists||loaded.state?.features?.legacyPendingPhysicalOnly!==1)
        return {...blocked(loaded?.error||'The recovered copy lacks its verified migration marker.'),status,storage};
      return {gate:'play',status,storage,loaded};
    }catch{return {...blocked('The recovered copy could not be read.'),status,storage};}
  }

  try{
    if(typeof profileApi.stagedRaw!=='function')throw new Error('The verified source stage is unavailable.');
    const stage=await profileApi.stagedRaw();
    if(!stage||typeof stage.raw!=='string'||stage.raw.length===0||
        stage.sha256!==status.sourceSha256||stage.createdAt!==status.createdAt||
        !Number.isSafeInteger(stage.byteLength)||stage.byteLength<=0)
      throw new Error('The staged source does not match the recovered copy record.');
    const bytes=new TextEncoder().encode(stage.raw);
    if(new TextDecoder('utf-8',{fatal:true}).decode(bytes)!==stage.raw||
        bytes.length!==stage.byteLength||await hashRaw(stage.raw)!==stage.sha256)
      throw new Error('The staged source failed byte and SHA-256 verification.');
    const plan=prepareMigration(stage.raw);
    if(!plan?.ok||typeof plan.candidate!=='string'||!plan.candidate)
      throw new Error(plan?.reason||'The staged save failed its strict migration preflight.');
    const current=storage.getItem(saveKey);
    if(current===null)return {gate:'pending-empty',status,storage,stage,plan};
    if(current!==plan.candidate)throw new Error('The recovered copy contains different saved data. Import will not overwrite it.');
    const loaded=loadSave(storage);
    if(loaded?.error||!loaded?.exists||loaded.state?.features?.legacyPendingPhysicalOnly!==1)
      throw new Error(loaded?.error||'The imported candidate failed its reopened proof check.');
    return {gate:'pending-written',status,storage,stage,plan,loaded};
  }catch(error){return {...blocked(error?.message||'The recovered copy could not be verified.'),status,storage};}
}

// The only renderer save write during import. Every dependency is supplied by
// the caller so failure at each boundary can be exercised without a profile.
// A write is intentionally never rolled back: a later process must inspect
// the exact candidate before it can mark the copy ready.
export async function commitPendingCopy({storage,saveKey,candidate,loadSave,restartRecoveredCopy}){
  if(typeof candidate!=='string'||!candidate||!storage||typeof storage.getItem!=='function'||
      typeof storage.setItem!=='function'||typeof loadSave!=='function'||
      typeof restartRecoveredCopy!=='function')throw new Error('The recovered import request is incomplete.');
  if(storage.getItem(saveKey)!==null)
    throw new Error('The recovered copy save key is no longer empty. Import will not overwrite it.');
  storage.setItem(saveKey,candidate);
  if(storage.getItem(saveKey)!==candidate)
    throw new Error('The imported candidate did not read back exactly. The copy remains paused.');
  const checked=loadSave(storage);
  if(checked?.error||!checked?.exists||checked.state?.features?.legacyPendingPhysicalOnly!==1)
    throw new Error(checked?.error||'The imported candidate failed proof validation. The copy remains paused.');
  const result=await restartRecoveredCopy();
  if(result?.ok!==true)
    throw new Error(result?.reason||'The recovered copy could not restart for disk verification.');
  return {ok:true};
}
