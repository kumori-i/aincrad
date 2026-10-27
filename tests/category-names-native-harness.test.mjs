import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

test('category native preparation binds an isolated exact-source three-process harness without running inference or Electron',async()=>{
  const output=await mkdtemp(join(tmpdir(),'category-harness-contract-'));let passed=false;
  try{
    const result=spawnSync(process.execPath,['scripts/verify-category-names-desktop.mjs','--prepare-only'],{encoding:'utf8',timeout:120000,env:{...process.env,AINCRAD_CATEGORY_NAMES_QA_OUTPUT:output}});
    assert.equal(result.status,0,result.stderr);const prepared=JSON.parse(result.stdout.trim());
    assert.equal(prepared.nativeExecutionPerformed,false);assert.deepEqual(prepared.sandboxBypassFlags,[]);
    assert.deepEqual(prepared.phases,['write','exercise','verify']);assert.match(prepared.modelInference,/mocked/);
    assert.match(prepared.sourceIdentity.commit,/^[a-f0-9]{40}$/);assert.match(prepared.sourceIdentity.tree,/^[a-f0-9]{40}$/);
    assert.match(prepared.sourceFingerprint,/^[a-f0-9]{64}$/);assert.match(prepared.harnessSha256,/^[a-f0-9]{64}$/);
    const canonical=await realpath(output),rel=relative(canonical,prepared.application);
    assert.ok(rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../'),'Application is inside this canonical output, including macOS temporary aliases');
    const source=await readFile(prepared.harness,'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),prepared.harnessSha256);
    const syntax=spawnSync(process.execPath,['--check',prepared.harness],{encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
    const built=await readFile(join(prepared.application,'renderer/src/build-info.js'),'utf8');assert.ok(built.includes(prepared.sourceFingerprint));
    const require=createRequire(import.meta.url),app=new EventEmitter(),loaded=[];
    const stub=name=>name==='electron'?{app,session:{}}:name.endsWith('main.cjs')?loaded.push(name):require(name);
    vm.runInNewContext(source,{require:stub,process:{argv:['runner','--phase=write']},console,setTimeout:()=>1,clearTimeout(){}});
    assert.deepEqual(loaded,[join(prepared.application,'desktop/main.cjs')],'Scheme registration uses the isolated production application synchronously');
    for(const contract of ['Independent process reads exact original bytes','Third process reads exact saved bytes',
      'Reopening cannot sense or increment samples','Panel/capture must not alter state','mocked; real local model never called',
      'mock-native-fixture-only','Mock provenance omitted from actual app panel','Actor switch exposed another agent’s private category',
      'Reload must not claim current sight','prefs.sandbox,true','prefs.contextIsolation,true','prefs.nodeIntegration,false',
      'captureWithReadiness({','context.sourceFingerprint','CATEGORY_NAMES_NATIVE_CLOSED','CATEGORY_NAMES_NATIVE_WILL_QUIT'])
      assert.ok(source.includes(contract),contract);
    assert.ok(prepared.excludedCoverage.some(line=>line.includes('Real local model inference')));
    assert.ok(prepared.excludedCoverage.some(line=>line.includes('Reset and late-response')));
    await assert.rejects(access(join(prepared.output,'result.json')));
    const profile=JSON.parse(await readFile(join(prepared.output,'profile-evidence.json'),'utf8'));
    assert.equal(profile.nativeExecutionPerformed,false);assert.equal(profile.copiedAfterProcessesClosed,false);
    passed=true;
  }finally{if(passed)await rm(output,{recursive:true,force:true});else console.error('Failed category preparation retained at '+output);}
});
