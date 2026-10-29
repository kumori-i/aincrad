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

const root=fileURLToPath(new URL('..',import.meta.url)),prepareOnly=process.argv.includes('--prepare-only'),
  responseScenario=process.argv.includes('--response-scenario');
assert(process.argv.slice(2).every(arg=>['--prepare-only','--response-scenario'].includes(arg))&&
  process.argv.filter(arg=>arg==='--prepare-only').length<=1&&
  process.argv.filter(arg=>arg==='--response-scenario').length<=1,'Only bounded preparation and response scenario options are supported');
if(!prepareOnly){
  assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_WORKFLOW==='Visual reference association native acceptance','Native execution requires the approved engineering CI workflow');
  assert(['linux','darwin'].includes(process.platform),'Linux/macOS only');
  assert(process.getuid?.()!==0,'Native QA requires an unprivileged sandboxed runtime');
  assert(process.platform!=='linux'||process.env.DISPLAY||process.env.WAYLAND_DISPLAY,'Authorized supported display required');
}
const outputRoot=resolve(process.env.AINCRAD_VISUAL_REFERENCE_QA_OUTPUT||
  join(root,'test-results/visual-reference-native',responseScenario?'response':''));
await mkdir(outputRoot,{recursive:true});
const output=await mkdtemp(join(outputRoot,'run-')),temporary=await mkdtemp(join(tmpdir(),'aincrad-visual-reference-'));
const profile=join(temporary,'profile');
for(const name of ['profile','home','config','cache'])await mkdir(join(temporary,name));
const application=await canonicalApplicationRoot(output),built=await buildApplication(application);
const context={output,profile,application,responseScenario,sourceIdentity:nativeSourceIdentity(root),sourceFingerprint:built.sourceFingerprint};
if(!prepareOnly){assert.equal(context.sourceIdentity.commit,process.env.GITHUB_SHA,'Native CI must exercise the exact approved checkout SHA');assert.equal(context.sourceIdentity.worktreeStatus,'','Native CI requires a clean reviewed source tree');}
const harness=join(output,'runner.cjs'),phases=responseScenario?
  ['response-exercise','response-reopen','response-verify']:['exercise','reopen','verify'];
context.phases=phases;

function installRunner(context,helpers){
  const {app,session}=require('electron'),assert=require('node:assert/strict');
  const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
  const {captureWithReadiness,waitForCaptureFrames,currentRouteSnapshot,assertCurrentRoute,assertStructuralRestoredHistory,
    visualReferenceEvidence,installVisualReferenceFixture,probeVisualReferenceReopen}=helpers;
  const phase=process.argv.find(arg=>arg.startsWith('--phase='))?.slice(8);
  assert(context.phases.includes(phase));
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let running=false,closed=false,allowQuit=false,stage='initializing';
  const events=[],screenshots=[];
  const deadline=setTimeout(()=>{console.error('Visual reference native deadline at '+stage);app.exit(1);},240000);
  app.on('will-quit',event=>{if(!allowQuit)event.preventDefault();else{assert(closed);console.log('VISUAL_REFERENCE_NATIVE_WILL_QUIT '+phase);}});
  const evaluate=(win,source)=>{stage=source.slice(0,140);return win.webContents.executeJavaScript(source);};
  const snapshot=win=>evaluate(win,'('+visualReferenceEvidence.toString()+')(window.__ozarkWorld.fullSnapshot())');
  const raw=win=>evaluate(win,"localStorage.getItem('aincrad.world.v2')");
  const durableLearners=reference=>reference.learners.map(({agentId,identity,anchors,partners,counts})=>
    ({agentId,identity,anchors,partners,counts}));
  function assertRetainedLearning(reference,saved,label){
    assert.equal(reference.pending,0,label+' must not resume a transaction');
    for(const key of ['exchanges','completed','observed','correct','censored','updates','correctionAttempts','evidenceAdditions','supportUpdates','conflicts',
      'feedbackMatched','feedbackMismatched','feedbackCensored'])
      assert.equal(reference[key],0,label+' must not replay '+key);
    assert.deepEqual(reference.observationEvents,[],label+' has no resurrected event history');
    assert.deepEqual(reference.senderFeedback??[],[],label+' has no resurrected sender feedback');
    assert.deepEqual(durableLearners(reference),durableLearners(saved.report.reference),label+' retains the learned private associations');
    const learned=saved.report.reference.learners.find(row=>row.counts.examples>=1);
    assert(learned,'Saved listener own-view example is required');
    assert.equal(reference.learners.find(row=>row.agentId===learned.agentId)?.counts.examples,learned.counts.examples,
      label+' retains the listener own-view example');
  }
  async function assertReopenedRetrieval(win,saved,label){
    const audit=JSON.parse(await fs.readFile(path.join(context.output,'association-retrieval-audit.json'),'utf8'));
    const expected=context.responseScenario?
      JSON.parse(await fs.readFile(path.join(context.output,'association-post-second-retrieval.json'),'utf8')):
      {known:audit.known,reversed:audit.reversed,absent:audit.absent.choice};
    const observed=saved.report.reference.observationEvents.find(event=>event.status==='observed');
    assert(observed,'Saved canonical observed correction is required');
    const base={listenerId:observed.receiverId,senderId:observed.senderId};
    const candidates=audit.candidateViews.map(view=>view.features);
    const beforeWorld=await snapshot(win),beforeReference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeRaw=await raw(win);
    const probe=async(symbol,candidateFeatures)=>evaluate(win,
      'window.__ozarkWorld.referencePersistenceProbe('+JSON.stringify({...base,symbol,candidateFeatures})+')');
    assert.deepEqual(await probe(audit.symbol,candidates),expected.known,
      label+(context.responseScenario?' retains the exact post-second known-symbol query':' retrieves the demonstrated symbol from retained memory'));
    assert.deepEqual(await probe(audit.symbol,candidates.slice().reverse()),expected.reversed,
      label+(context.responseScenario?' retains the exact post-second reversed query':' follows reversed own views'));
    assert.deepEqual(await probe(audit.absent.symbol,candidates),expected.absent,label+' retains the preclose absent-symbol query result');
    assert.deepEqual(await snapshot(win),beforeWorld,label+' retrieval leaves the world unchanged');
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeReference,label+' retrieval leaves learner memory and metrics unchanged');
    assert.equal(await raw(win),beforeRaw,label+' retrieval cannot write save bytes');
    return {known:expected.known,reversed:expected.reversed,absent:expected.absent,readOnly:true};
  }
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
    return {text:messages.textContent,selected:select.value,visible:!panel.classList.contains('hidden'),
      tab:panel.dataset.journalTab,character:document.getElementById('npc-name').textContent};
  }
  async function captureAssociationLearning(win){
    const beforeWorld=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
    const beforeReference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()');
    const receiver=beforeReference.learners.find(memory=>memory.counts.examples===1);
    assert(receiver,'Actual acquiring listener must exist before UI inspection');
    const learning=await evaluate(win,'('+presentAssociationLearning.toString()+')('+JSON.stringify(receiver.agentId)+')');
    assert.equal(learning.selected,receiver.agentId);assert.equal(learning.visible,true);assert.equal(learning.tab,'conversation');
    for(const text of ['Observer annotations, not agent speech.','1 canonical observed demonstrations',
      '0 association-matched choices','1 uniform exploratory choices','1 corrective observations','1 new visual exemplars',
      '1 partner-symbol entries','1 own demonstrated examples','Reference matching is not bodily relief or sickness.',
      'uniform-exploration (unknown-symbol)','observed correction: new-exemplar',
      'Listener’s own post-choice demonstration'])assert(learning.text.includes(text),text);
    assert.match(learning.text,/private visual associations.*reopen/i,'Learning must describe retained private memory');
    assert(!learning.text.includes('measured reward'),'Observer reference counts cannot imply bodily reward');
    if(context.responseScenario){
      assert(learning.text.includes('independent reference critic: different'),'Wrong original choice must remain visible as observer-only critic evidence');
      assert(learning.text.includes('Sender-local visible response: mismatched'),'Learning view must display the actual sender-local mismatch');
    }
    const displayedWorld=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
    assert.deepEqual({...displayedWorld,selectedAgentId:beforeWorld.selectedAgentId},beforeWorld,'Opening Learning may change only observer selection, not the world');
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeReference,'Learning view cannot mutate association memory or metrics');
    await capture(win,'04b-learning-own-association-counters.png');
    assert.equal(await evaluate(win,`(()=>{const crop=document.getElementById('journal-messages').querySelector('[aria-label="Listener’s own post-choice demonstration"]');if(!crop)return false;crop.scrollIntoView({block:'center'});return true;})()`),true);
    await capture(win,'04c-learning-own-demonstration-provenance.png');
    if(context.responseScenario){
      const visible=await evaluate(win,`(()=>{
        const panel=document.getElementById('journal-messages');
        const lines=[...panel.querySelectorAll('article.journal-entry p')];
        const critic=lines.find(node=>node.textContent.includes('independent reference critic: different'));
        const response=lines.find(node=>node.textContent.includes('Sender-local visible response: mismatched'));
        if(!critic||!response)return false;
        const frame=panel.getBoundingClientRect(),a=critic.getBoundingClientRect(),b=response.getBoundingClientRect();
        panel.scrollTop+=(a.top+b.bottom)/2-(frame.top+frame.bottom)/2;
        const within=node=>{const r=node.getBoundingClientRect();return r.top>=frame.top&&r.bottom<=frame.bottom;};
        return within(critic)&&within(response);
      })()`);
      assert.equal(visible,true,'The correction critic and sensory mismatch must both be visible in the native screenshot');
      await capture(win,'04d-wrong-original-choice-after-correction.png');
    }
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.fullSnapshot()'),displayedWorld,'Learning screenshots and scrolling cannot advance time or mutate the world');
    await evaluate(win,`(()=>{const select=document.getElementById('npc-select');select.value=${JSON.stringify(beforeWorld.selectedAgentId)};select.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('close-npc').click();return true;})()`);
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.fullSnapshot()'),beforeWorld,'Closing Learning restores observer selection with exact unchanged full world');
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeReference,'Learning open/capture/close leaves reference snapshot exact');
    await fs.writeFile(path.join(context.output,'association-learning-view.json'),JSON.stringify({...learning,readOnly:true,
      temporaryObserverSelectionOnly:true,restoredSelectedAgentId:beforeWorld.selectedAgentId,at:beforeWorld.elapsed},null,2));
  }
  async function exercise(win){
    assert.equal(await raw(win),null,'Fresh disposable profile must contain no current save');
    assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().elapsed'),0);
    const fixtureContext=context.responseScenario?'{...context,responseScenario:true}':'context';
    const install='window.__visualReferenceFixture=await window.__ozarkWorld.referenceFixture(context=>('+installVisualReferenceFixture.toString()+')('+fixtureContext+',document.baseURI,('+visualReferenceEvidence.toString()+')),'+
      JSON.stringify(context.responseScenario?{negativeControlSeed:212}:{})+');return Boolean(window.__visualReferenceFixture)';
    assert.equal(await evaluate(win,'(async()=>{'+install+'})()'),true,'Install fixture on actual fresh main population');
    assert.equal(await evaluate(win,'window.__ozarkWorld.communicationSnapshot().seed'),context.responseScenario?212:211,
      'Native scenario must use its disclosed fresh communication stream');
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
    assert.equal(status.pose,null);assert.equal(status.reference.observed,1);assert.equal(status.reference.updates,1);assert.equal(status.reference.evidenceAdditions,1);
    assert.deepEqual(status.reference.senderFeedback,[]);
    const replyAvailable=status.checks.replyAvailable;
    assert.equal(typeof replyAvailable,'boolean','Actual response geometry must be audited after listener learning');
    if(context.responseScenario)assert.equal(replyAvailable,true,'Authored response profile must offer a visible paid reply');
    else if(!replyAvailable){
      assert.equal(status.reference.latest.feedbackStatus,'censored');
      assert.equal(status.reference.latest.feedbackReason,'response-not-resolvable');
      assert.equal(status.reference.pending,0,'An unresolvable reply must leave no pending authority');
    }
    if(replyAvailable)assert.equal(status.reference.latest.feedbackStatus,'awaiting-response');
    await fs.writeFile(path.join(context.output,'completed-reference.json'),JSON.stringify(status,null,2));
    await capture(win,'04-after-sender-completion-no-cue.png');
    if(replyAvailable){
      status=await evaluate(win,'window.__visualReferenceFixture.beginResponse()');
      assert.equal(status.responsePose,null);assert.deepEqual(status.reference.senderFeedback,[]);
      status=await evaluate(win,'window.__visualReferenceFixture.visibleResponse()');
      assert(status.responsePose);assert.equal(status.checks.responseVisible.actualCanvas,true);
      await fs.writeFile(path.join(context.output,'visible-response-parser-audit.json'),JSON.stringify(status,null,2));
      await capture(win,'04a-during-paid-listener-response.png');
      status=await evaluate(win,'window.__visualReferenceFixture.completeResponse()');
      assert.equal(status.responsePose,null);assert.equal(status.reference.pending,0);
      if(status.reference.latest.feedbackStatus==='censored'){
        assert.equal(context.responseScenario,false,'Authored response profile must produce its required mismatch');
        assert.deepEqual(status.reference.senderFeedback,[],'A paid but censored reply gives no training sample');
      }else{
        assert(['matched','mismatched'].includes(status.reference.latest.feedbackStatus));
        assert.equal(status.reference.senderFeedback.length,1);
        assert.equal(status.checks.senderFeedback.actualCanvas,true);assert.equal(status.checks.senderFeedback.senderOnly,true);
      }
      await capture(win,'04a2-after-listener-response-no-cue.png');
    }else{
      assert.equal(status.responsePose,null,'No reply pose or paid response may exist after geometry censorship');
      await capture(win,'04a2-unavailable-listener-response-no-cue.png');
    }
    const firstSymbol=status.reference.latest.tokens[0]*8+status.reference.latest.tokens[1];
    const firstEntry=status.reference.learners.find(row=>row.agentId===status.reference.latest.receiverId)?.partners
      .flatMap(partner=>partner.entries).find(entry=>entry.symbol===firstSymbol);
    assert.equal(firstEntry?.examples.length,1,'First listener own-view example must be available before later actions');
    const firstExample=firstEntry.examples[0].slice();
    if(context.responseScenario){
      assert.equal(status.reference.latest.referenceCorrect,false,'Original paid choice must be wrong before the corrective demonstration');
      assert.notEqual(status.privateWitness.choice.targetId,status.privateWitness.indication.targetId,
        'The original completed inspection differs from the sender intended referent');
      assert.equal(status.privateWitness.responseTargetId,status.privateWitness.choice.targetId,
        'The paid reply points to the original choice, even after listener corrective learning');
      assert.equal(status.reference.latest.feedbackStatus,'mismatched');
      assert.equal(status.reference.senderFeedback[0].signal,'mismatch');
      assert.equal(status.reference.learners.find(row=>row.agentId===status.reference.latest.receiverId)?.counts.examples,1,
        'Listener must already have acquired the correction when it replies with its original choice');
      assert.deepEqual(status.reference.senderFeedback[0].features,status.checks.senderFeedback.senderCurrentFeatures,
        'Negative feedback uses the sender own current Canvas crop');
      await fs.writeFile(path.join(context.output,'wrong-original-choice.json'),JSON.stringify({
        originalChoice:status.privateWitness.choice,target:status.privateWitness.indication,
        responseTargetId:status.privateWitness.responseTargetId,
        listenerExamples:status.reference.learners.find(row=>row.agentId===status.reference.latest.receiverId)?.counts.examples,
        senderFeedback:status.reference.senderFeedback[0],senderCurrentFeatures:status.checks.senderFeedback.senderCurrentFeatures,
        source:'genuine paid actions and actual Canvas in a fixed engineering negative control'},null,2));
    }
    await fs.writeFile(path.join(context.output,'first-response-outcome.json'),JSON.stringify(status,null,2));
    status=await evaluate(win,'window.__visualReferenceFixture.inspectAssociation()');
    const associationAudit=status.checks.retrievalDiagnostic;
    assert.equal(associationAudit.readOnly,true);
    assert.deepEqual(associationAudit.eligibleDistributions.absent,[.5,.5]);
    assert.notDeepEqual(associationAudit.eligibleDistributions.known,associationAudit.eligibleDistributions.absent,'Message changes actual-memory eligibility, not a sampled policy action');
    const timestampedPairSha256=createHash('sha256').update(JSON.stringify(associationAudit.candidateViews)).digest('hex');
    await fs.writeFile(path.join(context.output,'association-retrieval-audit.json'),JSON.stringify({...associationAudit,timestampedPairSha256},null,2));
    await captureAssociationLearning(win);
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),false,'Ordinary save/UI cannot persist a fixture-owned world');
    assert.equal(await raw(win),null,'Only the one-shot explicit fixture checkpoint may write');
    status=await evaluate(win,'window.__visualReferenceFixture.'+(context.responseScenario?'pendingResponseForSave':'pendingForSave')+'()');
    if(context.responseScenario){
      assert.equal(status.phase,'pending-response-save');assert(status.responsePose);
      assert.equal(status.reference.latest.feedbackStatus,'responding');
      assert.equal(status.reference.pending,1);
      assert.equal(status.reference.senderFeedback.length,1,'A partly paid second response grants no second feedback');
      assert.equal(status.checks.pendingResponse.originalInspectedId,status.privateWitness.responseTargetId);
      const retained=status.reference.learners.find(row=>row.agentId===status.reference.observationEvents[0].receiverId)?.partners
        .flatMap(partner=>partner.entries).find(entry=>entry.symbol===firstSymbol);
      assert(retained?.examples.some(example=>JSON.stringify(example)===JSON.stringify(firstExample)),
        'Second exchange and pending response must preserve the first completed own-view exemplar');
      await capture(win,'05-second-paid-listener-response-before-save.png');
      // The second authentic correction can add support or an exemplar. Record
      // the current read-only query result before close, then demand exact
      // persistence across both reopens without assuming its old distribution.
      const sourceEvent=status.reference.observationEvents[0],base={listenerId:sourceEvent.receiverId,senderId:sourceEvent.senderId},
        candidateFeatures=associationAudit.candidateViews.map(view=>view.features);
      const query=(symbol,features)=>evaluate(win,'window.__ozarkWorld.referencePersistenceProbe('+
        JSON.stringify({...base,symbol,candidateFeatures:features})+')');
      const beforeWorld=await snapshot(win),beforeReference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()');
      const postSecond={known:await query(associationAudit.symbol,candidateFeatures),
        reversed:await query(associationAudit.symbol,candidateFeatures.slice().reverse()),
        absent:await query(associationAudit.absent.symbol,candidateFeatures),
        scope:'Read-only current memory after second full correction and before mid-response save'};
      assert.deepEqual(await snapshot(win),beforeWorld,'Post-second retrieval cannot change the world');
      assert.deepEqual(await evaluate(win,'window.__ozarkWorld.communicationSnapshot()'),beforeReference,
        'Post-second retrieval cannot change private memory or feedback');
      await fs.writeFile(path.join(context.output,'association-post-second-retrieval.json'),JSON.stringify(postSecond,null,2));
    }else{assert(status.pose);await capture(win,'05-second-paid-indication-before-save.png');}
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),false);
    const checkpoint=await evaluate(win,'window.__visualReferenceFixture.checkpoint(localStorage)');
    assert(checkpoint,'Authenticated one-shot checkpoint must persist actual main state');
    assert.equal(checkpoint.pendingKind,context.responseScenario?'listener-response':'sender-demonstration');
    assert.equal(await evaluate(win,'window.__visualReferenceFixture.checkpoint(localStorage)'),null,'Fixture checkpoint is one attempt only');
    assert.equal(checkpoint.raw,await raw(win));
    await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify({...checkpoint,screenshots},null,2));
    status=await evaluate(win,'window.__visualReferenceFixture.interrupt()');assert.equal(status.checks.interruption.poseCleared,true);
    assert.equal(status.checks.interruption.pendingKind,checkpoint.pendingKind);
    if(context.responseScenario)assert.deepEqual(status.reference.senderFeedback,[],
      'Interruption clears session feedback and cannot produce a second sample');
    await fs.writeFile(path.join(context.output,'interruption.json'),JSON.stringify(status,null,2));
    await capture(win,'06-explicit-interruption-no-cue.png');
    assert.equal(await raw(win),checkpoint.raw,'Post-save interruption cannot rewrite saved mid-action bytes');
    await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify({...checkpoint,screenshots},null,2));
    await evaluate(win,'window.__visualReferenceFixture.dispose();true');
    await session.defaultSession.flushStorageData();
  }
  async function reopen(win){
    const saved=JSON.parse(await fs.readFile(path.join(context.output,'checkpoint.json'),'utf8'));
    assert.equal(saved.pendingKind,context.responseScenario?'listener-response':'sender-demonstration');
    assert.equal(await raw(win),saved.raw,'Independent reopen reads exact saved mid-action bytes');
    const restored=await snapshot(win);assert.deepEqual(restored,saved.expectedRestored,'Actual reopen preserves clocks/bodies/history and interrupts only unfinished action');
    assertStructuralRestoredHistory(JSON.parse(saved.raw),restored);
    assert.equal(await evaluate(win,'window.__ozarkWorld.referenceFixture(()=>true)'),null,'Loaded profile cannot obtain fresh fixture authority');
    const reference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()');
    assert.equal(reference.learners.length,2);
    assertRetainedLearning(reference,saved,'First independent reopen');
    const retrieval=await assertReopenedRetrieval(win,saved,'First independent reopen');
    const replay=await evaluate(win,'('+probeVisualReferenceReopen.toString()+')(document.baseURI,window.__ozarkWorld.fullSnapshot(),'+
      JSON.stringify(saved.serializedActive)+','+JSON.stringify(saved.serializedPermit)+','+
      JSON.stringify({pendingKind:saved.pendingKind,serializedDemonstrationActive:saved.serializedDemonstrationActive})+')');
    assert.equal(replay.noRevivedAuthority,true);
    assert.deepEqual(await snapshot(win),restored,'Read-only copied-state replay audit cannot mutate reopened main');
    await capture(win,'07-independent-reopen-no-authority.png');
    assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),true);
    await fs.writeFile(path.join(context.output,'after-checkpoint.json'),JSON.stringify({raw:await raw(win),expectedRestored:restored,replay,reference,retrieval,
      report:saved.report,
      pendingKind:saved.pendingKind,fixtureDisclosure:saved.fixtureDisclosure,screenshots:[...saved.screenshots,...screenshots]},null,2));
    await session.defaultSession.flushStorageData();
  }
  async function verify(win){
    const saved=JSON.parse(await fs.readFile(path.join(context.output,'after-checkpoint.json'),'utf8'));
    assert.equal(saved.pendingKind,context.responseScenario?'listener-response':'sender-demonstration');
    assert.equal(await raw(win),saved.raw,'Third process reads exact post-interruption save bytes');
    const restored=await snapshot(win);assert.deepEqual(restored,saved.expectedRestored,'Repeated reopen cannot duplicate interruption or revive authority');
    assertStructuralRestoredHistory(JSON.parse(saved.raw),restored);
    const reference=await evaluate(win,'window.__ozarkWorld.communicationSnapshot()');
    assertRetainedLearning(reference,{report:{reference:saved.reference}},'Second independent reopen');
    const retrieval=await assertReopenedRetrieval(win,saved,'Second independent reopen');
    assert.deepEqual(retrieval,saved.retrieval,'Repeated reopen preserves the same message-dependent retrieval');
    const associationAudit=JSON.parse(await fs.readFile(path.join(context.output,'association-retrieval-audit.json'),'utf8'));
    const firstEvent=saved.report.reference.observationEvents[0],replyAvailable=saved.report.checks.replyAvailable;
    const paidReplySeconds=saved.report.checks.responsePayment?.canonicalWorkSeconds??0;
    await capture(win,'08-repeated-reopen-no-duplicate-interruption.png');
    await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:false,
      sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,
      mainPopulationAndEcology:true,originalActorPositions:!context.responseScenario,
      authoredResponseGeometry:saved.report.checks.authoredGeometry??null,
      fixedStepSeconds:1/60,paidChoiceBeforeIndication:true,paidIndicationSeconds:1.8,
      replyAvailable,replyFeedbackStatus:firstEvent.feedbackStatus,paidListenerResponseSeconds:paidReplySeconds,
      replyUnavailableCensored:!replyAvailable&&firstEvent.feedbackStatus==='censored',
      paidReplyCensored:replyAvailable&&firstEvent.feedbackStatus==='censored',
      actualCanvasCrops:true,consecutiveListenerGeometryAudit:true,
      consecutiveSenderResponseGeometryAudit:paidReplySeconds>0,privateCanonicalWitnessOnly:true,
      canonicalOwnDemonstrationAssociation:true,associationEvidenceAdditions:saved.report.reference.evidenceAdditions,readOnlyActualMemoryRetrieval:true,
      ephemeralSenderFeedback:saved.report.reference.senderFeedback.length,
      senderOnlyFreshResponseCrop:!!saved.report.checks.senderFeedback?.senderOnly,noFeedbackOnReopen:true,
      actualLearningTabCaptured:true,learningPanelReadOnly:true,
      ...(context.responseScenario?{
        initialRetrievalEligibleDistributions:associationAudit.eligibleDistributions,
        postSecondMemoryQueriesPersistedExact:true,
      }:{retrievalEligibleDistributions:associationAudit.eligibleDistributions,
        restoredMemoryRetrievalOnRecordedOwnViews:true}),
      timestampedCandidatePairSha256:associationAudit.timestampedPairSha256,
      noBodilyReward:true,reopenRetainsIndividualAssociation:true,
      noClosedTimeProgression:true,noRevivedAuthority:true,noDuplicateInterruption:true,
      savedMidListenerResponse:context.responseScenario,noSecondFeedbackAfterReopen:context.responseScenario,
      nativeWrongOriginalChoiceMismatched:context.responseScenario,
      savedMidSenderDemonstration:!context.responseScenario,
      screenshots:[...saved.screenshots,...screenshots],fixtureDisclosure:saved.fixtureDisclosure,
      scope:context.responseScenario?
        'Fixed seed-212 engineering negative control with authored initial Mira position (230,960), wrong original paid inspection, completed correction and sender-local actual-Canvas mismatch. A second full optional exchange is saved during the genuinely paid listener response; isolated reopen and second reopen discard that response permit and any pending or completed sender feedback, preserving private associations. This is not ordinary initial geometry, a sampled later policy action, generalization, autonomous cohort, scientific-seed sweep or survival-benefit evidence.':
        'Bounded engineering-only deliberate original-position main-world actions and native pixels prove the canonical own-demo association. The reverse reply is offered only when actual sender geometry permits it; its result may be paid visual feedback or censored with no sample or added reply cost. Private memory remains across isolated native close/reopen. Post-reopen retrieval queries use genuine listener Canvas views recorded before close; they do not capture new views after reopen. No sampled later policy action, vocabulary discrimination, generalization, autonomous cohort, scientific-seed sweep or survival-benefit claim.'},null,2));
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
        const operation=phase.startsWith('response-')?phase.slice('response-'.length):phase;
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

const helpers={captureWithReadiness,waitForCaptureFrames,currentRouteSnapshot,assertCurrentRoute,assertStructuralRestoredHistory,
  visualReferenceEvidence,installVisualReferenceFixture,probeVisualReferenceReopen};
// Serialized helper expressions are created outside installRunner, so their
// imported assertion dependency must exist in the generated outer scope.
const source="const assert = require('node:assert/strict');\n"+'('+installRunner.toString()+')('+JSON.stringify(context)+',{'+Object.entries(helpers).map(([key,fn])=>key+':'+fn.toString()).join(',')+'});\n';
let nativeProcessesClosed=true,nativeProcessesStarted=0;
try{
  await writeFile(harness,source);
  const prepared={...context,harness,harnessSha256:createHash('sha256').update(source).digest('hex'),phases,
    nativeExecutionPerformed:false,sandboxBypassFlags:[],scope:responseScenario?
      'engineering-only fixed wrong-choice negative control with authored Mira position (230,960); actual Canvas mismatch and save during paid listener response across independent close/reopen; no ordinary opportunity, cohort or generalization':
      'engineering-only original-position own-demo association; optional sender-visible reply can be censored when geometry is unavailable; paid sender-cue close/reopen and read-only retrieval; no cohort or generalization'};
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
