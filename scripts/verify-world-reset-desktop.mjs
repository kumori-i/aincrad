/** Real sandboxed reset/close/reopen acceptance. --prepare-only never launches Electron. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildApplication } from './build.mjs';
import { captureWithReadiness, waitForCaptureFrames } from './native-capture-readiness.mjs';
import { nativeSourceIdentity, captureNativeChild, archiveNativeProfile } from './carcass-native-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
assert.ok(process.argv.slice(2).every(arg => arg === '--prepare-only'), 'Only --prepare-only is supported');
if (!prepareOnly && !['linux','darwin'].includes(process.platform)) throw new Error('Native reset QA supports Linux and macOS only');
if (!prepareOnly && process.getuid?.() === 0) throw new Error('Native reset QA requires an unprivileged sandboxed runtime');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Native reset QA requires an authorized supported display; preparation is not native execution');
const outputRoot = resolve(process.env.AINCRAD_RESET_QA_OUTPUT || join(root,'test-results/world-reset-desktop'));
await mkdir(outputRoot,{recursive:true});
const output = await mkdtemp(join(outputRoot,'run-'));
const temporary = await mkdtemp(join(tmpdir(),'aincrad-reset-'));
const profile = join(temporary,'profile');
await mkdir(profile);
for (const name of ['home','config','cache']) await mkdir(join(temporary,name));
// Build separately from normal dist so preparation cannot race another test's build.
await mkdir(join(output,'app'));
const application = await realpath(join(output,'app'));
const built = await buildApplication(application);
const modelPreferences = JSON.stringify({...createRequire(import.meta.url)(join(application,'desktop/model-provider.cjs')).DEFAULTS, enabled:false, model:'reset-qa-preference'});
await writeFile(join(profile,'agent-model.json'),modelPreferences,{mode:0o600});
const phases = ['seed','reset','reopen','protected-reset','protected-reopen'];
const dialogHelper = join(output,'native-save-dialog.mjs');
await writeFile(dialogHelper,await readFile(join(root,'scripts/native-save-dialog.mjs')));
const context = { output, profile, application, dialogHelper, modelPreferences, sourceIdentity:nativeSourceIdentity(root), sourceFingerprint:built.sourceFingerprint };
const harness = join(output,'runner.cjs');
let closed = true, nativeProcessesStarted = 0;
try {
  await writeFile(harness, `
const {app,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const context=${JSON.stringify(context)};
const phase=process.argv.find(arg=>arg.startsWith('--phase='))?.slice(8);
assert.ok(${JSON.stringify(phases)}.includes(phase));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let running=false,allowQuit=false,closeObserved=false,activeWindow=null,failureStarted=false,stage='initializing';
const events=[],screenshots=[];
const deadline=setTimeout(()=>{void failNative(new Error('Native reset timed out: '+phase+' at '+stage));},180000);
app.on('will-quit',event=>{if(!allowQuit){event.preventDefault();return;}assert.ok(closeObserved);console.log('RESET_NATIVE_WILL_QUIT '+phase);});
const evaluate=(win,code)=>{stage='renderer: '+code.slice(0,160);return win.webContents.executeJavaScript(code);};
async function failNative(error){
  if(failureStarted)return;failureStarted=true;clearTimeout(deadline);
  console.error(error);
  const failure={phase,stage,error:String(error.stack||error),events};
  // Preserve diagnostics even if a renderer has stalled. Never retry the reset.
  const finalDeadline=setTimeout(()=>app.exit(1),10000);
  try{
    await fs.writeFile(path.join(context.output,phase+'-failure.json'),JSON.stringify(failure,null,2));
    if(activeWindow&&!activeWindow.isDestroyed()){
      failure.url=activeWindow.webContents.getURL();
      try{failure.renderer=await Promise.race([activeWindow.webContents.executeJavaScript("({resetStatus:document.getElementById('reset-status')?.textContent,dialogOpen:document.getElementById('reset-dialog')?.open,reloadVisible:!document.getElementById('reset-reload')?.hidden,confirmDisabled:document.getElementById('reset-confirm')?.disabled,world:window.__ozarkWorld?.snapshot(),stored:(()=>{try{const r=localStorage.getItem('aincrad.world.v2');return {length:r?.length,elapsed:JSON.parse(r)?.elapsed};}catch(e){return {error:String(e)};}})()})"),delay(2500).then(()=>{throw new Error('Failure-state renderer probe timed out');})]);}
      catch(probeError){failure.probeError=String(probeError);}
      try{const image=await Promise.race([activeWindow.webContents.capturePage(),delay(2500).then(()=>{throw new Error('Failure screenshot timed out');})]);await fs.writeFile(path.join(context.output,phase+'-failure.png'),image.toPNG());}
      catch(captureError){failure.captureError=String(captureError);}
    }
    await fs.writeFile(path.join(context.output,phase+'-failure.json'),JSON.stringify(failure,null,2));
  }finally{clearTimeout(finalDeadline);app.exit(1);}
}
async function expectReload(win,action){
  let listener,timer;
  const loaded=new Promise(resolve=>{listener=resolve;win.webContents.once('did-finish-load',listener);});
  try{
    await Promise.race([(async()=>{await action();stage='waiting for confirmed reset did-finish-load';await loaded;})(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Confirmed reset did not finish reloading; inspect navigation events and failure-state UI')),60000);})]);
  }finally{clearTimeout(timer);win.webContents.removeListener('did-finish-load',listener);}
}
async function waitFor(win,expression){
  for(let i=0;i<900;i++){try{if(await evaluate(win,expression))return;}catch{}await delay(50);}
  throw new Error('Native condition missing: '+expression);
}
const captureWithReadiness=${captureWithReadiness.toString()};
async function capture(win,name){
  const {png,metadata}=await captureWithReadiness({
    prepare:async()=>{const ready=await evaluate(win,'('+${JSON.stringify(waitForCaptureFrames.toString())}+')()');await delay(100);return ready;},
    capture:()=>win.webContents.capturePage(),
    retain:async(bytes,attempt)=>{const prefix=path.join(context.output,name+'.attempt-'+attempt.attempt);if(bytes!==undefined)await fs.writeFile(prefix+'.png',bytes);await fs.writeFile(prefix+'.json',JSON.stringify(attempt,null,2));}
  });
  assert.ok(png.length>10000,'Native screenshot must be nonempty');
  await fs.writeFile(path.join(context.output,name),png);screenshots.push({name,bytes:png.length,width:metadata.width,height:metadata.height});
}
async function getRaw(win){return evaluate(win,"localStorage.getItem('aincrad.world.v2')");}
async function invariantKeys(win){
  assert.deepEqual(await evaluate(win,"['reset.qa.preference','aincrad.world.v1','aincrad.save.v1','reset.qa.backup'].map(key=>localStorage.getItem(key))"),['preference retained','legacy current bytes','legacy original bytes','unrelated backup bytes']);
}
async function fresh(win){
  const actual=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  assert.equal(actual.elapsed,0,'Reset starts the canonical clock at zero');
  assert.equal(actual.distance,0);assert.equal(actual.waypoint,null);
  assert.equal(actual.environment.settings.hourOverride,null,'Test hour must not be preserved');
  assert.equal(actual.environment.settings.weatherOverride,null,'Test weather must not be preserved');
  assert.deepEqual(actual.community.messages,[],'Old journal conversation must not survive');
  for(const agent of actual.agents){assert.equal(agent.elapsed,0);assert.equal(agent.learning,true,'Test learning override must not survive');}
  await invariantKeys(win);
  return JSON.parse(JSON.stringify(actual));
}
async function presentFreshPausedUi(win,name){
  const transition=await evaluate(win,"(()=>{const api=window.__ozarkWorld;const before=api.snapshot();if(before.started||before.elapsed!==0)throw new Error('Fresh presentation requires inert zero-time session');if(!api.start())throw new Error('Normal fresh-session start/save failed');api.pause();return api.snapshot();})()");
  assert.equal(transition.started,true);assert.equal(transition.paused,true);assert.equal(transition.elapsed,0);
  await waitFor(win,"!document.getElementById('hud').classList.contains('hidden') && document.getElementById('day').textContent.replaceAll(' ','')==='DAY01' && document.getElementById('npc-short').textContent.includes('Aster') && document.getElementById('npc-short').textContent.includes('Mira')");
  const ui=await evaluate(win,"({hudVisible:getComputedStyle(document.getElementById('hud')).display!=='none',pauseVisible:!document.getElementById('pause-panel').classList.contains('hidden'),day:document.getElementById('day').textContent,agent:document.getElementById('npc-short').textContent,elapsed:window.__ozarkWorld.snapshot().elapsed})");
  assert.equal(ui.hudVisible,true);assert.equal(ui.pauseVisible,true);assert.equal(ui.elapsed,0);
  assert.match(ui.agent,/Aster/);assert.match(ui.agent,/Mira/);assert.equal(ui.day.replaceAll(' ',''),'DAY01');
  await capture(win,name);
  return ui;
}
async function openReset(win,protectedSave=false){
  await evaluate(win,"document.getElementById('"+(protectedSave?'recovery-reset-world':'reset-world')+"').click()");
  await waitFor(win,"document.getElementById('reset-dialog').open");
}
async function cancelChecks(win,protectedSave){
  const before=await getRaw(win);
  await openReset(win,protectedSave);
  await capture(win,phase+'-confirmation.png');
  await evaluate(win,"document.getElementById('reset-cancel').click()");
  await waitFor(win,"!document.getElementById('reset-dialog').open");
  assert.equal(await getRaw(win),before,'Cancel leaves exact old stored bytes');
  await openReset(win,protectedSave);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});
  await waitFor(win,"!document.getElementById('reset-dialog').open");
  assert.equal(await getRaw(win),before,'Native Escape leaves exact old stored bytes');
}
async function confirmedReset(win,protectedSave){
  await openReset(win,protectedSave);
  assert.equal(await evaluate(win,"document.getElementById('reset-confirm').disabled"),true,'No-backup path requires explicit acknowledgement');
  await evaluate(win,"document.getElementById('reset-acknowledge').click()");
  // Two same-turn clicks exercise the pending guard, not two destructive operations.
  await expectReload(win,()=>evaluate(win,"document.getElementById('reset-confirm').click();document.getElementById('reset-confirm').click()").catch(error=>{if(!/context|destroyed|navigation/i.test(error.message))throw error;}));
  await waitFor(win,'Boolean(window.__ozarkWorld)');
  assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().blocked'),false);
  await fresh(win);
  assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().started'),false,'Disposable route remains inert after guarded reload');
  const resetRaw=await getRaw(win);
  await capture(win,phase+'-fresh-inert.png');
  const state=await fresh(win),raw=await getRaw(win);
  assert.equal(raw,resetRaw,'Inert checkpoint preserves exact reset replacement bytes');
  // Wait beyond ordinary ten-second autosave to detect resurrected old-session writes.
  await delay(10500);assert.equal(await getRaw(win),raw,'Old autosave and pending work cannot resurrect the old world');
  await fs.writeFile(path.join(context.output,phase+'-checkpoint.json'),JSON.stringify({raw,state,resetRaw,checkpointKind:'exact-reset-replacement-inert-no-subsequent-save',screenshots},null,2));
}
async function nativeBackupChecks(win){
  const {driveNativeSaveDialog}=await import(require('node:url').pathToFileURL(context.dialogHelper).href);
  const original=await getRaw(win);
  await openReset(win,true);
  await evaluate(win,"document.getElementById('reset-backup-confirm').click()");
  const canceled=await driveNativeSaveDialog({pid:process.pid,action:'cancel',screenshot:path.join(context.output,'backup-native-cancel.png')});
  await waitFor(win,"document.getElementById('reset-status').textContent.includes('Backup canceled')");
  assert.equal(await getRaw(win),original,'Actual native dialog cancellation aborts combined reset');
  await capture(win,'backup-canceled-app.png');
  // Real dialog selection reaches the real bridge; profile destination rejection
  // supplies a deterministic failure without mocking the dialog or filesystem.
  const forbidden=path.join(context.profile,'forbidden-current-backup.json');
  await evaluate(win,"document.getElementById('reset-backup-confirm').click()");
  const failed=await driveNativeSaveDialog({pid:process.pid,action:'save',destination:forbidden,screenshot:path.join(context.output,'backup-native-forbidden.png')});
  await waitFor(win,"document.getElementById('reset-status').textContent.includes('Backup failed')");
  assert.equal(await getRaw(win),original,'Actual native dialog forbidden destination failure prevents reset');
  await assert.rejects(fs.access(forbidden));
  await capture(win,'backup-failed-app.png');
  const destination=path.join(context.output,'current-world-backup.json');
  let saved;
  await expectReload(win,async()=>{
    await evaluate(win,"document.getElementById('reset-backup-confirm').click()");
    saved=await driveNativeSaveDialog({pid:process.pid,action:'save',destination,screenshot:path.join(context.output,'backup-native-success.png')});
  });
  await waitFor(win,'Boolean(window.__ozarkWorld)');
  const record=JSON.parse(await fs.readFile(destination,'utf8'));
  const {decodeCurrentWorldBackup}=require(path.join(context.application,'desktop/raw-save-backup.cjs'));
  assert.equal(record.saveKey,'aincrad.world.v2');
  assert.equal(decodeCurrentWorldBackup(record).raw,original,'Actual native backup preserves exact invalid original stored bytes');
  assert.equal((await fs.stat(destination)).mode&0o777,0o600);
  await fresh(win);const resetRaw=await getRaw(win);
  assert.notEqual(resetRaw,original);
  await capture(win,'protected-reset-fresh-inert.png');
  const state=await fresh(win),raw=await getRaw(win);
  assert.equal(raw,resetRaw,'Inert protected checkpoint preserves exact reset replacement bytes');
  await delay(10500);
  assert.equal(await getRaw(win),raw,'Old autosave cannot resurrect backed-up world');
  await fs.writeFile(path.join(context.output,phase+'-checkpoint.json'),JSON.stringify({raw,state,resetRaw,checkpointKind:'exact-reset-replacement-inert-no-subsequent-save',screenshots,backup:record},null,2));
  await fs.writeFile(path.join(context.output,'native-backup-result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:true,actualDialogCancel:true,actualDialogSuccess:true,actualDialogForbiddenDestinationFailure:true,exactOriginalStoredBytes:true,dialogs:[canceled,failed,saved],visualInspection:'required'},null,2));
}
async function run(win){
  assert.equal(await fs.readFile(path.join(context.profile,'agent-model.json'),'utf8'),context.modelPreferences,'Local model preferences remain unchanged');
  assert.equal(win.webContents.getURL(),'aincrad://app/index.html?test=1');
  assert.equal(await evaluate(win,"import('./src/build-info.js').then(m=>m.BUILD_SOURCE_FINGERPRINT)"),context.sourceFingerprint);
  assert.equal(await evaluate(win,"typeof window.require"),'undefined');
  if(phase==='seed'){
    assert.equal(await getRaw(win),null,'Generated test profile begins empty');
    await evaluate(win,"localStorage.setItem('reset.qa.preference','preference retained');localStorage.setItem('aincrad.world.v1','legacy current bytes');localStorage.setItem('aincrad.save.v1','legacy original bytes');localStorage.setItem('reset.qa.backup','unrelated backup bytes');window.__ozarkWorld.start();window.__ozarkWorld.step(3);window.__ozarkWorld.pause();");
    await evaluate(win,"document.getElementById('npc-rescue-presentation').value='quiet';document.getElementById('npc-rescue-presentation').dispatchEvent(new Event('change'));document.getElementById('world-hour').value='14';document.getElementById('world-hour').dispatchEvent(new Event('change'));document.getElementById('world-weather-control').value='rainy';document.getElementById('world-weather-control').dispatchEvent(new Event('change'));document.getElementById('npc-learning').checked=false;document.getElementById('npc-learning').dispatchEvent(new Event('change'));");
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),true);
    await fs.writeFile(path.join(context.output,'seed.json'),JSON.stringify({raw:await getRaw(win)},null,2));
  }else if(phase==='reset'){
    const seed=JSON.parse(await fs.readFile(path.join(context.output,'seed.json'),'utf8'));
    assert.equal(await getRaw(win),seed.raw,'Independent process reopens original generated save');
    await evaluate(win,'window.__ozarkWorld.start();window.__ozarkWorld.pause()');
    await cancelChecks(win,false);await confirmedReset(win,false);
    assert.equal((await evaluate(win,'window.__ozarkWorld.fullSnapshot()')).agents[0].rescuePresentation,'quiet','Genuine presentation preference retained');
  }else if(phase==='reopen'){
    const previous=JSON.parse(await fs.readFile(path.join(context.output,'reset-checkpoint.json'),'utf8'));
    assert.equal(await getRaw(win),previous.raw,'Independent reopen reads exact reset replacement bytes after native unload');
    assert.deepEqual(await fresh(win),previous.state,'Fresh saved world survives independent native restart');
    // Explicit generated invalid fixture only; never a real profile or user save.
    await evaluate(win,"localStorage.setItem('aincrad.world.v2','{generated-invalid-current-save')");
  }else if(phase==='protected-reset'){
    assert.equal(await getRaw(win),'{generated-invalid-current-save');
    assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().blocked'),true,'Invalid fixture is protected, not automatically reset');
    await cancelChecks(win,true);await nativeBackupChecks(win);
  }else{
    const previous=JSON.parse(await fs.readFile(path.join(context.output,'protected-reset-checkpoint.json'),'utf8'));
    assert.equal(await getRaw(win),previous.raw,'Independent protected-reset reopen reads exact reset replacement bytes');
    assert.deepEqual(await fresh(win),previous.state);
    assert.equal(await getRaw(win),previous.resetRaw,'Independent reopen preserves original protected-reset replacement bytes before any normal start/save');
    const ui=await presentFreshPausedUi(win,'protected-reopen-fresh-started-paused.png');
    await fs.writeFile(path.join(context.output,'fresh-started-paused-ui.json'),JSON.stringify({ui,initialResetRaw:previous.resetRaw,normalSessionRaw:await getRaw(win),checkpointKind:'presentation-after-exact-reset-byte-reopen-verification'},null,2));
  }
}
app.on('browser-window-created',(_event,win)=>{
  activeWindow=win;
  win.webContents.on('will-navigate',(event,url)=>queueMicrotask(()=>events.push({kind:'will-navigate',url:typeof url==='string'?url:url?.url,prevented:event.defaultPrevented})));
  win.webContents.on('did-start-navigation',(_event,url,isInPlace,isMainFrame)=>events.push({kind:'did-start-navigation',url,isInPlace,isMainFrame}));
  win.webContents.on('did-finish-load',()=>events.push({kind:'did-finish-load',url:win.webContents.getURL()}));
  win.webContents.on('did-fail-load',(_event,errorCode,errorDescription,url)=>events.push({kind:'did-fail-load',errorCode,errorDescription,url}));
  win.webContents.on('console-message',(_event,...details)=>events.push({kind:'console-message',details}));
  win.webContents.on('render-process-gone',(_event,details)=>events.push({rendererGone:details}));
  win.webContents.once('did-finish-load',async()=>{
    if(running)return;running=true;
    try{
      const prefs=win.webContents.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.sandbox,true);assert.equal(prefs.webSecurity,true);
      assert.equal(process.argv.includes('--no-sandbox'),false);assert.equal(process.argv.includes('--disable-setuid-sandbox'),false);
      await fs.writeFile(path.join(context.output,phase+'-host.json'),JSON.stringify({platform:process.platform,arch:process.arch,pid:process.pid,electron:process.versions.electron,sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,sandbox:true},null,2));
      await waitFor(win,'Boolean(window.__ozarkWorld)');await run(win);
      await session.defaultSession.flushStorageData();
      const closing=new Promise(resolve=>win.once('closed',()=>{events.push('closed');closeObserved=true;resolve();}));
      win.once('close',()=>events.push('close'));win.close();await closing;assert.equal(win.isDestroyed(),true);
      await fs.writeFile(path.join(context.output,phase+'-result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:true,events,screenshots},null,2));
      console.log('RESET_NATIVE_CLOSED '+phase);clearTimeout(deadline);allowQuit=true;app.quit();
    }catch(error){await failNative(error);}
  });
});
// Real application owns protocol registration, profile routing, preload and reset UI.
require(path.join(context.application,'desktop/main.cjs'));
`);
  const harnessSha256=createHash('sha256').update(await readFile(harness)).digest('hex');
  const prepared={...context,harness,harnessSha256,nativeExecutionPerformed:false,sandboxBypassFlags:[],phases,
    excludedCoverage:['Native screenshots still require visual inspection.','Failure coverage uses real forbidden-profile destination; quota/disk-write faults remain fixture-level tests.']};
  await writeFile(join(output,'prepared.json'),JSON.stringify(prepared,null,2));
  if(prepareOnly)console.log(JSON.stringify(prepared));
  else{
    const electron=createRequire(import.meta.url)('electron');
    for(const phase of phases){
      const flags=[harness,'--test','--test-profile='+profile,'--phase='+phase];
      if(process.platform==='linux')flags.push('--disable-gpu');
      const env={...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary,HOME:join(temporary,'home'),XDG_CONFIG_HOME:join(temporary,'config'),XDG_CACHE_HOME:join(temporary,'cache')};delete env.ELECTRON_RUN_AS_NODE;
      closed=false;
      const result=await captureNativeChild(spawn,electron,flags,{cwd:root,stdio:['ignore','pipe','pipe'],env},bytes=>process.stdout.write(bytes),bytes=>process.stderr.write(bytes));
      closed=true;if(!result.spawnError)nativeProcessesStarted++;
      await writeFile(join(output,phase+'-process.json'),JSON.stringify({code:result.code,signal:result.signal,spawnError:result.spawnError?String(result.spawnError):null,processCloseObserved:true},null,2));
      await writeFile(join(output,phase+'-stdout.txt'),result.stdout);await writeFile(join(output,phase+'-stderr.txt'),result.stderr);
      if(result.spawnError)throw result.spawnError;
      assert.deepEqual({code:result.code,signal:result.signal},{code:0,signal:null});
      assert.ok(result.stdout.includes('RESET_NATIVE_CLOSED '+phase));assert.ok(result.stdout.includes('RESET_NATIVE_WILL_QUIT '+phase));
    }
    const processIds=await Promise.all(phases.map(async phase=>JSON.parse(await readFile(join(output,phase+'-host.json'),'utf8')).pid));
    assert.equal(new Set(processIds).size,phases.length,'Each close/reopen phase uses an independent Electron process');
    const result={passed:true,nativeExecutionPerformed:true,sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,harnessSha256,processIds,phases,
      isolatedGeneratedFixturesOnly:true,confirmedResetAndCancel:true,protectedSaveReset:true,initialResetBytesRecorded:true,exactResetReplacementBytesSurviveNativeCloseAndReopen:true,freshPausedHudAndDayOneCaptured:true,otherKeysPreserved:true,
      nativeBackupDialogAcceptance:JSON.parse(await readFile(join(output,'native-backup-result.json'),'utf8')),visualInspection:'required',excludedCoverage:prepared.excludedCoverage};
    await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }
}finally{
  if(closed){
    try{const archive=await archiveNativeProfile(profile,join(output,'profile-evidence'));await writeFile(join(output,'profile-evidence.json'),JSON.stringify({archive,nativeExecutionPerformed:nativeProcessesStarted>0,copiedAfterProcessesClosed:nativeProcessesStarted>0},null,2));await rm(temporary,{recursive:true,force:true});}
    catch(error){console.error('Disposable profile retained at '+temporary,error);process.exitCode=1;}
  }
}
