'use strict';
// Disposable Electron owner. No preload/IPC and no access to a user's profile.
const {app,BrowserWindow,protocol,net,session,Menu}=require('electron');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const{createHash}=require('node:crypto');
if(process.getuid?.()===0)throw Error('Root execution unsupported: sandbox must remain enabled');
const{WORKER_CSP,WORKER_PATHS,assetName}=require('./native-policy.cjs');
const configPath=process.argv.find(x=>x.startsWith('--stage-a-config='))?.slice(17);
if(!configPath)throw Error('Explicit isolated config required');
const config=JSON.parse(fs.readFileSync(configPath,'utf8')),root=path.resolve(config.rendererRoot),output=path.resolve(config.output);
fs.mkdirSync(output,{recursive:true});fs.mkdirSync(config.profile,{recursive:true});app.setPath('userData',config.profile);
protocol.registerSchemesAsPrivileged([{scheme:'aincrad',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let done=false,win,memTimer;const memory=[],consoleRows=[];const started=performance.now();
const deadline=setTimeout(()=>finish({completed:false,error:{message:'Native arm 180-second watchdog expired'},resourceCensored:true}),180000);
function captureMemory(){if(!app.isReady())return;memory.push({atMs:performance.now()-started,processes:app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,name:m.name,cpu:m.cpu,memory:m.memory}))});}
async function finish(result){if(done)return;done=true;clearTimeout(deadline);clearInterval(memTimer);captureMemory();
 try{const report={...result,owner:{processVersions:process.versions,platform:process.platform,arch:process.arch,rendererRoot:root,profile:config.profile,wallMs:performance.now()-started,memorySamples:memory,memorySampling:{intervalMs:250,kind:'Sampled per-process footprints; transient peaks may occur between samples',rendererHeap:'Post-measurement-window performance.memory values'},consoleRows,workerEntryCsp:WORKER_CSP}};await fsp.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));if(win&&!win.isDestroyed())await fsp.writeFile(path.join(output,'view.png'),(await win.webContents.capturePage()).toPNG());session.defaultSession.flushStorageData();app.exit(result.completed?0:1);}catch(error){console.error(error);app.exit(1);}}
app.whenReady().then(async()=>{
 Menu.setApplicationMenu(null);const allowed=new Set(config.allowedPaths);
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);
 protocol.handle('aincrad',async request=>{try{if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const name=assetName(request.url,allowed);if(!name)return new Response('Not found',{status:404});const target=await fsp.realpath(path.join(root,name));if(path.relative(root,target).startsWith('..'))return new Response('Forbidden',{status:403});if(target!==path.resolve(root,name))return new Response('Symlinks prohibited',{status:403});const expected=config.assets.find(f=>f.path===name),bytes=await fsp.readFile(target);if(!expected||bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)return new Response('Frozen asset changed',{status:409});const headers=new Headers({'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':name.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});if(WORKER_PATHS.has(name))headers.set('Content-Security-Policy',WORKER_CSP);return new Response(bytes,{status:200,headers});}catch{return new Response('Not found',{status:404});}});
 win=new BrowserWindow({width:1440,height:900,show:true,autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false,spellcheck:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.on('will-attach-webview',e=>e.preventDefault());
 win.webContents.on('render-process-gone',(_e,details)=>finish({completed:false,error:{message:'Renderer exited',details}}));
 win.webContents.on('console-message',details=>{const message=details.message||'';if(message.startsWith('STAGE_A_SAMPLE ')){try{const row=JSON.parse(message.slice(15));fs.appendFileSync(path.join(output,'samples.ndjson'),JSON.stringify(row)+'\n');}catch(error){finish({completed:false,error:{message:'Sample evidence persistence failed',detail:String(error.message)}});}}else consoleRows.push({level:details.level,message:message.slice(0,2000),sourceId:details.sourceId});});
 captureMemory();memTimer=setInterval(captureMemory,250);
 await win.loadURL('aincrad://app/prototype/save-stage-a/harness.html');
 for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript('Boolean(window.__stageA?.ready)'))break;await new Promise(r=>setTimeout(r,50));}
 const result=await win.webContents.executeJavaScript(`window.__stageA.run(${JSON.stringify(config.trial)})`);await finish(result);
}).catch(error=>finish({completed:false,error:{message:String(error.message),stack:error.stack}}));
app.on('window-all-closed',()=>{if(!done)finish({completed:false,error:{message:'Window closed unexpectedly'}});});
