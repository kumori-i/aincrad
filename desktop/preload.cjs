const { contextBridge, ipcRenderer }=require('electron');
// This runs before page scripts. A recovered process remembers whether its
// saved candidate was present at launch, so a same-process reload cannot
// complete a pending import that has not survived a process restart.
if(typeof ipcRenderer.sendSync==='function'&&ipcRenderer.sendSync('aincrad:profile-kind')==='recovered'){
  let raw=null;
  try{
    const value=window.localStorage.getItem('aincrad.save.v1');
    if(typeof value==='string'&&value.length<=16*1024*1024)raw=value;
  }catch{}
  ipcRenderer.sendSync('aincrad:profile-first-save',raw);
}
// A small serializable contract, not Node access or an arbitrary IPC transport.
contextBridge.exposeInMainWorld('aincradAgent',Object.freeze({
  status:()=>ipcRenderer.invoke('aincrad:model-status'),
  configure:config=>ipcRenderer.invoke('aincrad:model-configure',config),
  decide:observation=>ipcRenderer.invoke('aincrad:model-decide',observation),
  cancel:agentId=>ipcRenderer.invoke('aincrad:model-cancel',agentId),
  onWindowActive:listener=>{
    if(typeof listener!=='function')return;
    ipcRenderer.on('aincrad:window-active',(_event,active)=>{if(typeof active==='boolean')listener(active);});
  },
}));
contextBridge.exposeInMainWorld('aincradSave',Object.freeze({
  exportRaw:(raw,expectedSha256)=>ipcRenderer.invoke('aincrad:save-export-raw',raw,expectedSha256),
  restoreRaw:()=>ipcRenderer.invoke('aincrad:save-restore-raw'),
}));
contextBridge.exposeInMainWorld('aincradProfile',Object.freeze({
  status:()=>ipcRenderer.invoke('aincrad:profile-status'),
  createRecoveredCopy:(raw,sha256)=>ipcRenderer.invoke('aincrad:profile-create',raw,sha256),
  openRecoveredCopy:()=>ipcRenderer.invoke('aincrad:profile-open'),
  stagedRaw:()=>ipcRenderer.invoke('aincrad:profile-staged'),
  markReady:()=>ipcRenderer.invoke('aincrad:profile-ready'),
  restartRecoveredCopy:()=>ipcRenderer.invoke('aincrad:profile-restart'),
}));
contextBridge.exposeInMainWorld('aincradWorld',Object.freeze({
  open:world=>ipcRenderer.sendSync('aincrad:world-open',world),
}));
