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
import {createVisualReferenceMemory} from '../src/visual-reference-memory.js';

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
    vm.runInNewContext(source.replace(registration,'globalThis.disclosureAssert=assertPrivateAssociationDisclosure;globalThis.emptyMemoryAssert=assertEmptyPrivateAssociations;'+registration),sandbox);
    // Execute the actual generated helper against current rendered observer text.
    // This small DOM contract is not native rendering evidence.
    class Node {
      constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.textContent='';}
      append(node){this.children.push(node);} replaceChildren(){this.children=[];} setAttribute(){}
      get text(){return this.textContent+' '+this.children.map(child=>child.text).join(' ');}
    }
    const document={createElement(tag){return new Node(tag,this);}},root=new Node('div',document);
    const fresh={phase:'private-visual-association',elapsed:0,exchanges:0,updates:0,pending:0,observed:0,evidenceAdditions:0,correctionAttempts:0,supportUpdates:0,conflicts:0,latest:null,observationEvents:[],
      learners:['aster','mira'].map(agentId=>({agentId,...createVisualReferenceMemory().snapshot()}))};
    renderLearningView(root,fresh,'aster');
    assert.doesNotThrow(()=>sandbox.disclosureAssert(root.text));
    assert.throws(()=>sandbox.disclosureAssert('Bodies and memories save locally. Communication weights restart on app reopen.'),{code:'ERR_ASSERTION'});
    const checkMemory=value=>vm.runInNewContext('emptyMemoryAssert('+JSON.stringify(value)+')',sandbox);
    assert.doesNotThrow(()=>checkMemory(fresh));
    for(const corrupt of [
      value=>{value.phase='physical-reference-no-learning';},
      value=>{value.learners[0].counts.examples=1;},
      value=>{value.learners[0].anchors.push({symbol:1,features:[]});},
      value=>{value.learners[0].partners.push({slot:0,entries:[]});},
      value=>{delete value.learners[0].anchors;},
      value=>{delete value.learners[0].partners;},
      value=>{delete value.learners;},
      value=>{value.learners.pop();},
      value=>{value.observationEvents.push({status:'observed'});},
      value=>{value.pending=1;},
    ]){const changed=structuredClone(fresh);corrupt(changed);assert.throws(()=>checkMemory(changed),{code:'ERR_ASSERTION'});}

    assert.equal(loaded.length, 1, 'Actual application scheme registration remains synchronous');
    for (const contract of [
      'Independent reopen preserves exact ordinary bytes', 'Inspector does not suppress ordinary autosave writes',
      'Main world advances while inspector is open', 'Native Escape pauses the one main world',
      'Normal save works while inspector is open', 'Closing inspector preserves main learners',
      'Inspector reopen retains learning rather than creating agents',
      'Private association counts restart empty', 'Main clock resumes saved time, not experiment time',
      'Explicit reset creates fresh ordinary world', 'Reset clears pending reference transactions',
      'Fresh private anchors are concretely empty','Fresh private partner examples are concretely empty',
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
