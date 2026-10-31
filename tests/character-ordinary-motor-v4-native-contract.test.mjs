import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('native motor preparation serializes the exact v4 projection and keeps execution inert',async()=>{
  const output=await mkdtemp(join(tmpdir(),'aincrad-motor-v4-native-contract-'));
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
      'motorV4ProtocolPath','character-ordinary-motor-v4-protocol.mjs',
      'guardFreshCharacterMotorV4','projectCharacterMotorV4',
      "v4ProjectionPoint(win,'fresh')",
      "v4ProjectionPoint(win,'fresh-attached')",
      "v4ProjectionPoint(win,'motor-first-complete')",
      "v4ProjectionPoint(win,'motor-second-paid')",
      "v4ProjectionPoint(win,'motor-interrupted')",
      "v4ProjectionPoint(win,'motor-reopen')",
      'Fresh motor-v4 guard must accept the actual blank renderer profile',
      'V4 completion must project exactly the paid actor-local lifecycle already observed',
      'V4 interruption must retain exactly one funded but unfinished actor-local outcome',
      'The v4 observer must start with empty session-only lifecycle and visibility counts after reopen',
    ])assert(runner.includes(contract),`Generated native runner omitted ${contract}`);
    passed=true;
  }finally{
    if(passed)await rm(output,{recursive:true,force:true});
    else console.error('Failed v4 native preparation retained at '+output);
  }
});
