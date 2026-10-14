const { contextBridge, ipcRenderer }=require('electron');
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
