import assert from 'node:assert/strict';
import {closeSync,openSync,writeSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {armCollector} from './arm-collector.mjs';
import {sha256,verifyInstrumentedCopy} from './source.mjs';
import {validateExpected,verifyBoundaries} from './verify-archive.mjs';
// Evidence wiring only: host must supply the authorized loop, source identities,
// and validated terminal save. There is deliberately no executable entrypoint.
export function armEvidence({directory,root,manifest,state,observer,sequenceStatus,expected}){
 validateExpected(expected);
 assert.equal(manifest.pristine.commit,expected.commit);assert.equal(manifest.pristine.tree,expected.tree);
 assert.equal(sha256(JSON.stringify(manifest)),expected.sourceSha256);
 assert.equal(sha256(JSON.stringify(manifest.harness)),expected.harnessSha256);
 verifyInstrumentedCopy(root,manifest);
 mkdirSync(directory);
 const path=name=>resolve(directory,name);
 const initial=Buffer.from(JSON.stringify(state));
 writeFileSync(path('initial.json'),initial,{flag:'wx'});
 writeFileSync(path('source.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 const fd=openSync(path('research.jsonl'),'wx');
 const write=line=>{
  const buf=Buffer.from(line);let i=0;
  while(i<buf.length){const n=writeSync(fd,buf,i,buf.length-i);assert(n>0);i+=n;}
 };
 let collector;
 try{collector=armCollector({state,observer,sequenceStatus,steps:expected.steps,write});}
 catch(e){closeSync(fd);throw e;}
 let sealed=false;
 return {
  capture:()=>collector.capture(),
  seal({terminalSave,failure=null}){
   assert(!sealed);sealed=true;
   const collection=collector.seal();closeSync(fd);
   // A post-run source mismatch must preserve originals, not overwrite evidence.
   let attested=true;
   try{verifyInstrumentedCopy(root,manifest);}catch(error){attested=false;failure??={reason:'final-source-mismatch',message:String(error.message)};}
   assert(Buffer.isBuffer(terminalSave));
   writeFileSync(path('final.json'),terminalSave,{flag:'wx'});
   if(collection.complete){try{verifyBoundaries(collection,initial,terminalSave,expected);}catch(error){failure??={reason:'terminal-boundary-mismatch',message:String(error.message)};}}
   const out={arm:expected.arm,seed:expected.seed,fixedStep:expected.fixedStep,initialSha256:sha256(initial),finalSha256:sha256(terminalSave),source:manifest,collection,attested,failure,
    complete:attested&&failure===null&&collection.complete};
   writeFileSync(path('terminal.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
   return out;
  }
 };
}
