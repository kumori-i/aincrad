import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as V2}
  from '../scripts/character-ordinary-diagnostic-v2-protocol.mjs';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P}
  from '../scripts/character-ordinary-motor-v3-protocol.mjs';
import {characterPilotTerminalCauses,generatedCharacterPilotObserver,
  main,readExternalCharacterPilotReceipt,validateCharacterPilotActivation}
  from '../scripts/prepare-character-ordinary-motor-v3.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const commit='a'.repeat(40),tree='b'.repeat(40),receiptCommit='c'.repeat(40);
const hashes=Object.fromEntries(['sourceManifestSha256','protocolSha256',
  'runnerSha256','generatedRunnerSha256','runtimeFingerprint','rendererManifestSha256']
  .map((key,index)=>[key,(index+1).toString(16).repeat(64)]));
const activationEnv=()=>({GITHUB_ACTIONS:'true',GITHUB_WORKFLOW:P.workflow,
  GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+P.activationRef,
  GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'400',GITHUB_SHA:commit,DISPLAY:':91',
  AINCRAD_CHARACTER_MOTOR_V3_RECEIPT_REF:'refs/heads/'+P.receiptRef,
  AINCRAD_CHARACTER_MOTOR_V3_RECEIPT_COMMIT:receiptCommit});

test('motor v3 runner is a separate inert source and exact approved-create gate',()=>{
  assert.notEqual(P.id,V2.id);assert.notEqual(P.activationRef,V2.activationRef);
  assert.notEqual(P.receiptRef,V2.receiptRef);assert.notEqual(P.workflow,V2.workflow);
  assert.equal(P.targetSeconds,1200);assert.equal(P.pollWallMs,1000);
  assert.equal(P.detailSeconds,10);assert.equal(P.wallLimitMs,30*60*1000);
  assert.equal(P.structuredBytes,32*1024*1024);
  assert.equal(P.mediaBytes,16*1024*1024);
  assert.equal(P.terminalReserveBytes,256*1024);
  assert.equal(P.maxIpcBytes,256*1024);assert.equal(P.stopGraceMs,5000);
  const source=generatedCharacterPilotObserver();
  new vm.Script(source,{filename:'motor-observer.cjs'});
  for(const required of ['guardFreshCharacterMotorPilot','projectCharacterPilot',
    'validateCharacterPilotProjection','createCharacterPilotSchedule',
    'pauseOnce','simulation-target'])
    assert(source.includes(required),required);
  assert(!/\.referenceFixture\(|\.step\(|\.auditAssociation\(|nextDecisionAt\s*=/.test(source),
    'Ordinary observer must not own the fixture clock or alter agent policy');
});

test('motor v3 activation requires exact separate receipt, source hashes and host',()=>{
  const env=activationEnv(),event={ref_type:'branch',ref:P.activationRef};
  const identity={commit,tree,worktreeStatus:''},host={platform:'linux',arch:'x64',uid:1000};
  const receipt={schema:1,approved:true,protocol:P.id,activationRef:P.activationRef,
    commit,tree,...hashes,reviewedBy:'Independent reviewer',reviewedAt:'2026-10-31T00:00:00Z'};
  const actual={...hashes,receiptSha256:'f'.repeat(64)};
  const verify=(e=env,ev=event,r=receipt,h=actual,hostInfo=host)=>
    validateCharacterPilotActivation(e,ev,identity,r,h,hostInfo);
  assert.equal(verify().verified,true);
  for(const [e,ev,r,h,hostInfo] of [
    [{...env,GITHUB_WORKFLOW:V2.workflow},event,receipt,actual,host],
    [{...env,GITHUB_REF:'refs/heads/'+V2.activationRef},event,receipt,actual,host],
    [{...env,AINCRAD_CHARACTER_MOTOR_V3_RECEIPT_REF:'refs/heads/'+V2.receiptRef},event,receipt,actual,host],
    [{...env,AINCRAD_CHARACTER_MOTOR_V3_RECEIPT_COMMIT:'bad'},event,receipt,actual,host],
    [env,{...event,ref:V2.activationRef},receipt,actual,host],
    [env,event,{...receipt,approved:false},actual,host],
    [env,event,{...receipt,protocol:V2.id},actual,host],
    [env,event,{...receipt,activationRef:V2.activationRef},actual,host],
    [env,event,receipt,{...actual,runnerSha256:'0'.repeat(64)},host],
    [{...env,GITHUB_RUN_ATTEMPT:'2'},event,receipt,actual,host],
    [env,event,receipt,actual,{...host,uid:0}],
    [env,event,receipt,actual,{...host,platform:'darwin'}],
  ])assert.throws(()=>verify(e,ev,r,h,hostInfo));
});

test('motor v3 external receipt is bounded and terminal causes preserve first observation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aincrad-motor-v3-receipt-test-'));
  try{
    const path=join(root,'receipt.json'),bytes=Buffer.from('{"schema":1,"approved":false}\n');
    await writeFile(path,bytes);
    const read=await readExternalCharacterPilotReceipt(path);
    assert.equal(read.sha256,sha(bytes));assert.equal(read.receipt.approved,false);
    await writeFile(path,Buffer.alloc(16*1024+1));
    await assert.rejects(readExternalCharacterPilotReceipt(path));
    assert.deepEqual(characterPilotTerminalCauses({stopping:{reason:'simulation-target'},
      ordinaryStarted:true,error:'renderer fault'}),['simulation-target','observer-fault']);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('motor v3 prepare-only produces a bounded unapproved candidate without native launch',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-motor-v3-prepare-test-'));
  try{
    const result=await main(['--prepare-only'],{...process.env,
      AINCRAD_CHARACTER_MOTOR_V3_OUTPUT:scratch});
    assert.equal(result.prepared,true);assert.equal(result.executed,false);
    const candidate=JSON.parse(await readFile(join(result.output,'candidate.json'),'utf8'));
    const manifest=await readFile(join(result.output,'source-manifest.json'));
    const generated=await readFile(join(result.output,'observer.cjs'),'utf8');
    assert.equal(candidate.protocol.id,P.id);
    assert.equal(candidate.sourceDirty,execFileSync('git',['status','--porcelain'],{
      cwd:new URL('../',import.meta.url),encoding:'utf8'}).trim()!=='');
    assert.equal(candidate.nativeExecutionAttempted,false);
    assert.equal(candidate.nativeExecutionPerformed,false);
    assert.equal(candidate.activationBound,false);
    assert.equal(candidate.receiptTemplate.approved,false);
    assert.equal(candidate.receiptTemplate.activationRef,P.activationRef);
    assert.equal(candidate.hashes.sourceManifestSha256,sha(manifest));
    assert.equal(candidate.hashes.generatedRunnerSha256,sha(generated));
    assert.equal(candidate.hashes.protocolSha256,sha(await readFile(new URL(
      '../scripts/character-ordinary-motor-v3-protocol.mjs',import.meta.url))));
    assert.equal(generated,generatedCharacterPilotObserver());
    new vm.Script(generated,{filename:'motor-observer.cjs'});
  }finally{await rm(scratch,{recursive:true,force:true});}
});
