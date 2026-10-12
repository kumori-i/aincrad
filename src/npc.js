import { CONFIG, NPC_RULES, NPC_PRESETS } from './config.js';
import { canStandOutside, moveActor, distance, clamp } from './world.js';
import { waterSource, withinWorld } from './resources.js';
import { perceive, tileKey, tilePoint, lineOfSight } from './perception.js';
import { knownRoute } from './navigation.js';
import { recordEvent, rememberObservation, policyContext, learnOutcome, recoveryLesson } from './npc-memory.js';

export function observeNpc(npc,environment={}){
  if(npc.lifecycle==='COLLAPSED')return {at:npc.elapsed,position:{...npc.position},lifecycle:npc.lifecycle,hydration:npc.hydration,flask:{water:npc.flask.water,capacity:npc.flask.capacity},cells:[],sources:[]};
  const observation=perceive(npc,environment);rememberObservation(npc,observation);return observation;
}
function complete(npc,request,result,context=policyContext(npc),startPosition={...npc.position}){
  npc.active=null;const event=learnOutcome(npc,request,result,context,startPosition);
  npc.nextDecisionAt=npc.elapsed+.65;return {eventId:event.id,...result};
}
function cleanRequest(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!['observe','move','inspect','fill_flask','drink','wait'].includes(raw.type))return null;
  const action={type:raw.type};
  if(['move','inspect','fill_flask'].includes(raw.type)){
    if(raw.sourceId!==undefined){if(typeof raw.sourceId!=='string'||raw.sourceId.length>70)return null;action.sourceId=raw.sourceId;}
    else if(raw.type==='move'){if(!withinWorld(raw.target))return null;action.target={x:raw.target.x,y:raw.target.y};}
    else return null;
  }
  if(raw.type==='wait'){if(raw.seconds!==undefined&&(!Number.isFinite(raw.seconds)||raw.seconds<.25||raw.seconds>5))return null;action.seconds=raw.seconds??1;}
  if(raw.duration!==undefined&&(!Number.isFinite(raw.duration)||raw.duration<=0||raw.duration>NPC_RULES.maxActionSeconds))return null;
  if(raw.duration!==undefined)action.duration=raw.duration;
  return action;
}
export function requestNpcAction(npc,raw,environment={}){
  if(npc.lifecycle!=='AWAKE')return {ok:false,code:'UNCONSCIOUS'};
  if(npc.active)return {ok:false,code:'ACTION_BUSY'};
  const request=cleanRequest(raw),context=policyContext(npc),startPosition={...npc.position};
  if(!request)return complete(npc,{type:'observe'},{ok:false,code:'INVALID_REQUEST'},context,startPosition);
  const known=request.sourceId?npc.memory.sources[request.sourceId]:null;
  if(request.sourceId&&!known)return complete(npc,request,{ok:false,code:'UNKNOWN_SOURCE'},context,startPosition);
  const source=request.sourceId?waterSource(request.sourceId,environment):null;
  if(request.sourceId&&!source&&request.type==='move')return complete(npc,request,{ok:false,code:'NO_KNOWN_APPROACH'},context,startPosition);
  if(request.type==='observe'){
    const previous=Object.keys(npc.memory.cells).length;observeNpc(npc,environment);
    return complete(npc,request,{ok:true,code:'OBSERVED',novelCells:Math.max(0,Object.keys(npc.memory.cells).length-previous)},context,startPosition);
  }
  if(request.type==='inspect'){
    if(!source||distance(npc.position,known)>NPC_RULES.visionRadius||!lineOfSight(npc.position,known))return complete(npc,request,{ok:false,code:'OUT_OF_VIEW'},context,startPosition);
    npc.memory.sources[source.id].available=source.available;npc.memory.sources[source.id].observedAt=npc.elapsed;
    return complete(npc,request,{ok:true,code:'INSPECTED',source:{id:source.id,available:source.available}},context,startPosition);
  }
  if(request.type==='fill_flask'){
    if(distance(npc.position,known)>NPC_RULES.collectionRange)return complete(npc,request,{ok:false,code:'OUT_OF_REACH'},context,startPosition);
    if(!lineOfSight(npc.position,known))return complete(npc,request,{ok:false,code:'INTERACTION_BLOCKED'},context,startPosition);
    if(!source||!source.available)return complete(npc,request,{ok:false,code:'SOURCE_UNAVAILABLE'},context,startPosition);
    if(npc.flask.water>=npc.flask.capacity-.00001)return complete(npc,request,{ok:false,code:'FLASK_FULL'},context,startPosition);
    const waterCollected=npc.flask.capacity-npc.flask.water;
    npc.flask.water=npc.flask.capacity;npc.flask.provenance='collected';if(waterCollected>=.25)npc.stats.collections++;
    return complete(npc,request,{ok:true,code:'COLLECTED',waterCollected,hydrationGain:0,provenance:'collection'},context,startPosition);
  }
  if(request.type==='drink'){
    if(npc.flask.water<=.00001)return complete(npc,request,{ok:false,code:'EMPTY_FLASK'},context,startPosition);
    if(npc.hydration>=99.999)return complete(npc,request,{ok:false,code:'ALREADY_HYDRATED'},context,startPosition);
    const consumed=Math.min(npc.flask.water,(100-npc.hydration)/NPC_RULES.drinkHydration);
    const gain=consumed*NPC_RULES.drinkHydration,provenance=npc.flask.provenance;
    const independent=provenance==='collected'&&npc.flask.fillEventId!==null&&npc.flask.fillEventId!==npc.flask.creditedFillId&&gain>=15;
    npc.flask.water=clamp(npc.flask.water-consumed,0,1);npc.hydration=clamp(npc.hydration+gain,0,100);
    if(independent){npc.stats.independentDrinks++;npc.flask.creditedFillId=npc.flask.fillEventId;if(npc.stats.firstWaterAt===null)npc.stats.firstWaterAt=npc.elapsed;}
    npc.presentation.drinkUntil=npc.elapsed+2;
    return complete(npc,request,{ok:true,code:'DRANK',waterConsumed:consumed,hydrationGain:gain,provenance,independent},context,startPosition);
  }
  if(request.type==='move'){
    let target=request.target,route=null;
    const anchor=npc.navigationAnchor&&npc.memory.cells[npc.navigationAnchor]?.walkable&&distance(npc.position,tilePoint(npc.navigationAnchor))<160?npc.navigationAnchor:null;
    if(source){
      // The observed source point is a known dry interaction node, even when a coarse
      // grid cell is wet. Reach it from observed land; never consult hidden terrain.
      const approaches=Object.values(npc.memory.cells).filter(c=>c.walkable&&distance(c,known)<=NPC_RULES.tileSize*2);
      approaches.sort((a,b)=>distance(a,npc.position)+distance(a,known)-distance(b,npc.position)-distance(b,known));
      for(const point of approaches){
        const edge=[tileKey(point),tileKey(known)].sort().join('>');
        if((npc.memory.blockedEdges[edge]?.retryAfter||0)>npc.elapsed)continue;
        const path=knownRoute(npc.memory.cells,npc.position,point,30,npc.memory.blockedEdges,npc.elapsed,anchor);
        if(!path)continue;
        const length=path.reduce((sum,p,i)=>sum+distance(i?path[i-1]:npc.position,p),0)+distance(point,known);
        if(length>NPC_RULES.maxActionSeconds*CONFIG.walkSpeed)continue;
        route=[...path,{x:known.x,y:known.y}];target={x:known.x,y:known.y};break;
      }
      if(!route)return complete(npc,request,{ok:false,code:'NO_KNOWN_ROUTE'},context,startPosition);
    }else{
      const cell=npc.memory.cells[tileKey(target)];
      if(!cell?.walkable||distance(target,cell)>NPC_RULES.tileSize*.71)return complete(npc,request,{ok:false,code:'UNOBSERVED_TARGET'},context,startPosition);
      route=knownRoute(npc.memory.cells,npc.position,target,30,npc.memory.blockedEdges,npc.elapsed,anchor);
      if(!route)return complete(npc,request,{ok:false,code:'NO_KNOWN_ROUTE'},context,startPosition);
    }
    if(distance(npc.position,target)<6)return complete(npc,request,{ok:true,code:'ARRIVED',distance:0},context,startPosition);
    npc.active={request,context,startPosition,route,index:0,startedAt:npc.elapsed,expiresAt:npc.elapsed+(request.duration||NPC_RULES.maxActionSeconds),startHydration:npc.hydration,blockedFor:0,travelled:0};
  }else npc.active={request,context,startPosition,startedAt:npc.elapsed,expiresAt:npc.elapsed+request.seconds,startHydration:npc.hydration};
  return {ok:true,code:'STARTED'};
}
export function collapseNpc(npc,reason='dehydration'){
  if(npc.lifecycle!=='AWAKE')return false;
  const active=npc.active;
  if(active)complete(npc,active.request,{ok:false,code:'COLLAPSED',hydrationLost:active.startHydration},active.context,active.startPosition);
  if(npc.skillRun){const skill=npc.memory.skills.find(s=>s.id===npc.skillRun.id);if(skill)skill.failures++;npc.skillRun=null;}
  npc.lifecycle='COLLAPSED';npc.hydration=0;npc.lifecycleAt=npc.elapsed;npc.epoch++;npc.collapseId++;npc.stats.collapses++;
  recordEvent(npc,'collapse',{collapseId:npc.collapseId,position:npc.position,verifiedCause:'hydration reached zero',reason});
  npc.decision='I lost consciousness. My identity, observations and experience remain.';return true;
}
export function rescueNpc(npc,collapseId=npc.collapseId){
  if(npc.lifecycle!=='COLLAPSED'||collapseId!==npc.collapseId||npc.rescuedCollapseId>=collapseId)return {ok:false,code:'ALREADY_RESCUED'};
  let safe=canStandOutside(npc.position.x,npc.position.y)?{...npc.position}:null;
  for(let radius=12;!safe&&radius<=120;radius+=12)for(let i=0;i<16;i++){
    const p={x:npc.position.x+Math.cos(i*Math.PI/8)*radius,y:npc.position.y+Math.sin(i*Math.PI/8)*radius};
    if(canStandOutside(p.x,p.y)){safe=p;break;}
  }
  if(!safe)return {ok:false,code:'NO_SAFE_RECOVERY_POSITION'};
  npc.position=safe;npc.hydration=NPC_PRESETS[npc.preset].rescueHydration;
  npc.rescuedCollapseId=collapseId;npc.lifecycle='RECOVERING';npc.lifecycleAt=npc.elapsed;npc.epoch++;
  npc.stats.rescues++;npc.stats.lastRescuer='divine';npc.presentation.rescueUntil=npc.elapsed+8;
  recordEvent(npc,'rescue',{collapseId,hydrationGain:npc.hydration,provenance:'divine',position:npc.position,verified:'Water was received during recovery.',observedAttribution:npc.rescuePresentation==='quiet'?'The source of the intervention was not observed.':'A warmth and a benevolent presence; divine attribution is an interpretation, not a witnessed human action.'});
  recoveryLesson(npc);npc.decision=npc.rescuePresentation==='quiet'?'I woke with water. The source of the intervention was not observed.':'I woke with water from a benevolent presence. This rescue did not count as independent survival.';
  return {ok:true,code:'RESCUED',provenance:'divine'};
}
export function tickNpc(npc,dt,environment={}){
  if(!Number.isFinite(dt)||dt<=0)return;
  dt=Math.min(dt,.25);npc.elapsed+=dt;
  const rules=NPC_PRESETS[npc.preset];
  if(npc.lifecycle==='COLLAPSED'){
    if(npc.elapsed-npc.lifecycleAt>=rules.rescueDelay)rescueNpc(npc);
    return;
  }
  if(npc.lifecycle==='RECOVERING'){
    if(npc.elapsed-npc.lifecycleAt>=rules.recoverySeconds){npc.lifecycle='AWAKE';npc.lifecycleAt=npc.elapsed;npc.epoch++;npc.nextDecisionAt=npc.elapsed;recordEvent(npc,'recovery',{collapseId:npc.collapseId,hydration:npc.hydration,identity:npc.id});}
    return;
  }
  npc.hydration=Math.max(0,npc.hydration-rules.depletionPerSecond*dt);
  if(npc.hydration<=0){collapseNpc(npc);return;}
  const active=npc.active;if(!active)return;
  if(active.request.type==='wait'){
    if(npc.elapsed>=active.expiresAt)complete(npc,active.request,{ok:true,code:'WAITED',hydrationLost:active.startHydration-npc.hydration},active.context,active.startPosition);
    return;
  }
  const target=active.route[active.index];
  if(!target){complete(npc,active.request,{ok:true,code:'ARRIVED',distance:active.travelled,hydrationLost:active.startHydration-npc.hydration},active.context,active.startPosition);return;}
  const dx=target.x-npc.position.x,dy=target.y-npc.position.y,d=Math.hypot(dx,dy);
  if(d<3){if(npc.memory.cells[tileKey(target)]?.walkable)npc.navigationAnchor=tileKey(target);active.index++;active.blockedFor=0;return;}
  const moved=moveActor(npc.position,dx,dy,Math.min(dt,d/CONFIG.walkSpeed),false,'valley');active.travelled+=moved;
  active.blockedFor=moved<.05?active.blockedFor+dt:0;
  if(active.blockedFor>1||npc.elapsed>active.expiresAt){
    const code=active.blockedFor>1?'ROUTE_BLOCKED':'ACTION_TIMEOUT';
    if(active.blockedFor>1){
      const from=active.index?active.route[active.index-1]:active.startPosition;
      npc.navigationAnchor=tileKey(from);
      const edge=[tileKey(from),tileKey(target)].sort().join('>');
      npc.memory.blockedEdges[edge]={observedAt:npc.elapsed,retryAfter:npc.elapsed+60};
      const entries=Object.entries(npc.memory.blockedEdges);if(entries.length>512)delete npc.memory.blockedEdges[entries[0][0]];
    }
    complete(npc,active.request,{ok:false,code,distance:active.travelled,hydrationLost:active.startHydration-npc.hydration},active.context,active.startPosition);
  }
}
export function changeNpcPreset(npc,preset){
  if(!NPC_PRESETS[preset])return false;
  npc.preset=preset;recordEvent(npc,'debug',{setting:'hydration preset',value:preset,provenance:'debug',hydrationGain:0});return true;
}
export function demonstrateCollapse(npc){
  if(npc.lifecycle!=='AWAKE')return false;
  recordEvent(npc,'debug',{setting:'hydration',value:0,provenance:'debug'});npc.hydration=0;return collapseNpc(npc,'explicit developer demonstration');
}
