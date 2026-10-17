const { app, BrowserWindow, protocol, net, session, Menu, dialog, ipcMain }=require('electron');
const path=require('node:path');
const { pathToFileURL }=require('node:url');
const {createHash}=require('node:crypto');
const os=require('node:os');
const { realpath, readFile, writeFile, mkdir, rename }=require('node:fs/promises');
const { DEFAULTS, ModelService }=require('./model-provider.cjs');
const { createRawSaveBackupBridge }=require('./raw-save-backup.cjs');
const {COPY_FLAG,assertRecoveredCopySupported,resolveProfileRoute,assertCopyDirectory,
  createRecoveredProfileManager}=require('./recovered-profile.cjs');
let modelService;
const ROOT=path.resolve(__dirname,'..','renderer');
const DEVELOPMENT=process.argv.includes('--dev')&&!app.isPackaged;
const SMOKE=process.argv.includes('--smoke-test');
const pilotOptions=process.argv.filter(value=>value.startsWith('--test-ozark-pilot'));
const PILOT_REQUESTED=pilotOptions.includes('--test-ozark-pilot');
const nativeQaOptions=process.argv.filter(value=>value.startsWith('--test-native-qa'));
const nativeQaOption=nativeQaOptions[0];
let restartFault=null,publicationFault=null,profileOpenFault=null;
app.setName('Aincrad');
let profileRoute;
// Capture the temp root used by profile routing for a failure-only native QA
// diagnosis. No environment value or path is printed by the product.
const nativeQaRouteTemp=process.platform==='win32'&&nativeQaOption?os.tmpdir():null;
try{
  if(pilotOptions.length>1||pilotOptions.some(value=>value!=='--test-ozark-pilot')||
      PILOT_REQUESTED&&(SMOKE||app.isPackaged||
        !process.argv.includes('--test')||
        !process.argv.some(value=>value.startsWith('--test-profile='))||
        process.argv.includes(COPY_FLAG)))
    throw new Error('The Ozark walking pilot requires an unpackaged, isolated original test profile.');
  const smokeDirectory=SMOKE?require('node:fs').mkdtempSync(path.join(os.tmpdir(),'aincrad-smoke-')):null;
  const routeArgs=smokeDirectory?[...process.argv,'--test',`--test-profile=${smokeDirectory}`,
    `--test-recovered-root=${smokeDirectory}-recovered-proof-v1`]:process.argv;
  profileRoute=resolveProfileRoute({argv:routeArgs,isPackaged:app.isPackaged,
    appDataPath:app.getPath('appData'),defaultUserDataPath:app.getPath('userData')});
  if(PILOT_REQUESTED&&(!profileRoute.isTest||!profileRoute.usesTestPaths||
      profileRoute.kind!=='original'))
    throw new Error('The Ozark walking pilot requires an unpackaged, isolated original test profile.');
  if(nativeQaOptions.length>1||nativeQaOption&&!nativeQaOption.startsWith('--test-native-qa=')||
     nativeQaOption&&(!profileRoute.isTest||!profileRoute.usesTestPaths||SMOKE||
       !process.argv.some(value=>value.startsWith('--test-profile='))||
       !process.argv.some(value=>value.startsWith('--test-recovered-root='))))
    throw new Error('Native QA requires one unpackaged test launch with two explicit disposable profile roots.');
  if(SMOKE){
    app.setPath('userData',smokeDirectory);app.setPath('sessionData',smokeDirectory);
  }else if(profileRoute.kind==='recovered'){
    assertCopyDirectory(profileRoute.copyPath);
    app.setPath('userData',profileRoute.copyPath);app.setPath('sessionData',profileRoute.copyPath);
  }else if(profileRoute.usesTestPaths){
    const fs=require('node:fs');fs.mkdirSync(profileRoute.originalPath,{recursive:true});
    app.setPath('userData',profileRoute.originalPath);app.setPath('sessionData',profileRoute.originalPath);
  }
  if(!app.requestSingleInstanceLock())app.exit(0);
}catch(error){
  console.error('Aincrad profile routing failed:',error.message);
  if(!profileRoute?.isTest)dialog.showErrorBox('Aincrad could not open this world',error.message);
  app.exit(1);
}
let ALLOWED=new Set();
async function readAssets(){
  const manifest=JSON.parse(await readFile(path.join(ROOT,'asset-manifest.json'),'utf8'));
  if(manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>128)throw new Error('Invalid renderer build. Run npm run build again.');
  const paths=manifest.files.map(file=>file.path);
  if(!paths.every(name=>typeof name==='string'&&/^(?:index\.html|style\.css|icon\.svg|src\/[\w-]+\.js)$/.test(name))||!paths.includes('index.html'))throw new Error('Invalid renderer asset list.');
  ALLOWED=new Set(paths);
}
protocol.registerSchemesAsPrivileged([{scheme:'aincrad',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win;
let firstRecoveredLoadResolve;
const firstRecoveredLoad=profileRoute.kind==='recovered'
  ?new Promise(resolve=>{firstRecoveredLoadResolve=resolve;}):null;
async function createWindow(){
  win=new BrowserWindow({width:1440,height:900,minWidth:800,minHeight:600,backgroundColor:'#17352c',title:profileRoute.kind==='recovered'?'Aincrad — Recovered copy':'Aincrad — Original world',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false,backgroundThrottling:false}});
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
  const query=PILOT_REQUESTED?'?test=1&ozarkPilot=1':
    process.argv.includes('--test')||SMOKE?'?test=1':'';
  await win.loadURL('aincrad://app/index.html'+query);
}
app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);
  if(profileRoute.kind==='recovered'){
    const actual=session.defaultSession.storagePath;
    if(typeof actual!=='string'||!actual)throw new Error('The recovered copy has no separate Electron storage path.');
    const [storage,copy]=await Promise.all([realpath(actual),realpath(profileRoute.copyPath)]);
    const relative=path.relative(copy,storage);
    if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))
      throw new Error('Electron storage does not belong to the recovered copy profile.');
    const original=path.resolve(profileRoute.originalPath);
    const fromOriginal=path.relative(original,storage);
    if(fromOriginal===''||fromOriginal!=='..'&&!fromOriginal.startsWith(`..${path.sep}`)&&!path.isAbsolute(fromOriginal))
      throw new Error('Recovered Electron storage aliases the original profile.');
  }
  ipcMain.on('aincrad:profile-kind',event=>{
    event.returnValue=event.sender===win?.webContents&&event.senderFrame===event.sender.mainFrame
      ?profileRoute.kind:'invalid';
  });
  ipcMain.on('aincrad:profile-first-save',(event,raw)=>{
    event.returnValue=false;
    if(profileRoute.kind!=='recovered'||event.sender!==win?.webContents||
       event.senderFrame!==event.sender.mainFrame||!firstRecoveredLoadResolve)return;
    let initial=null;
    if(typeof raw==='string'&&raw.length<=16*1024*1024){
      const bytes=Buffer.from(raw,'utf8');
      if(bytes.length<=16*1024*1024&&bytes.toString('utf8')===raw)
        initial={sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length};
    }
    firstRecoveredLoadResolve(initial);firstRecoveredLoadResolve=null;
    event.returnValue=true;
  });
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
  ipcMain.on('aincrad:world-open',(event,world)=>{
    if(!trusted(event)||event.sender!==win?.webContents||
       profileRoute.kind!=='original'||PILOT_REQUESTED||SMOKE||
       !['original','ozark'].includes(world)||!win||win.isDestroyed()){
      event.returnValue={ok:false,reason:'World switching is unavailable in this profile.'};
      return;
    }
    const current=new URL(win.webContents.getURL()).search;
    if(!['','?test=1','?ozarkWorld=1','?test=1&ozarkWorld=1'].includes(current)){
      event.returnValue={ok:false,reason:'World switching is unavailable on this route.'};
      return;
    }
    const query=world==='ozark'
      ?(profileRoute.isTest?'?test=1&ozarkWorld=1':'?ozarkWorld=1')
      :(profileRoute.isTest?'?test=1':'');
    // Acknowledge while the calling frame still exists, then navigate on the
    // next event-loop turn. Awaiting loadURL inside an invoke destroys its own
    // reply target as soon as the old document unloads.
    event.returnValue={ok:true};
    setTimeout(()=>{
      if(win?.isDestroyed())return;
      win.loadURL('aincrad://app/index.html'+query).then(()=>{
        if(!win.isDestroyed())win.setTitle(world==='ozark'?'Aincrad — Ozark wilderness':'Aincrad — Original world');
      }).catch(error=>{
        if(!win.isDestroyed())dialog.showErrorBox('Aincrad could not open this world',error.message);
      });
    },0);
  });
  handle('aincrad:model-status',()=>modelService.status());
  handle('aincrad:model-configure',async raw=>{
    const status=modelService.configure(raw);
    await mkdir(path.dirname(configPath),{recursive:true});
    await writeFile(configPath+'.tmp',JSON.stringify(modelService.config,null,2),{mode:0o600});
    await rename(configPath+'.tmp',configPath);return status;
  });
  handle('aincrad:model-decide',raw=>modelService.decide(raw));
  handle('aincrad:model-cancel',agentId=>modelService.cancel(agentId));
  const rawSaveBackup=createRawSaveBackupBridge({dialog,getWindow:()=>win,userDataPath:app.getPath('userData'),
    forbiddenProfilePaths:[profileRoute.kind==='recovered'?profileRoute.originalPath:profileRoute.copyPath],
    documentsPath:app.getPath('documents'),testMode:profileRoute.isTest&&profileRoute.usesTestPaths});
  const recoveredProfile=createRecoveredProfileManager({...profileRoute,
    ...(nativeQaOption?{testPublicationFault:point=>{
      if(publicationFault===point){app.exit(87);throw new Error('Injected test publication exit.');}
    }}:{})});
  handle('aincrad:save-export-raw',(raw,expectedSha256)=>rawSaveBackup.exportRaw(raw,expectedSha256));
  handle('aincrad:save-restore-raw',()=>rawSaveBackup.restoreRaw());
  handle('aincrad:profile-status',()=>recoveredProfile.status());
  handle('aincrad:profile-create',async(raw,sha256)=>{
    assertRecoveredCopySupported();
    const verified=await rawSaveBackup.reverifyTicket(raw,sha256);
    return recoveredProfile.create(verified.raw,verified.sha256);
  });
  function relaunchRecovered(){
    assertRecoveredCopySupported();
    const args=process.argv.slice(1).filter(value=>value!==COPY_FLAG);
    app.relaunch({args:[...args,COPY_FLAG]});
    setTimeout(()=>app.quit(),100);
    return {ok:true};
  }
  handle('aincrad:profile-open',async()=>{
    assertRecoveredCopySupported();
    if(profileRoute.kind!=='original')throw new Error('The recovered copy is already open.');
    const status=await recoveredProfile.status();
    if(!status.available)throw new Error(status.reason||'No verified recovered copy is available to open.');
    if(nativeQaOption&&profileOpenFault==='reject')throw new Error('Injected test profile-open failure.');
    if(nativeQaOption&&profileOpenFault==='delay')await new Promise(resolve=>setTimeout(resolve,1500));
    // The original may be an active, writable world. Its explicit save must
    // reach Electron storage before this process quits for the copy.
    await session.defaultSession.flushStorageData();
    return relaunchRecovered();
  });
  handle('aincrad:profile-staged',()=>{assertRecoveredCopySupported();return recoveredProfile.stagedRaw();});
  handle('aincrad:profile-ready',async()=>{
    assertRecoveredCopySupported();
    const first=firstRecoveredLoad&&await Promise.race([firstRecoveredLoad,new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);
    if(!first)
      throw new Error('A recovered import must be verified after a closed-process restart.');
    const staged=await recoveredProfile.stagedRaw();
    const {prepareLegacyPendingMigration}=await import(pathToFileURL(path.join(ROOT,'src','save.js')).href);
    const migration=prepareLegacyPendingMigration(staged.raw);
    if(!migration.ok)throw new Error('The staged source no longer passes the migration proof audit.');
    const candidate=Buffer.from(migration.candidate,'utf8');
    const candidateSha256=createHash('sha256').update(candidate).digest('hex');
    if(candidate.length!==first.byteLength||candidateSha256!==first.sha256)
      throw new Error('The recovered candidate did not survive a closed-process restart.');
    const current=await win.webContents.executeJavaScript("window.localStorage.getItem('aincrad.save.v1')");
    if(current!==migration.candidate)throw new Error('The recovered copy differs from the verified migration candidate.');
    await session.defaultSession.flushStorageData();
    return recoveredProfile.markReady({sourceSha256:staged.sha256,candidateSha256,
      candidateByteLength:candidate.length,bootSaveSha256:first.sha256,
      bootSaveByteLength:first.byteLength});
  });
  handle('aincrad:profile-restart',async()=>{
    assertRecoveredCopySupported();
    if(profileRoute.kind!=='recovered')throw new Error('Restart into a recovered copy only from that copy.');
    const status=await recoveredProfile.status();
    if(!status.available)throw new Error(status.reason||'The recovered copy cannot be reopened.');
    if(nativeQaOption&&restartFault==='reject')throw new Error('Injected test restart failure.');
    if(nativeQaOption&&restartFault==='exit'){app.exit(86);throw new Error('Injected test restart exit.');}
    await session.defaultSession.flushStorageData();
    return relaunchRecovered();
  });
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  protocol.handle('aincrad',async request=>{
    try{
      if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
      const u=new URL(request.url),name=decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html';
      if(u.host!=='app'||!ALLOWED.has(name))return new Response('Not found',{status:404});
      const p=await realpath(path.resolve(ROOT,name));
      if(path.relative(ROOT,p).startsWith('..'))return new Response('Forbidden',{status:403});
      return net.fetch(pathToFileURL(p).toString());
    }catch{return new Response('Not found',{status:404});}
  });
  await createWindow();
  if(nativeQaOption){
    const {runNativeProfileQa}=require(path.resolve(__dirname,'..','..','tests','native-profile-qa-driver.cjs'));
    await runNativeProfileQa({app,win,session,profileRoute,rawSaveBackup,recoveredProfile,
      configPath:nativeQaOption.slice('--test-native-qa='.length),
      routeTempRoot:nativeQaRouteTemp,
      setRestartFault:value=>{
        if(!['reject','exit',null].includes(value))throw new Error('Unknown native restart fault.');
        restartFault=value;
      },
      setPublicationFault:value=>{
        if(!['after-slot-mkdir','before-manifest',null].includes(value))throw new Error('Unknown native publication fault.');
        publicationFault=value;
      },
      setProfileOpenFault:value=>{
        if(!['delay','reject',null].includes(value))throw new Error('Unknown native profile-open fault.');
        profileOpenFault=value;
      }});
    return;
  }
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
  const deadline=setTimeout(()=>{console.error('Desktop smoke test timed out.');app.exit(1);},30000);
  try{
    for(let i=0;i<80;i++){if(await win.webContents.executeJavaScript('Boolean(window.__aincrad)'))break;await new Promise(resolve=>setTimeout(resolve,100));}
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const assert=(condition,message)=>{if(!condition)throw new Error(message);};
      assert(Boolean(window.__aincrad),'Game did not initialize');
      assert(typeof window.require==='undefined','Node leaked into the renderer');
      const status=await window.aincradAgent.status();assert(status.enabled===false,'Smoke inference must be disabled');
      document.getElementById('watch-aster').click();
      const initial=window.__aincrad.snapshot(),pair=initial.agents;
      assert(initial.version===8&&initial.features?.plantLifecycle===1&&initial.simulationMode==='discovery','Fresh expedition must use discovery rules');
      assert(pair.length===2&&pair[0].id==='aster'&&pair[1].id==='mira','The two independent characters are absent');
      for(const n of pair){
        assert(n.mode==='discovery'&&n.physiology&&n.health===100,'Game-hour body did not initialize');
        assert(n.discovery.techniques.length===0&&n.memory.skills.length===0,'Fresh agents were given techniques');
        assert(Object.keys(n.memory.foods).length===0,'Fresh agents were told which objects are food');
        assert(Object.keys(n.memory.sources).length>0,'Starter water must be locally observed');
      }
      assert(initial.environment.ecology.animals.length>0&&initial.environment.ecology.plants.length>0,'Living ecology is absent');
      const {ecologyCoverage}=await import('./src/ecology.js');const coverage=ecologyCoverage(initial.environment.ecology);
      assert(coverage.plantRegions===coverage.regions&&coverage.animalRegions>=8,'Regional producers and distributed consumer refuges are absent');
      const {regionalResourceAudit}=await import('./src/ecology-regions.js');const regional=regionalResourceAudit(initial.environment.ecology);
      assert(regional.regions===49&&Math.abs(regional.soilBalanceError)<1e-6,'Regional stocks failed to initialize');
      assert(initial.cardinal.version===1&&initial.cardinal.mode==='adaptive','Cardinal is not active in a new expedition');
      assert(initial.environment.worldRules.version===1,'Authoritative world rules are absent');
      const {BUILD_SOURCE_FINGERPRINT}=await import('./src/build-info.js');
      assert(/^[a-f0-9]{64}$/.test(BUILD_SOURCE_FINGERPRINT),'Built source provenance is absent');
      assert(!('ecology' in initial),'Ecology has duplicate ownership');
      assert(document.getElementById('npc-condition').classList.contains('hidden'),'Exact physiology must be hidden');
      const {decisionObservation}=await import('./src/controller.js');const observation=decisionObservation(pair[0]);
      assert(typeof observation.condition.body.hunger==='string'&&!('physiology' in observation)&&!('knownFoods' in observation),'Model observation leaked private state or food answers');
      const select=document.getElementById('npc-select');select.value='mira';select.dispatchEvent(new Event('change'));assert(window.__aincrad.npc().id==='mira','Character selection failed');select.value='aster';select.dispatchEvent(new Event('change'));
      const message=window.__aincrad.postMessage('How are you feeling?','mira');assert(message.ok&&window.__aincrad.conversation().messages.some(m=>m.senderId==='human'),'Human journal did not store a message');
      const clock=window.__aincrad.environment().elapsed;window.__aincrad.npcStep(2);
      const current=window.__aincrad.snapshot();assert(Math.abs(current.environment.elapsed-clock-2)<0.001,'Shared clock advanced incorrectly');
      assert(current.agents.every(n=>Math.abs(n.elapsed-current.environment.elapsed)<0.001),'One character stopped advancing');
      assert(current.agents[0].physiology.totals.metabolizedKcal>0,'Body did not metabolize energy');
      assert(window.__aincrad.environment().ecology.elapsed>initial.environment.ecology.elapsed,'Ecology clock stopped');
      // Escape is honored even while the journal input owns keyboard focus.
      document.getElementById('journal-message').focus();window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));assert(window.__aincrad.metrics().paused,'Escape did not pause');
      const frozen=window.__aincrad.snapshot().elapsed;await new Promise(r=>setTimeout(r,180));assert(window.__aincrad.snapshot().elapsed===frozen,'Explicit pause did not freeze simulation');
      window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));assert(!window.__aincrad.metrics().paused,'Escape did not resume');
      document.getElementById('open-map').click();const beforeMap=window.__aincrad.snapshot().elapsed;await new Promise(r=>setTimeout(r,180));assert(window.__aincrad.snapshot().elapsed>beforeMap,'Map paused simulation');
      const atlasBefore=window.__aincrad.atlas();assert(atlasBefore.markers.some(m=>m.id==='aster')&&atlasBefore.markers.some(m=>m.id==='mira'),'Human map markers are absent');
      document.getElementById('atlas-zoom-in').click();assert(window.__aincrad.atlas().status.zoom>atlasBefore.status.zoom,'Field map did not zoom');document.getElementById('close-map').click();
      document.getElementById('open-cardinal').click();const beforeCardinal=window.__aincrad.snapshot().elapsed;await new Promise(r=>setTimeout(r,180));assert(window.__aincrad.snapshot().elapsed>beforeCardinal,'Cardinal panel paused simulation');document.getElementById('close-cardinal').click();
      window.__aincrad.save();assert(document.getElementById('fatal').classList.contains('hidden'),'A renderer error occurred');
      return {version:'0.7.0',mode:initial.simulationMode,characters:pair.map(n=>n.id),emptyInitialFoodKnowledge:true,qualitativeObservation:observation.condition.body,journalMessages:window.__aincrad.conversation().messages.length,sharedClock:true,livingEcology:true,coverage,regional,cardinalAdaptive:true,sourceFingerprint:BUILD_SOURCE_FINGERPRINT,escapePause:true,mapContinues:true,mapZoomAndMarkers:true,cardinalPanelContinues:true,provider:'offline experiential controller; no live inference'};
    })()`);
    const before=await win.webContents.executeJavaScript('window.__aincrad.snapshot().elapsed');
    win.hide();await new Promise(resolve=>setTimeout(resolve,450));
    const hidden=await win.webContents.executeJavaScript('({elapsed:window.__aincrad.snapshot().elapsed,paused:window.__aincrad.metrics().paused})');
    if(hidden.paused||hidden.elapsed-before<.2)throw new Error('Hidden desktop window paused the simulation');
    result.hiddenWindowContinues=true;win.show();
    const output=path.join(process.cwd(),'test-results');await mkdir(output,{recursive:true});
    await writeFile(path.join(output,'desktop-smoke.png'),(await win.webContents.capturePage()).toPNG());
    await writeFile(path.join(output,'desktop-smoke.json'),JSON.stringify(result,null,2));
    console.log('PASS: native desktop, sandboxed renderer, two discovery characters, empty food knowledge, qualitative journal, shared ecology/body clock, Escape pause, and background progress.');
    clearTimeout(deadline);app.exit(0);
  }catch(error){clearTimeout(deadline);console.error(error);app.exit(1);}
}
