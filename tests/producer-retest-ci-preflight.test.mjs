// Zero-tick packaging/input-equivalence check. Never executes a simulation arm.
import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{pathToFileURL}from'node:url';
import{extractBaseline}from'../scripts/producer-retest-ci-source.mjs';import{comparableHash}from'../scripts/producer-retest-ci-namespace.mjs';import{PRODUCER_RETEST_CI_PROTOCOL as P}from'../scripts/producer-retest-ci-protocol.mjs';
test('packaged baseline dependencies load and zero-tick paired initial states match exactly',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'producer-preflight-'));try{const baseline=extractBaseline(readFileSync(new URL('./fixtures/producer-retest-baseline-v1.json.gz',import.meta.url)),dir),hashes=[],uuids=[];
 for(const root of[baseline,resolve('.')]){const url=pathToFileURL(root+'/'),{createOzarkWorldGeometry}=await import(new URL('src/ozark-world-geometry.js',url)),{createOzarkState,writeOzarkSave}=await import(new URL('src/ozark-save.js',url)),{bindOzarkWorldAgent}=await import(new URL('src/ozark-agent-world.js',url)),{PopulationRuntime}=await import(new URL('src/population.js',url));assert.equal(typeof PopulationRuntime,'function');
 const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry,{communicationSeed:P.seed});state.agents.forEach((n,i)=>{n.rng=P.seed+i;bindOzarkWorldAgent(n,geometry,state);});const before=JSON.stringify(state);hashes.push(comparableHash(state));uuids.push(state.worldLineage.instanceId);assert.equal(JSON.stringify(state),before);assert.equal(state.elapsed,0);let raw=null;assert.equal(writeOzarkSave({getItem:()=>raw,setItem:(k,v)=>raw=v},state,geometry),true);assert.equal(state.elapsed,0);
 }assert.equal(hashes[0],hashes[1]);assert.notEqual(uuids[0],uuids[1]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
