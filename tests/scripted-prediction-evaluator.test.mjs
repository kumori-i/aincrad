import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePredictionArguments, createReturnedWorkGuard, finalizePredictionReport, retainProducerDecisionTiming } from '../scripts/evaluate-reusable-prediction.mjs';

test('separate scripted protocol is explicit and cannot set scientific overrides', () => {
  assert.equal(parsePredictionArguments(['--protocol','scripted-prediction-use-v1','--preflight','x','--output','y']).protocol,'scripted-prediction-use-v1');
  for (const value of ['other','gate2','headless-diagnostic-v1']) assert.throws(() => parsePredictionArguments(['--protocol',value,'--preflight','x','--output','y']));
  assert.throws(() => parsePredictionArguments(['--protocol','scripted-prediction-use-v1','--protocol','scripted-prediction-use-v1','--preflight','x','--output','y']));
});

test('returned work includes update/frame/submission segments and excludes owner callback time', () => {
  let at=0; const guard=createReturnedWorkGuard({now:()=>at});
  guard.enter('setup-before'); guard.leave('setup-before'); at=5000;
  guard.enter('setup-after'); guard.leave('setup-after'); at=5500;
  guard.enter('command-before'); at=9000; guard.leave('command-before'); at=9999;
  guard.enter('frame-before'); guard.leave('frame-before'); at=10999;
  guard.enter('frame-after'); guard.leave('frame-after'); at=12000;
  assert.throws(()=>guard.enter('frame-before'),/1000/);
  assert.deepEqual(guard.state,{maxMs:1001,from:'frame-after',to:'frame-before',checked:4});
});

test('only the precise initial setup pair is exempt and invalid clocks fail closed', () => {
  let at=0; const guard=createReturnedWorkGuard({now:()=>at});
  guard.leave('setup-before'); at=1001; assert.throws(()=>guard.enter('command-before'),/1000/);
  at=10; const next=createReturnedWorkGuard({now:()=>at}); next.leave('frame-before'); at=9;
  assert.throws(()=>next.enter('frame-after'),/backwards/); at=NaN; assert.throws(()=>next.enter('frame-after'),/clock/);
});

test('final wall limit is explicitly resource-censored even after a scientific pass', () => {
  const report={status:'passed',continuingAllowed:false}, times=[299,301];
  finalizePredictionReport(report,{elapsedSeconds:()=>times.shift(),persist(){}});
  assert.equal(report.status,'failed'); assert.equal(report.resourceCensored,true); assert.equal(report.continuingAllowed,false);
});

test('query ceiling failure before owner callback retains the producer offending maximum', () => {
  const report={resources:{maxReturnedDecisionMs:12}};
  retainProducerDecisionTiming(report,{resource:{maximumDecisionMs:1001}});
  assert.equal(report.resources.maxReturnedDecisionMs,1001);
  retainProducerDecisionTiming(report,{resource:{maximumDecisionMs:5}});
  assert.equal(report.resources.maxReturnedDecisionMs,1001);
});
