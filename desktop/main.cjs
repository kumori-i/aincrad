const { app, BrowserWindow, protocol, net, session, Menu, dialog }=require('electron');
const path=require('node:path');
const { pathToFileURL }=require('node:url');
const { realpath }=require('node:fs/promises');
const ROOT=path.resolve(__dirname,'..');
const ALLOWED=new Set(['index.html','style.css','icon.svg','src/main.js','src/config.js','src/world.js','src/save.js','src/art.js','src/renderer.js']);
protocol.registerSchemesAsPrivileged([{scheme:'aincrad',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.setName('Aincrad');
let win;
async function createWindow(){
  win=new BrowserWindow({width:1440,height:900,minWidth:800,minHeight:600,backgroundColor:'#17352c',title:'Aincrad',show:false,autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.webContents.on('will-attach-webview',e=>e.preventDefault());
  win.webContents.on('before-input-event',(_e,input)=>{if(input.type==='keyDown'&&input.key==='F11')win.setFullScreen(!win.isFullScreen());});
  win.once('ready-to-show',()=>win.show());
  win.webContents.on('render-process-gone',()=>dialog.showErrorBox('Aincrad','The renderer stopped. Your last local save is retained. Please restart the application.'));
  await win.loadURL('aincrad://app/index.html'+(process.argv.includes('--test')?'?test=1':''));
}
app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);
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
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
}).catch(e=>{dialog.showErrorBox('Aincrad could not start',e.message);app.quit();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
