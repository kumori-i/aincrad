/** Two actual Electron processes, one isolated profile: old-save migration,
 * disk reopen, physical held material, sleep and regional depletion. */
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {buildApplication} from './build.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
await buildApplication();
const directory=await mkdtemp(join(tmpdir(),'aincrad-regional-desktop-'));
const output=resolve(root,'test-results/regional-desktop');await mkdir(output,{recursive:true});
const context={root,output,directory};
const harness=join(directory,'runner.cjs');
await writeFile(harness,`
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const context=${JSON.stringify(context)},phase=process.argv.includes('--phase=write')?'write':'read';
let completed=false;
const timeout=setTimeout(()=>{console.error('Regional native QA timed out');app.exit(1);},60000);
app.on('browser-window-created',(_event,win)=>{
 win.webContents.on('did-finish-load',async()=>{
  if(completed)return;completed=true;
  try{
   for(let n=0;n<100;n++){if(await win.webContents.executeJavaScript('Boolean(window.__aincrad)'))break;await new Promise(r=>setTimeout(r,50));}
   if(phase==='write'){
    const expected=await win.webContents.executeJavaScript(\`(async()=>{
     const {CONFIG}=await import('./src/config.js');
     const {ecologyEnergy}=await import('./src/ecology.js');
     const {observeNpc,requestNpcAction,tickNpc}=await import('./src/npc.js');
     const {beginSleep,projectPhysiology}=await import('./src/biology.js');
     const {PopulationRuntime}=await import('./src/population.js');
     const {validateSave}=await import('./src/save.js');
     const raw=window.__aincrad.snapshot(),e=raw.environment.ecology,a=raw.agents[0],m=raw.agents[1];
     raw.cardinal.mode='off';
     const plant=e.plants.find(p=>p.kind==='apple_tree'&&p.position.x<-6500&&p.position.y<-5000);
     if(!plant)throw new Error('Remote fruit fixture absent');
     a.position={...plant.position};
     observeNpc(a,raw.environment);
     const pulled=requestNpcAction(a,{type:'pull',targetId:plant.id},raw.environment);
     if(!pulled.ok)throw new Error('Physical native detachment failed');
     for(let i=0;i<500&&a.active;i++)tickNpc(a,.05,raw.environment);
     const heldId=a.inventory.items[0];if(!heldId)throw new Error('Physical action did not record possession evidence');
     // Explicit depleted checkpoint tests refusal persistence, not autonomous survival.
     Object.assign(a.physiology,{availableEnergyKcal:40,storedEnergyKcal:84000,fatigue:80,sleepPressure:90,hoursSinceMeal:12});projectPhysiology(a);
     const refused=requestNpcAction(a,{type:'rest',seconds:5},raw.environment);
     if(refused.code!=='UNSAFE_TO_REST')throw new Error('Expected actual rest refusal');
     const refusalEventId=a.lastResult.eventId;
     requestNpcAction(a,{type:'wait',seconds:1},raw.environment);
     for(let i=0;i<100&&a.active;i++)tickNpc(a,.05,raw.environment);
     raw.elapsed=raw.environment.elapsed=e.elapsed=m.elapsed=a.elapsed;
     beginSleep(m,{hours:5});
     const grass=e.plants.find(p=>p.kind==='grass');grass.biomassGrams=0;
     // The intentionally depleted checkpoint starts a fresh diagnostic ledger;
     // this fixture is not represented as autonomous ecological production.
     for(const key of Object.keys(e.ledger))e.ledger[key]=0;e.ledger.initialKcal=ecologyEnergy(e);
     e.detritus.nutrients=37;e.distributionVersion=2;delete e.regionalVersion;delete e.regions;
     raw.npc=raw.agents[0];
     // Genuine v6 representation, before the juvenile schema existed.
     raw.version=6;delete raw.features;delete e.lifecycle;
     for(const p of e.plants)for(const k of ['lifecycleStage','structureMassGrams','structureKcal','structureWaterMl','recruitedAt','parentMaterialId'])delete p[k];
     for(const m of e.materials)for(const k of ['seedOpportunity','nextGerminationAt'])delete m[k];
     localStorage.setItem(CONFIG.saveKey,JSON.stringify(raw));
     const expected=validateSave(raw),runtime=new PopulationRuntime(expected),checkpoint=structuredClone(expected);runtime.dispose();
     return {expected:checkpoint,plantId:plant.id,heldId,grassId:grass.id,refusalEventId};
    })()\`);
    await fs.writeFile(path.join(context.directory,'expected.json'),JSON.stringify(expected));
    session.defaultSession.flushStorageData();
    await new Promise(r=>setTimeout(r,400));
    console.log('PASS: wrote isolated old-layout save using actual physical detachment.');
   }else{
    const fixture=JSON.parse(await fs.readFile(path.join(context.directory,'expected.json'),'utf8'));
    const actual=await win.webContents.executeJavaScript('window.__aincrad.snapshot()');
    require('node:assert/strict').deepEqual(actual,fixture.expected,'Whole native restart must restore the validated old checkpoint exactly');
    const e=actual.environment.ecology;
    if(e.distributionVersion!==3||e.regionalVersion!==1||e.detritus.nutrients!==37)throw new Error('Migration changed finite soil stock');
    if(e.plants.find(p=>p.id===fixture.grassId).biomassGrams!==0)throw new Error('Depleted grass refilled');
    if(e.materials.find(m=>m.id===fixture.heldId).heldBy!=='aster')throw new Error('Held object identity lost');
    if(actual.agents[1].physiology.sleep.state!=='onset')throw new Error('Sleep did not persist');
    if(!actual.agents[0].memory.experience.some(e=>e.id===fixture.refusalEventId&&e.details.result?.code==='UNSAFE_TO_REST'))throw new Error('Rest refusal context did not persist');
    const runtime=await win.webContents.executeJavaScript(\`(async()=>{
      const {BUILD_SOURCE_FINGERPRINT}=await import('./src/build-info.js');
      const {regionalResourceAudit}=await import('./src/ecology-regions.js');
      const {discoveryDecision}=await import('./src/discovery.js');
      const restRetryDeferred=discoveryDecision(window.__aincrad.snapshot().agents[0]).action.type==='wait';
      if(!restRetryDeferred)throw new Error('Reopened rest context did not defer repeat');
      document.getElementById('watch-aster').click();
      window.__aincrad.cardinalMode('off');
      window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));
      document.getElementById('close-npc')?.click();
      document.getElementById('pause-panel').classList.add('hidden');
      await new Promise(r=>setTimeout(r,200));
      return {restOutcomePreserved:true,restRetryDeferred,sourceFingerprint:BUILD_SOURCE_FINGERPRINT,regional:regionalResourceAudit(window.__aincrad.environment().ecology),metrics:window.__aincrad.metrics()};
    })()\`);
    await fs.writeFile(path.join(context.output,'remote-lakeshore.png'),(await win.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,twoIndependentProcesses:true,isolatedProfile:true,oldDistribution:2,newDistribution:3,completeCheckpointPreserved:true,heldMaterialPreserved:true,depletedGrassPreserved:true,soilStockPreserved:37,sleepPreserved:true,noClosedTimeBackfill:true,...runtime},null,2));
    console.log('PASS: native disk reopen preserved complete migrated checkpoint, objects, sleep, depletion and clock.');
   }
   clearTimeout(timeout);app.quit();
  }catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}
 });
});
require(path.join(context.root,'dist/desktop/main.cjs'));
`);
const electron=createRequire(import.meta.url)('electron');
for(const phase of ['write','read']){
 const flags=[harness,'--test',`--test-profile=${join(directory,'profile')}`,`--phase=${phase}`];
 if(process.platform==='linux')flags.push('--ozone-platform=headless','--disable-gpu');
 if(process.getuid?.()===0)flags.push('--no-sandbox');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const code=await new Promise((resolve,reject)=>{const child=spawn(electron,flags,{cwd:root,stdio:'inherit',env});child.on('error',reject);child.on('exit',resolve);});
 if(code!==0)throw new Error(`Native ${phase} phase failed (${code}); isolated artifacts retained at ${directory}`);
}
console.log(await readFile(join(output,'result.json'),'utf8'));
