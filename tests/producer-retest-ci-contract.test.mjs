import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{gzipSync}from'node:zlib';import{spawnSync}from'node:child_process';
import{PRODUCER_RETEST_CI_PROTOCOL as P}from'../scripts/producer-retest-ci-protocol.mjs';
import{validateBaseline,extractBaseline,sourceFingerprint,validateArmArguments}from'../scripts/producer-retest-ci-source.mjs';
import{sha256,namespaceComparable,NORMALIZED_PATHS}from'../scripts/producer-retest-ci-namespace.mjs';
const archive=readFileSync(new URL('./fixtures/producer-retest-baseline-v1.json.gz',import.meta.url));
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:P.workflow});
const modified=fn=>{const data=structuredClone(validateBaseline(archive));fn(data);const bytes=gzipSync(Buffer.from(JSON.stringify(data)));return [bytes,sha256(bytes)];};
test('frozen fresh seed and immutable baseline bytes extract exact same source, no simulation',()=>{
 assert.equal(P.seed,77201);assert.equal(P.seconds,1200);assert.equal(P.fixedStep,1/60);assert.equal(sha256(archive),P.baselineArchiveSha256);assert.equal(sourceFingerprint(resolve('.')),P.candidateSource);
 const dir=mkdtempSync(join(tmpdir(),'producer-source-'));try{const root=extractBaseline(archive,dir);assert.equal(sourceFingerprint(root),P.baselineSource);assert.equal(JSON.parse(readFileSync(join(root,'package.json'))).type,'module');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('tampered archive, path traversal, duplicates, nonmodule package, missing and extra sources fail closed',()=>{
 const damaged=Buffer.from(archive);damaged[10]^=1;assert.throws(()=>validateBaseline(damaged));
 for(const path of ['../escape.js','src/../escape.js','src\\escape.js','/tmp/escape.js','src/.hidden.js'])assert.throws(()=>validateBaseline(...modified(d=>{d.files[path]={content:'x',sha256:sha256('x')};})));
 assert.throws(()=>validateBaseline(...modified(d=>{delete d.files['src/config.js'];})));
 assert.throws(()=>validateBaseline(...modified(d=>{d.files['src/extra.js']={content:'x',sha256:sha256('x')};})));
 assert.throws(()=>validateBaseline(...modified(d=>{d.files['package.json']={content:'{"type":"commonjs"}',sha256:sha256('{"type":"commonjs"}')};})));
 const text=JSON.stringify(validateBaseline(archive)).replace('"version":1','"version":1,"version":1'),bytes=gzipSync(text);assert.throws(()=>validateBaseline(bytes,sha256(bytes)),/duplicate/);
 assert.throws(()=>validateBaseline(gzipSync(Buffer.alloc(9*1024*1024)),sha256(gzipSync(Buffer.alloc(9*1024*1024)))));
});
test('symlink source and extraction parent are forbidden',()=>{
 const dir=mkdtempSync(join(tmpdir(),'producer-links-'));try{mkdirSync(join(dir,'real'));symlinkSync(join(dir,'real'),join(dir,'alias'));assert.throws(()=>extractBaseline(archive,join(dir,'alias')));symlinkSync(join(dir,'real'),join(dir,'src'));assert.throws(()=>sourceFingerprint(dir));rmSync(join(dir,'src'));mkdirSync(join(dir,'src'));writeFileSync(join(dir,'file.js'),'x');symlinkSync(join(dir,'file.js'),join(dir,'src','a.js'));assert.throws(()=>sourceFingerprint(dir));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('arm admission is exact CI context, source pair, new seed and candidate initial matching',()=>{
 const args=['/source','/out/baseline-77201','77201',P.baselineSource];assert.equal(validateArmArguments(args,env()).arm,'baseline');
 assert.equal(validateArmArguments(['/source','/out/candidate-77201','77201',P.candidateSource,'a'.repeat(64)],env()).arm,'candidate');
 for(const k of Object.keys(env()))assert.throws(()=>validateArmArguments(args,{...env(),[k]:'other'}));
 for(const seed of ['74201','74203','74205','75211','76201','77202'])assert.throws(()=>validateArmArguments([args[0],args[1],seed,args[3]],env()));
 assert.throws(()=>validateArmArguments(['/source','/out/candidate-77201','77201',P.candidateSource],env()));assert.throws(()=>validateArmArguments([...args,'a'.repeat(64)],env()));
 const run=spawnSync(process.execPath,['scripts/producer-retest-ci-arm.mjs',...args],{env:{...process.env,GITHUB_ACTIONS:'false'},encoding:'utf8'});assert.notEqual(run.status,0,'local invocation refused before source or simulation');
});
test('namespace comparison is detached and exactly four equal UUID bindings',()=>{
 const value={worldLineage:{instanceId:'12345678-1234-4234-8234-123456789abc'},visualReference:{worldId:'12345678-1234-4234-8234-123456789abc'},characterMessages:{worldId:'12345678-1234-4234-8234-123456789abc'},playerLessons:{worldId:'12345678-1234-4234-8234-123456789abc'},rng:123};const before=JSON.stringify(value),copy=namespaceComparable(value);assert.equal(JSON.stringify(value),before);assert.equal(copy.rng,123);assert.equal(NORMALIZED_PATHS.length,4);value.playerLessons.worldId='other';assert.throws(()=>namespaceComparable(value));
});
test('workflow and coordinator preserve one-shot, no retry and durable artifact contract',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/producer-retest-ci-v1-once.yml',import.meta.url),'utf8'),run=readFileSync(new URL('../scripts/producer-retest-ci-run.mjs',import.meta.url),'utf8'),arm=readFileSync(new URL('../scripts/producer-retest-ci-arm.mjs',import.meta.url),'utf8');
 assert.match(workflow,/on: create/);assert.match(workflow,/github.run_attempt == 1/);assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/contents: read/);assert.match(workflow,/actions: read/);assert.match(workflow,/if: always\(\)/);assert.doesNotMatch(workflow,/workflow_dispatch|contents: write|actions: write|macos|--no-sandbox/);
 assert.ok(run.indexOf('await verifyProducerRetestRunHistory()')<run.indexOf('extractBaseline(readFileSync'));assert.match(run,/delete childEnv.GITHUB_TOKEN/);assert.match(run,/Evaluation source changed/);assert.match(run,/timeout:24\*60\*1000/);assert.equal((run.match(/env:childEnv/g)||[]).length,2);assert.ok(readFileSync(new URL('../scripts/producer-retest-ci-v1-protocol.md',import.meta.url)).length>0);assert.match(run,/flag:'wx'/);assert.match(arm,/captureInquiry\(n\)/);assert.ok(arm.indexOf('agents:state.agents.map')<arm.indexOf('runtime.dispose()'));assert.doesNotMatch(arm,/loadOzarkSave/);
});
