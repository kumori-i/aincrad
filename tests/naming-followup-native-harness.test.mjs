import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

test('native naming follow-up prepare-only validates the three-process runner without claiming execution', async () => {
  const output=await mkdtemp(join(tmpdir(),'naming-followup-harness-'));
  try {
    const result=spawnSync(process.execPath,['scripts/verify-naming-followup-desktop.mjs','--prepare-only'],
      {encoding:'utf8',timeout:120000,env:{...process.env,AINCRAD_NAMING_FOLLOWUP_QA_OUTPUT:output}});
    assert.equal(result.status,0,result.stderr);
    const prepared=JSON.parse(result.stdout.trim());
    const manifest=JSON.parse(await readFile(join(prepared.output,'prepared.json'),'utf8'));
    assert.equal(manifest.nativeExecutionPerformed,false);
    assert.deepEqual(manifest.sandboxBypassFlags,[]);
    assert.deepEqual(manifest.phases,['write','exercise','verify']);
    await assert.rejects(access(join(prepared.output,'result.json')));
    const syntax=spawnSync(process.execPath,['--check',prepared.harness],{encoding:'utf8'});
    assert.equal(syntax.status,0,syntax.stderr);
    const source=await readFile(prepared.harness,'utf8');
    const require=createRequire(import.meta.url),app=new EventEmitter(),loaded=[];
    app.exit=code=>{throw new Error('Unexpected exit '+code);};
    const stub=name=>name==='electron'?{app,session:{}}:
      name.endsWith('main.cjs')?loaded.push(name):require(name);
    vm.runInNewContext(source,{require:stub,process:{argv:['runner','--phase=write']},
      console,setTimeout:()=>1,clearTimeout(){}});
    assert.equal(loaded.length,1,'Production scheme registration remains synchronous');
    assert.match(source,/window\.__namingFollowupScene\.advance\(\)/);
    assert.match(source,/completed.status,'confirmed'/);
    assert.match(source,/Third process must read exact saved naming bytes/);
    assert.match(source,/captureWithReadiness\(\{/);
    assert.match(source,/maxAttempts = 4, timeoutMs = 5000/);
    assert.match(source,/name\+'\.attempt-'/);
    assert.match(source,/png.length>10000/);
    const preservation=JSON.parse(await readFile(join(prepared.output,'profile-evidence.json'),'utf8'));
    assert.equal(preservation.nativeExecutionPerformed,false);
    assert.equal(preservation.copiedAfterProcessesClosed,false);
  } finally { await rm(output,{recursive:true,force:true}); }
});
