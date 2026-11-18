import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {capturePaidPoseWithTiming} from '../scripts/player-capture-timing.mjs';
import {captureWithReadiness} from '../scripts/native-capture-readiness.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const image={toPNG:()=>Buffer.alloc(10001),getSize:()=>({width:1,height:1}),isEmpty:()=>false};
test('timing preserves image and after witness with separate monotonic timestamps',async()=>{
  let clock=10;const timing={},witness={before:{paid:true}},after={paid:true};
  assert.equal(await capturePaidPoseWithTiming({capturePage:async()=>image,
    readAfter:async()=>after,witness,timing,now:()=>clock++}),image);
  assert.equal(witness.after,after);
  assert.deepEqual(timing,{clock:'main-process-performance-now-ms',stage:'complete',
    capturePageStartedAt:10,capturePageCompletedAt:11,afterWitnessStartedAt:12,afterWitnessCompletedAt:13});
});
for(const stuck of ['capture-page','after-witness'])test(`timeout retains ${stuck} stage without late overwrite or retry`,async()=>{
  const pending=deferred(),timing={},witness={before:{paid:true}};let calls=0,retained;
  await assert.rejects(captureWithReadiness({timeoutMs:30,maxAttempts:1,prepare:async()=>({ready:true}),
    capture:()=>capturePaidPoseWithTiming({capturePage:async()=>{calls++;return stuck==='capture-page'?pending.promise:image;},
      readAfter:async()=>stuck==='after-witness'?pending.promise:{paid:true},witness,timing}),
    retain:async(_bytes,metadata)=>{retained=JSON.stringify({metadata,timing,witness});}}),/timed out/);
  const saved=JSON.parse(retained);assert.equal(saved.timing.stage,stuck);
  assert.equal('capturePageCompletedAt' in saved.timing,stuck==='after-witness');
  assert.equal(saved.witness.after,undefined);assert.equal(calls,1);
  pending.resolve(stuck==='capture-page'?image:{paid:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.stringify(JSON.parse(retained)),retained);
  assert.equal(JSON.parse(retained).timing.stage,stuck);assert.equal(calls,1);
});
test('diagnostics propagate original capture and IPC errors without gates or fallback',async()=>{
  for(const stage of ['capture-page','after-witness']){
    const error=new Error(stage),timing={};
    await assert.rejects(capturePaidPoseWithTiming({capturePage:async()=>{if(stage==='capture-page')throw error;return image;},
      readAfter:async()=>{throw error;},witness:{},timing}),e=>e===error);
    assert.equal(timing.stage,stage);assert.ok(Number.isFinite(timing.failedAt));
  }
});
test('native integration keeps deadline and paid gates and snapshots telemetry before IO',async()=>{
  const s=await readFile('scripts/verify-player-lesson-desktop.mjs','utf8');
  const capture=s.slice(s.indexOf('async function capture(win,'),s.indexOf('async function captureJournal('));
  assert.match(capture,/maxAttempts:paidPose\?1:4/);assert.doesNotMatch(capture,/timeoutMs:/);
  assert.match(capture,/verifyPlayerLessonCaptureProgress\(witness.before,witness.after\)/);
  assert.match(capture,/const evidence=JSON.stringify/);
  assert.ok(capture.indexOf('const evidence=JSON.stringify')<capture.indexOf("await fs.writeFile(prefix+'.png'"));
  assert.match(capture,/captureTiming:paidPose\?captureTiming:null/);
});
