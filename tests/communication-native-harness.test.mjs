import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import {renderLearningView} from '../src/learning-view.js';
import {createCharacterMessageLearner} from '../src/character-message-runtime.js';
import {createVisualReferenceMemory} from '../src/visual-reference-memory.js';
import {beginSurvivalDecision,noteSurvivalDecision,finishSurvivalDecision,survivalDecisionSnapshot} from '../src/survival-decision-observer.js';

test('communication native preparation stays isolated and never claims native execution', async () => {
  const output = await mkdtemp(join(tmpdir(), 'communication-harness-contract-'));
  let passed = false;
  try {
    const result = spawnSync(process.execPath, ['scripts/verify-communication-desktop.mjs', '--prepare-only'], { encoding: 'utf8', timeout: 120000, env: { ...process.env, AINCRAD_COMMUNICATION_QA_OUTPUT: output } });
    assert.equal(result.status, 0, result.stderr);
    const prepared = JSON.parse(result.stdout.trim());
    assert.equal(prepared.nativeExecutionPerformed, false); assert.deepEqual(prepared.sandboxBypassFlags, []);
    assert.deepEqual(prepared.phases, ['exercise', 'reopen', 'reset']); assert.match(prepared.harnessSha256, /^[a-f0-9]{64}$/);
    const applicationRelative = relative(await realpath(output), prepared.application);
    assert(applicationRelative && !isAbsolute(applicationRelative) && applicationRelative !== '..' && !applicationRelative.startsWith('../'));
    await assert.rejects(access(join(prepared.output, 'result.json')));
    const syntax = spawnSync(process.execPath, ['--check', prepared.harness], { encoding: 'utf8' }); assert.equal(syntax.status, 0, syntax.stderr);
    const source = await readFile(prepared.harness, 'utf8');
    const app = new EventEmitter(), loaded = [], require = createRequire(import.meta.url);
    const stub = name => name === 'electron' ? { app, session: {}, ipcMain: {handle(){}} } : name.endsWith('main.cjs') ? loaded.push(name) : require(name);
    const sandbox={require:stub,process:{argv:['runner','--phase=exercise']},console,setTimeout:()=>1,clearTimeout(){}};
    const registration="require(path.join(context.application, 'desktop/main.cjs'));";
    assert(source.includes(registration));
    vm.runInNewContext(source.replace(registration,'globalThis.disclosureAssert=assertPrivateCharacterDisclosure;globalThis.emptyMemoryAssert=assertFreshCharacterLearning;globalThis.observerAssert=assertSurvivalObserver;globalThis.observerReadOnlyAssert=assertObserverReadOnly;globalThis.presentObserver=presentSurvivalObserver;globalThis.checkpointPausedObserver=checkpointPausedObserver;'+registration),sandbox);
    const checkpointCall='await checkpointPausedObserver(win);', baselineRead='const before=await full(),reference=';
    assert(source.includes(checkpointCall) && source.includes(baselineRead));
    assert(source.indexOf(checkpointCall)<source.indexOf(baselineRead),'Normal save must precede the read-only byte baseline');
    const disk={saved:'{"elapsed":4.499999999999989}'},current='{"elapsed":12.83333333333355}',stale=disk.saved,calls=[];
    const auditWindow={webContents:{executeJavaScript(code){
      calls.push(code);
      if(code==='window.__ozarkWorld.snapshot().paused')return true;
      if(code==='window.__ozarkWorld.save()'){disk.saved=current;return true;}
      throw Error('Unexpected audit expression: '+code);
    }}};
    await sandbox.checkpointPausedObserver(auditWindow);
    assert.deepEqual(calls,['window.__ozarkWorld.snapshot().paused','window.__ozarkWorld.save()']);
    const checkpoint=disk.saved;assert.notEqual(checkpoint,stale,'The paused world had newer state than the last autosave');
    disk.saved=current;assert.equal(disk.saved,checkpoint,'A later legitimate paused autosave preserves the byte baseline');
    await assert.rejects(sandbox.checkpointPausedObserver({webContents:{executeJavaScript(code){return code.includes('paused')?true:false;}}}),
      {code:'ERR_ASSERTION'},'A failed ordinary checkpoint cannot start a read-only audit');
    await assert.rejects(sandbox.checkpointPausedObserver({webContents:{executeJavaScript(){return false;}}}),
      {code:'ERR_ASSERTION'},'An advancing world cannot start the paused audit');
    // Execute the actual generated helper against current rendered observer text.
    // This small DOM contract is not native rendering evidence.
    class Node {
      constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.textContent='';}
      append(node){this.children.push(node);} replaceChildren(){this.children=[];} setAttribute(){}
      get text(){return this.textContent+' '+this.children.map(child=>child.text).join(' ');}
    }
    const document={createElement(tag){return new Node(tag,this);}},root=new Node('div',document);
    const names=['aster','mira'],characters=names.map((_,index)=>createCharacterMessageLearner({seed:211,ownerSerial:index+1}));
    for(let index=0;index<2;index++)characters[index].reconcilePartners([{token:{},agentId:names[1-index],serial:2-index}]);
    const fresh={phase:'private-character-message',elapsed:0,exchanges:0,updates:0,pending:0,observed:0,evidenceAdditions:0,correctionAttempts:0,supportUpdates:0,conflicts:0,
      sequenceListenerUpdates:0,sequenceSenderUpdates:0,sequenceAmbiguousLabels:0,sequenceListenerRejected:0,
      latest:null,observationEvents:[],ledger:[],senderFeedback:[],
      learners:names.map((agentId,index)=>({agentId,identity:index+1,...createVisualReferenceMemory().snapshot(),character:characters[index].snapshot()}))};
    renderLearningView(root,fresh,'aster');
    assert.doesNotThrow(()=>sandbox.disclosureAssert(root.text));
    for(const phrase of ['Letter strings below are exact emissions with no supplied English translation.',
      'private character models and bounded own-view examples save locally per individual.',
      'Legacy symbol associations remain archival.',
      'The emitted letters and recipient actions below are observations, not English object names or proof of understanding.',
      'Sender feedback is own-view visual similarity, not bodily reward.',
      'These do not train or name the character messages.'])
      assert.throws(()=>sandbox.disclosureAssert(root.text.replace(phrase,'')),{code:'ERR_ASSERTION'},phrase);
    assert(root.text.includes('No character message involving this agent yet.'), 'Fresh main world has no fabricated dialogue');
    assert.throws(()=>sandbox.disclosureAssert('Bodies and memories save locally. Communication weights restart on app reopen.'),{code:'ERR_ASSERTION'});
    const checkMemory=value=>vm.runInNewContext('emptyMemoryAssert('+JSON.stringify(value)+')',sandbox);
    assert.doesNotThrow(()=>checkMemory(fresh));
    for(const corrupt of [
      value=>{value.phase='private-visual-association';},
      value=>{value.learners[0].counts.examples=1;},
      value=>{value.learners[0].anchors.push({symbol:1,features:[]});},
      value=>{value.learners[0].partners.push({slot:0,entries:[]});},
      value=>{delete value.learners[0].anchors;},
      value=>{delete value.learners[0].partners;},
      value=>{delete value.learners;},
      value=>{value.learners.pop();},
      value=>{value.learners[1].identity=value.learners[0].identity;},
      value=>{delete value.learners[0].character;},
      value=>{value.learners[0].character.senderUpdates=1;},
      value=>{value.learners[0].character.listenerUpdates=1;},
      value=>{value.learners[0].character.uniqueDemonstrations=1;},
      value=>{value.learners[0].character.replayUses=1;},
      value=>{value.learners[0].character.partnerBanks[0].partnerId='aster';},
      value=>{value.learners[0].character.partnerBanks[0].partnerSerial=99;},
      value=>{value.learners[0].character.partnerBanks[0].retainedExamples=1;},
      value=>{value.learners[0].character.partnerBanks[0].trained=true;},
      value=>{value.observationEvents.push({status:'observed'});},
      value=>{value.ledger.push({status:'observed'});},
      value=>{value.senderFeedback.push({signal:'match'});},
      value=>{value.pending=1;},
      value=>{value.sequenceListenerUpdates=1;},
      value=>{value.sequenceSenderUpdates=1;},
      value=>{value.sequenceAmbiguousLabels=1;},
      value=>{value.sequenceListenerRejected=1;},
    ]){const changed=structuredClone(fresh);corrupt(changed);assert.throws(()=>checkMemory(changed),{code:'ERR_ASSERTION'});}

    // Execute actual generated observer assertions and DOM helper against the
    // real view + observer module. This is a DOM contract, not native evidence.
    class ObserverNode {
      constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this._text='';}
      set textContent(value){this._text=value;}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
      append(child){child.parent=this;this.children.push(child);}replaceChildren(){this.children=[];}setAttribute(){}
      querySelectorAll(selector){const match=node=>selector==='[data-survival-diagnostics]'?node.dataset.survivalDiagnostics:selector==='[data-survival-decision]'?node.dataset.survivalDecision:node.tag===selector;return this.children.flatMap(child=>[...(match(child)?[child]:[]),...child.querySelectorAll(selector)]);}
      querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
      click(){assert.equal(this.tag,'summary');this.parent.open=!this.parent.open;}
      scrollIntoView(){this.scrolled=true;}focus(){this.ownerDocument.activeElement=this;}
    }
    const observerDocument={createElement(tag){return new ObserverNode(tag,this);}},messages=new ObserverNode('div',observerDocument),controls={
      'npc-panel':{classList:{contains:()=>false}},'npc-tab-conversation':{click(){}},'journal-messages':messages};
    observerDocument.getElementById=id=>{assert(controls[id],id);return controls[id];};sandbox.document=observerDocument;
    const actor={id:'aster',epoch:1,elapsed:10,discovery:{},physiology:{profile:'human',satietyHours:0,availableEnergyKcal:320,storedEnergyKcal:83000,health:99,totals:{ingestedKcal:95,absorbedKcal:40,metabolizedKcal:80}},stats:{independentMeals:3,independentDrinks:2}};
    const world={selectedAgentId:'aster',elapsed:10,agents:[actor]},unchanged=structuredClone(world);
    const draw=observer=>{renderLearningView(messages,fresh,'aster','',[],observer);return sandbox.presentObserver();};
    const checkObserver=(observer,rendered,empty=false)=>vm.runInNewContext('observerAssert('+[observer,world,rendered,empty].map(value=>JSON.stringify(value)).join(',')+')',sandbox);
    let observer=survivalDecisionSnapshot(actor),rendered=draw(observer);assert.doesNotThrow(()=>checkObserver(observer,rendered,true));
    for(let i=0;i<10;i++){const token=beginSurvivalDecision(actor,{});noteSurvivalDecision(token,'visit:urgent-food');noteSurvivalDecision(token,'food:urgent-candidates',0);finishSurvivalDecision(token,{type:'sample'},{action:{type:'rest'},need:'rest'},'food');}
    observer=survivalDecisionSnapshot(actor);rendered=draw(observer);assert.equal(rendered.rows.length,8);assert.equal(rendered.rows[0].sequence,'10');assert.doesNotThrow(()=>checkObserver(observer,rendered));
    assert.throws(()=>checkObserver(observer,rendered,true),{code:'ERR_ASSERTION'});
    for(const corrupt of [value=>{value.body.availableEnergyKcal++;},value=>{value.counters={};},value=>{value.gateCounts={};},value=>{value.records.at(-1).actualType='sample';},value=>{value.records.at(-1).phases.ordinaryFood='entered';},value=>{value.records.at(-1).at=20;},value=>{value.records.at(-1).notes[0].count=9;},value=>{value.records=Array(65).fill(value.records[0]);}]){const changed=structuredClone(observer);corrupt(changed);assert.throws(()=>checkObserver(changed,rendered),{code:'ERR_ASSERTION'});}
    for(const corrupt of [value=>{value.text=value.text.replace('not whole meals','whole meals');},value=>{value.rows.pop();},value=>{value.rows[0].sequence='999';},value=>{value.rows[0].text=value.rows[0].text.replace('selected action: rest','selected action: sample');},value=>{value.rows[0].noteCounts[0]=5;}]){const changed=structuredClone(rendered);corrupt(changed);assert.throws(()=>checkObserver(observer,changed),{code:'ERR_ASSERTION'});}
    assert.deepEqual(world,unchanged,'Rendered instrumentation cannot mutate the actor');
    const boundary={world,reference:fresh,observer,saved:JSON.stringify(world)};
    const readOnly=after=>vm.runInNewContext('observerReadOnlyAssert('+JSON.stringify(boundary)+','+JSON.stringify(after)+')',sandbox);
    assert.doesNotThrow(()=>readOnly(boundary));
    for(const corrupt of [value=>{value.world.elapsed++;},value=>{value.world.agents[0].physiology.availableEnergyKcal--;},value=>{value.reference.pending++;},value=>{value.observer.counters.begun++;},value=>{value.saved+=' ';}]){const changed=structuredClone(boundary);corrupt(changed);assert.throws(()=>readOnly(changed),{code:'ERR_ASSERTION'});}

    assert.equal(loaded.length, 1, 'Actual application scheme registration remains synchronous');
    for (const contract of [
      'Independent reopen preserves exact ordinary bytes', 'Inspector does not suppress ordinary autosave writes',
      'Main world advances while inspector is open', 'Native Escape pauses the one main world',
      'Normal save works while inspector is open', 'Closing inspector preserves main learners',
      'Inspector reopen retains learning rather than creating agents',
      'Fresh individual has one private untrained partner bank', 'Main clock resumes saved time, not experiment time',
      'Explicit reset creates fresh ordinary world', 'Reset clears pending character transactions',
      'Archival private anchors remain empty','Archival private partner examples remain empty',
      'Session-only diagnostics restart empty','Ordinary bounded interval produced actual diagnostic records',
      "auditSurvivalObserver(win,'initial',true)","auditSurvivalObserver(win,'reopen',true)","auditSurvivalObserver(win,'reset',true)","auditSurvivalObserver(win,'paused')",
      'captureWithReadiness({', 'win.webContents.sendInputEvent', 'prefs.sandbox, true',
    ]) assert(source.includes(contract), contract);
    const archive = JSON.parse(await readFile(join(prepared.output, 'profile-evidence.json'), 'utf8'));
    assert.equal(archive.nativeExecutionPerformed, false); assert.equal(archive.copiedAfterProcessesClosed, false);
    const workflow = await readFile(new URL('../.github/workflows/communication-native.yml', import.meta.url), 'utf8');
    assert.match(workflow, /ubuntu-22.04, macos-latest/); assert.doesNotMatch(workflow, /--no-sandbox|--disable-setuid-sandbox/);
    passed = true;
  } finally { if (passed) await rm(output, { recursive: true, force: true }); else console.error('Failed preparation retained at ' + output); }
});

test('comparison preparation fixes protocol bounds and actual Canvas imports without native launch', async () => {
  const output = await mkdtemp(join(tmpdir(), 'communication-comparison-contract-'));
  let passed = false;
  try {
    const result = spawnSync(process.execPath, ['scripts/compare-communication-native.mjs', '--prepare-only'], {encoding:'utf8',timeout:120000,env:{...process.env,AINCRAD_COMMUNICATION_COMPARISON_OUTPUT:output}});
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(result.stdout.trim());
    assert.equal(manifest.nativeExecutionPerformed,false);assert.equal(manifest.trials.length,6);
    assert.equal(manifest.execution.verified,false);assert.equal(manifest.execution.authorizedForBehavior,false);
    assert.deepEqual(manifest.protocol,{seeds:[211,223,227],arms:[true,false],horizon:600,dt:.25,trialWallMs:600000,totalWallMs:3900000,artifactBytes:262144000,noWarmStart:true});
    assert(manifest.trials.every(t=>t.status==='not-started'));
    const syntax=spawnSync(process.execPath,['--check',manifest.harness],{encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
    const source=await readFile(manifest.harness,'utf8');
    for(const item of ['createCommunicationPixelSensor(document)','createCommunicationExperiment({geometry','import(\'./src/communication-pixels.js\')','Comparison never writes ordinary save','beforeDisposal','Artifact cap reached'])assert(source.includes(item),item);
    assert.doesNotMatch(source,/from .*fixture|warmStart|loadWeights/);
    passed=true;
  } finally {if(passed)await rm(output,{recursive:true,force:true});else console.error('Comparison preparation retained at '+output);}
});

test('behavioral comparison has one exact branch-create gate and no dispatch path', async () => {
  const workflow=await readFile(new URL('../.github/workflows/communication-native.yml', import.meta.url),'utf8');
  assert.match(workflow,/  create:\n/);
  assert.doesNotMatch(workflow,/workflow_dispatch|run_comparison/);
  assert.match(workflow,/if: github.event_name == 'create' && github.event.ref_type == 'branch' && github.event.ref == 'experiments\/communication-bridge-v1-once' && github.ref == 'refs\/heads\/experiments\/communication-bridge-v1-once' && github.run_attempt == 1/);
  assert.match(workflow,/isolated-communication-ui:\n    if: github.event_name != 'create'/);
  assert.match(workflow,/group: communication-bridge-v1-once\n      cancel-in-progress: false/);
  assert.equal((workflow.match(/ref: \$\{\{ github.sha \}\}/g)||[]).length,2);
});

test('real comparison metadata rejects missing, mismatched or repeated execution before launch', async () => {
  const source=await readFile(new URL('../scripts/compare-communication-native.mjs',import.meta.url),'utf8');
  const validator=source.slice(source.indexOf('function validateComparisonExecution('),source.indexOf('const sourceIdentity='));
  const validate=vm.runInNewContext(validator+';validateComparisonExecution',{assert});
  const sha='a'.repeat(40);
  const valid={GITHUB_EVENT_NAME:'create',AINCRAD_COMPARISON_REF_TYPE:'branch',AINCRAD_COMPARISON_EVENT_REF:'experiments/communication-bridge-v1-once',GITHUB_REF:'refs/heads/experiments/communication-bridge-v1-once',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'1234',AINCRAD_COMPARISON_EXPECTED_SHA:sha,GITHUB_SHA:sha};
  assert.equal(validate(valid,sha).verified,true);
  for(const key of Object.keys(valid)){const missing={...valid};delete missing[key];assert.throws(()=>validate(missing,sha),key);}
  for(const [key,value] of [['GITHUB_EVENT_NAME','push'],['AINCRAD_COMPARISON_REF_TYPE','tag'],['AINCRAD_COMPARISON_EVENT_REF','other'],['GITHUB_REF','refs/heads/main'],['GITHUB_RUN_ATTEMPT','2'],['GITHUB_SHA','b'.repeat(40)]])assert.throws(()=>validate({...valid,[key]:value},sha),key);
  assert.throws(()=>validate(valid,'b'.repeat(40)));
  assert.match(source,/if\(!prepareOnly\)assert.equal\(built.sourceFingerprint,EXPECTED_SOURCE_FINGERPRINT/);
  assert.match(source,/0797f513343ab4e3d86134ffa7eb768d5a3d2a39c2246303320fcdfc46a8d25f/);
});


test('reset navigation catch tolerates only context-loss errors and still awaits native reload', async () => {
  const source = await readFile(new URL('../scripts/verify-communication-desktop.mjs', import.meta.url), 'utf8');
  const match = source.match(/await click\(win, 'reset-confirm'\)\.catch\((error => \{[\s\S]*?\})\);/);
  assert(match, 'Explicit reset evaluation has a narrow navigation-error catch');
  const handler = vm.runInNewContext('(' + match[1] + ')');
  for (const message of ['Execution context was destroyed', 'Navigation interrupted evaluation']) assert.doesNotThrow(() => handler(new Error(message)));
  const ordinary = new Error('Reset write failed');
  assert.throws(() => handler(ordinary), error => error === ordinary);
  const afterClick = source.slice(source.indexOf(match[0]) + match[0].length);
  assert.match(afterClick, /^\s*await Promise\.race\(\[reloaded,/);
});
