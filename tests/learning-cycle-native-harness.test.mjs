import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('generated learning-cycle current Satiety assertion rejects stale labels and inaccurate projections',async()=>{
  const output=await mkdtemp(join(tmpdir(),'learning-cycle-harness-contract-'));let passed=false;
  try{
    const run=spawnSync(process.execPath,['scripts/verify-learning-cycle-desktop.mjs','--prepare-only'],{encoding:'utf8',timeout:120000,env:{...process.env,AINCRAD_LEARNING_QA_OUTPUT:output}});
    assert.equal(run.status,0,run.stderr);const prepared=JSON.parse(run.stdout.trim());
    assert.equal(prepared.nativeExecutionPerformed,false);
    const source=await readFile(prepared.harness,'utf8');
    const start=source.indexOf('function assertSatietyUi('),end=source.indexOf('async function writePhase(',start);
    assert(start>=0&&end>start);assert(source.includes('assertSatietyUi(rendered,actor);'));
    const check=vm.runInNewContext(source.slice(start,end)+';assertSatietyUi',{assert});
    const actor={nourishment:64.78888888888902,energy:38.2};
    const rendered={label:'Satiety',tooltip:'Satiety is modeled appetite duration, not stomach fullness or stored energy.',hidden:false,foodText:'64.8 / 100',foodValue:actor.nourishment,energyText:'38.2'};
    assert.doesNotThrow(()=>check(rendered,actor));
    for(const changed of [{label:'Food satisfaction'},{tooltip:'Appetite satisfaction, not stored energy or calorie coverage.'},{hidden:true},{foodText:'99.9 / 100'},{foodValue:100},{energyText:'0.0'}])assert.throws(()=>check({...rendered,...changed},actor),{code:'ERR_ASSERTION'});
    const syntax=spawnSync(process.execPath,['--check',prepared.harness],{encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
    passed=true;
  }finally{if(passed)await rm(output,{recursive:true,force:true});else console.error('Failed prepare-only evidence retained at '+output);}
});
