import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await buildApplication();
let child,closing=false,desktopChanged=false,pending=false,building=false,timer;
const flags=process.argv.slice(2);
function launch(){
  const processChild=spawn(process.execPath,['scripts/start.mjs','--dev',...flags],{cwd:root,stdio:'inherit'});
  child=processChild;
  processChild.once('error',error=>{console.error(error.message);finish(1);});
  processChild.once('exit',code=>{if(child===processChild&&!closing)finish(code??1);});
}
const watchers=[];
function finish(code){
  if(closing)return;closing=true;clearTimeout(timer);
  for(const watcher of watchers)watcher.close();
  child?.kill();process.exitCode=code;
}
async function rebuild(){
  pending=true;if(building)return;building=true;
  try{
    while(pending&&!closing){
      pending=false;const restart=desktopChanged;desktopChanged=false;
      await buildApplication();
      if(restart){
        const old=child;child=undefined;
        await new Promise(resolve=>{old.once('exit',resolve);old.kill();});
        if(!closing)launch();
      }
      console.log(restart?'Desktop changes rebuilt; application restarted.':'Renderer changes rebuilt; application reloaded.');
    }
  }catch(error){console.error('Build failed:',error.message);console.error('Fix the file and save again to retry.');}
  finally{building=false;}
}
function schedule(isDesktop){
  desktopChanged ||= isDesktop;clearTimeout(timer);timer=setTimeout(()=>void rebuild(),100);
}
for(const directory of ['src','desktop'])watchers.push(watch(resolve(root,directory),(_event,name)=>{
  if(name&&/\.(js|cjs)$/.test(String(name)))schedule(directory==='desktop');
}));
watchers.push(watch(root,(_event,name)=>{if(['index.html','style.css','icon.svg'].includes(String(name)))schedule(false);}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>finish(0));
launch();
console.log('Aincrad development window is open. Save renderer files to reload; desktop changes restart the app. Ctrl+C stops development.');
