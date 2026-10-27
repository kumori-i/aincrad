const { contextBridge, ipcRenderer }=require('electron');
// A small serializable contract, not Node access or an arbitrary IPC transport.
contextBridge.exposeInMainWorld('aincradAgent',Object.freeze({
  status:()=>ipcRenderer.invoke('aincrad:model-status'),
  configure:config=>ipcRenderer.invoke('aincrad:model-configure',config),
  decide:observation=>ipcRenderer.invoke('aincrad:model-decide',observation),
  proposeName:evidence=>ipcRenderer.invoke('aincrad:model-name',evidence),
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

// Current-world backup has its own fixed contract; legacy formats are not used.
contextBridge.exposeInMainWorld('aincradWorldSave',Object.freeze({
  exportCurrentWorld:raw=>ipcRenderer.invoke('aincrad:current-world-export',raw),
  reloadCurrentWorld:()=>ipcRenderer.invoke('aincrad:current-world-reload'),
}));
