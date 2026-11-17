import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('native character fixture prepares the v5 food projection without launching a world',async()=>{
  const output=await mkdtemp(join(tmpdir(),'aincrad-food-v5-native-contract-'));
  let passed=false;
  try{
    const result=spawnSync(process.execPath,
      ['scripts/verify-visual-reference-desktop.mjs','--prepare-only','--motor-scenario'],
      {encoding:'utf8',timeout:120000,
        env:{...process.env,AINCRAD_VISUAL_REFERENCE_QA_OUTPUT:output}});
    assert.equal(result.status,0,result.stderr);
    const prepared=JSON.parse(result.stdout.trim());
    assert.equal(prepared.nativeExecutionPerformed,false);
    assert.deepEqual(prepared.sandboxBypassFlags,[]);
    assert.deepEqual(prepared.phases,['motor-exercise','motor-reopen']);
    await assert.rejects(access(join(prepared.output,'result.json')));
    const syntax=spawnSync(process.execPath,['--check',prepared.harness],
      {encoding:'utf8',timeout:30000});
    assert.equal(syntax.status,0,syntax.stderr);
    const runner=await readFile(prepared.harness,'utf8');
    for(const contract of [
      'foodV5ProtocolPath','character-ordinary-food-run-v5-protocol.mjs',
      'guardFreshCharacterFoodRunPilot','projectCharacterFoodRunV5',
      'freshFoodV5(win)',"v5ProjectionPoint(win,'fresh')",
      "v5ProjectionPoint(win,'fresh-attached')",
      "v5ProjectionPoint(win,'motor-first-complete')",
      "v5ProjectionPoint(win,'motor-reopen')",
      'Fresh food-v5 guard must accept the actual blank renderer profile',
      'repeated v5 projection differs beyond its wall clock',
      'The v5 food-run observer must reopen without pending or learned action authority',
    ])assert(runner.includes(contract),`Generated native runner omitted ${contract}`);
    passed=true;
  }finally{
    if(passed)await rm(output,{recursive:true,force:true});
    else console.error('Failed v5 native preparation retained at '+output);
  }
});
