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
import {captureWithReadiness,waitForCaptureFrames,conversationViewportEvidence} from './native-capture-readiness.mjs';
import {canonicalApplicationRoot,nativeSourceIdentity,captureNativeChild,archiveNativeProfile,currentRouteSnapshot,assertCurrentRoute} from './carcass-native-contract.mjs';
import {assertStructuralRestoredHistory} from './structural-movement-native-contract.mjs';
import {visualReferenceEvidence,installVisualReferenceFixture,probeVisualReferenceReopen,probeFreeHandReopen} from './visual-reference-native-fixture.mjs';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL,guardFreshCharacterMotorPilot,projectCharacterPilot} from './character-ordinary-motor-v3-protocol.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),prepareOnly=process.argv.includes('--prepare-only'),
  responseScenario=process.argv.includes('--response-scenario'),ambiguityScenario=process.argv.includes('--ambiguity-scenario'),
  motorScenario=process.argv.includes('--motor-scenario');
assert(process.argv.slice(2).every(arg=>['--prepare-only','--response-scenario','--ambiguity-scenario','--motor-scenario'].includes(arg))&&
  process.argv.filter(arg=>arg==='--prepare-only').length<=1&&
  process.argv.filter(arg=>arg==='--response-scenario').length<=1&&
  process.argv.filter(arg=>arg==='--ambiguity-scenario').length<=1&&
  process.argv.filter(arg=>arg==='--motor-scenario').length<=1&&
  Number(responseScenario)+Number(ambiguityScenario)+Number(motorScenario)<=1,
  'Only one bounded native scenario may be selected');
if(!prepareOnly){
  assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_WORKFLOW==='Character message native acceptance','Native execution requires the approved engineering CI workflow');
  assert(['linux','darwin'].includes(process.platform),'Linux/macOS only');
  assert(process.getuid?.()!==0,'Native QA requires an unprivileged sandboxed runtime');
  assert(process.platform!=='linux'||process.env.DISPLAY||process.env.WAYLAND_DISPLAY,'Authorized supported display required');
}
const outputRoot=resolve(process.env.AINCRAD_VISUAL_REFERENCE_QA_OUTPUT||
  join(root,'test-results/visual-reference-native',responseScenario?'response':ambiguityScenario?'ambiguity':motorScenario?'motor':''));
await mkdir(outputRoot,{recursive:true});
const output=await mkdtemp(join(outputRoot,'run-')),temporary=await mkdtemp(join(tmpdir(),'aincrad-visual-reference-'));
const profile=join(temporary,'profile');
for(const name of ['profile','home','config','cache'])await mkdir(join(temporary,name));
const application=await canonicalApplicationRoot(output),built=await buildApplication(application);
const context={output,profile,application,responseScenario,ambiguityScenario,motorScenario,
  motorProtocol:CHARACTER_ORDINARY_PILOT_PROTOCOL,
  motorProtocolPath:join(root,'scripts/character-ordinary-motor-v3-protocol.mjs'),
  sourceIdentity:nativeSourceIdentity(root),sourceFingerprint:built.sourceFingerprint};
if(!prepareOnly){assert.equal(context.sourceIdentity.commit,process.env.GITHUB_SHA,'Native CI must exercise the exact approved checkout SHA');assert.equal(context.sourceIdentity.worktreeStatus,'','Native CI requires a clean reviewed source tree');}
const harness=join(output,'runner.cjs'),phases=motorScenario?['motor-exercise','motor-reopen']:ambiguityScenario?['ambiguity-exercise']:responseScenario?
  ['response-exercise','response-reopen','response-verify']:['exercise','reopen','verify'];
context.phases=phases;

function installRunner(context,helpers){
  const {app,session}=require('electron'),assert=require('node:assert/strict');
  const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url'),
    {createHash}=require('node:crypto');
  const {captureWithReadiness,waitForCaptureFrames,conversationViewportEvidence,currentRouteSnapshot,assertCurrentRoute,assertStructuralRestoredHistory,
    visualReferenceEvidence,installVisualReferenceFixture,probeVisualReferenceReopen,probeFreeHandReopen,
    guardFreshCharacterMotorPilot,projectCharacterPilot}=helpers;
  const phase=process.argv.find(arg=>arg.startsWith('--phase='))?.slice(8);
  assert(context.phases.includes(phase));
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let running=false,closed=false,allowQuit=false,stage='initializing';
  const events=[],screenshots=[],measurementChecks=[];
  const deadline=setTimeout(()=>{console.error('Visual reference native deadline at '+stage);app.exit(1);},context.motorScenario?600000:240000);
  app.on('will-quit',event=>{if(!allowQuit)event.preventDefault();else{assert(closed);console.log('VISUAL_REFERENCE_NATIVE_WILL_QUIT '+phase);}});
  const evaluate=(win,source)=>{stage=source.slice(0,140);return win.webContents.executeJavaScript(source);};
  const snapshot=win=>evaluate(win,'('+visualReferenceEvidence.toString()+')(window.__ozarkWorld.fullSnapshot())');
  const raw=win=>evaluate(win,"localStorage.getItem('aincrad.world.v2')");
  // This engineering fixture reads the same bounded main-world observer used
  // by the prospective ordinary pilot. Full world and private model values
  // are compared inside the renderer and never returned in this QA record.
  function readPureMeasurement(){
    const q=window.__ozarkWorld,fixture=window.__visualReferenceFixture;
    const beforeWorld=JSON.stringify(q.fullSnapshot()),
      beforeReference=JSON.stringify(q.communicationSnapshot()),
      beforeCharacter=JSON.stringify(fixture?.characterExport?.()??null),
      beforeSaved=localStorage.getItem('aincrad.world.v2');
    const first=q.communicationMeasurementSnapshot(),second=q.communicationMeasurementSnapshot();
    return {first,second,worldUnchanged:JSON.stringify(q.fullSnapshot())===beforeWorld,
      referenceUnchanged:JSON.stringify(q.communicationSnapshot())===beforeReference,
      characterUnchanged:JSON.stringify(fixture?.characterExport?.()??null)===beforeCharacter,
      savedBytesUnchanged:localStorage.getItem('aincrad.world.v2')===beforeSaved};
  }
  function assertPublicMeasurementPrivacy(result,label){
    const forbidden=new Set(['senderPixels','receiverPixels','demonstrationPixels','candidatePixels',
      'features','model','weights','bias','examples','messageHandle','orderedOwnFeatures',
      'targetId','demonstratedObjectId']);
    const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
      Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
    const score=value=>exactKeys(value,['brier','logLoss'])&&
      ['brier','logLoss'].every(key=>Number.isFinite(value[key])&&
        value[key]>=0&&value[key]<=1e12);
    const actorPredictor=path=>path[0]==='actors'&&
      (path[1]===0||path[1]===1)&&path[2]==='gesturePrediction';
    // The raw predictor snapshot stores one overall score matrix and one per
    // target class. This exact path is the sole exception for the model key.
    const publicMatrix=path=>actorPredictor(path)&&
      (path.length===4&&path[3]==='scores'||
        path.length===5&&path[3]==='scoresByTarget'&&
        ['pose','absent'].includes(path[4]));
    const inspect=(value,path=[])=>{
      if(Array.isArray(value)){
        for(let index=0;index<value.length;index++)inspect(value[index],[...path,index]);
        return;
      }
      if(!value||typeof value!=='object')return;
      if(actorPredictor(path)&&path.length===4&&path[3]==='scoresByTarget')
        assert(exactKeys(value,['pose','absent']),label+' must retain only public target strata');
      if(publicMatrix(path))
        assert(exactKeys(value,['model','prior','persistence'])&&
          ['model','prior','persistence'].every(key=>score(value[key])),
        label+' must expose only bounded public predictor score totals');
      for(const [key,row] of Object.entries(value)){
        assert.equal(forbidden.has(key)&&!(key==='model'&&publicMatrix(path)),false,
          label+' must not expose private '+key);
        inspect(row,[...path,key]);
      }
    };
    inspect(result);
  }
  async function measurementPoint(win,label){
    const evidence=await evaluate(win,'('+readPureMeasurement.toString()+')()');
    for(const key of ['worldUnchanged','referenceUnchanged','characterUnchanged','savedBytesUnchanged'])
      assert.equal(evidence[key],true,label+' repeated passive measurement cannot alter '+key);
    assert.deepEqual(evidence.first,evidence.second,label+' repeated passive measurement must be exact');
    const result=evidence.first;
    assert.equal(result?.phase,'private-character-message',label+' uses the actual character observer');
    assert.equal(result.seed,context.responseScenario?212:211,label+' keeps the declared engineering seed');
    assert.equal(result.identityPendingReconciliation,false);
    assert.equal(result.actors?.length,2);
    assert.equal(result.survival?.length,2);
    assertPublicMeasurementPrivacy(result,label);
    measurementChecks.push({phase,label,counts:{...result.counts},eventsRetained:result.eventsRetained,
      eventsEvicted:result.eventsEvicted,eventsRetired:result.eventsRetired});
    await fs.writeFile(path.join(context.output,phase+'-measurement-'+label+'.json'),JSON.stringify(result,null,2));
    return result;
  }
  // The v3 projection is read inside the real sandboxed renderer and checked
  // by the exact source validator in this Node harness. Neither read advances
  // the clock, produces a character sample or writes an occupied save.
  async function v3ProjectionPoint(win,label){
    async function readTwice(project){
      const q=window.__ozarkWorld,fixture=window.__visualReferenceFixture,
        world=JSON.stringify(q.fullSnapshot()),
        reference=JSON.stringify(q.communicationSnapshot()),
        character=JSON.stringify(fixture?.characterExport?.()??null),
        observer=JSON.stringify(q.communicationMeasurementSnapshot()),
        saved=localStorage.getItem('aincrad.world.v2');
      const first=await project(),second=await project();
      return {first,second,unchanged:{world:JSON.stringify(q.fullSnapshot())===world,
        reference:JSON.stringify(q.communicationSnapshot())===reference,
        character:JSON.stringify(fixture?.characterExport?.()??null)===character,
        observer:JSON.stringify(q.communicationMeasurementSnapshot())===observer,
        storage:localStorage.getItem('aincrad.world.v2')===saved}};
    }
    const read=await evaluate(win,'('+readTwice.toString()+')('+projectCharacterPilot.toString()+')');
    for(const [key,unchanged]of Object.entries(read.unchanged))
      assert.equal(unchanged,true,label+' v3 projection changed '+key);
    const withoutWall=sample=>{const copy=structuredClone(sample);delete copy.wallMs;return copy;};
    assert.deepEqual(withoutWall(read.first),withoutWall(read.second),
      label+' repeated v3 projection differs beyond its wall clock');
    const {validateCharacterPilotProjection}=await import(pathToFileURL(context.motorProtocolPath).href);
    validateCharacterPilotProjection(read.first);
    validateCharacterPilotProjection(read.second);
    assert.equal(read.first.motor?.version,1,label+' must project the bounded motor observer');
    assert.deepEqual(read.first.motor.actors.map(row=>row.id),['aster','mira']);
    const forbidden=new Set(['weights','bias','features','targetId','selectedId',
      'referenceCorrect','demonstratedObjectId','messageHandle','pixels','records','examples']);
    const inspect=value=>{
      if(Array.isArray(value)){for(const row of value)inspect(row);return;}
      if(value&&typeof value==='object')for(const [key,row]of Object.entries(value)){
        assert.equal(forbidden.has(key),false,label+' v3 motor projection exposed '+key);
        inspect(row);
      }
    };
    inspect(read.first.motor);
    await fs.writeFile(path.join(context.output,phase+'-motor-v3-'+label+'.json'),
      JSON.stringify(read.first,null,2));
    return read.first;
  }
  async function freshMotorV3(win){
    const guard=await evaluate(win,'('+guardFreshCharacterMotorPilot.toString()+')('+JSON.stringify(context.motorProtocol)+')');
    assert.equal(guard?.ready,true,'Fresh motor-v3 guard must accept the actual blank renderer profile');
    assert.deepEqual(guard.individuals,[{id:'aster',serial:1,trained:false},
      {id:'mira',serial:2,trained:false}]);
    const projection=await v3ProjectionPoint(win,'fresh');
    assert.equal(projection.elapsed,0);
    assert(projection.motor.actors.every(row=>row.freeHandObserver?.selectedAttempts===0&&
      row.freeHandObserver?.visibleSamples===0&&
      row.freeHandObserver?.nextEligibleAt>=120&&
      row.gestureMemory?.retained===0&&
      row.gesturePrediction?.pending===false&&
      row.gesturePrediction?.updates===0),
    'Fresh v3 projection must contain no motor, local memory or predictor training');
    await fs.writeFile(path.join(context.output,phase+'-motor-v3-fresh-guard.json'),
      JSON.stringify(guard,null,2));
  }
  const durableLearners=reference=>reference.learners.map(({agentId,identity,anchors,partners,counts,character})=>
    ({agentId,identity,anchors,partners,counts,character}));
  function assertRetainedLearning(reference,saved,label){
    assert.equal(reference.pending,0,label+' must not resume a transaction');
    for(const key of ['exchanges','completed','observed','correct','censored','updates','correctionAttempts','evidenceAdditions','supportUpdates','conflicts',
      'feedbackMatched','feedbackMismatched','feedbackCensored'])
      assert.equal(reference[key],0,label+' must not replay '+key);
    assert.deepEqual(reference.observationEvents,[],label+' has no resurrected event history');
    assert.deepEqual(reference.senderFeedback??[],[],label+' has no resurrected sender feedback');
    assert.deepEqual(durableLearners(reference),durableLearners(saved.report.reference),label+' retains private learned sequence state and legacy association history');
    const learned=saved.report.reference.learners.find(row=>row.character?.uniqueDemonstrations>=1);
    assert(learned,'Saved listener own-view numeric example is required');
    assert.equal(reference.learners.find(row=>row.agentId===learned.agentId)?.character.uniqueDemonstrations,
      learned.character.uniqueDemonstrations,label+' retains unique completed listener demonstrations');
    const second=saved.report.checks?.secondLabel;
    if(second){
      const listener=reference.learners.find(row=>row.agentId===learned.agentId)?.character;
      assert.equal(listener?.uniqueDemonstrations,second.demonstrations,
        label+' retains the exact second own-view physical demonstration count');
      assert.equal(listener?.listenerUpdates,second.optimizerSteps,
        label+' retains the exact second own-view optimizer count');
      assert.equal(listener?.replayUses,second.replayUses,
        label+' retains the exact bounded replay count');
    }
  }
  async function assertReopenedCharacter(win,saved,label){
    const beforeWorld=await snapshot(win),beforeReference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),
      beforeRaw=await raw(win),persisted=JSON.parse(beforeRaw).characterMessages;
    assert.deepEqual(persisted,JSON.parse(saved.raw).characterMessages,label+' retains exact bounded private character models and RNG continuations');
    assert.deepEqual(await snapshot(win),beforeWorld,label+' repeated world inspection is read-only');
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeReference,
      label+' repeated model inspection is read-only');
    assert.equal(await raw(win),beforeRaw,label+' inspection cannot write save bytes');
    return {characterStateSha256:createHash('sha256').update(JSON.stringify(persisted)).digest('hex'),readOnly:true};
  }
  async function waitFor(win,expression){for(let i=0;i<1200;i++){if(await evaluate(win,expression))return;await delay(50);}throw new Error('Condition missing: '+expression);}
  async function capture(win,name,conversation=null){
    const before=await snapshot(win),beforeCharacter=await evaluate(win,
      'window.__visualReferenceFixture?.characterExport?.()??null');
    await waitFor(win,'window.__ozarkWorld.detailReady()');
    const {png,metadata}=await captureWithReadiness({
      prepare:async()=>{
        const ready=await evaluate(win,'('+waitForCaptureFrames.toString()+')()');await delay(100);
        if(conversation)ready.conversationViewport=await evaluate(win,
          '('+conversationViewportEvidence.toString()+')(document,window,'+JSON.stringify(conversation)+')');
        return ready;
      },
      capture:()=>win.webContents.capturePage(),
      retain:async(bytes,attempt)=>{const prefix=path.join(context.output,name+'.attempt-'+attempt.attempt);if(bytes)await fs.writeFile(prefix+'.png',bytes);await fs.writeFile(prefix+'.json',JSON.stringify({phase,...attempt},null,2));},
    });
    assert(png.length>10000,'Actual native canvas capture must be nonempty');
    await fs.writeFile(path.join(context.output,name),png);screenshots.push({name,...metadata});
    assert.deepEqual(await snapshot(win),before,'Native screenshot readiness/rendering is read-only');
    assert.deepEqual(await evaluate(win,'window.__visualReferenceFixture?.characterExport?.()??null'),beforeCharacter,
      'Native screenshot readiness/rendering cannot sample letters, draw RNG or train either model');
  }
  // Serialized observer-only DOM controls; never starts the clock or a policy.
  function presentAssociationLearning(receiverId){
    const panel=document.getElementById('npc-panel');
    if(panel.classList.contains('hidden'))document.getElementById('open-npc').click();
    const select=document.getElementById('npc-select');select.value=receiverId;
    select.dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('npc-tab-conversation').click();
    const messages=document.getElementById('journal-messages');messages.scrollTop=0;
    // Current observer sections can precede reference metrics. Use ordinary
    // scrolling rather than assuming their absolute position in the panel.
    const counters=[...messages.querySelectorAll('p')].find(node=>node.textContent.includes('canonical observed demonstrations'));
    if(!counters)throw Error('Missing actual reference counter row');
    counters.scrollIntoView({block:'start'});
    return {text:messages.textContent,messages:[...messages.querySelectorAll('[data-character-message="true"]')].map(node=>node.textContent),
      selected:select.value,visible:!panel.classList.contains('hidden'),
      tab:panel.dataset.journalTab,character:document.getElementById('npc-name').textContent};
  }
  async function captureAssociationLearning(win){
    const beforeWorld=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
    const beforeReference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()');
    const beforeCharacter=await evaluate(win,'window.__visualReferenceFixture.characterExport()');
    const receiver=beforeReference.learners.find(memory=>memory.character?.uniqueDemonstrations===1);
    assert(receiver,'Actual acquiring numeric listener must exist before UI inspection');
    const learning=await evaluate(win,'('+presentAssociationLearning.toString()+')('+JSON.stringify(receiver.agentId)+')');
    assert.equal(learning.selected,receiver.agentId);assert.equal(learning.visible,true);assert.equal(learning.tab,'conversation');
    const original=beforeReference.observationEvents[0];
    assert.match(original.message,/^[a-z]{1,6}$/);
    assert(learning.messages.includes(original.message),'Conversation must render the exact sampled string as an isolated message node');
    const visibleMessage=await evaluate(win,`(()=>{
      const panel=document.getElementById('journal-messages');
      const entry=panel.querySelector('article[data-learning-event="${original.id}"]');
      const message=entry?.querySelector('[data-character-message="true"]');
      const action=[...(entry?.querySelectorAll('p')||[])].find(node=>node.textContent.includes('recipient completed paid inspect_object'));
      if(!entry||!message||message.textContent!==${JSON.stringify(original.message)}||!action)return false;
      const frame=panel.getBoundingClientRect();
      const a=message.getBoundingClientRect(),b=action.getBoundingClientRect();
      panel.scrollTop+=(a.top+b.bottom)/2-(frame.top+frame.bottom)/2;
      const within=node=>{const r=node.getBoundingClientRect();return r.top>=frame.top&&r.bottom<=frame.bottom;};
      return within(message)&&within(action);
    })()`);
    assert.equal(visibleMessage,true,'Exact sampled message and completed paid recipient action must be visible together');
    await capture(win,'04b0-exact-message-and-paid-recipient-action.png',
      {eventId:original.id,message:original.message,actionText:'recipient completed paid inspect_object'});
    for(const text of ['Observer annotations, not agent speech.','no supplied English translation',
      '1 canonical observed demonstrations','Private character learning',
      '1 unique valid labeled demonstrations','0 prior-example replay uses','1 listener optimizer steps',
      'Retained legacy symbol associations (archival)','recipient completed paid inspect_object',
      'listener optimizer step: completed','trained from at least one valid demonstration',
      'Listener’s own post-choice demonstration'])assert(learning.text.includes(text),text);
    assert.match(learning.text,/private character models.*save locally/i,'Learning must describe retained private models');
    assert(!learning.text.includes('measured reward'),'Observer reference counts cannot imply bodily reward');
    if(context.responseScenario){
      assert(learning.text.includes('Independent reference critic: different'),'Wrong original choice must remain visible as observer-only critic evidence');
      assert(learning.text.includes('Response status: mismatched'),'Learning view must display the actual sender-local mismatch');
      assert(learning.text.includes('sender optimizer step: completed'),'Learning view must show only the actual sender update');
    }
    const displayedWorld=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
    assert.deepEqual({...displayedWorld,selectedAgentId:beforeWorld.selectedAgentId},beforeWorld,'Opening Learning may change only observer selection, not the world');
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeReference,'Learning view cannot mutate character learning or metrics');
    assert.deepEqual(await evaluate(win,'window.__visualReferenceFixture.characterExport()'),beforeCharacter,
      'Learning view cannot draw character RNG or train from inspection');
    await capture(win,'04b-learning-character-counters.png',{});
    assert.equal(await evaluate(win,`(()=>{const crop=document.getElementById('journal-messages').querySelector('[aria-label="Listener’s own post-choice demonstration"]');if(!crop)return false;crop.scrollIntoView({block:'center'});return true;})()`),true);
    await capture(win,'04c-learning-own-demonstration-provenance.png',{});
    if(context.responseScenario){
      const visible=await evaluate(win,`(()=>{
        const panel=document.getElementById('journal-messages');
        const lines=[...panel.querySelectorAll('article.journal-entry p')];
        const critic=lines.find(node=>node.textContent.includes('Independent reference critic: different'));
        const response=lines.find(node=>node.textContent.includes('Response status: mismatched'));
        if(!critic||!response)return false;
        const frame=panel.getBoundingClientRect(),a=critic.getBoundingClientRect(),b=response.getBoundingClientRect();
        panel.scrollTop+=(a.top+b.bottom)/2-(frame.top+frame.bottom)/2;
        const within=node=>{const r=node.getBoundingClientRect();return r.top>=frame.top&&r.bottom<=frame.bottom;};
        return within(critic)&&within(response);
      })()`);
      assert.equal(visible,true,'The correction critic and sensory mismatch must both be visible in the native screenshot');
      await capture(win,'04d-wrong-original-choice-after-correction.png',{});
    }
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.fullSnapshot()'),displayedWorld,'Learning screenshots and scrolling cannot advance time or mutate the world');
    await evaluate(win,`(()=>{const select=document.getElementById('npc-select');select.value=${JSON.stringify(beforeWorld.selectedAgentId)};select.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('close-npc').click();return true;})()`);
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.fullSnapshot()'),beforeWorld,'Closing Learning restores observer selection with exact unchanged full world');
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeReference,'Learning open/capture/close leaves reference snapshot exact');
    assert.deepEqual(await evaluate(win,'window.__visualReferenceFixture.characterExport()'),beforeCharacter,
      'Learning open/capture/close leaves private model weights and RNG exact');
    await fs.writeFile(path.join(context.output,'character-learning-view.json'),JSON.stringify({...learning,readOnly:true,
      temporaryObserverSelectionOnly:true,restoredSelectedAgentId:beforeWorld.selectedAgentId,at:beforeWorld.elapsed},null,2));
  }
  async function motorExercise(win){
    const initial=await snapshot(win);
    assert.deepEqual(initial.agents.map(actor=>actor.position),[{x:276,y:760},{x:300,y:920}],
      'The renderer must retain both declared original actor positions');
    let measured=await measurementPoint(win,'motor-fresh');
    assert(Object.values(measured.counts).every(value=>value===0)&&measured.events.length===0,
      'The target-free fixture begins with no character exchange or learning');
    assert(measured.actors.every(actor=>actor.freeHandObserver?.nextEligibleAt>=120&&
      actor.freeHandObserver.selectedAttempts===0&&actor.freeHandObserver.visibleSamples===0&&
      actor.freeHandObserver.lifecycle.admitted===0&&
      actor.freeHandObserver.lifecycle.firstPaid===0&&
      actor.freeHandObserver.lifecycle.completed===0&&
      actor.freeHandObserver.lifecycle.ownPoseSamples===0&&
      actor.freeHandObserver.lifecycle.pending===0),
    'Both fresh individuals must start behind their private 120-second motor delay');
    let status=await evaluate(win,'window.__visualReferenceFixture.status()');
    assert.equal(status.phase,'motor-ready');
    assert.equal(status.checks.motorFresh?.firstAdmission,'FREE_HAND_COOLDOWN');
    await capture(win,'motor-01-fresh-no-motion.png');
    const wait=[];
    for(let i=0;i<12;i++)wait.push(await evaluate(win,'window.__visualReferenceFixture.motorWait(600)'));
    assert(Math.abs(wait.at(-1).elapsed-120)<1e-7&&wait.at(-1).steps===7200,
      'The motor delay must elapse through exactly 7,200 real main-world fixed steps');
    assert(wait.every(row=>row.observers.every(actor=>actor.selectedAttempts===0&&
      actor.visibleSamples===0&&actor.lifecycle.admitted===0&&
      actor.lifecycle.firstPaid===0&&actor.lifecycle.pending===0)),
      'Waiting alone cannot fabricate a motor selection or a peer pose');
    assert.deepEqual((await snapshot(win)).agents.map(actor=>actor.position),
      [{x:276,y:760},{x:300,y:920}],
      'Real wait must retain original actor positions before paid motor admission');
    measured=await measurementPoint(win,'motor-ready');
    assert(Object.values(measured.counts).every(value=>value===0));
    status=await evaluate(win,"window.__visualReferenceFixture.beginMotor('aster')");
    assert.equal(status.action.type,'free_hand');assert.equal(status.action.seconds,1.8);
    assert.equal(status.pose,null,'Unfunded actor motion has no public pose');
    assert.equal(status.observer.lifecycle.admitted,1);
    assert.equal(status.observer.lifecycle.firstPaid,0);
    assert.equal(status.observer.lifecycle.certifiedPaidSeconds,0);
    assert.equal(status.observer.lifecycle.pending,1);
    status=await evaluate(win,"window.__visualReferenceFixture.visibleMotor('aster')");
    assert.equal(status.actualCanvas,true);
    assert.equal(status.peerLocal.visibility,'pose');
    assert.equal(status.peerLocal.ownFreeHandActive,0);
    assert.equal(status.ownLocal.ownFreeHandActive,1);
    assert.equal(status.occluded?.visibility,'unknown');
    assert.equal(status.memoryReadPure,true);assert.equal(status.predictionReadPure,true);
    assert.equal(status.actorObserver.lifecycle.firstPaid,1);
    assert(status.actorObserver.lifecycle.certifiedPaidSeconds>0&&
      status.actorObserver.lifecycle.certifiedPaidSeconds<1.8);
    assert(status.actorObserver.lifecycle.ownPoseSamples>0);
    assert.equal(status.actorObserver.lifecycle.pending,1);
    await fs.writeFile(path.join(context.output,'motor-first-paid-pose.json'),JSON.stringify(status,null,2));
    await capture(win,'motor-02-aster-real-paid-segment.png');
    status=await evaluate(win,'window.__visualReferenceFixture.completeFirstMotor()');
    assert.equal(status.checks.motorFirstComplete?.result?.code,'FREE_HAND_MOVED');
    assert(Math.abs(status.checks.motorFirstComplete.worked-1.8)<1e-7);
    assert(Number.isFinite(status.checks.motorFirstComplete.effortKcal)&&
      status.checks.motorFirstComplete.effortKcal>0&&
      status.checks.motorFirstComplete.metabolizedKcal+1e-8>=status.checks.motorFirstComplete.effortKcal,
      'Full effort cost is computed from and funded by the current body model');
    assert.equal(status.checks.motorFirstComplete.characterUnchanged,true);
    assert.equal(status.checks.motorFirstComplete.observer.selectedAttempts,1);
    assert.equal(status.checks.motorFirstComplete.observer.lifecycle.completed,1);
    assert.equal(status.checks.motorFirstComplete.observer.lifecycle.pending,0);
    assert(Math.abs(status.checks.motorFirstComplete.observer.lifecycle.certifiedPaidSeconds-1.8)<1e-7);
    assert.equal(status.checks.motorFirstVisible.peerPrediction.onsets>=1,true);
    measured=await measurementPoint(win,'motor-first-complete');
    assert(Object.values(measured.counts).every(value=>value===0),
      'Paid neutral motion cannot emit words or train either character learner');
    const firstV3=await v3ProjectionPoint(win,'motor-first-complete');
    assert(firstV3.motor.actors.find(row=>row.id==='aster')?.freeHandObserver?.selectedAttempts===1&&
      firstV3.motor.actors.find(row=>row.id==='mira')?.freeHandObserver?.visibleSamples>0,
      'The v3 observer must count the paid first motion and personally visible peer samples');
    status=await evaluate(win,"window.__visualReferenceFixture.beginMotor('mira')");
    assert.equal(status.action.type,'free_hand');assert.equal(status.pose,null);
    assert.equal(status.observer.lifecycle.admitted,1);
    assert.equal(status.observer.lifecycle.firstPaid,0);
    assert.equal(status.observer.lifecycle.pending,1);
    status=await evaluate(win,"window.__visualReferenceFixture.visibleMotor('mira')");
    assert.equal(status.peerLocal.visibility,'pose');assert.equal(status.ownLocal.ownFreeHandActive,1);
    assert.equal(status.actorObserver.lifecycle.firstPaid,1);
    assert(status.actorObserver.lifecycle.ownPoseSamples>0);
    const secondV3=await v3ProjectionPoint(win,'motor-second-paid');
    assert(secondV3.motor.actors.find(row=>row.id==='mira')?.freeHandObserver?.selectedAttempts===1&&
      secondV3.motor.actors.find(row=>row.id==='aster')?.freeHandObserver?.visibleSamples>0,
      'The v3 observer must retain independent selection and visible-sample counts');
    await capture(win,'motor-03-mira-partial-real-paid-segment.png');
    const checkpoint=await evaluate(win,'window.__visualReferenceFixture.checkpointMotor(localStorage)');
    assert.equal(checkpoint.pendingKind,'free-hand');
    assert(checkpoint.report.checks.motorPending.paidSeconds>0&&
      checkpoint.report.checks.motorPending.paidSeconds<1.8);
    assert.equal(checkpoint.report.checks.motorPending.observer.lifecycle.completed,0);
    assert.equal(checkpoint.report.checks.motorPending.observer.lifecycle.pending,1);
    assert(checkpoint.report.checks.motorPending.observer.lifecycle.certifiedPaidSeconds>0);
    status=await evaluate(win,'window.__visualReferenceFixture.interruptMotor()');
    assert.equal(status.checks.motorInterrupted.poseCleared,true);
    assert.equal(status.checks.motorInterrupted.sameInstantReadPure,true);
    assert.equal(status.checks.motorInterrupted.observer.lifecycle.interrupted.PRIORITY_CHANGED,1);
    assert.equal(status.checks.motorInterrupted.observer.lifecycle.completed,0);
    assert.equal(status.checks.motorInterrupted.observer.lifecycle.pending,0);
    assert(Math.abs(status.checks.motorInterrupted.observer.lifecycle.certifiedPaidSeconds-
      checkpoint.report.checks.motorPending.paidSeconds)<1e-7);
    assert.equal(await raw(win),checkpoint.raw,
      'Cancelling the paid motion after checkpoint cannot rewrite occupied bytes');
    measured=await measurementPoint(win,'motor-interrupted');
    assert(Object.values(measured.counts).every(value=>value===0));
    await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify({...checkpoint,screenshots},null,2));
    await evaluate(win,'window.__visualReferenceFixture.dispose();true');
    await session.defaultSession.flushStorageData();
  }
  async function exercise(win){
    assert.equal(await raw(win),null,'Fresh disposable profile must contain no current save');
    assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().elapsed'),0);
    await freshMotorV3(win);
    const fixtureContext=context.responseScenario?'{...context,responseScenario:true}':
      context.ambiguityScenario?'{...context,ambiguityScenario:true}':
      context.motorScenario?'{...context,motorScenario:true}':'context';
    const install='window.__visualReferenceFixture=await window.__ozarkWorld.referenceFixture(context=>('+installVisualReferenceFixture.toString()+')('+fixtureContext+',document.baseURI,('+visualReferenceEvidence.toString()+')),'+
      JSON.stringify(context.responseScenario?{negativeControlSeed:212}:context.motorScenario?{motorScenario:true}:{})+');return Boolean(window.__visualReferenceFixture)';
    assert.equal(await evaluate(win,'(async()=>{'+install+'})()'),true,'Install fixture on actual fresh main population');
    assert.equal(await evaluate(win,'window.__ozarkWorld.communicationSnapshot().seed'),context.responseScenario?212:211,
      'Native scenario must use its disclosed fresh communication stream');
    assert.equal(await evaluate(win,'window.__ozarkWorld.start()'),false,'Fixture owns the sole manual clock; normal timer start is blocked');
    assert.equal(await evaluate(win,'window.__ozarkWorld.referenceFixture(()=>true)'),null,'Fresh fixture installer is one-use');
    let status=await evaluate(win,'window.__visualReferenceFixture.status()');assert.equal(status.pose,null);
    if(!context.responseScenario)await v3ProjectionPoint(win,'fresh-attached');
    if(context.motorScenario)return motorExercise(win);
    if(context.ambiguityScenario){
      const placed=await snapshot(win);
      assert.deepEqual(placed.agents.map(actor=>actor.position),[{x:-12943,y:3595},{x:-12827,y:3543}],
        'The renderer must receive and apply authored ambiguity placement before any paid action');
      assert.equal(status.checks.authoredAmbiguity?.forwardCandidateCount,2);
      assert.deepEqual(status.checks.authoredAmbiguity?.forwardCandidateIds,['object:501','object:505']);
      assert.equal(status.checks.authoredAmbiguity?.objectSwap?.tree?.kind,'apple_tree');
      assert.equal(status.checks.authoredAmbiguity?.reverseResult,'ambiguous');
      const beforeReference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),
        beforeCharacter=await evaluate(win,'window.__visualReferenceFixture.characterExport()'),beforeRaw=await raw(win);
      let admission;
      try{admission=await evaluate(win,'window.__visualReferenceFixture.admissionAudit()');}
      catch(error){admission={error:String(error?.stack||error)};}
      await fs.writeFile(path.join(context.output,'pre-action-admission-audit.json'),JSON.stringify(admission,null,2));
      assert.equal(admission.error,undefined,'Retained pre-action Canvas admission audit must complete');
      assert.equal(admission.actualCanvas,true,'Native admission audit must use real offscreen Canvas crops');
      assert.equal(admission.sight.listenerComplete,true);assert.equal(admission.sight.senderComplete,true);
      assert.equal(admission.genericGates.peerFound,true);
      assert.equal(admission.validForwardCandidates,2,'Actual Canvas crops and forward gestures must admit both declared objects');
      assert.equal(admission.pairCount,1);
      assert.deepEqual(admission.pairs[0]?.ids,['object:501','object:505']);
      assert.equal(admission.rows.find(row=>row.id==='object:501')?.kind,'grass');
      assert.equal(admission.rows.find(row=>row.id==='object:505')?.kind,'apple_tree');
      assert(admission.pairs[0].ownRms>=admission.featureDistance&&
        admission.pairs[0].senderRms>=admission.featureDistance,
      'Both actors must have a genuinely distinct real-Canvas pair at the unchanged threshold');
      assert.equal(admission.qualifiedPairs,1,'The actual Canvas pair must pass ordinary numeric admission');
      for(const [key,value] of Object.entries(admission.pure))assert.equal(value,true,'Admission audit cannot change '+key);
      assert.deepEqual(await snapshot(win),placed,'Admission audit cannot change the actual main world');
      assert.deepEqual(await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeReference,
        'Admission audit cannot sample or train either learner');
      assert.deepEqual(await evaluate(win,'window.__visualReferenceFixture.characterExport()'),beforeCharacter,
        'Admission audit cannot draw character RNG or update weights');
      assert.equal(await raw(win),beforeRaw,'Admission audit cannot write storage');
    }
    let measured=await measurementPoint(win,'fresh');
    assert(Object.values(measured.counts).every(value=>value===0),'Fresh engineering world has zero communication counts');
    assert.equal(measured.events.length,0);assert.equal(measured.pending,0);
    assert(measured.actors.every(actor=>actor.character.senderUpdates===0&&
      actor.character.listenerUpdates===0&&actor.character.uniqueDemonstrations===0&&
      actor.character.replayUses===0&&actor.character.partnerBanks.every(bank=>
        bank.trained===false&&bank.retainedExamples===0)),'Fresh individuals have untrained private banks');
    await capture(win,'01-before-listener-choice-no-cue.png');
    status=await evaluate(win,'window.__visualReferenceFixture.beginChoice()');assert.equal(status.pose,null);
    measured=await measurementPoint(win,'emitted-choice');
    assert.equal(measured.counts.emissions,1);assert.equal(measured.counts.paidInspectionStarts,1);
    assert.equal(measured.counts.paidInspectionCompletions,0);
    assert.equal(measured.counts.canonicalDemonstrations,0);
    assert.equal(measured.events[0]?.message,status.reference.latest.message,
      'Observer message is the exact sampled physical transaction');
    status=await evaluate(win,'window.__visualReferenceFixture.completeChoice()');assert.equal(status.checks.choiceCompletedBeforeIndication,true);
    assert.equal(status.checks.actorGestureMemory?.paidChoiceVisibleAbsence,true);
    assert(status.checks.actorGesturePrediction?.choice?.listener.targetAbsent>=1);
    assert(status.checks.actorGesturePrediction.choice.sender.targetAbsent>=1);
    assert.equal(status.checks.actorGesturePrediction.defensiveReadPure,true);
    measured=await measurementPoint(win,'paid-inspection');
    assert.equal(measured.counts.paidInspectionCompletions,1);
    assert.equal(measured.counts.paidInspectionOutcomeUnavailable,0);
    assert.equal(measured.counts.canonicalDemonstrations,0);
    assert.equal(status.pose,null);await capture(win,'02-paid-choice-complete-no-cue.png');
    status=await evaluate(win,'window.__visualReferenceFixture.beginIndication()');assert.equal(status.pose,null);
    status=await evaluate(win,'window.__visualReferenceFixture.visible()');assert(status.pose);assert.equal(status.checks.visibleCrop.actualCanvas,true,'Native audit uses actual current Canvas crops');
    assert.equal(status.checks.actorGestureMemory?.forward?.paidPoseObserved,true);
    assert.equal(status.checks.actorGestureMemory.forward.defensiveReadPure,true);
    assert.equal(status.checks.actorGestureMemory.controlledUnknown,true);
    await fs.writeFile(path.join(context.output,'visible-parser-audit.json'),JSON.stringify(status,null,2));
    await capture(win,'03-during-paid-public-direction-cue.png');
    status=await evaluate(win,'window.__visualReferenceFixture.completeIndication()');
    assert.equal(status.pose,null);assert.equal(status.reference.observed,1);
    assert.equal(status.checks.actorGestureMemory?.forwardEndedAsVisibleAbsence,true);
    assert.equal(status.checks.actorGesturePrediction?.forward?.actualPaidPose,true);
    assert.equal(status.checks.actorGesturePrediction.forward.defensiveReadPure,true);
    assert(status.checks.actorGesturePrediction.forward.listener.targetPose>=1);
    assert(status.checks.actorGesturePrediction.forward.listener.onsets>=1);
    assert.equal(status.reference.latest.listenerUpdate,true);
    assert.equal(status.checks.listenerLearning.uniqueDemonstrations,1);
    assert.equal(status.checks.listenerLearning.optimizerSteps,1);
    assert.equal(status.checks.listenerLearning.actualCanvas,true);
    assert.deepEqual(status.reference.senderFeedback,[]);
    measured=await measurementPoint(win,'own-view-demonstration');
    if(!context.responseScenario){
      const paidV3=await v3ProjectionPoint(win,'own-view-demonstration');
      assert(paidV3.motor.actors.some(row=>row.gesturePrediction?.validTargets>0),
        'The v3 observer must include actual settled local future-pose targets after paid sight');
    }
    assert.equal(measured.counts.canonicalDemonstrations,1);
    assert.equal(measured.counts.validListenerDemonstrations,1);
    assert.equal(measured.counts.listenerOptimizerSteps,1);
    assert.equal(measured.counts.listenerReplayUses,0);
    assert.equal(measured.counts.criticCorrect,status.reference.correct);
    assert.equal(measured.counts.senderUpdates,0);
    const replyAvailable=status.checks.replyAvailable;
    assert.equal(replyAvailable,true,'An earned character demonstration must offer a physical paid reply');
    assert.equal(status.reference.latest.feedbackStatus,'awaiting-response');
    await fs.writeFile(path.join(context.output,'completed-reference.json'),JSON.stringify(status,null,2));
    await capture(win,'04-after-sender-completion-no-cue.png');
    status=await evaluate(win,'window.__visualReferenceFixture.beginResponse()');
    assert.equal(status.responsePose,null);assert.deepEqual(status.reference.senderFeedback,[]);
    measured=await measurementPoint(win,'paid-reply-start');
    assert.equal(measured.counts.paidReplyStarts,1);
    assert.equal(measured.counts.paidReplyCompletions,0);
    status=await evaluate(win,'window.__visualReferenceFixture.visibleResponse()');
    assert(status.responsePose);assert.equal(status.checks.responseVisible.actualCanvas,true);
    assert.equal(status.checks.actorGestureMemory?.reply?.paidPoseObserved,true);
    assert.equal(status.checks.actorGestureMemory.reply.defensiveReadPure,true);
    await fs.writeFile(path.join(context.output,'visible-response-parser-audit.json'),JSON.stringify(status,null,2));
    await capture(win,'04a-during-paid-listener-response.png');
    status=await evaluate(win,'window.__visualReferenceFixture.completeResponse()');
    assert.equal(status.responsePose,null);assert.equal(status.reference.pending,0);
    assert.equal(status.checks.actorGestureMemory?.replyEndedAsVisibleAbsence,true);
    assert.equal(status.checks.actorGesturePrediction?.reply?.actualPaidPose,true);
    assert.equal(status.checks.actorGesturePrediction.reply.defensiveReadPure,true);
    assert(status.checks.actorGesturePrediction.reply.sender.targetPose>=1);
    assert(status.checks.actorGesturePrediction.reply.sender.onsets>=1);
    measured=await measurementPoint(win,'paid-reply-complete');
    assert.equal(measured.counts.paidReplyCompletions,1);
    assert.equal(measured.counts.paidReplyOutcomeUnavailable,0);
    assert.equal(measured.counts.senderUpdates,Number(status.reference.latest.senderUpdate===true));
    assert.equal(measured.counts.visualMatches,Number(status.reference.latest.feedbackStatus==='matched'));
    assert.equal(measured.counts.visualMismatches,Number(status.reference.latest.feedbackStatus==='mismatched'));
    if(context.responseScenario){assert.equal(measured.counts.visualMismatches,1);assert.equal(measured.counts.senderUpdates,1);}
    if(context.ambiguityScenario){
      assert.equal(status.reference.latest.feedbackStatus,'censored');
      assert.equal(status.reference.latest.feedbackReason,'response-ambiguous');
      assert.equal(status.checks.responseAmbiguity?.actualSenderObservation,true);
      assert(status.checks.responseAmbiguity.paidVisibleSamples>=30);
      assert(Math.abs(status.checks.responsePayment.canonicalWorkSeconds-1.8)<1e-7);
      assert.equal(status.checks.senderLearning.updated,false);
      assert.equal(status.checks.senderLearning.updates,0);
      assert.equal(status.checks.senderLearning.baseline,0);
      assert.equal(status.checks.senderLearning.changedParameters,false);
      assert.equal(measured.counts.paidReplyStarts,1);
      assert.equal(measured.counts.paidReplyCompletions,1);
      assert.equal(measured.counts.responseCensors,1);
      assert.equal(measured.counts.senderUpdates,0);
      assert.equal(measured.counts.canonicalDemonstrations,1);
      assert.equal(measured.counts.validListenerDemonstrations,1);
      assert.equal(measured.counts.listenerOptimizerSteps,1);
      assert.equal(status.reference.pending,0);
      assert.deepEqual(status.reference.senderFeedback,[]);
      assert.equal(status.responsePose,null);
      await fs.writeFile(path.join(context.output,'paid-ambiguous-reply.json'),JSON.stringify(status,null,2));
      await capture(win,'04a2-after-paid-ambiguous-reply.png');
      await captureAssociationLearning(win);
      const afterView=await measurementPoint(win,'after-ambiguity-view');
      assert.deepEqual(afterView,measured,'Read-only Learning and captures cannot change the ambiguity outcome');
      assert.equal(await raw(win),null,'The single-process ambiguity exercise writes no durable save');
      await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:false,
        sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,
        mainPopulationAndEcology:true,originalActorPositions:false,
        authoredAmbiguousGeometry:status.checks.authoredAmbiguity,
        fixtureDisclosure:'Separate seed-211 disposable main-world engineering vantage: Aster (-12943,3595) and Mira (-12827,3543) are placed before observation or action. Existing ripe bramble object:504 and apple tree object:505 exchange positions before observation; no objects or resources are created, and no crop values, rewards, policy choices or parser rules are overridden. The original inspected object receives a genuinely paid reply; Aster continuously observes its ambiguous public gesture in its own actual sight. This is an authored physical geometry check, not ordinary opportunity, learned meaning or survival evidence.',
        exactEmittedCharacterString:status.reference.latest.message,actualCanvasCrops:true,
        paidInspectionSeconds:status.privateWitness.choice.worked,
        paidIndicationSeconds:status.checks.payment.canonicalWorkSeconds,
        paidListenerResponseSeconds:status.checks.responsePayment.canonicalWorkSeconds,
        replyFeedbackStatus:status.reference.latest.feedbackStatus,
        replyFeedbackReason:status.reference.latest.feedbackReason,
        continuousActualSenderObservation:status.checks.responseAmbiguity,
        actorLocalGestureMemory:status.checks.actorGestureMemory,
        uniquePhysicalDemonstrations:status.reference.learners.find(row=>row.agentId===status.reference.latest.receiverId)?.character.uniqueDemonstrations,
        listenerOptimizerSteps:status.reference.learners.find(row=>row.agentId===status.reference.latest.receiverId)?.character.listenerUpdates,
        senderOptimizerSteps:status.reference.learners.find(row=>row.agentId===status.reference.latest.senderId)?.character.senderUpdates,
        senderWeightsAndBaselineUnchanged:true,noLingeringAuthority:status.reference.pending===0&&status.responsePose===null,
        actualLearningTabCaptured:true,passiveMeasurementNativeQA:true,
        screenshots,scope:'One deliberately authored native main-world ambiguity geometry, one real paid listener reply and no sender update. This tests sensory censorship, not acquired vocabulary, ordinary opportunity, generalization or survival benefit.'},null,2));
      await evaluate(win,'window.__visualReferenceFixture.dispose();true');
      await session.defaultSession.flushStorageData();
      return;
    }
    if(status.reference.latest.feedbackStatus==='censored'){
      assert.equal(context.responseScenario,false,'Authored response profile must produce its required mismatch');
      assert.equal(status.checks.senderLearning.updated,false,'A paid but censored reply gives no sender update');
      if(status.reference.latest.feedbackReason==='response-ambiguous'){
        assert.equal(status.checks.responseAmbiguity?.actualSenderObservation,true);
        assert(status.checks.responseAmbiguity.paidVisibleSamples>=30);
      }
    }else{
      assert(['matched','mismatched'].includes(status.reference.latest.feedbackStatus));
      assert.equal(status.reference.latest.senderUpdate,true);
      assert.equal(status.checks.senderLearning.updates,1);
      assert.equal(status.checks.senderFeedback.actualCanvas,true);assert.equal(status.checks.senderFeedback.senderOnly,true);
    }
    await capture(win,'04a2-after-listener-response-no-cue.png');
    const firstMessage=status.reference.latest.message;
    assert.match(firstMessage,/^[a-z]{1,6}$/);
    assert.equal(status.reference.learners.find(row=>row.agentId===status.reference.latest.receiverId)?.character.uniqueDemonstrations,1,
      'First valid listener own-view sequence example must survive later actions');
    if(context.responseScenario){
      assert.equal(status.reference.latest.referenceCorrect,false,'Original paid choice must be wrong before the corrective demonstration');
      assert.notEqual(status.privateWitness.choice.targetId,status.privateWitness.indication.targetId,
        'The original completed inspection differs from the sender intended referent');
      assert.equal(status.privateWitness.responseTargetId,status.privateWitness.choice.targetId,
        'The paid reply points to the original choice, even after listener corrective learning');
      assert.equal(status.reference.latest.feedbackStatus,'mismatched');
      assert.equal(status.reference.latest.senderUpdate,true);
      assert.equal(status.checks.senderFeedback.signal,'mismatch');
      assert.equal(status.reference.learners.find(row=>row.agentId===status.reference.latest.receiverId)?.character.uniqueDemonstrations,1,
        'Listener must already have learned from its own crop when it replies with the original choice');
      assert(Math.abs(status.checks.senderLearning.baseline+.05)<1e-12);
      await fs.writeFile(path.join(context.output,'wrong-original-choice.json'),JSON.stringify({
        originalChoice:status.privateWitness.choice,target:status.privateWitness.indication,
        responseTargetId:status.privateWitness.responseTargetId,
        message:firstMessage,listenerDemonstrations:status.reference.learners.find(row=>row.agentId===status.reference.latest.receiverId)?.character.uniqueDemonstrations,
        senderFeedback:status.checks.senderFeedback,senderCurrentFeatures:status.checks.senderFeedback.senderCurrentFeatures,
        source:'genuine paid actions and actual Canvas in a fixed engineering negative control'},null,2));
    }
    await fs.writeFile(path.join(context.output,'first-response-outcome.json'),JSON.stringify(status,null,2));
    status=await evaluate(win,'window.__visualReferenceFixture.inspectAssociation()');
    const modelAudit=status.checks.modelAudit;
    assert.equal(modelAudit.readOnly,true);
    assert.equal(modelAudit.message,firstMessage);
    assert.deepEqual(modelAudit.untrained.probabilities,[.5,.5]);
    for(let i=0;i<2;i++)assert(Math.abs(modelAudit.known.probabilities[i]-modelAudit.reversed.probabilities[1-i])<1e-12,
      'The private numeric listener must remain candidate-order equivariant');
    const timestampedPairSha256=createHash('sha256').update(JSON.stringify(modelAudit.candidateViews)).digest('hex');
    await fs.writeFile(path.join(context.output,'character-model-audit.json'),JSON.stringify({...modelAudit,timestampedPairSha256},null,2));
    await captureAssociationLearning(win);
    const beforeRefusedSave=await evaluate(win,'window.__visualReferenceFixture.characterExport()');
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),false,'Ordinary save/UI cannot persist a fixture-owned world');
    assert.equal(await raw(win),null,'Only the one-shot explicit fixture checkpoint may write');
    assert.deepEqual(await evaluate(win,'window.__visualReferenceFixture.characterExport()'),beforeRefusedSave,
      'Refused ordinary save cannot draw character RNG or update either model');
    status=await evaluate(win,'window.__visualReferenceFixture.'+(context.responseScenario?'pendingResponseForSave':'pendingForSave')+'()');
    measured=await measurementPoint(win,'second-pending');
    assert.equal(measured.counts.emissions,2,'Two authentic sampled messages must be counted');
    assert.equal(measured.counts.paidInspectionStarts,2);
    assert.equal(measured.counts.paidInspectionCompletions,2);
    assert.equal(measured.pending,1,'The partly paid second exchange remains pending');
    assert.equal(measured.eventsRetained,2);assert.equal(measured.eventsEvicted,0);
    assert.equal(measured.events[1]?.message,status.reference.latest.message,
      'The second observer message is the exact new sampled transaction');
    if(context.responseScenario){
      const second=status.checks.secondLabel;
      assert(second?.actualCanvas&&/^[a-z]{1,6}$/.test(second.secondMessage),
        'Second own-view label audit must use the actual sampled message and final Canvas crop');
      if(second.classificationAvailable){
        assert.equal(second.updated,second.classifiedLabel===0||second.classifiedLabel===1,
          'An available second candidate pair must agree with its independent numeric label');
        assert.equal(second.candidateFeatures.length,2);
        assert.equal(second.candidatePixels.length,2);
      }else{
        assert.equal(second.updated,false,'A valid second label must retain its original candidate pair');
        assert.equal(second.classifiedLabel,null,'No pair means no independent numeric classification');
        assert.equal(second.candidateSource,'private-pair-unavailable-after-censorship');
      }
      assert.equal(second.demonstrations,second.updated?2:1);
      assert.equal(second.optimizerSteps,second.updated?2:1);
      assert.equal(second.replayUses,second.updated?1:0);
      assert.equal(measured.counts.canonicalDemonstrations,2);
      assert.equal(measured.counts.validListenerDemonstrations,second.updated?2:1);
      assert.equal(measured.counts.listenerOptimizerSteps,second.optimizerSteps);
      assert.equal(measured.counts.listenerReplayUses,second.replayUses);
      assert.equal(measured.counts.paidReplyStarts,2);
      assert.equal(measured.counts.paidReplyCompletions,1,
        'A partly paid second reply is not a physical completion');
      assert.equal(measured.counts.senderUpdates,1,'The pending second reply cannot repeat sender learning');
      await fs.writeFile(path.join(context.output,'second-listener-label-audit.json'),JSON.stringify(second,null,2));
      assert.equal(status.phase,'pending-response-save');assert(status.responsePose);
      assert.equal(status.reference.latest.feedbackStatus,'responding');
      assert.equal(status.reference.pending,1);
      assert.equal(status.reference.senderFeedback.length,0,'A partly paid second response grants no replayable feedback queue');
      assert.equal(status.checks.pendingResponse.originalInspectedId,status.privateWitness.responseTargetId);
      const retained=status.reference.learners.find(row=>row.agentId===status.reference.observationEvents[0].receiverId)?.character;
      assert(retained?.uniqueDemonstrations>=1&&retained?.partnerBanks?.some(bank=>bank.retainedExamples>=1),
        'Second exchange and pending response must preserve the first completed own-view numeric example');
      await capture(win,'05-second-paid-listener-response-before-save.png');
      const beforeWorld=await snapshot(win),beforeReference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),
        beforeModel=await evaluate(win,'window.__visualReferenceFixture.characterExport()');
      assert.deepEqual(await evaluate(win,'window.__visualReferenceFixture.characterExport()'),beforeModel,
        'Repeated private model export cannot draw RNG or train');
      assert.deepEqual(await snapshot(win),beforeWorld,'Post-second inspection cannot change the world');
      assert.deepEqual(await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeReference,
        'Post-second inspection cannot change private memory or feedback');
      await fs.writeFile(path.join(context.output,'character-post-second-export.json'),JSON.stringify({model:beforeModel,readOnly:true},null,2));
    }else{
      assert.equal(measured.counts.canonicalDemonstrations,1,
        'An unfinished second indication is not a listener demonstration');
      assert.equal(measured.counts.listenerOptimizerSteps,1);
      assert.equal(measured.counts.paidReplyStarts,1);
      assert.equal(measured.counts.paidReplyCompletions,1);
      assert(status.pose);await capture(win,'05-second-paid-indication-before-save.png');
    }
    const beforePendingSave=await evaluate(win,'window.__visualReferenceFixture.characterExport()');
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),false);
    assert.deepEqual(await evaluate(win,'window.__visualReferenceFixture.characterExport()'),beforePendingSave,
      'Refused pending save cannot change private model or pending RNG continuation');
    const checkpoint=await evaluate(win,'window.__visualReferenceFixture.checkpoint(localStorage)');
    assert(checkpoint,'Authenticated one-shot checkpoint must persist actual main state');
    assert.equal(checkpoint.report.checks.actorGestureMemory?.saveExcluded,true);
    assert.equal(checkpoint.report.checks.actorGesturePrediction?.saveExcluded,true);
    assert.equal(checkpoint.pendingKind,context.responseScenario?'listener-response':'sender-demonstration');
    assert.equal(await evaluate(win,'window.__visualReferenceFixture.checkpoint(localStorage)'),null,'Fixture checkpoint is one attempt only');
    assert.equal(checkpoint.raw,await raw(win));
    measured=await measurementPoint(win,'after-checkpoint');
    assert.equal(measured.pending,1,'Read-only measurement cannot settle saved pending authority');
    await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify({...checkpoint,screenshots},null,2));
    status=await evaluate(win,'window.__visualReferenceFixture.interrupt()');assert.equal(status.checks.interruption.poseCleared,true);
    assert.equal(status.checks.actorGestureMemory?.interruptionPublicPoseAbsent,true);
    assert.equal(status.checks.actorGesturePrediction?.sameInstantCancellationPure,true);
    assert.equal(status.checks.interruption.pendingKind,checkpoint.pendingKind);
    if(context.responseScenario)assert.deepEqual(status.reference.senderFeedback,[],
      'Interruption clears session feedback and cannot produce a second sample');
    const beforeInterruptCounts=measured.counts;
    measured=await measurementPoint(win,'after-interruption');
    assert.equal(measured.pending,0,'Interrupted paid action must lose its ephemeral authority');
    for(const key of ['paidInspectionCompletions','paidReplyCompletions','listenerOptimizerSteps','senderUpdates'])
      assert.equal(measured.counts[key],beforeInterruptCounts[key],
        'Interrupted partial work cannot create another '+key);
    const censorKey=context.responseScenario?'responseCensors':'originalCensors';
    assert.equal(measured.counts[censorKey],beforeInterruptCounts[censorKey]+1,
      'The interrupted pending exchange must be censored once');
    await fs.writeFile(path.join(context.output,'interruption.json'),JSON.stringify(status,null,2));
    await capture(win,'06-explicit-interruption-no-cue.png');
    assert.equal(await raw(win),checkpoint.raw,'Post-save interruption cannot rewrite saved mid-action bytes');
    await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify({...checkpoint,screenshots},null,2));
    await evaluate(win,'window.__visualReferenceFixture.dispose();true');
    await session.defaultSession.flushStorageData();
  }
  async function reopen(win){
    if(context.motorScenario)return motorReopen(win);
    const saved=JSON.parse(await fs.readFile(path.join(context.output,'checkpoint.json'),'utf8'));
    assert.equal(saved.pendingKind,context.responseScenario?'listener-response':'sender-demonstration');
    assert.equal(await raw(win),saved.raw,'Independent reopen reads exact saved mid-action bytes');
    const restored=await snapshot(win);assert.deepEqual(restored,saved.expectedRestored,'Actual reopen preserves clocks/bodies/history and interrupts only unfinished action');
    assert.equal(await evaluate(win,'window.__ozarkWorld.gestureMemoryEmpty()'),true,
      'First independent reopen must begin with empty session-only actor gesture memory');
    assert.equal(await evaluate(win,'window.__ozarkWorld.gesturePredictionEmpty()'),true,
      'First independent reopen must begin without session-only prediction history or pending forecast');
    assertStructuralRestoredHistory(JSON.parse(saved.raw),restored);
    assert.equal(await evaluate(win,'window.__ozarkWorld.referenceFixture(()=>true)'),null,'Loaded profile cannot obtain fresh fixture authority');
    const measured=await measurementPoint(win,'first-reopen');
    assert(Object.values(measured.counts).every(value=>value===0),
      'Process-local measurement cannot replay a saved transaction');
    assert.equal(measured.events.length,0);
    assert.equal(measured.pending,0,'Saved pending action cannot revive learning authority');
    const reference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()');
    assert.equal(reference.learners.length,2);
    assertRetainedLearning(reference,saved,'First independent reopen');
    const modelAudit=await assertReopenedCharacter(win,saved,'First independent reopen');
    const replay=await evaluate(win,'('+probeVisualReferenceReopen.toString()+')(document.baseURI,window.__ozarkWorld.fullSnapshot(),'+
      JSON.stringify(saved.serializedActive)+','+JSON.stringify(saved.serializedPermit)+','+
      JSON.stringify({pendingKind:saved.pendingKind,serializedInspectionActive:saved.serializedInspectionActive,
        serializedDemonstrationActive:saved.serializedDemonstrationActive})+')');
    assert.equal(replay.noRevivedAuthority,true);
    assert.equal(replay.inspectionCompletion,null,'Copied original paid inspection receipt cannot complete after reopen');
    assert.equal(replay.inspectionPermit,null,'Copied original paid inspection receipt cannot create a new indication permit');
    assert.deepEqual(await snapshot(win),restored,'Read-only copied-state replay audit cannot mutate reopened main');
    await capture(win,'07-independent-reopen-no-authority.png');
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),true);
    const resavedRaw=await raw(win);
    assert.deepEqual(JSON.parse(resavedRaw).characterMessages,JSON.parse(saved.raw).characterMessages,
      'First ordinary save after reopen retains exact private model weights, counters and RNG states without pending authority');
    await fs.writeFile(path.join(context.output,'after-checkpoint.json'),JSON.stringify({raw:resavedRaw,expectedRestored:restored,replay,reference,modelAudit,
      report:saved.report,
      pendingKind:saved.pendingKind,fixtureDisclosure:saved.fixtureDisclosure,screenshots:[...saved.screenshots,...screenshots]},null,2));
    await session.defaultSession.flushStorageData();
  }
  async function motorReopen(win){
    const saved=JSON.parse(await fs.readFile(path.join(context.output,'checkpoint.json'),'utf8'));
    assert.equal(saved.pendingKind,'free-hand');
    assert.equal(await raw(win),saved.raw,
      'Independent motor reopen must read exact occupied mid-action bytes');
    const restored=await snapshot(win);
    assert.deepEqual(restored,saved.expectedRestored,
      'Ordinary save migration must interrupt only the unfinished physical motor action');
    assert(restored.agents.every(actor=>actor.active===null),
      'No target-free action may remain active after independent reopen');
    assert.equal(await evaluate(win,'window.__ozarkWorld.gestureMemoryEmpty()'),true,
      'Independent reopen cannot restore actor-local public gesture rows');
    assert.equal(await evaluate(win,'window.__ozarkWorld.gesturePredictionEmpty()'),true,
      'Independent reopen cannot restore a frozen self-supervised forecast');
    assertStructuralRestoredHistory(JSON.parse(saved.raw),restored);
    assert.equal(await evaluate(win,'window.__ozarkWorld.referenceFixture(()=>true)'),null,
      'Occupied saved motor profile cannot obtain fresh fixture authority');
    const measured=await measurementPoint(win,'motor-reopen');
    const reopenedV3=await v3ProjectionPoint(win,'motor-reopen');
    assert(reopenedV3.motor.actors.every(row=>row.freeHandObserver?.selectedAttempts===0&&
      row.freeHandObserver?.visibleSamples===0&&row.gesturePrediction?.updates===0),
      'The v3 observer must start with empty session motor and predictor counts after reopen');
    assert(Object.values(measured.counts).every(value=>value===0)&&
      measured.events.length===0&&measured.pending===0,
      'A paid neutral motion cannot replay character events or learning on reopen');
    for(const actor of measured.actors){
      assert.equal(actor.freeHandObserver?.selectedAttempts,0);
      assert.equal(actor.freeHandObserver?.visibleSamples,0);
      assert.equal(actor.freeHandObserver?.eligibleDecisions,0);
      assert.equal(actor.freeHandObserver.lifecycle.admitted,0);
      assert.equal(actor.freeHandObserver.lifecycle.firstPaid,0);
      assert.equal(actor.freeHandObserver.lifecycle.certifiedPaidSeconds,0);
      assert.equal(actor.freeHandObserver.lifecycle.completed,0);
      assert.equal(actor.freeHandObserver.lifecycle.ownPoseSamples,0);
      assert.equal(actor.freeHandObserver.lifecycle.pending,0);
      assert(actor.freeHandObserver.nextEligibleAt>=restored.elapsed+120-1e-7,
        'Each reopened actor independently waits another full motor cooldown');
    }
    const copied=await evaluate(win,'('+probeFreeHandReopen.toString()+')(document.baseURI,window.__ozarkWorld.fullSnapshot(),'+
      JSON.stringify(saved.serializedActive)+')');
    assert.deepEqual(copied,{copiedPose:null,copiedOwnAction:false,copiedPaidSeconds:0,
      noRevivedAuthority:true},'A copied saved motor command cannot resurrect private paid authority');
    assert.deepEqual(await snapshot(win),restored,'Copied-state authority probe cannot change the live world');
    await capture(win,'motor-04-independent-reopen-no-authority.png');
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),true,
      'Ordinary save after reopen must retain the actual interrupted world');
    const resavedRaw=await raw(win);
    assert.deepEqual(JSON.parse(resavedRaw).characterMessages,
      JSON.parse(saved.raw).characterMessages,
      'Neutral movement cannot alter private character weights, baselines, replay or RNG');
    await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({
      passed:true,nativeExecutionPerformed:false,sourceIdentity:context.sourceIdentity,
      sourceFingerprint:context.sourceFingerprint,mainPopulationAndEcology:true,
      originalActorPositions:true,realFixedStep:1/60,actualCanvas:true,
      motorFirst:saved.report.checks.motorFirstComplete,
      motorFirstVisible:saved.report.checks.motorFirstVisible,
      motorSecondVisible:saved.report.checks.motorSecondVisible,
      motorPending:saved.report.checks.motorPending,
      copiedSavedAuthority:copied,independentReopenDelay:measured.actors.map(actor=>({
        id:actor.id,...actor.freeHandObserver})),
      noCharacterMessageOrLearning:true,screenshots:[...saved.screenshots,...screenshots],
      fixtureDisclosure:saved.fixtureDisclosure,
      scope:'Engineering-only, target-free funded motor movement in the main Ozark state: two original actors, unchanged ecology and real 120-second first delay. Aster fully pays one 1.8-second hand movement; Mira begins her independent first movement and is saved during paid partial work. Real peer sight and a read-only occlusion probe distinguish pose, visible absence and unknown. Independent reopen discards motor authority and local predictor history. The fixed curiosity and motor shape are supplied scaffolding, not a word, clarification request, learned response, ordinary encounter, survival benefit or language acquisition.'
    },null,2));
    await session.defaultSession.flushStorageData();
  }
  async function verify(win){
    const saved=JSON.parse(await fs.readFile(path.join(context.output,'after-checkpoint.json'),'utf8'));
    assert.equal(saved.pendingKind,context.responseScenario?'listener-response':'sender-demonstration');
    assert.equal(await raw(win),saved.raw,'Third process reads exact post-interruption save bytes');
    const restored=await snapshot(win);assert.deepEqual(restored,saved.expectedRestored,'Repeated reopen cannot duplicate interruption or revive authority');
    assert.equal(await evaluate(win,'window.__ozarkWorld.gestureMemoryEmpty()'),true,
      'Second independent reopen must not restore actor gesture history from ordinary saved bytes');
    assert.equal(await evaluate(win,'window.__ozarkWorld.gesturePredictionEmpty()'),true,
      'Second independent reopen must not restore actor-local prediction state');
    assertStructuralRestoredHistory(JSON.parse(saved.raw),restored);
    const measured=await measurementPoint(win,'second-reopen');
    assert(Object.values(measured.counts).every(value=>value===0),
      'Repeated reopen cannot replay observer counts or learning');
    assert.equal(measured.events.length,0);
    assert.equal(measured.pending,0);
    const reference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()');
    assertRetainedLearning(reference,saved,'Second independent reopen');
    const modelAudit=await assertReopenedCharacter(win,saved,'Second independent reopen');
    assert.deepEqual(modelAudit,saved.modelAudit,'Repeated reopen preserves exact model state and inspection purity');
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),true,
      'Second independent reopen must export its actual loaded private models');
    assert.deepEqual(JSON.parse(await raw(win)).characterMessages,JSON.parse(saved.raw).characterMessages,
      'Second independent reopen retains exact live model weights, counters and RNG states');
    const characterAudit=JSON.parse(await fs.readFile(path.join(context.output,'character-model-audit.json'),'utf8'));
    const priorMeasurementChecks=(await Promise.all(context.phases.slice(0,-1).map(async name=>
      JSON.parse(await fs.readFile(path.join(context.output,name+'-measurement-checks.json'),'utf8'))))).flatMap(row=>row.checks);
    const firstEvent=saved.report.reference.observationEvents[0],replyAvailable=saved.report.checks.replyAvailable;
    const paidReplySeconds=saved.report.checks.responsePayment?.canonicalWorkSeconds??0;
    await capture(win,'08-repeated-reopen-no-duplicate-interruption.png');
    await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:false,
      sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,
      mainPopulationAndEcology:true,originalActorPositions:!context.responseScenario,
      authoredResponseGeometry:saved.report.checks.authoredGeometry??null,
      fixedStepSeconds:1/60,paidChoiceBeforeIndication:true,paidIndicationSeconds:1.8,
      replyAvailable,replyFeedbackStatus:firstEvent.feedbackStatus,paidListenerResponseSeconds:paidReplySeconds,
      paidReplyCensored:firstEvent.feedbackStatus==='censored',
      actualCanvasCrops:true,exactEmittedCharacterString:firstEvent.message,
      actorLocalGestureMemory:{...saved.report.checks.actorGestureMemory,independentReopensEmpty:true},
      actorLocalGesturePrediction:{...saved.report.checks.actorGesturePrediction,independentReopensEmpty:true,
        scope:'Engineered paid-action in-stream training and prequential sensor scores, not held-out evaluation or ordinary meaning evidence; no policy effect'},
      consecutiveListenerGeometryAudit:true,
      consecutiveSenderResponseGeometryAudit:paidReplySeconds>0,privateCanonicalWitnessOnly:true,
      canonicalOwnDemonstrationLearning:true,
      uniquePhysicalDemonstrations:saved.report.reference.learners.find(row=>row.agentId===firstEvent.receiverId)?.character.uniqueDemonstrations,
      listenerOptimizerSteps:saved.report.reference.learners.find(row=>row.agentId===firstEvent.receiverId)?.character.listenerUpdates,
      senderOptimizerSteps:saved.report.reference.learners.find(row=>row.agentId===firstEvent.senderId)?.character.senderUpdates,
      readOnlyPrivateModelInspection:true,modelStateSha256:modelAudit.characterStateSha256,
      ephemeralSenderFeedback:saved.report.reference.senderFeedback.length,
      senderOnlyFreshResponseCrop:!!saved.report.checks.senderFeedback?.senderOnly,noFeedbackOnReopen:true,
      actualLearningTabCaptured:true,learningPanelReadOnly:true,
      passiveMeasurementNativeQA:true,passiveMeasurementChecks:[...priorMeasurementChecks,...measurementChecks],
      ...(context.responseScenario?{
        modelCandidatePermutationEquivariant:true,
        postSecondPrivateModelExportPersistedExact:true,
      }:{modelCandidatePermutationEquivariant:true,
        restoredPrivateModelOnRecordedOwnViews:true}),
      timestampedCandidatePairSha256:characterAudit.timestampedPairSha256,
      ...(context.responseScenario?{secondListenerOwnViewLabel:saved.report.checks.secondLabel?.classifiedLabel??null,
        secondListenerOwnViewUpdated:saved.report.checks.secondLabel?.updated??false,
        secondListenerPhysicalDemonstrations:saved.report.checks.secondLabel?.demonstrations??null,
        secondListenerOptimizerSteps:saved.report.checks.secondLabel?.optimizerSteps??null,
        secondListenerReplayUses:saved.report.checks.secondLabel?.replayUses??null}:{}),
      noBodilyReward:true,reopenRetainsIndividualLearning:true,
      noClosedTimeProgression:true,noRevivedAuthority:true,noDuplicateInterruption:true,
      savedMidListenerResponse:context.responseScenario,noSecondFeedbackAfterReopen:context.responseScenario,
      nativeWrongOriginalChoiceMismatched:context.responseScenario,
      savedMidSenderDemonstration:!context.responseScenario,
      screenshots:[...saved.screenshots,...screenshots],fixtureDisclosure:saved.fixtureDisclosure,
      scope:context.responseScenario?
        'Fixed historical seed-212 engineering negative control with authored initial Mira position (230,960), wrong original paid inspection, one listener update and sender-local actual-Canvas mismatch update. A second full optional exchange is saved during the genuinely paid listener response; isolated reopen and second reopen discard pending authority without duplicating any update, preserving private model weights and replay. This is not ordinary initial geometry, generalization, autonomous cohort, scientific-seed sweep or survival-benefit evidence.':
        'Bounded engineering-only deliberate original-position main-world actions and native pixels show a sampled character string, original own-view listener example and one model update. A physically admitted reverse reply may still be ambiguous in actual sender sight; such a paid observation censors sender learning without erasing listener learning. The second authentic sampled sequence is saved mid-paid sender indication and cannot revive its authority after close/reopen. No vocabulary, grammar, generalization, autonomous cohort, scientific-seed sweep or survival-benefit claim.'},null,2));
  }
  async function closeNormally(win){
    assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().started'),false,'Engineering fixture must never start an independent wall-clock loop');
    await fs.writeFile(path.join(context.output,phase+'-measurement-checks.json'),
      JSON.stringify({phase,checks:measurementChecks},null,2));
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
        const operation=phase.startsWith('response-')?phase.slice('response-'.length):
          phase.startsWith('ambiguity-')?phase.slice('ambiguity-'.length):
          phase.startsWith('motor-')?phase.slice('motor-'.length):phase;
        await ({exercise,reopen,verify}[operation])(win);await closeNormally(win);
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

const helpers={captureWithReadiness,waitForCaptureFrames,conversationViewportEvidence,currentRouteSnapshot,assertCurrentRoute,assertStructuralRestoredHistory,
  visualReferenceEvidence,installVisualReferenceFixture,probeVisualReferenceReopen,probeFreeHandReopen,
  guardFreshCharacterMotorPilot,projectCharacterPilot};
// Serialized helper expressions are created outside installRunner, so their
// imported assertion dependency must exist in the generated outer scope.
const source="const assert = require('node:assert/strict');\n"+'('+installRunner.toString()+')('+JSON.stringify(context)+',{'+Object.entries(helpers).map(([key,fn])=>key+':'+fn.toString()).join(',')+'});\n';
let nativeProcessesClosed=true,nativeProcessesStarted=0;
try{
  await writeFile(harness,source);
  const prepared={...context,harness,harnessSha256:createHash('sha256').update(source).digest('hex'),phases,
    nativeExecutionPerformed:false,sandboxBypassFlags:[],scope:motorScenario?
      'engineering-only original-position main-world target-free funded motor action, fixed 120-simulation-second first delay through 7,200 real fixed steps, full Aster payment, Mira pending paid save and independent reopen; actual public pose and actor-local prediction, no assigned meaning, object or automatic response':ambiguityScenario?
      'engineering-only fixed seed-211 actor placement and reciprocal position swap of existing ripe bramble object:504 and apple tree object:505 before observation; one actual Canvas paid ambiguous reply must censor sender feedback without erasing the one listener example; no ordinary opportunity, cohort or generalization':responseScenario?
      'engineering-only fixed historical seed 212 wrong-choice negative control with authored Mira position (230,960); actual Canvas listener and sender updates, mismatch and save during paid listener response across independent close/reopen; no ordinary opportunity, cohort or generalization':
      'engineering-only original-position actual Canvas own-demo character learning; a paid sender-visible reply can be censored by actual observation; pending sampled message close/reopen and read-only model inspection; no cohort or generalization'};
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
    assert(processIds.every(pid=>Number.isInteger(pid)&&pid>0));assert.equal(new Set(processIds).size,phases.length);
    const result=JSON.parse(await readFile(join(output,'result.json'),'utf8'));
    Object.assign(result,{nativeExecutionPerformed:true,threeIndependentElectronProcesses:phases.length===3,
      independentElectronProcesses:phases.length,processIds,actualNativeCloseEvents:true,actualNativeWillQuitEvents:true});
    await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }
}finally{
  let preserved=false;
  if(nativeProcessesClosed)try{const archive=await archiveNativeProfile(profile,join(output,'profile-evidence'));
    await writeFile(join(output,'profile-evidence.json'),JSON.stringify({runtimeProfile:profile,copiedAfterProcessesClosed:nativeProcessesStarted>0,nativeExecutionPerformed:nativeProcessesStarted>0,archive},null,2));preserved=true;
  }catch(error){console.error('Profile preservation failed; original retained at '+temporary,error);process.exitCode=1;}
  if(preserved)await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(error=>{console.error('Disposable profile cleanup failed: '+temporary,error);process.exitCode=1;});
}
