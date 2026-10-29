/** Bounded engineering fixture. Local --prepare-only never launches Electron.
 * Actual native execution is reserved for the approved Linux/macOS CI gate. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildApplication} from './build.mjs';
import {captureWithReadiness,waitForCaptureFrames} from './native-capture-readiness.mjs';
import {canonicalApplicationRoot,nativeSourceIdentity,captureNativeChild,archiveNativeProfile,currentRouteSnapshot,assertCurrentRoute} from './carcass-native-contract.mjs';
import {assertStructuralRestoredHistory} from './structural-movement-native-contract.mjs';
import {visualReferenceEvidence,installVisualReferenceFixture,probeVisualReferenceReopen} from './visual-reference-native-fixture.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),prepareOnly=process.argv.includes('--prepare-only');
assert(process.argv.slice(2).every(arg=>arg==='--prepare-only'),'Only --prepare-only is supported');
if(!prepareOnly){
  assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_WORKFLOW==='Visual reference phase A native acceptance','Native execution requires the approved engineering CI workflow');
  assert(['linux','darwin'].includes(process.platform),'Linux/macOS only');
  assert(process.getuid?.()!==0,'Native QA requires an unprivileged sandboxed runtime');
  assert(process.platform!=='linux'||process.env.DISPLAY||process.env.WAYLAND_DISPLAY,'Authorized supported display required');
}
const outputRoot=resolve(process.env.AINCRAD_VISUAL_REFERENCE_QA_OUTPUT||join(root,'test-results/visual-reference-native'));
await mkdir(outputRoot,{recursive:true});
const output=await mkdtemp(join(outputRoot,'run-')),temporary=await mkdtemp(join(tmpdir(),'aincrad-visual-reference-'));
const profile=join(temporary,'profile');
for(const name of ['profile','home','config','cache'])await mkdir(join(temporary,name));
const application=await canonicalApplicationRoot(output),built=await buildApplication(application);
const context={output,profile,application,sourceIdentity:nativeSourceIdentity(root),sourceFingerprint:built.sourceFingerprint};
if(!prepareOnly){assert.equal(context.sourceIdentity.commit,process.env.GITHUB_SHA,'Native CI must exercise the exact approved checkout SHA');assert.equal(context.sourceIdentity.worktreeStatus,'','Native CI requires a clean reviewed source tree');}
const harness=join(output,'runner.cjs'),phases=['exercise','reopen','verify'];

function installRunner(context,helpers){
  const {app,session}=require('electron'),assert=require('node:assert/strict');
  const fs=require('node:fs/promises'),path=require('node:path');
  const {captureWithReadiness,waitForCaptureFrames,currentRouteSnapshot,assertCurrentRoute,assertStructuralRestoredHistory,
    visualReferenceEvidence,installVisualReferenceFixture,probeVisualReferenceReopen}=helpers;
  const phase=process.argv.find(arg=>arg.startsWith('--phase='))?.slice(8);
  assert(['exercise','reopen','verify'].includes(phase));
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let running=false,closed=false,allowQuit=false,stage='initializing';
  const events=[],screenshots=[];
  const deadline=setTimeout(()=>{console.error('Visual reference native deadline at '+stage);app.exit(1);},240000);
  app.on('will-quit',event=>{if(!allowQuit)event.preventDefault();else{assert(closed);console.log('VISUAL_REFERENCE_NATIVE_WILL_QUIT '+phase);}});
  const evaluate=(win,source)=>{stage=source.slice(0,140);return win.webContents.executeJavaScript(source);};
  const snapshot=win=>evaluate(win,'('+visualReferenceEvidence.toString()+')(window.__ozarkWorld.fullSnapshot())');
  const raw=win=>evaluate(win,"localStorage.getItem('aincrad.world.v2')");
  async function waitFor(win,expression){for(let i=0;i<1200;i++){if(await evaluate(win,expression))return;await delay(50);}throw new Error('Condition missing: '+expression);}
  async function capture(win,name){
    const before=await snapshot(win);
    await waitFor(win,'window.__ozarkWorld.detailReady()');
    const {png,metadata}=await captureWithReadiness({
      prepare:async()=>{const ready=await evaluate(win,'('+waitForCaptureFrames.toString()+')()');await delay(100);return ready;},
      capture:()=>win.webContents.capturePage(),
      retain:async(bytes,attempt)=>{const prefix=path.join(context.output,name+'.attempt-'+attempt.attempt);if(bytes)await fs.writeFile(prefix+'.png',bytes);await fs.writeFile(prefix+'.json',JSON.stringify({phase,...attempt},null,2));},
    });
    assert(png.length>10000,'Actual native canvas capture must be nonempty');
    await fs.writeFile(path.join(context.output,name),png);screenshots.push({name,...metadata});
    assert.deepEqual(await snapshot(win),before,'Native screenshot readiness/rendering is read-only');
  }
  async function exercise(win){
    assert.equal(await raw(win),null,'Fresh disposable profile must contain no current save');
    assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().elapsed'),0);
    const install='window.__visualReferenceFixture=await window.__ozarkWorld.referenceFixture(context=>('+installVisualReferenceFixture.toString()+')(context,document.baseURI,('+visualReferenceEvidence.toString()+')));return Boolean(window.__visualReferenceFixture)';
    assert.equal(await evaluate(win,'(async()=>{'+install+'})()'),true,'Install fixture on actual fresh main population');
    assert.equal(await evaluate(win,'window.__ozarkWorld.start()'),false,'Fixture owns the sole manual clock; normal timer start is blocked');
    assert.equal(await evaluate(win,'window.__ozarkWorld.referenceFixture(()=>true)'),null,'Fresh fixture installer is one-use');
    let status=await evaluate(win,'window.__visualReferenceFixture.status()');assert.equal(status.pose,null);
    await capture(win,'01-before-listener-choice-no-cue.png');
    status=await evaluate(win,'window.__visualReferenceFixture.beginChoice()');assert.equal(status.pose,null);
    status=await evaluate(win,'window.__visualReferenceFixture.completeChoice()');assert.equal(status.checks.choiceCompletedBeforeIndication,true);
    assert.equal(status.pose,null);await capture(win,'02-paid-choice-complete-no-cue.png');
    status=await evaluate(win,'window.__visualReferenceFixture.beginIndication()');assert.equal(status.pose,null);
    status=await evaluate(win,'window.__visualReferenceFixture.visible()');assert(status.pose);assert.equal(status.checks.visibleCrop.actualCanvas,true,'Native audit uses actual current Canvas crops');
    await fs.writeFile(path.join(context.output,'visible-parser-audit.json'),JSON.stringify(status,null,2));
    await capture(win,'03-during-paid-public-direction-cue.png');
    status=await evaluate(win,'window.__visualReferenceFixture.completeIndication()');
    assert.equal(status.pose,null);assert.equal(status.reference.observed,1);assert.equal(status.reference.updates,0);
    await fs.writeFile(path.join(context.output,'completed-reference.json'),JSON.stringify(status,null,2));
    await capture(win,'04-after-completion-no-cue.png');
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),false,'Ordinary save/UI cannot persist a fixture-owned world');
    assert.equal(await raw(win),null,'Only the one-shot explicit fixture checkpoint may write');
    status=await evaluate(win,'window.__visualReferenceFixture.pendingForSave()');assert(status.pose);
    await capture(win,'05-second-paid-indication-before-save.png');
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),false);
    const checkpoint=await evaluate(win,'window.__visualReferenceFixture.checkpoint(localStorage)');
    assert(checkpoint,'Authenticated one-shot checkpoint must persist actual main state');
    assert.equal(await evaluate(win,'window.__visualReferenceFixture.checkpoint(localStorage)'),null,'Fixture checkpoint is one attempt only');
    assert.equal(checkpoint.raw,await raw(win));
    await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify({...checkpoint,screenshots},null,2));
    status=await evaluate(win,'window.__visualReferenceFixture.interrupt()');assert.equal(status.checks.interruption.poseCleared,true);
    await fs.writeFile(path.join(context.output,'interruption.json'),JSON.stringify(status,null,2));
    await capture(win,'06-explicit-interruption-no-cue.png');
    assert.equal(await raw(win),checkpoint.raw,'Post-save interruption cannot rewrite saved mid-action bytes');
    await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify({...checkpoint,screenshots},null,2));
    await evaluate(win,'window.__visualReferenceFixture.dispose();true');
    await session.defaultSession.flushStorageData();
  }
  async function reopen(win){
    const saved=JSON.parse(await fs.readFile(path.join(context.output,'checkpoint.json'),'utf8'));
    assert.equal(await raw(win),saved.raw,'Independent reopen reads exact saved mid-indication bytes');
    const restored=await snapshot(win);assert.deepEqual(restored,saved.expectedRestored,'Actual reopen preserves clocks/bodies/history and interrupts only unfinished action');
    assertStructuralRestoredHistory(JSON.parse(saved.raw),restored);
    assert.equal(await evaluate(win,'window.__ozarkWorld.referenceFixture(()=>true)'),null,'Loaded profile cannot obtain fresh fixture authority');
    const reference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()');
    assert.equal(reference.pending,0);assert.equal(reference.exchanges,0);assert.equal(reference.updates,0);assert.deepEqual(reference.learners,[]);
    const replay=await evaluate(win,'('+probeVisualReferenceReopen.toString()+')(document.baseURI,window.__ozarkWorld.fullSnapshot(),'+JSON.stringify(saved.serializedActive)+','+JSON.stringify(saved.serializedPermit)+')');
    assert.equal(replay.noRevivedAuthority,true);
    assert.deepEqual(await snapshot(win),restored,'Read-only copied-state replay audit cannot mutate reopened main');
    await capture(win,'07-independent-reopen-no-authority.png');
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),true);
    await fs.writeFile(path.join(context.output,'after-checkpoint.json'),JSON.stringify({raw:await raw(win),expectedRestored:restored,replay,reference,
      fixtureDisclosure:saved.fixtureDisclosure,screenshots:[...saved.screenshots,...screenshots]},null,2));
    await session.defaultSession.flushStorageData();
  }
  async function verify(win){
    const saved=JSON.parse(await fs.readFile(path.join(context.output,'after-checkpoint.json'),'utf8'));
    assert.equal(await raw(win),saved.raw,'Third process reads exact post-interruption save bytes');
    const restored=await snapshot(win);assert.deepEqual(restored,saved.expectedRestored,'Repeated reopen cannot duplicate interruption or revive authority');
    assertStructuralRestoredHistory(JSON.parse(saved.raw),restored);
    const reference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()');assert.equal(reference.pending,0);assert.equal(reference.observed,0);assert.equal(reference.updates,0);
    await capture(win,'08-repeated-reopen-no-duplicate-interruption.png');
    await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:false,
      sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,
      sameMainStateAndPopulation:true,fixedStepSeconds:1/60,paidChoiceBeforeIndication:true,paidIndicationSeconds:1.8,
      actualCanvasCrops:true,consecutiveListenerGeometryAudit:true,privateCanonicalWitnessOnly:true,
      noAssociationUpdates:true,noClosedTimeProgression:true,noRevivedAuthority:true,noDuplicateInterruption:true,
      screenshots:[...saved.screenshots,...screenshots],fixtureDisclosure:saved.fixtureDisclosure,
      scope:'Bounded engineering-only deliberate main-world actions, native pixels, paid parser audit and isolated native close/reopen. No autonomous cohort, learned associations, scientific-seed sweep or behavior-success claim.'},null,2));
  }
  async function closeNormally(win){
    assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().started'),false,'Engineering fixture must never start an independent wall-clock loop');
    await session.defaultSession.flushStorageData();await delay(100);
    const lifecycle=[],done=new Promise(resolve=>win.once('closed',()=>{lifecycle.push('closed');closed=true;resolve();}));
    win.once('close',()=>lifecycle.push('close'));win.close();await done;
    assert.deepEqual(lifecycle,['close','closed']);assert.equal(win.isDestroyed(),true);
    await fs.writeFile(path.join(context.output,phase+'-close.json'),JSON.stringify({phase,lifecycle,destroyed:true},null,2));
    console.log('VISUAL_REFERENCE_NATIVE_CLOSED '+phase);clearTimeout(deadline);allowQuit=true;app.quit();
  }
  app.on('browser-window-created',(_event,win)=>{
    win.webContents.on('console-message',(_event,...details)=>events.push({kind:'console',details}));
    win.webContents.on('did-fail-load',(_event,...details)=>events.push({kind:'load-failure',details}));
    win.webContents.on('render-process-gone',(_event,details)=>events.push({kind:'renderer-gone',details}));
    win.webContents.once('did-finish-load',async()=>{
      if(running)return;running=true;
      try{
        const prefs=win.webContents.getLastWebPreferences();
        assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.sandbox,true);assert.equal(prefs.webSecurity,true);
        assert(!process.argv.includes('--no-sandbox'));assert(!process.argv.includes('--disable-setuid-sandbox'));
        assert.equal(await fs.realpath(app.getPath('userData')),await fs.realpath(context.profile),'Application uses exact isolated disposable test profile');
        await fs.writeFile(path.join(context.output,phase+'-sandbox.json'),JSON.stringify({sourceIdentity:context.sourceIdentity,
          platform:process.platform,arch:process.arch,electron:process.versions.electron,pid:process.pid,profile:app.getPath('userData'),requestedProfile:context.profile,canonicalProfile:await fs.realpath(context.profile),
          nodeIntegration:prefs.nodeIntegration,contextIsolation:prefs.contextIsolation,sandbox:prefs.sandbox,webSecurity:prefs.webSecurity},null,2));
        await waitFor(win,'Boolean(window.__ozarkWorld)');
        assertCurrentRoute(await evaluate(win,'('+currentRouteSnapshot.toString()+')(window,document)'));
        assert.equal(await evaluate(win,"import('./src/build-info.js').then(module=>module.BUILD_SOURCE_FINGERPRINT)"),context.sourceFingerprint);
        await ({exercise,reopen,verify}[phase])(win);await closeNormally(win);
      }catch(error){
        console.error(error);const failure={phase,stage,error:String(error?.stack||error),events};
        try{failure.url=win.webContents.getURL();await fs.writeFile(path.join(context.output,phase+'-failure.png'),(await win.webContents.capturePage()).toPNG());}catch(e){failure.captureError=String(e);}
        await fs.writeFile(path.join(context.output,phase+'-failure.json'),JSON.stringify(failure,null,2));clearTimeout(deadline);app.exit(1);
      }
    });
  });
  // Production asset scheme and profile registration remain synchronous.
  require(path.join(context.application,'desktop/main.cjs'));
}

const helpers={captureWithReadiness,waitForCaptureFrames,currentRouteSnapshot,assertCurrentRoute,assertStructuralRestoredHistory,
  visualReferenceEvidence,installVisualReferenceFixture,probeVisualReferenceReopen};
// Serialized helper expressions are created outside installRunner, so their
// imported assertion dependency must exist in the generated outer scope.
const source="const assert = require('node:assert/strict');\n"+'('+installRunner.toString()+')('+JSON.stringify(context)+',{'+Object.entries(helpers).map(([key,fn])=>key+':'+fn.toString()).join(',')+'});\n';
let nativeProcessesClosed=true,nativeProcessesStarted=0;
try{
  await writeFile(harness,source);
  const prepared={...context,harness,harnessSha256:createHash('sha256').update(source).digest('hex'),phases,
    nativeExecutionPerformed:false,sandboxBypassFlags:[],scope:'engineering-only; no cohort or learning'};
  await writeFile(join(output,'prepared.json'),JSON.stringify(prepared,null,2));
  if(prepareOnly)console.log(JSON.stringify(prepared));
  else{
    const electron=createRequire(import.meta.url)('electron');
    for(const phase of phases){
      const flags=[harness,'--test',`--test-profile=${profile}`,`--phase=${phase}`];if(process.platform==='linux')flags.push('--disable-gpu');
      const env={...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary,HOME:join(temporary,'home'),XDG_CONFIG_HOME:join(temporary,'config'),XDG_CACHE_HOME:join(temporary,'cache')};delete env.ELECTRON_RUN_AS_NODE;
      nativeProcessesClosed=false;
      const result=await captureNativeChild(spawn,electron,flags,{cwd:root,stdio:['ignore','pipe','pipe'],env},bytes=>process.stdout.write(bytes),bytes=>process.stderr.write(bytes));
      nativeProcessesClosed=true;if(!result.spawnError)nativeProcessesStarted++;
      await writeFile(join(output,phase+'-process.json'),JSON.stringify({code:result.code,signal:result.signal,spawnError:result.spawnError?String(result.spawnError):null,processCloseObserved:true},null,2));
      await writeFile(join(output,phase+'-stdout.txt'),result.stdout);await writeFile(join(output,phase+'-stderr.txt'),result.stderr);
      if(result.spawnError)throw result.spawnError;
      assert.deepEqual({code:result.code,signal:result.signal},{code:0,signal:null},`Native ${phase} failed; retained evidence: ${output}`);
      assert(result.stdout.includes('VISUAL_REFERENCE_NATIVE_CLOSED '+phase));assert(result.stdout.includes('VISUAL_REFERENCE_NATIVE_WILL_QUIT '+phase));
    }
    const processIds=await Promise.all(phases.map(async phase=>JSON.parse(await readFile(join(output,phase+'-sandbox.json'),'utf8')).pid));
    assert(processIds.every(pid=>Number.isInteger(pid)&&pid>0));assert.equal(new Set(processIds).size,3);
    const result=JSON.parse(await readFile(join(output,'result.json'),'utf8'));
    Object.assign(result,{nativeExecutionPerformed:true,threeIndependentElectronProcesses:true,processIds,actualNativeCloseEvents:true,actualNativeWillQuitEvents:true});
    await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }
}finally{
  let preserved=false;
  if(nativeProcessesClosed)try{const archive=await archiveNativeProfile(profile,join(output,'profile-evidence'));
    await writeFile(join(output,'profile-evidence.json'),JSON.stringify({runtimeProfile:profile,copiedAfterProcessesClosed:nativeProcessesStarted>0,nativeExecutionPerformed:nativeProcessesStarted>0,archive},null,2));preserved=true;
  }catch(error){console.error('Profile preservation failed; original retained at '+temporary,error);process.exitCode=1;}
  if(preserved)await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(error=>{console.error('Disposable profile cleanup failed: '+temporary,error);process.exitCode=1;});
}
