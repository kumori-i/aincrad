import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ALLOWED=new Set(['index.html','style.css','icon.svg','src/main.js','src/config.js','src/world.js','src/save.js','src/art.js','src/renderer.js']);
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
export async function startServer({port=4173,open=false}={}){
  const server=http.createServer(async(req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
    let pathname;
    try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400);res.end('Bad request');return;}
    const name=pathname==='/'?'index.html':pathname.slice(1);
    if(!ALLOWED.has(name)){res.writeHead(404);res.end('Not found');return;}
    try{
      const path=await realpath(resolve(ROOT,name));
      if(relative(ROOT,path).startsWith('..')){res.writeHead(403);res.end('Forbidden');return;}
      const data=await readFile(path);
      res.writeHead(200,{'Content-Type':MIME[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const actual=server.address().port,url=`http://127.0.0.1:${actual}`;
  if(open){
    const [cmd,args]=process.platform==='win32'?['cmd.exe',['/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
    const child=spawn(cmd,args,{stdio:'ignore',detached:true});child.on('error',()=>{});child.unref();
  }
  return{server,url};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const p=process.argv.indexOf('--port');const port=p>=0?Number(process.argv[p+1]):4173;
  if(!Number.isInteger(port)||port<0||port>65535){console.error('Use --port followed by a port between 0 and 65535.');process.exit(1);}
  try{
    const {url}=await startServer({port,open:!process.argv.includes('--no-open')});
    console.log(`\nAincrad is running locally: ${url}\nKeep this terminal open. Ctrl+C stops the server.\nNo dependencies or internet connection are needed in browser mode.\n`);
  }catch(e){console.error(`Could not start the local server: ${e.message}\nTry npm run web -- --port 4174`);process.exitCode=1;}
}
