import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG } from '../src/config.js';
import { ACTOR_GESTURE_PREDICTOR_RULES,actorGesturePredictionFeatures,
  actorGesturePredictionLossGradient,createActorGesturePredictor } from '../src/actor-gesture-predictor.js';

const dt=CONFIG.fixedStep;
function row(tick,visibility='absent',extra={}){
  return {at:tick*dt,visibility,peer:visibility==='unknown'?null:{dx:100,dy:-30},
    pose:visibility==='pose'?{origin:{dx:104,dy:-29},tip:{dx:120,dy:-10},progress:0.5}:null,
    self:{actionActive:0,poseProgress:null},...extra};
}
function send(predictor,start,end,visibility){
  for(let tick=start;tick<=end;tick++)predictor.observe(row(tick,visibility));
}

test('origin features use only current actor-local geometry and own action context',()=>{
  const sample=row(3,'pose',{objectId:'secret',referenceCorrect:true,
    receiverLearner:{weights:[999]},self:{actionActive:1,poseProgress:0.4}});
  const features=actorGesturePredictionFeatures(sample);
  assert.equal(features.length,ACTOR_GESTURE_PREDICTOR_RULES.featureCount);
  assert.deepEqual(features,actorGesturePredictionFeatures({...sample,objectId:'different',
    referenceCorrect:false,receiverLearner:{weights:[-999]}}));
  assert.deepEqual(actorGesturePredictionFeatures(row(3,'unknown')),null);
  assert(features.every(value=>Number.isFinite(value)&&value>=-1&&value<=1));
  assert.notDeepEqual(features,actorGesturePredictionFeatures(row(3,'absent')));
  const hostile=row(3,'pose',{peer:{dx:1e100,dy:-1e100}});
  assert(actorGesturePredictionFeatures(hostile).every(value=>Number.isFinite(value)));
  assert.throws(()=>actorGesturePredictionFeatures(row(3,'pose',{peer:{dx:NaN,dy:0}})),TypeError);
});

test('all logistic weight and bias gradients match central differences',()=>{
  const x=actorGesturePredictionFeatures(row(1,'pose',{self:{actionActive:1,poseProgress:0.6}}));
  const weights=Array.from({length:x.length},(_,i)=>(i-4)*0.035),bias=-0.12;
  const analytic=actorGesturePredictionLossGradient(weights,bias,x,1);
  const epsilon=1e-5;
  for(let i=0;i<x.length;i++){
    const plus=weights.slice(),minus=weights.slice();plus[i]+=epsilon;minus[i]-=epsilon;
    const numerical=(actorGesturePredictionLossGradient(plus,bias,x,1).loss-
      actorGesturePredictionLossGradient(minus,bias,x,1).loss)/(2*epsilon);
    assert(Math.abs(numerical-analytic.gradient[i])<1e-9,`weight ${i}`);
  }
  const biasNumeric=(actorGesturePredictionLossGradient(weights,bias+epsilon,x,1).loss-
    actorGesturePredictionLossGradient(weights,bias-epsilon,x,1).loss)/(2*epsilon);
  assert(Math.abs(biasNumeric-analytic.biasGradient)<1e-9);
});

test('extreme finite logits stay finite and bad numeric values fail closed',()=>{
  const x=Array(ACTOR_GESTURE_PREDICTOR_RULES.featureCount).fill(1);
  for(const sign of [-1,1])for(const label of [0,1]){
    const result=actorGesturePredictionLossGradient(x.map(()=>sign*1000),0,x,label);
    assert(Number.isFinite(result.loss));
    assert(Number.isFinite(result.probability));
    assert(result.gradient.every(Number.isFinite));
  }
  assert.throws(()=>actorGesturePredictionLossGradient(x.map(()=>NaN),0,x,1),TypeError);
  assert.throws(()=>actorGesturePredictionLossGradient(x,Infinity,x,1),TypeError);
});

test('one frozen forecast settles after exactly 30 consecutive visible ticks',()=>{
  const predictor=createActorGesturePredictor();
  assert.deepEqual(predictor.observe(row(0)),{kind:'idle',forecastStarted:true});
  assert.deepEqual(predictor.observe(row(0)),{kind:'ignored-duplicate'});
  send(predictor,1,29,'absent');
  assert.equal(predictor.snapshot().validTargets,0);
  assert.equal(predictor.snapshot().forecasts,1);
  assert.equal(predictor.observe(row(30,'pose')).kind,'settled');
  let snapshot=predictor.snapshot();
  assert.equal(snapshot.validTargets,1);
  assert.equal(snapshot.updates,1);
  assert.equal(snapshot.targetPose,1);
  assert.equal(snapshot.onsets,1);
  assert.equal(snapshot.forecasts,2,'the target row can begin the next nonoverlapping window');
  assert.equal(snapshot.limits.horizonTicks,30);
  assert.equal(snapshot.limits.maximumUpdatesPerSecond,2);
  assert.equal(snapshot.limits.replayCapacity,0);
  assert.notDeepEqual(predictor.parameters().weights,Array(11).fill(0));
  send(predictor,31,59,'pose');
  assert.equal(predictor.snapshot().updates,1);
  predictor.observe(row(60,'absent'));
  snapshot=predictor.snapshot();
  assert.equal(snapshot.validTargets,2);
  assert.equal(snapshot.offsets,1);
  assert.equal(snapshot.targetAbsent,1);
});

test('the sampled origin is copied and a full-norm clipped step is bounded',()=>{
  const intense=row(0,'pose',{peer:{dx:280,dy:280},
    pose:{origin:{dx:304,dy:304},tip:{dx:328,dy:328},progress:1},
    self:{actionActive:1,poseProgress:1}});
  const original=structuredClone(intense);
  const a=createActorGesturePredictor(),b=createActorGesturePredictor();
  a.observe(intense);b.observe(original);
  intense.peer.dx=-999;intense.pose.tip.dx=-999;intense.self.poseProgress=0.01;
  for(let tick=1;tick<=30;tick++){
    a.observe(row(tick,'absent'));b.observe(row(tick,'absent'));
  }
  assert.deepEqual(a.parameters(),b.parameters(),'later mutation cannot change the frozen origin');
  const parameters=a.parameters();
  const norm=Math.hypot(parameters.bias,...parameters.weights);
  assert(Math.abs(norm-ACTOR_GESTURE_PREDICTOR_RULES.learningRate)<1e-12,
    'the complete weight and bias update is clipped to one global norm');
});

test('unknown, missed tick, and partial visibility discard instead of creating negative labels',()=>{
  const unknown=createActorGesturePredictor();
  unknown.observe(row(0));send(unknown,1,14,'absent');
  assert.equal(unknown.observe(row(15,'unknown')).kind,'censored-unknown');
  assert.equal(unknown.snapshot().censoredUnknown,1);
  assert.equal(unknown.snapshot().validTargets,0);
  assert.equal(unknown.snapshot().targetAbsent,0);
  unknown.observe(row(16));
  send(unknown,17,45,'absent');
  assert.equal(unknown.snapshot().validTargets,0);
  unknown.observe(row(46,'pose'));
  assert.equal(unknown.snapshot().validTargets,1);
  const gap=createActorGesturePredictor();
  gap.observe(row(0));
  assert.equal(gap.observe(row(2)).kind,'censored-gap');
  assert.equal(gap.snapshot().censoredGap,1);
  assert.equal(gap.snapshot().validTargets,0);
  assert.equal(gap.snapshot().forecasts,2);
  assert.throws(()=>gap.observe(row(3,'unknown',{pose:{}})),TypeError);
});

test('prequential baselines are frozen at origin and target strata remain explicit',()=>{
  const predictor=createActorGesturePredictor();
  send(predictor,0,30,'absent');
  assert.equal(predictor.snapshot().validTargets,1);
  assert.equal(predictor.snapshot().targetAbsent,1);
  const first=predictor.snapshot().scores;
  assert(Math.abs(first.prior.logLoss-Math.log(2))<1e-12);
  assert(Math.abs(first.persistence.logLoss+Math.log(0.9))<1e-12);
  send(predictor,31,60,'pose');
  const snapshot=predictor.snapshot();
  assert.equal(snapshot.targetPose,1);
  assert.equal(snapshot.onsets,1);
  assert.equal(snapshot.stableAbsent,1);
  assert(Math.abs(snapshot.scores.prior.logLoss-(Math.log(2)+Math.log(3)))<1e-12,
    'the second prior was frozen at origin after exactly one prior absence');
  assert(Math.abs(snapshot.scoresByTarget.pose.prior.logLoss-Math.log(3))<1e-12);
  assert(snapshot.scoresByTarget.absent.model.brier>0);
  assert(snapshot.scoresByTarget.pose.model.brier>0);
  const copy=predictor.snapshot();
  copy.scores.model.brier=999;copy.scoresByTarget.pose.prior.logLoss=999;
  assert.notEqual(predictor.snapshot().scores.model.brier,999);
  assert.notEqual(predictor.snapshot().scoresByTarget.pose.prior.logLoss,999);
});

test('long visible absence does not masquerade as pose learning and reset clears session state',()=>{
  const predictor=createActorGesturePredictor();
  send(predictor,0,300,'absent');
  const snapshot=predictor.snapshot();
  assert.equal(snapshot.targetPose,0);
  assert.equal(snapshot.onsets,0);
  assert.equal(snapshot.validTargets,10);
  assert.equal(snapshot.stableAbsent,10);
  assert.equal(snapshot.updates,10);
  const copy=predictor.parameters();copy.weights[0]=999;
  assert.notEqual(predictor.parameters().weights[0],999);
  predictor.clear();
  assert.equal(predictor.snapshot().validTargets,0);
  assert.equal(predictor.snapshot().pending,false);
  assert.deepEqual(predictor.parameters(),{weights:Array(11).fill(0),bias:0});
});
