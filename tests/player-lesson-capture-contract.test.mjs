import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPlayerLessonCaptureProgress as verify} from '../scripts/player-lesson-capture-contract.mjs';
const before=()=>({elapsed:1,at:1000,paused:false,active:{word:'nava',seconds:1.8,worked:1.5,startedAt:0,expiresAt:6},
  status:'Saying and pointing · 0.3 s of paid work left. Stay in place.',
  nearby:'Pointing at a visible object. Food actions can resume afterward.',
  asterExamples:0,miraExamples:0,metabolizedKcal:2});
test('native capture can span genuine completion without treating the clock as a renderer mutation',()=>{
  const a=before(),b={...a,elapsed:1.65,at:1650,active:null,asterExamples:1,metabolizedKcal:2.1};
  assert.deepEqual(verify(a,b),{elapsedSeconds:.6499999999999999,wallSeconds:.65,
    completedDuringCapture:true,pngVisualReviewRequired:true});
  assert.equal(a.active.worked,1.5);
});
test('still active capture certifies bounded same-gesture work and no early label',()=>{
  const a=before(),b={...a,elapsed:1.1,at:1100,active:{...a.active,worked:1.6}};
  assert.equal(verify(a,b).completedDuringCapture,false);
  assert.throws(()=>verify(a,{...b,active:{...b.active,worked:1.7}}),/match elapsed/);
  assert.throws(()=>verify(a,{...b,active:{...b.active,worked:NaN}}),/match elapsed/);
  assert.throws(()=>verify(a,{...b,active:{...b.active,worked:a.active.worked}}),/match elapsed/);
  assert.throws(()=>verify(a,{...b,asterExamples:1}),/unfinished pose/);
  assert.throws(()=>verify(a,{...b,active:{...b.active,startedAt:1}}),/identity/);
});
test('capture cannot excuse insufficient time, cancellation, copying, or a missing paid HUD',()=>{
  const a=before(),done={...a,elapsed:1.5,at:1500,active:null,asterExamples:1};
  assert.throws(()=>verify(a,{...done,elapsed:a.elapsed}),/before enough time/);
  assert.throws(()=>verify(a,{...done,asterExamples:0}),/exactly one/);
  assert.throws(()=>verify(a,{...done,miraExamples:1}),/unseen recipient/);
  assert.throws(()=>verify({...a,status:'complete'},done),/HUD/);
  assert.throws(()=>verify(a,{...done,paused:true}),/unpaused/);
});
