const {app,BrowserWindow,protocol,net,session,Menu,dialog,ipcMain}=require('electron');
const path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {realpath,readFile,writeFile,mkdir,rename}=require('node:fs/promises');
const {DEFAULTS,ModelService}=require('./model-provider.cjs');
const {createRawSaveBackupBridge}=require('./raw-save-backup.cjs');
const {resolveProfileRoute}=require('./profile-route.cjs');
let modelService;
const ROOT=path.resolve(__dirname,'..','renderer');
const DEVELOPMENT=process.argv.includes('--dev')&&!app.isPackaged;
const SMOKE=process.argv.includes('--smoke-test');
app.setName('Aincrad');
let profileRoute;
try{
 const smokeDirectory=SMOKE?require('node:fs').mkdtempSync(path.join(os.tmpdir(),'ac-smoke-')):null;
 const argv=smokeDirectory?[...process.argv,'--test',`--test-profile=${smokeDirectory}`]:process.argv;
 profileRoute=resolveProfileRoute({argv,isPackaged:app.isPackaged,defaultUserDataPath:app.getPath('userData')});
 if(profileRoute.isTest){require('node:fs').mkdirSync(profileRoute.userDataPath,{recursive:true});app.setPath('userData',profileRoute.userDataPath);app.setPath('sessionData',profileRoute.userDataPath);}
 if(!app.requestSingleInstanceLock())app.exit(0);
}catch(error){console.error('Aincrad profile routing failed:',error.message);if(!process.argv.includes('--test')&&!SMOKE)dialog.showErrorBox('Aincrad could not start',error.message);app.exit(1);}
let ALLOWED=new Set();
let assetRoot=ROOT;
async function readAssets(){
  assetRoot=await realpath(ROOT);
  const manifest=JSON.parse(await readFile(path.join(ROOT,'asset-manifest.json'),'utf8'));
  if(manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>256)throw new Error('Invalid renderer build. Run npm run build again.');
  const paths=manifest.files.map(file=>file.path);
  if(!paths.every(name=>typeof name==='string'&&/^(?:index\.html|style\.css|icon\.svg|src\/[\w-]+\.js)$/.test(name))||!paths.includes('index.html'))throw new Error('Invalid renderer asset list.');
  ALLOWED=new Set(paths);
}
protocol.registerSchemesAsPrivileged([{scheme:'aincrad',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win;
async function createWindow(){
  win=new BrowserWindow({width:1440,height:900,minWidth:800,minHeight:600,backgroundColor:'#17352c',title:'Aincrad — Ozark watershed',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  // Native visibility can change without a DOM blur when throttling is disabled.
  // Clear held avatar input, while the independent simulation timer keeps running.
  const windowActive=active=>{if(!win.webContents.isDestroyed())win.webContents.send('aincrad:window-active',active);};
  for(const event of ['blur','hide','minimize'])win.on(event,()=>windowActive(false));
  win.on('focus',()=>windowActive(true));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.webContents.on('will-attach-webview',e=>e.preventDefault());
  win.webContents.on('before-input-event',(_e,input)=>{if(input.type==='keyDown'&&input.key==='F11')win.setFullScreen(!win.isFullScreen());});
  win.once('ready-to-show',()=>win.show());
  win.webContents.on('render-process-gone',()=>dialog.showErrorBox('Aincrad','The renderer stopped. Your last local save is retained. Please restart the application.'));
  const query=SMOKE?'?test=1&smoke=1':profileRoute.isTest?'?test=1':'';
  await win.loadURL('aincrad://app/index.html'+query);
}
app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);
  app.on('second-instance',()=>{
    if(win&&!win.isDestroyed()){
      if(win.isMinimized())win.restore();
      win.focus();
    }
  });
  await readAssets();
  const configPath=path.join(app.getPath('userData'),'agent-model.json');
  let config=DEFAULTS;
  if(!SMOKE)try{config=JSON.parse(await readFile(configPath,'utf8'));}catch{}
  try{modelService=new ModelService({config});}catch{modelService=new ModelService();}
  function trusted(event){
    try{const u=new URL(event.senderFrame.url);return event.senderFrame===event.sender.mainFrame&&u.protocol==='aincrad:'&&u.host==='app'&&u.pathname==='/index.html';}catch{return false;}
  }
  const handle=(channel,fn)=>ipcMain.handle(channel,async(event,...args)=>{if(!trusted(event))throw new Error('Untrusted model bridge sender.');return fn(...args);});
  handle('aincrad:model-status',()=>modelService.status());
  handle('aincrad:model-configure',async raw=>{
    const status=modelService.configure(raw);
    await mkdir(path.dirname(configPath),{recursive:true});
    await writeFile(configPath+'.tmp',JSON.stringify(modelService.config,null,2),{mode:0o600});
    await rename(configPath+'.tmp',configPath);return status;
  });
  handle('aincrad:model-decide',raw=>modelService.decide(raw));
  handle('aincrad:model-cancel',agentId=>modelService.cancel(agentId));
  const rawSaveBackup=createRawSaveBackupBridge({dialog,getWindow:()=>win,userDataPath:app.getPath('userData'),documentsPath:app.getPath('documents'),testMode:profileRoute.isTest});
  handle('aincrad:save-export-raw',(raw,sha)=>rawSaveBackup.exportRaw(raw,sha));
  handle('aincrad:save-restore-raw',()=>rawSaveBackup.restoreRaw());
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  protocol.handle('aincrad',async request=>{
    try{
      if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
      const u=new URL(request.url),name=decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html';
      if(u.host!=='app'||!ALLOWED.has(name))return new Response('Not found',{status:404});
      const p=await realpath(path.resolve(assetRoot,name));
      if(path.relative(assetRoot,p).startsWith('..')||path.isAbsolute(path.relative(assetRoot,p)))return new Response('Forbidden',{status:403});
      return net.fetch(pathToFileURL(p).toString());
    }catch{return new Response('Not found',{status:404});}
  });
  await createWindow();
  if(DEVELOPMENT){
    const fs=require('node:fs');let reloadTimer;
    const watcher=fs.watch(ROOT,(_event,name)=>{
      if(String(name)!=='asset-manifest.json')return;clearTimeout(reloadTimer);
      reloadTimer=setTimeout(async()=>{try{await readAssets();if(win&&!win.isDestroyed())win.webContents.reloadIgnoringCache();}catch(error){console.error('Renderer reload failed:',error.message);}},75);
    });
    app.once('before-quit',()=>{clearTimeout(reloadTimer);watcher.close();});
  }
  if(SMOKE){await runSmoke();return;}
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
}).catch(e=>{if(SMOKE||profileRoute?.isTest){console.error(e);app.exit(1);}else{dialog.showErrorBox('Aincrad could not start',e.message);app.quit();}});
// Commit pending localStorage writes after renderer unload and before quitting.
app.on('window-all-closed',()=>{modelService?.cancel();session.defaultSession.flushStorageData();if(process.platform!=='darwin')app.quit();});
app.on('will-quit',()=>{if(app.isReady())session.defaultSession.flushStorageData();});

async function runSmoke(){
 const deadline=setTimeout(()=>{console.error('Desktop smoke test timed out.');app.exit(1);},60000);
 try{
  const prefs=win.webContents.getLastWebPreferences();
  if(prefs.nodeIntegration!==false||prefs.contextIsolation!==true||prefs.sandbox!==true||prefs.webSecurity!==true||process.argv.some(arg=>['--no-sandbox','--disable-setuid-sandbox'].includes(arg)))throw new Error('Native smoke requires the actual renderer sandbox.');
  for(let i=0;i<300;i++){if(await win.webContents.executeJavaScript('Boolean(window.__ozarkWorld)'))break;await new Promise(r=>setTimeout(r,100));}
  const result=await win.webContents.executeJavaScript(`(async()=>{
   const assert=(c,m)=>{if(!c)throw new Error(m);};
   const api=window.__ozarkWorld;assert(Boolean(api),'Single world did not initialize');
   assert(typeof window.require==='undefined','Node leaked into renderer');
   assert(!window.aincradWorld&&!window.aincradProfile,'Retired world/profile bridge remains');
   assert(!document.getElementById('welcome'),'World chooser remains');
   const status=await window.aincradAgent.status();assert(status.enabled===false,'Smoke inference must be disabled');
   const first=api.snapshot();assert(!first.blocked,'Fresh world blocked');assert(first.started===true,'Normal direct-start world is inert');
   assert(first.agents.length===2,'Two characters missing');
   for(const n of first.agents){assert(n.discovery.techniques.length===0,'Fresh agent has supplied skill');assert(Object.keys(n.memory.foods).length===0,'Fresh agent has food answers');}
   assert(first.ecology.plants>0&&first.ecology.animals>0&&first.ecology.fish>0,'Unified living ecology/fish absent');
   const initial=api.snapshot();api.step(1);const next=api.snapshot();
   assert(next.elapsed>=initial.elapsed+1-1e-6,'Shared world clock did not advance');
   assert(next.agents.every(n=>Math.abs(n.elapsed-next.elapsed)<.001),'Agent clocks diverged');
   assert(next.agents.every(n=>n.physiology.totals.metabolizedKcal>0),'Bodies did not pay metabolism');
   document.getElementById('journal-message').focus();window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));assert(api.snapshot().paused,'Escape did not pause');
   const frozen=api.snapshot();await new Promise(r=>setTimeout(r,180));assert(api.snapshot().elapsed===frozen.elapsed,'Pause did not freeze clock');
   window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));assert(!api.snapshot().paused,'Escape did not resume');
   document.getElementById('open-map').click();const beforeMap=api.snapshot().elapsed;await new Promise(r=>setTimeout(r,180));assert(api.snapshot().elapsed>beforeMap,'Map paused world');
   const zoom=document.getElementById('atlas-zoom-label').textContent;document.getElementById('atlas-zoom-in').click();assert(document.getElementById('atlas-zoom-label').textContent!==zoom,'Map zoom failed');document.getElementById('close-map').click();
   document.getElementById('open-npc').click();assert(!document.getElementById('npc-panel').classList.contains('hidden'),'Journal did not open');
   const select=document.getElementById('npc-select');select.value='mira';select.dispatchEvent(new Event('change'));assert(document.getElementById('npc-name').textContent.includes('Mira'),'Mira journal selection failed');
   select.value='aster';select.dispatchEvent(new Event('change'));assert(document.getElementById('npc-name').textContent.includes('Aster'),'Aster journal selection failed');
   document.getElementById('npc-tab-conversation').click();assert(!document.getElementById('journal-conversation').classList.contains('hidden'),'Conversation tab did not open');
   document.getElementById('close-npc').click();assert(document.getElementById('npc-panel').classList.contains('hidden'),'Journal did not close');
   document.getElementById('help-button').click();assert(!document.getElementById('help-panel').classList.contains('hidden'),'Help did not open');document.getElementById('close-help').click();assert(document.getElementById('help-panel').classList.contains('hidden'),'Help did not close');
   assert(api.save()===true,'Current world save failed');
   assert(Boolean(localStorage.getItem('aincrad.world.v2')),'Current save key absent');
   assert(document.getElementById('fatal').classList.contains('hidden'),'Fatal renderer error');
   const {BUILD_SOURCE_FINGERPRINT}=await import('./src/build-info.js');
   return {singleWorld:true,world:'Ozark',emptyInitialFoodKnowledge:true,finiteFishing:true,sharedClock:true,escapePause:true,mapContinues:true,mapZoom:true,currentSave:true,journalAndHelp:true,sourceFingerprint:BUILD_SOURCE_FINGERPRINT};
  })()`);
  const before=await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot().elapsed');
  win.hide();await new Promise(r=>setTimeout(r,450));
  const hidden=await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot()');
  if(hidden.paused||hidden.elapsed-before<.2)throw new Error('Hidden desktop paused world');
  result.hiddenWindowContinues=true;win.show();
  const output=path.join(process.cwd(),'test-results');await mkdir(output,{recursive:true});
  await writeFile(path.join(output,'desktop-smoke.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('open-npc').click();document.getElementById('npc-tab-conversation').click()");
  await new Promise(r=>setTimeout(r,100));
  await writeFile(path.join(output,'desktop-journal-smoke.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('close-npc').click()");
  await writeFile(path.join(output,'desktop-smoke.json'),JSON.stringify(result,null,2));
  console.log('PASS: single Ozark desktop, sandboxed renderer, finite fish, empty initial food knowledge, shared clock, save, map, Escape pause and background progress.');
  clearTimeout(deadline);app.exit(0);
 }catch(error){clearTimeout(deadline);console.error(error);app.exit(1);}
}
