/** Build the local desktop application. Renderer assets are internal app files. */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const DIST=resolve(ROOT,'dist');
const hash=data=>createHash('sha256').update(data).digest('hex');
async function replaceFile(destination,data){
  await mkdir(dirname(destination),{recursive:true});
  await writeFile(destination+'.tmp',data);
  await rename(destination+'.tmp',destination);
}
export async function buildApplication(destination=DIST){
  const renderer=resolve(destination,'renderer'),desktop=resolve(destination,'desktop');
  await mkdir(renderer,{recursive:true});await mkdir(desktop,{recursive:true});
  const modules=(await readdir(resolve(ROOT,'src'))).filter(name=>/^[\w-]+\.js$/.test(name)).sort();
  const paths=['index.html','style.css','icon.svg',...modules.map(name=>`src/${name}`)];
  const files=[];
  for(const path of paths){
    const data=await readFile(resolve(ROOT,path));
    await replaceFile(resolve(renderer,path),data);
    files.push({path,sha256:hash(data)});
  }
  const desktopFiles=(await readdir(resolve(ROOT,'desktop'))).filter(name=>/^[\w-]+\.cjs$/.test(name)).sort();
  for(const name of desktopFiles)await replaceFile(resolve(desktop,name),await readFile(resolve(ROOT,'desktop',name)));
  // Remove stale generated modules; they must never survive through a later build.
  for(const name of await readdir(resolve(renderer,'src')))if(!modules.includes(name))await rm(resolve(renderer,'src',name),{recursive:true,force:true});
  for(const name of await readdir(desktop))if(!desktopFiles.includes(name))await rm(resolve(desktop,name),{recursive:true,force:true});
  // Written last. Dev mode observes this marker only after all files are ready.
  await replaceFile(resolve(renderer,'asset-manifest.json'),JSON.stringify({version:1,files},null,2)+'\n');
  return {destination:resolve(destination),renderer,desktop,files};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await buildApplication();
  console.log(`Built Aincrad desktop application: ${result.destination}`);
}
