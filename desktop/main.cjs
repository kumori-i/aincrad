const { app, BrowserWindow, protocol, net, session, Menu, dialog, ipcMain }=require('electron');
const path=require('node:path');
const { pathToFileURL }=require('node:url');
const { realpath, readFile, writeFile, mkdir, rename }=require('node:fs/promises');
const { DEFAULTS, ModelService }=require('./model-provider.cjs');
let modelService;
const ROOT=path.resolve(__dirname,'..');
const SMOKE=process.argv.includes('--smoke-test');
const testProfile=process.argv.includes('--test')?process.argv.find(arg=>arg.startsWith('--test-profile=')):null;
if(testProfile){const fs=require('node:fs'),dir=path.resolve(testProfile.slice('--test-profile='.length));fs.mkdirSync(dir,{recursive:true});app.setPath('userData',dir);}
if(SMOKE){const os=require('node:os'),fs=require('node:fs');app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'aincrad-smoke-')));}
const ALLOWED=new Set(['index.html','style.css','icon.svg','src/main.js','src/config.js','src/world.js','src/save.js','src/art.js','src/renderer.js','src/npc-state.js','src/resources.js','src/perception.js','src/navigation.js','src/npc-memory.js','src/npc.js','src/controller.js','src/npc-panel.js']);
protocol.registerSchemesAsPrivileged([{scheme:'aincrad',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.setName('Aincrad');
let win;
async function createWindow(){
  win=new BrowserWindow({width:1440,height:900,minWidth:800,minHeight:600,backgroundColor:'#17352c',title:'Aincrad',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.webContents.on('will-attach-webview',e=>e.preventDefault());
  win.webContents.on('before-input-event',(_e,input)=>{if(input.type==='keyDown'&&input.key==='F11')win.setFullScreen(!win.isFullScreen());});
  win.once('ready-to-show',()=>win.show());
  win.webContents.on('render-process-gone',()=>dialog.showErrorBox('Aincrad','The renderer stopped. Your last local save is retained. Please restart the application.'));
  await win.loadURL('aincrad://app/index.html'+(process.argv.includes('--test')||SMOKE?'?test=1':''));
}
app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);
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
  handle('aincrad:model-cancel',()=>modelService.cancel());
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  protocol.handle('aincrad',async request=>{
    try{
      const u=new URL(request.url),name=decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html';
      if(u.host!=='app'||!ALLOWED.has(name))return new Response('Not found',{status:404});
      const p=await realpath(path.resolve(ROOT,name));
      if(path.relative(ROOT,p).startsWith('..'))return new Response('Forbidden',{status:403});
      return net.fetch(pathToFileURL(p).toString());
    }catch{return new Response('Not found',{status:404});}
  });
  await createWindow();
  if(SMOKE){await runSmoke();return;}
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
}).catch(e=>{if(SMOKE){console.error(e);app.exit(1);}else{dialog.showErrorBox('Aincrad could not start',e.message);app.quit();}});
app.on('window-all-closed',()=>{modelService?.cancel();if(process.platform!=='darwin')app.quit();});

async function runSmoke(){
  const deadline=setTimeout(()=>{console.error('Desktop smoke test timed out.');app.exit(1);},20000);
  try{
    for(let i=0;i<80;i++){if(await win.webContents.executeJavaScript('Boolean(window.__aincrad)'))break;await new Promise(resolve=>setTimeout(resolve,100));}
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const assert=(condition,message)=>{if(!condition)throw new Error(message);};
      assert(Boolean(window.__aincrad),'Game did not initialize');
      assert(typeof window.require==='undefined','Node leaked into the renderer');
      const status=await window.aincradAgent.status();assert(status.enabled===false,'Smoke inference must be disabled');
      document.getElementById('begin').click();document.getElementById('open-npc').click();
      const initial=window.__aincrad.npc();assert(initial.id==='aster','Persistent NPC is absent');
      assert(initial.memory.skills.length===0,'Initial skill library must be empty');
      const preset=document.getElementById('npc-preset');preset.value='accelerated';preset.dispatchEvent(new Event('change'));
      document.getElementById('npc-demonstrate').click();const collapsed=window.__aincrad.npc();
      assert(collapsed.lifecycle==='COLLAPSED','Demonstration must actually collapse the body');
      window.__aincrad.npcStep(7.2);const rescued=window.__aincrad.npc();
      assert(rescued.lifecycle==='RECOVERING','World rescue did not occur');
      assert(rescued.stats.rescues===1&&rescued.stats.independentDrinks===0,'Rescue received independent credit');
      assert(JSON.stringify(rescued.position)===JSON.stringify(collapsed.position),'Rescue fast-travelled the NPC');
      window.__aincrad.npcStep(2.2);const awake=window.__aincrad.npc();assert(awake.lifecycle==='AWAKE','Recovery did not complete');
      assert(awake.id===initial.id&&awake.stats.collapses===1,'Identity or lifecycle counts changed');
      window.__aincrad.save();assert(document.getElementById('fatal').classList.contains('hidden'),'A renderer error occurred');
      return {identity:awake.id,lifecycle:awake.lifecycle,collapses:awake.stats.collapses,rescues:awake.stats.rescues,provider:'offline experiential learner; no live inference'};
    })()`);
    await new Promise(resolve=>setTimeout(resolve,650));
    const output=path.join(process.cwd(),'test-results');await mkdir(output,{recursive:true});
    await writeFile(path.join(output,'desktop-smoke.png'),(await win.webContents.capturePage()).toPNG());
    await writeFile(path.join(output,'desktop-smoke.json'),JSON.stringify(result,null,2));
    console.log('PASS: desktop launch, sandboxed renderer configuration, local bridge, one persistent NPC, collapse, rescue provenance, recovery, retained identity and no rescue teleport.');
    clearTimeout(deadline);app.exit(0);
  }catch(error){clearTimeout(deadline);console.error(error);app.exit(1);}
}
