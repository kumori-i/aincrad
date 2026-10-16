/** Development-only paired measurement using unchanged recorded snapshots.
 * Supply the clean main checkout and preserved pre-optimization source root. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const current=resolve(new URL('..',import.meta.url).pathname);
assert.ok(process.argv[2]&&process.argv[3],'Supply main and preserved pre-optimization roots');
const roots=[resolve(process.argv[2]),resolve(process.argv[3]),current],names=['main','juvenile-before','juvenile-optimized'];
const output=resolve(current,'test-results/plant-save-optimization');await mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await Promise.all(['main','juvenile'].map(name=>readFile(resolve(current,`test-results/plant-baseline/${name}-save.json`),'utf8')));
const arms=[];
for(let i=0;i<3;i++){
 const module=await import(pathToFileURL(resolve(roots[i],'src/save.js')));
 const raw=JSON.parse(bytes[i===0?0:1]);
 const canonical=module.validateSave(raw);assert.equal(canonical.saveBlocked,undefined);
 arms.push({name:names[i],raw,canonical,...module,samples:[],sources:Object.fromEntries(await Promise.all(['ecology.js','plant-lifecycle-state.js','save.js'].map(async file=>[file,await readFile(resolve(roots[i],'src',file)).then(sha,()=>null)])))});
}
assert.deepEqual(arms[1].canonical,arms[2].canonical,'Optimization must preserve entire normalized snapshot');
let beforeBytes,afterBytes;assert.equal(arms[1].writeSave({setItem:(_k,v)=>beforeBytes=v},arms[1].raw),true);assert.equal(arms[2].writeSave({setItem:(_k,v)=>afterBytes=v},arms[2].raw),true);assert.equal(beforeBytes,afterBytes);
for(let i=0;i<24;i++)for(const arm of i%2?[...arms].reverse():arms){const start=performance.now();assert.equal(arm.writeSave({setItem:()=>{}},arm.raw),true);if(i>=4)arm.samples.push(performance.now()-start);}
const report={passed:true,scriptSha256:sha(await readFile(new URL(import.meta.url))),inputHashes:{main:sha(bytes[0]),juvenile:sha(bytes[1])},entireCanonicalSnapshotEqual:true,encodedBytesEqual:true,measurements:arms.map(a=>{const sorted=[...a.samples].sort((x,y)=>x-y);return {name:a.name,sources:a.sources,samplesMs:a.samples,p50Ms:sorted[10],p95Ms:sorted[18],maxMs:sorted.at(-1)};}),maxRssKiB:process.resourceUsage().maxRSS,limits:['Same recorded 900-second snapshots; no new simulation run','Four warmups and twenty measured writes per arm, alternating reversed order','Validation and JSON encoding to an in-memory sink, excluding localStorage and frame timing','Cloud CPU; no laptop performance claim; original paired report is retained separately']};
await writeFile(resolve(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
