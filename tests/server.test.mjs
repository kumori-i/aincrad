import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../scripts/serve.mjs';
import { buildApplication } from '../scripts/build.mjs';
test('loopback renderer QA serves only built game assets, never desktop or repository files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aincrad-server-'));
  const {renderer}=await buildApplication(dir);
  const {server,url}=await startServer({port:0,assetRoot:renderer});
  try{
    const index=await fetch(url);assert.equal(index.status,200);assert.match(await index.text(),/Aincrad/);
    assert.equal((await fetch(url+'/src/world.js')).status,200);
    const css=await fetch(url+'/style.css');assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/text\/css/);
    assert.equal((await fetch(url+'/.git/config')).status,404);
    assert.equal((await fetch(url+'/package.json')).status,404);
    assert.equal((await fetch(url+'/desktop/preload.cjs')).status,404);
    assert.equal((await fetch(url+'/asset-manifest.json')).status,404);
    assert.equal((await fetch(url+'/../etc/passwd')).status,404);
    assert.equal((await fetch(url+'/src/entry.js',{method:'POST'})).status,405);
    const head=await fetch(url+'/src/entry.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal((await fetch(url+'/%FF')).status,400);
  }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('QA renderer manifest accepts256 but rejects257 without relaxing asset paths',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aincrad-asset-bound-'));
 try{
  const files=Array.from({length:256},(_,i)=>({path:i?'src/module-'+i+'.js':'index.html'}));await writeFile(join(dir,'index.html'),'boundary');await writeFile(join(dir,'asset-manifest.json'),JSON.stringify({version:1,files}));
  const {server,url}=await startServer({port:0,assetRoot:dir});try{assert.equal(await(await fetch(url)).text(),'boundary');assert.equal((await fetch(url+'/undeclared.js')).status,404);}finally{await new Promise(resolve=>server.close(resolve));}
  files.push({path:'src/module-256.js'});await writeFile(join(dir,'asset-manifest.json'),JSON.stringify({version:1,files}));await assert.rejects(startServer({port:0,assetRoot:dir}),/Invalid desktop renderer build/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('QA renderer rejects unsafe declared paths and symlink escape',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aincrad-asset-path-')),root=join(dir,'renderer');
 try{
  await mkdir(join(root,'src'),{recursive:true});await writeFile(join(dir,'private.js'),'private');
  for(const path of ['../private.js','desktop/main.cjs','src/nested/file.js']){await writeFile(join(root,'asset-manifest.json'),JSON.stringify({version:1,files:[{path:'index.html'},{path}]}));await assert.rejects(startServer({port:0,assetRoot:root}),/Invalid renderer asset list/);}
  await symlink(join(dir,'private.js'),join(root,'src','escape.js'));await writeFile(join(root,'asset-manifest.json'),JSON.stringify({version:1,files:[{path:'index.html'},{path:'src/escape.js'}]}));
  const {server,url}=await startServer({port:0,assetRoot:root});try{const response=await fetch(url+'/src/escape.js');assert.equal(response.status,403);assert.notEqual(await response.text(),'private');}finally{await new Promise(resolve=>server.close(resolve));}
 }finally{await rm(dir,{recursive:true,force:true});}
});
