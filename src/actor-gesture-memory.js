// Session-only, actor-local samples of public motor pose. This store has no
// target, partner identity, transaction, reward, or durable save authority.
import { CONFIG } from './config.js';

export const ACTOR_GESTURE_MEMORY_LIMITS=Object.freeze({capacity:768,ttlSeconds:12});
const finitePair=p=>p&&Number.isFinite(p.dx)&&Number.isFinite(p.dy);
const copyPair=p=>p?{dx:p.dx,dy:p.dy}:null;
const copyRecord=row=>({at:row.at,visibility:row.visibility,peer:copyPair(row.peer),
  pose:row.pose?{origin:copyPair(row.pose.origin),tip:copyPair(row.pose.tip),progress:row.pose.progress}:null,
  self:{actionActive:row.self.actionActive,poseProgress:row.self.poseProgress},
  continuousVisible:row.continuousVisible,visibleSeconds:row.visibleSeconds,
  continuousAbsenceSeconds:row.continuousAbsenceSeconds});

function validSample(row){
  if(!row||!Number.isFinite(row.at)||!['unknown','absent','pose'].includes(row.visibility)||
    !row.self||![0,1].includes(row.self.actionActive)||
    row.self.poseProgress!==null&&(!Number.isFinite(row.self.poseProgress)||row.self.poseProgress<=0||row.self.poseProgress>1))return false;
  if(row.visibility==='unknown')return row.pose===null&&(row.peer===null||finitePair(row.peer));
  if(!finitePair(row.peer))return false;
  if(row.visibility==='absent')return row.pose===null;
  return row.pose&&finitePair(row.pose.origin)&&finitePair(row.pose.tip)&&
    Number.isFinite(row.pose.progress)&&row.pose.progress>0&&row.pose.progress<=1;
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
  let head=0,size=0,overflows=0,expirations=0,lastAt=null;
  function clear(){ring.fill(undefined);head=0;size=0;overflows=0;expirations=0;lastAt=null;}
  function removeOld(at){
    while(size&&at-ring[head].at>ttlSeconds){ring[head]=undefined;head=(head+1)%capacity;size--;expirations++;}
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
      pose:sample.pose?{origin:copyPair(sample.pose.origin),tip:copyPair(sample.pose.tip),progress:sample.pose.progress}:null,
      self:{...sample.self},continuousVisible:continuous,
      visibleSeconds:continuous?Math.min(supportedSeconds,prior.visibleSeconds+gap):0,
      continuousAbsenceSeconds:continuous&&sample.visibility==='absent'&&prior.visibility==='absent'
        ?Math.min(supportedSeconds,prior.continuousAbsenceSeconds+gap):0};
    if(size===capacity){ring[head]=undefined;head=(head+1)%capacity;size--;overflows++;}
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
  return {record,read,clear};
}
