import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildBundle } from '../scripts/bundle.mjs';
test('offline bundle is deterministic, self-contained and has matching CSP hashes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aincrad-bundle-'));
  try{
    const a=await buildBundle(join(dir,'a.html')),b=await buildBundle(join(dir,'b.html'));
    const html=await readFile(a,'utf8');assert.equal(html,await readFile(b,'utf8'));
    const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const style=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    assert.ok(script);assert.ok(style);
    for(const text of [script,style])assert.ok(html.includes(`'sha256-${createHash('sha256').update(text).digest('base64')}'`));
    assert.ok(!html.includes('unsafe-inline'));
    assert.ok(!html.includes('src="./src/main.js"'));
    assert.ok(!html.includes('href="./style.css"'));
    assert.ok(!script.match(/import\s*\{/));
    assert.ok(!script.match(/export\s+(const|function|class)\s/));
  }finally{await rm(dir,{recursive:true,force:true});}
});
