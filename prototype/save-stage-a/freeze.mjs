/** Assemble an immutable disposable input/build packet. Does not run Electron. */
import {readFile,writeFile,mkdir,readdir,copyFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';import {resolve,relative,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {buildApplication} from '../../scripts/build.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),here=dirname(fileURLToPath(import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function freeze(destination){
 const output=resolve(destination);
 if(execFileSync('git',['diff','6730da16732b3dc93685b47e573a2b14320707d9','--name-only','--','.',':!prototype/'],{cwd:root,encoding:'utf8'}).trim())throw Error('Stable production tree changed');
 const inputs=resolve(root,'test-results/stable-save-stage-a/inputs'),manifest=JSON.parse(await readFile(resolve(inputs,'manifest.json'),'utf8'));
 if(manifest.fixtures.length!==4)throw Error('Exactly four input pairs required');
 await mkdir(dirname(output),{recursive:true});await mkdir(output);const built=await buildApplication(resolve(output,'application')),sources=[];
 for(const dir of ['src','desktop','prototype/save-stage-a'])for(const name of (await readdir(resolve(root,dir))).sort()){
  const path=dir+'/'+name;if(!(await stat(resolve(root,path))).isFile())continue;const b=await readFile(resolve(root,path));sources.push({path,bytes:b.length,sha256:sha(b)});
  if(dir==='prototype/save-stage-a'){await mkdir(resolve(built.renderer,dir),{recursive:true});await copyFile(resolve(root,path),resolve(built.renderer,path));}
 }
 for(const path of ['scripts/build.mjs','index.html','style.css','icon.svg','package.json','package-lock.json']){const b=await readFile(resolve(root,path));sources.push({path,bytes:b.length,sha256:sha(b)});}
 const fixtures=[];await mkdir(resolve(built.renderer,'fixtures'),{recursive:true});
 for(const fixture of manifest.fixtures){const pairs={};for(const key of ['A','B']){const item=fixture.pairs[key],b=await readFile(resolve(inputs,item.path));if(sha(b)!==item.sha256||b.length!==item.bytes)throw Error('Input fingerprint changed');const path='fixtures/'+item.path;await copyFile(resolve(inputs,item.path),resolve(built.renderer,path));pairs[key]={...item,path};}fixtures.push({...fixture,pairs});}
 const allowedPaths=[...built.files.map(f=>f.path),...sources.filter(f=>f.path.startsWith('prototype/')&&/\.(js|css|html)$/.test(f.path)).map(f=>f.path),...fixtures.flatMap(f=>Object.values(f.pairs).map(p=>p.path))];
 const assets=[];for(const path of allowedPaths){const b=await readFile(resolve(built.renderer,path));assets.push({path,bytes:b.length,sha256:sha(b)});}
 const executables=[];for(const path of ['prototype/save-stage-a/native-policy.cjs','prototype/save-stage-a/native-runner.cjs']){const b=await readFile(resolve(built.renderer,path));executables.push({path,bytes:b.length,sha256:sha(b)});}
 const packet={version:1,createdAt:new Date().toISOString(),baselineCommit:'1f20f401f720b61069dcea06d10cc4e885e0b1f6',baselineTree:'6154cd156ed0ef1dbf873fefb7ab1d7b9fa3b970',localEquivalentTreeCommit:'6730da16732b3dc93685b47e573a2b14320707d9',planSha256:sha(await readFile(resolve(here,'PLAN.md'))),rendererRoot:built.renderer,sourceFingerprint:built.sourceFingerprint,sources,assets,executables,allowedPaths,fixtures,inputManifestSha256:sha(await readFile(resolve(inputs,'manifest.json'))),protocol:{sessions:2,arms:['baseline','worker'],session2ArmOrder:['worker','baseline'],cold:1,warmups:4,measured:20,preseed:'B once per arm/session',settleMs:500,postCommitWindowMs:100,upperMedian:true,p95:'nearest rank ceil(.95*n)-1',gate:{rendererWorkFraction:.5,dispatchP95Ms:16.7,commitP95Ms:16.7,maxFrameGapP95Ms:33.3,noFrameGapRegression:true}}};
 await writeFile(resolve(output,'packet.json'),JSON.stringify(packet,null,2)+'\n');await copyFile(resolve(inputs,'manifest.json'),resolve(output,'input-manifest.json'));return{output,packetSha256:sha(await readFile(resolve(output,'packet.json'))),sourceFingerprint:built.sourceFingerprint};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(!process.argv[2])throw Error('Explicit new freeze directory required');console.log(JSON.stringify(await freeze(process.argv[2]),null,2));}
