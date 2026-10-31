import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P} from '../scripts/character-ordinary-motor-v3-protocol.mjs';
import {characterMotorV3ReceiptBlob,fetchCharacterMotorV3ReceiptRef}
  from '../scripts/character-motor-v3-receipt-ref.mjs';

const commit='a'.repeat(40),receiptCommit='b'.repeat(40),blob='c'.repeat(40);
const receipt=Buffer.from(JSON.stringify({schema:1,approved:true}));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tree=Buffer.from(`100644 blob ${blob}\treceipt.json\0`);
const env=temporary=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'create',
  GITHUB_REF:'refs/heads/'+P.activationRef,GITHUB_RUN_ATTEMPT:'1',
  GITHUB_SHA:commit,RUNNER_TEMP:temporary,GITHUB_ENV:join(temporary,'github-env')});

function fakeGit({inventory=tree,bytes=receipt,declaredSize=bytes.length,fetchError=null}={}){
  const calls=[];
  const git=args=>{
    calls.push(args);
    if(args[0]==='fetch'){
      if(fetchError)throw fetchError;
      return Buffer.alloc(0);
    }
    if(args.join(' ')==='rev-parse HEAD')return Buffer.from(commit+'\n');
    if(args.join(' ')==='rev-parse FETCH_HEAD^{commit}')return Buffer.from(receiptCommit+'\n');
    if(args[0]==='ls-tree')return inventory;
    if(args.join(' ')==='cat-file -s '+blob)return Buffer.from(String(declaredSize)+'\n');
    if(args.join(' ')==='cat-file blob '+blob)return bytes;
    throw new Error('Unexpected Git command '+args.join(' '));
  };
  return {git,calls};
}

test('receipt ref is fetched once and exact regular single-file bytes are recorded outside source',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-motor-v3-receipt-ref-'));
  try{
    const {git,calls}=fakeGit(),e=env(scratch);
    await writeFile(e.GITHUB_ENV,'');
    const result=await fetchCharacterMotorV3ReceiptRef({root:scratch,env:e,git});
    assert.deepEqual(result,{receiptRef:'refs/heads/'+P.receiptRef,
      receiptCommit,receiptSha256:sha(receipt),bytes:receipt.length});
    assert.deepEqual(await readFile(join(scratch,'aincrad-character-motor-v3-receipt.json')),receipt);
    assert.equal(await readFile(e.GITHUB_ENV,'utf8'),
      `AINCRAD_CHARACTER_MOTOR_V3_RECEIPT_PATH=${scratch}/aincrad-character-motor-v3-receipt.json\n`+
      `AINCRAD_CHARACTER_MOTOR_V3_RECEIPT_REF=refs/heads/${P.receiptRef}\n`+
      `AINCRAD_CHARACTER_MOTOR_V3_RECEIPT_COMMIT=${receiptCommit}\n`);
    assert.deepEqual(calls.filter(args=>args[0]==='fetch'),[[
      'fetch','--no-tags','--no-recurse-submodules','--depth=1','origin',
      'refs/heads/'+P.receiptRef]]);
  }finally{await rm(scratch,{recursive:true,force:true});}
});

test('missing ref, extra files, symlink, oversize or malformed JSON cannot materialize receipt',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-motor-v3-receipt-reject-'));
  try{
    const e=env(scratch);await writeFile(e.GITHUB_ENV,'');
    const cases=[
      {fetchError:new Error('missing receipt-data ref')},
      {inventory:Buffer.from(`100644 blob ${blob}\treceipt.json\0`+
        `100644 blob ${blob}\textra.json\0`)},
      {inventory:Buffer.from(`120000 blob ${blob}\treceipt.json\0`)},
      {declaredSize:16*1024+1},
      {bytes:Buffer.from('not-json')},
    ];
    for(const variation of cases){
      const {git}=fakeGit(variation);
      await assert.rejects(fetchCharacterMotorV3ReceiptRef({root:scratch,env:e,git}));
      assert.deepEqual((await readdir(scratch)).sort(),['github-env']);
      assert.equal(await readFile(e.GITHUB_ENV,'utf8'),'');
    }
  }finally{await rm(scratch,{recursive:true,force:true});}
});

test('wrong source event and malformed tree fail before receipt fetch',async()=>{
  assert.throws(()=>characterMotorV3ReceiptBlob(Buffer.from('')));
  assert.throws(()=>characterMotorV3ReceiptBlob(Buffer.from(`100644 blob ${blob}\tother.json\0`)));
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-motor-v3-receipt-event-'));
  try{
    const {git,calls}=fakeGit();
    await assert.rejects(fetchCharacterMotorV3ReceiptRef({root:scratch,
      env:{...env(scratch),GITHUB_REF:'refs/heads/'+P.receiptRef},git}));
    assert.equal(calls.length,0);
  }finally{await rm(scratch,{recursive:true,force:true});}
});

test('a separate single-file Git branch resolves through one real read-only fetch',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-motor-v3-receipt-git-'));
  const source=join(scratch,'source'),checkout=join(scratch,'checkout');
  const call=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
  try{
    call(scratch,'init','-q','-b','main',source);
    call(source,'config','user.name','Pilot fixture');
    call(source,'config','user.email','pilot@example.invalid');
    await writeFile(join(source,'main.txt'),'frozen source\n');
    call(source,'add','main.txt');call(source,'commit','-qm','source');
    const sourceCommit=call(source,'rev-parse','HEAD');
    call(source,'switch','-q','--orphan',P.receiptRef);
    await rm(join(source,'main.txt'),{force:true});
    await writeFile(join(source,'receipt.json'),receipt);
    call(source,'add','receipt.json');call(source,'commit','-qm','receipt');
    const expectedReceiptCommit=call(source,'rev-parse','HEAD');
    call(scratch,'init','-q',checkout);
    call(checkout,'remote','add','origin',source);
    call(checkout,'fetch','-q','origin','refs/heads/main');
    call(checkout,'checkout','-q','--detach','FETCH_HEAD');
    const e={...env(scratch),GITHUB_SHA:sourceCommit};
    await writeFile(e.GITHUB_ENV,'');
    const result=await fetchCharacterMotorV3ReceiptRef({root:checkout,env:e});
    assert.equal(result.receiptCommit,expectedReceiptCommit);
    assert.equal(result.receiptSha256,sha(receipt));
    assert.deepEqual(await readFile(join(scratch,'aincrad-character-motor-v3-receipt.json')),receipt);
    assert.equal(call(checkout,'status','--porcelain'),'');
  }finally{await rm(scratch,{recursive:true,force:true});}
});
