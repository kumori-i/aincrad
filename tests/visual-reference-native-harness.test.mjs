import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';

test('phase-A native preparation is isolated, sandbox-preserving and never claims native execution',async()=>{
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
    vm.runInNewContext(source,{require:stub,process:{argv:['runner','--phase=exercise']},console,setTimeout:()=>1,clearTimeout(){}});
    assert.equal(loaded.length,1,'Production scheme/profile registration remains synchronous');
    for(const contract of ['Install fixture on actual fresh main population','Fixture owns the sole manual clock','Fresh fixture installer is one-use',
      'Native audit uses actual current Canvas crops','Independent reopen reads exact saved mid-indication bytes',
      'Repeated reopen cannot duplicate interruption or revive authority','Loaded profile cannot obtain fresh fixture authority',
      'Application uses exact isolated disposable test profile','captureWithReadiness({','prefs.sandbox,true'])assert(source.includes(contract),contract);
    const archive=JSON.parse(await readFile(join(prepared.output,'profile-evidence.json'),'utf8'));
    assert.equal(archive.nativeExecutionPerformed,false);assert.equal(archive.copiedAfterProcessesClosed,false);
    const workflow=await readFile(new URL('../.github/workflows/visual-reference-native.yml',import.meta.url),'utf8');
    assert.match(workflow,/ubuntu-22.04, macos-latest/);assert.doesNotMatch(workflow,/--no-sandbox|--disable-setuid-sandbox|\n  create:|experiments\//);
    const runner=await readFile(new URL('../scripts/verify-visual-reference-desktop.mjs',import.meta.url),'utf8');
    assert.match(runner,/Native execution requires the approved engineering CI workflow/);assert.match(runner,/Native CI must exercise the exact approved checkout SHA/);
    passed=true;
  }finally{if(passed)await rm(output,{recursive:true,force:true});else console.error('Failed preparation retained at '+output);}
});

async function fixtureHook(overrides={}){
  const source=await readFile(new URL('../src/ozark-world-main.js',import.meta.url),'utf8');
  const start=source.indexOf('referenceFixture: async install => {');
  assert(start>=0);const end=source.indexOf('    referenceFixtureState:',start);assert(end>start);
  const installer=source.slice(start+'referenceFixture: '.length,end).trim().replace(/,$/,'');
  const state={elapsed:0},context={location:{search:'?test=1'},started:false,loaded:{exists:false,blocked:false},state,
    population:{state},communicationLearning:{censorPending(){context.censored++;}},storage:{getItem(){return null;}},
    OZARK_SAVE_KEY:'aincrad.world.v2',CONFIG:{fixedStep:1/60},geometry:{},renderer:{},keys:{clear(){context.cleared++;}},
    advancePlayer(dt){assert.equal(dt,1/60);state.elapsed+=dt;},save(explicit,bypass){assert.equal(explicit,false);assert.equal(bypass,true);context.saved++;return true;},cleared:0,censored:0,saved:0,...overrides};
  const hook=Function('context',`let {location,started,loaded,state,population,communicationLearning,storage,OZARK_SAVE_KEY,CONFIG,geometry,renderer,keys,advancePlayer,save}=context;let referenceFixtureOwner=null;return {install:${installer},owner:()=>referenceFixtureOwner};`)(context);
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
  assert.equal(controls.checkpoint(),false,'No zero-work fixture checkpoint');
  for(let i=0;i<1200;i++)assert.equal(controls.step(),true);
  assert.equal(controls.step(),false);assert.equal(controls.checkpoint(),true);assert.equal(controls.checkpoint(),false);assert.equal(context.saved,1);assert.equal(hook.owner().steps,1200);assert(Math.abs(context.state.elapsed-20)<1e-7);
  assert.match(source,/if\(referenceFixtureOwner&&!referenceCheckpoint\)return false/);
  assert.match(source,/function begin\(\)\s*\{\s*if \(referenceFixtureOwner/);
  assert.match(source,/step: \(seconds[^]*?if \(referenceFixtureOwner \|\| !started/);
  assert.match(source,/running: [^\n]*!referenceFixtureOwner/);
  assert.match(source,/function fixedStep\(dt\)\s*\{\s*if\(referenceFixtureOwner\)return/);
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
