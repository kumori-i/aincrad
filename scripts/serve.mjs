/** Loopback-only renderer QA utility; normal development opens Electron directly. */
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
export async function startServer({port=4173,assetRoot=resolve(ROOT,'dist/renderer')}={}){
  const root=await realpath(assetRoot);
  const manifest=JSON.parse(await readFile(resolve(root,'asset-manifest.json'),'utf8'));
  if(manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>128)throw new Error('Invalid desktop renderer build. Run npm run build.');
  const allowed=new Set(manifest.files.map(file=>file.path));
  if(![...allowed].every(name=>typeof name==='string'&&/^(?:index\.html|style\.css|icon\.svg|src\/[\w-]+\.js)$/.test(name)))throw new Error('Invalid renderer asset list.');
  const server=http.createServer(async(req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
    let pathname;
    try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400);res.end('Bad request');return;}
    const name=pathname==='/'?'index.html':pathname.slice(1);
    if(!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
    try{
      const path=await realpath(resolve(root,name));
      if(relative(root,path).startsWith('..')){res.writeHead(403);res.end('Forbidden');return;}
      const data=await readFile(path);
      res.writeHead(200,{'Content-Type':MIME[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return{server,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const p=process.argv.indexOf('--port');const port=p>=0?Number(process.argv[p+1]):4173;
  if(!Number.isInteger(port)||port<0||port>65535){console.error('Use --port followed by a port between 0 and 65535.');process.exit(1);}
  try{const {url}=await startServer({port});console.log(`Renderer QA endpoint: ${url}. Ctrl+C stops it. Use npm run dev for the desktop application.`);}
  catch(e){console.error(`Could not start renderer QA: ${e.message}`);process.exitCode=1;}
}
