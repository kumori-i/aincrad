/** Optional development comparison against an explicitly supplied clean main
 * checkout. This is not a requirement for an end-user installation. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
const baseline=resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Supply the clean main 3db8304 checkout path');
const expected='3db83047c96158b39214b3f5a68ed5929ad1f40d';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim(),expected);
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:baseline,encoding:'utf8'}).trim(),'');
const current=resolve(new URL('..',import.meta.url).pathname),output=resolve(current,'test-results/plant-baseline');await mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const arms=[];
for(const [name,root]of [['main',baseline],['juvenile',current]]){
 const load=file=>import(pathToFileURL(resolve(root,'src',file)));
 const {freshState}=await load('world.js'),{PopulationRuntime}=await load('population.js'),{writeSave,loadSave}=await load('save.js');
 const state=freshState();state.cardinal.mode='off';const runtime=new PopulationRuntime(state),start=performance.now();
 for(let i=0;i<900*60;i++){state.elapsed+=1/60;runtime.tick(1/60);}
 const runWallMs=performance.now()-start;runtime.dispose();let bytes='';assert.equal(writeSave({setItem:(_key,v)=>{bytes=v;}},state),true);
 await writeFile(resolve(output,`${name}-save.json`),bytes);
 arms.push({name,state,writeSave,loadSave,bytes,runWallMs,samples:[]});
}
// The only normalized fields are the additive lifecycle envelope/metadata.
const plain=structuredClone(arms[1].state);plain.version=6;delete plain.features;delete plain.environment.ecology.lifecycle;
for(const p of plain.environment.ecology.plants){assert.equal(p.lifecycleStage,'established');for(const key of ['lifecycleStage','structureMassGrams','structureKcal','structureWaterMl','recruitedAt','parentMaterialId'])delete p[key];}
for(const m of plain.environment.ecology.materials)for(const key of ['seedOpportunity','nextGerminationAt'])delete m[key];
assert.deepEqual(plain,arms[0].state);
// Interleaved writes include validation, JSON encoding and the same in-memory
// sink. They do not claim localStorage/disk or renderer frame latency.
for(let i=0;i<24;i++)for(const arm of i%2?[...arms].reverse():arms){const start=performance.now();assert.equal(arm.writeSave({setItem:()=>{}},arm.state),true);if(i>=4)arm.samples.push(performance.now()-start);}
let oldBytes=arms[1].bytes,writes=0;const oldDisk={getItem:()=>oldBytes,setItem:(_key,value)=>{oldBytes=value;writes++;}};
const rejected=arms[0].loadSave(oldDisk);assert.equal(rejected.blocked,true);assert.equal(arms[0].writeSave(oldDisk,rejected.state),false);assert.equal(oldBytes,arms[1].bytes);assert.equal(writes,0);
const metrics=arm=>{const sorted=[...arm.samples].sort((a,b)=>a-b);return {name:arm.name,runWallMs:arm.runWallMs,saveBytes:Buffer.byteLength(arm.bytes),saveSha256:sha(arm.bytes),writeSamplesMs:arm.samples,p50Ms:sorted[10],p95Ms:sorted[18],maxMs:sorted.at(-1)};};
const report={passed:true,baselineCommit:expected,baselineSaveSourceSha256:sha(await readFile(resolve(baseline,'src/save.js'))),candidateEcologySha256:sha(await readFile(resolve(current,'src/ecology.js'))),candidateSaveSha256:sha(await readFile(resolve(current,'src/save.js'))),scriptSha256:sha(await readFile(new URL(import.meta.url))),nativeInputSeconds:900,dt:1/60,cardinalMode:'off',wholeStateEqualAfterOnlyAdditiveMetadataRemoval:true,oldReaderPreservesV8Bytes:true,oldReaderWrites:0,measurements:arms.map(metrics),limits:['One seed and a short pre-recruitment horizon','Interleaved warm synchronous writes to an in-memory sink, not actual desktop frame timing','Cloud CPU, no laptop or Ollama performance claim'],maxRssKiB:process.resourceUsage().maxRSS};
await writeFile(resolve(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
