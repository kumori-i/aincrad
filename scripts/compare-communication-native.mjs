/** Preregistered behavioral comparison; never launches in --prepare-only mode. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
import { canonicalApplicationRoot, nativeSourceIdentity } from './carcass-native-contract.mjs';
import { captureWithReadiness, waitForCaptureFrames } from './native-capture-readiness.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),prepareOnly=process.argv.includes('--prepare-only');
assert(process.argv.slice(2).every(a=>a==='--prepare-only'));
const EXPECTED_SOURCE_FINGERPRINT='0797f513343ab4e3d86134ffa7eb768d5a3d2a39c2246303320fcdfc46a8d25f';
// Execution metadata is validated before building or spawning any native process.
function validateComparisonExecution(env,head){
  assert.equal(env.GITHUB_EVENT_NAME,'create','Reserved branch create event required');
  assert.equal(env.AINCRAD_COMPARISON_REF_TYPE,'branch','Branch event required');
  assert.equal(env.AINCRAD_COMPARISON_EVENT_REF,'experiments/communication-bridge-v1-once','Reserved event ref required');
  assert.equal(env.GITHUB_REF,'refs/heads/experiments/communication-bridge-v1-once','Reserved git ref required');
  assert.equal(env.GITHUB_RUN_ATTEMPT,'1','Comparison reruns are forbidden');
  assert.match(env.GITHUB_RUN_ID||'',/^[1-9][0-9]*$/,'Run ID required');
  assert.match(env.AINCRAD_COMPARISON_EXPECTED_SHA||'',/^[a-f0-9]{40}$/,'Expected event SHA required');
  assert.equal(env.GITHUB_SHA,env.AINCRAD_COMPARISON_EXPECTED_SHA,'Event SHA mismatch');
  assert.equal(head,env.AINCRAD_COMPARISON_EXPECTED_SHA,'Checked-out HEAD differs from event SHA');
  return {verified:true,eventName:env.GITHUB_EVENT_NAME,eventRef:env.AINCRAD_COMPARISON_EVENT_REF,refType:env.AINCRAD_COMPARISON_REF_TYPE,ref:env.GITHUB_REF,sha:env.GITHUB_SHA,head,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT};
}
const sourceIdentity=nativeSourceIdentity(root);
const execution=prepareOnly?{verified:false,authorizedForBehavior:false,reason:'Launch-free preparation; not execution authorization'}:validateComparisonExecution(process.env,sourceIdentity.commit);

if(!prepareOnly){assert(['linux','darwin'].includes(process.platform));assert(process.getuid?.()!==0,'Unprivileged sandbox required');assert(process.platform!=='linux'||process.env.DISPLAY||process.env.WAYLAND_DISPLAY,'Authorized display required');}
const protocol={seeds:[211,223,227],arms:[true,false],horizon:600,dt:.25,trialWallMs:600000,totalWallMs:3900000,artifactBytes:250*1024*1024,noWarmStart:true};
const outputRoot=resolve(process.env.AINCRAD_COMMUNICATION_COMPARISON_OUTPUT||join(root,'test-results/communication-comparison'));
await mkdir(outputRoot,{recursive:true});const output=await mkdtemp(join(outputRoot,'run-'));
const temporary=await mkdtemp(join(tmpdir(),'aincrad-communication-comparison-'));
const application=await canonicalApplicationRoot(output),built=await buildApplication(application);
if(!prepareOnly)assert.equal(built.sourceFingerprint,EXPECTED_SOURCE_FINGERPRINT,'Reviewed source fingerprint mismatch');
const context={output,application,protocol,sourceIdentity,sourceFingerprint:built.sourceFingerprint,expectedSourceFingerprint:EXPECTED_SOURCE_FINGERPRINT,execution};
const harness=join(output,'comparison-runner.cjs');
function install(context,captureWithReadiness,waitForCaptureFrames){
  const {app}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
  const seed=Number(process.argv.find(a=>a.startsWith('--seed='))?.slice(7)),enabled=process.argv.includes('--symbols');
  assert(context.protocol.seeds.includes(seed));const name=seed+'-'+(enabled?'on':'off');
  let allowQuit=false,stage='boot';
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function directoryBytes(dir){let n=0;for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);n+=e.isDirectory()?await directoryBytes(p):(await fs.stat(p)).size;}return n;}
  async function persist(file,data){const previous=await fs.stat(file).then(s=>s.size).catch(()=>0);const size=Buffer.byteLength(data);assert(await directoryBytes(context.output)-previous+size<=context.protocol.artifactBytes-2097152,'Artifact cap reached');await fs.writeFile(file,data);}
  app.on('will-quit',e=>{if(!allowQuit)e.preventDefault();});
  const evaluate=(win,code)=>{stage=code.slice(0,100);return win.webContents.executeJavaScript(code);};
  async function capture(win,suffix){
    const {png}=await captureWithReadiness({prepare:()=>evaluate(win,'('+waitForCaptureFrames.toString()+')()'),capture:()=>win.webContents.capturePage(),retain:async(bytes,meta)=>{if(bytes)await persist(path.join(context.output,name+'-'+suffix+'-attempt'+meta.attempt+'.png'),bytes);await persist(path.join(context.output,name+'-'+suffix+'-attempt'+meta.attempt+'.json'),JSON.stringify(meta));}});
    await persist(path.join(context.output,name+'-'+suffix+'.png'),png);
  }
  app.on('browser-window-created',(_event,win)=>{
    win.webContents.once('did-finish-load',async()=>{
      try{
        const prefs=win.webContents.getLastWebPreferences();assert.equal(prefs.sandbox,true);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.webSecurity,true);
        for(let i=0;i<1000;i++){if(await evaluate(win,'Boolean(window.__ozarkWorld)'))break;await delay(50);}
        assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().started'),false);
        assert.equal(await evaluate(win,"localStorage.getItem('aincrad.world.v2')"),null);
        await evaluate(win,`(async()=>{
          const [{createCommunicationExperiment},{createCommunicationPixelSensor},{createOzarkWorldGeometry},{OzarkWorldRenderer}]=await Promise.all([
            import('./src/communication-experiment.js'),import('./src/communication-pixels.js'),import('./src/ozark-world-geometry.js'),import('./src/ozark-world-renderer.js')]);
          const geometry=createOzarkWorldGeometry(),sensor=createCommunicationPixelSensor(document);
          const experiment=createCommunicationExperiment({geometry,seed:${seed},enabled:${enabled},pixelSensor:sensor});
          document.getElementById('communication-dialog').showModal();
          document.getElementById('communication-status').textContent='PREREGISTERED COMPARISON · seed ${seed} · symbols ${enabled?'on':'off'} · fresh learners';
          const renderer=new OzarkWorldRenderer(document.getElementById('communication-world'),geometry);
          renderer.resize(800,450,1);renderer.followNpc=true;renderer.followId='aster';
          window.__communicationComparison={experiment,sensor,renderer};renderer.draw(experiment.state);
        })()`);
        await capture(win,'initial');
        let snapshot;
        while(!snapshot||snapshot.elapsed<context.protocol.horizon){
          snapshot=await evaluate(win,`(()=>{const x=window.__communicationComparison;for(let i=0;i<40&&x.experiment.state.elapsed<600;i++)x.experiment.tick(.25);const s=x.experiment.snapshot();x.renderer.draw(x.experiment.state);document.getElementById('communication-elapsed').textContent=s.elapsed+' / 600 simulation seconds';document.getElementById('communication-counts').textContent=s.exchanges+' exchanges · '+s.updates+' updates · '+s.censored+' censored';document.getElementById('communication-bodies').textContent=s.agents.map(a=>a.name+': food '+a.hunger+', water '+a.thirst+', energy '+a.energy+'; meals '+a.meals+', drinks '+a.drinks+', collapses '+a.collapses).join('\\n');return s;})()`);
          await persist(path.join(context.output,name+'-checkpoint.json'),JSON.stringify({seed,enabled,status:snapshot.elapsed>=600?'horizon-reached':'incomplete',snapshot},null,2));
          await delay(0);
        }
        assert.equal(snapshot.elapsed,600);
        await capture(win,'terminal');
        const beforeDisposal=snapshot;
        snapshot=await evaluate(win,'(()=>{const x=window.__communicationComparison;x.experiment.dispose();x.sensor.dispose();return x.experiment.snapshot();})()');
        assert.equal(await evaluate(win,"localStorage.getItem('aincrad.world.v2')"),null,'Comparison never writes ordinary save');
        await persist(path.join(context.output,name+'-result.json'),JSON.stringify({seed,enabled,status:'completed',nativeExecutionPerformed:true,pid:process.pid,platform:process.platform,arch:process.arch,snapshot,beforeDisposal,terminalPendingInterpretation:'Terminal snapshot after disposal includes censoring at the fixed horizon; beforeDisposal is retained separately.',...context},null,2));
        const closed=new Promise(r=>win.once('closed',r));win.close();await closed;allowQuit=true;app.quit();
      }catch(error){
        try{await persist(path.join(context.output,name+'-failure.json'),JSON.stringify({seed,enabled,status:'incomplete',stage,error:String(error.stack||error)},null,2));}finally{app.exit(1);}
      }
    });
  });
  require(path.join(context.application,'desktop/main.cjs'));
}
await writeFile(harness,'('+install.toString()+')('+JSON.stringify(context)+','+captureWithReadiness.toString()+','+waitForCaptureFrames.toString()+');\n');
const manifest={...context,harness,nativeExecutionPerformed:false,trials:protocol.seeds.flatMap(seed=>protocol.arms.map(enabled=>({seed,enabled,status:'not-started'})))};
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
async function bytes(directory){let size=0;for(const e of await readdir(directory,{withFileTypes:true})){const p=join(directory,e.name);size+=e.isDirectory()?await bytes(p):(await stat(p)).size;}return size;}
try{
  if(prepareOnly)console.log(JSON.stringify(manifest));
  else{
    const start=Date.now(),electron=createRequire(import.meta.url)('electron');
    for(const trial of manifest.trials){
      if(Date.now()-start>=protocol.totalWallMs){trial.status='not-started-total-time-cap';continue;}
      if(await bytes(output)>=protocol.artifactBytes){trial.status='not-started-artifact-cap';continue;}
      const name=trial.seed+'-'+(trial.enabled?'on':'off'),dir=join(temporary,name);
      for(const child of ['profile','home','config','cache'])await mkdir(join(dir,child),{recursive:true});
      const flags=[harness,'--test','--test-profile='+join(dir,'profile'),'--seed='+trial.seed];if(trial.enabled)flags.push('--symbols');if(process.platform==='linux')flags.push('--disable-gpu');
      const env={...process.env,TMPDIR:dir,TMP:dir,TEMP:dir,HOME:join(dir,'home'),XDG_CONFIG_HOME:join(dir,'config'),XDG_CACHE_HOME:join(dir,'cache')};delete env.ELECTRON_RUN_AS_NODE;
      const trialStart=Date.now();let reason=null;
      const result=await new Promise(resolve=>{
        const child=spawn(electron,flags,{cwd:root,stdio:['ignore','pipe','pipe'],env,detached:true});let stdout='',stderr='',spawnError=null;
        child.stdout.on('data',b=>{if(stdout.length<65536)stdout+=b;});child.stderr.on('data',b=>{if(stderr.length<65536)stderr+=b;});child.on('error',e=>{spawnError=String(e);});
        const kill=why=>{if(!reason){reason=why;try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}};
        const timer=setTimeout(()=>kill('wall-time-cap'),Math.min(protocol.trialWallMs,protocol.totalWallMs-(Date.now()-start)));
        const budget=setInterval(()=>{void bytes(output).then(n=>{if(n>protocol.artifactBytes)kill('artifact-cap');}).catch(()=>kill('artifact-check-failed'));},1000);
        child.on('close',(code,signal)=>{clearTimeout(timer);clearInterval(budget);resolve({code,signal,stdout,stderr,spawnError});});
      });
      trial.wallMs=Date.now()-trialStart;trial.status=result.code===0&&!reason?'completed':reason||'failed';trial.code=result.code;trial.signal=result.signal;trial.spawnError=result.spawnError;
      await writeFile(join(output,name+'-process.json'),JSON.stringify(trial,null,2));await writeFile(join(output,name+'-stdout.txt'),result.stdout);await writeFile(join(output,name+'-stderr.txt'),result.stderr);
      manifest.nativeExecutionPerformed=true;await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
    }
    manifest.wallMs=Date.now()-start;manifest.artifactBytes=await bytes(output);manifest.complete=manifest.trials.every(t=>t.status==='completed');
    await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));if(!manifest.complete)process.exitCode=1;
  }
}finally{await rm(temporary,{recursive:true,force:true});}
