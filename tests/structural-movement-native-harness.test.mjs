import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { assertStructuralPlayerStep, assertStructuralRestoredHistory } from '../scripts/structural-movement-native-contract.mjs';

test('serialized native motion assertions reject free, extra-time, illegal and false-distance steps', () => {
  const verify = Function('assert', 'return (' + assertStructuralPlayerStep.toString() + ')')(assert);
  const seconds = 1 / 60;
  const before = { player:{x:527.9482587463335,y:3120.0000031694867},
    playerBody:{stamina:100,effort:0},elapsed:17,environmentElapsed:17,
    ecologyElapsed:16.5,ecologyPending:.5,distance:0,
    agents:[{id:'aster',elapsed:17},{id:'mira',elapsed:17}] };
  for (const [dx,distance] of [[1,0],[-1,2.5]]) {
    const after = structuredClone(before);
    after.player.x += dx*distance; after.elapsed += seconds; after.environmentElapsed += seconds;
    after.ecologyPending += seconds;
    after.distance += distance; after.playerBody.stamina -= seconds*2.4; after.playerBody.effort += seconds*.04;
    for(const actor of after.agents) actor.elapsed += seconds;
    const step={before,after,footing:'dry-ground'}; verify(step,dx,distance);
    for(const corrupt of [
      row=>{row.after.player.x+=1;}, row=>{row.after.player.y+=1;},
      row=>{row.after.elapsed+=seconds;}, row=>{row.after.environmentElapsed=17;},
      row=>{row.after.ecologyElapsed+=seconds;}, row=>{row.after.ecologyPending=.5;},
      row=>{row.after.distance+=1;}, row=>{row.after.playerBody.stamina=100;},
      row=>{row.after.playerBody.effort=0;}, row=>{row.after.agents[0].elapsed=17;},
      row=>{row.footing='tree-trunk';},
    ]) { const bad=structuredClone(step); corrupt(bad); assert.throws(()=>verify(bad,dx,distance)); }
  }
});

test('serialized native restore assertions preserve history and allow cancellation, never completion', () => {
  const verify=Function('assert','return ('+assertStructuralRestoredHistory.toString()+')')(assert);
  const event={type:'action',details:{result:{ok:false,code:'ROUTE_BLOCKED'}}};
  const stored={player:{x:1,y:2},playerBody:{stamina:100},elapsed:17,
    environment:{elapsed:17,ecology:{elapsed:16.5,pending:.5}},
    agents:[{id:'aster',position:{x:1,y:2},elapsed:17,interrupted:true,memory:{experience:[event]}}]};
  const actual=structuredClone(stored); actual.agents[0].active=null;
  actual.clocks={environmentElapsed:17,ecologyElapsed:16.5,ecologyPending:.5};
  actual.agents[0].memory.experience.push({type:'action',details:{result:{ok:false,code:'RESTART_INTERRUPTED'}}});
  verify(stored,actual);
  for(const corrupt of [
    row=>{row.player.x++;}, row=>{row.elapsed++;}, row=>{row.agents[0].position.x++;},
    row=>{row.clocks.environmentElapsed++;}, row=>{row.clocks.ecologyElapsed++;},
    row=>{row.clocks.ecologyPending++;},
    row=>{row.agents[0].active={request:{type:'move'}};},
    row=>{row.agents[0].memory.experience[0].details.result.code='ARRIVED';},
    row=>{row.agents[0].memory.experience[1].details.result.ok=true;},
    row=>{row.agents[0].memory.experience[1].details.result.code='ARRIVED';},
    row=>{row.agents[0].memory.experience.pop();},
  ]) {const bad=structuredClone(actual);corrupt(bad);assert.throws(()=>verify(stored,bad));}
});

test('native movement prepare-only validates the three-process runner without claiming execution', async () => {
  const output=await mkdtemp(join(tmpdir(),'mv-harness-check-'));
  try {
    const result=spawnSync(process.execPath,['scripts/verify-structural-movement-desktop.mjs','--prepare-only'],
      {encoding:'utf8',timeout:120000,env:{...process.env,AINCRAD_MOVEMENT_QA_OUTPUT:output}});
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
    assert.match(source,/assertStep\(blocked\[0\], 1, 0\)/);
    assert.match(source,/assertStep\(retreat\[0\], -1, 2\.5\)/);
    assert.match(source,/Third process must read exact saved-after-retreat bytes/);
    const preservation=JSON.parse(await readFile(join(prepared.output,'profile-evidence.json'),'utf8'));
    assert.equal(preservation.nativeExecutionPerformed,false);
    assert.equal(preservation.copiedAfterProcessesClosed,false);
  } finally { await rm(output,{recursive:true,force:true}); }
});
