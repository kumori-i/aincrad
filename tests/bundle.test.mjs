import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildApplication } from '../scripts/build.mjs';
test('desktop build contains deterministic renderer assets and desktop runtime with restrictive CSP',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aincrad-build-'));
  try{
    const a=await buildApplication(join(dir,'a')),b=await buildApplication(join(dir,'b'));
    const manifest=await readFile(join(a.renderer,'asset-manifest.json'),'utf8');
    assert.equal(manifest,await readFile(join(b.renderer,'asset-manifest.json'),'utf8'));
    for(const file of JSON.parse(manifest).files){
      const data=await readFile(join(a.renderer,file.path));
      assert.equal(file.sha256,createHash('sha256').update(data).digest('hex'));
      assert.deepEqual(data,await readFile(join(b.renderer,file.path)));
    }
    const html=await readFile(join(a.renderer,'index.html'),'utf8');
    assert.match(html,/src="\.\/src\/main\.js"/);assert.match(html,/href="\.\/style\.css"/);
    assert.match(html,/connect-src 'none'/);assert.match(html,/object-src 'none'/);assert.ok(!html.includes('unsafe-inline'));
    assert.match(await readFile(join(a.desktop,'main.cjs'),'utf8'),/sandbox:true/);
    await assert.rejects(readFile(join(a.renderer,'package.json')),{code:'ENOENT'});
    await assert.rejects(readFile(join(a.renderer,'desktop','preload.cjs')),{code:'ENOENT'});
    await writeFile(join(a.renderer,'src','obsolete.js'),'old module');
    await buildApplication(join(dir,'a'));
    await assert.rejects(readFile(join(a.renderer,'src','obsolete.js')),{code:'ENOENT'});
  }finally{await rm(dir,{recursive:true,force:true});}
});
