import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {initialReferenceRandomStates} from '../src/visual-reference-random.js';

test('character-message native preparation is isolated, sandbox-preserving and never claims native execution',async()=>{
  const output=await mkdtemp(join(tmpdir(),'visual-reference-harness-contract-'));let passed=false;
  try{
    const result=spawnSync(process.execPath,['scripts/verify-visual-reference-desktop.mjs','--prepare-only'],{encoding:'utf8',timeout:120000,
      env:{...process.env,AINCRAD_VISUAL_REFERENCE_QA_OUTPUT:output}});
    assert.equal(result.status,0,result.stderr);const prepared=JSON.parse(result.stdout.trim());
    assert.equal(prepared.nativeExecutionPerformed,false);assert.deepEqual(prepared.sandboxBypassFlags,[]);
    assert.deepEqual(prepared.phases,['exercise','reopen','verify']);assert.match(prepared.harnessSha256,/^[a-f0-9]{64}$/);
    const location=relative(await realpath(output),prepared.application);assert(location&&!isAbsolute(location)&&location!=='..'&&!location.startsWith('../'));
    await assert.rejects(access(join(prepared.output,'result.json')));
    const syntax=spawnSync(process.execPath,['--check',prepared.harness],{encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
    const source=await readFile(prepared.harness,'utf8'),app=new EventEmitter(),loaded=[],require=createRequire(import.meta.url);
    const stub=name=>name==='electron'?{app,session:{}}:name.endsWith('main.cjs')?loaded.push(name):require(name);
    const sandbox={require:stub,process:{argv:['runner','--phase=exercise']},console,setTimeout:()=>1,clearTimeout(){}};
    // Capture the actual generated helper, not a test reimplementation. It is
    // constructed outside installRunner and must retain its own assert binding.
    vm.runInNewContext(source.replace('// Production asset scheme and profile registration remain synchronous.',
      'globalThis.serializedHistoryAssert = assertStructuralRestoredHistory;globalThis.presentAssociationLearning=presentAssociationLearning;globalThis.assertRetainedLearning=assertRetainedLearning;\n// Production asset scheme and profile registration remain synchronous.'),sandbox);
    assert.equal(loaded.length,1,'Production scheme/profile registration remains synchronous');
    const calls=[],nodes={
      'npc-panel':{classList:{contains:()=>!nodes.visible},dataset:{journalTab:'character'}},
      'open-npc':{click(){calls.push('open');nodes.visible=true;}},
      'npc-select':{value:'aster',dispatchEvent(event){calls.push('select:'+this.value);assert.equal(event.type,'change');assert.equal(event.bubbles,true);}},
      'npc-tab-conversation':{click(){calls.push('learning');nodes['npc-panel'].dataset.journalTab='conversation';}},
      'journal-messages':{textContent:'Observer text',scrollTop:100,querySelectorAll(){return [{textContent:'1 canonical observed demonstrations',scrollIntoView(options){assert.equal(options.block,'start');calls.push('scroll-counters');}}];}},'npc-name':{textContent:'Listener'},visible:false};
    sandbox.document={getElementById:id=>{assert(nodes[id],id);return nodes[id];}};
    sandbox.Event=class{constructor(type,options){this.type=type;Object.assign(this,options);}};
    const panel=sandbox.presentAssociationLearning('brin');
    assert.equal(panel.selected,'brin');assert.equal(panel.visible,true);assert.equal(panel.tab,'conversation');assert.equal(panel.text,'Observer text');
    assert.deepEqual(calls,['open','select:brin','learning','scroll-counters']);assert.equal(nodes['journal-messages'].scrollTop,0);
    nodes['journal-messages'].querySelectorAll=()=>[];
    assert.throws(()=>sandbox.presentAssociationLearning('brin'),/Missing actual reference counter row/);
    // DOM-control regression only: actual rendered pixels still require native CI.

    const stored={elapsed:1,environment:{elapsed:1,ecology:{elapsed:1,pending:0}},player:{x:0,y:0},playerBody:{stamina:100},
      agents:[{id:'aster',position:{x:0,y:0},elapsed:1,memory:{experience:[{id:1,type:'observation'}]}}]};
    const restored={elapsed:1,clocks:{environmentElapsed:1,ecologyElapsed:1,ecologyPending:0},player:{x:0,y:0},playerBody:{stamina:100},
      agents:[{id:'aster',position:{x:0,y:0},elapsed:1,active:null,memory:{experience:[{id:1,type:'observation'}]}}]};
    const runHistory=actual=>vm.runInNewContext('serializedHistoryAssert('+JSON.stringify(stored)+','+JSON.stringify(actual)+')',sandbox);
    assert.doesNotThrow(()=>runHistory(restored),'Generated reopen helper must resolve imported assertions');
    assert.throws(()=>runHistory({...restored,elapsed:2}),{code:'ERR_ASSERTION'},'Reopen time mismatch must still fail closed');
    const changed=structuredClone(restored);changed.agents[0].memory.experience[0].type='fabricated';
    assert.throws(()=>runHistory(changed),{code:'ERR_ASSERTION'},'Existing canonical history must remain exact');
    const learners=[
      {agentId:'aster',identity:1,anchors:[{symbol:3,features:[.1]}],partners:[],counts:{anchors:1,examples:0},
        character:{senderUpdates:0,listenerUpdates:0,uniqueDemonstrations:0,replayUses:0,partnerBanks:[]}},
      {agentId:'mira',identity:2,anchors:[],partners:[{slot:0,entries:[{symbol:3,examples:[[.2]],support:1,conflicted:false}]}],counts:{anchors:0,examples:1},
        character:{senderUpdates:0,listenerUpdates:1,uniqueDemonstrations:1,replayUses:0,
          partnerBanks:[{partnerId:'aster',partnerSerial:1,retainedExamples:1,trained:true}]}},
    ];
    const emptyMetrics={exchanges:0,completed:0,observed:0,correct:0,censored:0,updates:0,
      feedbackMatched:0,feedbackMismatched:0,feedbackCensored:0,senderFeedback:[],
      correctionAttempts:0,evidenceAdditions:0,supportUpdates:0,conflicts:0,pending:0,observationEvents:[],learners,latest:null};
    const original={learners,latest:{receiverId:'mira'}};
    const runRetained=(reference,saved)=>vm.runInNewContext(
      'assertRetainedLearning('+JSON.stringify(reference)+','+JSON.stringify(saved)+',"test reopen")',sandbox);
    assert.doesNotThrow(()=>runRetained(emptyMetrics,{report:{reference:original}}),
      'First reopen retains one private example without replayed metrics');
    const secondReport={report:{reference:emptyMetrics,checks:{secondLabel:{demonstrations:1,optimizerSteps:1,replayUses:0}}}};
    assert.doesNotThrow(()=>runRetained(emptyMetrics,secondReport),
      'Second reopen validates the saved report and exact physical example, optimizer, and replay counts');
    const lost=structuredClone(emptyMetrics);lost.learners[1].character.uniqueDemonstrations=0;
    assert.throws(()=>runRetained(lost,{report:{reference:original}}),{code:'ERR_ASSERTION'},
      'A lost example fails the generated native assertion');
    for(const field of ['uniqueDemonstrations','listenerUpdates','replayUses']){
      const wrong=structuredClone(emptyMetrics);wrong.learners[1].character[field]++;
      assert.throws(()=>runRetained(wrong,{report:{reference:wrong,checks:secondReport.report.checks}}),{code:'ERR_ASSERTION'},
        'Second reopen rejects an extra '+field+' even when the saved learner summary agrees');
    }
    for(const contract of ['Install fixture on actual fresh main population','Fixture owns the sole manual clock','Fresh fixture installer is one-use',
      'Native audit uses actual current Canvas crops','Independent reopen reads exact saved mid-action bytes',
      'Repeated reopen cannot duplicate interruption or revive authority','Loaded profile cannot obtain fresh fixture authority',
      'Application uses exact isolated disposable test profile','retains private learned sequence state and legacy association history',
      "assertRetainedLearning(reference,saved,'First independent reopen')",
      "assertRetainedLearning(reference,saved,'Second independent reopen')",
      'assertReopenedCharacter(','private numeric listener must remain candidate-order equivariant',
      'No vocabulary, grammar, generalization',
      'The numeric listener label must use exactly the received string',
      'One authentic paid sender-local outcome must update only its original on-policy sender once',
      'Second optional listener choice unavailable after cooldown',
      'second-listener-label-audit.json','secondListenerPhysicalDemonstrations',
      'characterMessages','modelStateSha256','[data-character-message="true"]',
      '04b0-exact-message-and-paid-recipient-action.png',
      'Copied original paid inspection receipt cannot create a new indication permit',
      'Second independent reopen retains exact live model weights, counters and RNG states',
      'Opening Learning may change only observer selection, not the world','Learning open/capture/close leaves reference snapshot exact',
      '04b-learning-character-counters.png','04c-learning-own-demonstration-provenance.png','character-learning-view.json','character-model-audit.json','timestampedPairSha256','captureWithReadiness({','prefs.sandbox,true'])assert(source.includes(contract),contract);
    const archive=JSON.parse(await readFile(join(prepared.output,'profile-evidence.json'),'utf8'));
    assert.equal(archive.nativeExecutionPerformed,false);assert.equal(archive.copiedAfterProcessesClosed,false);
    const workflow=await readFile(new URL('../.github/workflows/visual-reference-native.yml',import.meta.url),'utf8');
    assert.match(workflow,/ubuntu-22.04, macos-latest/);assert.doesNotMatch(workflow,/--no-sandbox|--disable-setuid-sandbox|\n  create:|experiments\//);
    const runner=await readFile(new URL('../scripts/verify-visual-reference-desktop.mjs',import.meta.url),'utf8');
    assert.match(runner,/Native execution requires the approved engineering CI workflow/);assert.match(runner,/Native CI must exercise the exact approved checkout SHA/);
    passed=true;
  }finally{if(passed)await rm(output,{recursive:true,force:true});else console.error('Failed preparation retained at '+output);}
});

test('response lifecycle native preparation keeps a separate profile and three-process CI plan without launching Electron',async()=>{
  const output=await mkdtemp(join(tmpdir(),'visual-response-harness-contract-'));let passed=false;
  try{
    const result=spawnSync(process.execPath,['scripts/verify-visual-reference-desktop.mjs','--prepare-only','--response-scenario'],
      {encoding:'utf8',timeout:120000,env:{...process.env,AINCRAD_VISUAL_REFERENCE_QA_OUTPUT:output}});
    assert.equal(result.status,0,result.stderr);
    const prepared=JSON.parse(result.stdout.trim());
    assert.equal(prepared.responseScenario,true);assert.equal(prepared.nativeExecutionPerformed,false);
    assert.deepEqual(prepared.phases,['response-exercise','response-reopen','response-verify']);
    assert.deepEqual(prepared.sandboxBypassFlags,[]);
    const location=relative(await realpath(output),prepared.application);
    assert(location&&!isAbsolute(location)&&location!=='..'&&!location.startsWith('../'));
    await assert.rejects(access(join(prepared.output,'result.json')));
    const syntax=spawnSync(process.execPath,['--check',prepared.harness],{encoding:'utf8'});
    assert.equal(syntax.status,0,syntax.stderr);
    const source=await readFile(prepared.harness,'utf8');
    for(const contract of ['negativeControlSeed:212','pendingResponseForSave',
      'Original paid choice must be wrong','The paid reply points to the original choice',
      '05-second-paid-listener-response-before-save.png','listener-response',
      'Independent reopen reads exact saved mid-action bytes','Repeated reopen cannot duplicate interruption or revive authority',
      'assertRetainedLearning(reference,saved','no resurrected sender feedback',
      'Recorded sender feedback must agree with sender-only actual Canvas RMS',
      'no second sender update','second-listener-label-audit.json',
      'secondListenerPhysicalDemonstrations','secondListenerOptimizerSteps','secondListenerReplayUses'])
      assert(source.includes(contract),contract);
    const archive=JSON.parse(await readFile(join(prepared.output,'profile-evidence.json'),'utf8'));
    assert.equal(archive.nativeExecutionPerformed,false);assert.equal(archive.copiedAfterProcessesClosed,false);
    passed=true;
  }finally{if(passed)await rm(output,{recursive:true,force:true});else console.error('Failed response preparation retained at '+output);}
});

async function fixtureHook(overrides={}){
  const source=await readFile(new URL('../src/ozark-world-main.js',import.meta.url),'utf8');
  const start=source.indexOf('referenceFixture: async (install, options={}) => {');
  assert(start>=0);const end=source.indexOf('    referenceFixtureState:',start);assert(end>start);
  const installer=source.slice(start+'referenceFixture: '.length,end).trim().replace(/,$/,'');
  const state={elapsed:0,agents:[{id:'aster',epoch:1},{id:'mira',epoch:1}],worldLineage:{instanceId:'fresh-lineage'},
    visualReference:{seed:211,random:initialReferenceRandomStates(211),learners:[{anchors:[],partners:[]},{anchors:[],partners:[]}]}};
  const context={location:{search:'?test=1'},started:false,loaded:{exists:false,blocked:false},state,
    population:{state},communicationLearning:{dispose(){context.disposed++;},censorPending(){context.censored++;},createNativeAssociationAuditReader(){let read=false;return()=>{if(read)return null;read=true;context.audited++;return {copied:true};};}},storage:{getItem(){return null;}},
    OZARK_SAVE_KEY:'aincrad.world.v2',CONFIG:{fixedStep:1/60},geometry:{},renderer:{},keys:{clear(){context.cleared++;}},
    initialReferenceRandomStates,document:{},createCommunicationPixelSensor(){context.sensors++;return {capture(){return new Map();}};},
    createFreshCharacterMessages(lineage,visualReference){assert.equal(lineage,context.state.worldLineage);assert.equal(visualReference.seed,212);return {version:2,seed:212};},
    attachVisualReferenceLearning({state:attachedState,pixelSensor,seed,protocol}){context.reattached++;assert.equal(attachedState,context.state);assert(pixelSensor);assert.equal(seed,212);assert.equal(protocol,'sequence');return context.replacementReference;},
    advancePlayer(dt){assert.equal(dt,1/60);state.elapsed+=dt;},save(explicit,bypass){assert.equal(explicit,false);assert.equal(bypass,true);context.saved++;return true;},cleared:0,censored:0,saved:0,audited:0,disposed:0,sensors:0,reattached:0,...overrides};
  context.replacementReference={censorPending(){context.censored++;},createNativeAssociationAuditReader(){let read=false;return()=>{if(read)return null;read=true;return {seed:212};};}};
  const hook=Function('context',`let {location,started,loaded,state,population,communicationLearning,storage,OZARK_SAVE_KEY,CONFIG,geometry,renderer,keys,advancePlayer,save,initialReferenceRandomStates,createFreshCharacterMessages,attachVisualReferenceLearning,createCommunicationPixelSensor,document}=context;let referenceFixtureOwner=null;return {install:${installer},owner:()=>referenceFixtureOwner};`)(context);
  return {hook,context,source};
}

test('actual fresh-main fixture installer rejects other routes, existing profiles and second clock ownership',async()=>{
  for(const override of [{location:{search:'?test=1&smoke=1'}},{started:true},{loaded:{exists:true}},{loaded:{blocked:true}},
    {state:{elapsed:1}},{storage:{getItem(){return 'occupied';}}},{storage:{getItem(){throw Error('unreadable');}}}]){
    const {hook}=await fixtureHook(override);let called=false;
    assert.equal(await hook.install(()=>{called=true;}),null);assert.equal(called,false);assert.equal(hook.owner(),null);
  }
  const {hook,context,source}=await fixtureHook();let controls;
  assert.equal(await hook.install(value=>{controls=value;return true;}),true);
  assert.equal(controls.state,controls.populationState);assert.equal(controls.population,undefined);assert(Object.isFrozen(controls));
  assert.equal(context.cleared,1);assert.equal(await hook.install(()=>true),null);
  assert.deepEqual(controls.auditAssociation(),{copied:true});assert.equal(controls.auditAssociation(),null);assert.equal(context.audited,1);
  assert.equal(controls.checkpoint(),false,'No zero-work fixture checkpoint');
  for(let i=0;i<1200;i++)assert.equal(controls.step(),true);
  assert.equal(controls.step(),false);assert.equal(controls.checkpoint(),true);assert.equal(controls.checkpoint(),false);assert.equal(context.saved,1);assert.equal(hook.owner().steps,1200);assert(Math.abs(context.state.elapsed-20)<1e-7);
  assert.match(source,/if\(referenceFixtureOwner&&!referenceCheckpoint\)return false/);
  assert.match(source,/function begin\(\)\s*\{\s*if \(referenceFixtureOwner/);
  assert.match(source,/step: \(seconds[^]*?if \(referenceFixtureOwner \|\| !started/);
  assert.match(source,/running: [^\n]*!referenceFixtureOwner/);
  assert.match(source,/function fixedStep\(dt\)\s*\{\s*if\(referenceFixtureOwner\)return/);
});

test('negative-control seed is confined to a blank disposable fixture and preserves body and lineage',async()=>{
  const malformed=[null,[],{negativeControlSeed:211},{negativeControlSeed:'212'},
    {negativeControlSeed:212,extra:true},{other:212},12];
  for(const options of malformed){
    const {hook,context}=await fixtureHook();let called=false;
    assert.equal(await hook.install(()=>{called=true;},options),null);
    assert.equal(called,false);assert.equal(hook.owner(),null);
    assert.equal(context.state.visualReference.seed,211);assert.equal(context.disposed,0);
  }
  for(const override of [{location:{search:'?test=1&smoke=1'}},{loaded:{exists:true}},
    {storage:{getItem(){return 'occupied';}}}]){
    const {hook,context}=await fixtureHook(override);
    assert.equal(await hook.install(()=>true,{negativeControlSeed:212}),null);
    assert.equal(context.state.visualReference.seed,211);assert.equal(context.disposed,0);
  }
  const {hook,context}=await fixtureHook(),originalLineage=structuredClone(context.state.worldLineage),
    originalAgents=structuredClone(context.state.agents);
  let controls;
  assert.equal(await hook.install(value=>{controls=value;return true;},{negativeControlSeed:212}),true);
  assert.equal(context.disposed,1);assert.equal(context.sensors,1);assert.equal(context.reattached,1);
  assert.equal(context.state.visualReference.seed,212);
  assert.deepEqual(context.state.visualReference.random,initialReferenceRandomStates(212));
  assert.deepEqual(context.state.characterMessages,{version:2,seed:212});
  assert.deepEqual(context.state.worldLineage,originalLineage);
  assert.deepEqual(context.state.agents,originalAgents);
  assert.equal(controls.reference,context.replacementReference);
  assert.deepEqual(controls.auditAssociation(),{seed:212});assert.equal(controls.auditAssociation(),null);
  assert.equal(await hook.install(()=>true,{negativeControlSeed:212}),null);
  const occupied=await fixtureHook();occupied.context.state.visualReference.learners[0].anchors.push({symbol:1});
  await assert.rejects(occupied.hook.install(()=>true,{negativeControlSeed:212}),/fresh blank reference learner/);
  assert.equal(occupied.context.disposed,0);assert.equal(occupied.context.state.visualReference.seed,211);
  assert.equal(occupied.hook.owner().failed,true);
  const trained=await fixtureHook();trained.context.state.characterMessages={learners:[
    {sender:{emissions:1,updates:0},partners:[]}]};
  await assert.rejects(trained.hook.install(()=>true,{negativeControlSeed:212}),/fresh blank reference learner/);
  assert.equal(trained.context.disposed,0);assert.equal(trained.context.state.visualReference.seed,211);
});

test('actual fixture clock fails closed after installer/step errors and rejects reentrant stepping',async()=>{
  {
    const {hook,context}=await fixtureHook();await assert.rejects(hook.install(()=>{throw Error('install failure');}),/install failure/);
    assert.equal(hook.owner().failed,true);assert.equal(context.censored,1);assert.equal(await hook.install(()=>true),null);
  }
  {
    const {hook,context}=await fixtureHook({advancePlayer(){throw Error('step failure');}});let controls;
    await hook.install(value=>{controls=value;});assert.throws(()=>controls.step(),/step failure/);
    assert.equal(hook.owner().failed,true);assert.equal(context.censored,1);assert.equal(controls.step(),false);
  }
  {
    let controls;const state={elapsed:0};const {hook}=await fixtureHook({state,population:{state},advancePlayer(dt){assert.equal(controls.step(),false);state.elapsed+=dt;}});
    await hook.install(value=>{controls=value;});assert.equal(controls.step(),true);assert.equal(hook.owner().steps,1);
  }
});
