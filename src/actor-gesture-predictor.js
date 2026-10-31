// Session-only prediction of the next personally visible public pose. This
// learner has no object, transaction, partner identity or reward input. Only
// the actor's own current motor context can identify an action.
import { CONFIG, NPC_RULES } from './config.js';

export const ACTOR_GESTURE_PREDICTOR_RULES=Object.freeze({horizonTicks:30,
  featureCount:15,learningRate:0.01,gradientClip:1});
const {horizonTicks,featureCount,learningRate,gradientClip}=ACTOR_GESTURE_PREDICTOR_RULES;
const STEP=CONFIG.fixedStep,EPS=1e-8,SCORE_FLOOR=1e-12,MAX=Number.MAX_SAFE_INTEGER;
const scalar=(n)=>Number.isFinite(n);
const pair=(p)=>p&&scalar(p.dx)&&scalar(p.dy);
const pose=(p)=>p&&pair(p.origin)&&pair(p.tip)&&scalar(p.progress)&&p.progress>0&&p.progress<=1;
const unit=(n)=>Math.max(-1,Math.min(1,n));
const boundedAdd=(a,b)=>Math.min(MAX,a+b);

function checkedRow(row){
  if(!row||!scalar(row.at)||!['unknown','absent','pose'].includes(row.visibility)||
    !row.self||![0,1].includes(row.self.actionActive)||![0,1].includes(row.self.freeHandActive)||
    row.self.poseProgress!==null&&(!scalar(row.self.poseProgress)||
      row.self.poseProgress<=0||row.self.poseProgress>1)||
    row.self.freeHandPose!==null&&(!row.self.freeHandActive||!pose(row.self.freeHandPose))||
    row.self.freeHandPose!==null&&row.self.poseProgress!==row.self.freeHandPose.progress||
    row.self.freeHandActive&&!row.self.actionActive)
    throw new TypeError('Invalid actor-local gesture row');
  if(row.visibility==='unknown'){
    if(row.pose!==null||row.peer!==null&&!pair(row.peer))
      throw new TypeError('Invalid unknown actor-local gesture row');
  }else if(!pair(row.peer)||row.visibility==='absent'&&row.pose!==null||
    row.visibility==='pose'&&!pose(row.pose))
    throw new TypeError('Invalid visible actor-local gesture row');
  return row;
}

/** Only information available to this actor at forecast time enters x. */
export function actorGesturePredictionFeatures(input){
  const row=checkedRow(input);
  if(row.visibility==='unknown')return null;
  const pose=row.visibility==='pose'?row.pose:null;
  const own=row.self.freeHandPose;
  const scale=NPC_RULES.visionRadius;
  return [pose?1:0,unit(row.peer.dx/scale),unit(row.peer.dy/scale),
    pose?unit((pose.origin.dx-row.peer.dx)/24):0,
    pose?unit((pose.origin.dy-row.peer.dy)/24):0,
    pose?unit((pose.tip.dx-pose.origin.dx)/24):0,
    pose?unit((pose.tip.dy-pose.origin.dy)/24):0,
    pose?pose.progress:0,row.self.actionActive,
    row.self.poseProgress===null?0:1,row.self.poseProgress??0,
    row.self.freeHandActive,own?.progress??0,
    own?unit((own.tip.dx-own.origin.dx)/24):0,
    own?unit((own.tip.dy-own.origin.dy)/24):0];
}

function checkedModel(weights,bias,x,y){
  if(!Array.isArray(weights)&&!(weights instanceof Float64Array))throw new TypeError('Expected numeric weights');
  if(weights.length!==featureCount||!scalar(bias)||!Array.isArray(x)&&!(x instanceof Float64Array)||
    x.length!==featureCount||![0,1].includes(y)||
    weights.some(value=>!scalar(value))||x.some(value=>!scalar(value)||Math.abs(value)>1))
    throw new TypeError('Invalid gesture predictor parameters');
}

export function actorGesturePredictionLossGradient(weights,bias,x,y){
  checkedModel(weights,bias,x,y);
  let logit=bias;
  for(let i=0;i<featureCount;i++)logit+=weights[i]*x[i];
  if(!scalar(logit))throw new TypeError('Nonfinite gesture predictor logit');
  const probability=logit>=0?1/(1+Math.exp(-logit)):Math.exp(logit)/(1+Math.exp(logit));
  const loss=Math.max(logit,0)+Math.log1p(Math.exp(-Math.abs(logit)))-y*logit;
  const biasGradient=probability-y;
  const gradient=x.map(value=>biasGradient*value);
  return {probability,loss,gradient,biasGradient};
}

function blankScores(){return {model:{brier:0,logLoss:0},prior:{brier:0,logLoss:0},
  persistence:{brier:0,logLoss:0}};}
function addScore(slot,key,probability,target){
  const p=Math.max(SCORE_FLOOR,Math.min(1-SCORE_FLOOR,probability));
  slot[key].brier=boundedAdd(slot[key].brier,(probability-target)**2);
  slot[key].logLoss=boundedAdd(slot[key].logLoss,-target*Math.log(p)-(1-target)*Math.log1p(-p));
}
function copyScores(scores){return Object.fromEntries(Object.entries(scores).map(([name,value])=>[name,{...value}]));}

/** One nonoverlapping 30-tick forecast. Every intermediate sample must show
 * continuous personal visibility; an unknown observation is never absence.
 */
export function createActorGesturePredictor(){
  let weights=new Float64Array(featureCount),bias=0,pending=null,lastAt=null;
  let forecasts=0,validTargets=0,updates=0,censoredUnknown=0,censoredGap=0,
    targetPose=0,targetAbsent=0,onsets=0,offsets=0,stablePose=0,stableAbsent=0;
  let scores=blankScores(),scoresByTarget={pose:blankScores(),absent:blankScores()};
  function start(row){
    const x=actorGesturePredictionFeatures(row);
    if(!x)return false;
    const {probability}=actorGesturePredictionLossGradient(weights,bias,x,0);
    pending={x,probability,prior:(1+targetPose)/(2+validTargets),
      persistence:row.visibility==='pose'?0.9:0.1,
      originPose:row.visibility==='pose',remaining:horizonTicks,lastAt:row.at};
    forecasts=boundedAdd(forecasts,1);
    return true;
  }
  function settle(row){
    const target=row.visibility==='pose'?1:0;
    const change=pending.probability-target;
    const norm=Math.hypot(change,...pending.x.map(value=>change*value));
    const clip=Math.min(1,gradientClip/norm);
    const nextWeights=weights.map((weight,i)=>weight-learningRate*clip*change*pending.x[i]);
    const nextBias=bias-learningRate*clip*change;
    if(!scalar(nextBias)||nextWeights.some(value=>!scalar(value)))
      throw new TypeError('Nonfinite gesture predictor update');
    validTargets=boundedAdd(validTargets,1);
    if(target)targetPose=boundedAdd(targetPose,1);
    else targetAbsent=boundedAdd(targetAbsent,1);
    if(pending.originPose){
      if(target)stablePose=boundedAdd(stablePose,1);
      else offsets=boundedAdd(offsets,1);
    }else if(target)onsets=boundedAdd(onsets,1);
    else stableAbsent=boundedAdd(stableAbsent,1);
    const field=target?'pose':'absent';
    for(const [key,p] of [['model',pending.probability],['prior',pending.prior],
      ['persistence',pending.persistence]]){
      addScore(scores,key,p,target);addScore(scoresByTarget[field],key,p,target);
    }
    weights=nextWeights;bias=nextBias;
    updates=boundedAdd(updates,1);
  }
  function observe(input){
    const row=checkedRow(input);
    if(lastAt!==null&&row.at<=lastAt)return {kind:'ignored-duplicate'};
    lastAt=row.at;
    let kind='idle';
    if(pending){
      if(row.visibility==='unknown'){
        pending=null;censoredUnknown=boundedAdd(censoredUnknown,1);kind='censored-unknown';
      }else if(Math.abs(row.at-pending.lastAt-STEP)>EPS){
        pending=null;censoredGap=boundedAdd(censoredGap,1);kind='censored-gap';
      }else{
        pending.lastAt=row.at;
        pending.remaining--;
        if(pending.remaining===0){settle(row);pending=null;kind='settled';}
        else kind='continued';
      }
    }
    if(!pending&&row.visibility!=='unknown'){
      start(row);
      return {kind,forecastStarted:true};
    }
    return {kind,forecastStarted:false};
  }
  function snapshot(){return {pending:!!pending,forecasts,validTargets,updates,
    censoredUnknown,censoredGap,targetPose,targetAbsent,onsets,offsets,
    stablePose,stableAbsent,scores:copyScores(scores),
    scoresByTarget:{pose:copyScores(scoresByTarget.pose),absent:copyScores(scoresByTarget.absent)},
    limits:{horizonTicks,maximumUpdatesPerSecond:1/(horizonTicks*STEP),replayCapacity:0}};}
  function parameters(){return {weights:Array.from(weights),bias};}
  function clear(){weights=new Float64Array(featureCount);bias=0;pending=null;lastAt=null;
    forecasts=0;validTargets=0;updates=0;censoredUnknown=0;censoredGap=0;
    targetPose=0;targetAbsent=0;onsets=0;offsets=0;stablePose=0;stableAbsent=0;
    scores=blankScores();scoresByTarget={pose:blankScores(),absent:blankScores()};}
  return {observe,snapshot,parameters,clear};
}
