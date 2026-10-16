/** Actual Electron persistence/visual QA in an isolated profile. The explicitly
 * reduced, copied ecology fixture changes clocks and weather for coverage;
 * it is not an autonomous whole-map succession experiment. */
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {buildApplication} from './build.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
await buildApplication();
const directory=await mkdtemp(join(tmpdir(),'aincrad-plant-desktop-'));
const output=resolve(root,'test-results/plant-desktop');await mkdir(output,{recursive:true});
const harness=join(directory,'runner.cjs');
await writeFile(harness,`
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const context=${JSON.stringify({root,output,directory})},phase=process.argv.includes('--phase=write')?'write':'read';
let completed=false;
const timeout=setTimeout(()=>{console.error('Plant native QA timed out');app.exit(1);},120000);
app.on('browser-window-created',(_event,win)=>win.webContents.on('did-finish-load',async()=>{
 if(completed)return;completed=true;
 try{
  for(let n=0;n<200;n++){if(await win.webContents.executeJavaScript('Boolean(window.__aincrad)'))break;await new Promise(r=>setTimeout(r,50));}
  if(phase==='write'){
   const fixture=await win.webContents.executeJavaScript(\`(async()=>{
    const {canStandOutside}=await import('./src/world.js'),{plantSuitability}=await import('./src/ecology-regions.js');
    const {CONFIG}=await import('./src/config.js'),{tickEnvironment}=await import('./src/environment.js');
    const {ecologyEnergy,tickEcology,interactEcologyObject,consumeEcologyMaterial}=await import('./src/ecology.js');
    const {createPhysiology,ingestMaterial,beginSleep}=await import('./src/biology.js');
    const {validateSave,writeSave}=await import('./src/save.js'),{PopulationRuntime}=await import('./src/population.js');
    const raw=window.__aincrad.snapshot(),e=raw.environment.ecology,env=raw.environment,tree=e.plants.find(p=>p.kind==='apple_tree');
    raw.cardinal.mode='off';e.animals=[];e.plants=[tree];e.ledger.initialKcal=ecologyEnergy(e);env.settings={hourOverride:12,weatherOverride:'clear'};
    const detach=point=>{const result=interactEcologyObject(e,tree.id,'pull',{actorId:'aster',position:tree.position});if(!result.ok)throw new Error('Finite detachment failed');const m=e.materials.find(m=>m.id===result.materialId);if(!interactEcologyObject(e,m.id,'release',{actorId:'aster',position:point}).ok)throw new Error('Release failed');return m;};
    const point={x:tree.position.x+45,y:tree.position.y+30},first=detach(point);
    // A real accepted 30 g ingestion precedes the seed transfer.
    interactEcologyObject(e,first.id,'grasp',{actorId:'aster',position:point});
    if(!consumeEcologyMaterial(e,first.id,30/180,{actorId:'aster',accept:p=>ingestMaterial(raw.agents[0],p,{objectId:first.id,actionId:1})}).ok)throw new Error('Finite sample failed');
    interactEcologyObject(e,first.id,'release',{actorId:'aster',position:point});
    e.elapsed=env.elapsed=CONFIG.dayRealSeconds*4;first.ageHours=96;
    const step=()=>{tickEnvironment(env,.5);tickEcology(e,.5,env,[]);};step();
    const grown=e.plants.find(p=>p.lifecycleStage==='juvenile');if(!grown)throw new Error('Seed did not recruit');
    // Actual .5-second ecology steps with fixed noon/clear conditions, while
    // actor bodies are held as persistence fixtures rather than simulated lives.
    let growthSteps=0;while(grown.structureMassGrams<20&&growthSteps<CONFIG.dayRealSeconds*20*2){step();growthSteps++;}
    if(grown.stage!=='juvenile'||grown.quantity!==0)throw new Error('Growth fixture unavailable');
    const second=detach({x:tree.position.x-45,y:tree.position.y+30});
    e.elapsed+=CONFIG.dayRealSeconds*4;env.elapsed=e.elapsed;second.ageHours=96;step();
    const seedling=e.plants.find(p=>p.parentMaterialId===second.id);if(!seedling||seedling.stage!=='seedling')throw new Error('Second seedling unavailable');
    let dry=null;for(let y=-20000;y<20000&&!dry;y+=1000)for(let x=-20000;x<20000;x+=1000)if(canStandOutside(x,y,40)&&!plantSuitability('apple_tree',{x,y})&&!plantSuitability('apple_tree',{x:x+24,y:y+24})){dry={x,y};break;}
    if(!dry)throw new Error('Bounded unsuitable fixture absent');const deferred=detach(dry);e.elapsed+=CONFIG.dayRealSeconds*4;env.elapsed=e.elapsed;deferred.ageHours=96;step();
    if(!deferred.seedOpportunity||deferred.nextGerminationAt<=e.elapsed||e.lifecycle.placementBlockedAttempts<1)throw new Error('Deferred opportunity absent');
    const spectator=[{x:tree.position.x,y:tree.position.y+150},{x:tree.position.x+120,y:tree.position.y+150},{x:tree.position.x-120,y:tree.position.y+150}].find(p=>canStandOutside(p.x,p.y,CONFIG.playerRadius));if(!spectator)throw new Error('Unobstructed camera fixture absent');
    raw.elapsed=e.elapsed;for(const [i,a] of raw.agents.entries()){a.elapsed=e.elapsed;a.nextDecisionAt=e.elapsed;const candidates=[{x:spectator.x+(i?60:-60),y:spectator.y+30},{x:spectator.x+(i?90:-90),y:spectator.y+60}];a.position=candidates.find(p=>canStandOutside(p.x,p.y,CONFIG.playerRadius))||{...spectator};}raw.player={...spectator};
    beginSleep(raw.agents[1],{hours:5});raw.npc=raw.agents[0];
    if(!writeSave(localStorage,raw))throw new Error('Native write failed');
    const saved=JSON.parse(localStorage.getItem(CONFIG.saveKey)),expected=validateSave(saved),runtime=new PopulationRuntime(expected),checkpoint=structuredClone(expected);runtime.dispose();
    return {expected:checkpoint,grownId:grown.id,seedlingId:seedling.id,materialId:first.id,deferredId:deferred.id,growthSteps,fixture:{plantsReducedToOne:true,animalsRemoved:true,initialEnergyRebasedAfterReduction:true,ageClockJumpsGameDays:[4,4,4],deferredMaterialPlacedAtUnsuitableDryPoint:true,hourOverride:12,weatherOverride:'clear',growthStepSeconds:.5,actorBodiesNotAdvanced:true}};
   })()\`);
   await fs.writeFile(path.join(context.directory,'expected.json'),JSON.stringify(fixture));
   session.defaultSession.flushStorageData();await new Promise(r=>setTimeout(r,400));
   console.log('PASS: actual native finite consumption, recruitment, growth and disk write.');
  }else{
   const fixture=JSON.parse(await fs.readFile(path.join(context.directory,'expected.json'),'utf8'));
   const actual=await win.webContents.executeJavaScript('window.__aincrad.snapshot()');
   assert.deepEqual(JSON.parse(JSON.stringify(actual)),fixture.expected,'Whole JSON-normalized native checkpoint must reopen exactly');
   const e=actual.environment.ecology,grown=e.plants.find(p=>p.id===fixture.grownId),seedling=e.plants.find(p=>p.id===fixture.seedlingId);
   assert.equal(grown.stage,'juvenile');assert.equal(seedling.stage,'seedling');assert.equal(grown.quantity,0);assert.equal(seedling.quantity,0);assert.ok(e.materials.find(m=>m.id===fixture.materialId)?.massGrams>0);assert.equal(e.materials.find(m=>m.id===fixture.deferredId)?.seedOpportunity,true);assert.ok(e.materials.find(m=>m.id===fixture.deferredId).nextGerminationAt>e.elapsed);
   const report=await win.webContents.executeJavaScript(\`(async()=>{
    const {BUILD_SOURCE_FINGERPRINT}=await import('./src/build-info.js'),{ecologyLifecycleAudit,ecologyEnergy}=await import('./src/ecology.js'),{regionalResourceAudit}=await import('./src/ecology-regions.js');
    const before=window.__aincrad.snapshot();window.__aincrad.start();window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));document.getElementById('pause-panel').classList.add('hidden');document.getElementById('close-npc')?.click();document.getElementById('toast').classList.add('hidden');
    await new Promise(r=>setTimeout(r,700));document.getElementById('toast').classList.add('hidden');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const after=window.__aincrad.snapshot();if(JSON.stringify(before.environment.ecology)!==JSON.stringify(after.environment.ecology))throw new Error('Paused render changed ecology');
    const e=after.environment.ecology,l=e.ledger;return {sourceFingerprint:BUILD_SOURCE_FINGERPRINT,lifecycle:ecologyLifecycleAudit(e),regional:regionalResourceAudit(e),energyErrorKcal:l.initialKcal+l.photosynthesisKcal+l.externalKcal-ecologyEnergy(e)-l.humanRemovedKcal-l.metabolizedKcal-l.decomposedKcal-l.discardedKcal,metrics:window.__aincrad.metrics(),pausedRenderingReadOnly:true};
   })()\`);
   await fs.writeFile(path.join(context.output,'seedling-and-juvenile.png'),(await win.webContents.capturePage()).toPNG());
   await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,twoIndependentProcesses:true,isolatedProfile:true,wholeCheckpointEqual:true,jsonUndefinedFieldsOmitted:true,positiveRemainderPreserved:true,deferredOpportunityPreserved:true,noClosedTimeBackfill:true,fixture:fixture.fixture,growthSteps:fixture.growthSteps,grownMassGrams:grown.structureMassGrams,seedlingMassGrams:seedling.structureMassGrams,...report},null,2));
   console.log('PASS: exact disk reopen and fruitless seedling/juvenile rendering.');
  }
  clearTimeout(timeout);app.quit();
 }catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}
}));
require(path.join(context.root,'dist/desktop/main.cjs'));
`);
const electron=createRequire(import.meta.url)('electron');
for(const phase of ['write','read']){
 const flags=[harness,'--test',`--test-profile=${join(directory,'profile')}`,`--phase=${phase}`];
 if(process.platform==='linux')flags.push('--ozone-platform=headless','--disable-gpu');
 if(process.getuid?.()===0)flags.push('--no-sandbox');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const code=await new Promise((resolve,reject)=>{const child=spawn(electron,flags,{cwd:root,stdio:'inherit',env});child.on('error',reject);child.on('exit',resolve);});
 if(code!==0)throw new Error(`Native ${phase} failed (${code}); isolated artifacts retained at ${directory}`);
}
console.log(await readFile(join(output,'result.json'),'utf8'));
