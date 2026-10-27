import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

test('reset native preparation produces a syntax-valid isolated five-process runner, not native evidence', async()=>{
  const output=await mkdtemp(join(tmpdir(),'reset-harness-contract-'));
  let passed=false;
  try{
    const result=spawnSync(process.execPath,['scripts/verify-world-reset-desktop.mjs','--prepare-only'],{encoding:'utf8',timeout:120000,env:{...process.env,AINCRAD_RESET_QA_OUTPUT:output}});
    assert.equal(result.status,0,result.stderr);
    const prepared=JSON.parse(result.stdout.trim());
    assert.equal(prepared.nativeExecutionPerformed,false);
    assert.deepEqual(prepared.sandboxBypassFlags,[]);
    assert.deepEqual(prepared.phases,['seed','reset','reopen','protected-reset','protected-reopen']);
    assert.match(prepared.harnessSha256,/^[a-f0-9]{64}$/);
    assert.ok(prepared.application.startsWith(output));
    await assert.rejects(access(join(prepared.output,'result.json')));
    const syntax=spawnSync(process.execPath,['--check',prepared.harness],{encoding:'utf8'});
    assert.equal(syntax.status,0,syntax.stderr);
    const source=await readFile(prepared.harness,'utf8');
    const require=createRequire(import.meta.url),app=new EventEmitter(),loaded=[];
    app.exit=code=>{throw new Error('Unexpected exit '+code);};
    const stub=name=>name==='electron'?{app,session:{}}:name.endsWith('main.cjs')?loaded.push(name):require(name);
    vm.runInNewContext(source,{require:stub,process:{argv:['runner','--phase=seed']},console,setTimeout:()=>1,clearTimeout(){}});
    assert.equal(loaded.length,1,'Actual application scheme registration stays synchronous');
    for(const contract of [
      'Cancel leaves exact old stored bytes',
      'Native Escape leaves exact old stored bytes',
      'No-backup path requires explicit acknowledgement',
      'Independent reopen reads exact reset bytes after native unload',
      'Invalid fixture is protected, not automatically reset',
      'Old autosave and pending work cannot resurrect the old world',
      'Local model preferences remain unchanged',
      'Test hour must not be preserved',
      'Test weather must not be preserved',
      'Test learning override must not survive',
      'Genuine presentation preference retained',
      'captureWithReadiness({',
      'win.webContents.sendInputEvent',
      'prefs.sandbox,true',
    ])assert.ok(source.includes(contract),contract);
    assert.match(source,/passed:true,nativeExecutionPerformed:true/);
    assert.doesNotMatch(source,/showSaveDialog\s*=/,'Native dialogs are not stubbed');
    const preservation=JSON.parse(await readFile(join(prepared.output,'profile-evidence.json'),'utf8'));
    assert.equal(preservation.nativeExecutionPerformed,false);
    assert.equal(preservation.copiedAfterProcessesClosed,false);
    assert.ok(source.includes('Actual native dialog cancellation aborts combined reset'));
    assert.ok(source.includes('Actual native dialog forbidden destination failure prevents reset'));
    assert.ok(source.includes('Actual native backup preserves exact invalid original stored bytes'));
    assert.ok(source.includes('driveNativeSaveDialog'));
    assert.ok(prepared.excludedCoverage.some(line=>line.includes('visual inspection')));
    passed=true;
  }finally{if(passed)await rm(output,{recursive:true,force:true});else console.error('Failed reset preparation retained at '+output);}
});
