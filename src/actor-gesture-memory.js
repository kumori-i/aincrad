// Session-only, actor-local samples of public motor pose. This store has no
// target, partner identity, transaction, reward, or durable save authority.
import { CONFIG } from './config.js';

export const ACTOR_GESTURE_MEMORY_LIMITS=Object.freeze({capacity:768,ttlSeconds:12});
const MAX=Number.MAX_SAFE_INTEGER;
const finitePair=p=>p&&Number.isFinite(p.dx)&&Number.isFinite(p.dy);
const copyPair=p=>p?{dx:p.dx,dy:p.dy}:null;
const copyPose=p=>p?{origin:copyPair(p.origin),tip:copyPair(p.tip),progress:p.progress}:null;
const validPose=p=>p&&finitePair(p.origin)&&finitePair(p.tip)&&
  Number.isFinite(p.progress)&&p.progress>0&&p.progress<=1;
const copyRecord=row=>({at:row.at,visibility:row.visibility,peer:copyPair(row.peer),
  pose:copyPose(row.pose),
  self:{actionActive:row.self.actionActive,poseProgress:row.self.poseProgress,
    freeHandActive:row.self.freeHandActive,freeHandPose:copyPose(row.self.freeHandPose)},
  continuousVisible:row.continuousVisible,visibleSeconds:row.visibleSeconds,
  continuousAbsenceSeconds:row.continuousAbsenceSeconds});

function validSample(row){
  if(!row||!Number.isFinite(row.at)||!['unknown','absent','pose'].includes(row.visibility)||
    !row.self||![0,1].includes(row.self.actionActive)||
    ![0,1].includes(row.self.freeHandActive)||
    row.self.poseProgress!==null&&(!Number.isFinite(row.self.poseProgress)||row.self.poseProgress<=0||row.self.poseProgress>1)||
    row.self.freeHandPose!==null&&(!row.self.freeHandActive||!validPose(row.self.freeHandPose))||
    row.self.freeHandPose!==null&&row.self.poseProgress!==row.self.freeHandPose.progress||
    row.self.freeHandActive&&!row.self.actionActive)return false;
  if(row.visibility==='unknown')return row.pose===null&&(row.peer===null||finitePair(row.peer));
  if(!finitePair(row.peer))return false;
  if(row.visibility==='absent')return row.pose===null;
  return validPose(row.pose);
}

/** A fixed ring avoids shifting long histories every world tick. Reads copy all
 * nested geometry and do not expire or mutate the ring. Consecutive visible
 * samples certify only sampled continuity, never unseen time between them.
 */
export function createActorGestureMemory({capacity=ACTOR_GESTURE_MEMORY_LIMITS.capacity,
  ttlSeconds=ACTOR_GESTURE_MEMORY_LIMITS.ttlSeconds}={}){
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>ACTOR_GESTURE_MEMORY_LIMITS.capacity||
    !Number.isFinite(ttlSeconds)||ttlSeconds<=0||ttlSeconds>ACTOR_GESTURE_MEMORY_LIMITS.ttlSeconds)
    throw new TypeError('Invalid actor gesture memory limits');
  const ring=new Array(capacity);
  const supportedSeconds=Math.min(ttlSeconds,(capacity-1)*CONFIG.fixedStep);
  let head=0,size=0,overflows=0,expirations=0,lastAt=null,
    sessionResets=0,saturated=false;
  const bump=value=>{const next=Math.min(MAX,value+1);if(next===MAX)saturated=true;return next;};
  function clear(){ring.fill(undefined);head=0;size=0;overflows=0;expirations=0;lastAt=null;
    sessionResets=bump(sessionResets);}
  function removeOld(at){
    while(size&&at-ring[head].at>ttlSeconds){ring[head]=undefined;head=(head+1)%capacity;size--;expirations=bump(expirations);}
  }
  function record(sample){
    if(!validSample(sample))throw new TypeError('Invalid actor-local public gesture sample');
    if(lastAt!==null&&sample.at<=lastAt)return false;
    removeOld(sample.at);
    const prior=size?ring[(head+size-1)%capacity]:null;
    const gap=prior?sample.at-prior.at:Infinity;
    const continuous=!!prior&&prior.visibility!=='unknown'&&sample.visibility!=='unknown'&&
      gap>0&&gap<=CONFIG.fixedStep+1e-8;
    const row={at:sample.at,visibility:sample.visibility,peer:copyPair(sample.peer),
      pose:copyPose(sample.pose),
      self:{actionActive:sample.self.actionActive,poseProgress:sample.self.poseProgress,
        freeHandActive:sample.self.freeHandActive,freeHandPose:copyPose(sample.self.freeHandPose)},
      continuousVisible:continuous,
      visibleSeconds:continuous?Math.min(supportedSeconds,prior.visibleSeconds+gap):0,
      continuousAbsenceSeconds:continuous&&sample.visibility==='absent'&&prior.visibility==='absent'
        ?Math.min(supportedSeconds,prior.continuousAbsenceSeconds+gap):0};
    if(size===capacity){ring[head]=undefined;head=(head+1)%capacity;size--;overflows=bump(overflows);}
    ring[(head+size)%capacity]=row;size++;lastAt=sample.at;
    return true;
  }
  function read(now){
    if(!Number.isFinite(now))throw new TypeError('Expected finite actor time');
    const records=[];
    for(let i=0;i<size;i++){
      const row=ring[(head+i)%capacity];
      if(row.at<=now&&now-row.at<=ttlSeconds)records.push(copyRecord(row));
    }
    return {records,overflows,expirations,limits:{capacity,ttlSeconds}};
  }
  function summary(){return {retained:size,overflows,expirations,
    limits:{capacity,ttlSeconds},sessionResets,saturated};}
  return {record,read,summary,clear};
}
