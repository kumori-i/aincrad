import { bodySignals } from './interoception.js';
import { ozarkAgentWorld, ozarkPersistentWorldAgent } from './ozark-agent-world.js';
import { actorLineOfSight, rememberedCells, tileKey } from './perception.js';

// Motor evidence is runtime-only: a save cannot recreate a trail, a pending
// retreat, or permission to walk toward an arbitrary non-center coordinate.
const windows=new WeakMap(), trails=new WeakMap(), pending=new WeakMap();
const admissions=new WeakMap(), retreats=new WeakSet();
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const copy=p=>({x:p.x,y:p.y});

export function resetMotorWindow(active){windows.delete(active);}
/** Compare net intended progress with attempted distance over paid motor time.
 * Backward jitter cancels forward jitter; a current contributes no progress.
 * Each waypoint has its own window, not distance to the final route endpoint. */
export function motorStalled(active,seconds,attempted,signedProgress){
  let window=windows.get(active);
  if(!window){window={seconds:0,attempted:0,progress:0};windows.set(active,window);}
  window.seconds+=seconds;window.attempted+=attempted;window.progress+=signedProgress;
  if(window.seconds<1-1e-9)return false;
  const stalled=window.attempted>0&&window.progress<window.attempted*.02;
  windows.delete(active);
  return stalled;
}

export function recoverySafe(npc){
  if(!ozarkPersistentWorldAgent(npc)||npc.lifecycle!=='AWAKE')return false;
  const body=bodySignals(npc);
  if(body.overall==='urgent'||['parched','desperate thirst'].includes(body.thirst)||
    ['ravenous','faint with hunger'].includes(body.hunger)||
    ['winded','exhausted'].includes(body.stamina)||['weary','exhausted'].includes(body.fatigue)||
    ['sleepy','struggling to stay awake','groggy'].includes(body.sleepiness)||
    body.sleep!=='awake'||body.energy==='depleted'||body.pain==='severe'||
    ['overheated','shivering'].includes(body.thermal)||body.thermal.startsWith('dangerously'))return false;
  // An experienced recent contact takes precedence even if no escape route
  // is currently available. No unseen predator query is used.
  if(npc.memory.experience.some(e=>e.type==='condition'&&e.details?.code==='CONTACT_INJURY'&&
    e.details.provenance==='experienced contact'&&e.details.scene===npc.scene&&
    e.at<=npc.elapsed&&npc.elapsed-e.at<60))return false;
  const geometry=ozarkAgentWorld(npc),ground=geometry.groundAt?geometry.groundAt(npc.position):geometry.observe(npc.position).ground;
  return ['dry-ground','dry-land','visible-divide'].includes(ground);
}

export function recordMotorTrail(npc,active,before,motion){
  if(!ozarkPersistentWorldAgent(npc)||active.request.type!=='move'||retreats.has(active))return;
  if(motion.waterSeconds>0||motion.driftDistance>0){trails.delete(npc);return;}
  let trail=trails.get(npc);
  if(!trail||trail.scene!==npc.scene||trail.epoch!==npc.epoch){trail={scene:npc.scene,epoch:npc.epoch,points:[]};trails.set(npc,trail);}
  trail.points=trail.points.filter(p=>p.at<=npc.elapsed&&npc.elapsed-p.at<5);
  if(!(motion.distance>0))return;
  for(const point of [before,npc.position])if(!trail.points.length||distance(trail.points.at(-1),point)>=2){
    trail.points.push({...copy(point),at:npc.elapsed});
    if(trail.points.length>32)trail.points.shift();
  }
}

export function finishMotorEvidence(npc,active,event){
  if(active)windows.delete(active);
  pending.delete(npc);
  if(!active||retreats.has(active)||active.request.type!=='move'||
    event.details.result?.code!=='ROUTE_BLOCKED'||!recoverySafe(npc))return;
  const previous=admissions.get(npc);
  if(previous&&previous.scene===npc.scene&&previous.epoch===npc.epoch&&
    npc.elapsed-previous.at<60&&distance(previous,npc.position)<40)return;
  const trail=trails.get(npc);
  if(!trail||trail.scene!==npc.scene||trail.epoch!==npc.epoch)return;
  const target=[...trail.points].reverse().find(p=>npc.elapsed-p.at<5&&distance(p,npc.position)>=12&&distance(p,npc.position)<=24);
  if(!target)return;
  pending.set(npc,{event,scene:npc.scene,epoch:npc.epoch,at:npc.elapsed,origin:copy(npc.position),target:copy(target)});
}

function eligible(npc){
  const entry=pending.get(npc);
  if(!entry)return null;
  const cell=rememberedCells(npc)[tileKey(entry.target)];
  if(entry.scene!==npc.scene||entry.epoch!==npc.epoch||npc.elapsed<entry.at||npc.elapsed-entry.at>5||
    distance(entry.origin,npc.position)>3||!npc.memory.experience.includes(entry.event)||
    !recoverySafe(npc)||!cell?.walkable||cell.observedAt>npc.elapsed||npc.elapsed-cell.observedAt>2||
    !actorLineOfSight(npc,npc.position,entry.target)){pending.delete(npc);return null;}
  return entry;
}

/** A supplied, uncertain retracing heuristic, only after actual motor failure.
 * It substitutes one short attempt for a newly selected ordinary walk, never
 * for an interaction, voluntary pause, swimming, climbing, or safety choice. */
export function recoveryChoice(npc,action,need){
  if(action?.type!=='move'||need==='safety')return null;
  const entry=eligible(npc);
  return entry?{type:'move',target:copy(entry.target),duration:.75}:null;
}

/** Matching live evidence admits only this one bounded non-center destination.
 * Coordinates alone (including a replayed save/request) grant no exception. */
export function takeRecoveryRoute(npc,request){
  const entry=eligible(npc);
  if(!entry||request.type!=='move'||request.duration!==.75||
    request.target?.x!==entry.target.x||request.target?.y!==entry.target.y)return null;
  pending.delete(npc);trails.delete(npc);
  admissions.set(npc,{...copy(npc.position),scene:npc.scene,epoch:npc.epoch,at:npc.elapsed});
  return [copy(entry.target)];
}
export function markRecovery(active){retreats.add(active);}
export function isRecovery(active){return !!active&&retreats.has(active);}
