import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {frozenArm,activationEnvironment} from './protocol.mjs';
import {armEvidence} from './arm-evidence.mjs';
import {sha256} from './source.mjs';
import {canonicalTerminalSave} from './save.mjs';
import {comparableInitial} from './initial.mjs';
async function main(){
 const [root,out,manifestFile,pairText,arm,initialExpected]=process.argv.slice(2);
 assert.match(pairText??'',/^[01]$/);
 const expected=frozenArm(Number(pairText),arm);activationEnvironment(process.env);
 assert.equal(process.platform,'linux');
 const src=name=>import(pathToFileURL(resolve(root,'src',name)));
 const {createOzarkWorldGeometry}=await src('ozark-world-geometry.js');
 const {createOzarkState,writeOzarkSave,OZARK_SAVE_KEY}=await src('ozark-save.js');
 const {bindOzarkWorldAgent}=await src('ozark-agent-world.js');
 const {PopulationRuntime}=await src('population.js');
 const {CONFIG}=await src('config.js');assert.equal(CONFIG.fixedStep,expected.fixedStep);
 const {connectedSequenceStatus}=await src('connected-sequence.js');
 const observer=await src('revisit-research-observer.js');
 const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry,{communicationSeed:expected.seed});
 state.agents.forEach((n,i)=>{n.rng=expected.seed+i;bindOzarkWorldAgent(n,geometry,state);});
 const initialComparableSha256=comparableInitial(state);
 if(arm==='candidate')assert.equal(initialComparableSha256,initialExpected);
 else assert.equal(initialExpected,undefined);
 const manifest=JSON.parse(readFileSync(manifestFile));
 const evidence=armEvidence({directory:out,root,manifest,state,observer,sequenceStatus:connectedSequenceStatus,expected});
 const runtime=new PopulationRuntime(state,{cardinal:false});let failure=null,saved=null,steps=0;
 try{
  for(;steps<expected.steps;steps++){
   state.elapsed+=expected.fixedStep;runtime.tick(expected.fixedStep);
   if(!evidence.capture())throw Error('Observer scope/coverage gap');
  }
  const terminal=canonicalTerminalSave({writeOzarkSave,OZARK_SAVE_KEY,state,geometry});saved=terminal.bytes;
  if(!terminal.ok||!saved)throw Error('Canonical terminal save failed validation');
 }catch(e){failure={reason:'arm-failed',message:String(e?.stack??e),steps};}
 finally{
  if(!saved)saved=Buffer.from(JSON.stringify(state)); // retained failure snapshot, not a valid terminal save
  const result=evidence.seal({terminalSave:saved,failure});
  runtime.dispose();
  writeFileSync(resolve(out,'arm.json'),JSON.stringify({arm,steps,seed:expected.seed,initialComparableSha256,terminalSha256:sha256(saved),complete:result.complete}),{flag:'wx'});
  if(!result.complete)process.exitCode=1;
 }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
