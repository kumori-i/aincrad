import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../scripts/serve.mjs';
test('loopback server serves the game but not repository metadata or arbitrary paths',async()=>{
  const {server,url}=await startServer({port:0});
  try{
    const index=await fetch(url);assert.equal(index.status,200);assert.match(await index.text(),/Aincrad/);
    assert.equal((await fetch(url+'/src/world.js')).status,200);
    assert.equal((await fetch(url+'/.git/config')).status,404);
    assert.equal((await fetch(url+'/package.json')).status,404);
    assert.equal((await fetch(url+'/../etc/passwd')).status,404);
    assert.equal((await fetch(url+'/src/main.js',{method:'POST'})).status,405);
    assert.equal((await fetch(url+'/%FF')).status,400);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
