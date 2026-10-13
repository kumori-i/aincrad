import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
    assert.equal((await fetch(url+'/src/main.js',{method:'POST'})).status,405);
    const head=await fetch(url+'/src/main.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal((await fetch(url+'/%FF')).status,400);
  }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
